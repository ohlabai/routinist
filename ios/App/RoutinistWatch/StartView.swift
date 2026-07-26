// 시작 화면 — 웹과 동일한 브랜드 락업 (잔디 R 로고 + Routinist extrabold + Run Your Routine!)
// + 잔디 픽셀 러너 시작 버튼 (2026-07-26 hans: 로고 폰트·카피 통일 + 잔디 컨셉 아이콘).

import SwiftUI

struct StartView: View {
    @EnvironmentObject var workout: WorkoutManager
    // v8: 잔디 성장 트랜지션 제거 (hans: "촌스러워") — 탭 즉시 카운트다운으로
    // v9: 목표 설정 (거리/시간) + 이달 챌린지 진행률 칩 (폰 연동)
    @State private var showGoalPicker = false
    @ObservedObject private var connectivity = ConnectivityStore.shared

    var body: some View {
        VStack(spacing: 10) {
            // 브랜드 — 워드마크 에메랄드 단독 (R 중복 회피), 카피는 화이트
            VStack(spacing: 3) {
                Text("Routinist")
                    .font(.system(size: 26, weight: .heavy))
                    .tracking(-0.5)
                    .foregroundStyle(GrassPalette.mid)
                Text("Run Your Routine!")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
            }

            Button {
                workout.requestAuthorizationAndStart()
            } label: {
                VStack(spacing: 9) {
                    // 달리는 잔디 애니메이션 — 물결이 오른쪽으로 달림
                    RunningGrassView()
                        .frame(height: 40)
                        .padding(.horizontal, 14)
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

            // v9: 목표 버튼 (Apple 운동앱 목표 문법)
            Button {
                showGoalPicker = true
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "target")
                        .font(.system(size: 13, weight: .bold))
                    Text(workout.goal.label)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
            }
            .buttonStyle(.plain)
            .background(Capsule().fill(Color.white.opacity(0.12)))
            .foregroundStyle(workout.goal == .open ? .secondary : Color(red: 0.20, green: 0.83, blue: 0.60))

            // v9: 이달 챌린지 진행률 (iPhone 에서 동기화되면 표시)
            if let target = connectivity.challengeTargetKm, target > 0 {
                Text(String(format: "🌱 이달 %.1f / %.1fkm", connectivity.challengeProgressKm ?? 0, target))
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
            }

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
        .onAppear { workout.loadGoal() }
        .sheet(isPresented: $showGoalPicker) { GoalPickerView() }
    }
}

// v9: 목표 선택 시트 — 거리/시간 프리셋
struct GoalPickerView: View {
    @EnvironmentObject var workout: WorkoutManager
    @Environment(\.dismiss) private var dismiss

    private let emerald = Color(red: 0.20, green: 0.83, blue: 0.60)

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                Text("목표 설정")
                    .font(.system(size: 16, weight: .heavy, design: .rounded))

                goalRow(.open)
                Text("거리")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                goalRow(.distanceKm(3))
                goalRow(.distanceKm(5))
                goalRow(.distanceKm(10))
                goalRow(.distanceKm(21.1))
                Text("시간")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                goalRow(.timeMin(15))
                goalRow(.timeMin(30))
                goalRow(.timeMin(60))
            }
            .padding(.horizontal, 4)
        }
    }

    private func goalRow(_ g: WorkoutManager.RunGoal) -> some View {
        Button {
            workout.goal = g
            dismiss()
        } label: {
            HStack {
                Text(g.label)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                Spacer()
                if workout.goal == g {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .heavy))
                        .foregroundStyle(emerald)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
        }
        .buttonStyle(.plain)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(workout.goal == g ? 0.16 : 0.08)))
    }
}
