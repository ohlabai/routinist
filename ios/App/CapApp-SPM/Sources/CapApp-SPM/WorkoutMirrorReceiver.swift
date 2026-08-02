import Foundation
import HealthKit

// 워치 러닝 → 폰 잠금화면 Live Activity 미러 (2026-08-02 hans 승인 — Runna·애플 운동앱 방식).
//
// 구조 (WWDC23 10023 "Build a multi-device workout app"):
// - 워치가 HKWorkoutSession.startMirroringToCompanionDevice() 호출
// - 시스템이 이 앱을 백그라운드로 깨우고 (종료 상태여도) workoutSessionMirroringStartHandler 호출
// - 그 창구에서 Live Activity 시작이 공식 허용됨 (10초) — ActivityKit 포그라운드 제약의 예외
// - 이후 워치가 sendToRemoteWorkoutSession 으로 보내는 지표 페이로드 {e,d,p,h} 로 LA 갱신
// - 세션 상태 (pause/resume/end) 는 미러 세션 delegate 로 자동 전달
//
// 주의: HKWorkoutSession 은 iOS 17+ 에만 존재 — 클래스 전체 @available 가드.
// 폰 GPS 러닝 (RunSessionPlugin) 과 워치 러닝을 "동시에" 하는 병리적 케이스는
// 같은 activity 를 두 주체가 갱신하게 되지만, 실사용 시나리오가 아니라 가드하지 않는다.
@available(iOS 17.0, *)
public final class WorkoutMirrorReceiver: NSObject {

    public static let shared = WorkoutMirrorReceiver()

    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var startedAtMs: Double = 0
    private var lastElapsed: Double = 0
    private var lastDistance: Double = 0
    private var lastPace: Double?
    private var lastHeartRate: Double?

    /// AppDelegate didFinishLaunching 에서 1회 — 백그라운드 launch 가 핸들러에 닿도록 최대한 일찍.
    public func register() {
        healthStore.workoutSessionMirroringStartHandler = { [weak self] mirrored in
            self?.attach(mirrored)
        }
    }

    private func attach(_ mirrored: HKWorkoutSession) {
        NSLog("[WorkoutMirror] mirrored session attached (state=\(mirrored.state.rawValue))")
        session = mirrored
        mirrored.delegate = self
        // 시작 시각은 첫 페이로드의 elapsed 로 보정되기 전까지 근사치 (위젯의 시작 라벨용)
        startedAtMs = Date().timeIntervalSince1970 * 1000
        lastElapsed = 0
        lastDistance = 0
        lastPace = nil
        lastHeartRate = nil
        // 10초 창구 안에서 즉시 LA 시작 — 지표는 워치 첫 페이로드가 곧바로 채운다
        RunLiveActivity.sessionStarted(snapshot(state: stateRaw(mirrored.state)))
    }

    private func stateRaw(_ s: HKWorkoutSessionState) -> String {
        s == .paused ? "paused" : "running"
    }

    private func snapshot(state: String) -> RunLiveActivity.Snapshot {
        RunLiveActivity.Snapshot(
            distanceM: lastDistance,
            activeSec: lastElapsed,
            paceSecPerKm: lastPace,
            stateRaw: state,
            startedAtMs: startedAtMs,
            locale: "ko",
            now: Date(),
            heartRate: lastHeartRate
        )
    }

    private func detach() {
        RunLiveActivity.sessionEnded()
        session = nil
    }
}

@available(iOS 17.0, *)
extension WorkoutMirrorReceiver: HKWorkoutSessionDelegate {

    public func workoutSession(_ workoutSession: HKWorkoutSession,
                               didChangeTo toState: HKWorkoutSessionState,
                               from fromState: HKWorkoutSessionState,
                               date: Date) {
        switch toState {
        case .running:
            // 시작 시각 보정 (재개 포함 근사 — 표시용이라 충분)
            startedAtMs = min(startedAtMs, (date.timeIntervalSince1970 - lastElapsed) * 1000)
            RunLiveActivity.sessionUpdated(snapshot(state: "running"), force: true)
        case .paused:
            RunLiveActivity.sessionUpdated(snapshot(state: "paused"), force: true)
        case .ended, .stopped:
            detach()
        default:
            break
        }
    }

    public func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        NSLog("[WorkoutMirror] session failed: \(error)")
        detach()
    }

    /// 워치 지표 페이로드 {e: 경과초, d: 거리m, p: 페이스 sec/km (0=없음), h: 심박}
    public func workoutSession(_ workoutSession: HKWorkoutSession,
                               didReceiveDataFromRemoteWorkoutSession data: [Data]) {
        for chunk in data {
            guard let obj = try? JSONSerialization.jsonObject(with: chunk) as? [String: Any] else { continue }
            if let e = obj["e"] as? Double { lastElapsed = e }
            if let d = obj["d"] as? Double { lastDistance = d }
            if let p = obj["p"] as? Double { lastPace = p > 0 ? p : nil }
            if let h = obj["h"] as? Double { lastHeartRate = h > 0 ? h : nil }
        }
        // 첫 페이로드에서 시작 시각을 실제값으로 보정
        startedAtMs = min(startedAtMs, (Date().timeIntervalSince1970 - lastElapsed) * 1000)
        RunLiveActivity.sessionUpdated(snapshot(state: stateRaw(workoutSession.state)))
    }
}
