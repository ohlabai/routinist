package com.routinist.app

import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ExerciseRouteResult
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.format.DateTimeFormatter

/**
 * iOS HKWorkoutRoute 와 1:1 매핑되는 Android Health Connect 어댑터.
 *
 * JS 호출은 동일: WorkoutRoute.getRoutes({ startDate, endDate, limit })
 * → [{ startDate, endDate, distance(m), duration(s), coordinates: [lng, lat, elevation, unix_seconds][] }]
 *
 * Health Connect API 차이점:
 *  - 권한: READ_EXERCISE 와 READ_EXERCISE_ROUTE 둘 다 필요 (manifest 등록 + 런타임 grant)
 *  - 라우트는 ExerciseSessionRecord.exerciseRoute?.route 에 포함 (iOS 의 별도 query 와 다르게 inline)
 *  - 거리/시간은 ExerciseSessionRecord 자체에는 없고 별도 DistanceRecord 통합 필요
 *    → MVP 는 ExerciseRoute 첫/끝 timestamp 로 duration 계산, distance 는 coordinates 기반 계산
 */
@CapacitorPlugin(name = "WorkoutRoute")
class WorkoutRoutePlugin : Plugin() {

    private val scope = CoroutineScope(Dispatchers.IO)

    // 2026-07-18 (Play 재제출 — 경로 기능 활성화): READ_EXERCISE_ROUTE 추가.
    // 세션 조회(EXERCISE)와 별개로 경로 좌표 접근엔 이 권한이 필요 — 없으면
    // exerciseRouteResult 가 ConsentRequired/NoData 로 떨어져 지도 경로가 영영 안 채워짐
    // (2026-07-15 Android 리뷰에서 확인된 잠복 버그 1).
    private val permissions = setOf(
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        "android.permission.health.READ_EXERCISE_ROUTE",
    )

    @PluginMethod
    fun requestAuthorization(call: PluginCall) {
        scope.launch {
            try {
                val sdkStatus = HealthConnectClient.getSdkStatus(context)
                if (sdkStatus != HealthConnectClient.SDK_AVAILABLE) {
                    call.reject("Health Connect not available (status=$sdkStatus)")
                    return@launch
                }
                val client = HealthConnectClient.getOrCreate(context)
                val granted = client.permissionController.getGrantedPermissions()
                if (granted.containsAll(permissions)) {
                    call.resolve(JSObject().put("success", true))
                    return@launch
                }
                // 2026-07-18: stub(무조건 false 반환) → 실제 Health Connect 권한 요청 UI 실행
                // (2026-07-15 Android 리뷰 잠복 버그 2). contract 로 intent 를 만들어
                // Capacitor 의 startActivityForResult 로 띄우고 @ActivityCallback 에서 재확인.
                val contract = PermissionController.createRequestPermissionResultContract()
                val intent = contract.createIntent(context, permissions)
                withContext(Dispatchers.Main) {
                    startActivityForResult(call, intent, "hcPermissionResult")
                }
            } catch (e: Exception) {
                call.reject("Authorization failed: ${e.message}", e)
            }
        }
    }

    @ActivityCallback
    private fun hcPermissionResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        scope.launch {
            try {
                val client = HealthConnectClient.getOrCreate(context)
                val granted = client.permissionController.getGrantedPermissions()
                val ok = granted.containsAll(permissions)
                val ret = JSObject().put("success", ok)
                if (!ok) ret.put("missingPermissions", (permissions - granted).joinToString(","))
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Authorization result check failed: ${e.message}", e)
            }
        }
    }

    @PluginMethod
    fun getRoutes(call: PluginCall) {
        val startDateStr = call.getString("startDate") ?: run {
            call.reject("startDate required"); return
        }
        val endDateStr = call.getString("endDate") ?: run {
            call.reject("endDate required"); return
        }
        val limit = call.getInt("limit") ?: 500

        scope.launch {
            try {
                val sdkStatus = HealthConnectClient.getSdkStatus(context)
                if (sdkStatus != HealthConnectClient.SDK_AVAILABLE) {
                    call.reject("Health Connect not available")
                    return@launch
                }

                val client = HealthConnectClient.getOrCreate(context)
                val granted = client.permissionController.getGrantedPermissions()
                if (!granted.containsAll(permissions)) {
                    call.reject("Permissions not granted")
                    return@launch
                }

                val start = Instant.parse(normalizeIso(startDateStr))
                val end = Instant.parse(normalizeIso(endDateStr))

                val request = ReadRecordsRequest(
                    recordType = ExerciseSessionRecord::class,
                    timeRangeFilter = TimeRangeFilter.between(start, end),
                    pageSize = limit,
                )
                val response = client.readRecords(request)

                val routes = JSArray()
                for (session in response.records) {
                    if (session.exerciseType != ExerciseSessionRecord.EXERCISE_TYPE_RUNNING) continue
                    val routeData = session.exerciseRouteResult as? ExerciseRouteResult.Data ?: continue
                    val locations = routeData.exerciseRoute.route
                    if (locations.isEmpty()) continue
                    val coords = JSArray()
                    for (i in locations.indices) {
                        val loc = locations[i]
                        val pt = JSArray()
                        pt.put(loc.longitude)
                        pt.put(loc.latitude)
                        pt.put(loc.altitude?.inMeters ?: 0.0)
                        pt.put(loc.time.epochSecond.toDouble())
                        coords.put(pt)
                    }
                    if (coords.length() == 0) continue

                    val duration = (session.endTime.epochSecond - session.startTime.epochSecond).toDouble()
                    val distance = computeDistanceMeters(coords)

                    val obj = JSObject()
                    obj.put("startDate", DateTimeFormatter.ISO_INSTANT.format(session.startTime))
                    obj.put("endDate", DateTimeFormatter.ISO_INSTANT.format(session.endTime))
                    obj.put("distance", distance)
                    obj.put("duration", duration)
                    obj.put("coordinates", coords)
                    routes.put(obj)
                }

                val ret = JSObject()
                ret.put("routes", routes)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Workout route query failed: ${e.message}", e)
            }
        }
    }

    private fun normalizeIso(s: String): String {
        // ISO with/without fractional seconds 둘 다 허용. trailing Z 보장.
        return if (s.endsWith("Z")) s else "${s}Z"
    }

    private fun computeDistanceMeters(coords: JSArray): Double {
        var total = 0.0
        for (i in 1 until coords.length()) {
            val a = coords.getJSONArray(i - 1)
            val b = coords.getJSONArray(i)
            total += haversine(a.getDouble(1), a.getDouble(0), b.getDouble(1), b.getDouble(0))
        }
        return total
    }

    private fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6371000.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2)
        return 2 * r * Math.asin(Math.sqrt(a))
    }
}
