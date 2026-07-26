package com.routinist.wear

import android.content.Context
import android.os.Build
import android.speech.tts.TextToSpeech
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
import androidx.concurrent.futures.await
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
 * Galaxy Watch 러닝 엔진 (Wear OS Phase 3, 2026-07-26).
 *
 * iOS RoutinistWatch/WorkoutManager 의 Android 대응물. HealthKit 대신 Health Services
 * ExerciseClient 로 라이브 메트릭(시간·거리·심박·칼로리·GPS)을 수집한다.
 *
 * ⚠️ 애플과 다른 핵심: Wear OS 에는 Health Connect 가 없다. 그래서 완주 시
 * HealthKit 저장 대신 [RunSender] 로 완주 데이터를 폰에 전송하고, 폰이 Health Connect 에
 * write → 기존 임포터가 읽는다. (구글 공식 피트니스 앱 가이드 구조)
 *
 * 프로세스 싱글턴(object) — [ExerciseRecordingService] 포그라운드 서비스가 수명을 유지하고
 * Compose UI 가 [state] 를 관찰한다.
 */
object WorkoutManager {

    enum class Phase { IDLE, REQUESTING, COUNTDOWN, ACTIVE, PAUSED, ENDED }

    data class Summary(
        val distanceMeters: Double,
        val elapsedSec: Double,
        val avgHr: Double,
        val calories: Double,
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
    ) {
        val paceSecPerKm: Double? get() = if (distanceMeters > 50) elapsedSec / (distanceMeters / 1000) else null
    }

    private val _state = MutableStateFlow(RunState())
    val state: StateFlow<RunState> = _state.asStateFlow()

    private val scope = CoroutineScope(Dispatchers.Main)
    private var appContext: Context? = null
    private var exerciseClient: ExerciseClient? = null

    // 경과시간 = 벽시계 - 누적 일시정지 (auto-pause off 이므로 수동 pause 만 보정).
    // activeDurationCheckpoint 는 기기/합성별로 0 을 보내는 경우가 있어 신뢰하지 않음.
    @Volatile private var runStartWallMs: Long = 0
    @Volatile private var pausedAccumMs: Long = 0
    @Volatile private var pauseStartMs: Long = 0
    private var ticker: Job? = null

    // GPS 경로 [[lat, lng, alt, epochMs], ...]
    private val route = ArrayList<DoubleArray>()

    private var lastAnnouncedKm = 0
    private var startMs = 0L
    private var avgHrSum = 0.0
    private var avgHrCount = 0

    // ── TTS ──────────────────────────────────────────────────────
    private var tts: TextToSpeech? = null
    private var ttsReady = false

