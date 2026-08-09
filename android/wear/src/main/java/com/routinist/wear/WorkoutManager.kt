package com.routinist.wear

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import androidx.concurrent.futures.await
import androidx.health.services.client.ExerciseClient
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseState
import androidx.health.services.client.data.ExerciseUpdate
import androidx.health.services.client.data.LocationData
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * Galaxy Watch 러닝 엔진 (Wear OS Phase 3 → v3, 2026-07-29).
 *
 * v1: ExerciseClient 라이브 메트릭 + Data Layer 완주 전송 (Supabase 직행, HC 우회)
 * v3 (애플워치 v7~v9 이식):
 *  - 자동 일시정지/재개 — Health Services 네이티브 (isAutoPauseAndResumeEnabled) + 음성
 *  - 심박존 1~5 — maxHr 는 폰 watch_ctx 동기값 (CtxReceiverService) 폴백 190
 *  - 목표 (거리/시간) — SharedPreferences 저장, 달성 시 음성+햅틱 1회
 *  - km 구간 페이스 음성 ("이번 구간 5분 30초") + 심박 스파크라인 샘플
 */
object WorkoutManager {

    // 걷기 감지 임계값 — iOS(RunSessionPlugin)·애플워치(WorkoutManager.swift) 와 동일 값.
    private const val WALK_CADENCE_MAX_SPM = 132.0   // 미만이 12초 지속 = 걷기/정지
    private const val RUN_CADENCE_MIN_SPM = 150.0    // 이상 = 달리는 중
    private const val WALK_HOLD_MS = 12_000L
    private const val RESUME_HOLD_MS = 3_000L

    enum class Phase { IDLE, REQUESTING, COUNTDOWN, ACTIVE, PAUSED, AUTO_PAUSED, ENDED }

    /** 목표 — 거리(m) 또는 시간(초). 둘 다 null 이면 자유 러닝. */
    data class RunGoal(val distanceM: Double? = null, val timeSec: Int? = null) {
        val isSet: Boolean get() = distanceM != null || timeSec != null
    }

    data class Summary(
        val distanceMeters: Double,
        val elapsedSec: Double,
        val avgHr: Double,
        val calories: Double,
        val zoneSeconds: DoubleArray = DoubleArray(5),   // v4: 존 체류 (애플 v19 이식)
    ) {
        val paceSecPerKm: Double? get() = if (distanceMeters > 50) elapsedSec / (distanceMeters / 1000) else null
    }

    data class RunState(
        val phase: Phase = Phase.IDLE,
        val elapsedSec: Double = 0.0,
        val distanceMeters: Double = 0.0,
        val heartRate: Double = 0.0,
        val calories: Double = 0.0,
        val summary: Summary? = null,
        val error: String? = null,
        // v3
        val goal: RunGoal = RunGoal(),
        val goalAchieved: Boolean = false,
        val maxHr: Double = 190.0,
        val lastSplitSecPerKm: Double? = null,
        val hrSamples: List<Float> = emptyList(),
    ) {
        val paceSecPerKm: Double? get() = if (distanceMeters > 50) elapsedSec / (distanceMeters / 1000) else null

        /** 심박존 1~5 (0 = 측정 전) — 애플워치와 동일 경계 (60/70/80/90%) */
        val hrZone: Int get() {
            if (heartRate <= 0) return 0
            val pct = heartRate / maxHr
            return when {
                pct < 0.60 -> 1
                pct < 0.70 -> 2
                pct < 0.80 -> 3
                pct < 0.90 -> 4
                else -> 5
            }
        }

        /** 목표 진행률 0~1 (미설정이면 null) */
        val goalProgress: Double? get() = when {
            goal.distanceM != null -> (distanceMeters / goal.distanceM).coerceIn(0.0, 1.0)
            goal.timeSec != null -> (elapsedSec / goal.timeSec).coerceIn(0.0, 1.0)
            else -> null
        }
    }

    private val _state = MutableStateFlow(RunState())
    val state: StateFlow<RunState> = _state.asStateFlow()

