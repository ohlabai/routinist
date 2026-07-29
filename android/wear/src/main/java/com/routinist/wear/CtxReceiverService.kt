package com.routinist.wear

import android.content.Context
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject

/**
 * 폰 → 워치 컨텍스트 수신 (v3) — iOS WatchBridge(WCSession applicationContext)의 대응물.
 * 폰 MainActivity 가 onResume 때 CapacitorStorage.watch_ctx(JSON)를 DataItem 으로 push,
 * 여기서 max_hr 를 SharedPreferences 에 저장 → WorkoutManager 심박존 정밀화.
 */
class CtxReceiverService : WearableListenerService() {

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        for (event in dataEvents) {
            if (event.type != DataEvent.TYPE_CHANGED) continue
            if (event.dataItem.uri.path != "/routinist/ctx") continue
            try {
                val json = DataMapItem.fromDataItem(event.dataItem).dataMap.getString("json") ?: continue
                val obj = JSONObject(json)
                val maxHr = obj.optDouble("maxHr", 0.0)
                if (maxHr in 120.0..230.0) {
                    getSharedPreferences("wear_workout", Context.MODE_PRIVATE)
                        .edit().putFloat(WorkoutManager.KEY_MAX_HR, maxHr.toFloat()).apply()
                    WorkoutManager.loadMaxHr()
                }
            } catch (_: Exception) { /* 개별 이벤트 실패 무시 */ }
        }
    }
}
