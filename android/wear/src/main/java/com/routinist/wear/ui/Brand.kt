package com.routinist.wear.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import kotlin.math.sin

/** 루티니스트 잔디(에메랄드) 브랜드 팔레트 — 애플워치와 동일 언어. */
object Brand {
    val Emerald = Color(0xFF10B981)
    val EmeraldLight = Color(0xFF34D399)
    val EmeraldSoft = Color(0xFF6EE7B7)
    val Ink = Color(0xFF0B1120)
    val InkTop = Color(0xFF10182B)
    val Snow = Color(0xFFF2F5F8)
    val Muted = Color(0xFF8A94A6)
    // 메트릭 색 (Apple Fitness 문법 — 지표별 색)
    val Distance = EmeraldLight
    val Pace = Color(0xFF5EE0D0)
    val Heart = Color(0xFFFF6B6B)
    val Calorie = Color(0xFFFBBF24)

    val ScreenGradient = Brush.verticalGradient(listOf(InkTop, Ink))
    val CtaGradient = Brush.horizontalGradient(listOf(Emerald, EmeraldLight))
}

/**
 * 달리는 잔디 물결 — 화면 하단에서 계속 흔들리는 잔디 (애플워치 RunningGrassView 이식).
 * 러닝 중 "살아있는" 브랜드 모션.
 */
@Composable
fun GrassWave(modifier: Modifier = Modifier, blades: Int = 11) {
    val t = rememberInfiniteTransition(label = "grass")
    val phase by t.animateFloat(
        initialValue = 0f, targetValue = (2 * Math.PI).toFloat(),
        animationSpec = infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Restart),
        label = "phase",
    )
    Canvas(modifier.fillMaxWidth().height(22.dp)) {
        val step = size.width / (blades + 1)
        for (i in 1..blades) {
            val x = step * i
            val sway = sin((phase + i * 0.6f).toDouble()).toFloat() * 3.2f
            val h = size.height * (0.62f + 0.30f * ((i % 3) / 2f))
            val path = Path().apply {
                moveTo(x, size.height)
                quadraticBezierTo(x + sway * 0.5f, size.height - h * 0.5f, x + sway, size.height - h)
            }
            val c = if (i % 2 == 0) Brand.Emerald else Brand.EmeraldLight
            drawPath(path, c, style = Stroke(width = 2.6f, cap = StrokeCap.Round))
        }
    }
}

/** 완주 컨페티 — 에메랄드 새싹 조각이 한 번 흩날림 (애플워치 잔디 컨페티). */
@Composable
fun Confetti(modifier: Modifier = Modifier, progress: Float) {
    Canvas(modifier) {
        val n = 22
        for (i in 0 until n) {
            // 인덱스 기반 결정적 분포 (Math.random 미사용)
            val seedX = ((i * 2654435761u.toLong()) % 1000L) / 1000f
            val seedD = 0.6f + (((i * 40503) % 400) / 1000f)
            val seedSway = ((i % 5) - 2) * 10f
            val x = size.width * seedX + sin((progress * 6f + i).toDouble()).toFloat() * seedSway
            val y = -20f + (size.height + 40f) * (progress / seedD).coerceIn(0f, 1f)
            val alpha = (1f - progress).coerceIn(0f, 1f)
            val c = listOf(Brand.Emerald, Brand.EmeraldLight, Brand.EmeraldSoft)[i % 3]
            drawSprout(Offset(x, y), 7f + (i % 3) * 2f, c.copy(alpha = alpha))
        }
    }
}

/** 잔디 새싹 마크 — 브랜드 심볼 (두 잎 + 줄기). */
@Composable
fun SproutMark(modifier: Modifier = Modifier, sizeDp: Int = 34) {
    Canvas(modifier.size(sizeDp.dp)) {
        drawSprout(Offset(size.width / 2, size.height * 0.62f), size.minDimension * 0.5f, Brand.EmeraldLight)
    }
}

private fun DrawScope.drawSprout(center: Offset, s: Float, color: Color) {
    // 줄기
    drawLine(color, Offset(center.x, center.y + s * 0.5f), Offset(center.x, center.y - s * 0.2f),
        strokeWidth = s * 0.16f, cap = StrokeCap.Round)
    // 왼 잎
    val left = Path().apply {
        moveTo(center.x, center.y)
        quadraticBezierTo(center.x - s * 0.9f, center.y - s * 0.2f, center.x - s * 0.2f, center.y - s * 0.7f)
        quadraticBezierTo(center.x - s * 0.1f, center.y - s * 0.25f, center.x, center.y)
    }
    // 오른 잎
    val right = Path().apply {
        moveTo(center.x, center.y)
        quadraticBezierTo(center.x + s * 0.9f, center.y - s * 0.2f, center.x + s * 0.2f, center.y - s * 0.7f)
        quadraticBezierTo(center.x + s * 0.1f, center.y - s * 0.25f, center.x, center.y)
    }
    drawPath(left, color)
    drawPath(right, color)
}

/** 카운트다운 링 — 3·2·1 동안 채워지는 에메랄드 원호. */
fun DrawScope.drawCountdownRing(fraction: Float) {
    val stroke = size.minDimension * 0.055f
    val inset = stroke / 2 + size.minDimension * 0.06f
    drawArc(
        color = Brand.InkTop,
        startAngle = -90f, sweepAngle = 360f, useCenter = false,
        topLeft = Offset(inset, inset),
        size = androidx.compose.ui.geometry.Size(size.width - inset * 2, size.height - inset * 2),
        style = Stroke(width = stroke, cap = StrokeCap.Round),
    )
    drawArc(
        brush = Brand.CtaGradient,
        startAngle = -90f, sweepAngle = 360f * fraction, useCenter = false,
        topLeft = Offset(inset, inset),
        size = androidx.compose.ui.geometry.Size(size.width - inset * 2, size.height - inset * 2),
        style = Stroke(width = stroke, cap = StrokeCap.Round),
    )
}

/** 거리 잔디 게이지 — 현재 km 진행을 잔디 칸으로 (1칸 = 진행 비율). */
fun DrawScope.drawDistanceGauge(fraction: Float, cells: Int = 12) {
    val gap = size.width * 0.02f
    val cellW = (size.width - gap * (cells - 1)) / cells
    val filled = (fraction * cells).roundToInt().coerceIn(0, cells)
    for (i in 0 until cells) {
        val x = i * (cellW + gap)
        val on = i < filled
        drawRoundRect(
            color = if (on) Brand.EmeraldLight else Brand.InkTop,
            topLeft = Offset(x, 0f),
            size = androidx.compose.ui.geometry.Size(cellW, size.height),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(cellW * 0.4f, cellW * 0.4f),
        )
    }
}
