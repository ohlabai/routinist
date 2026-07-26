// 종료 요약 — 거리/시간/페이스/심박/칼로리 + 폰 자동 유입 안내.
// 2026-07-26 hans: 큰 글씨 리디자인 — 값 중심, rounded 폰트.

import SwiftUI

struct SummaryView: View {
    @EnvironmentObject var workout: WorkoutManager

    private let emerald = Color(red: 0.20, green: 0.83, blue: 0.60)

    var body: some View {
        scrollContent
            // v5: 완주 잔디 컨페티 — 블록들이 흩날리며 떨어지는 축하
            .overlay { GrassConfettiView() }
    }

    private var scrollContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("완주! 🎉")
                    .font(.system(size: 30, weight: .heavy, design: .rounded))

                if let s = workout.summary {
                    summaryRow(label: "거리", value: String(format: "%.2f", s.distanceMeters / 1000), unit: "km", color: emerald)
                    summaryRow(label: "시간", value: formatElapsed(s.elapsedSeconds), unit: nil, color: .yellow)
                    summaryRow(label: "평균 페이스", value: formatPace(s.paceSecPerKm), unit: "/km", color: .white)
                    if s.avgHeartRate > 0 {
                        summaryRow(label: "평균 심박", value: String(format: "%.0f", s.avgHeartRate), unit: "bpm", color: .red)
                    }
                    if s.calories > 0 {
                        summaryRow(label: "칼로리", value: String(format: "%.0f", s.calories), unit: "kcal", color: .orange)
                    }
                }

                Text("Apple Health 에 저장했어요.\niPhone 의 Routinist 가 자동으로 가져가요 🏃")
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
                    .padding(.top, 2)

                Button {
                    workout.reset()
                } label: {
                    Text("완료")
                        .font(.system(size: 18, weight: .heavy, design: .rounded))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                }
                .buttonStyle(.borderedProminent)
                .tint(emerald)
            }
            .padding(.horizontal, 4)
        }
        .navigationBarBackButtonHidden(true)
    }

    private func summaryRow(label: String, value: String, unit: String?, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value)
                    .font(.system(size: 36, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .foregroundStyle(color)
                if let unit {
                    Text(unit)
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
