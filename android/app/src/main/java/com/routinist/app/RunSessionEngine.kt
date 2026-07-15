package com.routinist.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale

/**
 * 네이티브 러닝 세션 엔진 — iOS RunSessionPlugin.swift 의 Android 포팅 (Phase 2).
 *
 * iOS 와 동일한 계약 (run-session.ts) / 동일한 튜닝 상수로 필터 파이프라인·자동 일시정지·
 * 마일스톤 음성·영속화를 수행한다. 플러그인(WebView 브리지)과 RunSessionService(FGS)가
 * 프로세스 생명주기와 무관하게 같은 엔진을 공유하도록 싱글턴.
 *
 * iOS 대비 의도적 차이:
 *  - pedometer 융합 없음 — Android 는 CMPedometer.distance 등가물이 없어 (STEP_COUNTER 는
 *    걸음수만, 거리 추정은 별도 보폭 모델 필요) gap-fill 을 생략. GPS 공백 복귀 좌표는
 *    거리 미적산 재앵커만 수행. pedometerDistanceM 은 계약 유지를 위해 항상 0.
 *  - 자동 일시정지 2차 판정 (GPS lost 시 스텝 무변화) 없음 — 1차 도플러 히스테리시스만.
 *  - 음성은 android.speech.tts.TextToSpeech (AVSpeechSynthesizer 대응). 볼륨 0.65 동일
 *    (feedback: JS+native 동일 값 유지, pitch 변조 금지).
 *
 * 스레딩: 모든 세션 상태는 전용 HandlerThread("run-session-state") 로 일원화 (iOS 의
 * stateQueue 계약 계승). FusedLocationProvider 콜백도 같은 looper 로 배달시킨다.
 */
object RunSessionEngine {
    private const val TAG = "RunSession"

    // ── 튜닝 상수 (RunSessionPlugin.swift Tuning 과 1:1 동일값) ──────────────
    private const val WARMUP_SEC = 10.0
    private const val WARMUP_EXIT_ACCURACY_M = 25.0
    private const val ACCURACY_GATE_M = 35.0
    private const val MAX_SEGMENT_SPEED_MPS = 6.5
    private const val JUMP_BASE_M = 80.0
    private const val JUMP_ACCURACY_PAD_M = 30.0
    private const val JITTER_SPEED_MPS = 0.4
    private const val EMA_ALPHA = 0.3
    private const val INSTANT_PACE_MIN_SPEED_MPS = 0.5
    private const val INSTANT_PACE_STALE_SEC = 5.0
    private const val AUTO_PAUSE_SPEED_MPS = 0.5
    private const val AUTO_PAUSE_HOLD_SEC = 12.0
    private const val AUTO_RESUME_SPEED_MPS = 1.4
    private const val AUTO_RESUME_HOLD_SEC = 3.0
    private const val GPS_GOOD_ACCURACY_M = 20.0
    private const val GPS_LOST_SEC = 10.0
    private const val UPDATE_INTERVAL_MS = 1000L
    private const val PERSIST_EVERY_TICKS = 10
    private const val RESTORE_MAX_AGE_SEC = 30.0 * 60
    private const val MIN_DISTANCE_FOR_PACE_M = 10.0

    private const val PREFS_NAME = "run_session_engine"
    private const val PERSIST_KEY = "snapshot"
    private const val ROUTE_FILE_NAME = "run-session-route.json"

    enum class State(val raw: String) {
        IDLE("idle"), RUNNING("running"), PAUSED("paused"), AUTO_PAUSED("autoPaused")
    }

    data class VoiceTemplates(
        val milestone: String,
        val autoPause: String,
        val autoResume: String,
        val start: String,
    )

    /** 플러그인이 구현 — update/milestone 을 WebView 로 릴레이 (foreground 필터는 플러그인 몫). */
    interface EventSink {
        fun onUpdate(data: JSObject)
        fun onMilestone(data: JSObject)
    }

    private val stateThread = HandlerThread("run-session-state").apply { start() }
    val handler = Handler(stateThread.looper)

    private var appContext: Context? = null

    @Volatile var eventSink: EventSink? = null
    /** RunSessionService 가 등록 — tick 마다 알림 본문 텍스트 갱신. */
    @Volatile var notificationSink: ((String) -> Unit)? = null
    /** 서비스가 stale-restore 자가 종료 판단에 읽음 (informational read — 상태 소유는 handler). */
    @Volatile private var stateForReaders: State = State.IDLE

