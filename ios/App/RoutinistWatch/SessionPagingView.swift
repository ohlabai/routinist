// 러닝 중 페이지 — 컨트롤 | 메트릭 | 심박 그래프 (Apple 운동앱 패턴, 페이지 dots).
// 2026-07-26 hans: 큰 글씨 + 그래프 시각화 업그레이드.

import SwiftUI
import WatchKit

struct SessionPagingView: View {
    @EnvironmentObject var workout: WorkoutManager
    @State private var selection: Tab

    enum Tab { case controls, metrics, heart }

    init() {
        // DEBUG 스크린샷: -uipreview-controls / -uipreview-hr 로 시작 페이지 지정
        let args = ProcessInfo.processInfo.arguments
        _selection = State(initialValue:
            args.contains("-uipreview-controls") ? .controls
            : args.contains("-uipreview-hr") ? .heart
            : .metrics)
    }

    var body: some View {
        TabView(selection: $selection) {
            ControlsView().tag(Tab.controls)
            MetricsView().tag(Tab.metrics)
            HeartRateView().tag(Tab.heart)
        }
        .tabViewStyle(.page)
        .navigationBarBackButtonHidden(true)
    }
}

// ── 메트릭 (기본 페이지) ────────────────────────────────────────

struct MetricsView: View {
    @EnvironmentObject var workout: WorkoutManager

    private let emerald = Color(red: 0.20, green: 0.83, blue: 0.60)

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            // 시간 — hero (제일 크게)
            Text(formatElapsed(workout.elapsedSeconds))
                .font(.system(size: 46, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .foregroundStyle(.yellow)

            // 거리
            bigMetric(String(format: "%.2f", workout.distanceMeters / 1000), unit: "km", color: emerald, size: 40)

            // 페이스
            bigMetric(formatPace(workout.paceSecPerKm), unit: "/km", color: .white, size: 34)

            // 심박
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Image(systemName: "heart.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(.red)
                Text(workout.heartRate > 0 ? String(format: "%.0f", workout.heartRate) : "--")
                    .font(.system(size: 34, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                Text("bpm")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            if workout.phase == .paused {
                Text("일시정지됨")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(.orange)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(.leading, 16)
        .padding(.trailing, 6)
    }

    private func bigMetric(_ value: String, unit: String, color: Color, size: CGFloat) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(value)
                .font(.system(size: size, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .minimumScaleFactor(0.7)
                .lineLimit(1)
                .foregroundStyle(color)
            Text(unit)
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(.secondary)
        }
    }
}

// ── 심박 그래프 페이지 ──────────────────────────────────────────

struct HeartRateView: View {
    @EnvironmentObject var workout: WorkoutManager

    private var avgHr: Double {
        workout.hrSamples.isEmpty ? 0 : workout.hrSamples.reduce(0, +) / Double(workout.hrSamples.count)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "heart.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(.red)
                Text(workout.heartRate > 0 ? String(format: "%.0f", workout.heartRate) : "--")
                    .font(.system(size: 44, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                Text("bpm")
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            HeartSparkline(samples: workout.hrSamples)
                .frame(height: 64)

            if avgHr > 0 {
                Text(String(format: "평균 %.0f bpm", avgHr))
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
            } else {
                Text("심박 측정 중…")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(.leading, 16)
        .padding(.trailing, 10)
    }
}

/// 심박 스파크라인 — 빨간 라인 + 그라데이션 필
struct HeartSparkline: View {
    let samples: [Double]

    var body: some View {
        Canvas { ctx, size in
            guard samples.count >= 2 else { return }
            let minV = (samples.min() ?? 60) - 5
            let maxV = (samples.max() ?? 180) + 5
            let range = max(1, maxV - minV)
            let stepX = size.width / CGFloat(samples.count - 1)

            func point(_ i: Int) -> CGPoint {
                CGPoint(x: CGFloat(i) * stepX,
                        y: size.height * (1 - CGFloat((samples[i] - minV) / range)))
            }

            var line = Path()
            line.move(to: point(0))
            for i in 1..<samples.count { line.addLine(to: point(i)) }

            // 그라데이션 필 (라인 아래)
            var fill = line
            fill.addLine(to: CGPoint(x: size.width, y: size.height))
            fill.addLine(to: CGPoint(x: 0, y: size.height))
            fill.closeSubpath()
            ctx.fill(fill, with: .linearGradient(
                Gradient(colors: [Color.red.opacity(0.35), Color.red.opacity(0.02)]),
                startPoint: .zero, endPoint: CGPoint(x: 0, y: size.height)))

            ctx.stroke(line, with: .color(.red), style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))

            // 현재 값 점
            let last = point(samples.count - 1)
            ctx.fill(Path(ellipseIn: CGRect(x: last.x - 3.5, y: last.y - 3.5, width: 7, height: 7)), with: .color(.white))
        }
    }
}

// ── 컨트롤 페이지 (Apple 운동앱 그리드) ─────────────────────────

struct ControlsView: View {
    @EnvironmentObject var workout: WorkoutManager

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                VStack(spacing: 5) {
                    Button {
                        workout.endWorkout()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 24, weight: .heavy))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 18)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red.opacity(0.85))
                    Text("종료")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                }
                VStack(spacing: 5) {
                    Button {
                        workout.togglePause()
                    } label: {
                        Image(systemName: workout.phase == .paused ? "arrow.clockwise" : "pause")
                            .font(.system(size: 24, weight: .heavy))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 18)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.yellow.opacity(0.9))
                    Text(workout.phase == .paused ? "재개" : "일시정지")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                }
            }
            // 화면 잠금 (물·소매 오터치 방지) — Apple 운동앱의 물잠금 문법
            Button {
                WKInterfaceDevice.current().enableWaterLock()
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "drop.fill")
                        .font(.system(size: 15, weight: .bold))
                    Text("화면 잠금")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
            }
            .buttonStyle(.bordered)
            .tint(.cyan)
        }
        .padding(.horizontal, 4)
    }
}

// ── 포맷터 ─────────────────────────────────────────────────────

func formatElapsed(_ seconds: TimeInterval) -> String {
    let total = Int(seconds)
    let h = total / 3600, m = (total % 3600) / 60, s = total % 60
    return h > 0
        ? String(format: "%d:%02d:%02d", h, m, s)
        : String(format: "%02d:%02d", m, s)
}

func formatPace(_ secPerKm: Double?) -> String {
    guard let p = secPerKm, p.isFinite, p > 0 else { return "--'--\"" }
    let total = Int(p.rounded())
    return String(format: "%d'%02d\"", total / 60, total % 60)
}
