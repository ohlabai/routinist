import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

// Live Activity 공유 계약 — 이 파일은 두 타겟에 "동일 파일" 로 컴파일된다:
//   1) CapApp-SPM (메인 앱 — RunSessionPlugin 이 request/update)
//   2) RoutinistLiveActivity appex (잠금화면/Dynamic Island 렌더링)
// ActivityKit 은 모듈명 없는 타입명으로 앱↔익스텐션 activity 를 매칭하므로
// 모듈이 달라도 (CapApp_SPM vs RoutinistLiveActivity) 동작한다. 필드를 바꾸면
// 반드시 양쪽을 같이 빌드해서 인코딩 계약이 어긋나지 않게 할 것.
#if canImport(ActivityKit)
@available(iOS 16.1, *)
public struct RunActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// 총 거리 (m) = gps + gap-fill (엔진 계약 §4 의 distanceM 그대로).
        public var distanceM: Double
        /// fold 된 활동 시간 (초) — paused/autoPaused 일 때 정지 표시용.
        public var activeSec: Double
        /// running 일 때만 non-nil: now - activeSec. 뷰가 Text(timerInterval:) 로
        /// 자체 틱하므로 초당 update 없이도 시간이 흐른다.
        public var timerBasis: Date?
        /// 평균 페이스 (sec/km). 10m 미만이면 nil (엔진과 동일 규칙).
        public var paceSecPerKm: Double?
        /// running | paused | autoPaused (SessionState.rawValue).
        public var sessionState: String
        /// v22 미러 고도화 (2026-08-02): 워치 러닝의 실시간 심박 — 폰 GPS 러닝은 nil.
        public var heartRate: Double?

        public init(distanceM: Double, activeSec: Double, timerBasis: Date?,
                    paceSecPerKm: Double?, sessionState: String, heartRate: Double? = nil) {
            self.distanceM = distanceM
            self.activeSec = activeSec
            self.timerBasis = timerBasis
            self.paceSecPerKm = paceSecPerKm
            self.sessionState = sessionState
            self.heartRate = heartRate
        }
    }

    /// 세션 고정 값 — 시작 후 불변.
    public var startedAtMs: Double
    /// "ko" | "en" — 위젯 라벨 언어 (앱 설정을 따라간다).
    public var locale: String

    public init(startedAtMs: Double, locale: String) {
        self.startedAtMs = startedAtMs
        self.locale = locale
    }
}
#endif
