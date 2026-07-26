package com.routinist.app

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONArray
import org.json.JSONObject
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
    }
}

object RunPath {
    const val PREFIX = "/routinist/run"
}
