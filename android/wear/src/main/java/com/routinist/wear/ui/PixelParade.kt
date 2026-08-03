package com.routinist.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlin.math.max

/**
 * 잔디 픽셀 퍼레이드 — 애플워치 PixelParade.swift 의 Compose 포팅 (2026-08-03 동등화).
 * 스프라이트·체인 스케줄·추월 역산 모두 Swift 원본과 동일 (코드젠 복사 — 양쪽 동시 수정).
 * 체인: 다음 동물은 이전 동물이 화면 절반을 지나면 입장 → 동시 1~2마리, 빈 프레임 0.
 */

class ParadeRunner(
    val name: String,
    val stepCells: Double,
    val legEvery: Int,
    val bounce: Int,
    val frames: Array<Array<IntArray>>,
) {
    val width: Int get() = frames[0].firstOrNull()?.size ?: 1
    val height: Int get() = frames[0].size
}

private val GrassLight = Color(0xFF4ADE80)
private val GrassMid = Color(0xFF22C55E)
private val GrassDark = Color(0xFF16A34A)

private fun pixelColor(v: Int): Color? = when (v) {
    1 -> GrassLight
    2 -> GrassMid
    3 -> GrassDark
    else -> null
}

private class ParadeSlot(val runner: ParadeRunner, val entry: Double, val speed: Double)

private val BASE_ORDER = listOf(
    "turtle", "man", "woman", "dog", "elephant", "chicken",
    "cat", "monkey", "cow", "giraffe", "dragon",
)
private val OVERTAKERS = listOf("rabbit" to "turtle", "cheetah" to "elephant", "horse" to "cow")

private fun findRunner(name: String): ParadeRunner? = PARADE_RUNNERS.firstOrNull { it.name == name }

private fun paradeSchedule(cols: Int): Pair<List<ParadeSlot>, Int> {
    val slots = mutableListOf<ParadeSlot>()
    val entryOf = mutableMapOf<String, Double>()
    var t = 0.0
    for (name in BASE_ORDER) {
        val r = findRunner(name) ?: continue
        val v = r.stepCells * 0.55
        slots.add(ParadeSlot(r, t, v))
        entryOf[name] = t
        t += (r.width + cols * 0.5) / v
    }
    for ((fastName, slowName) in OVERTAKERS) {
        val f = findRunner(fastName) ?: continue
        val s = findRunner(slowName) ?: continue
        val es = entryOf[slowName] ?: continue
        val vs = s.stepCells * 0.55
        val vf = f.stepCells * 0.55
        val tCatch = es + (0.55 * cols + s.width) / vs
        slots.add(ParadeSlot(f, tCatch - vs * (tCatch - es) / vf, vf))
    }
    val maxExit = slots.maxOf { it.entry + (cols + it.runner.width) / it.speed }
    return slots to max(60, maxExit.toInt() - 8)
}

private fun DrawScope.drawSprite(grid: Array<IntArray>, cell: Float, xPx: Float, yPx: Float) {
    val corner = CornerRadius(cell * 0.22f)
    for (y in grid.indices) {
        val row = grid[y]
        for (x in row.indices) {
            val c = pixelColor(row[x]) ?: continue
            drawRoundRect(
                color = c,
                topLeft = Offset(xPx + x * cell, yPx + y * cell),
                size = Size(cell * 0.92f, cell * 0.92f),
                cornerRadius = corner,
            )
        }
    }
}

