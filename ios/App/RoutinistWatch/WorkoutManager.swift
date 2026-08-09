// Routinist Watch — 러닝 워크아웃 엔진 (Phase 1, 2026-07-26).
// HKWorkoutSession + HKLiveWorkoutBuilder: 시작/일시정지/종료, 거리·심박·페이스 실시간.
// 종료 시 HealthKit 에 저장 → iPhone 앱의 기존 Health sync 가 자동으로 가져간다 (서버 작업 0).

import Foundation
import HealthKit
import WatchKit
import AVFoundation
import CoreMotion
import CoreLocation
import WatchConnectivity

@MainActor
final class WorkoutManager: NSObject, ObservableObject {
    static let shared = WorkoutManager()

    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    // ── 음성 (v6~7, 2026-07-26 hans) ──
    // 워치 자체 TTS — 워치에 페어링된 이어폰 또는 워치 스피커로 재생.
    private let speech = AVSpeechSynthesizer()
    private var lastAnnouncedKm = 0
    // 직전 km 구간 페이스용 앵커 (v7)
    private var lastKmElapsedSec: TimeInterval = 0
    @Published var lastSplitPaceSecPerKm: Double?

    private static var audioConfigured = false

    // v19: 릴레이가 "안 들리는 성공" 이 되지 않게 — 폰이 spoken:true 라고 답할 때만 릴레이 인정.
    // 폰에 이어폰이 없거나(주머니 스피커) 세션 활성화 실패면 워치가 직접 말한다.
    // 한 번 불가 판정이면 잠시 릴레이를 쉬어 카운트다운 등 연속 발화의 왕복 지연 제거.
    private var relayDisabledUntil = Date.distantPast

    func speak(_ text: String) {
        // v13 (hans: "이어폰에서 나게"): iPhone 이 접근 가능하면 폰에 릴레이 —
        // 음악 듣는 그 이어폰 (폰에 연결된) 에서 발화 + 음악 덕킹.
        // ⚠️ v18 무음 진범: reply 없는 sendMessage 는 "전달됨 = 성공" — 폰이 백그라운드라
        // 소리를 못 내거나 주머니 스피커로 나가도 워치 폴백이 영영 안 탔다.
        if Date() >= relayDisabledUntil, WCSession.isSupported(), WCSession.default.isReachable {
            WCSession.default.sendMessage(
                ["voice": text],
                replyHandler: { [weak self] reply in
                    Task { @MainActor in
                        guard let self else { return }
                        if (reply["spoken"] as? Bool) != true {
                            // 폰이 못 말함 (이어폰 없음 등) → 워치가 직접 + 3분간 릴레이 휴식
                            self.relayDisabledUntil = Date().addingTimeInterval(180)
                            self.speakLocally(text)
                        }
                    }
                },
                errorHandler: { [weak self] _ in
                    Task { @MainActor in
                        self?.relayDisabledUntil = Date().addingTimeInterval(60)
                        self?.speakLocally(text)
                    }
                }
            )
            return
        }
        speakLocally(text)
    }

