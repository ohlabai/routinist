package com.routinist.app

import androidx.health.connect.client.HealthConnectClient
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
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
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

    private val permissions = setOf(
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
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
                    val ret = JSObject()
                    ret.put("success", true)
                    call.resolve(ret)
                    return@launch
                }
                // Health Connect 권한 grant 는 PermissionController.createRequestPermissionResultContract
                // ActivityResult 흐름이 필요. Capacitor Plugin 에서는 startActivityForResult 등록 필요.
                // MVP: 미부여 상태로 false 반환. UI 가 사용자를 Health Connect 설정으로 deeplink.
                val ret = JSObject()
                ret.put("success", false)
                ret.put("missingPermissions", permissions.joinToString(","))
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Authorization failed: ${e.message}", e)
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
