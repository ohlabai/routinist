package com.routinist.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
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
import kotlin.math.abs
import kotlin.math.sqrt

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
 *  - 자동 일시정지 모션 판정은 가속도계 에너지 (iOS 는 CMPedometer 스텝) — step detector 는
 *    ACTIVITY_RECOGNITION 런타임 권한이 필요해 (Play 권한 최소화) 무권한 가속도계로 대체.
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
    // 2026-08-05 (이승우 "뛰는데 5번 정지" 신고): 자동정지 재설계 — 모션이 1차 신호 (Strava 계열).
    // 절전모드가 GPS 를 굶기면 (fix burst→수십초 침묵) 저품질 도플러 한 방 + 공백 12초만으로
    // 오정지됐음. 몸이 흔들리는 동안은 GPS 가 뭐라 하든 정지하지 않는다.
    private const val MOTION_EMA_ALPHA = 0.1        // ~15Hz 샘플 기준 시정수 ≈ 0.7s
    private const val MOTION_ACTIVE_MPS2 = 0.6      // |가속도-중력| EMA — 걷기/뛰기 ≫ 0.6, 정지 ≪ 0.3
    private const val MOTION_FRESH_SEC = 5.0        // 이 안에 모션 있으면 자동정지 거부
    private const val GPS_SPEED_FRESH_SEC = 5.0     // GPS-느림 정지는 speed 샘플이 흐르는 중일 때만
    private const val GPS_GOOD_ACCURACY_M = 20.0
    private const val GPS_LOST_SEC = 10.0
    // build 327 (강도균 "km 안 올라감" 신고): GPS 공백 gap-fill 속도 캡.
    // 공백 직전 EMA 속도를 이 범위로 clamp 해 직선거리와 함께 min() — 진짜 이동은 회복,
    // 글리치 순간이동은 (공백초 × 상한) 이상 못 더해 안전. iOS pedometer gap-fill 의 대응물.
    private const val GAP_FILL_MAX_SPEED_MPS = 4.2   // ≈ 4'00"/km — 러닝 상한
    private const val GAP_FILL_DEFAULT_SPEED_MPS = 2.5
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
        /** 반환값 = 실제 전달 여부. false (백그라운드 등) 면 엔진이 newCoords 커서를 유지해
         *  다음 전달 때 밀린 좌표를 한꺼번에 보낸다 — 잠금 구간 폴리라인 공백 방지 (리뷰 P1). */
        fun onUpdate(data: JSObject): Boolean
        fun onMilestone(data: JSObject)
    }

    private val stateThread = HandlerThread("run-session-state").apply { start() }
    val handler = Handler(stateThread.looper)

    @Volatile private var appContext: Context? = null

    @Volatile var eventSink: EventSink? = null
    /** RunSessionService 가 등록 — tick 마다 알림 (제목, 본문) 갱신. */
    @Volatile var notificationSink: ((String, String) -> Unit)? = null
    /** 서비스가 stale-restore 자가 종료 판단에 읽음 (informational read — 상태 소유는 handler). */
    @Volatile private var stateForReaders: State = State.IDLE
    /** 트래킹 (GPS+tick) 실가동 여부 — 서비스 자가 종료 판단용. stale 복원은 세션만 있고 이건 false. */
    @Volatile private var trackingForReaders: Boolean = false

    // ── 세션 상태 (handler 스레드 전용) ──────────────────────────────────────
    private var state = State.IDLE
        set(value) { field = value; stateForReaders = value }
    private var startedAtMs = 0.0
    private var sessionLocale = "ko"
    private var voiceEnabled = true
    private var milestoneEveryKm = 1.0
    private var templates = VoiceTemplates("", "", "", "")

    private var gpsDistanceM = 0.0
    // build 327 진단: GPS 공백 gap-fill 로 적산된 거리 (gpsDistanceM 에 이미 포함, 관측용)
    private var gapFilledM = 0.0
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

    // 모션 (가속도계) 상태 — 콜백을 handler 로 배달시켜 필드 접근은 상태 스레드로 일원화.
    private var accelSensorActive = false
    private var accelEmaDev: Double? = null
    private var lastMotionAtMs: Long? = null
    private var motionSinceMs: Long? = null
    private var autoPauseCount = 0

    private var milestonesFired = 0
    // 구간 페이스 기준점 — 직전 마일스톤 발화 시점의 누적 거리/활동시간.
    private var lastMilestoneDistanceM = 0.0
    private var lastMilestoneActiveSec = 0.0
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

    /** stale 복원 (>30분) 은 세션 데이터만 보존하고 트래킹은 안 돈다 — 그때 FGS 는 자가 종료. */
    fun isTrackingRunning(): Boolean = trackingForReaders

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
            // 리뷰 P2: JS 가 prepareAudio 를 안 불렀어도 (복원·직행 시작) 마일스톤 발화가
            // 통째로 무음이 되지 않게 세션 시작 시 TTS 를 직접 예열.
            if (voiceEnabled) ensureTts()
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
                armMotionClock(nowMs)
                // 리뷰 P2: pause 중 설정에서 위치 권한을 회수한 경우 — 권한 없이 FGS(location)
                // startForeground 는 Android 14+ 에서 SecurityException. 권한 있을 때만 재가동
                // (시간 적산은 재개 — JS 화면에는 GPS lost 배지로 드러남).
                val ctx = appContext
                if (ctx != null && hasLocationPermission(ctx)) {
                    startTrackingIfNeeded()   // stale 복원 세션 이어가기 — 이미 가동 중이면 no-op
                }
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
                put("gapFilledM", gapFilledM)   // build 327 진단 — GPS 공백 gap-fill 적산분
                put("activeSec", Math.round(activeSec).toDouble())
                put("elapsedSec", Math.round((nowMs - startedAtMs) / 1000.0).toDouble())
                put("autoPausedSec", Math.round(accumulatedAutoPausedSec).toDouble())
                put("autoPauseCount", autoPauseCount)              // 2026-08-05 진단 — 오정지 신고 추적
                put("powerSaveMode", isPowerSaveMode())            // 절전모드 = GPS 기아의 주 용의자
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

    private fun isPowerSaveMode(): Boolean = try {
        (appContext?.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isPowerSaveMode == true
    } catch (_: Exception) { false }

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

    private var sensorManager: SensorManager? = null
    private val accelListener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
            // registerListener 에 handler 를 넘겨 이 콜백도 상태 스레드.
            if (state == State.IDLE) return
            val x = event.values[0].toDouble()
            val y = event.values[1].toDouble()
            val z = event.values[2].toDouble()
            val dev = abs(sqrt(x * x + y * y + z * z) - SensorManager.GRAVITY_EARTH.toDouble())
            val ema = accelEmaDev?.let { MOTION_EMA_ALPHA * dev + (1 - MOTION_EMA_ALPHA) * it } ?: dev
            accelEmaDev = ema
            if (ema > MOTION_ACTIVE_MPS2) {
                val nowMs = System.currentTimeMillis()
                if (motionSinceMs == null) motionSinceMs = nowMs
                lastMotionAtMs = nowMs
            } else {
                motionSinceMs = null
            }
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }

    @SuppressLint("MissingPermission")   // 호출측(startSession)에서 권한 확인 후 진입
    private fun startTrackingIfNeeded() {
        if (trackingStarted) return
        val ctx = appContext ?: return
        trackingStarted = true
        trackingForReaders = true
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
        try {
            val sm = sensorManager
                ?: (ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager).also { sensorManager = it }
            val accel = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
            accelSensorActive = accel != null &&
                sm.registerListener(accelListener, accel, SensorManager.SENSOR_DELAY_UI, handler)
            // 센서 예열 전 stall 오판 방지 — 등록 시점을 첫 모션으로 간주.
            if (accelSensorActive) lastMotionAtMs = System.currentTimeMillis()
        } catch (e: Exception) {
            Log.w(TAG, "accelerometer register failed — GPS 판정만으로 동작", e)
            accelSensorActive = false
        }
        try {
            // 리뷰 P1: 서비스 START_STICKY 재기동 복원 경로에선 onStartCommand 의
            // startForeground 와 이 호출이 경합 — 백그라운드 상태로 판정되면
            // ForegroundServiceStartNotAllowedException 이 HandlerThread 를 죽인다.
            // 실패해도 트래킹 자체는 동작하고, 진행 중인 시스템 재기동이 FGS 를 제공.
            RunSessionService.start(ctx)
        } catch (e: Exception) {
            Log.w(TAG, "FGS start rejected (background?) — tracking continues", e)
        }
        startTick()
    }

    private fun stopTracking() {
        trackingStarted = false
        trackingForReaders = false
        handler.removeCallbacks(tickRunnable)
        try { fusedClient?.removeLocationUpdates(locationCallback) } catch (_: Exception) {}
        try { sensorManager?.unregisterListener(accelListener) } catch (_: Exception) {}
        accelSensorActive = false
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
        // 2026-08-06 (리뷰 P1, iOS 와 대칭): speed 샘플이 끊기면 히스테리시스 윈도우 만료.
        // stale fastSinceMs 는 터널 안에서 모션 정지를 영구 보류시키고, stale slowSinceMs 는
        // 재획득 첫 느린 fix 한 방으로 즉시 오정지시킨다. 윈도우는 "연속 관측" 이 전제.
        val speedAt = lastSpeedUpdateAtMs
        if (speedAt != null && (nowMs - speedAt) / 1000.0 > GPS_SPEED_FRESH_SEC) {
            slowSinceMs = null
            fastSinceMs = null
        }
        evaluateAutoPause(nowMs)
        if (tickCount % PERSIST_EVERY_TICKS == 0) persist(nowMs)
        emitUpdate(nowMs)
        notificationSink?.invoke(notificationTitle(), notificationText(nowMs))
    }

    private fun emitUpdate(nowMs: Long) {
        val sink = eventSink ?: return
        val data = updatePayload(nowMs)
        val newCoords = JSONArray()
        if (lastEmittedRouteIndex < route.size) {
            for (i in lastEmittedRouteIndex until route.size) newCoords.put(coordToJson(route[i]))
        }
        data.put("newCoords", newCoords)
        // 리뷰 P1: 백그라운드 (플러그인이 미전달) 면 커서를 되감아 둔다 — 잠금 해제 후
        // 첫 전달에 밀린 좌표가 한꺼번에 나가 폴리라인 공백이 생기지 않는다 (iOS 동작 동일).
        if (sink.onUpdate(data)) {
            lastEmittedRouteIndex = route.size
        }
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

            // accuracy 게이트: 거리·경로 모두 제외.
            // 2026-08-05: 도플러 speed 판정도 게이트 뒤로 — 저품질 fix 의 엉터리 속도가
            // 자동정지 타이머를 돌리던 것이 절전모드 오정지의 한 축이었다.
            if (acc > ACCURACY_GATE_M) continue

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

            // GPS 공백(10s+) 후 복귀 — build 327 (강도균·이승우 신고) 재설계:
            // ① 거리: 예전엔 통째 미적산 → 화면꺼짐/타 앱 GPS 경합으로 공백이 길면 실제 뛴
            //    km 가 유실 (4.49km/73분 사례). 직선거리를 "공백 직전 EMA 속도(러닝 상한 캡)"
            //    로 제한해 적산 — 직선거리는 실제 경로의 하한이라 과대적산 없음.
            // ② 경로: append 는 유지하되 지도 직선(하늘 나는 선)은 렌더러가 ts 간격으로
            //    세그먼트를 끊어 해결 (RouteMap/ShareCard build 327).
            if (dtSec >= GPS_LOST_SEC) {
                if (state == State.RUNNING && hasMovedThisSession) {
                    val cap = (emaSpeed ?: GAP_FILL_DEFAULT_SPEED_MPS)
                        .coerceIn(0.0, GAP_FILL_MAX_SPEED_MPS)
                    val fill = minOf(dist, dtSec * cap)
                    if (fill > 0) {
                        gpsDistanceM += fill
                        gapFilledM += fill
                    }
                }
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

    // ── 자동 일시정지 (2026-08-05 재설계 — 모션 1차 + GPS 2차, iOS 와 대칭) ──
    // 러닝은 저속이라 GPS 도플러의 노이즈 대역과 실페이스가 겹친다 — 정지 판정의 진실
    // 소스는 위성이 아니라 몸의 움직임 (Strava 러닝 자동정지와 같은 원칙).

    private fun evaluateAutoPause(nowMs: Long) {
        when (state) {
            State.RUNNING -> {
                // 첫 움직임 전에는 미무장 — 출발 대기/워밍업 오정지 차단 (실주행 fix 295 계승).
                if (!hasMovedThisSession) return
                // 모션 거부권: 몸이 흔들리는 중엔 GPS 가 뭐라 하든 정지하지 않는다.
                val lastMotion = lastMotionAtMs
                if (accelSensorActive && lastMotion != null &&
                    (nowMs - lastMotion) / 1000.0 < MOTION_FRESH_SEC) return
                var shouldPause = false
                // 1차 (모션): 12초 모션 소실 — GPS 신호 상태와 무관하게 정지 (터널·절전모드 안 실정지).
                // 단 GPS 가 "고속 이동 중" 이라고 말하면 보류 (거치대 고정 등 진동 미감지 이동).
                if (accelSensorActive && lastMotion != null &&
                    (nowMs - lastMotion) / 1000.0 >= AUTO_PAUSE_HOLD_SEC && fastSinceMs == null) {
                    shouldPause = true
                }
                // 2차 (GPS): 느림 12초 — speed 샘플이 실제로 흐르는 중일 때만. 신호 공백 중엔
                // 판정 근거가 없다 — 정지가 아니라 보류 (느린 fix 한 방 + 침묵 12초 오정지 차단).
                val slow = slowSinceMs
                val speedAt = lastSpeedUpdateAtMs
                if (!shouldPause && slow != null && (nowMs - slow) / 1000.0 >= AUTO_PAUSE_HOLD_SEC &&
                    speedAt != null && (nowMs - speedAt) / 1000.0 <= GPS_SPEED_FRESH_SEC) {
                    shouldPause = true
                }
                if (shouldPause) enterAutoPause(nowMs)
            }
            State.AUTO_PAUSED -> {
                var shouldResume = false
                // 1차: speed > 1.4 m/s 가 3초 지속.
                val fast = fastSinceMs
                if (fast != null && (nowMs - fast) / 1000.0 >= AUTO_RESUME_HOLD_SEC) shouldResume = true
                // 2차: GPS speed 판정을 못 믿을 때 모션 재개 흐름 3초로 대체.
                // 2026-08-06 (리뷰 P1): "lost" → "fresh speed 샘플 없음" 으로 완화. 도플러가
                // accuracy 게이트 뒤로 간 뒤로 40~60m fix 가 계속 오는 도심에선 신호가 'weak'
                // (lost 아님) 인데 fastSinceMs 는 안 채워져 재개 경로가 전멸했다 (영구 잠금).
                val motion = motionSinceMs
                val speedAtR = lastSpeedUpdateAtMs
                val speedStale = speedAtR == null || (nowMs - speedAtR) / 1000.0 > GPS_SPEED_FRESH_SEC
                if (!shouldResume && accelSensorActive && speedStale &&
                    motion != null && (nowMs - motion) / 1000.0 >= AUTO_RESUME_HOLD_SEC) {
                    shouldResume = true
                }
                if (shouldResume) exitAutoPause(nowMs)
            }
            else -> Unit   // 수동 paused 는 자동 재개하지 않음
        }
    }

    private fun enterAutoPause(nowMs: Long) {
        foldTimeSegments(nowMs)
        state = State.AUTO_PAUSED
        autoPausedSegmentStartMs = nowMs
        autoPauseCount += 1
        resetAutoPauseWindows()
        speak(templates.autoPause)
        persist(nowMs)
    }

    private fun exitAutoPause(nowMs: Long) {
        foldTimeSegments(nowMs)
        state = State.RUNNING
        activeSegmentStartMs = nowMs
        resetAutoPauseWindows()
        armMotionClock(nowMs)
        speak(templates.autoResume)
        persist(nowMs)
    }

    private fun resetAutoPauseWindows() {
        slowSinceMs = null
        fastSinceMs = null
        motionSinceMs = null   // 재개 판정은 전이 후 새로 3초 채워야 (iOS stepIncreasingSince 와 동일)
    }

    /** RUNNING 진입 시 모션 시계도 함께 리셋 (2026-08-06 리뷰 P1).
     *  없으면: 신호등에서 12초+ 정지 (모션 소실로 lastMotionAtMs 노후) → 수동 재개 →
     *  다음 tick 이 곧바로 "모션 12초 소실" 을 만족해 재개하자마자 자동정지가 걸린다. */
    private fun armMotionClock(nowMs: Long) {
        if (accelSensorActive) lastMotionAtMs = nowMs
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
            val activeSec = currentActiveSec(nowMs)
            val avgPace = paceSecPerKm(gpsDistanceM, activeSec)
            // 구간 페이스 (나이키/애플식 스플릿, iOS 와 동일): 직전 마일스톤 이후 구간만.
            // GPS 점프로 연속 발화 시 delta≈0 → 누적 평균으로 폴백.
            val splitDistanceM = gpsDistanceM - lastMilestoneDistanceM
            val splitSec = activeSec - lastMilestoneActiveSec
            val splitPace: Double? = if (splitDistanceM >= everyM * 0.5 && splitSec > 0)
                splitSec / (splitDistanceM / 1000.0)
            else
                avgPace
            lastMilestoneDistanceM = gpsDistanceM
            lastMilestoneActiveSec = activeSec
            eventSink?.onMilestone(JSObject().apply {
                put("km", km)
                put("avgPaceSecPerKm", avgPace ?: JSONObject.NULL)
                put("splitPaceSecPerKm", splitPace ?: JSONObject.NULL)
            })
            // 2026-07-26 hans 신고 (iOS 와 동일 fix): "11킬로미터" 숫자+단위 붙임을 한국어 TTS 가
            // 오독하는 사례 → ko 는 한자어 수사로 명시 변환해 발음을 결정적으로.
            val isKo = sessionLocale.lowercase(Locale.US).startsWith("ko")
            val kmText = if (km == Math.floor(km)) {
                if (isKo) sinoKoreanNumber(km.toInt()) + " " else km.toInt().toString()
            } else String.format(Locale.US, "%.1f", km)
            val paceText = splitPace?.let { formatPaceForSpeech(it, sessionLocale) } ?: ""
            speak(
                templates.milestone
                    .replace("{km}", kmText)
                    .replace("{pace}", paceText)
            )
        }
    }

    /** 1~99 를 한자어 수사로 (1→일, 10→십, 11→십일, 21→이십일, 50→오십). 범위 밖은 숫자 폴백. */
    private fun sinoKoreanNumber(n: Int): String {
        if (n < 1 || n > 99) return n.toString()
        val digits = arrayOf("", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구")
        val tens = n / 10
        val ones = n % 10
        val sb = StringBuilder()
        if (tens >= 2) sb.append(digits[tens])
        if (tens >= 1) sb.append("십")
        sb.append(digits[ones])
        return sb.toString()
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

    // 리뷰 P2 (스레딩): tts/ttsReady 는 플러그인 스레드·handler·TTS 콜백 스레드에서 접근 —
    // @Volatile + 발화/포커스 조작은 전부 handler 로 confine. ensureTts 는 이중 init 차단.
    @Volatile private var tts: TextToSpeech? = null
    @Volatile private var ttsReady = false

    /** 시작 제스처 직후 (prepareAudio) 미리 초기화 — 카운트다운 첫 발화 전 준비 완료 목적. */
    @Synchronized
    fun ensureTts() {
        val ctx = appContext ?: return
        if (tts != null) return
        tts = TextToSpeech(ctx) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.setAudioAttributes(speechAudioAttributes)
                // 2026-07-16: iOS/JS 프리뷰 (rate 0.95) 와 동일한 살짝 차분한 톤. pitch 불변.
                tts?.setSpeechRate(0.95f)
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) {
                        handler.post { if (tts?.isSpeaking != true) abandonAudioFocus() }
                    }
                    @Suppress("OVERRIDE_DEPRECATION")
                    override fun onError(utteranceId: String?) {
                        handler.post { abandonAudioFocus() }
                    }
                })
                ttsReady = true
                handler.post { applyTtsLocale() }   // sessionLocale 은 handler 소유
            } else {
                Log.e(TAG, "TTS init failed: $status")
                tts = null
            }
        }
    }

    /** handler 스레드에서만 호출. */
    private fun applyTtsLocale() = applyTtsLocaleFor(sessionLocale)

    private fun applyTtsLocaleFor(locale: String) {
        val t = tts ?: return
        if (!ttsReady) return
        val target = if (locale.lowercase(Locale.US).startsWith("ko")) Locale.KOREAN else Locale.US
        try { t.setLanguage(target) } catch (e: Exception) { Log.w(TAG, "TTS setLanguage failed", e) }
    }

    /** 카운트다운 전용 — voiceEnabled 가드 없음 (iOS speakText 계약과 동일).
     *  localeOverride: 세션 시작 전 발화의 TTS 언어 (카운트다운 en/ko 불일치 fix). */
    fun speakTextNow(text: String, localeOverride: String? = null): Boolean {
        if (text.isEmpty()) return false
        ensureTts()
        val t = tts ?: return false
        if (!ttsReady) return false   // 미준비면 false → JS 가 beep 폴백
        handler.post {
            if (localeOverride != null) applyTtsLocaleFor(localeOverride)
            requestAudioFocus()
            val params = Bundle().apply { putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 0.65f) }
            t.speak(text, TextToSpeech.QUEUE_ADD, params, "run-session-${System.nanoTime()}")
        }
        return true
    }

    /** 세션 발화 (마일스톤/자동정지) — voiceEnabled 가드. handler 스레드에서 호출됨. */
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

    // ── 알림 제목/본문 (RunSessionService) ───────────────────────────────────

    private fun notificationTitle(): String =
        if (sessionLocale.lowercase(Locale.US).startsWith("ko")) "달리기 기록 중" else "Recording your run"

    private fun notificationText(nowMs: Long): String {
        val kmText = String.format(Locale.US, "%.2f", gpsDistanceM / 1000.0)
        val secs = currentActiveSec(nowMs).toLong()
        val hh = secs / 3600
        val mm = (secs % 3600) / 60
        val ss = secs % 60
        val time = if (hh > 0) String.format(Locale.US, "%d:%02d:%02d", hh, mm, ss)
                   else String.format(Locale.US, "%02d:%02d", mm, ss)
        val isKo = sessionLocale.lowercase(Locale.US).startsWith("ko")
        // 2026-08-03 (iOS Live Activity 동등화): 페이스도 잠금화면 알림에 표시
        val paceSec = if (gpsDistanceM > 50) (secs / (gpsDistanceM / 1000.0)).toLong() else 0
        val pace = if (paceSec > 0) String.format(Locale.US, " · %d'%02d\"/km", paceSec / 60, paceSec % 60) else ""
        return when (state) {
            State.PAUSED -> if (isKo) "일시정지 · $kmText km · $time" else "Paused · $kmText km · $time"
            State.AUTO_PAUSED -> if (isKo) "자동 일시정지 · $kmText km · $time" else "Auto paused · $kmText km · $time"
            else -> "$kmText km · $time$pace"
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
            put("autoPauseCount", autoPauseCount)
            put("milestonesFired", milestonesFired)
            put("milestoneEveryKm", milestoneEveryKm)
            put("lastMilestoneDistanceM", lastMilestoneDistanceM)
            put("lastMilestoneActiveSec", lastMilestoneActiveSec)
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
            autoPauseCount = snap.optInt("autoPauseCount", 0)
            milestonesFired = snap.optInt("milestonesFired", 0)
            milestoneEveryKm = snap.optDouble("milestoneEveryKm", 1.0)
            // 키 부재 (구버전 snapshot) 시 현재 누적치를 기준점으로 (iOS restore 와 동일 규칙).
            lastMilestoneDistanceM = snap.optDouble("lastMilestoneDistanceM", gpsDistanceM)
            lastMilestoneActiveSec = snap.optDouble("lastMilestoneActiveSec", accumulatedActiveSec)
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
                // 리뷰 P2: 복원 프로세스에선 JS 의 prepareAudio 가 없다 — 여기서 예열해야
                // 복원 후 첫 마일스톤/자동정지 발화가 무음으로 사라지지 않음.
                if (voiceEnabled) ensureTts()
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
        gapFilledM = 0.0
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
        accelEmaDev = null
        lastMotionAtMs = null
        motionSinceMs = null
        autoPauseCount = 0
        milestonesFired = 0
        lastMilestoneDistanceM = 0.0
        lastMilestoneActiveSec = 0.0
        tickCount = 0
    }
}
