// 시작 화면 — 웹과 동일한 브랜드 락업 (잔디 R 로고 + Routinist extrabold + Run Your Routine!)
// + 잔디 픽셀 러너 시작 버튼 (2026-07-26 hans: 로고 폰트·카피 통일 + 잔디 컨셉 아이콘).

import SwiftUI

struct StartView: View {
    @EnvironmentObject var workout: WorkoutManager

    var body: some View {
        VStack(spacing: 12) {
            // 브랜드 락업 — 웹 스플래시와 동일 구성
            HStack(spacing: 7) {
                GrassLogoChip(size: 30)
                Text("Routinist")
                    .font(.system(size: 24, weight: .heavy))
                    .tracking(-0.5)
                    .foregroundStyle(.white)
            }
            Text("Run Your Routine!")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(GrassPalette.mid)
                .padding(.top, -6)

            Button {
                workout.requestAuthorizationAndStart()
            } label: {
                VStack(spacing: 7) {
                    PixelGridView(grid: GRASS_RUNNER_GRID)
                        .frame(width: 44, height: 44)
                    Text("달리기 시작")
                        .font(.system(size: 18, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
            }
            .buttonStyle(.plain)
            .background(
                RoundedRectangle(cornerRadius: 24)
                    .fill(GrassPalette.bg)
                    .overlay(RoundedRectangle(cornerRadius: 24).stroke(GrassPalette.mid.opacity(0.55), lineWidth: 1.5))
            )
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