    // ── 세션 상태 (handler 스레드 전용) ──────────────────────────────────────
    private var state = State.IDLE
        set(value) { field = value; stateForReaders = value }
    private var startedAtMs = 0.0
    private var sessionLocale = "ko"
    private var voiceEnabled = true
    private var milestoneEveryKm = 1.0
    private var templates = VoiceTemplates("", "", "", "")

    private var gpsDistanceM = 0.0
    private val route = mutableListOf<DoubleArray>()   // [lng, lat, tsMs]
    private var lastEmittedRouteIndex = 0
    private var lastPersistedRouteCount = 0

    private var accumulatedActiveSec = 0.0
    private var activeSegmentStartMs: Long? = null
    private var accumulatedAutoPausedSec = 0.0
    private var autoPausedSegmentStartMs: Long? = null

    private var inWarmup = true
    private var warmupStartedAtMs = 0L
    private var warmupCandidate: Location? = null
    private var anchor: Location? = null
    private var lastFixAtMs: Long? = null
    private var lastFixAccuracy: Double? = null

    private var emaSpeed: Double? = null
    private var lastSpeedUpdateAtMs: Long? = null

    private var slowSinceMs: Long? = null
    private var fastSinceMs: Long? = null
    private var hasMovedThisSession = false

    private var milestonesFired = 0
    private var trackingStarted = false
    private var tickCount = 0

    // ── attach / restore ────────────────────────────────────────────────────

    private var restoreAttempted = false

    /** 플러그인 load()·서비스 onCreate() 에서 호출. 첫 호출에서만 영속 세션 복원. */
    fun attach(context: Context) {
        val app = context.applicationContext
        if (appContext == null) appContext = app
        handler.post {
            if (!restoreAttempted) {
                restoreAttempted = true
                restorePersistedSession()
            }
        }
    }

    fun isSessionActive(): Boolean = stateForReaders != State.IDLE

    // ── start / pause / resume / stop / getSnapshot (플러그인 진입점) ───────

    fun startSession(
        locale: String,
        voice: Boolean,
        everyKm: Double,
        parsedTemplates: VoiceTemplates,
        onSuccess: (Double) -> Unit,
        onError: (String) -> Unit,
    ) {
        handler.post {
            if (state != State.IDLE) {
                // 복원된 세션 포함 — JS 가 먼저 stop() 으로 회수해야 새 세션 시작 가능 (계약).
                onError("session-already-active")
                return@post
            }
            val ctx = appContext
            if (ctx == null || !hasLocationPermission(ctx)) {
                // Android 14+ 는 위치 권한 없이 FGS(location) 시작이 예외 — 명시 거절로 JS 레거시 폴백.
                onError("location-permission-missing")
                return@post
            }
            val nowMs = System.currentTimeMillis()
            resetSessionState()
            state = State.RUNNING
            startedAtMs = nowMs.toDouble()
            sessionLocale = locale
            voiceEnabled = voice
            milestoneEveryKm = if (everyKm > 0) everyKm else 1.0
            templates = parsedTemplates
            activeSegmentStartMs = nowMs
            inWarmup = true
            warmupStartedAtMs = nowMs
            lastFixAtMs = nowMs   // 첫 fix 전에도 'lost' 판정이 시작 시각 기준으로 동작
            applyTtsLocale()
            startTrackingIfNeeded()
            persist(nowMs)
            if (voiceEnabled && templates.start.isNotEmpty()) speak(templates.start)
            onSuccess(startedAtMs)
        }
    }

    fun pauseSession(onDone: (Boolean) -> Unit) {
        handler.post {
            if (state == State.IDLE) { onDone(false); return@post }
            val nowMs = System.currentTimeMillis()
            if (state == State.RUNNING || state == State.AUTO_PAUSED) {
                foldTimeSegments(nowMs)
                state = State.PAUSED
                resetAutoPauseWindows()
                persist(nowMs)
            }
            onDone(true)
        }
    }

