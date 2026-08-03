// 잔디 픽셀 퍼레이드 (v16) — 시작 버튼의 잔디 물결을 대체.
// 남자→여자→강아지→치타→코끼리→닭→원숭이→기린→거북이→고양이→토끼→소→용→말이
// 차례로 화면을 가로질러 달린다 (2026-07-29 hans: "마인크래프트처럼 잔디 블록으로").
// 동물마다 속도·보폭 성격: 치타는 전력질주, 거북이는 느릿느릿, 토끼는 깡충(바운스),
// 용은 공중 부양. GrassPalette 2톤+다크로 실루엣 구분.
// 스프라이트 원본/코드젠: scratchpad parade_design.py (터미널 블록아트로 검증).

import SwiftUI

struct ParadeRunner {
    let name: String
    /// 틱(0.12s)당 이동 셀 수 — 동물의 달리기 성격
    let stepCells: Double
    /// 다리 프레임(A/B) 교체 주기 (틱)
    let legEvery: Int
    /// 1 = 수직 통통 (토끼 깡충, 용 부양)
    let bounce: Int
    let frames: [[[Int]]]

    var width: Int { frames[0].first?.count ?? 1 }
    var height: Int { frames[0].count }
}

struct GrassParadeView: View {
    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.12)) { context in
            ParadeFrame(tick: Int(context.date.timeIntervalSinceReferenceDate / 0.12))
        }
    }
}

/// 퍼레이드 장면 멤버: 러너 이름 + 입장 지연(틱) + 속도(틱당 셀)
private struct SceneEntry {
    let name: String
    let delay: Double
    let speed: Double
}

/// 2026-08-03 (hans "초반에 너무 겹친다"): 자유 순환 트랙은 속도가 다른 14마리가
/// 랜덤 시점에 뭉치는 걸 막을 수 없다 → **연출된 장면 6개를 순환**하는 방식으로 재설계.
/// 추월 장면은 느린 동물이 먼저 입장하고 빠른 동물이 화면 한가운데(x≈26셀)에서
/// 정확히 따라잡게 지연·속도를 계산해 뒀다. 대열 장면은 같은 템포 동물들이
/// 일정 간격으로 나란히 달린다. 겹침은 추월 순간뿐 — 항상 조화롭게 보인다.
/// 속도 = stepCells × 0.55 (동물 성격 유지).
private let PARADE_SCENES: [[SceneEntry]] = [
    // ① 거북이를 토끼가 깡충깡충 추월 (hans 예시 그대로)
    [SceneEntry(name: "turtle", delay: 2, speed: 0.50),
     SceneEntry(name: "rabbit", delay: 30, speed: 1.21)],
    // ② 남자·여자·강아지 조깅 대열
    [SceneEntry(name: "man", delay: 0, speed: 0.88),
     SceneEntry(name: "woman", delay: 13, speed: 0.88),
     SceneEntry(name: "dog", delay: 26, speed: 0.95)],
    // ③ 코끼리를 치타가 전력질주로 추월
    [SceneEntry(name: "elephant", delay: 0, speed: 0.53),
     SceneEntry(name: "cheetah", delay: 38, speed: 1.87)],
    // ④ 닭·고양이·원숭이 — 살짝씩 좁혀지는 경쾌한 행렬
    [SceneEntry(name: "chicken", delay: 0, speed: 0.77),
     SceneEntry(name: "cat", delay: 14, speed: 0.94),
     SceneEntry(name: "monkey", delay: 27, speed: 0.99)],
    // ⑤ 소를 말이 힘차게 추월
    [SceneEntry(name: "cow", delay: 4, speed: 0.55),
     SceneEntry(name: "horse", delay: 35, speed: 1.43)],
    // ⑥ 기린과 용 — 느긋한 마무리 (용은 부양)
    [SceneEntry(name: "giraffe", delay: 2, speed: 0.72),
     SceneEntry(name: "dragon", delay: 20, speed: 0.83)],
]

