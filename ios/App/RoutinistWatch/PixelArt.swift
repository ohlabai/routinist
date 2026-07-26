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
