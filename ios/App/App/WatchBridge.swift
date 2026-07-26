// iPhone → Watch 데이터 push (watch v9).
// 웹 레이어 (Capacitor Preferences) 가 UserDefaults "CapacitorStorage.watch_ctx" 에
// JSON 으로 심어둔 값 {maxHr, challengeProgressKm, challengeTargetKm} 을
// WCSession applicationContext 로 워치에 전달. 워치 쪽 수신 = ConnectivityStore.

import Foundation
import WatchConnectivity
import AVFoundation

final class WatchBridge: NSObject {
    static let shared = WatchBridge()

    // watch v13: 워치 러닝 음성 릴레이 — 폰에 연결된 이어폰 (음악 듣는 그 이어폰) 에서 발화.
    // 워치가 sendMessage 로 보내면 폰 앱이 백그라운드여도 깨어나 이 핸들러가 받는다.
    private let speech = AVSpeechSynthesizer()

    fileprivate func speakRelayed(_ text: String) {
        // AppDelegate 가 카테고리 등록 (.playback + .spokenAudio + .duckOthers) — 발화 직전 lazy activate
        try? AVAudioSession.sharedInstance().setActive(true)
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "ko-KR")
        u.volume = 0.65   // 폰 음성 톤 규칙 (feedback_voice_cue_tuning)
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 0.95
        speech.speak(u)
    }

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

    // watch v13: 워치 → 폰 실시간 메시지 (음성 릴레이)
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        if let text = message["voice"] as? String, !text.isEmpty {
            DispatchQueue.main.async { self.speakRelayed(text) }
        }
    }
}
