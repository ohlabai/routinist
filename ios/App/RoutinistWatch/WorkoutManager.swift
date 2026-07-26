// Routinist Watch — 러닝 워크아웃 엔진 (Phase 1, 2026-07-26).
// HKWorkoutSession + HKLiveWorkoutBuilder: 시작/일시정지/종료, 거리·심박·페이스 실시간.
// 종료 시 HealthKit 에 저장 → iPhone 앱의 기존 Health sync 가 자동으로 가져간다 (서버 작업 0).

import Foundation
import HealthKit

@MainActor
final class WorkoutManager: NSObject, ObservableObject {
    static let shared = WorkoutManager()

    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    // ── 화면 상태 ──────────────────────────────────────────────
    enum Phase { case idle, requesting, active, paused, ended }
    @Published var phase: Phase = .idle
    @Published var elapsedSeconds: TimeInterval = 0
    @Published var distanceMeters: Double = 0
    @Published var heartRate: Double = 0
    @Published var activeCalories: Double = 0
    @Published var authDenied = false
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
        if args.contains("-uipreview-metrics") || args.contains("-uipreview-controls") {
            phase = .active; elapsedSeconds = 1264; distanceMeters = 4230; heartRate = 156; activeCalories = 231
        } else if args.contains("-uipreview-paused") {
            phase = .paused; elapsedSeconds = 1264; distanceMeters = 4230; heartRate = 121; activeCalories = 231
        } else if args.contains("-uipreview-summary") {
            summary = WorkoutSummary(distanceMeters: 5012, elapsedSeconds: 1650, avgHeartRate: 152, calories: 320)
            phase = .ended
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
                if ok { self.startWorkout() } else { self.authDenied = true; self.phase = .idle }
            }
        }
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
        summary = nil
    }

    // ── 통계 반영 ─────────────────────────────────────────────
    private func updateForStatistics(_ statistics: HKStatistics?) {
        guard let statistics else { return }
        switch statistics.quantityType {
        case HKQuantityType.quantityType(forIdentifier: .heartRate):
            let unit = HKUnit.count().unitDivided(by: .minute())
            heartRate = statistics.mostRecentQuantity()?.doubleValue(for: unit) ?? heartRate
        case HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning):
            distanceMeters = statistics.sumQuantity()?.doubleValue(for: .meter()) ?? distanceMeters
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
            self.elapsedSeconds = workoutBuilder.elapsedTime
        }
    }

    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {
        Task { @MainActor in self.elapsedSeconds = workoutBuilder.elapsedTime }
    }
}
