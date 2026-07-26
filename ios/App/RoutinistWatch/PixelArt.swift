// 잔디 픽셀 아트 — 웹 AppLogo.tsx 의 7×5 "R" 그리드와 동일 데이터/컬러.
// (2026-07-26 hans: 로고·아이콘을 루티니스트 잔디 컨셉으로)

import SwiftUI

enum GrassPalette {
    static let light = Color(red: 0.29, green: 0.87, blue: 0.50)   // #4ade80
    static let mid = Color(red: 0.13, green: 0.77, blue: 0.37)     // #22c55e
    static let dark = Color(red: 0.09, green: 0.64, blue: 0.29)    // #16a34a
    static let bg = Color(red: 0.06, green: 0.09, blue: 0.16)      // #0f1729

    static func color(_ v: Int) -> Color? {
        switch v {
        case 1: return light
        case 2: return mid
        case 3: return dark
        default: return nil
        }
    }
}

/// 웹 AppLogo 와 동일한 7×5 잔디 "R"
let GRASS_R_GRID: [[Int]] = [
    [-1,  1,  2,  2,  3, -1, -1],
    [-1,  2, -1, -1, -1,  1, -1],
    [-1,  2,  2,  2,  1, -1, -1],
    [-1,  2, -1,  3, -1, -1, -1],
    [-1,  1, -1, -1,  2, -1, -1],
]

/// 잔디 픽셀 러너 (8×8) — 달리는 사람 실루엣
let GRASS_RUNNER_GRID: [[Int]] = [
    [-1, -1, -1, -1,  1,  1, -1, -1],
    [-1, -1, -1, -1,  1,  1, -1, -1],
    [-1, -1,  2, -1,  2,  2, -1, -1],
    [-1, -1, -1,  2,  2,  2,  2, -1],
    [-1, -1, -1,  2,  2, -1, -1, -1],
    [-1, -1, -1,  3, -1,  3, -1, -1],
    [-1, -1,  3, -1, -1, -1,  3, -1],
    [-1,  3,  3, -1, -1, -1,  3,  3],
]

/// 픽셀 그리드 렌더러 — 셀 크기 자동 계산, 라운드 블록
struct PixelGridView: View {
    let grid: [[Int]]
    var cellCorner: CGFloat = 0.22

    var body: some View {
        GeometryReader { geo in
            let rows = grid.count
            let cols = grid.first?.count ?? 1
            let gap = geo.size.width * 0.02
            let cellW = (geo.size.width - gap * CGFloat(cols - 1)) / CGFloat(cols)
            let cellH = (geo.size.height - gap * CGFloat(rows - 1)) / CGFloat(rows)
            let cell = min(cellW, cellH)
            let gridW = cell * CGFloat(cols) + gap * CGFloat(cols - 1)
            let gridH = cell * CGFloat(rows) + gap * CGFloat(rows - 1)
            let ox = (geo.size.width - gridW) / 2
            let oy = (geo.size.height - gridH) / 2

            ZStack(alignment: .topLeading) {
                ForEach(0..<rows, id: \.self) { y in
                    ForEach(0..<cols, id: \.self) { x in
                        if let c = GrassPalette.color(grid[y][x]) {
                            RoundedRectangle(cornerRadius: cell * cellCorner)
                                .fill(c)
                                .frame(width: cell, height: cell)
                                .offset(x: ox + CGFloat(x) * (cell + gap),
                                        y: oy + CGFloat(y) * (cell + gap))
                        }
                    }
                }
            }
        }
    }
}

/// 웹과 동일한 로고 칩 — 다크 네이비 라운드 카드 위 잔디 R
struct GrassLogoChip: View {
    var size: CGFloat = 40

    var body: some View {
        PixelGridView(grid: GRASS_R_GRID)
            .padding(size * 0.14)
            .frame(width: size, height: size)
            .background(RoundedRectangle(cornerRadius: size * 0.22).fill(GrassPalette.bg))
    }
}

// ── 달리는 잔디 애니메이션 (2026-07-26 hans: "잔디들이 달리는 것처럼") ──
// 잔디 블록 물결이 오른쪽으로 달려가고, 블록이 페이즈에 따라 나타났다 사라진다.
// GIF 없이 TimelineView 로 프레임 구동 — 배터리 부담 최소 (0.28s 간격).

struct RunningGrassView: View {
    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.28)) { context in
            GrassWaveFrame(tick: Int(context.date.timeIntervalSinceReferenceDate / 0.28))
        }
    }
}

// ── 완주 잔디 컨페티 (v8 리파인 — hans: "더 자연스럽고 세련되게") ──
// v5 문제: 큰 블록 22개가 같은 속도로 직하 + 과한 회전 → 뻣뻣하고 blocky.
// v8: 입자 작게 (3~7pt) · 좌우로 흩날리는 드리프트 · 속도/시차 다양화 (1.8~2.7s)
//     · 은은한 회전 (±40°) · 짧은 페이드인 — 눈꽃처럼 가볍게 내려앉는 느낌.

