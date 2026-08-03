package com.routinist.wear

import android.content.Context
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject

/**
 * 러닝 라이브 미러 (애플워치 v22 잠금화면 미러의 Wear 대응, 2026-08-03 hans 동등화).
 *
 * 워치가 러닝 중 5초마다 지표 {e,d,p,h,state,ts} 를 /routinist/live 로 폰에 쏘면
 * 폰 WatchRunReceiverService 가:
 *  1) 잠금화면 알림(시간·거리·페이스·심박)을 갱신하고  — iOS Live Activity 대응
 *  2) Capacitor Preferences watch_live_run 에 기록      — /track "워치에서 달리는 중" 패널
 *
 * fire-and-forget: 폰이 없거나 실패해도 러닝엔 영향 없음. 알림은 timeoutAfter 로
 * 신호가 끊기면 자동 소멸, /track 패널은 ts 신선도(20s)로 자동 강하.
 */
object LiveMirror {

    private const val PATH_LIVE = "/routinist/live"
    private const val PATH_END = "/routinist/live-end"
    private const val THROTTLE_MS = 5_000L

    private var lastSentMs = 0L

    fun tick(context: Context?, state: WorkoutManager.RunState, force: Boolean = false) {
        val ctx = context ?: return
        val now = System.currentTimeMillis()
        if (!force && now - lastSentMs < THROTTLE_MS) return
        lastSentMs = now
        val payload = JSONObject()
            .put("e", state.elapsedSec)
            .put("d", state.distanceMeters)
            .put("p", state.paceSecPerKm ?: 0.0)
            .put("h", state.heartRate)
            .put("state", if (state.phase == WorkoutManager.Phase.ACTIVE) "running" else "paused")
            .put("ts", now)
            .toString().toByteArray()
        send(ctx, PATH_LIVE, payload)
    }

    fun ended(context: Context?) {
        lastSentMs = 0L
        context?.let { send(it, PATH_END, ByteArray(0)) }
    }

    private fun send(ctx: Context, path: String, payload: ByteArray) {
        runCatching {
            Wearable.getNodeClient(ctx).connectedNodes.addOnSuccessListener { nodes ->
                nodes.firstOrNull()?.let { node ->
                    Wearable.getMessageClient(ctx).sendMessage(node.id, path, payload)
                }
            }
        }
    }
}
