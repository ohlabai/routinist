import Foundation
import UIKit
#if canImport(ActivityKit)
import ActivityKit
#endif

// 러닝 Live Activity 매니저 — RunSessionPlugin 엔진의 상태 전이/tick 에서 호출된다.
//
// 설계 계약:
// - 앱 최소 타겟이 iOS 15 라 모든 진입점을 #available(iOS 16.1) 로 런타임 가드.
// - 갱신은 전부 로컬 (push 불필요 — 러닝 중엔 location 백그라운드 모드로 앱이 생존).
// - 시간 표시는 ContentState.timerBasis + 위젯의 Text(timerInterval:) 조합이라
//   초당 update 없이도 잠금화면 타이머가 스스로 흐른다. update 는 거리 10m 변화 /
//   상태 전이 / 15초 경과 때만 밀어 배터리·렌더 비용을 줄인다.
// - Activity.request 는 foreground 에서만 성공 — OS location relaunch 로 백그라운드
//   복원된 세션은 request 가 실패할 수 있어, didBecomeActive 에서 재시도한다.
//   (앱 프로세스가 죽어도 기존 activity 는 OS 에 살아있으므로 우선 재입양(adopt).)
enum RunLiveActivity {

    struct Snapshot {
        var distanceM: Double
        var activeSec: Double
        var paceSecPerKm: Double?
        var stateRaw: String        // running | paused | autoPaused
        var startedAtMs: Double
        var locale: String
        var now: Date
        var heartRate: Double? = nil   // v22: 워치 미러 심박 (폰 러닝 nil)
    }

    /// 세션 시작/복원 — 살아있는 activity 가 있으면 입양, 없으면 신규 request.
    static func sessionStarted(_ snapshot: Snapshot) {
        if #available(iOS 16.1, *) {
            RunLiveActivityController.shared.startOrAdopt(snapshot)
        }
    }

    /// tick/상태 전이 — 내부에서 스로틀. force=true 는 상태 전이용 (즉시 반영).
    static func sessionUpdated(_ snapshot: Snapshot, force: Bool = false) {
        if #available(iOS 16.1, *) {
            RunLiveActivityController.shared.update(snapshot, force: force)
        }
    }

    /// 세션 종료 — 잠금화면에서 즉시 제거.
    static func sessionEnded() {
        if #available(iOS 16.1, *) {
            RunLiveActivityController.shared.endAll()
        }
    }

    /// 진단용 — LA 권한이 켜져 있나 (설정에서 끄면 request 자체가 무의미).
    static var activitiesEnabled: Bool {
        if #available(iOS 16.1, *) { return ActivityAuthorizationInfo().areActivitiesEnabled }
        return false
    }

    /// 진단용 — 지금 살아있는 activity 가 있나.
    static var hasLiveActivity: Bool {
        if #available(iOS 16.1, *) { return !Activity<RunActivityAttributes>.activities.isEmpty }
        return false
    }

    /// 앱 시작 시 폰 세션이 idle 인데 남아있는 고아 activity 정리 (크래시 잔존물).
    ///
    /// 2026-08-13 fix (hans "워치로 달렸는데 폰 잠금화면에 아무것도 안 뜬다"):
    /// **워치 러닝 중이면 고아가 아니다.** 워치가 미러링을 시작하면 시스템이 폰 앱을 깨우고
    /// WorkoutMirrorReceiver 가 LA 를 만드는데, 같은 실행에서 RunSessionPlugin.load() 가
    /// "폰 세션 idle" 을 보고 endAll() 로 그걸 지워버렸다. endAll 은 wantsActive=false 까지
    /// 세팅해서 이후 워치 지표 update() 가 전부 early-return → 러닝 내내 LA 가 안 뜬다.
    /// → 이 프로세스에서 누가 이미 점유(wantsActive)했으면 손대지 않는다.
    static func endOrphans() {
        if #available(iOS 16.1, *) {
            RunLiveActivityController.shared.endIfUnowned()
        }
    }
}

#if canImport(ActivityKit)
@available(iOS 16.1, *)
private final class RunLiveActivityController {

    static let shared = RunLiveActivityController()

    /// 모든 상태는 이 serial queue 로 일원화 (호출측: 엔진 stateQueue + main 옵저버).
    private let queue = DispatchQueue(label: "com.routinist.live-activity")

    private var activity: Activity<RunActivityAttributes>?
    private var wantsActive = false
    private var lastSnapshot: RunLiveActivity.Snapshot?
    private var lastSentDistanceM: Double = -1
    private var lastSentState = ""
    private var lastSentAt = Date.distantPast

    private enum Tuning {
        static let minDistanceDeltaM: Double = 10
        static let maxStaleSec: TimeInterval = 15
    }

