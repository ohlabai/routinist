// 종료 요약 — 거리/시간/페이스/심박/칼로리 + 폰 자동 유입 안내.

import SwiftUI

struct SummaryView: View {
    @EnvironmentObject var workout: WorkoutManager

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("완주! 🎉")
                    .font(.system(size: 20, weight: .heavy))

                if let s = workout.summary {
                    summaryRow(label: "거리", value: String(format: "%.2f km", s.distanceMeters / 1000),
                               color: Color(red: 0.06, green: 0.73, blue: 0.51))
                    summaryRow(label: "시간", value: formatElapsed(s.elapsedSeconds), color: .yellow)
                    summaryRow(label: "평균 페이스", value: formatPace(s.paceSecPerKm) + "/km", color: .white)
                    if s.avgHeartRate > 0 {
                        summaryRow(label: "평균 심박", value: String(format: "%.0f bpm", s.avgHeartRate), color: .red)
                    }
                    if s.calories > 0 {
                        summaryRow(label: "칼로리", value: String(format: "%.0f kcal", s.calories), color: .orange)
                    }
                }

                Text("Apple Health 에 저장했어요.\niPhone 의 Routinist 가 자동으로 가져가요 🏃")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .padding(.top, 2)

                Button {
                    workout.reset()
                } label: {
                    Text("완료")
                        .font(.system(size: 15, weight: .heavy))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color(red: 0.06, green: 0.73, blue: 0.51))
            }
            .padding(.horizontal, 6)
        }
        .navigationBarBackButtonHidden(true)
    }

    private func summaryRow(label: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(color)
        }
    }
}
