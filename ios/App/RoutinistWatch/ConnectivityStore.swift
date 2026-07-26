// iPhone ↔ Watch 데이터 동기화 (v9, Phase 2 착수).
// iPhone Routinist 가 applicationContext 로 밀어주는 값을 수신·보관:
//   maxHr (프로필 최대심박 — 심박 존 정밀화), challengeProgressKm/TargetKm (이달 챌린지).
// 폰이 없거나 미동기화면 각 기능이 자체 폴백 (심박존 = 220-나이, 챌린지 칩 = 숨김).

import Foundation
import WatchConnectivity

final class ConnectivityStore: NSObject, ObservableObject {
    static let shared = ConnectivityStore()

    @Published var syncedMaxHr: Double?
    @Published var challengeProgressKm: Double?
    @Published var challengeTargetKm: Double?

    private override init() {
        super.init()
        loadCached()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    private func loadCached() {
        let d = UserDefaults.standard
        let m = d.double(forKey: "sync.maxHr")
        if m > 100 { syncedMaxHr = m }
        let t = d.double(forKey: "sync.challengeTargetKm")
        if t > 0 {
            challengeTargetKm = t
            challengeProgressKm = d.double(forKey: "sync.challengeProgressKm")
        }
    }

    @MainActor private func apply(_ ctx: [String: Any]) {
        let d = UserDefaults.standard
        if let m = ctx["maxHr"] as? Double, m > 100, m < 230 {
            syncedMaxHr = m
            d.set(m, forKey: "sync.maxHr")
        }
        if let t = ctx["challengeTargetKm"] as? Double, t > 0 {
            challengeTargetKm = t
            d.set(t, forKey: "sync.challengeTargetKm")
            let p = (ctx["challengeProgressKm"] as? Double) ?? 0
            challengeProgressKm = p
            d.set(p, forKey: "sync.challengeProgressKm")
        }
    }
}

extension ConnectivityStore: WCSessionDelegate {
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        let ctx = session.receivedApplicationContext
        if !ctx.isEmpty { Task { @MainActor in self.apply(ctx) } }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in self.apply(applicationContext) }
    }
}