struct GrassConfettiView: View {
    @State private var fall = false
    private let count = 30

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                ForEach(0..<count, id: \.self) { i in
                    ConfettiParticle(i: i, fall: fall, canvas: geo.size)
                }
            }
        }
        .allowsHitTesting(false)
        .clipped()
        .onAppear { fall = true }
    }
}

private struct ConfettiParticle: View {
    let i: Int
    let fall: Bool
    let canvas: CGSize

    var body: some View {
        // 인덱스 기반 결정적 파라미터 (스크린샷 재현 가능)
        let fx = CGFloat((i * 37 + 11) % 100) / 100.0
        let drift = CGFloat(((i * 53 + 7) % 61) - 30)              // 좌우 -30~+30pt 흩날림
        let s: CGFloat = 3 + CGFloat((i * 29) % 5)                 // 3~7pt (작고 가볍게)
        let dur = 1.8 + Double((i * 17) % 90) / 100.0              // 1.8~2.7s (제각각)
        let delay = Double((i * 41) % 130) / 100.0                 // 0~1.3s 시차
        let rot = Double(((i * 23) % 81) - 40)                     // ±40° 은은한 회전
        let startY = -CGFloat((i * 13) % 40) - 8                   // 시작 높이도 분산
        let color: Color = i % 3 == 0 ? GrassPalette.light : i % 3 == 1 ? GrassPalette.mid : GrassPalette.dark

        RoundedRectangle(cornerRadius: s * 0.3)
            .fill(color)
            .frame(width: s, height: s)
            .rotationEffect(.degrees(fall ? rot : 0))
            .position(x: fx * canvas.width + (fall ? drift : 0),
                      y: fall ? canvas.height + 12 : startY)
            // 낙하·드리프트·회전 — 부드러운 가속 커브
            .animation(.timingCurve(0.25, 0.1, 0.6, 1.0, duration: dur).delay(delay), value: fall)
            .opacity(fall ? 0.92 : 0)
            // 페이드인은 짧게 별도 — 팟 하고 나타나지 않게
            .animation(.easeIn(duration: 0.35).delay(delay), value: fall)
    }
}

// ── 거리 잔디 게이지 (v5) — 1km 마다 잔디 한 칸이 자란다 ──

struct DistanceGrassGauge: View {
    let distanceMeters: Double

    var body: some View {
        let km = distanceMeters / 1000
        let full = Int(km)
        let frac = km - Double(full)
        // 최소 5칸 보이고, 달릴수록 늘어남 (14칸 넘으면 최근 14칸 유지)
        let slots = min(14, max(5, full + 2))
        let offset = max(0, full + 2 - 14)   // 14칸 초과 시 왼쪽부터 밀림
        HStack(alignment: .bottom, spacing: 3) {
            ForEach(0..<slots, id: \.self) { i in
                let kmIndex = i + offset
                let h: CGFloat = kmIndex < full ? 12 : (kmIndex == full ? max(3, 12 * CGFloat(frac)) : 3)
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(kmIndex < full ? GrassPalette.light
                          : kmIndex == full ? GrassPalette.mid
                          : GrassPalette.dark.opacity(0.45))
                    .frame(width: 8, height: h)
                    .animation(.easeOut(duration: 0.4), value: full)
            }
        }
        .frame(height: 12, alignment: .bottom)
    }
}

struct GrassWaveFrame: View {
    let tick: Int
    private let cols = 13
    private let rows = 4

    var body: some View {
        GeometryReader { geo in
            let gap = geo.size.width * 0.014
            let cell = min(
                (geo.size.width - gap * CGFloat(cols - 1)) / CGFloat(cols),
                (geo.size.height - gap * CGFloat(rows - 1)) / CGFloat(rows)
            )
            let gridW = cell * CGFloat(cols) + gap * CGFloat(cols - 1)
            let ox = (geo.size.width - gridW) / 2
            let baseY = geo.size.height - cell

            ZStack(alignment: .topLeading) {
                ForEach(0..<cols, id: \.self) { col in
                    // 물결: 오른쪽으로 달리는 sine 파 — 열마다 잔디 높이 1~4
                    let phase = Double(col) * 0.75 - Double(tick) * 0.9
                    let h = 1 + Int((sin(phase) + 1.0) * 1.7)   // 1~4
                    // 가끔 잔디가 사라졌다 나타남 (열·tick 기반 결정적 패턴)
                    let hidden = (col * 7 + tick * 3) % 17 == 0
                    if !hidden {
                        ForEach(0..<h, id: \.self) { level in
                            RoundedRectangle(cornerRadius: cell * 0.24)
                                .fill(level == h - 1 ? GrassPalette.light
                                      : level >= h - 2 ? GrassPalette.mid : GrassPalette.dark)
                                .frame(width: cell, height: cell)
                                .offset(x: ox + CGFloat(col) * (cell + gap),
                                        y: baseY - CGFloat(level) * (cell + gap))
                        }
                    }
                }
            }
            .animation(.easeInOut(duration: 0.22), value: tick)
        }
    }
}
