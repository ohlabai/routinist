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
                // 2026-08-03 hans: 폭죽(🎉) 아이콘 제거 — 축하의 주인공은 블록동물.
                // 완주 타이틀 옆에서 페이스 동물이 제자리 달리기하며 맞아준다.
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .center, spacing: 10) {
                        Text("완주!")
                            .font(.system(size: 30, weight: .heavy, design: .rounded))
                        if let s = workout.summary {
                            ParadeRunnerInPlace(runner: paceAnimalMatch(paceSecPerKm: s.paceSecPerKm).runner, height: 34)
                        }
                    }
                    // 2026-08-02 hans: 종료 직후 따뜻한 한 줄
                    Text("오늘도 잘 달렸어요")
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                }

                // 페이스 동물 축하 카피 (웹 완료시트·공유카드와 같은 사다리)
                if let s = workout.summary {
                    Text(paceAnimalMatch(paceSecPerKm: s.paceSecPerKm).copy)
                        .font(.system(size: 14, weight: .heavy, design: .rounded))
                        .foregroundStyle(emerald)
                        .minimumScaleFactor(0.75)
                        .lineLimit(2)
                        .padding(.vertical, 2)
                }

                // v12: 다른 운동 앱이 세션을 가져가 종료된 경우 — 이유 안내 (버그 아님을 명확히)
                if workout.endedExternally {
                    Text("다른 운동 앱이 시작되면서 러닝이 종료됐어요. 여기까지 기록은 저장했어요.")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(.orange)
                }

                if let s = workout.summary {
                    summaryRow(label: "거리", value: String(format: "%.2f", s.distanceMeters / 1000), unit: "km", color: emerald)
                    summaryRow(label: "시간", value: formatElapsed(s.elapsedSeconds), unit: nil, color: .yellow)
                    summaryRow(label: "평균 페이스", value: formatPace(s.paceSecPerKm), unit: "/km", color: .white)
                    if s.avgHeartRate > 0 {
                        summaryRow(label: "평균 심박", value: String(format: "%.0f", s.avgHeartRate), unit: "bpm", color: .red)
                    }
                    // v19 (zone1~5 회원 요청): 존별 체류 시간 분포 — 1분 이상 측정됐을 때만
                    if s.zoneSeconds.reduce(0, +) >= 60 {
                        zoneBreakdown(s.zoneSeconds)
                    }
                    if s.calories > 0 {
                        summaryRow(label: "칼로리", value: String(format: "%.0f", s.calories), unit: "kcal", color: .orange)
                    }
                }

                // v24: WCSession 직송 — 폰 앱을 열면 즉시 기록이 도착한다 (HK 미러 대기 불필요)
                Text("기록을 iPhone 으로 보냈어요.\nRoutinist 앱을 열면 바로 보여요 🏃")
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

    private static let zoneColors: [Color] = [.blue, .green, .yellow, .orange, .red]

    /// v19: 심박 영역 1~5 체류 시간 — 색 라벨 + 비례 바 + 시간
    private func zoneBreakdown(_ secs: [Double]) -> some View {
        let total = max(1, secs.reduce(0, +))
        return VStack(alignment: .leading, spacing: 4) {
            Text("심박 영역")
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
            ForEach(0..<5, id: \.self) { i in
                HStack(spacing: 6) {
                    Text("영역 \(i + 1)")
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(Self.zoneColors[i])
                        .frame(width: 48, alignment: .leading)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.white.opacity(0.10))
                            Capsule().fill(Self.zoneColors[i])
                                .frame(width: secs[i] > 0
                                       ? max(4, geo.size.width * CGFloat(secs[i] / total))
                                       : 0)
                        }
                    }
                    .frame(height: 7)
                    Text(formatZoneTime(secs[i]))
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .frame(width: 40, alignment: .trailing)
                }
            }
        }
    }

    private func formatZoneTime(_ s: Double) -> String {
        let m = Int(s) / 60
        return m > 0 ? "\(m)분" : (s > 0 ? "\(Int(s))초" : "-")
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