    fun resumeSession(onDone: (Boolean) -> Unit) {
        handler.post {
            if (state == State.IDLE) { onDone(false); return@post }
            val nowMs = System.currentTimeMillis()
            if (state != State.RUNNING) {
                foldTimeSegments(nowMs)   // autoPaused 시간도 fold — resume 은 autoPaused 도 해제 (계약)
                state = State.RUNNING
                activeSegmentStartMs = nowMs
                resetAutoPauseWindows()
                startTrackingIfNeeded()   // stale 복원 세션 이어가기 — 이미 가동 중이면 no-op
                persist(nowMs)
            }
            onDone(true)
        }
    }

    fun stopSession(onSuccess: (JSObject) -> Unit, onError: (String) -> Unit) {
        handler.post {
            if (state == State.IDLE) { onError("no-active-session"); return@post }
            val nowMs = System.currentTimeMillis()
            foldTimeSegments(nowMs)
            val activeSec = accumulatedActiveSec
            val avgPace = paceSecPerKm(gpsDistanceM, activeSec)
            val summary = JSObject().apply {
                put("startedAtMs", startedAtMs)
                put("endedAtMs", nowMs.toDouble())
                put("distanceM", gpsDistanceM)
                put("gpsDistanceM", gpsDistanceM)
                put("pedometerDistanceM", 0.0)
                put("activeSec", Math.round(activeSec).toDouble())
                put("elapsedSec", Math.round((nowMs - startedAtMs) / 1000.0).toDouble())
                put("autoPausedSec", Math.round(accumulatedAutoPausedSec).toDouble())
                put("avgPaceSecPerKm", avgPace ?: JSONObject.NULL)
                put("route", routeToJson())
            }
            stopTracking()
            clearPersisted()
            resetSessionState()
            abandonAudioFocus()
            onSuccess(summary)
        }
    }

    fun getSnapshot(onResult: (JSObject) -> Unit) {
        handler.post {
            if (state == State.IDLE) {
                onResult(JSObject().put("active", false))
                return@post
            }
            val data = updatePayload(System.currentTimeMillis())
            data.put("active", true)
            data.put("startedAtMs", startedAtMs)
            data.put("routeSoFar", routeToJson())
            // 재부착 시점 기준으로 delta 커서 리셋 — 이후 update 의 newCoords 와 중복 방지.
            lastEmittedRouteIndex = route.size
            data.put("newCoords", JSONArray())
            onResult(data)
        }
    }

    fun hasLocationPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    // ── 트래킹 시작/종료 ─────────────────────────────────────────────────────

