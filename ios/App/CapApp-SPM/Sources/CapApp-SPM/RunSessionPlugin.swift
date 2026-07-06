import Foundation
import Capacitor
import CoreLocation
import CoreMotion
import AVFoundation
import UIKit

// 네이티브 러닝 세션 엔진 (build 292 Phase 1) — run-session-contract.md 구현.
//
// 기존 BackgroundLocationPlugin 은 좌표를 버퍼에 쌓아 JS 로 릴레이만 하는 구조라
// 거리 적산/필터/자동 일시정지 로직이 전부 WebView JS 에 있었고, JS suspend 시
// 상태가 멈추는 한계가 있었다 (레거시 폴백으로 공존 — 해당 파일은 수정하지 않음).
// 이 플러그인은 거리 적산·필터 파이프라인·자동 일시정지·마일스톤 음성·CMPedometer
// 융합을 전부 native 에서 수행한다. JS 가 suspend 되어도 세션이 온전히 진행되고,
// foreground 복귀/리로드 시 getSnapshot() + 'update' 이벤트로 재부착한다.
//
// 스레딩 계약:
// - CLLocationManager 는 반드시 main thread 에서 생성/호출 (build 249 hotfix 계승 —
//   백그라운드 큐에서 만들면 delegate 가 영원히 발사되지 않음. hans 2026-06-05: 42분 좌표 0개).
// - 그 외 모든 세션 상태는 내부 serial queue(stateQueue) 로 일원화. delegate 콜백은
//   main 에서 오지만 즉시 stateQueue 로 hop 해서 처리한다.
// - AVAudioSession 은 launch 시 setActive(true) 금지 계약 (build 241 회귀 — 인증 시트와
//   routing race). 발화 직전에만 lazy activate, 발화 큐가 비면 deactivate.
@objc(RunSessionPlugin)
public class RunSessionPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate, AVSpeechSynthesizerDelegate {