struct ParadeFrame: View {
    let tick: Int
    /// 기린(10행) 기준 셀 크기 — 작은 동물은 바닥 정렬로 자연히 작아짐
    private let maxRows = 10

    /// 장면 길이를 화면 폭에서 동적 계산 — 마지막 멤버가 오른쪽으로 빠져나가기
    /// 직전(-10틱)에 다음 장면 첫 멤버가 왼쪽에서 들어온다 (2026-08-03 hans
    /// "대기 시간이 너무 길어" → 빈 화면 없이 자연스럽게 이어지는 행렬).
    private func sceneDurations(cols: Int) -> [Int] {
        PARADE_SCENES.map { scene in
            let exitTick = scene.map { e -> Double in
                let w = PARADE_RUNNERS.first(where: { $0.name == e.name })?.width ?? 12
                return e.delay + (Double(cols) + Double(w)) / e.speed
            }.max() ?? 60
            return max(40, Int(exitTick.rounded(.up)) - 10)
        }
    }

    /// 전체 순환에서 현재 장면 index 와 장면 내 시각
    private func scenePosition(cols: Int) -> (index: Int, t: Double) {
        let durs = sceneDurations(cols: cols)
        let total = max(1, durs.reduce(0, +))
        var m = tick % total
        for (i, d) in durs.enumerated() {
            if m < d { return (i, Double(m)) }
            m -= d
        }
        return (0, 0)
    }

    var body: some View {
        GeometryReader { geo in
            let cell = geo.size.height / CGFloat(maxRows)
            let cols = max(8, Int(geo.size.width / cell))
            let durs = sceneDurations(cols: cols)
            let pos = scenePosition(cols: cols)
            let prevIdx = (pos.index + PARADE_SCENES.count - 1) % PARADE_SCENES.count
            // 이음새: 이전 장면의 아직 안 빠져나간 멤버(오른쪽 끝)도 같이 그린다
            let layers: [(entries: [SceneEntry], t: Double)] = [
                (PARADE_SCENES[prevIdx], pos.t + Double(durs[prevIdx])),
                (PARADE_SCENES[pos.index], pos.t),
            ]

            ZStack(alignment: .topLeading) {
                // 바닥 잔디 라인 — 러너들이 밟고 달리는 지면
                HStack(spacing: cell * 0.5) {
                    ForEach(0..<cols, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: cell * 0.2)
                            .fill(GrassPalette.dark.opacity(0.45))
                            .frame(width: cell * 0.9, height: cell * 0.4)
                    }
                }
                .frame(maxWidth: .infinity)
                .offset(y: geo.size.height - cell * 0.4)

                ForEach(0..<layers.count, id: \.self) { li in
                    let layer = layers[li]
                    ForEach(0..<layer.entries.count, id: \.self) { i in
                        let e = layer.entries[i]
                        if let r = PARADE_RUNNERS.first(where: { $0.name == e.name }) {
                            let xCells = (layer.t - e.delay) * e.speed - Double(r.width)
                            if xCells > -Double(r.width) && xCells < Double(cols) {
                                let frameIdx = (tick / max(1, r.legEvery)) % 2
                                let hop = r.bounce == 1 && frameIdx == 0 ? -cell * 0.9 : 0
                                SpriteView(grid: r.frames[frameIdx], cell: cell)
                                    .offset(x: CGFloat(xCells) * cell,
                                            y: geo.size.height - CGFloat(r.height) * cell - cell * 0.4 + hop)
                                    // 셀 단위 점프를 부드럽게 — 픽셀 마퀴 특유의 리듬은 유지
                                    .animation(.linear(duration: 0.12), value: tick)
                                    // 빠른 동물이 앞을 지나가게 — 추월 장면의 앞뒤 관계
                                    .zIndex(e.speed)
                            }
                        }
                    }
                }
            }
        }
        .clipped()
    }
}

/// 고정 셀 크기 스프라이트 렌더러 (PixelGridView 는 자동 맞춤이라 퍼레이드엔 부적합)
private struct SpriteView: View {
    let grid: [[Int]]
    let cell: CGFloat

