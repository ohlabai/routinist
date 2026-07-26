// Siri / 단축어 (v9) — "루티니스트로 달리기 시작해줘"

import AppIntents

struct StartRunIntent: AppIntent {
    static var title: LocalizedStringResource = "달리기 시작"
    static var description = IntentDescription("Routinist 러닝을 바로 시작해요.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        let workout = WorkoutManager.shared
        if workout.phase == .idle {
            workout.requestAuthorizationAndStart()
        }
        return .result()
    }
}

struct RoutinistShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartRunIntent(),
            phrases: [
                "\(.applicationName)로 달리기 시작",
                "\(.applicationName) 러닝 시작",
                "Start a run with \(.applicationName)",
            ],
            shortTitle: "달리기 시작",
            systemImageName: "figure.run"
        )
    }
}