    public let identifier = "RunSessionPlugin"
    public let jsName = "RunSession"

    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSnapshot", returnType: CAPPluginReturnPromise),
    ]

    // MARK: - 튜닝 상수 (계약의 임계값 — 필드 튜닝 반복 대비 한곳에 모음)

    private enum Tuning {
        // --- 필터 파이프라인 ---
        /// 세션 시작 후 GPS 콜드스타트 안정화 대기. 첫 fix 는 수십 m 튀는 경우가 잦아
        /// 이 구간 좌표는 앵커 후보로만 쓰고 거리는 적산하지 않는다.
        static let warmupSec: TimeInterval = 10
        /// 워밍업 중이라도 이 정확도 이하 좌표가 오면 즉시 워밍업 종료 + 앵커 채택.
        static let warmupExitAccuracyM: Double = 25
        /// 수평 정확도가 이보다 나쁜 fix 는 거리·경로 모두 제외 (신호 판정에만 사용).
        static let accuracyGateM: Double = 35
        /// 세그먼트 속도 상한 = 2'34"/km 스프린트. 초과는 GPS 점프(outlier)로 간주.
        static let maxSegmentSpeedMps: Double = 6.5
        /// 점프 게이트: dist > max(jumpBaseM, acc1 + acc2 + jumpAccuracyPadM) → outlier.
        static let jumpBaseM: Double = 80
        static let jumpAccuracyPadM: Double = 30
        /// 도플러 속도가 유효(≥0)한데 이 미만이면 정지 상태 jitter — 거리 미적산.
        static let jitterSpeedMps: Double = 0.4

        // --- 순간 페이스 (도플러 speed EMA) ---
        static let emaAlpha: Double = 0.3
        /// EMA 속도가 이 미만이면 순간 페이스 null (정지에 가까운 잡음).
        static let instantPaceMinSpeedMps: Double = 0.5
        /// 마지막 유효 speed 갱신 후 이 시간이 지나면 순간 페이스 null.
        static let instantPaceStaleSec: TimeInterval = 5

        // --- 자동 일시정지 히스테리시스 ---
        /// build 283/284 회귀 교훈: 짧은 임계값은 신호 흔들림에 오작동. 12s/3s 히스테리시스.
        static let autoPauseSpeedMps: Double = 0.5
        static let autoPauseHoldSec: TimeInterval = 12
        static let autoResumeSpeedMps: Double = 1.4
        static let autoResumeHoldSec: TimeInterval = 3
        /// pedometer 콜백 주기(~2.5s) 감안 — 스텝 증가 흐름이 이 시간 끊기면 "걷는 중" 판정 리셋.
        static let stepStallResetSec: TimeInterval = 5

        // --- GPS 신호 등급 / gap-fill ---
        static let gpsGoodAccuracyM: Double = 20
        /// 마지막 수신 후 이 시간 무수신이면 'lost'. gap-fill 트리거 기준과 동일 (계약 §4).
        static let gpsLostSec: TimeInterval = 10
        static let gapFillGapSec: TimeInterval = 10

        // --- 이벤트 / 영속화 ---
        static let updateIntervalSec: TimeInterval = 1
        /// 1초 tick 기준 — 10 tick 마다 UserDefaults + route 파일 영속화.
        static let persistEveryTicks = 10
        /// 이 시간 이내 스냅샷이면 재시작 시 GPS 를 자동 재가동해 세션을 잇는다.
        /// 초과하면(예: 어제 강제종료한 세션) 데이터만 보존한 paused 상태로 복원 —
        /// JS 가 getSnapshot 으로 확인 후 이어가기(resume)/회수(stop) 선택.
        static let restoreMaxAgeSec: TimeInterval = 30 * 60

        // --- CLLocationManager ---
        /// JS 측 MIN_MOVE_METERS 와 일치 (BackgroundLocationPlugin 과 동일).
        static let distanceFilterM: Double = 3

        /// 이 거리 미만이면 평균 페이스 null (0 나눗셈 + 초반 비정상 페이스 방지).
        static let minDistanceForPaceM: Double = 10
    }

    private static let persistKey = "RunSessionPlugin.snapshot"
    private static let routeFileName = "run-session-route.json"

    // MARK: - 상태 (stateQueue 전용 — 다른 스레드에서 직접 접근 금지)

    private enum SessionState: String {
        case idle
        case running
        case paused      // 수동 일시정지
        case autoPaused  // 엔진 자동 일시정지
    }

    private struct VoiceTemplates {
        var milestone: String
        var autoPause: String
        var autoResume: String
    }

    private let stateQueue = DispatchQueue(label: "com.routinist.run-session.state")

    private var locationManager: CLLocationManager?
    private let pedometer = CMPedometer()
    /// requestPermissions 의 권한 프롬프트 트리거용 별도 인스턴스 — 세션용과 분리.
    private let permissionPedometer = CMPedometer()
    private let synthesizer = AVSpeechSynthesizer()
    private var pendingPermissionCall: CAPPluginCall?

    // 세션 식별/설정
    private var state: SessionState = .idle
    private var startedAtMs: Double = 0
    private var sessionStartDate = Date()
    private var localeCode = "ko"
    private var voiceEnabled = true
    private var milestoneEveryKm: Double = 1
    private var templates = VoiceTemplates(milestone: "", autoPause: "", autoResume: "")
    private var sessionVoice: AVSpeechSynthesisVoice?

    // 거리 적산 (최종 distanceM = gpsDistanceM + gapFillDistanceM — 계약 §4)
    private var gpsDistanceM: Double = 0
    private var gapFillDistanceM: Double = 0
    private var route: [[Double]] = []          // [lng, lat, tsMs]
    private var lastEmittedRouteIndex = 0
    private var lastPersistedRouteCount = 0

    // 시간 적산 (segment start 방식 — 상태 전이 시 fold)
    private var accumulatedActiveSec: Double = 0
    private var activeSegmentStart: Date?
    private var accumulatedAutoPausedSec: Double = 0
    private var autoPausedSegmentStart: Date?

    // 필터 파이프라인 상태
    private var inWarmup = true
    private var warmupStartedAt = Date()
    private var warmupCandidate: CLLocation?
    /// outlier 는 절대 앵커가 되지 않음 — 다음 정상 좌표는 이 앵커 기준으로 적산 (계약 §1).
    private var anchor: CLLocation?
    private var lastFixAt: Date?
    private var lastFixAccuracy: Double?
    private var lastAcceptedFixAt: Date?

    // 순간 페이스 (도플러 EMA)
    private var emaSpeed: Double?
    private var lastSpeedUpdateAt: Date?

    // 자동 일시정지 히스테리시스 윈도우
    private var slowSince: Date?
    private var fastSince: Date?
    // 실주행 fix (295): 세션 시작 후 "실제로 움직이기 시작" 전에는 자동정지를 무장하지 않는다.
    // 출발선 대기 + GPS 워밍업(lost) 상태에서 12초 만에 오정지되던 신고 (hans 2026-07-06).
    private var hasMovedThisSession = false

    // CMPedometer 융합
    private var pedometerActive = false
    private var pedometerDistanceM: Double = 0
    private var pedometerSteps = 0
    private var lastStepChangeAt: Date?
    private var stepIncreasingSince: Date?
    /// 마지막 앵커(=마지막 GPS 채택 시점)의 pedometer 누적 거리 — gap-fill delta 기준점.
    private var pedDistAtAnchor: Double = 0

    private var trackingStarted = false
    private var tickTimer: DispatchSourceTimer?
    private var tickCount = 0

    // MARK: - 라이프사이클

    // build 249 hotfix 계승: CLLocationManager 는 active run loop 가 있는 thread(=main) 에서
    // 초기화해야 delegate 가 발사된다. Capacitor plugin method 는 백그라운드 큐에서 호출되므로
    // 모든 manager 접근을 main 으로 강제.
    private func runOnMain(_ work: @escaping () -> Void) {
        if Thread.isMainThread {
            work()
        } else {
            DispatchQueue.main.sync(execute: work)
        }
    }

    public override func load() {
        synthesizer.delegate = self
        // 플러그인 로드 시점(main)에 미리 manager 생성 — 이후 어떤 큐에서 start 가 와도
        // manager 는 이미 main run loop 에 묶여 있다 (BackgroundLocationPlugin 패턴 재사용).
        runOnMain { [weak self] in self?.ensureManagerOnMain() }
        // 앱 재시작(OS location relaunch / 사용자 재실행) 시 진행 중이던 세션 복원 —
        // getSnapshot() 이 active=true 를 반환해 JS 가 이어가기/폐기를 선택한다 (계약 §6).
        stateQueue.async { [weak self] in self?.restorePersistedSession() }
    }

    /// main thread 전용.
    private func ensureManagerOnMain() {
        if locationManager != nil { return }
        let mgr = CLLocationManager()
        mgr.delegate = self
        mgr.desiredAccuracy = kCLLocationAccuracyBest
        mgr.activityType = .fitness
        mgr.distanceFilter = Tuning.distanceFilterM
        // trip 정지 시 OS 자동 일시정지는 fitness 트래킹에 유해 — 자동정지는 엔진이 직접 판정.
        mgr.pausesLocationUpdatesAutomatically = false
        // Info.plist UIBackgroundModes=location 과 함께 백그라운드 수신.
        mgr.allowsBackgroundLocationUpdates = true
        // 잠금화면 파란 인디케이터 — Apple 정책 준수 + 트래킹 중임을 사용자에게 명시.
        mgr.showsBackgroundLocationIndicator = true
        locationManager = mgr
    }

    // MARK: - requestPermissions

    // CAPPlugin 이 기본 requestPermissions(_:) 를 이미 선언 — override 필요.
    @objc public override func requestPermissions(_ call: CAPPluginCall) {
        runOnMain { [weak self] in
            guard let self = self else { call.reject("plugin gone"); return }
            self.ensureManagerOnMain()
            guard let mgr = self.locationManager else {
                call.reject("CLLocationManager init failed")
                return
            }
            let status = mgr.authorizationStatus
            if status == .notDetermined {
                // 프롬프트 응답을 기다렸다가 resolve — didChangeAuthorization 에서 이어짐.
                call.keepAlive = true
                self.pendingPermissionCall = call
                mgr.requestWhenInUseAuthorization()
                return
            }
            if status == .authorizedWhenInUse {
                // Always 승격 시도 (계약). 응답은 기다리지 않음 — whenInUse 로도
                // UIBackgroundModes=location + allowsBackgroundLocationUpdates 조합이면
                // foreground 에서 시작한 세션은 백그라운드에서도 계속 수신된다.
                mgr.requestAlwaysAuthorization()
            }
            self.finishPermissionCall(call, locationStatus: status)
        }
    }

    /// motion 권한 확인/프롬프트까지 끝내고 resolve. main thread 에서 호출.
    private func finishPermissionCall(_ call: CAPPluginCall, locationStatus: CLAuthorizationStatus) {
        let locationString = Self.locationPermissionString(locationStatus)
        let motionStatus = CMPedometer.authorizationStatus()
        if motionStatus == .notDetermined, CMPedometer.isStepCountingAvailable() {
            // CoreMotion 은 명시적 request API 가 없음 — 데이터를 한 번 질의하면
            // 시스템이 NSMotionUsageDescription 프롬프트를 띄운다. 응답 후 상태 재확인.
            permissionPedometer.queryPedometerData(from: Date().addingTimeInterval(-60), to: Date()) { _, _ in
                let after = CMPedometer.authorizationStatus()
                call.resolve([
                    "location": locationString,
                    "motion": Self.motionPermissionString(after),
                ])
            }
        } else {
            call.resolve([
                "location": locationString,
                "motion": Self.motionPermissionString(motionStatus),
            ])
        }
    }

    private static func locationPermissionString(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .authorizedAlways, .authorizedWhenInUse: return "granted"
        case .denied, .restricted: return "denied"
        case .notDetermined: return "prompt"
        @unknown default: return "prompt"
        }
    }

    private static func motionPermissionString(_ status: CMAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "granted"
        case .denied, .restricted: return "denied"
        case .notDetermined: return "undetermined"
        @unknown default: return "undetermined"
        }
    }

    // MARK: - start / pause / resume / stop / getSnapshot

    @objc func start(_ call: CAPPluginCall) {
        let locale = call.getString("locale") ?? "ko"
        let voice = call.getBool("voiceEnabled") ?? true
        let everyKm = call.getDouble("milestoneEveryKm") ?? 1
        let templatesObj = call.getObject("voiceTemplates") ?? [:]
        let isKo = locale.lowercased().hasPrefix("ko")
        let parsedTemplates = VoiceTemplates(
            milestone: (templatesObj["milestone"] as? String)
                ?? (isKo ? "{km}킬로미터. 평균 페이스 {pace}" : "{km} kilometers. Average pace {pace}"),
            autoPause: (templatesObj["autoPause"] as? String)
                ?? (isKo ? "자동 일시정지" : "Auto paused"),
            autoResume: (templatesObj["autoResume"] as? String)
                ?? (isKo ? "다시 시작합니다" : "Resuming")
        )

        stateQueue.async { [weak self] in
            guard let self = self else { call.reject("plugin gone"); return }
            guard self.state == .idle else {
                // 복원된 세션 포함 — JS 가 먼저 stop() 으로 회수해야 새 세션 시작 가능 (계약).
                call.reject("session-already-active")
                return
            }
            let now = Date()
            self.resetSessionState()
            self.state = .running
            self.sessionStartDate = now
            self.startedAtMs = now.timeIntervalSince1970 * 1000.0
            self.localeCode = locale
            self.voiceEnabled = voice
            self.milestoneEveryKm = everyKm > 0 ? everyKm : 1
            self.templates = parsedTemplates
            self.activeSegmentStart = now
            self.inWarmup = true
            self.warmupStartedAt = now
            // 첫 fix 전에도 'lost' 판정이 시작 시각 기준으로 동작하도록 초기화.
            self.lastFixAt = now
            self.lastStepChangeAt = now
            self.sessionVoice = Self.selectVoice(locale: locale)
            self.startTrackingIfNeeded()
            self.persist(now: now)
            call.resolve(["ok": true, "startedAtMs": self.startedAtMs])
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        stateQueue.async { [weak self] in
            guard let self = self else { call.reject("plugin gone"); return }
            guard self.state != .idle else { call.reject("no-active-session"); return }
            let now = Date()
            if self.state == .running || self.state == .autoPaused {
                self.foldTimeSegments(now: now)
                self.state = .paused
                self.resetAutoPauseWindows()
                self.persist(now: now)
            }
            call.resolve(["ok": true])
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        stateQueue.async { [weak self] in
            guard let self = self else { call.reject("plugin gone"); return }
            guard self.state != .idle else { call.reject("no-active-session"); return }
            let now = Date()
            if self.state != .running {
                self.foldTimeSegments(now: now)   // autoPaused 시간도 여기서 fold — resume 은 autoPaused 도 해제 (계약)
                self.state = .running
                self.activeSegmentStart = now
                self.resetAutoPauseWindows()
                // 리뷰 H1: pause 중 GPS lost 상태로 걸어다닌 거리가 (pedDistAtAnchor 미동기화)
                // 재개 직후 gap-fill 로 통째 가산되던 버그 — 재개 시점 걸음 누적치로 앵커 재동기화.
                self.pedDistAtAnchor = self.pedometerDistanceM
                // stale 복원 세션(트래킹 미가동) 이어가기 대응 — 이미 가동 중이면 no-op.
                self.startTrackingIfNeeded()
                self.persist(now: now)
            }
            call.resolve(["ok": true])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        stateQueue.async { [weak self] in
            guard let self = self else { call.reject("plugin gone"); return }
            guard self.state != .idle else { call.reject("no-active-session"); return }
            let now = Date()

            // 마지막 GPS 공백 구간 잔여 gap-fill (터널/실내에서 종료한 경우).
            if self.state == .running, self.pedometerActive,
               let last = self.lastAcceptedFixAt,
               now.timeIntervalSince(last) >= Tuning.gapFillGapSec {
                let delta = self.pedometerDistanceM - self.pedDistAtAnchor
                if delta > 0 {
                    self.gapFillDistanceM += delta
                    self.pedDistAtAnchor = self.pedometerDistanceM
                }
            }

            self.foldTimeSegments(now: now)
            let totalDistance = self.gpsDistanceM + self.gapFillDistanceM
            let activeSec = self.accumulatedActiveSec
            let avgPace = Self.paceSecPerKm(distanceM: totalDistance, seconds: activeSec)
            let summary: [String: Any] = [
                "startedAtMs": self.startedAtMs,
                "endedAtMs": now.timeIntervalSince1970 * 1000.0,
                "distanceM": totalDistance,
                "gpsDistanceM": self.gpsDistanceM,
                "pedometerDistanceM": self.pedometerDistanceM,
                "activeSec": activeSec.rounded(),
                "elapsedSec": ((now.timeIntervalSince1970 * 1000.0 - self.startedAtMs) / 1000.0).rounded(),
                "autoPausedSec": self.accumulatedAutoPausedSec.rounded(),
                "avgPaceSecPerKm": avgPace.map { $0 as Any } ?? NSNull(),
                "route": self.route,
            ]
            self.stopTracking()
            self.clearPersisted()
            self.resetSessionState()
            call.resolve(summary)
        }
    }

    @objc func getSnapshot(_ call: CAPPluginCall) {
        stateQueue.async { [weak self] in
            guard let self = self else { call.reject("plugin gone"); return }
            guard self.state != .idle else {
                call.resolve(["active": false])
                return
            }
            var data = self.updatePayload(now: Date())
            data["active"] = true
            data["startedAtMs"] = self.startedAtMs
            data["routeSoFar"] = self.route
            // 재부착 시점 기준으로 delta 커서 리셋 — 이후 update 이벤트의 newCoords 와
            // routeSoFar 가 중복되지 않도록.
            self.lastEmittedRouteIndex = self.route.count
            data["newCoords"] = [[Double]]()
            call.resolve(data)
        }
    }

    // MARK: - 트래킹 시작/종료

    /// stateQueue 에서 호출. CLLocationManager 조작만 main 으로 hop.
    private func startTrackingIfNeeded() {
        guard !trackingStarted else { return }
        trackingStarted = true
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.ensureManagerOnMain()
            guard let mgr = self.locationManager else { return }
            let status = mgr.authorizationStatus
            if status == .notDetermined || status == .authorizedWhenInUse {
                // 백그라운드 세션 지속을 위한 Always 승격 시도 (BackgroundLocationPlugin 흐름과 동일).
                mgr.requestAlwaysAuthorization()
            }
            mgr.startUpdatingLocation()
        }
        startPedometer()
        startTickTimer()
    }

    /// stateQueue 에서 호출.
    private func stopTracking() {
        trackingStarted = false
        tickTimer?.cancel()
        tickTimer = nil
        if pedometerActive {
            pedometer.stopUpdates()
            pedometerActive = false
        }
        DispatchQueue.main.async { [weak self] in
            self?.locationManager?.stopUpdatingLocation()
        }
    }

    private func startPedometer() {
        guard CMPedometer.isStepCountingAvailable() || CMPedometer.isDistanceAvailable() else {
            pedometerActive = false
            return
        }
        // 리뷰 M1: motion 권한 거부 시 pedometerActive 가 true 로 남으면 step-stall 기반
        // 2차 자동정지 판정이 "달리는 중 오정지" 를 만든다 — 거부면 융합·판정 모두 비활성.
        if CMPedometer.authorizationStatus() == .denied || CMPedometer.authorizationStatus() == .restricted {
            pedometerActive = false
            return
        }
        pedometerActive = true
        // 세션 시작 시각부터 누적 질의 — 복원 시에도 원래 시작 시각을 넘기면
        // 죽어 있던 구간의 걸음/거리가 자동으로 누적치에 포함된다 (CoreMotion 이 기록 보관).
        let from = sessionStartDate
        pedometer.startUpdates(from: from) { [weak self] data, _ in
            guard let self = self, let data = data else { return }
            self.stateQueue.async {
                guard self.state != .idle else { return }
                let steps = data.numberOfSteps.intValue
                if steps > self.pedometerSteps {
                    self.pedometerSteps = steps
                    self.lastStepChangeAt = Date()
                    // GPS lost 상태의 자동 재개 판정용 — 스텝이 "증가하기 시작한" 시점.
                    if self.stepIncreasingSince == nil {
                        self.stepIncreasingSince = Date()
                        self.hasMovedThisSession = true
                    }
                }
                if let dist = data.distance?.doubleValue, dist > self.pedometerDistanceM {
                    self.pedometerDistanceM = dist
                }
            }
        }
    }

    private func startTickTimer() {
        tickTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: stateQueue)
        timer.schedule(deadline: .now() + Tuning.updateIntervalSec, repeating: Tuning.updateIntervalSec)
        timer.setEventHandler { [weak self] in self?.tick() }
        timer.resume()
        tickTimer = timer
    }

    // MARK: - 1초 tick (stateQueue)

    private func tick() {
        guard state != .idle else { return }
        let now = Date()
        tickCount += 1

        // 스텝 증가 흐름 단절 감지 — pedometer 콜백이 끊기면 "걷는 중" 판정 리셋.
        if let lastChange = lastStepChangeAt,
           now.timeIntervalSince(lastChange) > Tuning.stepStallResetSec {
            stepIncreasingSince = nil
        }

        evaluateAutoPause(now: now)

        // gap-fill: GPS 유효 좌표 공백 10s+ 구간을 pedometer 거리 delta 로 진행형으로 채움 —
        // 터널/고층빌딩 사이에서도 distanceM 이 실시간으로 자란다 (계약 §4).
        if state == .running, pedometerActive,
           let last = lastAcceptedFixAt,
           now.timeIntervalSince(last) >= Tuning.gapFillGapSec {
            let delta = pedometerDistanceM - pedDistAtAnchor
            if delta > 0 {
                gapFillDistanceM += delta
                pedDistAtAnchor = pedometerDistanceM
                checkMilestones(now: now)
            }
        }

        if tickCount % Tuning.persistEveryTicks == 0 {
            persist(now: now)
        }

        // update 이벤트는 foreground 에서만 (계약 — 백그라운드에선 native 적산만).
        // 가시성 판정은 UIApplication.applicationState 를 main thread 에서 읽는다.
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let isForeground = UIApplication.shared.applicationState == .active
            guard isForeground else { return }
            self.stateQueue.async {
                guard self.state != .idle else { return }
                self.emitUpdate(now: Date())
            }
        }
    }

    private func emitUpdate(now: Date) {
        var data = updatePayload(now: now)
        let newCoords: [[Double]]
        if lastEmittedRouteIndex < route.count {
            newCoords = Array(route[lastEmittedRouteIndex...])
        } else {
            newCoords = []
        }
        lastEmittedRouteIndex = route.count
        data["newCoords"] = newCoords
        notifyListeners("update", data: data)
    }

    /// update 이벤트/getSnapshot 공통 필드 (newCoords 제외).
    private func updatePayload(now: Date) -> [String: Any] {
        let totalDistance = gpsDistanceM + gapFillDistanceM
        let activeSec = currentActiveSec(now: now)
        return [
            "state": state.rawValue,
            "distanceM": totalDistance,
            "activeSec": activeSec.rounded(),
            "instantPaceSecPerKm": instantPace(now: now).map { $0 as Any } ?? NSNull(),
            "avgPaceSecPerKm": Self.paceSecPerKm(distanceM: totalDistance, seconds: activeSec).map { $0 as Any } ?? NSNull(),
            "gpsSignal": gpsSignalString(now: now),
            "pedometerDistanceM": pedometerDistanceM,
        ]
    }

    private func gpsSignalString(now: Date) -> String {
        guard let last = lastFixAt, now.timeIntervalSince(last) < Tuning.gpsLostSec else {
            return "lost"
        }
        guard let acc = lastFixAccuracy else { return "weak" }
        return acc <= Tuning.gpsGoodAccuracyM ? "good" : "weak"
    }

    private func instantPace(now: Date) -> Double? {
        guard let ema = emaSpeed,
              let updated = lastSpeedUpdateAt,
              now.timeIntervalSince(updated) <= Tuning.instantPaceStaleSec,
              ema >= Tuning.instantPaceMinSpeedMps else { return nil }
        return 1000.0 / ema
    }

    private static func paceSecPerKm(distanceM: Double, seconds: Double) -> Double? {
        guard distanceM >= Tuning.minDistanceForPaceM, seconds > 0 else { return nil }
        return seconds / (distanceM / 1000.0)
    }

    private func currentActiveSec(now: Date) -> Double {
        var total = accumulatedActiveSec
        if state == .running, let start = activeSegmentStart {
            total += now.timeIntervalSince(start)
        }
        return total
    }

    // MARK: - 위치 필터 파이프라인 (stateQueue)

    // delegate 는 main 에서 발사 (manager 가 main 에서 init 됨) — 즉시 stateQueue 로 hop.
    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        stateQueue.async { [weak self] in
            self?.processLocations(locations)
        }
    }

    private func processLocations(_ locations: [CLLocation]) {
        guard state != .idle else { return }
        for loc in locations {
            let acc = loc.horizontalAccuracy
            if acc < 0 { continue }   // invalid fix

            // 신호 등급용 — accuracy 게이트에 걸려도 "수신 자체" 는 기록 (lost 판정 기준).
            lastFixAt = Date()
            lastFixAccuracy = acc

            // 도플러 speed 처리: 순간 페이스 EMA + 자동 일시정지 히스테리시스 윈도우.
            let doppler = loc.speed
            if doppler >= 0 {
                if let prev = emaSpeed {
                    emaSpeed = Tuning.emaAlpha * doppler + (1 - Tuning.emaAlpha) * prev
                } else {
                    emaSpeed = doppler
                }
                lastSpeedUpdateAt = Date()
                if doppler < Tuning.autoPauseSpeedMps {
                    if slowSince == nil { slowSince = Date() }
                    fastSince = nil
                } else if doppler > Tuning.autoResumeSpeedMps {
                    if fastSince == nil { fastSince = Date() }
                    slowSince = nil
                    hasMovedThisSession = true
                } else {
                    // 중간 대역 — 히스테리시스: pause/resume 어느 쪽 카운트도 하지 않음.
                    slowSince = nil
                    fastSince = nil
                }
            }

            // accuracy 게이트: 거리·경로 모두 제외 (계약 §1).
            if acc > Tuning.accuracyGateM { continue }

            // warmup: 콜드스타트 좌표는 앵커 후보로만.
            if inWarmup {
                if acc <= Tuning.warmupExitAccuracyM {
                    // 충분히 정확한 첫 좌표 — 워밍업 조기 종료, 이 좌표가 시작 앵커 (거리 0).
                    inWarmup = false
                    adoptAnchor(loc, appendToRoute: state == .running)
                    continue
                }
                if Date().timeIntervalSince(warmupStartedAt) < Tuning.warmupSec {
                    warmupCandidate = loc   // 최신 후보 갱신만
                    continue
                }
                // 워밍업 타임아웃 — 마지막 후보를 시작 앵커로 채택하고 현재 좌표는 정상 처리.
                inWarmup = false
                if let candidate = warmupCandidate {
                    // 후보는 정확도가 낮을 수 있어 경로에는 넣지 않음 (폴리라인 오염 방지).
                    adoptAnchor(candidate, appendToRoute: false)
                }
            }

            guard let currentAnchor = anchor else {
                adoptAnchor(loc, appendToRoute: state == .running)
                continue
            }

            let dt = loc.timestamp.timeIntervalSince(currentAnchor.timestamp)
            if dt <= 0 { continue }   // 중복/역행 timestamp
            let dist = loc.distance(from: currentAnchor)

            // GPS 공백(10s+) 후 복귀한 좌표: 속도/점프 게이트가 무의미한 구간이므로
            // 세그먼트 거리 대신 pedometer delta 로 채우고 재앵커 (터널 출구에서 앵커가
            // 영영 복구 안 되는 문제 방지 — outlier 처리하면 lastGoodAnchor 규칙에 갇힘).
            if dt >= Tuning.gapFillGapSec {
                if state == .running, pedometerActive {
                    let delta = pedometerDistanceM - pedDistAtAnchor
                    if delta > 0 { gapFillDistanceM += delta }
                }
                adoptAnchor(loc, appendToRoute: state == .running)
                checkMilestones(now: Date())
                continue
            }

            // 속도 게이트: 2'34"/km 초과 세그먼트는 GPS 점프 — outlier 는 앵커 미승격.
            if dist / dt > Tuning.maxSegmentSpeedMps { continue }

            // 점프 게이트: 정확도 합산 여유를 넘는 순간이동 — outlier.
            if dist > max(Tuning.jumpBaseM, acc + currentAnchor.horizontalAccuracy + Tuning.jumpAccuracyPadM) {
                continue
            }

            // 정지 jitter: 도플러가 "거의 정지" 라고 말하면 위치 요동은 거리로 치지 않음.
            // 단 앵커는 따라가게 해서 (a) jitter 누적 차단 (b) 재출발 시 현재 위치 기준 적산.
            if doppler >= 0 && doppler < Tuning.jitterSpeedMps {
                adoptAnchor(loc, appendToRoute: false)
                continue
            }

            if state == .running {
                gpsDistanceM += dist
                adoptAnchor(loc, appendToRoute: true)
                checkMilestones(now: Date())
            } else {
                // paused/autoPaused: 거리·경로 미적산. 앵커만 현재 위치로 추종해서
                // 일시정지 중 이동분이 재개 직후 거리로 튀는 것을 방지.
                adoptAnchor(loc, appendToRoute: false)
            }
        }
    }

    private func adoptAnchor(_ loc: CLLocation, appendToRoute: Bool) {
        anchor = loc
        lastAcceptedFixAt = Date()
        // gap-fill delta 기준점 동기화 — GPS 로 적산한 구간을 pedometer 로 이중 계상하지 않도록.
        pedDistAtAnchor = pedometerDistanceM
        if appendToRoute {
            route.append([
                loc.coordinate.longitude,
                loc.coordinate.latitude,
                loc.timestamp.timeIntervalSince1970 * 1000.0,
            ])
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // 세션은 유지 — kCLErrorLocationUnknown 등은 일시적. lost 판정이 신호 상태를 표현.
        NSLog("[RunSession] location error: \(error.localizedDescription)")
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        // requestPermissions 프롬프트 응답 대기 중이면 여기서 이어서 resolve (main thread).
        guard let call = pendingPermissionCall else { return }
        let status = manager.authorizationStatus
        guard status != .notDetermined else { return }
        pendingPermissionCall = nil
        if status == .authorizedWhenInUse {
            // whenInUse 승인 직후 Always 승격 시도 (계약 — 응답은 기다리지 않음).
            manager.requestAlwaysAuthorization()
        }
        finishPermissionCall(call, locationStatus: status)
    }

    // MARK: - 자동 일시정지 (stateQueue)

    private func evaluateAutoPause(now: Date) {
        switch state {
        case .running:
            // 첫 움직임 전에는 자동정지 미무장 — 출발 대기/워밍업 오정지 차단.
            guard hasMovedThisSession else { return }
            var shouldPause = false
            // 1차: 도플러 speed < 0.5 m/s 가 12초 지속.
            if let slow = slowSince, now.timeIntervalSince(slow) >= Tuning.autoPauseHoldSec {
                shouldPause = true
            }
            // 2차: GPS lost 상태에선 pedometer 스텝 무변화 12초로 대체 판정 (계약 §3).
            if !shouldPause, pedometerActive, gpsSignalString(now: now) == "lost",
               let lastStep = lastStepChangeAt,
               now.timeIntervalSince(lastStep) >= Tuning.autoPauseHoldSec {
                shouldPause = true
            }
            if shouldPause { enterAutoPause(now: now) }

        case .autoPaused:
            var shouldResume = false
            // 1차: speed > 1.4 m/s 가 3초 지속.
            if let fast = fastSince, now.timeIntervalSince(fast) >= Tuning.autoResumeHoldSec {
                shouldResume = true
            }
            // 2차: GPS lost 상태에선 스텝 증가 흐름 3초로 대체 판정.
            if !shouldResume, pedometerActive, gpsSignalString(now: now) == "lost",
               let increasing = stepIncreasingSince,
               now.timeIntervalSince(increasing) >= Tuning.autoResumeHoldSec {
                shouldResume = true
            }
            if shouldResume { exitAutoPause(now: now) }

        default:
            break   // 수동 paused 는 자동 재개하지 않음
        }
    }

    private func enterAutoPause(now: Date) {
        foldTimeSegments(now: now)
        state = .autoPaused
        autoPausedSegmentStart = now
        resetAutoPauseWindows()
        speak(templates.autoPause)
        persist(now: now)
    }

    private func exitAutoPause(now: Date) {
        foldTimeSegments(now: now)
        state = .running
        activeSegmentStart = now
        resetAutoPauseWindows()
        // 리뷰 H1 동계열: 자동정지 중 걸은 거리의 재개 직후 gap-fill 가산 차단
        pedDistAtAnchor = pedometerDistanceM
        speak(templates.autoResume)
        persist(now: now)
    }

    private func resetAutoPauseWindows() {
        slowSince = nil
        fastSince = nil
        stepIncreasingSince = nil
    }

    /// 현재 state 의 진행 중 segment 를 누적치에 fold. 상태 전이 직전에 호출.
    private func foldTimeSegments(now: Date) {
        switch state {
        case .running:
            if let start = activeSegmentStart {
                accumulatedActiveSec += now.timeIntervalSince(start)
            }
            activeSegmentStart = nil
        case .autoPaused:
            if let start = autoPausedSegmentStart {
                accumulatedAutoPausedSec += now.timeIntervalSince(start)
            }
            autoPausedSegmentStart = nil
        default:
            break
        }
    }

    // MARK: - 마일스톤 + 음성 (stateQueue → 발화는 main)

    private var milestonesFired = 0

    private func checkMilestones(now: Date) {
        let everyM = milestoneEveryKm * 1000.0
        guard everyM > 0 else { return }
        let totalDistance = gpsDistanceM + gapFillDistanceM
        while totalDistance >= Double(milestonesFired + 1) * everyM {
            milestonesFired += 1
            let km = Double(milestonesFired) * milestoneEveryKm
            let avgPace = Self.paceSecPerKm(distanceM: totalDistance, seconds: currentActiveSec(now: now))
            notifyListeners("milestone", data: [
                "km": km,
                "avgPaceSecPerKm": avgPace.map { $0 as Any } ?? NSNull(),
            ])
            let kmText = km == km.rounded() ? String(Int(km)) : String(format: "%.1f", km)
            let paceText = avgPace.map { Self.formatPaceForSpeech($0, locale: localeCode) } ?? ""
            let text = templates.milestone
                .replacingOccurrences(of: "{km}", with: kmText)
                .replacingOccurrences(of: "{pace}", with: paceText)
            speak(text)
        }
    }

    /// "5분 30초" / "5 minutes 30 seconds" — TTS 가 자연스럽게 읽는 형태 (계약).
    private static func formatPaceForSpeech(_ secPerKm: Double, locale: String) -> String {
        let total = Int(secPerKm.rounded())
        let minutes = total / 60
        let seconds = total % 60
        if locale.lowercased().hasPrefix("ko") {
            if seconds == 0 { return "\(minutes)분" }
            if minutes == 0 { return "\(seconds)초" }
            return "\(minutes)분 \(seconds)초"
        }
        let minUnit = minutes == 1 ? "minute" : "minutes"
        let secUnit = seconds == 1 ? "second" : "seconds"
        if seconds == 0 { return "\(minutes) \(minUnit)" }
        if minutes == 0 { return "\(seconds) \(secUnit)" }
        return "\(minutes) \(minUnit) \(seconds) \(secUnit)"
    }

    /// locale prefix 매칭 voice 중 quality 최고(premium > enhanced > default) 선택.
    /// rawValue 비교로 정렬 — .premium 심볼은 iOS 16+ 라 직접 참조하지 않는다 (min target iOS 15).
    private static func selectVoice(locale: String) -> AVSpeechSynthesisVoice? {
        let prefix = locale.lowercased().hasPrefix("ko") ? "ko" : "en"
        let candidates = AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.lowercased().hasPrefix(prefix) }
        if let best = candidates.max(by: { $0.quality.rawValue < $1.quality.rawValue }) {
            return best
        }
        return AVSpeechSynthesisVoice(language: prefix == "ko" ? "ko-KR" : "en-US")
    }

    private func speak(_ text: String) {
        guard voiceEnabled, !text.isEmpty else { return }
        let voice = sessionVoice
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            // build 241 계약: launch 시점 setActive 금지 — 발화 직전에만 lazy activate.
            // 카테고리(.playback + .spokenAudio + .duckOthers)는 AppDelegate 가 이미 등록.
            do {
                // 실주행 fix (295): WKWebView (카운트다운 beep 의 WebAudio) 가 오디오 세션
                // 카테고리를 바꿔놓으면 ambient + 무음스위치 조합에서 TTS 가 통째로 무음이 된다.
                // 발화 직전마다 카테고리를 재선점 — .playback 은 무음 스위치를 무시한다.
                try AVAudioSession.sharedInstance().setCategory(
                    .playback, mode: .spokenAudio, options: [.duckOthers, .mixWithOthers])
                try AVAudioSession.sharedInstance().setActive(true)
            } catch {
                NSLog("[RunSession] AVAudioSession activate failed: \(error)")
            }
            let utterance = AVSpeechUtterance(string: text)
            utterance.voice = voice
            NSLog("[RunSession] speak: voice=%@ q=%d len=%d",
                  voice?.identifier ?? "system-default", voice?.quality.rawValue ?? -1, text.count)
            // rate/pitch 는 기본값 유지 (계약 — 변조 금지).
            self.synthesizer.speak(utterance)
        }
    }

    private func deactivateAudioSessionIfIdle() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, !self.synthesizer.isSpeaking else { return }
            do {
                // 다른 앱(음악 등) 오디오 ducking 원복 — 발화 큐가 빌 때만.
                try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
            } catch {
                NSLog("[RunSession] AVAudioSession deactivate failed: \(error)")
            }
        }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        deactivateAudioSessionIfIdle()
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        deactivateAudioSessionIfIdle()
    }

    // MARK: - 영속화 / 복원 (stateQueue)

    private static var routeFileURL: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent(routeFileName)
    }

    /// 10초마다 + 상태 전이 시 호출. 앱 강제종료/OS kill 후에도 세션을 복원하기 위함.
    /// route 는 대용량이라 UserDefaults 금지 (계약) — Documents 의 JSON 파일로 분리.
    private func persist(now: Date) {
        guard state != .idle else { return }
        // 진행 중 segment 를 persist 시점까지 fold 한 값으로 저장 — 복원 시 죽어 있던
        // 시간이 activeSec 에 계상되지 않는다 (최대 persist 주기 10초 손실).
        let snapshot: [String: Any] = [
            "startedAtMs": startedAtMs,
            "state": state.rawValue,
            "gpsDistanceM": gpsDistanceM,
            "gapFillDistanceM": gapFillDistanceM,
            "activeSec": currentActiveSec(now: now),
            "autoPausedSec": accumulatedAutoPausedSec
                + (state == .autoPaused ? autoPausedSegmentStart.map { now.timeIntervalSince($0) } ?? 0 : 0),
            "milestonesFired": milestonesFired,
            "milestoneEveryKm": milestoneEveryKm,
            "locale": localeCode,
            "voiceEnabled": voiceEnabled,
            "templateMilestone": templates.milestone,
            "templateAutoPause": templates.autoPause,
            "templateAutoResume": templates.autoResume,
            "pedometerDistanceM": pedometerDistanceM,
            "persistedAtMs": now.timeIntervalSince1970 * 1000.0,
        ]
        UserDefaults.standard.set(snapshot, forKey: Self.persistKey)
        if route.count != lastPersistedRouteCount {
            lastPersistedRouteCount = route.count
            if let data = try? JSONSerialization.data(withJSONObject: route) {
                try? data.write(to: Self.routeFileURL, options: .atomic)
            }
        }
    }

    private func clearPersisted() {
        UserDefaults.standard.removeObject(forKey: Self.persistKey)
        try? FileManager.default.removeItem(at: Self.routeFileURL)
        lastPersistedRouteCount = 0
    }

    /// 앱 (재)시작 시 진행 중이던 세션 복원. load() 에서 1회 호출 (stateQueue).
    private func restorePersistedSession() {
        guard state == .idle,
              let snapshot = UserDefaults.standard.dictionary(forKey: Self.persistKey),
              let savedStartMs = snapshot["startedAtMs"] as? Double,
              let persistedAtMs = snapshot["persistedAtMs"] as? Double else { return }

        let now = Date()
        startedAtMs = savedStartMs
        sessionStartDate = Date(timeIntervalSince1970: savedStartMs / 1000.0)
        gpsDistanceM = snapshot["gpsDistanceM"] as? Double ?? 0
        gapFillDistanceM = snapshot["gapFillDistanceM"] as? Double ?? 0
        accumulatedActiveSec = snapshot["activeSec"] as? Double ?? 0
        accumulatedAutoPausedSec = snapshot["autoPausedSec"] as? Double ?? 0
        milestonesFired = snapshot["milestonesFired"] as? Int ?? 0
        milestoneEveryKm = snapshot["milestoneEveryKm"] as? Double ?? 1
        localeCode = snapshot["locale"] as? String ?? "ko"
        voiceEnabled = snapshot["voiceEnabled"] as? Bool ?? true
        templates = VoiceTemplates(
            milestone: snapshot["templateMilestone"] as? String ?? "",
            autoPause: snapshot["templateAutoPause"] as? String ?? "",
            autoResume: snapshot["templateAutoResume"] as? String ?? ""
        )
        pedometerDistanceM = snapshot["pedometerDistanceM"] as? Double ?? 0
        sessionVoice = Self.selectVoice(locale: localeCode)

        if let data = try? Data(contentsOf: Self.routeFileURL),
           let saved = try? JSONSerialization.jsonObject(with: data) as? [[Double]] {
            route = saved
        }
        lastEmittedRouteIndex = route.count
        lastPersistedRouteCount = route.count

        let ageSec = now.timeIntervalSince1970 - persistedAtMs / 1000.0
        let savedState = SessionState(rawValue: snapshot["state"] as? String ?? "") ?? .paused

        if ageSec <= Tuning.restoreMaxAgeSec {
            // 신선한 세션 — 그대로 이어서 트래킹 재가동 (OS location relaunch / 재실행 직후).
            state = savedState == .idle ? .paused : savedState
            if state == .running { activeSegmentStart = now }
            if state == .autoPaused { autoPausedSegmentStart = now }
            // GPS 는 재획득까지 워밍업부터 다시 (재시작 첫 fix 도 튈 수 있음).
            inWarmup = true
            warmupStartedAt = now
            lastFixAt = now
            lastStepChangeAt = now
            // 죽어 있던 구간은 GPS 공백으로 취급 → tick 의 gap-fill 이 pedometer 누적으로
            // 회수한다 (startPedometer 가 원래 시작 시각부터 재질의하므로 누적치가 이어짐).
            lastAcceptedFixAt = Date(timeIntervalSince1970: persistedAtMs / 1000.0)
            pedDistAtAnchor = pedometerDistanceM
            hasMovedThisSession = true   // 복원 세션 = 이미 달리던 세션 — 자동정지 즉시 무장
            startTrackingIfNeeded()
        } else {
            // 오래된 세션(예: 어제 강제종료) — GPS 자동 재가동 없이 paused 로만 보존.
            // JS 가 getSnapshot 으로 발견 후 stop() 회수 또는 resume() 재개를 선택.
            state = .paused
        }
        NSLog("[RunSession] restored session (age %.0fs, state %@, %.0fm)", ageSec, state.rawValue, gpsDistanceM + gapFillDistanceM)
    }

    /// 세션 종료/시작 전 전체 필드 초기화.
    private func resetSessionState() {
        hasMovedThisSession = false
        state = .idle
        startedAtMs = 0
        gpsDistanceM = 0
        gapFillDistanceM = 0
        route = []
        lastEmittedRouteIndex = 0
        lastPersistedRouteCount = 0
        accumulatedActiveSec = 0
        activeSegmentStart = nil
        accumulatedAutoPausedSec = 0
        autoPausedSegmentStart = nil
        inWarmup = true
        warmupCandidate = nil
        anchor = nil
        lastFixAt = nil
        lastFixAccuracy = nil
        lastAcceptedFixAt = nil
        emaSpeed = nil
        lastSpeedUpdateAt = nil
        slowSince = nil
        fastSince = nil
        pedometerDistanceM = 0
        pedometerSteps = 0
        lastStepChangeAt = nil
        stepIncreasingSince = nil
        pedDistAtAnchor = 0
        milestonesFired = 0
        tickCount = 0
    }
}
