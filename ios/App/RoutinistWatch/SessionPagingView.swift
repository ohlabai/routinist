// 러닝 중 페이지 — 컨트롤 | 메트릭 | 심박 그래프 (Apple 운동앱 패턴, 페이지 dots).
// 2026-07-26 hans: 큰 글씨 + 그래프 시각화 업그레이드.

import SwiftUI
import WatchKit

struct SessionPagingView: View {
    @EnvironmentObject var workout: WorkoutManager
    @State private var selection: Tab

    enum Tab { case controls, metrics, heart }

    init() {
        // DEBUG 스크린샷: -uipreview-controls / -uipreview-hr 로 시작 페이지 지정
        let args = ProcessInfo.processInfo.arguments
        _selection = State(initialValue:
            args.contains("-uipreview-controls") ? .controls
            : args.contains("-uipreview-hr") ? .heart
            : .metrics)
    }

    var body: some View {
        // 2026-08-11 hans: 페이지 전환 = 좌우 스와이프 (건강/피트니스 앱 문법).
        // v7 의 세로 페이징(.verticalPage) 은 폐기 — 상하 스와이프가 불편하다는 피드백.
        TabView(selection: $selection) { pages }
            .tabViewStyle(.page)
        // 2026-08-02 hans: 다시 달리기 (수동·자동 재개) 후 컨트롤에 머물지 말고
        // 기록 화면으로 — 달리기 시작했으면 보이는 건 메트릭이어야 한다.
        // (watchOS 9 타겟: onChange 는 1-param 형만)
        .onChange(of: workout.phase) { newPhase in
            if newPhase == .active { selection = .metrics }
        }
        .navigationBarBackButtonHidden(true)
    }

    @ViewBuilder private var pages: some View {
        ControlsView().tag(Tab.controls)
        MetricsView().tag(Tab.metrics)
        HeartRateView().tag(Tab.heart)
    }
}

// ── 메트릭 (기본 페이지) ────────────────────────────────────────

/// 심박 존 팔레트 — 메트릭 행 / 심박 페이지 / 존 바가 같은 색을 쓴다.
/// 직사광 가독성을 위해 시스템 기본색보다 한 톤 밝게 뽑음.
enum HRZone {
    static let colors: [Color] = [
        Color(red: 0.42, green: 0.75, blue: 1.00),   // 1 웜업
        Color(red: 0.20, green: 0.83, blue: 0.60),   // 2 이지 (브랜드 에메랄드)
        Color(red: 1.00, green: 0.84, blue: 0.30),   // 3 에어로빅
        Color(red: 1.00, green: 0.62, blue: 0.22),   // 4 역치
        Color(red: 1.00, green: 0.40, blue: 0.40),   // 5 최대
    ]
    /// 심박 숫자 고정색 — 존에 따라 색이 바뀌면 4행이 전부 다른 색으로 요동친다.
    /// 숫자는 늘 이 코랄, 존은 아래 작은 라벨에서만 색으로 말한다.
    static let ink = Color(red: 1.00, green: 0.47, blue: 0.47)

    static func color(_ zone: Int) -> Color {
        colors[min(max(zone, 1), 5) - 1]
    }
}

struct MetricsView: View {
    @EnvironmentObject var workout: WorkoutManager

    private let emerald = Color(red: 0.20, green: 0.83, blue: 0.60)

