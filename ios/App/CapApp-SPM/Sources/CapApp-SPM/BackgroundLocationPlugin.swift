import Foundation
import Capacitor
import CoreLocation

// 백그라운드 GPS 트래커. 화면이 꺼져 있거나 다른 앱으로 전환돼도 native 단에서
// CLLocationManager 가 계속 좌표를 수신·누적합니다. JavaScript runtime 이 suspend 되면
// addListener('location') 콜백은 끊기지만, native 의 좌표 버퍼는 계속 쌓여
// 다시 foreground 로 돌아왔을 때 flush() 호출 한 번으로 일괄 회수합니다.
//
// 기존 @capacitor/geolocation 의 watchPosition 은 WebView JS 콜백 의존이라
// JS 가 suspend 되면 좌표가 sparse 하게(54초~수분 간격) 들어옵니다
// (hans 2026-06-03 사례: 46분 동안 좌표 51개, 거리 0.56km).
@objc(BackgroundLocationPlugin)
public class BackgroundLocationPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {

    public let identifier = "BackgroundLocationPlugin"
    public let jsName = "BackgroundLocation"

    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "flush", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
    ]

    private var locationManager: CLLocationManager?
    private let bufferLock = NSLock()
    private var buffer: [[String: Any]] = []
    // 사용자가 .start 를 호출한 시점 — flush 가 호출되기 전까지 buffer 에 추적된 좌표 누적.
    private var sessionActive = false

    private func ensureManager() {
        if locationManager != nil { return }
        let mgr = CLLocationManager()
        mgr.delegate = self
        mgr.desiredAccuracy = kCLLocationAccuracyBest
        mgr.activityType = .fitness
        // 3m 이상 이동했을 때만 좌표 전달 — JS 측 MIN_MOVE_METERS 와 일치.
        mgr.distanceFilter = 3
        // 사용자가 trip 멈추면 OS 가 update 를 자동 일시정지 → fitness 트래킹에 안 좋음. 비활성화.
        mgr.pausesLocationUpdatesAutomatically = false
        // 백그라운드 위치 업데이트 활성화. Info.plist 의 UIBackgroundModes=location 와 함께 동작.
        mgr.allowsBackgroundLocationUpdates = true
        // 잠금화면 / 백그라운드 시 파란색 상태바 인디케이터 표시 → Apple 정책 준수 + 사용자에게 트래킹 중임을 명시.
        mgr.showsBackgroundLocationIndicator = true
        locationManager = mgr
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        ensureManager()
        guard let mgr = locationManager else {
            call.reject("CLLocationManager init failed")
            return
        }
        // 처음에는 whenInUse 만 받을 수 있음. start() 시점에 백그라운드 사용이 시작되면
        // OS 가 "Always 로 업그레이드?" 시스템 prompt 를 띄움 (사용자 흐름).
        mgr.requestWhenInUseAuthorization()
        let status = CLLocationManager.authorizationStatus()
        call.resolve(["status": authStatusString(status)])
    }

    @objc func start(_ call: CAPPluginCall) {
        ensureManager()
        guard let mgr = locationManager else {
            call.reject("CLLocationManager init failed")
            return
        }
        // 호출자 옵션. distanceFilter / accuracy override 가능.
        if let df = call.getDouble("distanceFilter"), df > 0 {
            mgr.distanceFilter = df
        }
        if let acc = call.getString("accuracy") {
            switch acc {
            case "high": mgr.desiredAccuracy = kCLLocationAccuracyBest
            case "bestForNavigation": mgr.desiredAccuracy = kCLLocationAccuracyBestForNavigation
            case "ten": mgr.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
            default: mgr.desiredAccuracy = kCLLocationAccuracyBest
            }
        }
        // 권한 미결정 시 Always 권한 요청. whenInUse 만 있어도 시작은 되지만 백그라운드 콜백이 멈춤.
        let status = CLLocationManager.authorizationStatus()
        if status == .notDetermined || status == .authorizedWhenInUse {
            mgr.requestAlwaysAuthorization()
        }
        // 버퍼 초기화 + 세션 시작.
        bufferLock.lock()
        buffer.removeAll()
        sessionActive = true
        bufferLock.unlock()
        mgr.startUpdatingLocation()
        call.resolve(["started": true, "authorization": authStatusString(status)])
    }

    @objc func stop(_ call: CAPPluginCall) {
        locationManager?.stopUpdatingLocation()
        bufferLock.lock()
        sessionActive = false
        let snapshot = buffer
        buffer.removeAll()
        bufferLock.unlock()
        call.resolve(["coords": snapshot])
    }

    /// JS 가 foreground 로 돌아왔을 때 호출. native 가 누적해둔 좌표를 일괄 반환 + 버퍼 비움.
    /// 세션은 그대로 활성. start/flush/flush/.../stop 흐름.
    @objc func flush(_ call: CAPPluginCall) {
        bufferLock.lock()
        let snapshot = buffer
        buffer.removeAll()
        bufferLock.unlock()
        call.resolve(["coords": snapshot])
    }

    // MARK: - CLLocationManagerDelegate

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard sessionActive else { return }
        var newEntries: [[String: Any]] = []
        for loc in locations {
            // 정확도가 음수면 invalid fix. 100m 이내만 수용 — JS 측 MIN_ACCURACY_METERS 와 일치.
            if loc.horizontalAccuracy < 0 || loc.horizontalAccuracy > 100 { continue }
            let entry: [String: Any] = [
                "lat": loc.coordinate.latitude,
                "lng": loc.coordinate.longitude,
                "alt": loc.altitude,
                "ts": loc.timestamp.timeIntervalSince1970 * 1000.0,
                "accuracy": loc.horizontalAccuracy,
                "speed": loc.speed >= 0 ? loc.speed : 0,
            ]
            newEntries.append(entry)
        }
        if newEntries.isEmpty { return }
        bufferLock.lock()
        buffer.append(contentsOf: newEntries)
        let bufferSize = buffer.count
        bufferLock.unlock()
        // foreground 라면 JS 가 즉시 받도록 event 도 발사. 백그라운드면 JS suspend 라 무시되지만
        // buffer 에 누적되어 있어서 다음 flush 호출 시 회수됨.
        for entry in newEntries {
            notifyListeners("location", data: entry)
        }
        // 버퍼가 너무 커지면 (예: 화면 끄고 1시간 백그라운드 후 5400+ 좌표) 메모리 방어.
        // 10000건 (≈3시간 분량) 초과 시 가장 오래된 것부터 잘라냄.
        if bufferSize > 10000 {
            bufferLock.lock()
            let overflow = buffer.count - 10000
            if overflow > 0 { buffer.removeFirst(overflow) }
            bufferLock.unlock()
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        notifyListeners("error", data: ["message": error.localizedDescription])
    }

    public func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
        notifyListeners("authorizationChange", data: ["status": authStatusString(status)])
    }

    private func authStatusString(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .authorizedAlways: return "always"
        case .authorizedWhenInUse: return "whenInUse"
        @unknown default: return "unknown"
        }
    }
}
