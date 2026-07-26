// Routinist Watch — Phase 1 (2026-07-26).
// 독립 워치 러닝 앱: 시작 → 실시간 메트릭 → 종료 요약 → HealthKit 저장.
// 폰 앱은 기존 Apple Health 동기화로 자동 유입 (6h stale 자동 sync 포함).

import SwiftUI

@main
struct RoutinistWatchApp: App {
    @StateObject private var workout = WorkoutManager.shared

    init() {
        #if DEBUG
        WorkoutManager.shared.applyUIPreviewIfRequested()
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(workout)
        }
    }
}

struct RootView: View {
    @EnvironmentObject var workout: WorkoutManager

    var body: some View {
        switch workout.phase {
        case .idle, .requesting:
            StartView()
        case .countdown:
            CountdownView()
        case .active, .paused:
            SessionPagingView()
        case .ended:
            SummaryView()
        }
    }
}
