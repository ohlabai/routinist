package com.routinist.wear.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.routinist.wear.ExerciseRecordingService
import com.routinist.wear.WorkoutManager
import com.routinist.wear.WorkoutManager.RunGoal
import kotlinx.coroutines.delay

@Composable
fun RunApp() {
    MaterialTheme {
        val state by WorkoutManager.state.collectAsState()
        val context = LocalContext.current

        val permLauncher = rememberLauncherForActivityResult(
            ActivityResultContracts.RequestMultiplePermissions(),
        ) { result ->
            val essential = result.filterKeys { it != Manifest.permission.POST_NOTIFICATIONS }
            if (essential.values.all { it }) WorkoutManager.requestCountdown()
        }

        Box(
            Modifier.fillMaxSize().background(Brand.ScreenGradient),
            contentAlignment = Alignment.Center,
        ) {
            when (state.phase) {
                WorkoutManager.Phase.IDLE,
                WorkoutManager.Phase.REQUESTING,
                -> StartScreen(
                    goal = state.goal,
                    error = state.error,
                    onStart = { permLauncher.launch(requiredPermissions()) },
                )

                WorkoutManager.Phase.COUNTDOWN -> CountdownScreen { ExerciseRecordingService.start(context) }

                WorkoutManager.Phase.ACTIVE,
                WorkoutManager.Phase.PAUSED,
                WorkoutManager.Phase.AUTO_PAUSED,
                -> MetricsScreen(state)

                WorkoutManager.Phase.ENDED -> SummaryScreen(state.summary) { WorkoutManager.reset() }
            }
        }
    }
}

private fun requiredPermissions(): Array<String> {
    val perms = mutableListOf(
        Manifest.permission.ACTIVITY_RECOGNITION,
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.BODY_SENSORS,
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        perms.add(Manifest.permission.POST_NOTIFICATIONS)
    }
    return perms.toTypedArray()
}

// ── 시작 화면 — v3: 목표 버튼 (애플워치 v14 친근 카피) ──────────
@Composable
private fun StartScreen(goal: RunGoal, error: String?, onStart: () -> Unit) {
    var showGoalSheet by remember { mutableStateOf(false) }
    val t = rememberInfiniteTransition(label = "intro")
    val bob by t.animateFloat(
        0f, 1f, infiniteRepeatable(tween(1800, easing = LinearEasing), RepeatMode.Reverse), label = "bob",
    )

    if (showGoalSheet) {
        GoalSheet(current = goal, onDone = { showGoalSheet = false })
        return
    }

    Box(Modifier.fillMaxSize()) {
        Column(
            // 하단 패딩 — 목표 칩이 잔디 물결·라운드 곡면과 겹치지 않게 (v3 fix)
            Modifier.fillMaxSize().padding(horizontal = 18.dp).padding(bottom = 30.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            SproutMark(Modifier.padding(bottom = (1 + bob * 3).dp), sizeDp = 24)
            Text("루티니스트", color = Brand.EmeraldLight, fontSize = 20.sp, fontWeight = FontWeight.Black)
            Spacer(Modifier.height(2.dp))
            Text("오늘도 달려볼까요?", color = Brand.Snow, fontSize = 12.sp)
            if (error != null) {
                Spacer(Modifier.height(4.dp))
                Text(error, color = Brand.Heart, fontSize = 12.sp, textAlign = TextAlign.Center)
            }
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = onStart,
                colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent),
                // 라운드 화면 수직 예산 확보 — 기본(52dp)보다 낮은 40dp
                modifier = Modifier.height(40.dp).clip(RoundedCornerShape(20.dp)).background(Brand.CtaGradient),
            ) {
                Text("달리기 시작", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Brand.Ink)
            }
            Spacer(Modifier.height(7.dp))
            // v3: 목표 칩 — 애플워치 v14 카피 ("오늘은 얼마쯤 달릴까?" / "오늘 목표 · 13km").
            // Wear Button 은 최소 높이가 커서 라운드 하단에서 잘림 — 컴팩트 Box 칩 사용.
            Box(
                Modifier
                    .clip(RoundedCornerShape(14.dp))
                    .background(Brand.InkTop)
                    .clickable { showGoalSheet = true }
                    .padding(horizontal = 12.dp, vertical = 5.dp),
            ) {
                Text(
                    goalLabel(goal),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (goal.isSet) Brand.EmeraldSoft else Brand.Muted,
                )
            }
        }
        GrassWave(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth(0.5f).padding(bottom = 6.dp),
            blades = 9,
        )
    }
}

