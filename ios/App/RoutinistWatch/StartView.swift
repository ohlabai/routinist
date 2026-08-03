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
                    // v16: 잔디 픽셀 퍼레이드 — 사람·동물들이 차례로 달려간다
                    GrassParadeView()
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
            // v21 프라이머 알럿은 2026-08-03 hans 지시로 제거 — 탭 한 번 아끼고 시트 직행

            // v14 (hans): "목표 없음" 대신 친근한 초대 카피 — 누르면 목표 설정
            Button {
                showGoalPicker = true
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "target")
                        .font(.system(size: 14, weight: .bold))
                    Text(goalButtonLabel)
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
            }
            .buttonStyle(.plain)
            .background(Capsule().fill(Color.white.opacity(0.12)))
            .foregroundStyle(Color(red: 0.20, green: 0.83, blue: 0.60))

            // v9: 이달 챌린지 진행률 (iPhone 에서 동기화되면 표시)
            if let target = connectivity.challengeTargetKm, target > 0 {
                Text(String(format: "🌱 이달 %.1f / %.1fkm", connectivity.challengeProgressKm ?? 0, target))
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            if workout.phase == .requesting {
                ProgressView()
            }
            if workout.authDenied {
                Text("건강 권한이 필요해요.\n워치 설정 > 개인정보 보호 > 건강에서 허용해주세요")
                    .font(.system(size: 14, design: .rounded))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, 6)
        .onAppear { workout.loadGoal() }
        .sheet(isPresented: $showGoalPicker) { GoalPickerView() }
    }

    /// v14: 미설정 = 초대 카피 / 설정 = "오늘 목표 · 5km"
    private var goalButtonLabel: String {
        switch workout.goal {
        case .open: return "오늘은 얼마쯤 달릴까?"
        case .distanceKm(let km):
            let v = km == 21.1 ? "하프" : km == 42.2 ? "풀" : String(format: km == km.rounded() ? "%.0fkm" : "%.1fkm", km)
            return "오늘 목표 · \(v)"
        case .timeMin(let m): return "오늘 목표 · \(m)분"
        }
    }
}

// v10: 목표 선택 시트 — ± 버튼으로 1km/5분 단위 자유 조정 (hans: "13km 목표를 못 잡네")
struct GoalPickerView: View {
    @EnvironmentObject var workout: WorkoutManager
    @Environment(\.dismiss) private var dismiss

    private let emerald = Color(red: 0.20, green: 0.83, blue: 0.60)

    // v14: '없음' 모드 제거 (hans) — 거리/시간만. 목표는 축하 장치라 있어도 부담 없음.
    enum Mode: String, CaseIterable { case distance = "거리", time = "시간" }
    @State private var mode: Mode = .distance
    @State private var km: Double = 5
    @State private var minutes: Int = 30

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text("오늘은 얼마쯤 달릴까? 🏃")
                    .font(.system(size: 15, weight: .heavy, design: .rounded))
                    .minimumScaleFactor(0.8)
                    .lineLimit(1)

                // 모드 선택
                HStack(spacing: 4) {
                    ForEach(Mode.allCases, id: \.self) { m in
                        Button {
                            mode = m
                        } label: {
                            Text(m.rawValue)
                                .font(.system(size: 14, weight: .heavy, design: .rounded))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 7)
                        }
                        .buttonStyle(.plain)
                        .background(Capsule().fill(mode == m ? emerald.opacity(0.85) : Color.white.opacity(0.1)))
                        .foregroundStyle(mode == m ? .black : .white)
                    }
                }

                if mode == .distance {
                    stepperRow(value: String(format: km == km.rounded() ? "%.0f" : "%.1f", km), unit: "km",
                               minus: { km = max(1, km - 1) }, plus: { km = min(60, km + 1) })
                    // 빠른 프리셋
                    HStack(spacing: 4) {
                        presetChip("5") { km = 5 }
                        presetChip("10") { km = 10 }
                        presetChip("하프") { km = 21.1 }
                        presetChip("풀") { km = 42.2 }
                    }
                } else {
                    stepperRow(value: "\(minutes)", unit: "분",
                               minus: { minutes = max(5, minutes - 5) }, plus: { minutes = min(300, minutes + 5) })
                }

                Button {
                    switch mode {
                    case .distance: workout.goal = .distanceKm(km)
                    case .time: workout.goal = .timeMin(minutes)
                    }
                    dismiss()
                } label: {
                    Text("완료")
                        .font(.system(size: 16, weight: .heavy, design: .rounded))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                }
                .buttonStyle(.plain)
                .background(RoundedRectangle(cornerRadius: 14).fill(emerald))
                .foregroundStyle(.black)
            }
            .padding(.horizontal, 4)
        }
        .onAppear {
            // 현재 목표로 초기화 (미설정이면 거리 5km 기본)
            switch workout.goal {
            case .open: mode = .distance; km = 5
            case .distanceKm(let v): mode = .distance; km = v
            case .timeMin(let m): mode = .time; minutes = m
            }
        }
    }

    private func stepperRow(value: String, unit: String, minus: @escaping () -> Void, plus: @escaping () -> Void) -> some View {
        HStack(spacing: 8) {
            stepBtn("minus") { minus() }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value)
                    .font(.system(size: 40, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(emerald)
                Text(unit)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            stepBtn("plus") { plus() }
        }
    }

    private func stepBtn(_ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 20, weight: .heavy))
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.plain)
        .background(Circle().fill(Color.white.opacity(0.14)))
    }

    private func presetChip(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 15, weight: .heavy, design: .rounded))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
        }
        .buttonStyle(.plain)
        .background(Capsule().fill(Color.white.opacity(0.1)))
    }
}
