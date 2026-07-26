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
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.Canvas
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.routinist.wear.ExerciseRecordingService
import com.routinist.wear.WorkoutManager
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
                -> StartScreen(error = state.error) { permLauncher.launch(requiredPermissions()) }

                WorkoutManager.Phase.COUNTDOWN -> CountdownScreen { ExerciseRecordingService.start(context) }

                WorkoutManager.Phase.ACTIVE,
                WorkoutManager.Phase.PAUSED,
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

@Composable
private fun StartScreen(error: String?, onStart: () -> Unit) {
    // 잔디가 살짝 숨쉬듯 흔들리는 브랜드 인트로
    val t = rememberInfiniteTransition(label = "intro")
    val bob by t.animateFloat(
        0f, 1f, infiniteRepeatable(tween(1800, easing = LinearEasing), RepeatMode.Reverse), label = "bob",
    )
    Column(
        Modifier.fillMaxSize().padding(horizontal = 18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        SproutMark(Modifier.padding(bottom = (2 + bob * 3).dp), sizeDp = 30)
        Text("루티니스트", color = Brand.EmeraldLight, fontSize = 22.sp, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(3.dp))
        Text("오늘도 달려볼까요?", color = Brand.Snow, fontSize = 13.sp)
        if (error != null) {
            Spacer(Modifier.height(4.dp))
            Text(error, color = Brand.Heart, fontSize = 12.sp, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.height(14.dp))
        Button(
            onClick = onStart,
            colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent),
            modifier = Modifier.clip(RoundedCornerShape(24.dp)).background(Brand.CtaGradient),
        ) {
            Text("달리기 시작", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Brand.Ink)
        }
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

@Composable
private fun MetricsScreen(state: WorkoutManager.RunState) {
    val paused = state.phase == WorkoutManager.Phase.PAUSED
    val kmFraction = ((state.distanceMeters % 1000) / 1000.0).toFloat()
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (paused) {
            Text("일시정지", color = Brand.Calorie, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(2.dp))
        }
        Text(
            fmtTime(state.elapsedSec),
            color = Brand.Snow, fontSize = 54.sp, fontWeight = FontWeight.Black, fontFamily = FontFamily.SansSerif,
        )
        Spacer(Modifier.height(6.dp))
        Canvas(Modifier.fillMaxWidth().height(6.dp).padding(horizontal = 24.dp)) { drawDistanceGauge(kmFraction) }
        Spacer(Modifier.height(8.dp))
        Metric(fmtDistance(state.distanceMeters), "km", Brand.Distance)
        Metric(fmtPace(state.paceSecPerKm), "/km", Brand.Pace)
        Metric(if (state.heartRate > 0) state.heartRate.toInt().toString() else "--", "bpm", Brand.Heart)
        Metric(state.calories.toInt().toString(), "kcal", Brand.Calorie)
        Spacer(Modifier.height(4.dp))
        if (!paused) GrassWave()
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { WorkoutManager.togglePause() },
                colors = ButtonDefaults.buttonColors(containerColor = Brand.InkTop),
            ) { Text(if (paused) "재개" else "일시정지", fontSize = 13.sp, color = Brand.Snow) }
            Button(
                onClick = { WorkoutManager.end() },
                colors = ButtonDefaults.buttonColors(containerColor = Brand.Heart),
            ) { Text("종료", fontSize = 13.sp, color = Color.White, fontWeight = FontWeight.Bold) }
        }
        // 라운드 화면 하단 곡면 여백 — 버튼이 원 안쪽 탭 가능 영역에 들어오도록
        Spacer(Modifier.height(30.dp))
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
            Text("완주!", color = Brand.EmeraldLight, fontSize = 24.sp, fontWeight = FontWeight.Black)
            Spacer(Modifier.height(8.dp))
            if (summary != null) {
                Text(fmtDistance(summary.distanceMeters), color = Brand.Distance, fontSize = 44.sp, fontWeight = FontWeight.Black)
                Text("km", color = Brand.Muted, fontSize = 13.sp)
                Spacer(Modifier.height(6.dp))
                Metric(fmtTime(summary.elapsedSec), "", Brand.Snow)
                Metric(fmtPace(summary.paceSecPerKm), "/km", Brand.Pace)
                Metric(if (summary.avgHr > 0) summary.avgHr.toInt().toString() else "--", "bpm", Brand.Heart)
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