    private val scope = CoroutineScope(Dispatchers.Main)
    private var appContext: Context? = null
    private var exerciseClient: ExerciseClient? = null

    // 경과시간 = 벽시계 - 누적 일시정지 (수동+자동 공통 보정)
    @Volatile private var runStartWallMs: Long = 0
    @Volatile private var pausedAccumMs: Long = 0
    @Volatile private var pauseStartMs: Long = 0

    // ── 케이던스 기반 걷기 감지 (2026-08-09, iOS·애플워치와 동일 임계값) ──────
    // 속도로는 걷기(4~5km/h)와 초보 조깅(7~8분/km)이 겹쳐 임계값을 못 잡는다.
    // 케이던스는 걷기 100~125spm / 달리기 150~180spm 로 갈라진다. 중립대는 완충.
    private var slowCadenceSinceMs = 0L
    private var runCadenceSinceMs = 0L
    /// 우리가 "걷기" 로 멈춘 상태 — 네이티브 AUTO_PAUSED 와 구분해 재개를 우리가 소유한다.
    private var walkPaused = false
    /// 이 기기가 STEPS_PER_MINUTE 를 지원하는지 (미지원이면 케이던스 걷기 감지 비활성).
    private var cadenceSupported = false
    private var ticker: Job? = null

    // GPS 경로 [[lat, lng, alt, epochMs], ...]
    private val route = ArrayList<DoubleArray>()

    private var lastAnnouncedKm = 0
    private var lastKmElapsedSec = 0.0
    private var startMs = 0L
    private var avgHrSum = 0.0
    private var avgHrCount = 0
    private val hrBuffer = ArrayList<Float>()

    private const val PREFS = "wear_workout"
    private const val KEY_GOAL_DIST = "goal_distance_m"
    private const val KEY_GOAL_TIME = "goal_time_sec"
    const val KEY_MAX_HR = "ctx_max_hr"   // CtxReceiverService 가 기록

    // ── v4: 존별 체류 시간 (애플워치 v19 이식) ──
    private val zoneSeconds = DoubleArray(5)
    private var lastZoneTickMs = 0L

    private fun accumulateZone() {
        val st = _state.value
        if (st.phase != Phase.ACTIVE || st.hrZone <= 0) { lastZoneTickMs = 0L; return }
        val now = System.currentTimeMillis()
        if (lastZoneTickMs > 0) {
            zoneSeconds[st.hrZone - 1] += ((now - lastZoneTickMs) / 1000.0).coerceAtMost(30.0)
        }
        lastZoneTickMs = now
    }

    // ── TTS ──────────────────────────────────────────────────────
    private var tts: TextToSpeech? = null
    private var ttsReady = false