    private init() {
        // 백그라운드 복원 세션의 request 실패 대비 — foreground 진입 시 재시도.
        NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            guard let self = self else { return }
            self.queue.async {
                guard self.wantsActive, self.activity == nil, let snap = self.lastSnapshot else { return }
                self.requestNew(snap)
            }
        }
    }

    func startOrAdopt(_ snapshot: RunLiveActivity.Snapshot) {
        queue.async {
            self.wantsActive = true
            self.lastSnapshot = snapshot
            let existing = Activity<RunActivityAttributes>.activities
            if let first = existing.first {
                // 앱 재시작 전의 activity 재입양 + 혹시 중복이면 나머지 정리.
                self.activity = first
                for extra in existing.dropFirst() {
                    Task { await extra.end(dismissalPolicy: .immediate) }
                }
                self.push(snapshot)
            } else {
                self.requestNew(snapshot)
            }
        }
    }

    func update(_ snapshot: RunLiveActivity.Snapshot, force: Bool) {
        queue.async {
            guard self.wantsActive else { return }
            self.lastSnapshot = snapshot
            guard self.activity != nil else { return }   // request 실패 상태 — 옵저버가 재시도
            if !force,
               snapshot.stateRaw == self.lastSentState,
               abs(snapshot.distanceM - self.lastSentDistanceM) < Tuning.minDistanceDeltaM,
               snapshot.now.timeIntervalSince(self.lastSentAt) < Tuning.maxStaleSec {
                return
            }
            self.push(snapshot)
        }
    }

    func endAll() {
        queue.async { self.endAllLocked() }
    }

    /// 고아 정리 전용 — 이 프로세스에서 누가 점유 중이면(워치 미러가 먼저 붙은 경우) no-op.
    func endIfUnowned() {
        queue.async {
            guard !self.wantsActive else { return }
            self.endAllLocked()
        }
    }

    /// queue 전용.
    private func endAllLocked() {
        wantsActive = false
        lastSnapshot = nil
        let toEnd = Activity<RunActivityAttributes>.activities
        activity = nil
        lastSentState = ""
        lastSentDistanceM = -1
        lastSentAt = .distantPast
        for act in toEnd {
            Task { await act.end(dismissalPolicy: .immediate) }
        }
    }

    // MARK: - 내부 (queue 전용)

    private func requestNew(_ snapshot: RunLiveActivity.Snapshot) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let attributes = RunActivityAttributes(
            startedAtMs: snapshot.startedAtMs, locale: snapshot.locale)
        do {
            activity = try Activity.request(
                attributes: attributes,
                contentState: Self.contentState(snapshot),
                pushType: nil
            )
            lastSentState = snapshot.stateRaw
            lastSentDistanceM = snapshot.distanceM
            lastSentAt = snapshot.now
        } catch {
            // 백그라운드 request 등 — didBecomeActive 재시도에 맡긴다.
            NSLog("[RunLiveActivity] request failed: \(error)")
        }
    }

    private func push(_ snapshot: RunLiveActivity.Snapshot) {
        guard let activity = activity else { return }
        lastSentState = snapshot.stateRaw
        lastSentDistanceM = snapshot.distanceM
        lastSentAt = snapshot.now
        let state = Self.contentState(snapshot)
        Task { await activity.update(using: state) }
    }

    private static func contentState(_ snapshot: RunLiveActivity.Snapshot) -> RunActivityAttributes.ContentState {
        RunActivityAttributes.ContentState(
            distanceM: snapshot.distanceM,
            activeSec: snapshot.activeSec,
            timerBasis: snapshot.stateRaw == "running"
                ? snapshot.now.addingTimeInterval(-snapshot.activeSec) : nil,
            paceSecPerKm: snapshot.paceSecPerKm,
            sessionState: snapshot.stateRaw,
            heartRate: snapshot.heartRate
        )
    }
}
#endif

// MARK: - 시뮬레이터 프리뷰 하니스 (워치 -uipreview-* 패턴 계승)

/// DEBUG 빌드에서 `-liveactivity-preview` launch arg 로 가짜 activity 를 띄운다 —
/// 잠금화면/Dynamic Island 캡처 검증용. AppDelegate.didBecomeActive 에서 호출.
public enum RunLiveActivityDebug {
    public static func startPreviewIfRequested() {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("-liveactivity-preview") || args.contains("-liveactivity-preview-paused") else { return }
        if #available(iOS 16.1, *) {
            let now = Date()
            let paused = args.contains("-liveactivity-preview-paused")
            RunLiveActivity.sessionStarted(RunLiveActivity.Snapshot(
                distanceM: 5236,
                activeSec: 1687,
                paceSecPerKm: 322,
                stateRaw: paused ? "autoPaused" : "running",
                startedAtMs: now.timeIntervalSince1970 * 1000 - 1_687_000,
                locale: "ko",
                now: now
            ))
        }
        #endif
    }
}