private fun goalLabel(goal: RunGoal): String = when {
    goal.distanceM != null -> {
        val km = goal.distanceM / 1000
        if (km == km.toLong().toDouble()) "오늘 목표 · ${km.toLong()}km" else "오늘 목표 · ${"%.1f".format(km)}km"
    }
    goal.timeSec != null -> "오늘 목표 · ${goal.timeSec / 60}분"
    else -> "오늘은 얼마쯤 달릴까?"
}

// ── v3: 목표 설정 시트 — 거리/시간 탭 + ±스텝퍼 (애플워치 v10/v14 문법) ──
@Composable
private fun GoalSheet(current: RunGoal, onDone: () -> Unit) {
    var mode by remember { mutableStateOf(if (current.timeSec != null) 1 else 0) }  // 0=거리 1=시간
    var km by remember { mutableFloatStateOf(((current.distanceM ?: 5000.0) / 1000).toFloat()) }
    var min by remember { mutableIntStateOf((current.timeSec ?: 1800) / 60) }

    Column(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        // 거리/시간 토글
        Row(
            Modifier.clip(RoundedCornerShape(16.dp)).background(Brand.InkTop),
        ) {
            listOf("거리", "시간").forEachIndexed { i, label ->
                Box(
                    Modifier
                        .clip(RoundedCornerShape(16.dp))
                        .background(if (mode == i) Brand.Emerald else Color.Transparent)
                        .clickable { mode = i }
                        .padding(horizontal = 16.dp, vertical = 6.dp),
                ) {
                    Text(
                        label, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                        color = if (mode == i) Brand.Ink else Brand.Muted,
                    )
                }
            }
        }
        Spacer(Modifier.height(10.dp))

        // ± 스텝퍼 (거리 ±1km, 시간 ±5분 — 애플워치 v10 과 동일 스텝)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            StepBtn("−") { if (mode == 0) km = (km - 1f).coerceAtLeast(1f) else min = (min - 5).coerceAtLeast(5) }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    if (mode == 0) (if (km == km.toLong().toFloat()) "${km.toLong()}" else "%.1f".format(km)) else "$min",
                    color = Brand.Snow, fontSize = 44.sp, fontWeight = FontWeight.Black,
                )
                Text(if (mode == 0) "km" else "분", color = Brand.Muted, fontSize = 13.sp)
            }
            StepBtn("+") { if (mode == 0) km = (km + 1f).coerceAtMost(50f) else min = (min + 5).coerceAtMost(300) }
        }
        Spacer(Modifier.height(12.dp))

        Button(
            onClick = {
                WorkoutManager.setGoal(
                    if (mode == 0) RunGoal(distanceM = km.toDouble() * 1000)
                    else RunGoal(timeSec = min * 60),
                )
                onDone()
            },
            colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent),
            modifier = Modifier.clip(RoundedCornerShape(22.dp)).background(Brand.CtaGradient),
        ) {
            Text("목표 설정", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Brand.Ink)
        }
    }
}

@Composable
private fun StepBtn(label: String, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        colors = ButtonDefaults.buttonColors(containerColor = Brand.InkTop),
        modifier = Modifier.size(44.dp),
    ) {
        Text(label, fontSize = 22.sp, fontWeight = FontWeight.Black, color = Brand.EmeraldLight)
    }
}

@Composable
private fun CountdownScreen(onDone: () -> Unit) {
    var n by remember { mutableIntStateOf(3) }
    val ring by animateFloatAsState(targetValue = (4 - n) / 3f, animationSpec = tween(600), label = "ring")
    LaunchedEffect(Unit) {
        for (i in 3 downTo 1) {
            n = i
            WorkoutManager.speakCount(i)
            delay(1000)
        }
        onDone()
    }
    Box(contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(150.dp)) { drawCountdownRing(ring) }
        Text("$n", color = Brand.EmeraldLight, fontSize = 74.sp, fontWeight = FontWeight.Black)
    }
}

// ── v3: 심박존 색 (애플워치 v7 문법) ─────────────────────────────
private fun zoneColor(zone: Int): Color = when (zone) {
    1 -> Color(0xFF60A5FA)   // 편안 — 하늘
    2 -> Brand.EmeraldLight  // 기본
    3 -> Color(0xFFFBBF24)   // 지방연소↑ — 노랑
    4 -> Color(0xFFFB923C)   // 고강도 — 주황
    5 -> Color(0xFFF87171)   // 최대 — 빨강
    else -> Brand.Muted
}

