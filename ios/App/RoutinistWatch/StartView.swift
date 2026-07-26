// 시작 화면 — 에메랄드 그린 브랜드, 큰 시작 버튼 하나 (워치는 단순함이 정의).

import SwiftUI

struct StartView: View {
    @EnvironmentObject var workout: WorkoutManager

    var body: some View {
        VStack(spacing: 12) {
            Text("Routinist")
                .font(.headline)
                .foregroundStyle(Color(red: 0.06, green: 0.73, blue: 0.51)) // emerald-500

            Button {
                workout.requestAuthorizationAndStart()
            } label: {
                VStack(spacing: 4) {
                    Image(systemName: "figure.run")
                        .font(.system(size: 30, weight: .bold))
                    Text("달리기 시작")
                        .font(.system(size: 15, weight: .heavy))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color(red: 0.06, green: 0.73, blue: 0.51))
            .disabled(workout.phase == .requesting)

            if workout.phase == .requesting {
                ProgressView()
            }
            if workout.authDenied {
                Text("건강 권한이 필요해요.\n워치 설정 > 개인정보 보호 > 건강에서 허용해주세요")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, 8)
    }
}