    private var fusedClient: FusedLocationProviderClient? = null
    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            // requestLocationUpdates 에 stateThread.looper 를 넘겨 이 콜백은 이미 상태 스레드.
            processLocations(result.locations)
        }
    }

    @SuppressLint("MissingPermission")   // 호출측(startSession)에서 권한 확인 후 진입
    private fun startTrackingIfNeeded() {
        if (trackingStarted) return
        val ctx = appContext ?: return
        trackingStarted = true
        try {
            val client = fusedClient ?: LocationServices.getFusedLocationProviderClient(ctx).also { fusedClient = it }
            // distanceFilter 없이 1s 간격 전체 수신 — 정지 시에도 도플러 speed 샘플이 계속
            // 들어와야 자동 일시정지 히스테리시스가 동작한다. jitter 는 필터 게이트가 흡수.
            val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, UPDATE_INTERVAL_MS)
                .setMinUpdateIntervalMillis(UPDATE_INTERVAL_MS)
                .build()
            client.requestLocationUpdates(request, locationCallback, stateThread.looper)
        } catch (e: Exception) {
            Log.e(TAG, "requestLocationUpdates failed", e)
        }
        RunSessionService.start(ctx)
        startTick()
    }

    private fun stopTracking() {
        trackingStarted = false
        handler.removeCallbacks(tickRunnable)
        try { fusedClient?.removeLocationUpdates(locationCallback) } catch (_: Exception) {}
        appContext?.let { RunSessionService.stop(it) }
    }

    private val tickRunnable = object : Runnable {
        override fun run() {
            tick()
            if (state != State.IDLE && trackingStarted) handler.postDelayed(this, UPDATE_INTERVAL_MS)
        }
    }

    private fun startTick() {
        handler.removeCallbacks(tickRunnable)
        handler.postDelayed(tickRunnable, UPDATE_INTERVAL_MS)
    }

    // ── 1초 tick (handler 스레드) ────────────────────────────────────────────

    private fun tick() {
        if (state == State.IDLE) return
        val nowMs = System.currentTimeMillis()
        tickCount += 1
        evaluateAutoPause(nowMs)
        if (tickCount % PERSIST_EVERY_TICKS == 0) persist(nowMs)
        emitUpdate(nowMs)
        notificationSink?.invoke(notificationText(nowMs))
    }

    private fun emitUpdate(nowMs: Long) {
        val sink = eventSink ?: return
        val data = updatePayload(nowMs)
        val newCoords = JSONArray()
        if (lastEmittedRouteIndex < route.size) {
            for (i in lastEmittedRouteIndex until route.size) newCoords.put(coordToJson(route[i]))
        }
        lastEmittedRouteIndex = route.size
        data.put("newCoords", newCoords)
        sink.onUpdate(data)
    }

    /** update 이벤트/getSnapshot 공통 필드 (newCoords 제외). */
    private fun updatePayload(nowMs: Long): JSObject {
        val activeSec = currentActiveSec(nowMs)
        return JSObject().apply {
            put("state", state.raw)
            put("distanceM", gpsDistanceM)
            put("activeSec", Math.round(activeSec).toDouble())
            put("instantPaceSecPerKm", instantPace(nowMs) ?: JSONObject.NULL)
            put("avgPaceSecPerKm", paceSecPerKm(gpsDistanceM, activeSec) ?: JSONObject.NULL)
            put("gpsSignal", gpsSignalString(nowMs))
            put("pedometerDistanceM", 0.0)
        }
    }

    private fun gpsSignalString(nowMs: Long): String {
        val last = lastFixAtMs ?: return "lost"
        if ((nowMs - last) / 1000.0 >= GPS_LOST_SEC) return "lost"
        val acc = lastFixAccuracy ?: return "weak"
        return if (acc <= GPS_GOOD_ACCURACY_M) "good" else "weak"
    }

    private fun instantPace(nowMs: Long): Double? {
        val ema = emaSpeed ?: return null
        val updated = lastSpeedUpdateAtMs ?: return null
        if ((nowMs - updated) / 1000.0 > INSTANT_PACE_STALE_SEC) return null
        if (ema < INSTANT_PACE_MIN_SPEED_MPS) return null
        return 1000.0 / ema
    }

    private fun paceSecPerKm(distanceM: Double, seconds: Double): Double? {
        if (distanceM < MIN_DISTANCE_FOR_PACE_M || seconds <= 0) return null
        return seconds / (distanceM / 1000.0)
    }

    private fun currentActiveSec(nowMs: Long): Double {
        var total = accumulatedActiveSec
        if (state == State.RUNNING) {
            activeSegmentStartMs?.let { total += (nowMs - it) / 1000.0 }
        }
        return total
    }

    // ── 위치 필터 파이프라인 (handler 스레드) — Swift processLocations 포팅 ──

    private fun processLocations(locations: List<Location>) {
        if (state == State.IDLE) return
        for (loc in locations) {
            if (!loc.hasAccuracy()) continue
            val acc = loc.accuracy.toDouble()

            // 신호 등급용 — accuracy 게이트에 걸려도 "수신 자체" 는 기록 (lost 판정 기준).
            val nowMs = System.currentTimeMillis()
            lastFixAtMs = nowMs
            lastFixAccuracy = acc

            // 도플러 speed: 순간 페이스 EMA + 자동 일시정지 히스테리시스 윈도우.
            val doppler = if (loc.hasSpeed()) loc.speed.toDouble() else -1.0
            if (doppler >= 0) {
                emaSpeed = emaSpeed?.let { EMA_ALPHA * doppler + (1 - EMA_ALPHA) * it } ?: doppler
                lastSpeedUpdateAtMs = nowMs
                when {
                    doppler < AUTO_PAUSE_SPEED_MPS -> {
                        if (slowSinceMs == null) slowSinceMs = nowMs
                        fastSinceMs = null
                    }
                    doppler > AUTO_RESUME_SPEED_MPS -> {
                        if (fastSinceMs == null) fastSinceMs = nowMs
                        slowSinceMs = null
                        hasMovedThisSession = true
                    }
                    else -> {
                        // 중간 대역 — 히스테리시스: 어느 쪽 카운트도 하지 않음.
                        slowSinceMs = null
                        fastSinceMs = null
                    }
                }
            }

            // accuracy 게이트: 거리·경로 모두 제외.
            if (acc > ACCURACY_GATE_M) continue

            // warmup: 콜드스타트 좌표는 앵커 후보로만.
            if (inWarmup) {
                if (acc <= WARMUP_EXIT_ACCURACY_M) {
                    inWarmup = false
                    adoptAnchor(loc, appendToRoute = state == State.RUNNING)
                    continue
                }
                if ((nowMs - warmupStartedAtMs) / 1000.0 < WARMUP_SEC) {
                    warmupCandidate = loc
                    continue
                }
                inWarmup = false
                warmupCandidate?.let { adoptAnchor(it, appendToRoute = false) }
            }

            val currentAnchor = anchor
            if (currentAnchor == null) {
                adoptAnchor(loc, appendToRoute = state == State.RUNNING)
                continue
            }

            val dtSec = (loc.time - currentAnchor.time) / 1000.0
            if (dtSec <= 0) continue   // 중복/역행 timestamp
            val dist = loc.distanceTo(currentAnchor).toDouble()

            // GPS 공백(10s+) 후 복귀: 속도/점프 게이트가 무의미한 구간 — 거리 미적산 재앵커만.
            // (iOS 는 여기서 pedometer gap-fill — Android 는 융합 소스가 없어 생략.)
            if (dtSec >= GPS_LOST_SEC) {
                adoptAnchor(loc, appendToRoute = state == State.RUNNING)
                continue
            }

            // 속도 게이트: 2'34"/km 초과 세그먼트는 GPS 점프 — outlier 는 앵커 미승격.
            if (dist / dtSec > MAX_SEGMENT_SPEED_MPS) continue

            // 점프 게이트: 정확도 합산 여유를 넘는 순간이동.
            if (dist > maxOf(JUMP_BASE_M, acc + currentAnchor.accuracy.toDouble() + JUMP_ACCURACY_PAD_M)) continue

            // 정지 jitter: 도플러가 "거의 정지" 면 위치 요동은 거리로 치지 않음. 앵커만 추종.
            if (doppler >= 0 && doppler < JITTER_SPEED_MPS) {
                adoptAnchor(loc, appendToRoute = false)
                continue
            }

            if (state == State.RUNNING) {
                gpsDistanceM += dist
                adoptAnchor(loc, appendToRoute = true)
                checkMilestones(nowMs)
            } else {
                // paused/autoPaused: 앵커만 추종 — 일시정지 중 이동분이 재개 직후 튀는 것 방지.
                adoptAnchor(loc, appendToRoute = false)
            }
        }
    }

    private fun adoptAnchor(loc: Location, appendToRoute: Boolean) {
        anchor = loc
        if (appendToRoute) {
            route.add(doubleArrayOf(loc.longitude, loc.latitude, loc.time.toDouble()))
        }
    }

    // ── 자동 일시정지 (도플러 히스테리시스 — iOS 1차 판정과 동일) ────────────

    private fun evaluateAutoPause(nowMs: Long) {
        when (state) {
            State.RUNNING -> {
                // 첫 움직임 전에는 미무장 — 출발 대기/워밍업 오정지 차단 (실주행 fix 295 계승).
                if (!hasMovedThisSession) return
                val slow = slowSinceMs
                if (slow != null && (nowMs - slow) / 1000.0 >= AUTO_PAUSE_HOLD_SEC) enterAutoPause(nowMs)
            }
            State.AUTO_PAUSED -> {
                val fast = fastSinceMs
                if (fast != null && (nowMs - fast) / 1000.0 >= AUTO_RESUME_HOLD_SEC) exitAutoPause(nowMs)
            }
            else -> Unit   // 수동 paused 는 자동 재개하지 않음
        }
    }

    private fun enterAutoPause(nowMs: Long) {
        foldTimeSegments(nowMs)
        state = State.AUTO_PAUSED
        autoPausedSegmentStartMs = nowMs
        resetAutoPauseWindows()
        speak(templates.autoPause)
        persist(nowMs)
    }

    private fun exitAutoPause(nowMs: Long) {
        foldTimeSegments(nowMs)
        state = State.RUNNING
        activeSegmentStartMs = nowMs
        resetAutoPauseWindows()
        speak(templates.autoResume)
        persist(nowMs)
    }

    private fun resetAutoPauseWindows() {
        slowSinceMs = null
        fastSinceMs = null
    }

    /** 현재 state 의 진행 중 segment 를 누적치에 fold. 상태 전이 직전에 호출. */
    private fun foldTimeSegments(nowMs: Long) {
        when (state) {
            State.RUNNING -> {
                activeSegmentStartMs?.let { accumulatedActiveSec += (nowMs - it) / 1000.0 }
                activeSegmentStartMs = null
            }
            State.AUTO_PAUSED -> {
                autoPausedSegmentStartMs?.let { accumulatedAutoPausedSec += (nowMs - it) / 1000.0 }
                autoPausedSegmentStartMs = null
            }
            else -> Unit
        }
    }

    // ── 마일스톤 + 음성 ──────────────────────────────────────────────────────

    private fun checkMilestones(nowMs: Long) {
        val everyM = milestoneEveryKm * 1000.0
        if (everyM <= 0) return
        while (gpsDistanceM >= (milestonesFired + 1) * everyM) {
            milestonesFired += 1
            val km = milestonesFired * milestoneEveryKm
            val avgPace = paceSecPerKm(gpsDistanceM, currentActiveSec(nowMs))
            eventSink?.onMilestone(JSObject().apply {
                put("km", km)
                put("avgPaceSecPerKm", avgPace ?: JSONObject.NULL)
            })
            val kmText = if (km == Math.floor(km)) km.toInt().toString() else String.format(Locale.US, "%.1f", km)
            val paceText = avgPace?.let { formatPaceForSpeech(it, sessionLocale) } ?: ""
            speak(
                templates.milestone
                    .replace("{km}", kmText)
                    .replace("{pace}", paceText)
            )
        }
    }

    /** "5분 30초" / "5 minutes 30 seconds" — TTS 가 자연스럽게 읽는 형태 (iOS 와 동일). */
    private fun formatPaceForSpeech(secPerKm: Double, locale: String): String {
        val total = Math.round(secPerKm).toInt()
        val minutes = total / 60
        val seconds = total % 60
        if (locale.lowercase(Locale.US).startsWith("ko")) {
            if (seconds == 0) return "${minutes}분"
            if (minutes == 0) return "${seconds}초"
            return "${minutes}분 ${seconds}초"
        }
        val minUnit = if (minutes == 1) "minute" else "minutes"
        val secUnit = if (seconds == 1) "second" else "seconds"
        if (seconds == 0) return "$minutes $minUnit"
        if (minutes == 0) return "$seconds $secUnit"
        return "$minutes $minUnit $seconds $secUnit"
    }

    // ── TTS (android.speech.tts — AVSpeechSynthesizer 대응) ─────────────────

    private var tts: TextToSpeech? = null
    @Volatile private var ttsReady = false

    /** 시작 제스처 직후 (prepareAudio) 미리 초기화 — 카운트다운 첫 발화 전 준비 완료 목적. */
    fun ensureTts() {
        val ctx = appContext ?: return
        if (tts != null) return
        tts = TextToSpeech(ctx) { status ->
            if (status == TextToSpeech.SUCCESS) {
                ttsReady = true
                tts?.setAudioAttributes(speechAudioAttributes)
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) {
                        if (tts?.isSpeaking != true) abandonAudioFocus()
                    }
                    @Suppress("OVERRIDE_DEPRECATION")
                    override fun onError(utteranceId: String?) { abandonAudioFocus() }
                })
                applyTtsLocale()
            } else {
                Log.e(TAG, "TTS init failed: $status")
                tts = null
            }
        }
    }

    private fun applyTtsLocale() {
        val t = tts ?: return
        if (!ttsReady) return
        val target = if (sessionLocale.lowercase(Locale.US).startsWith("ko")) Locale.KOREAN else Locale.US
        try { t.setLanguage(target) } catch (e: Exception) { Log.w(TAG, "TTS setLanguage failed", e) }
    }

    /** 카운트다운 전용 — voiceEnabled 가드 없음 (iOS speakText 계약과 동일). */
    fun speakTextNow(text: String): Boolean {
        if (text.isEmpty()) return false
        ensureTts()
        val t = tts ?: return false
        if (!ttsReady) return false   // 미준비면 false → JS 가 beep 폴백
        requestAudioFocus()
        val params = Bundle().apply { putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 0.65f) }
        t.speak(text, TextToSpeech.QUEUE_ADD, params, "run-session-${System.nanoTime()}")
        return true
    }

    /** 세션 발화 (마일스톤/자동정지) — voiceEnabled 가드. */
    private fun speak(text: String) {
        if (!voiceEnabled || text.isEmpty()) return
        speakTextNow(text)
    }

    private val speechAudioAttributes: AudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    private var audioFocusRequest: AudioFocusRequest? = null

    /** 발화 직전 transient duck 포커스 — 음악 앱은 작아졌다가 발화 후 원복 (iOS duckOthers 대응). */
    private fun requestAudioFocus() {
        val ctx = appContext ?: return
        try {
            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val req = audioFocusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(speechAudioAttributes)
                .build().also { audioFocusRequest = it }
            am.requestAudioFocus(req)
        } catch (e: Exception) {
            Log.w(TAG, "audio focus request failed", e)
        }
    }

    private fun abandonAudioFocus() {
        val ctx = appContext ?: return
        val req = audioFocusRequest ?: return
        try {
            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            am.abandonAudioFocusRequest(req)
        } catch (e: Exception) {
            Log.w(TAG, "audio focus abandon failed", e)
        }
    }

    // ── 알림 본문 (RunSessionService) ────────────────────────────────────────

    private fun notificationText(nowMs: Long): String {
        val kmText = String.format(Locale.US, "%.2f", gpsDistanceM / 1000.0)
        val secs = currentActiveSec(nowMs).toLong()
        val hh = secs / 3600
        val mm = (secs % 3600) / 60
        val ss = secs % 60
        val time = if (hh > 0) String.format(Locale.US, "%d:%02d:%02d", hh, mm, ss)
                   else String.format(Locale.US, "%02d:%02d", mm, ss)
        val isKo = sessionLocale.lowercase(Locale.US).startsWith("ko")
        return when (state) {
            State.PAUSED -> if (isKo) "일시정지 · $kmText km · $time" else "Paused · $kmText km · $time"
            State.AUTO_PAUSED -> if (isKo) "자동 일시정지 · $kmText km · $time" else "Auto paused · $kmText km · $time"
            else -> "$kmText km · $time"
        }
    }

    // ── 영속화 / 복원 (handler 스레드) ───────────────────────────────────────

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private fun routeFile(ctx: Context) = File(ctx.filesDir, ROUTE_FILE_NAME)

    private fun routeToJson(): JSONArray {
        val arr = JSONArray()
        for (c in route) arr.put(coordToJson(c))
        return arr
    }

    private fun coordToJson(c: DoubleArray): JSONArray =
        JSONArray().put(c[0]).put(c[1]).put(c[2])

    /** 10초마다 + 상태 전이 시. 앱 강제종료/OS kill 후 복원용 (iOS persist 와 동일 필드). */
    private fun persist(nowMs: Long) {
        val ctx = appContext ?: return
        if (state == State.IDLE) return
        val snap = JSONObject().apply {
            put("startedAtMs", startedAtMs)
            put("state", state.raw)
            put("gpsDistanceM", gpsDistanceM)
            put("activeSec", currentActiveSec(nowMs))
            put("autoPausedSec", accumulatedAutoPausedSec +
                if (state == State.AUTO_PAUSED) (nowMs - (autoPausedSegmentStartMs ?: nowMs)) / 1000.0 else 0.0)
            put("milestonesFired", milestonesFired)
            put("milestoneEveryKm", milestoneEveryKm)
            put("locale", sessionLocale)
            put("voiceEnabled", voiceEnabled)
            put("templateMilestone", templates.milestone)
            put("templateAutoPause", templates.autoPause)
            put("templateAutoResume", templates.autoResume)
            put("persistedAtMs", nowMs.toDouble())
        }
        prefs(ctx).edit().putString(PERSIST_KEY, snap.toString()).apply()
        if (route.size != lastPersistedRouteCount) {
            lastPersistedRouteCount = route.size
            try {
                routeFile(ctx).writeText(routeToJson().toString())
            } catch (e: Exception) {
                Log.w(TAG, "route persist failed", e)
            }
        }
    }

    private fun clearPersisted() {
        val ctx = appContext ?: return
        prefs(ctx).edit().remove(PERSIST_KEY).apply()
        try { routeFile(ctx).delete() } catch (_: Exception) {}
        lastPersistedRouteCount = 0
    }

    /** 앱 (재)시작 시 진행 중이던 세션 복원 — attach() 1회 경유 (iOS restore 와 동일 규칙). */
    private fun restorePersistedSession() {
        if (state != State.IDLE) return
        val ctx = appContext ?: return
        val raw = prefs(ctx).getString(PERSIST_KEY, null) ?: return
        try {
            val snap = JSONObject(raw)
            val savedStartMs = snap.optDouble("startedAtMs", 0.0)
            val persistedAtMs = snap.optDouble("persistedAtMs", 0.0)
            if (savedStartMs <= 0 || persistedAtMs <= 0) return

            val nowMs = System.currentTimeMillis()
            startedAtMs = savedStartMs
            gpsDistanceM = snap.optDouble("gpsDistanceM", 0.0)
            accumulatedActiveSec = snap.optDouble("activeSec", 0.0)
            accumulatedAutoPausedSec = snap.optDouble("autoPausedSec", 0.0)
            milestonesFired = snap.optInt("milestonesFired", 0)
            milestoneEveryKm = snap.optDouble("milestoneEveryKm", 1.0)
            sessionLocale = snap.optString("locale", "ko")
            voiceEnabled = snap.optBoolean("voiceEnabled", true)
            templates = VoiceTemplates(
                milestone = snap.optString("templateMilestone", ""),
                autoPause = snap.optString("templateAutoPause", ""),
                autoResume = snap.optString("templateAutoResume", ""),
                start = "",   // 복원 세션은 이미 출발한 뒤 — 출발 발화 불필요
            )

            try {
                val savedRoute = JSONArray(routeFile(ctx).readText())
                route.clear()
                for (i in 0 until savedRoute.length()) {
                    val pt = savedRoute.getJSONArray(i)
                    route.add(doubleArrayOf(pt.getDouble(0), pt.getDouble(1), pt.getDouble(2)))
                }
            } catch (_: Exception) { /* route 파일 없음/파손 — 통계만 복원 */ }
            lastEmittedRouteIndex = route.size
            lastPersistedRouteCount = route.size

            val ageSec = (nowMs - persistedAtMs) / 1000.0
            val savedState = when (snap.optString("state", "paused")) {
                "running" -> State.RUNNING
                "autoPaused" -> State.AUTO_PAUSED
                else -> State.PAUSED
            }

            if (ageSec <= RESTORE_MAX_AGE_SEC && hasLocationPermission(ctx)) {
                // 신선한 세션 — 그대로 이어서 트래킹 재가동 (OS kill / 재실행 직후).
                state = savedState
                if (state == State.RUNNING) activeSegmentStartMs = nowMs
                if (state == State.AUTO_PAUSED) autoPausedSegmentStartMs = nowMs
                inWarmup = true          // 재시작 첫 fix 도 튈 수 있음 — 워밍업부터
                warmupStartedAtMs = nowMs
                lastFixAtMs = nowMs
                anchor = null
                hasMovedThisSession = true   // 복원 세션 = 이미 달리던 세션 — 자동정지 즉시 무장
                applyTtsLocale()
                startTrackingIfNeeded()
            } else {
                // 오래된 세션 — GPS 재가동 없이 paused 로만 보존. JS 가 stop()/resume() 선택.
                state = State.PAUSED
            }
            Log.i(TAG, "restored session (age ${ageSec.toInt()}s, state ${state.raw}, ${gpsDistanceM.toInt()}m)")
        } catch (e: Exception) {
            Log.w(TAG, "restore failed", e)
        }
    }

    /** 세션 종료/시작 전 전체 필드 초기화. */
    private fun resetSessionState() {
        state = State.IDLE
        startedAtMs = 0.0
        gpsDistanceM = 0.0
        route.clear()
        lastEmittedRouteIndex = 0
        lastPersistedRouteCount = 0
        accumulatedActiveSec = 0.0
        activeSegmentStartMs = null
        accumulatedAutoPausedSec = 0.0
        autoPausedSegmentStartMs = null
        inWarmup = true
        warmupCandidate = null
        anchor = null
        lastFixAtMs = null
        lastFixAccuracy = null
        emaSpeed = null
        lastSpeedUpdateAtMs = null
        slowSinceMs = null
        fastSinceMs = null
        hasMovedThisSession = false
        milestonesFired = 0
        tickCount = 0
    }
}
