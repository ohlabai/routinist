// 시작 화면 — 브랜드 + 슬로건 + 큰 시작 버튼 (2026-07-26 hans: 슬로건·큰 글씨).

import SwiftUI

struct StartView: View {
    @EnvironmentObject var workout: WorkoutManager

    private let emerald = Color(red: 0.06, green: 0.73, blue: 0.51)

    var body: some View {
        VStack(spacing: 14) {
            VStack(spacing: 3) {
                Text("Routinist")
                    .font(.system(size: 22, weight: .heavy, design: .rounded))
                    .foregroundStyle(emerald)
                Text("Run your Routine.")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            Button {
                workout.requestAuthorizationAndStart()
            } label: {
                VStack(spacing: 6) {
                    Image(systemName: "figure.run")
                        .font(.system(size: 36, weight: .bold))
                    Text("달리기 시작")
                        .font(.system(size: 18, weight: .heavy, design: .rounded))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
            }
            .buttonStyle(.borderedProminent)
            .tint(emerald)
            .disabled(workout.phase == .requesting)

            if workout.phase == .requesting {
                ProgressView()
            }
            if workout.authDenied {
                Text("건강 권한이 필요해요.\n워치 설정 > 개인정보 보호 > 건강에서 허용해주세요")
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, 6)
    }
}