    var body: some View {
        let rows = grid.count
        let cols = grid.first?.count ?? 1
        ZStack(alignment: .topLeading) {
            ForEach(0..<rows, id: \.self) { y in
                ForEach(0..<cols, id: \.self) { x in
                    if let c = GrassPalette.color(grid[y][x]) {
                        RoundedRectangle(cornerRadius: cell * 0.22)
                            .fill(c)
                            .frame(width: cell * 0.92, height: cell * 0.92)
                            .offset(x: CGFloat(x) * cell, y: CGFloat(y) * cell)
                    }
                }
            }
        }
        .frame(width: CGFloat(cols) * cell, height: CGFloat(rows) * cell, alignment: .topLeading)
    }
}

/// 퍼레이드 스프라이트 정의 — parade_design.py 코드젠 산출물
let PARADE_RUNNERS: [ParadeRunner] = [
    ParadeRunner(name: "man", stepCells: 1.6, legEvery: 2, bounce: 0, frames: [
    [
        [-1, -1, -1, -1, 1, 1, -1, -1],
        [-1, -1, -1, -1, 1, 1, -1, -1],
        [-1, -1, 2, 2, 2, 2, 2, -1],
        [-1, 2, -1, -1, 2, 2, -1, -1],
        [-1, -1, -1, -1, 2, 2, -1, -1],
        [-1, -1, -1, 3, -1, 3, -1, -1],
        [-1, -1, 3, -1, -1, -1, 3, -1],
        [-1, 3, 3, -1, -1, -1, 3, 3],
    ],
    [
        [-1, -1, -1, -1, 1, 1, -1, -1],
        [-1, -1, -1, -1, 1, 1, -1, -1],
        [-1, -1, 2, 2, 2, 2, 2, -1],
        [-1, 2, -1, -1, 2, 2, -1, -1],
        [-1, -1, -1, -1, 2, 2, -1, -1],
        [-1, -1, -1, 3, 3, -1, -1, -1],
        [-1, -1, -1, 3, -1, 3, -1, -1],
        [-1, -1, 3, 3, -1, -1, 3, -1],
    ],
    ]),
    ParadeRunner(name: "woman", stepCells: 1.6, legEvery: 2, bounce: 0, frames: [
    [
        [-1, -1, 1, -1, 1, 1, -1, -1],
        [-1, 1, 1, -1, 1, 1, -1, -1],
        [-1, -1, 2, 2, 2, 2, 2, -1],
        [-1, 2, -1, -1, 2, 2, -1, -1],
        [-1, -1, -1, -1, 2, 2, -1, -1],
        [-1, -1, -1, 3, -1, 3, -1, -1],
        [-1, -1, 3, -1, -1, -1, 3, -1],
        [-1, 3, 3, -1, -1, -1, 3, 3],
    ],
    [
        [-1, 1, -1, -1, 1, 1, -1, -1],
        [-1, -1, 1, 1, 1, 1, -1, -1],
        [-1, -1, 2, 2, 2, 2, 2, -1],
        [-1, 2, -1, -1, 2, 2, -1, -1],
        [-1, -1, -1, -1, 2, 2, -1, -1],
        [-1, -1, -1, 3, 3, -1, -1, -1],
        [-1, -1, -1, 3, -1, 3, -1, -1],
        [-1, -1, 3, 3, -1, -1, 3, -1],
    ],
    ]),
    ParadeRunner(name: "dog", stepCells: 2.0, legEvery: 1, bounce: 0, frames: [
    [
        [-1, 3, -1, -1, -1, -1, -1, -1, -1, -1, 1, -1],
        [-1, -1, 3, -1, -1, -1, -1, 2, 2, 2, 1, 1],
        [-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, -1],
        [-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1],
        [-1, -1, 3, -1, -1, -1, -1, 3, -1, -1, -1, -1],
        [-1, -1, 3, -1, -1, -1, -1, -1, 3, -1, -1, -1],
    ],
    [
        [-1, -1, 3, -1, -1, -1, -1, -1, -1, -1, 1, -1],
        [-1, 3, -1, -1, -1, -1, -1, 2, 2, 2, 1, 1],
        [-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, -1],
        [-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1],
        [-1, -1, -1, 3, 3, -1, -1, 3, 3, -1, -1, -1],
        [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
    ],
    ]),
    ParadeRunner(name: "cheetah", stepCells: 3.4, legEvery: 1, bounce: 0, frames: [
    [
        [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, -1],
        [3, 3, 3, 3, -1, 2, 2, 2, 2, 2, 2, 1, 1, -1],
        [-1, -1, -1, -1, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1],
        [-1, -1, 3, -1, -1, -1, -1, -1, -1, -1, 3, -1, -1, -1],
        [-1, 3, -1, -1, -1, -1, -1, -1, -1, -1, -1, 3, -1, -1],
    ],
    [
        [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, -1],
        [3, 3, 3, 3, -1, 2, 2, 2, 2, 2, 2, 1, 1, -1],
        [-1, -1, -1, -1, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1],
        [-1, -1, -1, -1, -1, 3, 3, -1, 3, 3, -1, -1, -1, -1],
        [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
    ],
    ]),
    ParadeRunner(name: "elephant", stepCells: 0.9, legEvery: 3, bounce: 0, frames: [
    [
        [-1, -1, -1, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1],
        [-1, -1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1],
        [-1, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 1, -1],
        [-1, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 1, -1],
        [-1, -1, 2, 2, 2, 2, 2, 2, 2, 2, -1, 2, 1, -1],
        [-1, -1, 3, 3, -1, -1, 3, 3, -1, -1, -1, 1, -1, -1],
        [-1, -1, 3, 3, -1, -1, 3, 3, -1, -1, -1, 1, -1, -1],
    ],
    [
        [-1, -1, -1, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1],
        [-1, -1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1],
        [-1, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 1, -1],
        [-1, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 1, -1],
        [-1, -1, 2, 2, 2, 2, 2, 2, 2, 2, -1, 2, 1, -1],
        [-1, 3, 3, -1, -1, -1, -1, 3, 3, -1, -1, 1, -1, -1],
        [-1, 3, 3, -1, -1, -1, -1, 3, 3, -1, -1, -1, -1, -1],
    ],
    ]),
    ParadeRunner(name: "chicken", stepCells: 1.4, legEvery: 1, bounce: 0, frames: [
    [
        [-1, -1, -1, -1, -1, 1, -1, -1],
        [-1, -1, -1, -1, 2, 2, 2, -1],
        [-1, -1, 2, 2, 2, 2, 1, -1],
        [-1, 2, 2, 2, 2, 2, 2, -1],
        [-1, 2, 2, 2, 2, 2, -1, -1],
        [-1, -1, -1, 3, -1, -1, -1, -1],
        [-1, -1, -1, 3, 3, -1, -1, -1],
    ],
    [
        [-1, -1, -1, -1, -1, 1, -1, -1],
        [-1, -1, -1, -1, 2, 2, 2, -1],
        [-1, -1, 2, 2, 2, 2, 1, -1],
        [-1, 2, 2, 2, 2, 2, 2, -1],
        [-1, 2, 2, 2, 2, 2, -1, -1],
        [-1, -1, -1, -1, 3, -1, -1, -1],
        [-1, -1, -1, 3, -1, -1, -1, -1],
    ],
    ]),
    ParadeRunner(name: "monkey", stepCells: 1.8, legEvery: 2, bounce: 0, frames: [
    [
        [-1, 1, 1, -1, -1, -1, -1, -1],
        [-1, 1, -1, -1, -1, -1, -1, -1],
        [-1, 1, -1, -1, 2, 2, 2, -1],
        [-1, -1, 2, 2, 2, 2, 2, -1],
        [-1, -1, 2, 2, 2, 2, -1, -1],
        [-1, -1, 3, -1, 3, 2, -1, -1],
        [-1, 3, -1, -1, -1, -1, 3, -1],
    ],
    [
        [-1, 1, 1, -1, -1, -1, -1, -1],
        [-1, -1, 1, -1, -1, -1, -1, -1],
        [-1, 1, -1, -1, 2, 2, 2, -1],
        [-1, -1, 2, 2, 2, 2, 2, -1],
        [-1, -1, 2, 2, 2, 2, -1, -1],
        [-1, -1, 3, 3, -1, 2, -1, -1],
        [-1, -1, 3, -1, -1, 3, -1, -1],
    ],
    ]),
    ParadeRunner(name: "giraffe", stepCells: 1.3, legEvery: 3, bounce: 0, frames: [
    [
        [-1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, -1],
        [-1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, -1],
        [-1, -1, -1, -1, -1, -1, -1, -1, 2, 2, -1, -1],
        [-1, -1, -1, -1, -1, -1, -1, 2, 2, -1, -1, -1],
        [-1, -1, -1, -1, -1, -1, 2, 2, -1, -1, -1, -1],
        [-1, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1],
        [-1, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1, -1],
        [-1, -1, 3, -1, -1, -1, -1, 3, -1, -1, -1, -1],
        [-1, -1, 3, -1, -1, -1, -1, -1, 3, -1, -1, -1],
        [-1, 3, -1, -1, -1, -1, -1, -1, 3, -1, -1, -1],
    ],
    [
        [-1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, -1],
        [-1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, -1],
        [-1, -1, -1, -1, -1, -1, -1, -1, 2, 2, -1, -1],
        [-1, -1, -1, -1, -1, -1, -1, 2, 2, -1, -1, -1],
        [-1, -1, -1, -1, -1, -1, 2, 2, -1, -1, -1, -1],
        [-1, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1],
        [-1, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1, -1],
        [-1, -1, -1, 3, -1, -1, 3, -1, -1, -1, -1, -1],
        [-1, -1, -1, 3, -1, -1, -1, 3, -1, -1, -1, -1],
        [-1, -1, 3, -1, -1, -1, -1, 3, -1, -1, -1, -1],
    ],
    ]),
    ParadeRunner(name: "turtle", stepCells: 0.9, legEvery: 4, bounce: 0, frames: [
    [
        [-1, -1, -1, 2, 2, 2, 2, -1, -1, -1, -1],
        [-1, -1, 2, 2, 2, 2, 2, 2, -1, -1, -1],
        [-1, 2, 2, 2, 2, 2, 2, 2, 2, -1, 1],
        [-1, -1, 3, -1, -1, -1, -1, 3, -1, 1, 1],
        [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
    ],
    [
        [-1, -1, -1, 2, 2, 2, 2, -1, -1, -1, -1],
        [-1, -1, 2, 2, 2, 2, 2, 2, -1, -1, -1],
        [-1, 2, 2, 2, 2, 2, 2, 2, 2, -1, 1],
        [-1, -1, -1, 3, -1, -1, 3, -1, -1, 1, 1],
        [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
    ],
    ]),
    ParadeRunner(name: "cat", stepCells: 1.7, legEvery: 2, bounce: 0, frames: [
    [
        [-1, 3, -1, -1, -1, -1, -1, -1, 1, -1, 1],
        [-1, -1, 3, -1, -1, -1, -1, -1, 1, 1, 1],
        [-1, -1, 2, 2, 2, 2, 2, 2, 2, 1, 1],
        [-1, -1, 2, 2, 2, 2, 2, 2, 2, -1, -1],
        [-1, -1, 3, -1, -1, -1, -1, 3, -1, -1, -1],
        [-1, 3, -1, -1, -1, -1, -1, -1, 3, -1, -1],
    ],
    [
        [-1, -1, 3, -1, -1, -1, -1, -1, 1, -1, 1],
        [-1, 3, -1, -1, -1, -1, -1, -1, 1, 1, 1],
        [-1, -1, 2, 2, 2, 2, 2, 2, 2, 1, 1],
        [-1, -1, 2, 2, 2, 2, 2, 2, 2, -1, -1],
        [-1, -1, -1, 3, 3, -1, 3, 3, -1, -1, -1],
        [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
    ],
    ]),
    ParadeRunner(name: "rabbit", stepCells: 2.2, legEvery: 2, bounce: 1, frames: [
    [
        [-1, -1, -1, -1, -1, -1, 1, -1, 1, -1],
        [-1, -1, -1, -1, -1, -1, 1, -1, 1, -1],
        [-1, -1, -1, -1, -1, 2, 2, 2, 2, -1],
        [-1, 2, 2, 2, 2, 2, 2, 2, 2, -1],
        [-1, 2, 2, 2, 2, 2, 2, 2, -1, -1],
        [3, -1, -1, -1, -1, -1, -1, 3, -1, -1],
    ],
    [
        [-1, -1, -1, -1, -1, 1, -1, 1, -1, -1],
        [-1, -1, -1, -1, -1, 1, -1, 1, -1, -1],
        [-1, -1, -1, -1, 2, 2, 2, 2, -1, -1],
        [-1, -1, 2, 2, 2, 2, 2, 2, -1, -1],
        [-1, -1, 2, 2, 2, 2, 2, -1, -1, -1],
        [-1, -1, 3, 3, -1, 3, 3, -1, -1, -1],
    ],
    ]),
    ParadeRunner(name: "cow", stepCells: 1.0, legEvery: 3, bounce: 0, frames: [
    [
        [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1, -1, 1],
        [-1, 2, 2, 2, 2, 2, 2, 2, -1, 2, 2, 2, -1],
        [-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
        [-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1],
        [-1, -1, 3, 3, -1, -1, -1, -1, 3, 3, -1, -1, -1],
        [-1, -1, 3, 3, -1, -1, -1, -1, 3, 3, -1, -1, -1],
    ],
    [
        [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1, -1, 1],
        [-1, 2, 2, 2, 2, 2, 2, 2, -1, 2, 2, 2, -1],
        [-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
        [-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1],
        [-1, 3, 3, -1, -1, -1, -1, 3, 3, -1, -1, -1, -1],
        [-1, 3, 3, -1, -1, -1, -1, 3, 3, -1, -1, -1, -1],
    ],
    ]),
    ParadeRunner(name: "dragon", stepCells: 1.5, legEvery: 2, bounce: 1, frames: [
    [
        [-1, -1, -1, -1, -1, 2, 2, -1, -1, -1, -1, -1, 1, -1, 1],
        [-1, -1, -1, -1, 2, 2, 2, 2, -1, -1, -1, 1, 1, 1, -1],
        [2, 2, -1, -1, 2, 2, 2, 2, 2, 2, -1, 2, 1, 1, -1],
        [-1, 2, 2, 2, 2, -1, 2, 2, 2, 2, 2, 2, 2, -1, -1],
        [-1, -1, 2, 2, -1, -1, -1, -1, 2, 2, 2, -1, -1, -1, -1],
        [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
    ],
    [
        [-1, -1, -1, -1, 2, 2, -1, -1, -1, -1, -1, -1, 1, -1, 1],
        [-1, -1, -1, 2, 2, 2, 2, -1, -1, -1, -1, 1, 1, 1, -1],
        [2, 2, -1, -1, 2, 2, 2, 2, 2, 2, -1, 2, 1, 1, -1],
        [-1, 2, 2, 2, 2, -1, 2, 2, 2, 2, 2, 2, 2, -1, -1],
        [-1, 2, 2, -1, -1, -1, -1, -1, 2, 2, 2, -1, -1, -1, -1],
        [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
    ],
    ]),
    ParadeRunner(name: "horse", stepCells: 2.6, legEvery: 1, bounce: 0, frames: [
    [
        [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, -1, -1],
        [-1, 1, -1, -1, -1, -1, -1, -1, -1, 2, 1, 1, -1, -1],
        [-1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1],
        [-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1],
        [-1, -1, 3, -1, -1, -1, -1, -1, -1, 3, -1, -1, -1, -1],
        [-1, 3, -1, -1, -1, -1, -1, -1, -1, -1, 3, -1, -1, -1],
        [3, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 3, -1, -1],
    ],
    [
        [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, -1, -1],
        [-1, 1, -1, -1, -1, -1, -1, -1, -1, 2, 1, 1, -1, -1],
        [-1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1],
        [-1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1],
        [-1, -1, -1, 3, 3, -1, -1, -1, 3, 3, -1, -1, -1, -1],
        [-1, -1, -1, -1, 3, -1, -1, -1, 3, -1, -1, -1, -1, -1],
        [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
    ],
    ]),
]
// MARK: - 페이스 → 동물 매칭 (웹 src/lib/pace-animal.ts 와 동일 사다리 — 양쪽 동시 수정)

struct PaceAnimalMatch {
    let runner: ParadeRunner
    let copy: String
}

/// 평균 페이스(초/km)에 어울리는 동물 + 축하 카피. nil/0 은 거북이.
func paceAnimalMatch(paceSecPerKm: Double?) -> PaceAnimalMatch {
    func runner(_ name: String) -> ParadeRunner {
        PARADE_RUNNERS.first { $0.name == name } ?? PARADE_RUNNERS[0]
    }
    guard let pace = paceSecPerKm, pace > 0, pace.isFinite else {
        return PaceAnimalMatch(runner: runner("turtle"), copy: "거북이처럼 꾸준히 완주했어요!")
    }
    let ladder: [(Double, String, String)] = [
        (240, "cheetah", "치타처럼 질주했어요!"),
        (280, "horse", "말처럼 힘차게 달렸어요!"),
        (320, "dog", "강아지처럼 신나게 달렸어요!"),
        (360, "rabbit", "토끼처럼 가볍게 뛰었어요!"),
        (400, "cat", "고양이처럼 사뿐사뿐 달렸어요!"),
        (440, "monkey", "원숭이처럼 경쾌하게 달렸어요!"),
        (480, "chicken", "총총총, 닭처럼 부지런히 달렸어요!"),
        (540, "elephant", "코끼리처럼 묵직하게 완주했어요!"),
    ]
    for (maxPace, name, copy) in ladder where pace < maxPace {
        return PaceAnimalMatch(runner: runner(name), copy: copy)
    }
    return PaceAnimalMatch(runner: runner("turtle"), copy: "거북이처럼 꾸준히 완주했어요!")
}

/// 제자리 달리기 — 요약 화면 축하용 (2프레임 다리 교차, 동물별 템포)
struct ParadeRunnerInPlace: View {
    let runner: ParadeRunner
    var height: CGFloat = 30

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.12)) { context in
            let tick = Int(context.date.timeIntervalSinceReferenceDate / 0.12)
            let frame = (tick / max(1, runner.legEvery)) % 2
            let cell = height / CGFloat(runner.height)
            SpriteFixedView(grid: runner.frames[frame], cell: cell)
                .offset(y: runner.bounce == 1 && frame == 0 ? -cell : 0)
        }
        .frame(height: height)
    }
}

/// SpriteView 는 파일 내 private — 요약 화면용 공개 렌더러
struct SpriteFixedView: View {
    let grid: [[Int]]
    let cell: CGFloat

    var body: some View {
        let rows = grid.count
        let cols = grid.first?.count ?? 1
        ZStack(alignment: .topLeading) {
            ForEach(0..<rows, id: \.self) { y in
                ForEach(0..<cols, id: \.self) { x in
                    if let c = GrassPalette.color(grid[y][x]) {
                        RoundedRectangle(cornerRadius: cell * 0.22)
                            .fill(c)
                            .frame(width: cell * 0.92, height: cell * 0.92)
                            .offset(x: CGFloat(x) * cell, y: CGFloat(y) * cell)
                    }
                }
            }
        }
        .frame(width: CGFloat(cols) * cell, height: CGFloat(rows) * cell, alignment: .topLeading)
    }
}