    var body: some View {
        // v10 (Apple 운동앱 실측 문법): 각 지표가 화면 폭을 거의 채우는 초대형 숫자,
        // 라벨은 값 오른쪽 아주 작은 2줄. 야외 직사광에서 흘끗 봐도 읽히게.
        // v19 (2026-08-01, 회원 요청): 심박 행 복원 — 존 색 숫자 + 영역 칩을 메인 화면에.
        // v22 (2026-08-13): compressed 폭 + 센티초 분리로 스케일 재조정 (72/70/62/62).
        //   히어로(거리만 초대형) 안도 만들어 비교했으나 hans 가 균등안 선택 — 달리는 중
        //   페이스를 자주 확인하는 편이라 4지표가 모두 큰 쪽이 맞다. 히어로안은 폐기.
        VStack(alignment: .leading, spacing: 2) {
            // 시간 — hero. v22: 센티초를 본문에서 분리.
            // "21:04.00" 8자를 한 덩어리로 그리면 폭(208pt)에 안 맞아 minimumScaleFactor 가
            // 65% 로 줄여버렸다 — 크게 쓴 줄 알았는데 실제론 작게 렌더되던 것이 가독성의 진범.
            // 분·초만 큰 글씨로, 센티초는 작고 흐리게 (흔들리는 숫자는 시선을 뺏기만 한다).
            TimelineView(.animation(minimumInterval: 0.03, paused: workout.phase != .active)) { ctx in
                let t = splitElapsed(workout.displayElapsed(at: ctx.date))
                HStack(alignment: .firstTextBaseline, spacing: 1) {
                    Text(t.main)
                        .font(runFont(72))
                        .monospacedDigit()
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                        .foregroundStyle(.yellow)
                    if let cs = t.centi {
                        Text(cs)
                            .font(runFont(30))
                            .monospacedDigit()
                            .foregroundStyle(.yellow.opacity(0.55))
                    }
                }
            }

            // 거리
            bigMetric(String(format: "%.2f", workout.distanceMeters / 1000), unit: "km", color: emerald, size: 70)

            // 페이스 — 직전 KM 우선. v21: 라벨 1줄.
            // "/km" 은 페이스 표기(4'42") 자체가 이미 말하는 정보라 뺐다 (워치는 km 고정).
            bigMetric(formatPace(workout.lastSplitPaceSecPerKm ?? workout.paceSecPerKm),
                      unit: workout.lastSplitPaceSecPerKm != nil ? "직전KM" : "평균",
                      color: .white, size: 62)

            // 심박 — v21 (2026-08-12, hans): 라벨은 한 줄 한 토큰.
            // 큰 숫자는 고정 코랄(존마다 색이 바뀌면 노란 타이머와 부딪힌다),
            // 존은 라벨 자리에서 색과 글자로 한 번만 말한다. 존을 모르는 동안만 "bpm".
            bigMetric(workout.heartRate > 0 ? String(format: "%.0f", workout.heartRate) : "--",
                      unit: workout.currentZone > 0 ? "영역 \(workout.currentZone)" : "bpm",
                      color: HRZone.ink, size: 62,
                      unitColor: workout.currentZone > 0
                          ? HRZone.color(workout.currentZone) : nil)

            if workout.phase == .paused {
                Text(workout.isAutoPaused ? "자동 일시정지 — 움직이면 이어서" : "일시정지됨")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(.orange)
                    .minimumScaleFactor(0.8)
                    .lineLimit(1)
            } else if let progress = workout.goalProgress {
                // v9: 목표 설정 시 — 목표 진행 바 (달성률 %)
                HStack(spacing: 6) {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.white.opacity(0.14))
                            Capsule().fill(emerald)
                                .frame(width: max(4, geo.size.width * CGFloat(progress)))
                        }
                    }
                    .frame(height: 8)
                    Text("\(Int(progress * 100))%")
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(progress >= 1 ? emerald : .secondary)
                }
                .padding(.top, 4)
            } else {
                // v5: 거리 잔디 게이지 — 1km 마다 한 칸씩 자람
                DistanceGrassGauge(distanceMeters: workout.distanceMeters)
                    .padding(.top, 3)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(.leading, 10)
        .padding(.trailing, 4)
    }

    /// 큰 숫자 + 오른쪽 한 줄 라벨 — v21 부터 거리·페이스·심박이 전부 이 한 가지 폼을 쓴다.
    /// unitColor 를 주면 라벨만 그 색으로 (심박 존).
    private func bigMetric(_ value: String, unit: String, color: Color, size: CGFloat,
                           unitColor: Color? = nil) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(value)
                .font(runFont(size))
                .monospacedDigit()
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .foregroundStyle(color)
            Text(unit)
                .font(.system(size: 17, weight: .bold, design: .rounded))
                .lineLimit(1)
                .fixedSize()          // 라벨은 온전히, 줄어드는 건 숫자 쪽
                .foregroundStyle(unitColor ?? .secondary)
        }
    }
}

// ── 심박 그래프 페이지 ──────────────────────────────────────────

struct HeartRateView: View {
    @EnvironmentObject var workout: WorkoutManager

