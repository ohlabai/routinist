package com.routinist.wear.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.routinist.wear.ExerciseRecordingService
import com.routinist.wear.WorkoutManager
import kotlinx.coroutines.delay

private val Emerald = Color(0xFF10B981)
private val Ink = Color(0xFF0F1525)

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
            Modifier.fillMaxSize().background(Ink),
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
    Column(
        Modifier.fillMaxSize().padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("루티니스트", color = Emerald, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text("오늘도 달려볼까요?", color = Color.White, fontSize = 13.sp)
        if (error != null) {
            Spacer(Modifier.height(4.dp))
            Text(error, color = Color(0xFFF87171), fontSize = 12.sp, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.height(12.dp))
        Button(onClick = onStart) {
            Text("달리기 시작", fontSize = 16.sp)
        }
    }
}

@Composable
private fun CountdownScreen(onDone: () -> Unit) {
    var n by remember { mutableIntStateOf(3) }
    LaunchedEffect(Unit) {
        for (i in 3 downTo 1) {
            n = i
            WorkoutManager.speakCount(i)
            delay(1000)
        }
        onDone()
    }
    Text("$n", color = Emerald, fontSize = 72.sp, fontWeight = FontWeight.Bold)
}

@Composable
private fun MetricsScreen(state: WorkoutManager.RunState) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (state.phase == WorkoutManager.Phase.PAUSED) {
            Text("일시정지", color = Color(0xFFFBBF24), fontSize = 13.sp, fontWeight = FontWeight.Bold)
        }
        Text(fmtTime(state.elapsedSec), color = Color.White, fontSize = 40.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Metric(fmtDistance(state.distanceMeters), "km")
        Metric(fmtPace(state.paceSecPerKm), "/km")
        Metric(if (state.heartRate > 0) state.heartRate.toInt().toString() else "--", "bpm")
        Metric(state.calories.toInt().toString(), "kcal")
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { WorkoutManager.togglePause() }) {
                Text(if (state.phase == WorkoutManager.Phase.PAUSED) "재개" else "일시정지", fontSize = 13.sp)
            }
            Button(onClick = { WorkoutManager.end() }) {
                Text("종료", fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun Metric(value: String, unit: String) {
    Row(verticalAlignment = Alignment.Bottom) {
        Text(value, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.width(3.dp))
        Text(unit, color = Color(0xFF9CA3AF), fontSize = 13.sp)
    }
}

@Composable
private fun SummaryScreen(summary: WorkoutManager.Summary?, onDone: () -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("완주! 🌱", color = Emerald, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        if (summary != null) {
            Metric(fmtDistance(summary.distanceMeters), "km")
            Metric(fmtTime(summary.elapsedSec), "")
            Metric(fmtPace(summary.paceSecPerKm), "/km")
            Metric(if (summary.avgHr > 0) summary.avgHr.toInt().toString() else "--", "bpm")
            Metric(summary.calories.toInt().toString(), "kcal")
        }
        Spacer(Modifier.height(6.dp))
        Text("폰 앱에 자동으로 저장돼요", color = Color(0xFF9CA3AF), fontSize = 11.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.height(10.dp))
        Button(onClick = onDone) { Text("완료", fontSize = 14.sp) }
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