    private func speakLocally(_ text: String) {
        // v10 fix: watchOS 는 AVAudioSession .playback 활성화 없이 TTS 스피커 무음.
        activateAudioSession()
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "ko-KR")
        // 워치 스피커는 출력이 작아 0.9 — 이어폰 연결 시에도 과하지 않은 선
        u.volume = 0.9
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 0.95
        speech.speak(u)
    }

    // ── GPS 경로 (v13) — HKWorkoutRouteBuilder: 워치 러닝에도 지도가 생긴다 ──
    // 폰 앱의 기존 경로 동기화 (WorkoutRoute 플러그인) 가 HKWorkoutRoute 를 읽으므로
    // 여기서 route 를 저장하면 지도·지역 라벨이 자동으로 붙음.
    private let locationManager = CLLocationManager()
    private var routeBuilder: HKWorkoutRouteBuilder?
    // v15: 위치 동의를 카운트다운 전에 처리 — 응답 대기 중임을 표시
    private var pendingCountdownAfterLocationAuth = false

    private func startLocationUpdates() {
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.activityType = .fitness
        routeBuilder = HKWorkoutRouteBuilder(healthStore: healthStore, device: nil)
        // v15 crash fix (hans 실기기): 권한 없이 allowsBackgroundLocationUpdates=true 를 켜면
        // NSInvalidArgumentException 으로 즉사 (Info.plist location 모드와 세트).
        // 거부 상태면 경로 없이 러닝 진행 — 크래시보다 훨씬 낫다.
        let auth = locationManager.authorizationStatus
        guard auth == .authorizedWhenInUse || auth == .authorizedAlways else { return }
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.startUpdatingLocation()
    }

    private func stopLocationUpdates() {
        locationManager.stopUpdatingLocation()
    }

    /// v7: 카운트다운 음성 — 폰과 동일하게 "삼 / 이 / 일" (출발은 beginSession 이 발화)
    func announceCount(_ n: Int) {
        let words = ["", "일", "이", "삼"]
        guard n >= 1 && n <= 3 else { return }
        speak(words[n])
    }

    // ── 목표 설정 (v9) — 거리/시간 목표 + 달성 음성·햅틱 (Apple 운동앱 목표 문법) ──
    enum RunGoal: Equatable, Codable {
        case open
        case distanceKm(Double)
        case timeMin(Int)

        var label: String {
            switch self {
            case .open: return "목표 없음"
            case .distanceKm(let km):
                return km == 21.1 ? "하프 목표" : String(format: km == km.rounded() ? "%.0fkm 목표" : "%.1fkm 목표", km)
            case .timeMin(let m): return "\(m)분 목표"
            }
        }
    }

    @Published var goal: RunGoal = .open {
        didSet { saveGoal() }
    }
    private var goalAnnounced = false

    private func saveGoal() {
        if let data = try? JSONEncoder().encode(goal) {
            UserDefaults.standard.set(data, forKey: "runGoal")
        }
    }

    func loadGoal() {
        if let data = UserDefaults.standard.data(forKey: "runGoal"),
           let g = try? JSONDecoder().decode(RunGoal.self, from: data) {
            goal = g
        }
    }

    /// 목표 진행률 0~1 (open 이면 nil)
    var goalProgress: Double? {
        switch goal {
        case .open: return nil
        case .distanceKm(let km): return min(1, distanceMeters / (km * 1000))
        case .timeMin(let m): return min(1, elapsedSeconds / Double(m * 60))
        }
    }

    private func checkGoal() {
        guard !goalAnnounced, phase == .active else { return }
        let done: Bool
        switch goal {
        case .open: return
        case .distanceKm(let km): done = distanceMeters >= km * 1000
        case .timeMin(let m): done = elapsedSeconds >= Double(m * 60)
        }
        if done {
            goalAnnounced = true
            WKInterfaceDevice.current().play(.success)
            speak("목표 달성! 정말 대단해요.")
        }
    }

    // ── 심박 존 (v7) — 최대심박 = 220 - 나이 (HealthKit 생년월일, 실패 시 190) ──
    @Published var maxHeartRate: Double = 190

    // v19 (zone1~5 회원 요청): 존별 누적 체류 시간 — HR 샘플 간격을 현재 존에 적산.
    // 요약 화면 존 분포 바의 데이터. active 아닐 때는 앵커를 끊어 일시정지 시간 제외.
    @Published var zoneSeconds: [Double] = [0, 0, 0, 0, 0]
    private var lastZoneTickAt: Date?

    private func accumulateZoneTime() {
        guard phase == .active, currentZone > 0 else {
            lastZoneTickAt = nil
            return
        }
        let now = Date()
        if let last = lastZoneTickAt {
            // 샘플 공백 상한 30s — 백그라운드 수집 공백이 한 존에 통째로 적산되는 것 방지
            zoneSeconds[currentZone - 1] += min(now.timeIntervalSince(last), 30)
        }
        lastZoneTickAt = now
    }

    /// 현재 심박 존 1~5 (0 = 측정 전)
    var currentZone: Int {
        guard heartRate > 0 else { return 0 }
        let pct = heartRate / maxHeartRate
        if pct < 0.60 { return 1 }
        if pct < 0.70 { return 2 }
        if pct < 0.80 { return 3 }
        if pct < 0.90 { return 4 }
        return 5
    }

    private func loadMaxHeartRate() {
        // v9: iPhone 프로필의 max_hr 이 동기화돼 있으면 최우선 (실측값 > 공식)
        if let synced = ConnectivityStore.shared.syncedMaxHr {
            maxHeartRate = synced
            return
        }
        if let dob = try? healthStore.dateOfBirthComponents(),
           let year = dob.year {
            let age = Calendar.current.component(.year, from: Date()) - year
            if age > 5 && age < 100 { maxHeartRate = Double(220 - age) }
        }
    }

    // ── 자동 일시정지 (v7 → 2026-08-05 재설계) — 폰 엔진 재설계 미러 (hans 실주행 신고 fix)
    // 구 v7 은 출발 미무장 가드가 없어 GPS 콜드스타트 (거리 0) 15초 만에 오정지 → 스텝 12보로
    // 재개 → 여전히 미획득이라 재정지 … 무한 루프 (첫 1km 정지↔재개 반복 + 거리 0 신고).
    // 원칙: 정지 판정의 진실 소스는 몸 — 스텝이 흐르는 중엔 거리가 멈춰도 절대 정지하지 않는다.
    @Published var isAutoPaused = false
    private var lastDistanceChangeAt = Date()
    private var lastDistanceForStall: Double = 0
    private var stallTimer: Timer?
    private let pedometer = CMPedometer()
    private var pedometerSteps = 0
    private var lastStepChangeAt: Date?
    private var stepsAtAutoPause = 0
    /// 세션 중 거리가 실제로 한 번이라도 전진하기 전엔 자동정지 미무장 (폰 fix 295 미러).
    private var hasMovedThisSession = false

    // ── 케이던스 기반 걷기 감지 (2026-08-09, hans "힘들어서 걸었는데 정지 안 됨") ──
    // 속도로는 걷기(4~5km/h)와 초보 조깅(7~8분/km)이 겹쳐 임계값을 못 잡는다. 케이던스는
    // 걷기 100~125spm / 달리기 150~180spm 로 갈라져 오작동 없이 구분된다.
    // 중립대(132~150spm)는 어느 쪽도 아님 — 아주 느린 조깅이 오정지되지 않게 하는 완충.
    private enum Cadence {
        /// 이 미만이 지속되면 "달리는 중이 아님" (걷기 또는 정지). 132spm.
        static let walkMax: Double = 2.2      // steps/sec
        /// 이 이상이면 달리는 중 — 정지 거부 + 자동 재개. 150spm.
        static let runMin: Double = 2.5       // steps/sec
        /// 폰 엔진 autoPauseHoldSec 과 동일 — 신호 흔들림 흡수.
        static let walkHoldSec: TimeInterval = 12
        static let resumeHoldSec: TimeInterval = 3
        /// 케이던스 산출 창 — CMPedometer 콜백(~2.5s) 2~3회분.
        static let windowSec: TimeInterval = 8
    }
    /// (시각, 누적 걸음) 샘플 — 창 안에서 Δ걸음/Δ시간 으로 케이던스 산출.
    private var stepSamples: [(at: Date, steps: Int)] = []
    private var slowCadenceSince: Date?
    private var runCadenceSince: Date?

    private func startStallWatch() {
        lastDistanceChangeAt = Date()
        lastDistanceForStall = distanceMeters
        // 복구 세션 (이미 달리던 세션) 은 즉시 무장 — 신규 세션만 첫 전진까지 보류.
        hasMovedThisSession = distanceMeters >= 25
        pedometerSteps = 0
        lastStepChangeAt = nil
        stepSamples.removeAll()
        slowCadenceSince = nil
        runCadenceSince = nil
        startPedometerStream()
        stallTimer?.invalidate()
        stallTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.checkStall() }
        }
    }

    /// 세션 내내 스텝 스트림 유지 — 케이던스 산출 + 자동 재개 판정 공용.
    private func startPedometerStream() {
        guard CMPedometer.isStepCountingAvailable() else { return }
        pedometer.stopUpdates()
        pedometer.startUpdates(from: Date()) { [weak self] data, _ in
            guard let data else { return }
            let steps = data.numberOfSteps.intValue
            // OS 가 주는 즉시 케이던스가 있으면 우선 (없는 기기/버전은 스텝 델타로 산출).
            let osCadence = data.currentCadence?.doubleValue
            Task { @MainActor in
                guard let self else { return }
                let now = Date()
                if steps > self.pedometerSteps {
                    self.pedometerSteps = steps
                    self.lastStepChangeAt = now
                }
                self.stepSamples.append((at: now, steps: steps))
                self.stepSamples.removeAll { now.timeIntervalSince($0.at) > Cadence.windowSec }
                self.evaluateCadence(now: now, osCadence: osCadence)
            }
        }
    }

    /// 창 안의 Δ걸음/Δ시간 (steps/sec). 샘플이 모자라면 nil.
    private func measuredCadence(now: Date) -> Double? {
        guard let first = stepSamples.first, let last = stepSamples.last else { return nil }
        let dt = last.at.timeIntervalSince(first.at)
        guard dt >= 4 else { return nil }   // 최소 4초는 모여야 신뢰
        return Double(last.steps - first.steps) / dt
    }

    /// 케이던스로 걷기/달리기를 판정해 자동정지·재개를 구동 (걷기 감지의 본체).
    private func evaluateCadence(now: Date, osCadence: Double?) {
        // OS 값은 "현재 케이던스" 라 반응이 빠르지만 정지 직후 nil/0 이 되므로 창 계산과 max.
        let cadence = max(osCadence ?? 0, measuredCadence(now: now) ?? 0)
        guard cadence > 0 || !stepSamples.isEmpty else { return }

        if isAutoPaused {
            // 재개: 달리기 케이던스가 3초 지속. 걷는 동안엔 절대 재개되지 않는다
            // (구 로직은 "12보 증가" 라 걷기만 해도 재개 → 정지↔재개 발진했다).
            if cadence >= Cadence.runMin {
                if runCadenceSince == nil { runCadenceSince = now }
                if now.timeIntervalSince(runCadenceSince!) >= Cadence.resumeHoldSec {
                    resumeFromAutoPause()
                }
            } else {
                runCadenceSince = nil
            }
            return
        }

        guard phase == .active, hasMovedThisSession else { return }
        if cadence >= Cadence.runMin {
            slowCadenceSince = nil          // 달리는 중 — 창 리셋
        } else if cadence < Cadence.walkMax {
            if slowCadenceSince == nil { slowCadenceSince = now }
            if now.timeIntervalSince(slowCadenceSince!) >= Cadence.walkHoldSec {
                enterAutoPause(reason: cadence < 0.5 ? "정지" : "걷기")
            }
        }
        // 중립대 (walkMax ~ runMin): 아주 느린 조깅 — 창 유지도 리셋도 하지 않는다.
    }

    private func enterAutoPause(reason: String) {
        session?.pause()
        isAutoPaused = true
        stepsAtAutoPause = pedometerSteps
        slowCadenceSince = nil
        runCadenceSince = nil
        // UI 프로세스가 죽었다 복원돼도 "자동정지였음" 을 알아야 재개 감시가 다시 붙는다.
        UserDefaults.standard.set(true, forKey: "wasAutoPaused")
        WKInterfaceDevice.current().play(.stop)
        speak(reason == "걷기" ? "걷기 감지. 잠시 멈출게요." : "자동 일시정지. 다시 움직이면 이어서 잴게요.")
    }

    private func resumeFromAutoPause() {
        isAutoPaused = false
        slowCadenceSince = nil
        runCadenceSince = nil
        UserDefaults.standard.removeObject(forKey: "wasAutoPaused")
        lastDistanceChangeAt = Date()
        lastDistanceForStall = distanceMeters
        session?.resume()
        WKInterfaceDevice.current().play(.start)
        speak("다시 시작합니다. 같이 가요.")
    }

    /// 거리 기반 폴백 — pedometer 미가용/미승인 기기 전용. 케이던스가 살아 있으면
    /// 걷기·정지 판정은 evaluateCadence 가 전담하고 여기서는 무장 추적만 한다.
    private func checkStall() {
        guard phase == .active else { return }
        if distanceMeters - lastDistanceForStall >= 3 {
            lastDistanceForStall = distanceMeters
            lastDistanceChangeAt = Date()
            hasMovedThisSession = true
            return
        }
        guard hasMovedThisSession, !isAutoPaused else { return }
        // 케이던스를 신뢰할 수 있으면 정지 판정은 그쪽 몫 (걷기까지 잡는다).
        if measuredCadence(now: Date()) != nil { return }
        // 스텝 거부권: 몸이 움직이는 중엔 거리가 멈춰도 정지하지 않는다 (터널·GPS 기아 오정지 차단).
        if let lastStep = lastStepChangeAt, Date().timeIntervalSince(lastStep) < 5 { return }
        if Date().timeIntervalSince(lastDistanceChangeAt) >= 15 {
            enterAutoPause(reason: "정지")
        }
    }

    /// 1~99 한자어 수사 (폰 네이티브와 동일 — "십일 킬로미터" 오독 방지)
    private static func sinoKorean(_ n: Int) -> String {
        guard n >= 1 && n <= 99 else { return String(n) }
        let d = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"]
        let tens = n / 10, ones = n % 10
        var out = ""
        if tens >= 2 { out += d[tens] }
        if tens >= 1 { out += "십" }
        out += d[ones]
        return out
    }

    // ── 센티초 타이머 보간 앵커 (v6) — builder 이벤트 사이를 벽시계로 보간 ──
    private(set) var elapsedAnchorValue: TimeInterval = 0
    private(set) var elapsedAnchorDate = Date.distantPast

    /// TimelineView 프레임마다 호출 — active 일 때만 보간, 아니면 마지막 값
    func displayElapsed(at now: Date) -> TimeInterval {
        guard phase == .active, elapsedAnchorDate != .distantPast else { return elapsedSeconds }
        return elapsedAnchorValue + now.timeIntervalSince(elapsedAnchorDate)
    }

    // ── v22: 폰 잠금화면 미러 (watchOS 10+) — Runna·애플 운동앱 방식 ──
    // startMirroringToCompanionDevice → 시스템이 폰 앱을 깨워 Live Activity 시작.
    // 지표는 sendToRemoteWorkoutSession 페이로드 {e,d,p,h} 로 5초 스로틀 전송.
    private var mirrorStarted = false
    private var lastMirrorSentAt = Date.distantPast

    private func startMirroringToPhone() {
        guard #available(watchOS 10.0, *), let session else { return }
        session.startMirroringToCompanionDevice { [weak self] success, error in
            Task { @MainActor in
                guard let self else { return }
                self.mirrorStarted = success
                if let error { NSLog("[Watch] mirror start failed: \(error)") }
                if success { self.sendMirrorMetrics(force: true) }
            }
        }
    }

    private func sendMirrorMetrics(force: Bool = false) {
        guard #available(watchOS 10.0, *), mirrorStarted, let session else { return }
        let now = Date()
        guard force || now.timeIntervalSince(lastMirrorSentAt) >= 5 else { return }
        lastMirrorSentAt = now
        let payload: [String: Any] = [
            "e": elapsedSeconds,
            "d": distanceMeters,
            "p": (lastSplitPaceSecPerKm ?? paceSecPerKm) ?? 0,
            "h": heartRate,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        session.sendToRemoteWorkoutSession(data: data) { _, _ in }
    }

    // ── 화면 상태 ──────────────────────────────────────────────
    enum Phase { case idle, requesting, countdown, active, paused, ended }
    @Published var phase: Phase = .idle
    @Published var elapsedSeconds: TimeInterval = 0
    @Published var distanceMeters: Double = 0
    @Published var heartRate: Double = 0
    @Published var activeCalories: Double = 0
    @Published var authDenied = false
    // v12: 외부 종료 구분 — 다른 운동 앱 (애플 피트니스 등) 이 세션을 시작하면 OS 가
    // 우리 세션을 강제 종료 (.ended). 사용자가 종료 버튼을 안 눌렀는데 끝난 경우 안내용.
    @Published var endedExternally = false
    private var endRequested = false
    // v24: 폰 직송용 상태 — HK 미러를 기다리지 않는 즉시 동기화 경로
    private var workoutStartDate: Date?
    private var phoneRoutePoints: [[Double]] = []
    private var lastPhonePointLoc: CLLocation?
    private var sentRunToPhone = false
    // 심박 스파크라인용 최근 샘플 (심박 페이지 그래프)
    @Published var hrSamples: [Double] = []
    // 종료 요약
    @Published var summary: WorkoutSummary?

    struct WorkoutSummary {
        let distanceMeters: Double
        let elapsedSeconds: TimeInterval
        let avgHeartRate: Double
        let calories: Double
        var zoneSeconds: [Double] = [0, 0, 0, 0, 0]   // v19: 존 분포
        var paceSecPerKm: Double? {
            distanceMeters > 50 ? elapsedSeconds / (distanceMeters / 1000) : nil
        }
    }

    var paceSecPerKm: Double? {
        distanceMeters > 50 ? elapsedSeconds / (distanceMeters / 1000) : nil
    }

    #if DEBUG
    /// 시뮬레이터 UI 스크린샷용 — launch argument 로 mock 상태 주입 (HealthKit 불필요).
    func applyUIPreviewIfRequested() {
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-uipreview-metrics") || args.contains("-uipreview-controls") || args.contains("-uipreview-hr") {
            phase = .active; elapsedSeconds = 1264; distanceMeters = 4230; heartRate = 156; activeCalories = 231
            lastSplitPaceSecPerKm = 282   // 4'42" — 직전 KM 표시 프리뷰
            maxHeartRate = 190            // 156bpm → 존 4
            // 그럴싸한 심박 곡선 (워밍업 → 상승 → 고원)
            hrSamples = (0..<120).map { i in
                let t = Double(i) / 120.0
                let base = 105.0 + 55.0 * min(1.0, t * 2.2)
                let wobble = 6.0 * sin(Double(i) * 0.55) + 3.0 * sin(Double(i) * 0.13)
                return base + wobble
            }
        } else if args.contains("-uipreview-paused") {
            phase = .paused; elapsedSeconds = 1264; distanceMeters = 4230; heartRate = 121; activeCalories = 231
        } else if args.contains("-uipreview-summary") {
            summary = WorkoutSummary(distanceMeters: 5012, elapsedSeconds: 1650, avgHeartRate: 152, calories: 320,
                                     zoneSeconds: [95, 320, 660, 430, 145])
            phase = .ended
        } else if args.contains("-uipreview-countdown") {
            phase = .countdown
        }
        // (-uipreview-grow 는 v8 에서 성장 트랜지션과 함께 제거됨)
    }
    #endif

    // ── 권한 ──────────────────────────────────────────────────
    // ⚠️ 2026-07-30 (hans 12.29km 유실 진범): share 에 workoutType 만 있으면
    // HKLiveWorkoutBuilder 가 라이브 화면엔 거리·심박을 보여주면서도 **저장은 거리 없는
    // 워크아웃**으로 한다 (수집 타입별 share 권한 필요). 폰 동기화에선 totalDistance nil
    // → 0km 로 보여 조용히 버려짐. 경로(workoutRoute) share 도 없어서 v13 지도 저장도
    // 실패하고 있었음. 수집·저장하는 모든 타입을 share 에 포함할 것.
    private var typesToShare: Set<HKSampleType> {
        [
            HKObjectType.workoutType(),
            HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)!,
            HKQuantityType.quantityType(forIdentifier: .heartRate)!,
            HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!,
            HKSeriesType.workoutRoute(),
        ]
    }
    private var typesToRead: Set<HKObjectType> {
        [
            HKQuantityType.quantityType(forIdentifier: .heartRate)!,
            HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)!,
            HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!,
            // v7: 심박 존 계산용 나이 (220 - age)
            HKCharacteristicType.characteristicType(forIdentifier: .dateOfBirth)!,
        ]
    }

    // v21 의 "모두 허용" 프라이머 알럿은 2026-08-03 hans 지시로 제거 —
    // "버튼만 한번 더 누르는 것 같다". 시스템 시트로 바로 진행.
    func requestAuthorizationAndStart() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        phase = .requesting
        // v15 fix (hans 실기기): 이미 응답한 권한인데도 시작할 때마다 동의 시트가 뜨던 문제 —
        // "요청이 필요한 상태" 일 때만 시트를 띄우고, 아니면 바로 진행.
        healthStore.getRequestStatusForAuthorization(toShare: typesToShare, read: typesToRead) { [weak self] status, _ in
            Task { @MainActor in
                guard let self else { return }
                if status == .unnecessary {
                    self.requestLocationThenCountdown()
                    return
                }
                self.healthStore.requestAuthorization(toShare: self.typesToShare, read: self.typesToRead) { [weak self] ok, _ in
                    Task { @MainActor in
                        guard let self else { return }
                        if ok { self.requestLocationThenCountdown() } else { self.authDenied = true; self.phase = .idle }
                    }
                }
            }
        }
    }

    /// v15: 위치 동의를 카운트다운 **전에** — 이전엔 beginSession 도중 프롬프트가 떠
    /// 세션 시작과 겹쳤다 (크래시와 맞물려 동의가 영영 저장 안 되는 루프).
    /// 거부해도 러닝은 정상 진행 (경로만 없음).
    private func requestLocationThenCountdown() {
        locationManager.delegate = self
        if locationManager.authorizationStatus == .notDetermined {
            pendingCountdownAfterLocationAuth = true
            locationManager.requestWhenInUseAuthorization()
            return
        }
        phase = .countdown
    }

    /// 카운트다운 종료 후 실제 세션 시작
    func beginSession() {
        WKInterfaceDevice.current().play(.start)
        // v11: 오디오 세션을 워크아웃 내내 유지 — 백그라운드 (손목 내림) 발화의 전제조건.
        // 인터럽션 (전화·시리 등) 종료 시 재활성화 옵저버도 1회 등록.
        activateAudioSession()
        registerAudioInterruptionObserverOnce()
        speak("출발!")
        loadMaxHeartRate()
        startWorkout()
        startStallWatch()
        startLocationUpdates()   // v13: GPS 경로 수집
    }

    private func activateAudioSession() {
        let session = AVAudioSession.sharedInstance()
        if !Self.audioConfigured {
            try? session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            Self.audioConfigured = true
        }
        try? session.setActive(true)
    }

    private static var interruptionObserverRegistered = false
    private func registerAudioInterruptionObserverOnce() {
        guard !Self.interruptionObserverRegistered else { return }
        Self.interruptionObserverRegistered = true
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] note in
            guard let info = note.userInfo,
                  let typeRaw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: typeRaw) == .ended else { return }
            Task { @MainActor in
                guard let self, self.phase == .active || self.phase == .paused else { return }
                self.activateAudioSession()
            }
        }
    }

    // ── 세션 라이프사이클 ──────────────────────────────────────

    /// v11: 앱 UI 프로세스가 재실행됐을 때 진행 중이던 워크아웃 세션에 재접속.
    /// (watchOS 는 다른 화면 오래 보면 앱 UI 를 종료할 수 있음 — 세션은 살아 있음)
    func recoverSessionIfNeeded() {
        guard session == nil, phase == .idle else { return }
        healthStore.recoverActiveWorkoutSession { [weak self] recovered, _ in
            guard let recovered else { return }
            Task { @MainActor in
                guard let self, self.session == nil else { return }
                let builder = recovered.associatedWorkoutBuilder()
                builder.dataSource = HKLiveWorkoutDataSource(
                    healthStore: self.healthStore,
                    workoutConfiguration: recovered.workoutConfiguration
                )
                recovered.delegate = self
                builder.delegate = self
                self.session = recovered
                self.builder = builder
                self.phase = recovered.state == .paused ? .paused : .active
                self.syncElapsed(builder.elapsedTime)
                // 2026-08-06 (리뷰 P1): startStallWatch 의 "distanceMeters >= 25 면 즉시 무장"
                // 판정이 항상 false 였다 — 이 시점 distanceMeters 는 새 프로세스 초기값 0 이고
                // 거리는 이후 builder 콜백에서야 채워지기 때문. builder 통계로 먼저 복원한다.
                if let stat = builder.statistics(for: HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)!),
                   let meters = stat.sumQuantity()?.doubleValue(for: .meter()), meters > self.distanceMeters {
                    self.distanceMeters = meters
                }
                self.loadGoal()
                self.loadMaxHeartRate()
                self.activateAudioSession()
                self.registerAudioInterruptionObserverOnce()
                self.startStallWatch()
                // 자동정지 중 UI 가 죽은 경우 — 감시 상태를 되살려야 12보 자동재개가 동작한다.
                if recovered.state == .paused, UserDefaults.standard.bool(forKey: "wasAutoPaused") {
                    self.isAutoPaused = true
                    self.stepsAtAutoPause = self.pedometerSteps
                }
                self.startMirroringToPhone()   // v22: UI 재실행 복구 시에도 미러 재개
            }
        }
    }
    private func startWorkout() {
        let config = HKWorkoutConfiguration()
        config.activityType = .running
        config.locationType = .outdoor

        do {
            let session = try HKWorkoutSession(healthStore: healthStore, configuration: config)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: config)
            session.delegate = self
            builder.delegate = self
            self.session = session
            self.builder = builder

            let start = Date()
            session.startActivity(with: start)
            builder.beginCollection(withStart: start) { _, _ in }
            // v24: HK 워크아웃과 같은 시작 시각 — 폰 직송 행과 HK 임포트가 ±60s dedup 으로 만나는 키
            workoutStartDate = start
            phoneRoutePoints = []
            lastPhonePointLoc = nil
            sentRunToPhone = false
            phase = .active
            startMirroringToPhone()   // v22: 폰 잠금화면 Live Activity
        } catch {
            phase = .idle
        }
    }

    func togglePause() {
        guard let session else { return }
        if phase == .active {
            session.pause()
        } else if phase == .paused {
            // 수동 재개 — 자동 일시정지 감시 상태 초기화 (스텝 스트림은 세션 내내 유지)
            isAutoPaused = false
            UserDefaults.standard.removeObject(forKey: "wasAutoPaused")
            lastDistanceChangeAt = Date()
            lastDistanceForStall = distanceMeters
            session.resume()
        }
    }

    func endWorkout() {
        endRequested = true
        stallTimer?.invalidate()
        stallTimer = nil
        pedometer.stopUpdates()
        stopLocationUpdates()
        isAutoPaused = false
        UserDefaults.standard.removeObject(forKey: "wasAutoPaused")
        // v20 (hans: "종료 누르면 바로 첫화면"): 요약을 HK 콜백에 묶지 않는다 —
        // finishWorkout 이 느리거나 그 사이 손목을 내려 watchOS 가 UI 를 죽이면
        // 축하 화면 없이 시작 화면으로 떨어졌다. 종료 즉시 로컬 값으로 요약 표시,
        // HK 저장은 뒤에서 진행 (완료되면 평균 심박만 정밀값으로 갱신).
        let avgHr = hrSamples.isEmpty ? 0 : hrSamples.reduce(0, +) / Double(hrSamples.count)
        summary = WorkoutSummary(
            distanceMeters: distanceMeters,
            elapsedSeconds: elapsedSeconds,
            avgHeartRate: avgHr,
            calories: activeCalories,
            zoneSeconds: zoneSeconds
        )
        persistPendingSummary()
        sendRunToPhone()   // v24: 종료 즉시 폰 직송 — HK 미러 대기 없음
        phase = .ended
        speak("완주! 오늘도 잘 달렸어요.")
        session?.end()
    }

    // v24 (2026-08-03 hans "동기화 오래 걸림"): 워치 러닝을 HK 미러(수 분~수 시간 지연)
    // 대신 WCSession transferUserInfo 로 폰에 직송. 폰 WatchBridge 가 watch_pending_runs
    // 큐(갤럭시워치와 동일 규약)에 넣고, 앱을 열면 drainWatchRuns 가 바로 저장한다.
    // transferUserInfo 는 폰이 꺼져 있어도 시스템 큐에 보존 → 유실 없음.
    // 뒤따르는 health-sync HK 임포트는 started_at ±60s 겹침으로 dedup skip.
    private func sendRunToPhone() {
        guard !sentRunToPhone, distanceMeters >= 100, WCSession.isSupported() else { return }
        sentRunToPhone = true
        let startMs = (workoutStartDate ?? Date().addingTimeInterval(-elapsedSeconds))
            .timeIntervalSince1970 * 1000
        let avgHr = summary?.avgHeartRate
            ?? (hrSamples.isEmpty ? 0 : hrSamples.reduce(0, +) / Double(hrSamples.count))
        WCSession.default.transferUserInfo([
            "type": "watch_run",
            "clientRecordId": "aw-\(Int64(startMs))",
            "startMs": startMs,
            "endMs": Date().timeIntervalSince1970 * 1000,
            "distanceMeters": distanceMeters,
            "durationSec": elapsedSeconds,
            "calories": activeCalories,
            "avgHr": avgHr,
            "device": "Apple Watch",
            "route": phoneRoutePoints,
        ])
    }

    // ── v20: 요약 영속 — UI 가 죽었다 깨어나도 축하·기록 화면을 되찾는다 ──
    private func persistPendingSummary() {
        guard let s = summary else { return }
        UserDefaults.standard.set([
            "d": s.distanceMeters, "e": s.elapsedSeconds, "h": s.avgHeartRate,
            "c": s.calories, "z": s.zoneSeconds, "ts": Date().timeIntervalSince1970,
        ] as [String: Any], forKey: "pendingSummary")
    }

    /// 앱 재시작 시 15분 내의 미확인 요약이 있으면 복원 (완료 탭 = reset 이 지움)
    func restorePendingSummaryIfNeeded() {
        guard phase == .idle, summary == nil,
              let o = UserDefaults.standard.dictionary(forKey: "pendingSummary"),
              let ts = o["ts"] as? TimeInterval,
              Date().timeIntervalSince1970 - ts < 900 else { return }
        summary = WorkoutSummary(
            distanceMeters: o["d"] as? Double ?? 0,
            elapsedSeconds: o["e"] as? Double ?? 0,
            avgHeartRate: o["h"] as? Double ?? 0,
            calories: o["c"] as? Double ?? 0,
            zoneSeconds: o["z"] as? [Double] ?? [0, 0, 0, 0, 0]
        )
        phase = .ended
    }

    /// 요약 닫기 → 초기 화면 복귀
    func reset() {
        UserDefaults.standard.removeObject(forKey: "pendingSummary")   // v20: 요약 확인 완료
        session = nil
        builder = nil
        phase = .idle
        elapsedSeconds = 0
        distanceMeters = 0
        heartRate = 0
        activeCalories = 0
        hrSamples = []
        zoneSeconds = [0, 0, 0, 0, 0]
        lastZoneTickAt = nil
        summary = nil
        lastAnnouncedKm = 0
        lastKmElapsedSec = 0
        lastSplitPaceSecPerKm = nil
        endedExternally = false
        endRequested = false
        elapsedAnchorValue = 0
        elapsedAnchorDate = .distantPast
        stallTimer?.invalidate()
        stallTimer = nil
        pedometer.stopUpdates()
        isAutoPaused = false
        goalAnnounced = false
        pendingCountdownAfterLocationAuth = false
        mirrorStarted = false
        lastMirrorSentAt = .distantPast
    }

    // ── 통계 반영 ─────────────────────────────────────────────
    private func updateForStatistics(_ statistics: HKStatistics?) {
        guard let statistics else { return }
        switch statistics.quantityType {
        case HKQuantityType.quantityType(forIdentifier: .heartRate):
            let unit = HKUnit.count().unitDivided(by: .minute())
            heartRate = statistics.mostRecentQuantity()?.doubleValue(for: unit) ?? heartRate
            if heartRate > 0 {
                hrSamples.append(heartRate)
                if hrSamples.count > 240 { hrSamples.removeFirst(hrSamples.count - 240) }
            }
            accumulateZoneTime()   // v19: 존 체류 시간 적산
        case HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning):
            distanceMeters = statistics.sumQuantity()?.doubleValue(for: .meter()) ?? distanceMeters
            // v6~7: km 마일스톤 — 햅틱 + 구간 페이스 음성 (폰 템플릿과 동일:
            // "N 킬로미터 통과. 이번 구간 M분 S초. 잘하고 있어요")
            let km = Int(distanceMeters / 1000)
            if km > lastAnnouncedKm {
                lastAnnouncedKm = km
                let splitSec = elapsedSeconds - lastKmElapsedSec
                lastKmElapsedSec = elapsedSeconds
                if splitSec > 60 { lastSplitPaceSecPerKm = splitSec }  // 1km 구간 시간 = 구간 페이스
                WKInterfaceDevice.current().play(.notification)
                var text = "\(Self.sinoKorean(km)) 킬로미터 통과."
                if let p = lastSplitPaceSecPerKm ?? paceSecPerKm {
                    let t = Int(p.rounded()), m = t / 60, s = t % 60
                    text += s == 0 ? " 이번 구간 \(m)분." : " 이번 구간 \(m)분 \(s)초."
                }
                text += " 잘하고 있어요."
                speak(text)
            }
            checkGoal()   // v9: 거리 목표 체크
        case HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned):
            activeCalories = statistics.sumQuantity()?.doubleValue(for: .kilocalorie()) ?? activeCalories
        default: break
        }
    }
}

