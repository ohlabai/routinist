package com.routinist.wear

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong

/**
 * 음성 이어폰 릴레이 (애플워치 v13/v19 이식, 2026-08-02).
 * 폰에 이어폰/BT 오디오가 연결돼 있으면 폰이 발화 — 음악 듣는 그 이어폰에서 안내.
 *
 * 프로토콜 (애플 reply 패턴의 Wear 대응 — "전달됨 = 성공" 함정 방지):
 *  - 워치 → 폰: /routinist/voice  {id, text}
 *  - 폰: BT/유선 오디오 라우트가 있을 때만 TTS + /routinist/voice-ack {id} 회신
 *  - 워치: 1.2초 내 ack 없으면 로컬 TTS 폴백 (ack 오면 로컬 생략)
 */
object VoiceRelay {

    private const val PATH_VOICE = "/routinist/voice"
    private const val PATH_ACK = "/routinist/voice-ack"

    private val idGen = AtomicLong(0)
    private val handler = Handler(Looper.getMainLooper())
    private val pending = HashMap<Long, Runnable>()
    private var listenerRegistered = false
    // 폰이 못 말하는 상태로 판정되면 잠시 릴레이 휴식 (카운트다운 연속 발화 왕복 지연 방지)
    private var relayDisabledUntil = 0L

    private val ackListener = MessageClient.OnMessageReceivedListener { event ->
        if (event.path != PATH_ACK) return@OnMessageReceivedListener
        val id = String(event.data).toLongOrNull() ?: return@OnMessageReceivedListener
        synchronized(pending) {
            pending.remove(id)?.let { handler.removeCallbacks(it) }
        }
    }

    fun speakViaPhoneOrLocal(context: Context?, text: String, speakLocal: (Boolean) -> Unit) {
        val ctx = context ?: run { speakLocal(true); return }
        val now = System.currentTimeMillis()
        if (now < relayDisabledUntil) { speakLocal(true); return }

        if (!listenerRegistered) {
            listenerRegistered = true
            runCatching { Wearable.getMessageClient(ctx).addListener(ackListener) }
        }

        val id = idGen.incrementAndGet()
        val fallback = Runnable {
            synchronized(pending) { pending.remove(id) }
            relayDisabledUntil = System.currentTimeMillis() + 180_000   // 3분 휴식 후 재시도
            speakLocal(true)
        }
        synchronized(pending) { pending[id] = fallback }
        handler.postDelayed(fallback, 1200)

        val payload = JSONObject().put("id", id).put("text", text).toString().toByteArray()
        Wearable.getNodeClient(ctx).connectedNodes
            .addOnSuccessListener { nodes ->
                val node = nodes.firstOrNull()
                if (node == null) {
                    // 페어링 노드 없음 → 즉시 로컬
                    synchronized(pending) { pending.remove(id)?.let { handler.removeCallbacks(it); handler.post { speakLocal(true) } } }
                    return@addOnSuccessListener
                }
                Wearable.getMessageClient(ctx).sendMessage(node.id, PATH_VOICE, payload)
                    .addOnFailureListener {
                        synchronized(pending) { pending.remove(id)?.let { handler.removeCallbacks(it); handler.post { speakLocal(true) } } }
                    }
            }
            .addOnFailureListener {
                synchronized(pending) { pending.remove(id)?.let { handler.removeCallbacks(it); handler.post { speakLocal(true) } } }
            }
    }
}
