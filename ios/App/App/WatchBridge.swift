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

    override private init() {
        super.init()
        speech.delegate = self   // v19: 발화 종료 시 세션 해제 (덕킹 원복 — f314219 패턴)
    }

    /// v19 (음성 무음 진단): 릴레이는 "폰에 이어폰/BT 가 물려 있을 때"만 의미가 있다.
    /// 폰 내장 스피커뿐이면 주머니 속에서 울려 사실상 안 들림 — 워치가 직접 말하는 게 맞다.
    fileprivate func relayRouteAvailable() -> Bool {
        let useful: Set<AVAudioSession.Port> = [
            .headphones, .bluetoothA2DP, .bluetoothHFP, .bluetoothLE,
            .airPlay, .carAudio, .usbAudio,
        ]
        return AVAudioSession.sharedInstance().currentRoute.outputs.contains { useful.contains($0.portType) }
    }

    /// 발화 시도 — 세션 활성화가 실패하면 false (백그라운드에서 소리 못 내는 상태).
    @discardableResult
    fileprivate func speakRelayed(_ text: String) -> Bool {
        // AppDelegate 가 카테고리 등록 (.playback + .spokenAudio + .duckOthers) — 발화 직전 lazy activate
        do {
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            NSLog("[WatchBridge] voice relay setActive failed: \(error)")
            return false
        }
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "ko-KR")
        u.volume = 0.65   // 폰 음성 톤 규칙 (feedback_voice_cue_tuning)
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 0.95
        speech.speak(u)
        return true
    }

    /// 발화 큐가 비면 세션 해제 — 안 하면 첫 릴레이 후 음악이 작아진 채(덕킹) 러닝 내내 유지.
    /// didFinish 직후 isBusy(560030580) 실패가 잦아 백오프 재시도 (RunSessionPlugin f314219 와 동일).
    fileprivate func deactivateIfIdle(attempt: Int = 0) {
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.speech.isSpeaking else { return }
            do {
                try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
            } catch {
                if attempt < 4 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15 * pow(2.0, Double(attempt))) { [weak self] in
                        self?.deactivateIfIdle(attempt: attempt + 1)
                    }
                }
            }
        }
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

    // watch v13: 워치 → 폰 실시간 메시지 (음성 릴레이) — 구버전 워치 (reply 없이 보냄) 호환용
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        if let text = message["voice"] as? String, !text.isEmpty {
            DispatchQueue.main.async { _ = self.speakRelayed(text) }
        }
    }

    // v19: reply 프로토콜 — 폰이 "실제로 소리를 낼 수 있을 때"만 spoken:true.
    // 이어폰/BT 미연결(주머니 스피커)이거나 세션 활성화 실패면 false → 워치가 직접 발화.
    // 기존 무음 버그의 골자: 구 프로토콜은 전달만 되면 성공으로 쳐서 워치 폴백이 영영 안 탔다.
    func session(_ session: WCSession, didReceiveMessage message: [String: Any],
                 replyHandler: @escaping ([String: Any]) -> Void) {
        guard let text = message["voice"] as? String, !text.isEmpty else {
            replyHandler([:])
            return
        }
        DispatchQueue.main.async {
            guard self.relayRouteAvailable() else {
                replyHandler(["spoken": false, "reason": "no-headphones"])
                return
            }
            let ok = self.speakRelayed(text)
            replyHandler(["spoken": ok, "reason": ok ? "ok" : "session-inactive"])
        }
    }
}

extension WatchBridge: AVSpeechSynthesizerDelegate {
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        deactivateIfIdle()
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        deactivateIfIdle()
    }
}
