// 러닝 중 페이지 — 좌: 컨트롤 / 우: 메트릭 (Apple 운동앱 패턴).
// 2026-07-26 hans: 달리면서 흘끗 봐도 읽히게 글씨 대폭 확대 — Apple Fitness 문법
// (좌정렬 거대 숫자 스택, 라벨은 단위로 대체) + rounded 폰트로 친근하게.

import SwiftUI

struct SessionPagingView: View {
    @EnvironmentObject var workout: WorkoutManager
    @State private var selection: Tab

    enum Tab { case controls, metrics }

    init() {
        // DEBUG 스크린샷: -uipreview-controls 면 컨트롤 페이지로 시작
        _selection = State(initialValue:
            ProcessInfo.processInfo.arguments.contains("-uipreview-controls") ? .controls : .metrics)
    }

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
            }

            if workout.phase == .paused {
                Text("일시정지됨")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(.orange)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
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

struct ControlsView: View {
    @EnvironmentObject var workout: WorkoutManager

    var body: some View {
        HStack(spacing: 10) {
            VStack(spacing: 6) {
                Button {
                    workout.endWorkout()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 26, weight: .heavy))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 22)
                }
                .buttonStyle(.borderedProminent)
                .tint(.red.opacity(0.85))
                Text("종료")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
            }
            VStack(spacing: 6) {
                Button {
                    workout.togglePause()
                } label: {
                    Image(systemName: workout.phase == .paused ? "arrow.clockwise" : "pause")
                        .font(.system(size: 26, weight: .heavy))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 22)
                }
                .buttonStyle(.borderedProminent)
                .tint(.yellow.opacity(0.9))
                Text(workout.phase == .paused ? "재개" : "일시정지")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
            }
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