    fun initTts(context: Context) {
        appContext = context.applicationContext
        if (tts != null) return
        tts = TextToSpeech(appContext) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) tts?.language = Locale.KOREAN
        }
    }

    private fun speak(text: String) {
        if (ttsReady) tts?.speak(text, TextToSpeech.QUEUE_ADD, null, text)
    }

    /** 카운트다운 음성 — 폰/애플워치와 동일 "삼 / 이 / 일" */
    fun speakCount(n: Int) {
        val words = arrayOf("", "일", "이", "삼")
        if (n in 1..3) speak(words[n])
    }

    /** 1~99 한자어 수사 ("십일 킬로미터" 오독 방지) */
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

    // ── 상태 전이 ────────────────────────────────────────────────

    /** Start 버튼 → 권한 확보 후 호출. UI 가 3-2-1 카운트다운을 그린다. */
    fun requestCountdown() {
        if (_state.value.phase != Phase.IDLE) return
        _state.value = RunState(phase = Phase.COUNTDOWN)
    }

    /**
     * 카운트다운 종료 → 포그라운드 서비스가 이 메서드를 호출해 실제 운동 시작.
     * (ExerciseClient 는 health|location FGS 안에서 살아 있어야 화면 잠금에도 유지됨)
     */
    fun beginExercise(context: Context) {
        appContext = context.applicationContext
        val client = HealthServices.getClient(context).exerciseClient
        exerciseClient = client

        route.clear()
        lastAnnouncedKm = 0
        avgHrSum = 0.0; avgHrCount = 0
        pausedAccumMs = 0
        pauseStartMs = 0
        startMs = System.currentTimeMillis()

        client.setUpdateCallback(callback)

        val config = ExerciseConfig(
            exerciseType = androidx.health.services.client.data.ExerciseType.RUNNING,
            dataTypes = setOf(
                DataType.HEART_RATE_BPM,
                DataType.LOCATION,
                DataType.DISTANCE_TOTAL,
                DataType.CALORIES_TOTAL,
            ),
            isAutoPauseAndResumeEnabled = false,
            isGpsEnabled = true,
        )
        scope.launch {
            try {
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
                }
                delay(250)
            }
        }
    }

    fun togglePause() {
        val client = exerciseClient ?: return
        scope.launch {
            runCatching {
                when (_state.value.phase) {
                    Phase.ACTIVE -> client.pauseExerciseAsync().await()
                    Phase.PAUSED -> client.resumeExerciseAsync().await()
                    else -> {}
                }
            }
        }
    }

    fun end() {
        val client = exerciseClient ?: return
        scope.launch { runCatching { client.endExerciseAsync().await() } }
    }

    /** 요약 닫기 → 초기 화면 */
    fun reset() {
        ticker?.cancel(); ticker = null
        route.clear()
        _state.value = RunState()
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
                if (v > 0) { avgHrSum += v; avgHrCount++ }
                update(heartRate = v)
            }
            m.getData(DataType.DISTANCE_TOTAL)?.let { update(distanceMeters = it.total) }
            m.getData(DataType.CALORIES_TOTAL)?.let { update(calories = it.total) }

            val now = System.currentTimeMillis()
            m.getData(DataType.LOCATION).forEach { sample ->
                val loc: LocationData = sample.value
                route.add(doubleArrayOf(loc.latitude, loc.longitude, loc.altitude ?: 0.0, now.toDouble()))
            }

            announceKmIfNeeded()
            reflectState(update.exerciseStateInfo.state)
        }

        override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) {}

        override fun onAvailabilityChanged(dataType: DataType<*, *>, availability: Availability) {}
    }

    private fun update(
        heartRate: Double = _state.value.heartRate,
        distanceMeters: Double = _state.value.distanceMeters,
        calories: Double = _state.value.calories,
    ) {
        _state.value = _state.value.copy(
            heartRate = heartRate,
            distanceMeters = distanceMeters,
            calories = calories,
        )
    }

    private fun announceKmIfNeeded() {
        val km = (_state.value.distanceMeters / 1000).toInt()
        if (km > lastAnnouncedKm) {
            lastAnnouncedKm = km
            val pace = _state.value.paceSecPerKm
            var text = "${sinoKorean(km)} 킬로미터 통과."
            if (pace != null) {
                val t = Math.round(pace).toInt(); val mm = t / 60; val ss = t % 60
                text += if (ss == 0) " 평균 페이스 $mm 분." else " 평균 페이스 $mm 분 $ss 초."
            }
            text += " 잘하고 있어요."
            speak(text)
        }
    }

    private fun reflectState(exState: ExerciseState) {
        when {
            exState.isEnded -> onEnded()
            exState == ExerciseState.ACTIVE -> {
                if (_state.value.phase == Phase.PAUSED) {
                    // 재개 — 일시정지했던 시간을 누적에서 보정
                    if (pauseStartMs > 0) pausedAccumMs += System.currentTimeMillis() - pauseStartMs
                    pauseStartMs = 0
                    _state.value = _state.value.copy(phase = Phase.ACTIVE)
                }
            }
            exState == ExerciseState.USER_PAUSED || exState == ExerciseState.AUTO_PAUSED -> {
                if (_state.value.phase == Phase.ACTIVE) {
                    pauseStartMs = System.currentTimeMillis()
                    _state.value = _state.value.copy(phase = Phase.PAUSED)
                }
            }
            else -> {}
        }
    }

    private fun onEnded() {
        if (_state.value.phase == Phase.ENDED) return
        ticker?.cancel(); ticker = null
        val s = _state.value
        val avgHr = if (avgHrCount > 0) avgHrSum / avgHrCount else 0.0
        val summary = Summary(s.distanceMeters, s.elapsedSec, avgHr, s.calories)
        _state.value = s.copy(phase = Phase.ENDED, summary = summary)

        // 완주 데이터 → 폰으로 전송 (폰이 Health Connect 에 write)
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
                ),
            )
        }
        scope.launch { runCatching { exerciseClient?.clearUpdateCallbackAsync(callback)?.await() } }
        // 서비스에게 종료 알림
        ExerciseRecordingService.stop(appContext)
    }
}
