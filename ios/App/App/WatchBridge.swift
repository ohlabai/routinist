// iPhone → Watch 데이터 push (watch v9).
// 웹 레이어 (Capacitor Preferences) 가 UserDefaults "CapacitorStorage.watch_ctx" 에
// JSON 으로 심어둔 값 {maxHr, challengeProgressKm, challengeTargetKm} 을
// WCSession applicationContext 로 워치에 전달. 워치 쪽 수신 = ConnectivityStore.

import Foundation
import WatchConnectivity

final class WatchBridge: NSObject {
    static let shared = WatchBridge()

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func pushContextIfPossible() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
        guard let raw = UserDefaults.standard.string(forKey: "CapacitorStorage.watch_ctx"),
              let data = raw.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        var ctx: [String: Any] = [:]
        if let m = obj["maxHr"] as? Double, m > 100, m < 230 { ctx["maxHr"] = m }
        if let t = obj["challengeTargetKm"] as? Double, t > 0 {
            ctx["challengeTargetKm"] = t
            ctx["challengeProgressKm"] = (obj["challengeProgressKm"] as? Double) ?? 0
        }
        guard !ctx.isEmpty else { return }
        do { try session.updateApplicationContext(ctx) }
        catch { NSLog("[WatchBridge] updateApplicationContext failed: \(error)") }
    }
}

extension WatchBridge: WCSessionDelegate {
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        // 활성화 완료 직후 한 번 push (앱 켠 채 워치 설치한 경우 등)
        DispatchQueue.main.async { self.pushContextIfPossible() }
    }
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { session.activate() }
}
