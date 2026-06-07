import Foundation
import Capacitor
import CoreLocation
import UIKit

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

    // build 249 hotfix: CLLocationManager 는 active run loop 가 있는 thread (=main) 에서
    // 초기화해야 하며, delegate callback 도 그 thread 의 큐에서 발사됨. Capacitor 의 plugin
    // method 는 백그라운드 dispatch queue 에서 호출되기 때문에 ensureManager 를 그대로 호출하면
    // 백그라운드 큐에 CLLocationManager 가 묶여 delegate (`didUpdateLocations`) 가 발사되지 않음.
    // hans 2026-06-05 사례: 42분 운동, 좌표 0개. 모든 native 호출을 main thread 로 강제한다.
    private func runOnMain(_ work: @escaping () -> Void) {
        if Thread.isMainThread {
            work()
        } else {
            DispatchQueue.main.sync(execute: work)
        }
    }

    public override func load() {
        // 플러그인 로드 시점에 미리 main thread 에서 CLLocationManager 를 생성해두면,
        // 이후 start 가 백그라운드 큐에서 호출되더라도 manager 자체는 이미 main 큐에 묶여 있다.
        runOnMain { [weak self] in self?.ensureManagerInternal() }
    }

    private func ensureManagerInternal() {
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
        runOnMain { [weak self] in
            guard let self = self else { call.reject("plugin gone"); return }
            self.ensureManagerInternal()
            guard let mgr = self.locationManager else {
                call.reject("CLLocationManager init failed")
                return
            }
            // 처음에는 whenInUse 만 받을 수 있음. start() 시점에 백그라운드 사용이 시작되면
            // OS 가 "Always 로 업그레이드?" 시스템 prompt 를 띄움 (사용자 흐름).
            mgr.requestWhenInUseAuthorization()
            let status = CLLocationManager.authorizationStatus()
            call.resolve(["status": self.authStatusString(status)])
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        runOnMain { [weak self] in
            guard let self = self else { call.reject("plugin gone"); return }
            self.ensureManagerInternal()
            guard let mgr = self.locationManager else {
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
            self.bufferLock.lock()
            self.buffer.removeAll()
            self.sessionActive = true
            self.bufferLock.unlock()
            mgr.startUpdatingLocation()
            // 진단: 어떤 thread 에서 manager 가 동작하는지, runLoop 가 main 인지 확인.
            let onMain = Thread.isMainThread
            call.resolve([
                "started": true,
                "authorization": self.authStatusString(status),
                "onMainThread": onMain,
            ])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        runOnMain { [weak self] in
            guard let self = self else { call.reject("plugin gone"); return }
            self.locationManager?.stopUpdatingLocation()
            self.bufferLock.lock()
            self.sessionActive = false
            let snapshot = self.buffer
            self.buffer.removeAll()
            self.bufferLock.unlock()
            call.resolve(["coords": snapshot])
        }
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

        // build 253 핫픽스: hans 2026-06-07 사례 — 좌표 13428건 중 distinct timestamp 6724 (정확히 50%).
        // 좌표가 두 번씩 들어가던 원인: buffer.append + notifyListeners 를 동시에 하고,
        // JS 가 listener 와 5s flush polling 둘 다 구독해서 같은 entry 가 양 경로로 onCoord 호출됨.
        // → distance 가 약 2배 부풀려져 72km / 4h / 3:19 페이스로 박힘.
        //
        // fix: foreground 면 listener 로만 emit (즉시 갱신, buffer 무관),
        //      background 면 buffer 에만 누적 (JS suspend 라 listener 못 받음 → flush 가 회수).
        // 한 entry 가 정확히 한 경로로만 흐르도록 단일 경로화.
        let isBackground: Bool
        if Thread.isMainThread {
            isBackground = UIApplication.shared.applicationState != .active
        } else {
            // delegate callback 은 보통 main 큐 (manager 가 main 에서 init 됐으므로) 지만 방어적으로.
            isBackground = DispatchQueue.main.sync {
                UIApplication.shared.applicationState != .active
            }
        }

        if isBackground {
            bufferLock.lock()
            buffer.append(contentsOf: newEntries)
            let bufferSize = buffer.count
            bufferLock.unlock()
            // 버퍼가 너무 커지면 메모리 방어. 10000건 (≈3시간) 초과 시 가장 오래된 것부터 잘라냄.
            if bufferSize > 10000 {
                bufferLock.lock()
                let overflow = buffer.count - 10000
                if overflow > 0 { buffer.removeFirst(overflow) }
                bufferLock.unlock()
            }
        } else {
            // foreground — JS 가 즉시 받음. buffer 안 넣음 → 중복 차단.
            for entry in newEntries {
                notifyListeners("location", data: entry)
            }
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
