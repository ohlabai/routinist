package com.routinist.app

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.speech.tts.TextToSpeech
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
     */
    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != "/routinist/voice") { super.onMessageReceived(event); return }
        try {
            val obj = JSONObject(String(event.data))
            val id = obj.optLong("id")
            val text = obj.optString("text")
            if (text.isEmpty()) return
            if (!headphoneRouteAvailable()) return   // 주머니 스피커 발화 방지 — 워치 폴백에 맡김
            speakRelayed(text)
            Wearable.getMessageClient(this)
                .sendMessage(event.sourceNodeId, "/routinist/voice-ack", id.toString().toByteArray())
        } catch (_: Exception) { /* 릴레이 실패 = 워치 폴백 (1.2s) */ }
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
        // 릴레이 TTS — 서비스 인스턴스가 짧게 살다 죽어도 엔진 재초기화 비용 절약
        @Volatile private var sharedTts: TextToSpeech? = null
        @Volatile private var ttsReady = false
    }
}

object RunPath {
    const val PREFIX = "/routinist/run"
}
