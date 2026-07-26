// Routinist Watch — 러닝 워크아웃 엔진 (Phase 1, 2026-07-26).
// HKWorkoutSession + HKLiveWorkoutBuilder: 시작/일시정지/종료, 거리·심박·페이스 실시간.
// 종료 시 HealthKit 에 저장 → iPhone 앱의 기존 Health sync 가 자동으로 가져간다 (서버 작업 0).

import Foundation
import HealthKit
import WatchKit
import AVFoundation
import CoreMotion

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

    func speak(_ text: String) {
        // v10 fix (320 실기기: "음성이 안 들려"): watchOS 는 AVAudioSession 을
        // .playback 으로 활성화하지 않으면 TTS 가 스피커에서 무음.
        // 카테고리는 1회 등록, setActive 는 발화 직전 lazy (폰 build 241 계약과 동일 패턴).
        let session = AVAudioSession.sharedInstance()
        if !Self.audioConfigured {
            try? session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            Self.audioConfigured = true
        }
        try? session.setActive(true)

        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "ko-KR")
        // 워치 스피커는 출력이 작아 0.9 — 이어폰 연결 시에도 과하지 않은 선
        u.volume = 0.9
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 0.95
        speech.speak(u)
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

    // ── 자동 일시정지 (v7) — 15초간 거리 정지 → pause, 걸음 감지 → 자동 재개 ──
    @Published var isAutoPaused = false
    private var lastDistanceChangeAt = Date()
    private var lastDistanceForStall: Double = 0
    private var stallTimer: Timer?
    private let pedometer = CMPedometer()

    private func startStallWatch() {
        lastDistanceChangeAt = Date()
        lastDistanceForStall = distanceMeters
        stallTimer?.invalidate()
        stallTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.checkStall() }
        }
    }

    private func checkStall() {
        guard phase == .active else { return }
        if distanceMeters - lastDistanceForStall >= 3 {
            lastDistanceForStall = distanceMeters
            lastDistanceChangeAt = Date()
            return
        }
        if Date().timeIntervalSince(lastDistanceChangeAt) >= 15 {
            // 자동 일시정지 (폰 엔진과 동일 컨셉)
            session?.pause()
            isAutoPaused = true
            WKInterfaceDevice.current().play(.stop)
            speak("자동 일시정지. 다시 움직이면 이어서 잴게요.")
            startPedometerResumeWatch()
        }
    }

    private func startPedometerResumeWatch() {
        guard CMPedometer.isStepCountingAvailable() else { return }
        let from = Date()
        pedometer.startUpdates(from: from) { [weak self] data, _ in
            guard let steps = data?.numberOfSteps.intValue, steps >= 12 else { return }
            Task { @MainActor in
                guard let self, self.isAutoPaused else { return }
                self.pedometer.stopUpdates()
                self.isAutoPaused = false
                self.lastDistanceChangeAt = Date()
                self.lastDistanceForStall = self.distanceMeters
                self.session?.resume()
                WKInterfaceDevice.current().play(.start)
                self.speak("다시 시작합니다. 같이 가요.")
            }
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

    // ── 화면 상태 ──────────────────────────────────────────────
    enum Phase { case idle, requesting, countdown, active, paused, ended }
    @Published var phase: Phase = .idle
    @Published var elapsedSeconds: TimeInterval = 0
    @Published var distanceMeters: Double = 0
    @Published var heartRate: Double = 0
    @Published var activeCalories: Double = 0
    @Published var authDenied = false
    // 심박 스파크라인용 최근 샘플 (심박 페이지 그래프)
    @Published var hrSamples: [Double] = []
    // 종료 요약
    @Published var summary: WorkoutSummary?

    struct WorkoutSummary {
        let distanceMeters: Double
        let elapsedSeconds: TimeInterval
        let avgHeartRate: Double
        let calories: Double
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
            summary = WorkoutSummary(distanceMeters: 5012, elapsedSeconds: 1650, avgHeartRate: 152, calories: 320)
            phase = .ended
        } else if args.contains("-uipreview-countdown") {
            phase = .countdown
        }
        // (-uipreview-grow 는 v8 에서 성장 트랜지션과 함께 제거됨)
    }
    #endif

    // ── 권한 ──────────────────────────────────────────────────
    private var typesToShare: Set<HKSampleType> { [HKObjectType.workoutType()] }
    private var typesToRead: Set<HKObjectType> {
        [
            HKQuantityType.quantityType(forIdentifier: .heartRate)!,
            HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)!,
            HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!,
            // v7: 심박 존 계산용 나이 (220 - age)
            HKCharacteristicType.characteristicType(forIdentifier: .dateOfBirth)!,
        ]
    }

    func requestAuthorizationAndStart() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        phase = .requesting
        healthStore.requestAuthorization(toShare: typesToShare, read: typesToRead) { [weak self] ok, _ in
            Task { @MainActor in
                guard let self else { return }
                // 3-2-1 카운트다운 (Apple 운동앱 문법) → CountdownView 가 beginSession() 호출
                if ok { self.phase = .countdown } else { self.authDenied = true; self.phase = .idle }
            }
        }
    }

    /// 카운트다운 종료 후 실제 세션 시작
    func beginSession() {
        WKInterfaceDevice.current().play(.start)
        speak("출발!")
        loadMaxHeartRate()
        startWorkout()
        startStallWatch()
    }

    // ── 세션 라이프사이클 ──────────────────────────────────────
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
            phase = .active
        } catch {
            phase = .idle
        }
    }

    func togglePause() {
        guard let session else { return }
        if phase == .active {
            session.pause()
        } else if phase == .paused {
            // 수동 재개 — 자동 일시정지 감시 상태 초기화
            pedometer.stopUpdates()
            isAutoPaused = false
            lastDistanceChangeAt = Date()
            lastDistanceForStall = distanceMeters
            session.resume()
        }
    }

    func endWorkout() {
        stallTimer?.invalidate()
        stallTimer = nil
        pedometer.stopUpdates()
        isAutoPaused = false
        session?.end()
    }

    /// 요약 닫기 → 초기 화면 복귀
    func reset() {
        session = nil
        builder = nil
        phase = .idle
        elapsedSeconds = 0
        distanceMeters = 0
        heartRate = 0
        activeCalories = 0
        hrSamples = []
        summary = nil
        lastAnnouncedKm = 0
        lastKmElapsedSec = 0
        lastSplitPaceSecPerKm = nil
        elapsedAnchorValue = 0
        elapsedAnchorDate = .distantPast
        stallTimer?.invalidate()
        stallTimer = nil
        pedometer.stopUpdates()
        isAutoPaused = false
        goalAnnounced = false
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
            case .paused:
                self.phase = .paused
                // 정지 화면 표시값을 builder 의 정확한 경과시간으로 고정
                if let b = self.builder { self.elapsedSeconds = b.elapsedTime }
            case .ended:
                // 수집 종료 → HealthKit 저장 → 요약
                self.builder?.endCollection(withEnd: date) { [weak self] _, _ in
                    self?.builder?.finishWorkout { _, _ in
                        Task { @MainActor in
                            guard let self else { return }
                            let hrUnit = HKUnit.count().unitDivided(by: .minute())
                            let avgHr = self.builder?
                                .statistics(for: HKQuantityType.quantityType(forIdentifier: .heartRate)!)?
                                .averageQuantity()?.doubleValue(for: hrUnit) ?? 0
                            self.summary = WorkoutSummary(
                                distanceMeters: self.distanceMeters,
                                elapsedSeconds: self.elapsedSeconds,
                                avgHeartRate: avgHr,
                                calories: self.activeCalories
                            )
                            self.phase = .ended
                        }
                    }
                }
            default: break
            }
        }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor in self.phase = .idle }
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
    }
}
