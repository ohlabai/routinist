// 3-2-1 카운트다운 — Apple 운동앱 링 문법을 잔디 그린으로 (2026-07-26).

import SwiftUI
import WatchKit

struct CountdownView: View {
    @EnvironmentObject var workout: WorkoutManager
    @State private var count = 3
    @State private var ringProgress: CGFloat = 1.0

    var body: some View {
        ZStack {
            Circle()
                .stroke(GrassPalette.mid.opacity(0.25), lineWidth: 10)
            Circle()
                .trim(from: 0, to: ringProgress)
                .stroke(GrassPalette.mid, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 1.0), value: ringProgress)
            Text("\(count)")
                .font(.system(size: 74, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.white)
                .contentTransition(.numericText(countsDown: true))
        }
        .padding(18)
        .onAppear { tick() }
    }

    private func tick() {
        WKInterfaceDevice.current().play(.click)
        ringProgress = CGFloat(count - 1) / 3.0
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            if count > 1 {
                withAnimation { count -= 1 }
                tick()
            } else {
                workout.beginSession()
            }
        }
    }
}
