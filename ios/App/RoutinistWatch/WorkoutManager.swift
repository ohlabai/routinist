// Routinist Watch — 러닝 워크아웃 엔진 (Phase 1, 2026-07-26).
// HKWorkoutSession + HKLiveWorkoutBuilder: 시작/일시정지/종료, 거리·심박·페이스 실시간.
// 종료 시 HealthKit 에 저장 → iPhone 앱의 기존 Health sync 가 자동으로 가져간다 (서버 작업 0).

import Foundation
import HealthKit
import WatchKit
import AVFoundation

@MainActor
final class WorkoutManager: NSObject, ObservableObject {
    static let shared = WorkoutManager()

    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    // ── 음성 (v6, 2026-07-26 hans: "시작할 때 음성 안 나오는 거 같은데") ──
    // 워치 자체 TTS — 워치에 페어링된 이어폰 또는 워치 스피커로 재생.
    private let speech = AVSpeechSynthesizer()
    private var lastAnnouncedKm = 0

    private func speak(_ text: String) {
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "ko-KR")
        u.volume = 0.65   // 폰 앱 음성과 동일 톤 (feedback_voice_cue_tuning)
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 0.95
        speech.speak(u)
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
    }
    #endif

    // ── 권한 ──────────────────────────────────────────────────
    private var typesToShare: Set<HKSampleType> { [HKObjectType.workoutType()] }
    private var typesToRead: Set<HKObjectType> {
        [
            HKQuantityType.quantityType(forIdentifier: .heartRate)!,
            HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)!,
            HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!,
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
        startWorkout()
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
        if phase == .active { session.pause() } else if phase == .paused { session.resume() }
    }

    func endWorkout() {
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
        elapsedAnchorValue = 0
        elapsedAnchorDate = .distantPast
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
            // v6: km 마일스톤 — 햅틱 + 음성 ("N 킬로미터 통과. 평균 페이스 M분 S초. 잘하고 있어요")
            let km = Int(distanceMeters / 1000)
            if km > lastAnnouncedKm {
                lastAnnouncedKm = km
                WKInterfaceDevice.current().play(.notification)
                var text = "\(Self.sinoKorean(km)) 킬로미터 통과."
                if let p = paceSecPerKm {
                    let t = Int(p.rounded()), m = t / 60, s = t % 60
                    text += s == 0 ? " 평균 페이스 \(m)분." : " 평균 페이스 \(m)분 \(s)초."
                }
                text += " 잘하고 있어요."
                speak(text)
            }
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
            case .running: self.phase = .active
            case .paused: self.phase = .paused
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
    }
}