@Composable
private fun MetricsScreen(state: WorkoutManager.RunState) {
    val userPaused = state.phase == WorkoutManager.Phase.PAUSED
    val autoPaused = state.phase == WorkoutManager.Phase.AUTO_PAUSED
    val kmFraction = ((state.distanceMeters % 1000) / 1000.0).toFloat()
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (userPaused || autoPaused) {
            Text(
                if (autoPaused) "자동 일시정지" else "잠시 쉬는 중",
                color = Brand.Calorie, fontSize = 13.sp, fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(2.dp))
        }
        Text(
            fmtTime(state.elapsedSec),
            color = Brand.Snow, fontSize = 54.sp, fontWeight = FontWeight.Black,
        )
        Spacer(Modifier.height(6.dp))

        // v3: 목표 진행바 (설정 시) — 없으면 km 잔디 게이지
        val gp = state.goalProgress
        if (gp != null) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
                Box(Modifier.weight(1f).height(6.dp).clip(RoundedCornerShape(3.dp)).background(Brand.InkTop)) {
                    Box(
                        Modifier.fillMaxWidth(gp.toFloat()).height(6.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .let { m -> if (state.goalAchieved) m.background(Brand.Calorie) else m.background(Brand.CtaGradient) },
                    )
                }
                Spacer(Modifier.width(6.dp))
                Text(
                    if (state.goalAchieved) "달성!" else "${(gp * 100).toInt()}%",
                    color = if (state.goalAchieved) Brand.Calorie else Brand.Muted,
                    fontSize = 10.sp, fontWeight = FontWeight.Bold,
                )
            }
        } else {
            Canvas(Modifier.fillMaxWidth().height(6.dp).padding(horizontal = 24.dp)) { drawDistanceGauge(kmFraction) }
        }
        Spacer(Modifier.height(8.dp))

        Metric(fmtDistance(state.distanceMeters), "km", Brand.Distance)
        // v3: 구간 페이스가 있으면 그것부터 (직전 KM — 애플워치 v7)
        Metric(fmtPace(state.lastSplitSecPerKm ?: state.paceSecPerKm), if (state.lastSplitSecPerKm != null) "/km 구간" else "/km", Brand.Pace)

        // v3: 심박 — 존 색상 + 존 칩
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                if (state.heartRate > 0) state.heartRate.toInt().toString() else "--",
                color = zoneColor(state.hrZone), fontSize = 30.sp, fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.width(4.dp))
            Text("bpm", color = Brand.Muted, fontSize = 13.sp, modifier = Modifier.padding(bottom = 4.dp))
            if (state.hrZone > 0) {
                Spacer(Modifier.width(6.dp))
                Box(
                    Modifier.padding(bottom = 3.dp).clip(RoundedCornerShape(8.dp))
                        .background(zoneColor(state.hrZone).copy(alpha = 0.18f))
                        .padding(horizontal = 6.dp, vertical = 1.dp),
                ) {
                    Text("Z${state.hrZone}", color = zoneColor(state.hrZone), fontSize = 11.sp, fontWeight = FontWeight.Black)
                }
            }
        }
        Metric(state.calories.toInt().toString(), "kcal", Brand.Calorie)

        // v3: 심박 스파크라인 (샘플 10개 이상)
        if (state.hrSamples.size >= 10) {
            Spacer(Modifier.height(4.dp))
            HrSparkline(state.hrSamples, zoneColor(state.hrZone))
        }

        Spacer(Modifier.height(4.dp))
        if (!userPaused && !autoPaused) GrassWave()
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { WorkoutManager.togglePause() },
                colors = ButtonDefaults.buttonColors(containerColor = Brand.InkTop),
            ) { Text(if (userPaused || autoPaused) "다시 달리기" else "잠시 쉼", fontSize = 13.sp, color = Brand.Snow) }
            Button(
                onClick = { WorkoutManager.end() },
                colors = ButtonDefaults.buttonColors(containerColor = Brand.Emerald),
            ) { Text("완주", fontSize = 13.sp, color = Color.White, fontWeight = FontWeight.Bold) }
        }
        // 라운드 화면 하단 곡면 여백 — 버튼이 원 안쪽 탭 가능 영역에 들어오도록
        Spacer(Modifier.height(30.dp))
    }
}