// MARK: - CLLocationManagerDelegate (v13 — GPS 경로)

extension WorkoutManager: CLLocationManagerDelegate {
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        // 정확도 필터 (폰 엔진과 동일 기준: 50m 이하만)
        let good = locations.filter { $0.horizontalAccuracy > 0 && $0.horizontalAccuracy <= 50 }
        guard !good.isEmpty else { return }
        Task { @MainActor in
            guard self.phase == .active, let rb = self.routeBuilder else { return }
            rb.insertRouteData(good) { _, _ in }
            // v24: 폰 직송 경로 버퍼 — 8m/5s 데시메이션 (10km 러닝 ≈ 수백 점, plist 전송 가벼움)
            for loc in good {
                if let last = self.lastPhonePointLoc,
                   loc.distance(from: last) < 8,
                   loc.timestamp.timeIntervalSince(last.timestamp) < 5 { continue }
                self.lastPhonePointLoc = loc
                self.phoneRoutePoints.append([
                    loc.coordinate.latitude, loc.coordinate.longitude,
                    loc.altitude, loc.timestamp.timeIntervalSince1970 * 1000,
                ])
            }
            if self.phoneRoutePoints.count > 2400 {
                self.phoneRoutePoints = self.phoneRoutePoints.enumerated()
                    .compactMap { $0.offset % 2 == 0 ? $0.element : nil }
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    /// v15: 시작 전 위치 프롬프트 응답 수신 → 카운트다운 재개 (허용/거부 무관 — 거부면 경로만 없음)
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            guard self.pendingCountdownAfterLocationAuth, status != .notDetermined else { return }
            self.pendingCountdownAfterLocationAuth = false
            self.phase = .countdown
        }
    }
}

