package com.routinist.wear

import android.content.Context
import com.google.android.gms.wearable.Asset
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

/**
 * 완주한 러닝을 Wearable Data Layer 로 폰에 전송.
 *
 * Health Connect 는 Wear OS 에 없으므로, 폰의 WearableListenerService 가 이 DataItem 을 받아
 * ExerciseSessionRecord + ExerciseRoute + Distance + Calories 로 Health Connect 에 write 한다.
 *
 * - 요약 필드는 DataMap 에 직접, GPS 경로는 gzip Asset 으로 (DataItem 100KB 제한 회피).
 * - path 에 clientRecordId 를 넣어 재전송 시에도 폰에서 중복 방지 가능.
 * - setUrgent() 로 즉시 동기화, 폰이 꺼져 있으면 재연결 시 store-and-forward 로 전달.
 */
object RunSender {

    const val PATH_PREFIX = "/routinist/run"

    data class CompletedRun(
        val clientRecordId: String,
        val startMs: Long,
        val endMs: Long,
        val distanceMeters: Double,
        val durationSec: Double,
        val calories: Double,
        val avgHr: Double,
        val route: List<DoubleArray>, // [lat, lng, alt, epochMs]
        // v5 (애플 심박존 동등화): 존1~5 체류 초 + 기준 maxHr — 폰이 hr_zones 로 저장
        val zoneSeconds: DoubleArray = DoubleArray(5),
        val maxHr: Double = 0.0,
    )

    fun send(context: Context, run: CompletedRun) {
        val routeJson = buildRouteJson(run.route)
        val asset = Asset.createFromBytes(gzip(routeJson.toByteArray(Charsets.UTF_8)))

        val req = PutDataMapRequest.create("$PATH_PREFIX/${run.clientRecordId}").apply {
            dataMap.putString("clientRecordId", run.clientRecordId)
            dataMap.putLong("startTime", run.startMs)
            dataMap.putLong("endTime", run.endMs)
            dataMap.putDouble("distanceMeters", run.distanceMeters)
            dataMap.putDouble("durationSec", run.durationSec)
            dataMap.putDouble("calories", run.calories)
            dataMap.putDouble("avgHr", run.avgHr)
            dataMap.putLong("sentAt", run.endMs) // DataItem 변경 보장
            dataMap.putAsset("route", asset)
            // v5: 심박존 — 애플워치 러닝과 동일하게 활동 상세 심박존 카드 표시용.
            // DataMap 에 double 배열 타입이 없어 JSON 문자열로 전달.
            dataMap.putString("zoneSeconds", run.zoneSeconds.joinToString(prefix = "[", postfix = "]", separator = ","))
            dataMap.putDouble("maxHr", run.maxHr)
        }.asPutDataRequest().setUrgent()

        Wearable.getDataClient(context).putDataItem(req)
    }

    private fun buildRouteJson(route: List<DoubleArray>): String {
        val sb = StringBuilder("[")
        route.forEachIndexed { i, p ->
            if (i > 0) sb.append(",")
            sb.append("[").append(p[0]).append(",").append(p[1]).append(",")
                .append(p[2]).append(",").append(p[3].toLong()).append("]")
        }
        sb.append("]")
        return sb.toString()
    }

    private fun gzip(bytes: ByteArray): ByteArray {
        val bos = ByteArrayOutputStream()
        GZIPOutputStream(bos).use { it.write(bytes) }
        return bos.toByteArray()
    }
}