/** 시작 화면 하단 스트립 — 애플워치 GrassParadeView 대응 */
@Composable
fun PixelParade(modifier: Modifier = Modifier) {
    var tick by remember { mutableLongStateOf(System.currentTimeMillis() / 120) }
    LaunchedEffect(Unit) {
        while (true) {
            tick = System.currentTimeMillis() / 120
            delay(120)
        }
    }
    Canvas(modifier) {
        val maxRows = 10f
        val cell = size.height / maxRows
        val cols = max(8, (size.width / cell).toInt())
        val (slots, cycle) = paradeSchedule(cols)
        val m = (tick % cycle).toDouble()

        // 바닥 잔디 라인
        val groundY = size.height - cell * 0.4f
        var gx = 0f
        while (gx < size.width) {
            drawRoundRect(
                GrassDark.copy(alpha = 0.45f),
                topLeft = Offset(gx, groundY),
                size = Size(cell * 0.9f, cell * 0.4f),
                cornerRadius = CornerRadius(cell * 0.2f),
            )
            gx += cell * 1.4f
        }

        // 두 레이어: 이번 바퀴 + 지난 바퀴 잔여 꼬리
        for (layerT in listOf(m + cycle, m)) {
            for (slot in slots.sortedBy { it.speed }) {
                val r = slot.runner
                val xCells = (layerT - slot.entry) * slot.speed - r.width
                if (xCells > -r.width && xCells < cols) {
                    val frameIdx = ((tick / max(1, r.legEvery)) % 2).toInt()
                    val hop = if (r.bounce == 1 && frameIdx == 0) -cell * 0.9f else 0f
                    drawSprite(
                        r.frames[frameIdx], cell,
                        xPx = (xCells * cell).toFloat(),
                        yPx = size.height - r.height * cell - cell * 0.4f + hop,
                    )
                }
            }
        }
    }
}

/** 제자리 달리기 — 요약 축하용 (애플워치 ParadeRunnerInPlace 대응) */
@Composable
fun RunnerInPlace(runner: ParadeRunner, heightDp: Int = 30, modifier: Modifier = Modifier) {
    var tick by remember { mutableLongStateOf(System.currentTimeMillis() / 120) }
    LaunchedEffect(Unit) {
        while (true) {
            tick = System.currentTimeMillis() / 120
            delay(120)
        }
    }
    Canvas(modifier.height(heightDp.dp)) {
        val cell = size.height / runner.height
        val frameIdx = ((tick / max(1, runner.legEvery)) % 2).toInt()
        val hop = if (runner.bounce == 1 && frameIdx == 0) -cell else 0f
        drawSprite(runner.frames[frameIdx], cell, 0f, hop)
    }
}

/** 평균 페이스 → 동물 + 축하 카피 (애플워치 paceAnimalMatch 와 동일 사다리) */
data class PaceAnimalMatch(val runner: ParadeRunner, val copy: String)

fun paceAnimalMatch(paceSecPerKm: Double?): PaceAnimalMatch {
    fun r(name: String) = findRunner(name) ?: PARADE_RUNNERS[0]
    if (paceSecPerKm == null || paceSecPerKm <= 0 || !paceSecPerKm.isFinite()) {
        return PaceAnimalMatch(r("turtle"), "거북이처럼 꾸준히 완주했어요!")
    }
    val ladder = listOf(
        Triple(240.0, "cheetah", "치타처럼 질주했어요!"),
        Triple(280.0, "horse", "말처럼 힘차게 달렸어요!"),
        Triple(320.0, "dog", "강아지처럼 신나게 달렸어요!"),
        Triple(360.0, "rabbit", "토끼처럼 가볍게 뛰었어요!"),
        Triple(400.0, "cat", "고양이처럼 사뿐사뿐 달렸어요!"),
        Triple(440.0, "monkey", "원숭이처럼 경쾌하게 달렸어요!"),
        Triple(480.0, "chicken", "총총총, 닭처럼 부지런히 달렸어요!"),
        Triple(540.0, "elephant", "코끼리처럼 묵직하게 완주했어요!"),
    )
    for ((maxPace, name, copy) in ladder) {
        if (paceSecPerKm < maxPace) return PaceAnimalMatch(r(name), copy)
    }
    return PaceAnimalMatch(r("turtle"), "거북이처럼 꾸준히 완주했어요!")
}