    private var avgHr: Double {
        workout.hrSamples.isEmpty ? 0 : workout.hrSamples.reduce(0, +) / Double(workout.hrSamples.count)
    }

    /// 2026-08-12 fix: "최대" 자리에 workout.maxHeartRate (= 220-나이 추정 최대심박) 를 찍고 있었다.
    /// 평균 옆의 최대는 "이번 러닝에서 가장 높았던 심박" 이어야 한다.
    private var peakHr: Double { workout.hrSamples.max() ?? 0 }

    var body: some View {
        // v21 (2026-08-12, hans "하트랑 영역 표시가 2중이라 복잡"):
        // 하트 아이콘은 장식일 뿐이라 삭제, 존은 **한 번만** 말한다 —
        // 숫자 옆 라벨은 단위(bpm) 만, 존은 아래 세그먼트 바 + 그 옆 라벨이 한 덩어리로.
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center, spacing: 6) {
                Text(workout.heartRate > 0 ? String(format: "%.0f", workout.heartRate) : "--")
                    .font(.system(size: 56, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .foregroundStyle(HRZone.ink)
                Text("bpm")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }

            // 존 = 바 + 라벨 한 줄. 현재 존이 크고 밝게.
            HStack(spacing: 6) {
                HStack(spacing: 3) {
                    ForEach(1...5, id: \.self) { z in
                        RoundedRectangle(cornerRadius: 3)
                            .fill(HRZone.colors[z - 1].opacity(z == workout.currentZone ? 1.0 : 0.24))
                            .frame(height: z == workout.currentZone ? 10 : 6)
                    }
                }
                Text(workout.currentZone > 0 ? "영역 \(workout.currentZone)" : "측정 중")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .lineLimit(1)
                    .fixedSize()
                    .foregroundStyle(workout.currentZone > 0
                                     ? HRZone.color(workout.currentZone) : .secondary)
            }

            HeartSparkline(samples: workout.hrSamples)
                .frame(height: 52)

            if avgHr > 0 {
                Text(String(format: "평균 %.0f · 최대 %.0f bpm", avgHr, peakHr))
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
            } else {
                Text("심박 측정 중…")
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(.leading, 10)
        .padding(.trailing, 6)
    }
}

/// 심박 스파크라인 — 빨간 라인 + 그라데이션 필
struct HeartSparkline: View {
    let samples: [Double]

    var body: some View {
        Canvas { ctx, size in
            guard samples.count >= 2 else { return }
            let minV = (samples.min() ?? 60) - 5
            let maxV = (samples.max() ?? 180) + 5
            let range = max(1, maxV - minV)
            let stepX = size.width / CGFloat(samples.count - 1)

            func point(_ i: Int) -> CGPoint {
                CGPoint(x: CGFloat(i) * stepX,
                        y: size.height * (1 - CGFloat((samples[i] - minV) / range)))
            }

            var line = Path()
            line.move(to: point(0))
            for i in 1..<samples.count { line.addLine(to: point(i)) }

            // 그라데이션 필 (라인 아래)
            var fill = line
            fill.addLine(to: CGPoint(x: size.width, y: size.height))
            fill.addLine(to: CGPoint(x: 0, y: size.height))
            fill.closeSubpath()
            ctx.fill(fill, with: .linearGradient(
                Gradient(colors: [HRZone.ink.opacity(0.32), HRZone.ink.opacity(0.02)]),
                startPoint: .zero, endPoint: CGPoint(x: 0, y: size.height)))

            ctx.stroke(line, with: .color(HRZone.ink), style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))

            // 현재 값 점
            let last = point(samples.count - 1)
            ctx.fill(Path(ellipseIn: CGRect(x: last.x - 3.5, y: last.y - 3.5, width: 7, height: 7)), with: .color(.white))
        }
    }
}

// ── 컨트롤 페이지 (Apple 운동앱 그리드) ─────────────────────────

struct ControlsView: View {
    @EnvironmentObject var workout: WorkoutManager

    private let emerald = Color(red: 0.20, green: 0.83, blue: 0.60)