    fun initTts(context: Context) {
        appContext = context.applicationContext
        loadGoal()
        loadMaxHr()
        if (tts != null) return
        tts = TextToSpeech(appContext) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) tts?.language = Locale.KOREAN
        }
    }

    private fun speak(text: String) {
        // v4 (애플 v19 이식): 폰에 이어폰이 있으면 폰이 발화 (ack 왕복), 1.2초 내 ack 없으면 워치 로컬.
        VoiceRelay.speakViaPhoneOrLocal(appContext, text) { local ->
            if (local && ttsReady) tts?.speak(text, TextToSpeech.QUEUE_ADD, null, text)
        }
    }

    private fun speakLocal(text: String) {
        if (ttsReady) tts?.speak(text, TextToSpeech.QUEUE_ADD, null, text)
    }

    fun speakCount(n: Int) {
        val words = arrayOf("", "일", "이", "삼")
        if (n in 1..3) speak(words[n])
    }

    /** 1~99 한자어 수사 ("십일 킬로미터" 오독 방지 — 폰·애플워치와 동일) */
    private fun sinoKorean(n: Int): String {
        if (n !in 1..99) return n.toString()
        val d = arrayOf("", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구")
        val tens = n / 10; val ones = n % 10
        val sb = StringBuilder()
        if (tens >= 2) sb.append(d[tens])
        if (tens >= 1) sb.append("십")
        sb.append(d[ones])
        return sb.toString()
    }

    // ── v3: 햅틱 ─────────────────────────────────────────────────
    private fun haptic(ms: Long = 200) {
        val ctx = appContext ?: return
        try {
            val vibrator: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
            vibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
        } catch (_: Exception) { /* 햅틱 실패는 무시 */ }
    }

    // ── v3: 목표 저장/로드 ───────────────────────────────────────
    fun setGoal(goal: RunGoal) {
        _state.value = _state.value.copy(goal = goal, goalAchieved = false)
        appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)?.edit()?.apply {
            if (goal.distanceM != null) putFloat(KEY_GOAL_DIST, goal.distanceM.toFloat()) else remove(KEY_GOAL_DIST)
            if (goal.timeSec != null) putInt(KEY_GOAL_TIME, goal.timeSec) else remove(KEY_GOAL_TIME)
            apply()
        }
    }

    private fun loadGoal() {
        val p = appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE) ?: return
        val dist = if (p.contains(KEY_GOAL_DIST)) p.getFloat(KEY_GOAL_DIST, 0f).toDouble() else null
        val time = if (p.contains(KEY_GOAL_TIME)) p.getInt(KEY_GOAL_TIME, 0) else null
        _state.value = _state.value.copy(goal = RunGoal(dist, time))
    }

    /** CtxReceiverService 가 새 max_hr 를 받으면 호출 (또는 initTts 때 프리로드) */
    fun loadMaxHr() {
        val p = appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE) ?: return
        val v = p.getFloat(KEY_MAX_HR, 0f)
        if (v in 120f..230f) _state.value = _state.value.copy(maxHr = v.toDouble())
    }

    private fun checkGoal() {
        val s = _state.value
        if (s.goalAchieved || s.phase != Phase.ACTIVE || !s.goal.isSet) return
        val done = (s.goal.distanceM != null && s.distanceMeters >= s.goal.distanceM)
            || (s.goal.timeSec != null && s.elapsedSec >= s.goal.timeSec)
        if (done) {
            _state.value = _state.value.copy(goalAchieved = true)
            haptic(400)
            speak("목표 달성! 정말 대단해요.")
        }
    }

    // ── 상태 전이 ────────────────────────────────────────────────

    /** 진행 중인 세션이 있는지 (START_STICKY 재기동이 기록을 초기화하지 않게 서비스가 확인). */
    fun isRunning(): Boolean = _state.value.phase.let {
        it == Phase.ACTIVE || it == Phase.PAUSED || it == Phase.AUTO_PAUSED
    }

    fun requestCountdown() {
        if (_state.value.phase != Phase.IDLE) return
        _state.value = _state.value.copy(phase = Phase.COUNTDOWN, error = null)
    }

    fun beginExercise(context: Context) {
        appContext = context.applicationContext
        val client = HealthServices.getClient(context).exerciseClient
        exerciseClient = client

        route.clear()
        hrBuffer.clear()
        lastAnnouncedKm = 0
        lastKmElapsedSec = 0.0
        avgHrSum = 0.0; avgHrCount = 0
        pausedAccumMs = 0
        pauseStartMs = 0
        slowCadenceSinceMs = 0L
        runCadenceSinceMs = 0L
        walkPaused = false
        startMs = System.currentTimeMillis()
        loadMaxHr()
        _state.value = _state.value.copy(goalAchieved = false, lastSplitSecPerKm = null, hrSamples = emptyList())

        client.setUpdateCallback(callback)

        scope.launch {
            try {
                // 2026-08-09 리뷰 P0: STEPS_PER_MINUTE 를 capability 확인 없이 구독하면, 이 타입을
                // RUNNING 에 노출하지 않는 Wear 기기(픽셀워치·티크워치 등 OEM 편차)에서
                // startExerciseAsync 가 throw → 러닝 자체가 시작 불가. 지원 기기에서만 추가한다.
                val supported = runCatching {
                    client.getCapabilitiesAsync().await()
                        .getExerciseTypeCapabilities(androidx.health.services.client.data.ExerciseType.RUNNING)
                        .supportedDataTypes
                }.getOrNull() ?: emptySet()
                cadenceSupported = DataType.STEPS_PER_MINUTE in supported

                val dataTypes = buildSet {
                    add(DataType.HEART_RATE_BPM)
                    add(DataType.LOCATION)
                    add(DataType.DISTANCE_TOTAL)
                    add(DataType.CALORIES_TOTAL)
                    if (cadenceSupported) add(DataType.STEPS_PER_MINUTE)   // 걷기 감지용
                }
                val config = ExerciseConfig(
                    exerciseType = androidx.health.services.client.data.ExerciseType.RUNNING,
                    dataTypes = dataTypes,
                    // v3: 자동 일시정지 — Health Services 네이티브 감지 (완전 정지). 걷기 감지는
                    // 우리 케이던스가 담당하고, 이건 완전 정지의 폴백으로 공존한다.
                    isAutoPauseAndResumeEnabled = true,
                    isGpsEnabled = true,
                )
                client.startExerciseAsync(config).await()
                runStartWallMs = System.currentTimeMillis()
                _state.value = _state.value.copy(phase = Phase.ACTIVE)
                speak("출발!")
                startTicker()
            } catch (e: Exception) {
                _state.value = _state.value.copy(phase = Phase.IDLE, error = "운동을 시작할 수 없어요")
            }
        }
    }

    private fun startTicker() {
        ticker?.cancel()
        ticker = scope.launch {
            while (true) {
                val s = _state.value
                if (s.phase == Phase.ACTIVE && runStartWallMs > 0) {
                    val elapsed = (System.currentTimeMillis() - runStartWallMs - pausedAccumMs) / 1000.0
                    _state.value = s.copy(elapsedSec = elapsed)
                    checkGoal()   // 시간 목표는 틱에서 판정
                }
                // v5 라이브 미러: 달리는 중·쉬는 중 모두 5s 스로틀 전송 (폰 알림 + /track 패널)
                if (s.phase == Phase.ACTIVE || s.phase == Phase.PAUSED || s.phase == Phase.AUTO_PAUSED) {
                    LiveMirror.tick(appContext, _state.value)
                }
                delay(250)
            }
        }
    }

    fun togglePause() {
        val client = exerciseClient ?: return
        // 사용자가 직접 조작하면 걷기 감지 소유권을 놓는다 — 안 그러면 수동 재개 직후
        // 걷기 판정이 남아 있어 다시 멈추거나, USER_PAUSED 반영이 walkPaused 에 막힌다.
        val wasWalkPaused = walkPaused
        walkPaused = false
        slowCadenceSinceMs = 0L
        runCadenceSinceMs = 0L
        scope.launch {
            runCatching {
                when (_state.value.phase) {
                    Phase.ACTIVE -> client.pauseExerciseAsync().await()
                    Phase.PAUSED, Phase.AUTO_PAUSED -> client.resumeExerciseAsync().await()
                    else -> {}
                }
            }.onFailure { walkPaused = wasWalkPaused }
        }
    }

    fun end() {
        val client = exerciseClient ?: return
        scope.launch { runCatching { client.endExerciseAsync().await() } }
    }

    fun reset() {
        ticker?.cancel(); ticker = null
        route.clear()
        hrBuffer.clear()
        zoneSeconds.fill(0.0)
        lastZoneTickMs = 0L
        // 목표·maxHr 는 유지 (다음 러닝에 이어짐 — 애플워치 v14 트레이드오프와 동일)
        _state.value = RunState(goal = _state.value.goal, maxHr = _state.value.maxHr)
    }

    // ── ExerciseClient 콜백 ──────────────────────────────────────

    private val callback = object : ExerciseUpdateCallback {
        override fun onRegistered() {}

        override fun onRegistrationFailed(throwable: Throwable) {
            _state.value = _state.value.copy(error = "센서 등록 실패")
        }

        override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
            val m = update.latestMetrics

            m.getData(DataType.HEART_RATE_BPM).lastOrNull()?.let { hr ->
                val v = hr.value
                if (v > 0) {
                    avgHrSum += v; avgHrCount++
                    hrBuffer.add(v.toFloat())
                    if (hrBuffer.size > 240) hrBuffer.removeAt(0)
                }
                _state.value = _state.value.copy(
                    heartRate = v,
                    hrSamples = ArrayList(hrBuffer),
                )
                accumulateZone()   // v4: 존 체류 적산
            }
            m.getData(DataType.DISTANCE_TOTAL)?.let {
                _state.value = _state.value.copy(distanceMeters = it.total)
            }
            m.getData(DataType.CALORIES_TOTAL)?.let {
                _state.value = _state.value.copy(calories = it.total)
            }

            val now = System.currentTimeMillis()
            m.getData(DataType.LOCATION).forEach { sample ->
                val loc: LocationData = sample.value
                route.add(doubleArrayOf(loc.latitude, loc.longitude, loc.altitude ?: 0.0, now.toDouble()))
            }

            m.getData(DataType.STEPS_PER_MINUTE).lastOrNull()?.let {
                evaluateCadence(it.value.toDouble(), now)
            }

            announceKmIfNeeded()
            checkGoal()   // 거리 목표는 거리 갱신에서 판정
            reflectState(update.exerciseStateInfo.state)
        }

        override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) {}

        override fun onAvailabilityChanged(dataType: DataType<*, *>, availability: Availability) {}
    }

    private fun announceKmIfNeeded() {
        val s = _state.value
        val km = (s.distanceMeters / 1000).toInt()
        if (km > lastAnnouncedKm) {
            lastAnnouncedKm = km
            // v3: 구간 페이스 — 직전 km 경계 이후 걸린 시간 (애플워치 v7·폰 템플릿과 동일)
            val splitSec = s.elapsedSec - lastKmElapsedSec
            lastKmElapsedSec = s.elapsedSec
            val split = if (splitSec > 60) splitSec else s.paceSecPerKm
            if (split != null) _state.value = _state.value.copy(lastSplitSecPerKm = split)
            haptic(120)
            var text = "${sinoKorean(km)} 킬로미터 통과."
            if (split != null) {
                val t = Math.round(split).toInt(); val mm = t / 60; val ss = t % 60
                text += if (ss == 0) " 이번 구간 $mm 분." else " 이번 구간 $mm 분 $ss 초."
            }
            text += " 잘하고 있어요."
            speak(text)
        }
    }

    /** 케이던스(spm)로 걷기/달리기를 갈라 자동정지·재개를 구동. iOS·애플워치와 동일 임계값. */
    private fun evaluateCadence(spm: Double, nowMs: Long) {
        // 2026-08-09 리뷰 P0: 걷기 정지에 Health Services pauseExerciseAsync 를 쓰지 않는다.
        // pause 하면 HS 가 STEPS_PER_MINUTE 배달을 끊는데, 이 함수는 그 데이터 수신에서만
        // 호출되므로 → 재개 판정이 영영 안 돌아 walkPaused 영구(=러닝 동결).
        // 대신 phase 만 AUTO_PAUSED 로 둔다: ticker 가 elapsedSec 를 ACTIVE 일 때만 갱신하므로
        // 시간은 멈추고(pausedAccumMs 로 보정), 세션은 살아있어 데이터가 계속 흘러 재개가 된다.
        if (walkPaused) {
            // 걷는 동안엔 재개하지 않는다 — "다시 뛰기 시작" 만 재개 조건 (발진 차단).
            if (spm >= RUN_CADENCE_MIN_SPM) {
                if (runCadenceSinceMs == 0L) runCadenceSinceMs = nowMs
                if (nowMs - runCadenceSinceMs >= RESUME_HOLD_MS) {
                    if (pauseStartMs > 0L) { pausedAccumMs += nowMs - pauseStartMs; pauseStartMs = 0L }
                    walkPaused = false
                    runCadenceSinceMs = 0L
                    slowCadenceSinceMs = 0L
                    haptic(80)
                    speak("다시 시작합니다. 같이 가요.")
                    _state.value = _state.value.copy(phase = Phase.ACTIVE)
                }
            } else {
                runCadenceSinceMs = 0L
            }
            return
        }
        if (_state.value.phase != Phase.ACTIVE) return
        // 러닝 대역 미달이면 창을 세우되, 걷기 대역 지속만 정지 (중립대는 창 리셋 — 리뷰 P1).
        if (spm >= WALK_CADENCE_MAX_SPM) {
            slowCadenceSinceMs = 0L
        } else {
            if (slowCadenceSinceMs == 0L) slowCadenceSinceMs = nowMs
            if (nowMs - slowCadenceSinceMs >= WALK_HOLD_MS) {
                walkPaused = true
                slowCadenceSinceMs = 0L
                pauseStartMs = nowMs
                haptic(150)
                speak("걷기 감지. 잠시 멈출게요.")
                _state.value = _state.value.copy(phase = Phase.AUTO_PAUSED)
            }
        }
    }

    private fun reflectState(exState: ExerciseState) {
        val cur = _state.value.phase
        when {
            exState.isEnded -> onEnded()
            exState == ExerciseState.ACTIVE -> {
                // 걷기 정지(walkPaused)는 HS 를 pause 하지 않으므로 HS 는 계속 ACTIVE 를 보낸다.
                // 이때 phase 를 되돌리면 우리가 건 걷기 정지가 즉시 풀린다 — 재개는 evaluateCadence 소유.
                if (walkPaused) return
                if (cur == Phase.PAUSED || cur == Phase.AUTO_PAUSED) {
                    if (pauseStartMs > 0) pausedAccumMs += System.currentTimeMillis() - pauseStartMs
                    pauseStartMs = 0
                    if (cur == Phase.AUTO_PAUSED) speak("다시 시작합니다. 같이 가요.")
                    _state.value = _state.value.copy(phase = Phase.ACTIVE)
                }
            }
            exState == ExerciseState.USER_PAUSED -> {
                // 걷기 감지로 우리가 건 정지는 화면상 '자동 일시정지' 로 유지 (재개도 우리 소유).
                if (walkPaused) return
                if (cur == Phase.ACTIVE || cur == Phase.AUTO_PAUSED) {
                    if (pauseStartMs == 0L) pauseStartMs = System.currentTimeMillis()
                    _state.value = _state.value.copy(phase = Phase.PAUSED)
                }
            }
            exState == ExerciseState.AUTO_PAUSED -> {
                if (cur == Phase.ACTIVE) {
                    pauseStartMs = System.currentTimeMillis()
                    haptic(150)
                    speak("자동 일시정지. 다시 움직이면 이어서 잴게요.")
                    _state.value = _state.value.copy(phase = Phase.AUTO_PAUSED)
                }
            }
            else -> {}
        }
    }

    private fun onEnded() {
        if (_state.value.phase == Phase.ENDED) return
        ticker?.cancel(); ticker = null
        LiveMirror.ended(appContext)   // v5: 폰 라이브 알림·패널 즉시 내림
        val s = _state.value
        val avgHr = if (avgHrCount > 0) avgHrSum / avgHrCount else 0.0
        val summary = Summary(s.distanceMeters, s.elapsedSec, avgHr, s.calories, zoneSeconds.copyOf())
        _state.value = s.copy(phase = Phase.ENDED, summary = summary)

        appContext?.let { ctx ->
            RunSender.send(
                ctx,
                RunSender.CompletedRun(
                    clientRecordId = "watch-$startMs",
                    startMs = startMs,
                    endMs = System.currentTimeMillis(),
                    distanceMeters = s.distanceMeters,
                    durationSec = s.elapsedSec,
                    calories = s.calories,
                    avgHr = avgHr,
                    route = ArrayList(route),
                    zoneSeconds = zoneSeconds.copyOf(),
                    maxHr = s.maxHr,
                ),
            )
        }
        scope.launch { runCatching { exerciseClient?.clearUpdateCallbackAsync(callback)?.await() } }
        ExerciseRecordingService.stop(appContext)
    }
}