/** 퍼레이드 스프라이트 — parade_design.py 코드젠 산출물 (Swift 원본 복사) */
val PARADE_RUNNERS: List<ParadeRunner> = listOf(
    ParadeRunner(
        name = "man", stepCells = 1.6, legEvery = 2, bounce = 0,
        frames = arrayOf(
            arrayOf(
                intArrayOf(-1, -1, -1, -1, 1, 1, -1, -1),
                intArrayOf(-1, -1, -1, -1, 1, 1, -1, -1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 2, -1),
                intArrayOf(-1, 2, -1, -1, 2, 2, -1, -1),
                intArrayOf(-1, -1, -1, -1, 2, 2, -1, -1),
                intArrayOf(-1, -1, -1, 3, -1, 3, -1, -1),
                intArrayOf(-1, -1, 3, -1, -1, -1, 3, -1),
                intArrayOf(-1, 3, 3, -1, -1, -1, 3, 3),
            ),
            arrayOf(
                intArrayOf(-1, -1, -1, -1, 1, 1, -1, -1),
                intArrayOf(-1, -1, -1, -1, 1, 1, -1, -1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 2, -1),
                intArrayOf(-1, 2, -1, -1, 2, 2, -1, -1),
                intArrayOf(-1, -1, -1, -1, 2, 2, -1, -1),
                intArrayOf(-1, -1, -1, 3, 3, -1, -1, -1),
                intArrayOf(-1, -1, -1, 3, -1, 3, -1, -1),
                intArrayOf(-1, -1, 3, 3, -1, -1, 3, -1),
            )
        ),
    ),
    ParadeRunner(
        name = "woman", stepCells = 1.6, legEvery = 2, bounce = 0,
        frames = arrayOf(
            arrayOf(
                intArrayOf(-1, -1, 1, -1, 1, 1, -1, -1),
                intArrayOf(-1, 1, 1, -1, 1, 1, -1, -1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 2, -1),
                intArrayOf(-1, 2, -1, -1, 2, 2, -1, -1),
                intArrayOf(-1, -1, -1, -1, 2, 2, -1, -1),
                intArrayOf(-1, -1, -1, 3, -1, 3, -1, -1),
                intArrayOf(-1, -1, 3, -1, -1, -1, 3, -1),
                intArrayOf(-1, 3, 3, -1, -1, -1, 3, 3),
            ),
            arrayOf(
                intArrayOf(-1, 1, -1, -1, 1, 1, -1, -1),
                intArrayOf(-1, -1, 1, 1, 1, 1, -1, -1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 2, -1),
                intArrayOf(-1, 2, -1, -1, 2, 2, -1, -1),
                intArrayOf(-1, -1, -1, -1, 2, 2, -1, -1),
                intArrayOf(-1, -1, -1, 3, 3, -1, -1, -1),
                intArrayOf(-1, -1, -1, 3, -1, 3, -1, -1),
                intArrayOf(-1, -1, 3, 3, -1, -1, 3, -1),
            )
        ),
    ),
    ParadeRunner(
        name = "dog", stepCells = 2.0, legEvery = 1, bounce = 0,
        frames = arrayOf(
            arrayOf(
                intArrayOf(-1, 3, -1, -1, -1, -1, -1, -1, -1, -1, 1, -1),
                intArrayOf(-1, -1, 3, -1, -1, -1, -1, 2, 2, 2, 1, 1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, -1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1),
                intArrayOf(-1, -1, 3, -1, -1, -1, -1, 3, -1, -1, -1, -1),
                intArrayOf(-1, -1, 3, -1, -1, -1, -1, -1, 3, -1, -1, -1),
            ),
            arrayOf(
                intArrayOf(-1, -1, 3, -1, -1, -1, -1, -1, -1, -1, 1, -1),
                intArrayOf(-1, 3, -1, -1, -1, -1, -1, 2, 2, 2, 1, 1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, -1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1),
                intArrayOf(-1, -1, -1, 3, 3, -1, -1, 3, 3, -1, -1, -1),
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1),
            )
        ),
    ),
    ParadeRunner(
        name = "cheetah", stepCells = 3.4, legEvery = 1, bounce = 0,
        frames = arrayOf(
            arrayOf(
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, -1),
                intArrayOf(3, 3, 3, 3, -1, 2, 2, 2, 2, 2, 2, 1, 1, -1),
                intArrayOf(-1, -1, -1, -1, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1),
                intArrayOf(-1, -1, 3, -1, -1, -1, -1, -1, -1, -1, 3, -1, -1, -1),
                intArrayOf(-1, 3, -1, -1, -1, -1, -1, -1, -1, -1, -1, 3, -1, -1),
            ),
            arrayOf(
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, -1),
                intArrayOf(3, 3, 3, 3, -1, 2, 2, 2, 2, 2, 2, 1, 1, -1),
                intArrayOf(-1, -1, -1, -1, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1),
                intArrayOf(-1, -1, -1, -1, -1, 3, 3, -1, 3, 3, -1, -1, -1, -1),
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1),
            )
        ),
    ),
    ParadeRunner(
        name = "elephant", stepCells = 0.9, legEvery = 3, bounce = 0,
        frames = arrayOf(
            arrayOf(
                intArrayOf(-1, -1, -1, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1),
                intArrayOf(-1, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 1, -1),
                intArrayOf(-1, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 1, -1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 2, 2, 2, 2, -1, 2, 1, -1),
                intArrayOf(-1, -1, 3, 3, -1, -1, 3, 3, -1, -1, -1, 1, -1, -1),
                intArrayOf(-1, -1, 3, 3, -1, -1, 3, 3, -1, -1, -1, 1, -1, -1),
            ),
            arrayOf(
                intArrayOf(-1, -1, -1, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1),
                intArrayOf(-1, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 1, -1),
                intArrayOf(-1, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 1, -1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 2, 2, 2, 2, -1, 2, 1, -1),
                intArrayOf(-1, 3, 3, -1, -1, -1, -1, 3, 3, -1, -1, 1, -1, -1),
                intArrayOf(-1, 3, 3, -1, -1, -1, -1, 3, 3, -1, -1, -1, -1, -1),
            )
        ),
    ),
    ParadeRunner(
        name = "chicken", stepCells = 1.4, legEvery = 1, bounce = 0,
        frames = arrayOf(
            arrayOf(
                intArrayOf(-1, -1, -1, -1, -1, 1, -1, -1),
                intArrayOf(-1, -1, -1, -1, 2, 2, 2, -1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 1, -1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, -1),
                intArrayOf(-1, 2, 2, 2, 2, 2, -1, -1),
                intArrayOf(-1, -1, -1, 3, -1, -1, -1, -1),
                intArrayOf(-1, -1, -1, 3, 3, -1, -1, -1),
            ),
            arrayOf(
                intArrayOf(-1, -1, -1, -1, -1, 1, -1, -1),
                intArrayOf(-1, -1, -1, -1, 2, 2, 2, -1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 1, -1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, -1),
                intArrayOf(-1, 2, 2, 2, 2, 2, -1, -1),
                intArrayOf(-1, -1, -1, -1, 3, -1, -1, -1),
                intArrayOf(-1, -1, -1, 3, -1, -1, -1, -1),
            )
        ),
    ),
    ParadeRunner(
        name = "monkey", stepCells = 1.8, legEvery = 2, bounce = 0,
        frames = arrayOf(
            arrayOf(
                intArrayOf(-1, 1, 1, -1, -1, -1, -1, -1),
                intArrayOf(-1, 1, -1, -1, -1, -1, -1, -1),
                intArrayOf(-1, 1, -1, -1, 2, 2, 2, -1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 2, -1),
                intArrayOf(-1, -1, 2, 2, 2, 2, -1, -1),
                intArrayOf(-1, -1, 3, -1, 3, 2, -1, -1),
                intArrayOf(-1, 3, -1, -1, -1, -1, 3, -1),
            ),
            arrayOf(
                intArrayOf(-1, 1, 1, -1, -1, -1, -1, -1),
                intArrayOf(-1, -1, 1, -1, -1, -1, -1, -1),
                intArrayOf(-1, 1, -1, -1, 2, 2, 2, -1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 2, -1),
                intArrayOf(-1, -1, 2, 2, 2, 2, -1, -1),
                intArrayOf(-1, -1, 3, 3, -1, 2, -1, -1),
                intArrayOf(-1, -1, 3, -1, -1, 3, -1, -1),
            )
        ),
    ),
    ParadeRunner(
        name = "giraffe", stepCells = 1.3, legEvery = 3, bounce = 0,
        frames = arrayOf(
            arrayOf(
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, -1),
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, -1),
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, 2, 2, -1, -1),
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, 2, 2, -1, -1, -1),
                intArrayOf(-1, -1, -1, -1, -1, -1, 2, 2, -1, -1, -1, -1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1, -1),
                intArrayOf(-1, -1, 3, -1, -1, -1, -1, 3, -1, -1, -1, -1),
                intArrayOf(-1, -1, 3, -1, -1, -1, -1, -1, 3, -1, -1, -1),
                intArrayOf(-1, 3, -1, -1, -1, -1, -1, -1, 3, -1, -1, -1),
            ),
            arrayOf(
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, -1),
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, -1),
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, 2, 2, -1, -1),
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, 2, 2, -1, -1, -1),
                intArrayOf(-1, -1, -1, -1, -1, -1, 2, 2, -1, -1, -1, -1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1, -1),
                intArrayOf(-1, -1, -1, 3, -1, -1, 3, -1, -1, -1, -1, -1),
                intArrayOf(-1, -1, -1, 3, -1, -1, -1, 3, -1, -1, -1, -1),
                intArrayOf(-1, -1, 3, -1, -1, -1, -1, 3, -1, -1, -1, -1),
            )
        ),
    ),
    ParadeRunner(
        name = "turtle", stepCells = 0.9, legEvery = 4, bounce = 0,
        frames = arrayOf(
            arrayOf(
                intArrayOf(-1, -1, -1, 2, 2, 2, 2, -1, -1, -1, -1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 2, 2, -1, -1, -1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, 2, -1, 1),
                intArrayOf(-1, -1, 3, -1, -1, -1, -1, 3, -1, 1, 1),
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1),
            ),
            arrayOf(
                intArrayOf(-1, -1, -1, 2, 2, 2, 2, -1, -1, -1, -1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 2, 2, -1, -1, -1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, 2, -1, 1),
                intArrayOf(-1, -1, -1, 3, -1, -1, 3, -1, -1, 1, 1),
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1),
            )
        ),
    ),
    ParadeRunner(
        name = "cat", stepCells = 1.7, legEvery = 2, bounce = 0,
        frames = arrayOf(
            arrayOf(
                intArrayOf(-1, 3, -1, -1, -1, -1, -1, -1, 1, -1, 1),
                intArrayOf(-1, -1, 3, -1, -1, -1, -1, -1, 1, 1, 1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 2, 2, 2, 1, 1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 2, 2, 2, -1, -1),
                intArrayOf(-1, -1, 3, -1, -1, -1, -1, 3, -1, -1, -1),
                intArrayOf(-1, 3, -1, -1, -1, -1, -1, -1, 3, -1, -1),
            ),
            arrayOf(
                intArrayOf(-1, -1, 3, -1, -1, -1, -1, -1, 1, -1, 1),
                intArrayOf(-1, 3, -1, -1, -1, -1, -1, -1, 1, 1, 1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 2, 2, 2, 1, 1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 2, 2, 2, -1, -1),
                intArrayOf(-1, -1, -1, 3, 3, -1, 3, 3, -1, -1, -1),
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1),
            )
        ),
    ),
    ParadeRunner(
        name = "rabbit", stepCells = 2.2, legEvery = 2, bounce = 1,
        frames = arrayOf(
            arrayOf(
                intArrayOf(-1, -1, -1, -1, -1, -1, 1, -1, 1, -1),
                intArrayOf(-1, -1, -1, -1, -1, -1, 1, -1, 1, -1),
                intArrayOf(-1, -1, -1, -1, -1, 2, 2, 2, 2, -1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, 2, -1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, -1, -1),
                intArrayOf(3, -1, -1, -1, -1, -1, -1, 3, -1, -1),
            ),
            arrayOf(
                intArrayOf(-1, -1, -1, -1, -1, 1, -1, 1, -1, -1),
                intArrayOf(-1, -1, -1, -1, -1, 1, -1, 1, -1, -1),
                intArrayOf(-1, -1, -1, -1, 2, 2, 2, 2, -1, -1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 2, 2, -1, -1),
                intArrayOf(-1, -1, 2, 2, 2, 2, 2, -1, -1, -1),
                intArrayOf(-1, -1, 3, 3, -1, 3, 3, -1, -1, -1),
            )
        ),
    ),
    ParadeRunner(
        name = "cow", stepCells = 1.0, legEvery = 3, bounce = 0,
        frames = arrayOf(
            arrayOf(
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1, -1, 1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, -1, 2, 2, 2, -1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1),
                intArrayOf(-1, -1, 3, 3, -1, -1, -1, -1, 3, 3, -1, -1, -1),
                intArrayOf(-1, -1, 3, 3, -1, -1, -1, -1, 3, 3, -1, -1, -1),
            ),
            arrayOf(
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1, -1, 1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, -1, 2, 2, 2, -1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1),
                intArrayOf(-1, 3, 3, -1, -1, -1, -1, 3, 3, -1, -1, -1, -1),
                intArrayOf(-1, 3, 3, -1, -1, -1, -1, 3, 3, -1, -1, -1, -1),
            )
        ),
    ),
    ParadeRunner(
        name = "dragon", stepCells = 1.5, legEvery = 2, bounce = 1,
        frames = arrayOf(
            arrayOf(
                intArrayOf(-1, -1, -1, -1, -1, 2, 2, -1, -1, -1, -1, -1, 1, -1, 1),
                intArrayOf(-1, -1, -1, -1, 2, 2, 2, 2, -1, -1, -1, 1, 1, 1, -1),
                intArrayOf(2, 2, -1, -1, 2, 2, 2, 2, 2, 2, -1, 2, 1, 1, -1),
                intArrayOf(-1, 2, 2, 2, 2, -1, 2, 2, 2, 2, 2, 2, 2, -1, -1),
                intArrayOf(-1, -1, 2, 2, -1, -1, -1, -1, 2, 2, 2, -1, -1, -1, -1),
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1),
            ),
            arrayOf(
                intArrayOf(-1, -1, -1, -1, 2, 2, -1, -1, -1, -1, -1, -1, 1, -1, 1),
                intArrayOf(-1, -1, -1, 2, 2, 2, 2, -1, -1, -1, -1, 1, 1, 1, -1),
                intArrayOf(2, 2, -1, -1, 2, 2, 2, 2, 2, 2, -1, 2, 1, 1, -1),
                intArrayOf(-1, 2, 2, 2, 2, -1, 2, 2, 2, 2, 2, 2, 2, -1, -1),
                intArrayOf(-1, 2, 2, -1, -1, -1, -1, -1, 2, 2, 2, -1, -1, -1, -1),
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1),
            )
        ),
    ),
    ParadeRunner(
        name = "horse", stepCells = 2.6, legEvery = 1, bounce = 0,
        frames = arrayOf(
            arrayOf(
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, -1, -1),
                intArrayOf(-1, 1, -1, -1, -1, -1, -1, -1, -1, 2, 1, 1, -1, -1),
                intArrayOf(-1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1),
                intArrayOf(-1, -1, 3, -1, -1, -1, -1, -1, -1, 3, -1, -1, -1, -1),
                intArrayOf(-1, 3, -1, -1, -1, -1, -1, -1, -1, -1, 3, -1, -1, -1),
                intArrayOf(3, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 3, -1, -1),
            ),
            arrayOf(
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, -1, -1),
                intArrayOf(-1, 1, -1, -1, -1, -1, -1, -1, -1, 2, 1, 1, -1, -1),
                intArrayOf(-1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1),
                intArrayOf(-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1),
                intArrayOf(-1, -1, -1, 3, 3, -1, -1, -1, 3, 3, -1, -1, -1, -1),
                intArrayOf(-1, -1, -1, -1, 3, -1, -1, -1, 3, -1, -1, -1, -1, -1),
                intArrayOf(-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1),
            )
        ),
    ),
)