// MARK: - HKWorkoutSessionDelegate

extension WorkoutManager: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession,
                                    didChangeTo toState: HKWorkoutSessionState,
                                    from fromState: HKWorkoutSessionState,
                                    date: Date) {
        Task { @MainActor in
            switch toState {
            case .running:
                self.phase = .active
                // v8 fix: 재개 직후 앵커 재동기화 — 안 하면 displayElapsed 가
                // 일시정지 시간을 벽시계로 합산해 타이머가 점프했다 돌아옴
                if let b = self.builder { self.syncElapsed(b.elapsedTime) }
                self.sendMirrorMetrics(force: true)   // v22: 전이 직후 최신값
            case .paused:
                self.phase = .paused
                // 정지 화면 표시값을 builder 의 정확한 경과시간으로 고정
                if let b = self.builder { self.elapsedSeconds = b.elapsedTime }
                self.sendMirrorMetrics(force: true)
            case .ended:
                // v12: 종료 버튼 없이 끝남 = 외부 종료 (다른 운동 앱이 세션을 가져감)
                self.endedExternally = !self.endRequested
                // 2026-08-06 (리뷰 P1): 외부 종료 경로엔 감시 정리가 없었다 — 스텝 스트림이
                // 세션 내내 살아있게 바뀐 뒤로, 요약 화면에서 12보 걸으면 이미 끝난 세션에
                // resume() + "다시 시작합니다" 오발화가 났다. 종료 시 반드시 함께 접는다.
                self.stallTimer?.invalidate()
                self.stallTimer = nil
                self.pedometer.stopUpdates()
                self.isAutoPaused = false
                UserDefaults.standard.removeObject(forKey: "wasAutoPaused")
                // 수집 종료 → HealthKit 저장 → 요약
                self.stopLocationUpdates()
                self.builder?.endCollection(withEnd: date) { [weak self] _, _ in
                    self?.builder?.finishWorkout { workout, _ in
                        // v13: 경로를 완성된 워크아웃에 붙임 (지도 데이터)
                        if let workout, let rb = self?.routeBuilder {
                            rb.finishRoute(with: workout, metadata: nil) { _, _ in }
                        }
                        Task { @MainActor in
                            guard let self else { return }
                            let hrUnit = HKUnit.count().unitDivided(by: .minute())
                            let avgHr = self.builder?
                                .statistics(for: HKQuantityType.quantityType(forIdentifier: .heartRate)!)?
                                .averageQuantity()?.doubleValue(for: hrUnit) ?? 0
                            // v20: endWorkout 이 이미 로컬 요약을 띄웠으면 심박만 정밀값으로 갱신.
                            // (외부 종료 등 endWorkout 을 안 거친 경로는 여기서 최초 생성)
                            self.summary = WorkoutSummary(
                                distanceMeters: self.distanceMeters,
                                elapsedSeconds: self.elapsedSeconds,
                                avgHeartRate: avgHr > 0 ? avgHr : (self.summary?.avgHeartRate ?? 0),
                                calories: self.activeCalories,
                                zoneSeconds: self.zoneSeconds
                            )
                            self.persistPendingSummary()
                            self.sendRunToPhone()   // v24: 외부 종료 경로도 직송 (flag 로 1회 보장)
                            self.phase = .ended
                        }
                    }
                }
            default: break
            }
        }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor in
            // 2026-08-06 (리뷰 P1): 실패 경로도 감시·위치를 정리해야 좀비 타이머/스트림이 안 남는다.
            self.stallTimer?.invalidate()
            self.stallTimer = nil
            self.pedometer.stopUpdates()
            self.isAutoPaused = false
            UserDefaults.standard.removeObject(forKey: "wasAutoPaused")
            self.stopLocationUpdates()
            self.phase = .idle
        }
    }
}

// MARK: - HKLiveWorkoutBuilderDelegate

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder,
                                    didCollectDataOf collectedTypes: Set<HKSampleType>) {
        Task { @MainActor in
            for type in collectedTypes {
                guard let qt = type as? HKQuantityType else { continue }
                self.updateForStatistics(workoutBuilder.statistics(for: qt))
            }
            self.syncElapsed(workoutBuilder.elapsedTime)
        }
    }

    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {
        Task { @MainActor in self.syncElapsed(workoutBuilder.elapsedTime) }
    }

    /// builder 의 권위 있는 경과시간으로 앵커 갱신 — 센티초 표시는 이 앵커에서 보간
    private func syncElapsed(_ value: TimeInterval) {
        elapsedSeconds = value
        elapsedAnchorValue = value
        elapsedAnchorDate = Date()
        checkGoal()   // v9: 시간 목표 체크
        sendMirrorMetrics()   // v22: 폰 잠금화면 지표 (5초 스로틀)
    }
}
