package com.routinist.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.net.Uri
import android.speech.tts.TextToSpeech
import androidx.core.app.NotificationCompat
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.zip.GZIPInputStream

/**
 * 갤럭시 워치(:wear) 가 Wearable Data Layer 로 보낸 완주 러닝 수신.
 *
 * Health Connect 는 Wear OS 에 없고(폰에 WRITE 권한 재추가는 Play 헬스 재심사 리스크),
 * 나이키·스트라바처럼 워치 기록을 앱 자체 저장소(Supabase)로 직행시킨다.
 *
 * 이 서비스는 수신 데이터를 Capacitor Preferences(SharedPreferences "CapacitorStorage")의
 * watch_pending_runs 큐에 쌓기만 한다. 앱이 포그라운드로 오면 JS(watch-runs.ts)가 이 큐를
 * 읽어 기존 activities insert 플로우로 저장한다. (WebView 와 동일 프로세스 → 큐 공유됨)
 */
class WatchRunReceiverService : WearableListenerService() {

    /**
     * 워치 음성 릴레이 (2026-08-02, 애플워치 v13/v19 이식):
     * /routinist/voice {id,text} — 폰에 이어폰/BT 오디오가 연결돼 있을 때만
     * TTS 발화 + /routinist/voice-ack {id} 회신. 라우트 없으면 무응답 → 워치가 로컬 발화.
     *
     * 라이브 미러 (2026-08-03, 애플워치 v22 동등화):
     * /routinist/live {e,d,p,h,state,ts} — 잠금화면 알림 갱신 + watch_live_run prefs
     * (/track "워치에서 달리는 중" 패널). /routinist/live-end — 알림·prefs 즉시 제거.
     */
    override fun onMessageReceived(event: MessageEvent) {
        when (event.path) {
            "/routinist/voice" -> try {
                val obj = JSONObject(String(event.data))
                val id = obj.optLong("id")
                val text = obj.optString("text")
                if (text.isEmpty()) return
                if (!headphoneRouteAvailable()) return   // 주머니 스피커 발화 방지 — 워치 폴백에 맡김
                speakRelayed(text)
                Wearable.getMessageClient(this)
                    .sendMessage(event.sourceNodeId, "/routinist/voice-ack", id.toString().toByteArray())
            } catch (_: Exception) { /* 릴레이 실패 = 워치 폴백 (1.2s) */ }

            "/routinist/live" -> try {
                val raw = String(event.data)
                // /track 패널용 — @capacitor/preferences (Android = SharedPreferences "CapacitorStorage")
                getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                    .edit().putString("watch_live_run", raw).apply()
                showLiveNotification(JSONObject(raw))
            } catch (_: Exception) { /* 미러 실패는 조용히 — 다음 틱에 복구 */ }

            "/routinist/live-end" -> {
                getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                    .edit().remove("watch_live_run").apply()
                (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                    .cancel(LIVE_NOTIFICATION_ID)
            }

            else -> super.onMessageReceived(event)
        }
    }

    /** 잠금화면 라이브 알림 — iOS Live Activity 카드 대응. 신호 끊기면 30s 후 자동 소멸. */
    private fun showLiveNotification(obj: JSONObject) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(LIVE_CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(LIVE_CHANNEL_ID, "워치 러닝 실시간", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "갤럭시 워치로 달리는 동안 잠금화면에 시간·거리·페이스를 보여줘요"
                    setShowBadge(false)
                },
            )
        }
        val e = obj.optDouble("e", 0.0).toLong()
        val km = obj.optDouble("d", 0.0) / 1000.0
        val p = obj.optDouble("p", 0.0)
        val h = obj.optDouble("h", 0.0)
        val paused = obj.optString("state") == "paused"
        val time = if (e >= 3600) "%d:%02d:%02d".format(e / 3600, (e % 3600) / 60, e % 60)
        else "%02d:%02d".format(e / 60, e % 60)
        val pace = if (p > 0) "%d'%02d\"".format(p.toInt() / 60, p.toInt() % 60) else "-'--\""
        val text = buildString {
            append("%.2f km · %s · %s/km".format(km, time, pace))
            if (h > 0) append(" · ♥ ${h.toInt()}")
        }
        val contentIntent = PendingIntent.getActivity(
            this, 1,
            Intent(Intent.ACTION_VIEW, Uri.parse("routinist://track")).setPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, LIVE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_run)
            .setContentTitle(if (paused) "⌚ 워치에서 잠시 쉬는 중" else "⌚ 워치에서 달리는 중")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(30_000)   // 워치 신호 끊기면 자동 소멸
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
        nm.notify(LIVE_NOTIFICATION_ID, notification)
    }

    private fun headphoneRouteAvailable(): Boolean {
        val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        return am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
            it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
            it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
            it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
            it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
            it.type == AudioDeviceInfo.TYPE_USB_HEADSET ||
            it.type == AudioDeviceInfo.TYPE_BLE_HEADSET
        }
    }

    private fun speakRelayed(text: String) {
        synchronized(WatchRunReceiverService::class.java) {
            val existing = sharedTts
            if (existing != null && ttsReady) {
                existing.speak(text, TextToSpeech.QUEUE_ADD, null, text)
                return
            }
            if (existing == null) {
                sharedTts = TextToSpeech(applicationContext) { status ->
                    ttsReady = status == TextToSpeech.SUCCESS
                    if (ttsReady) {
                        sharedTts?.language = Locale.KOREAN
                        sharedTts?.speak(text, TextToSpeech.QUEUE_ADD, null, text)
                    }
                }
            }
        }
    }

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        for (event in dataEvents) {
            if (event.type != DataEvent.TYPE_CHANGED) continue
            val uri = event.dataItem.uri
            if (uri.path?.startsWith(RunPath.PREFIX) != true) continue
            try {
                handleRun(event)
            } catch (_: Exception) {
                // 개별 러닝 처리 실패는 삼킨다 — 다른 이벤트/재전송으로 복구 가능
            }
        }
    }

    private fun handleRun(event: DataEvent) {
        val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap

        // GPS 경로 Asset (gzip JSON "[[lat,lng,alt,ms],...]") → 문자열
        var routeJson = "[]"
        dataMap.getAsset("route")?.let { asset ->
            val resp = Tasks.await(Wearable.getDataClient(this).getFdForAsset(asset))
            resp.inputStream?.use { input ->
                routeJson = GZIPInputStream(input).readBytes().toString(Charsets.UTF_8)
            }
        }

        val run = JSONObject().apply {
            put("clientRecordId", dataMap.getString("clientRecordId"))
            put("startMs", dataMap.getLong("startTime"))
            put("endMs", dataMap.getLong("endTime"))
            put("distanceMeters", dataMap.getDouble("distanceMeters"))
            put("durationSec", dataMap.getDouble("durationSec"))
            put("calories", dataMap.getDouble("calories"))
            put("avgHr", dataMap.getDouble("avgHr"))
            put("route", JSONArray(routeJson))
            // v5 (심박존 동등화): 워치 존1~5 체류 초 (JSON 문자열) — JS 가 hr_zones 로 저장
            dataMap.getString("zoneSeconds")?.let { zs ->
                runCatching { put("zoneSeconds", JSONArray(zs)) }
            }
            put("maxHr", dataMap.getDouble("maxHr"))
        }

        enqueue(this, run)

        // 처리 후 DataItem 삭제 — 재부팅/재연결 시 중복 재처리 방지
        Wearable.getDataClient(this).deleteDataItems(event.dataItem.uri)
    }

    private fun enqueue(context: Context, run: JSONObject) {
        // @capacitor/preferences 와 동일한 SharedPreferences 파일 (같은 프로세스라 JS 가 즉시 읽음)
        val prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        synchronized(WatchRunReceiverService::class.java) {
            val arr = JSONArray(prefs.getString(KEY, "[]") ?: "[]")
            val id = run.optString("clientRecordId")
            // clientRecordId 중복이면 건너뜀 (재전송 idempotent)
            for (i in 0 until arr.length()) {
                if (arr.getJSONObject(i).optString("clientRecordId") == id) return
            }
            arr.put(run)
            prefs.edit().putString(KEY, arr.toString()).apply()
        }
    }

    companion object {
        private const val KEY = "watch_pending_runs"
        private const val LIVE_CHANNEL_ID = "watch_live_run"
        private const val LIVE_NOTIFICATION_ID = 7202
        // 릴레이 TTS — 서비스 인스턴스가 짧게 살다 죽어도 엔진 재초기화 비용 절약
        @Volatile private var sharedTts: TextToSpeech? = null
        @Volatile private var ttsReady = false
    }
}

object RunPath {
    const val PREFIX = "/routinist/run"
}
