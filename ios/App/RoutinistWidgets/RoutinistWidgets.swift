// 워치 페이스 컴플리케이션 (v9) — 탭하면 Routinist 러닝 시작 화면으로.
// Phase 2 에서 스트릭·이달 챌린지 라이브 데이터 연동 예정 (지금은 런처).

import WidgetKit
import SwiftUI

struct LaunchEntry: TimelineEntry {
    let date: Date
}

struct LaunchProvider: TimelineProvider {
    func placeholder(in context: Context) -> LaunchEntry { LaunchEntry(date: Date()) }
    func getSnapshot(in context: Context, completion: @escaping (LaunchEntry) -> Void) {
        completion(LaunchEntry(date: Date()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<LaunchEntry>) -> Void) {
        completion(Timeline(entries: [LaunchEntry(date: Date())], policy: .never))
    }
}

struct LaunchWidgetView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryInline:
            Text("🏃 Routinist")
        default:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "figure.run")
                    .font(.system(size: 20, weight: .bold))
                    .widgetAccentable()
            }
        }
    }
}

@main
struct RoutinistWidgets: WidgetBundle {
    var body: some Widget {
        RoutinistLaunchWidget()
    }
}

struct RoutinistLaunchWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "RoutinistLaunch", provider: LaunchProvider()) { _ in
            if #available(watchOS 10.0, *) {
                LaunchWidgetView().containerBackground(.clear, for: .widget)
            } else {
                LaunchWidgetView()
            }
        }
        .configurationDisplayName("달리기 시작")
        .description("탭하면 Routinist 러닝을 바로 시작해요.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryInline])
    }
}