    var body: some View {
        // 2026-08-02 hans: 부드러운 러닝 언어 — 종료(빨강 X) 는 부정 신호라
        // "완주" (에메랄드 + 체커기) 로, 일시정지/재개는 "잠시 쉼" / "다시 달리기" 로.
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                VStack(spacing: 5) {
                    Button {
                        workout.endWorkout()
                    } label: {
                        Image(systemName: "flag.checkered")
                            .font(.system(size: 24, weight: .heavy))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 18)
                    }
                    .buttonStyle(.borderedProminent)
                    // 2026-08-03 hans: 배경이 너무 밝다 — 딥 에메랄드로 톤 다운 (아이콘 흰색 대비 유지)
                    .tint(Color(red: 0.09, green: 0.45, blue: 0.33))
                    Text("완주")
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                }
                VStack(spacing: 5) {
                    Button {
                        workout.togglePause()
                    } label: {
                        Image(systemName: workout.phase == .paused ? "figure.run" : "pause.fill")
                            .font(.system(size: 24, weight: .heavy))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 18)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.yellow.opacity(0.9))
                    Text(workout.phase == .paused ? "다시 달리기" : "잠시 쉼")
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .minimumScaleFactor(0.8)
                        .lineLimit(1)
                }
            }
            // 화면 잠금 (물·소매 오터치 방지) — Apple 운동앱의 물잠금 문법
            Button {
                WKInterfaceDevice.current().enableWaterLock()
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "drop.fill")
                        .font(.system(size: 15, weight: .bold))
                    Text("화면 잠금")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
            }
            .buttonStyle(.bordered)
            .tint(.cyan)
        }
        .padding(.horizontal, 4)
    }
}

// ── 포맷터 ─────────────────────────────────────────────────────

/// v22 (2026-08-13, hans "글씨가 통통해서 달리면서 식별이 안 된다"):
/// 러닝 지표 전용 폰트 = **둥근 서체 유지 + compressed 폭**.
/// 둥근 heavy 는 귀엽지만 자간이 넓어 화면 폭(46mm = 208pt)을 금방 넘고, 그러면
/// minimumScaleFactor 가 통째로 축소해 실제 렌더 크기가 오히려 작아졌다.
/// compressed 는 글자를 ~25% 좁게 그려서 같은 폭에 더 큰 글씨를 담는다 —
/// 애플 운동앱이 초대형 숫자를 넣는 방식과 같다. 귀여움은 그대로, 크기만 커진다.
func runFont(_ size: CGFloat) -> Font {
    .system(size: size, weight: .heavy, design: .rounded).width(.compressed)
}

/// "MM:SS" + ".CC" 분리 — 센티초를 따로 작게 그리기 위해. 1시간 넘으면 센티초 없음.
func splitElapsed(_ seconds: TimeInterval) -> (main: String, centi: String?) {
    let cs = max(0, Int((seconds * 100).rounded()))
    let totalS = cs / 100
    if totalS >= 3600 {
        return (String(format: "%d:%02d:%02d", totalS / 3600, (totalS % 3600) / 60, totalS % 60), nil)
    }
    return (String(format: "%02d:%02d", totalS / 60, totalS % 60), String(format: ".%02d", cs % 100))
}

func formatElapsed(_ seconds: TimeInterval) -> String {
    let total = Int(seconds)
    let h = total / 3600, m = (total % 3600) / 60, s = total % 60
    return h > 0
        ? String(format: "%d:%02d:%02d", h, m, s)
        : String(format: "%02d:%02d", m, s)
}

/// v6: 0.01초 단위 (Apple 운동앱 동일). 1시간 넘으면 센티 생략 (H:MM:SS).
func formatElapsedCenti(_ seconds: TimeInterval) -> String {
    let cs = max(0, Int((seconds * 100).rounded()))
    let totalS = cs / 100
    if totalS >= 3600 {
        return String(format: "%d:%02d:%02d", totalS / 3600, (totalS % 3600) / 60, totalS % 60)
    }
    return String(format: "%02d:%02d.%02d", totalS / 60, totalS % 60, cs % 100)
}

func formatPace(_ secPerKm: Double?) -> String {
    guard let p = secPerKm, p.isFinite, p > 0 else { return "--'--\"" }
    let total = Int(p.rounded())
    return String(format: "%d'%02d\"", total / 60, total % 60)
}