/** v3: 심박 스파크라인 — 최근 샘플 min-max 정규화 폴리라인 */
@Composable
private fun HrSparkline(samples: List<Float>, color: Color) {
    Canvas(Modifier.fillMaxWidth().height(26.dp).padding(horizontal = 26.dp)) {
        if (samples.size < 2) return@Canvas
        val minV = samples.min()
        val maxV = samples.max()
        val range = (maxV - minV).coerceAtLeast(1f)
        val stepX = size.width / (samples.size - 1)
        val path = Path()
        samples.forEachIndexed { i, v ->
            val x = i * stepX
            val y = size.height - ((v - minV) / range) * size.height
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        drawPath(path, color.copy(alpha = 0.85f), style = Stroke(width = 3f, cap = StrokeCap.Round))
    }
}

@Composable
private fun Metric(value: String, unit: String, color: Color) {
    Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(vertical = 1.dp)) {
        Text(value, color = color, fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.width(4.dp))
        Text(unit, color = Brand.Muted, fontSize = 13.sp, modifier = Modifier.padding(bottom = 4.dp))
    }
}

@Composable
private fun SummaryScreen(summary: WorkoutManager.Summary?, onDone: () -> Unit) {
    var confetti by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) {
        val steps = 60
        for (i in 0..steps) { confetti = i / steps.toFloat(); delay(25) }
    }
    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            SproutMark(sizeDp = 26)
            Text("완주! 오늘도 잘 달렸어요", color = Brand.EmeraldLight, fontSize = 20.sp, fontWeight = FontWeight.Black)
            Spacer(Modifier.height(8.dp))
            if (summary != null) {
                Text(fmtDistance(summary.distanceMeters), color = Brand.Distance, fontSize = 44.sp, fontWeight = FontWeight.Black)
                Text("km", color = Brand.Muted, fontSize = 13.sp)
                Spacer(Modifier.height(6.dp))
                Metric(fmtTime(summary.elapsedSec), "", Brand.Snow)
                Metric(fmtPace(summary.paceSecPerKm), "/km", Brand.Pace)
                Metric(if (summary.avgHr > 0) summary.avgHr.toInt().toString() else "--", "bpm", Brand.Heart)
                // v4 (애플 v19 이식): 존별 체류 분포 — 1분 이상 측정 시
                if (summary.zoneSeconds.sum() >= 60) {
                    Spacer(Modifier.height(6.dp))
                    ZoneBreakdown(summary.zoneSeconds)
                    Spacer(Modifier.height(2.dp))
                }
                Metric(summary.calories.toInt().toString(), "kcal", Brand.Calorie)
            }
            Spacer(Modifier.height(6.dp))
            Text("폰 앱에 자동으로 저장돼요", color = Brand.Muted, fontSize = 11.sp, textAlign = TextAlign.Center)
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = onDone,
                colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent),
                modifier = Modifier.clip(RoundedCornerShape(22.dp)).background(Brand.CtaGradient),
            ) { Text("완료", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Brand.Ink) }
            Spacer(Modifier.height(30.dp))
        }
        if (confetti < 1f) Confetti(Modifier.fillMaxSize(), confetti)
    }
}

/** v4: 심박 영역 1~5 체류 분포 (요약) — 애플워치 SummaryView 와 동일 문법 */
@Composable
private fun ZoneBreakdown(zones: DoubleArray) {
    val colors = listOf(Color(0xFF3B82F6), Color(0xFF22C55E), Color(0xFFEAB308), Color(0xFFF97316), Color(0xFFEF4444))
    val total = zones.sum().coerceAtLeast(1.0)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text("심박 영역", color = Brand.Muted, fontSize = 11.sp)
        zones.forEachIndexed { i, sec ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Text("영역 ${i + 1}", color = colors[i], fontSize = 10.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.width(38.dp))
                Box(Modifier.weight(1f).height(6.dp).clip(RoundedCornerShape(3.dp)).background(Color.White.copy(alpha = 0.10f))) {
                    Box(Modifier.fillMaxHeight()
                        .fillMaxWidth(fraction = if (sec > 0) (sec / total).toFloat().coerceIn(0.03f, 1f) else 0f)
                        .clip(RoundedCornerShape(3.dp)).background(colors[i]))
                }
                Text(if (sec >= 60) "${(sec / 60).toInt()}분" else if (sec > 0) "${sec.toInt()}초" else "-",
                    color = Brand.Muted, fontSize = 9.sp, modifier = Modifier.width(28.dp), textAlign = TextAlign.End)
            }
        }
    }
}

// ── 포맷터 ──────────────────────────────────────────────────────
private fun fmtTime(sec: Double): String {
    val t = sec.toInt(); val h = t / 3600; val m = (t % 3600) / 60; val s = t % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

private fun fmtDistance(m: Double): String = "%.2f".format(m / 1000)

private fun fmtPace(p: Double?): String {
    if (p == null || p <= 0) return "--'--\""
    val t = p.toInt(); return "%d'%02d\"".format(t / 60, t % 60)
}
