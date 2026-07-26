// 러닝 중 페이지 — 좌: 컨트롤 / 우: 메트릭 (Apple 운동앱 패턴).

import SwiftUI

struct SessionPagingView: View {
    @EnvironmentObject var workout: WorkoutManager
    @State private var selection: Tab = .metrics

    enum Tab { case controls, metrics }

    var body: some View {
        TabView(selection: $selection) {
            ControlsView().tag(Tab.controls)
            MetricsView().tag(Tab.metrics)
        }
        .tabViewStyle(.page)
        .navigationBarBackButtonHidden(true)
    }
}

struct MetricsView: View {
    @EnvironmentObject var workout: WorkoutManager

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // 시간 — hero
            Text(formatElapsed(workout.elapsedSeconds))
                .font(.system(size: 34, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.yellow)

            metricRow(
                value: String(format: "%.2f", workout.distanceMeters / 1000),
                unit: "km",
                color: Color(red: 0.06, green: 0.73, blue: 0.51)
            )
            metricRow(
                value: formatPace(workout.paceSecPerKm),
                unit: "/km",
                color: .white
            )
            HStack(spacing: 4) {
                Image(systemName: "heart.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(.red)
                Text(workout.heartRate > 0 ? String(format: "%.0f", workout.heartRate) : "--")
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                    .monospacedDigit()
            }
            if workout.phase == .paused {
                Text("일시정지됨")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.orange)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
    }

    private func metricRow(value: String, unit: String, color: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(value)
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(color)
            Text(unit)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.secondary)
        }
    }
}

struct ControlsView: View {
    @EnvironmentObject var workout: WorkoutManager

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                VStack(spacing: 4) {
                    Button {
                        workout.endWorkout()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 20, weight: .bold))
                    }
                    .tint(.red)
                    .font(.title2)
                    Text("종료").font(.system(size: 12))
                }
                VStack(spacing: 4) {
                    Button {
                        workout.togglePause()
                    } label: {
                        Image(systemName: workout.phase == .paused ? "arrow.clockwise" : "pause")
                            .font(.system(size: 20, weight: .bold))
                    }
                    .tint(.yellow)
                    .font(.title2)
                    Text(workout.phase == .paused ? "재개" : "일시정지").font(.system(size: 12))
                }
            }
        }
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
