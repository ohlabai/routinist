// 러닝 Live Activity — 잠금화면 카드 + Dynamic Island (iOS 16.1+).
// 데이터 계약 = RunActivityAttributes (CapApp-SPM 과 동일 파일 공유 컴파일).
// 시간은 timerBasis + Text(timerInterval:) 로 위젯이 자체 틱 — 앱 update 는
// 거리/상태 변화 때만 온다. 디자인은 워치 잔디 브랜드 (에메랄드 + 잔디 게이지) 이식.

import WidgetKit
import SwiftUI
import ActivityKit

private enum Palette {
    static let emerald = Color(red: 16 / 255, green: 185 / 255, blue: 129 / 255)   // #10b981
    static let emeraldDim = Color(red: 6 / 255, green: 95 / 255, blue: 70 / 255)    // #065f46
    /// 잠금화면 카드 배경 — 딥 그린-블랙 (워치 배경 톤).
    static let bg = Color(red: 0.03, green: 0.08, blue: 0.06)
    static let paused = Color(red: 251 / 255, green: 146 / 255, blue: 60 / 255)     // orange-400
}

private enum Fmt {
    static func km(_ meters: Double) -> String {
        String(format: "%.2f", meters / 1000.0)
    }

    static func pace(_ secPerKm: Double?) -> String {
        guard let s = secPerKm, s.isFinite, s > 0 else { return "-'--\"" }
        let m = Int(s) / 60, sec = Int(s) % 60
        return "\(m)'\(String(format: "%02d", sec))\""
    }

    static func time(_ seconds: Double) -> String {
        let t = max(0, Int(seconds))
        if t >= 3600 {
            return String(format: "%d:%02d:%02d", t / 3600, (t % 3600) / 60, t % 60)
        }
        return String(format: "%02d:%02d", t / 60, t % 60)
    }

    static func stateLabel(_ state: String, ko: Bool) -> String? {
        switch state {
        case "paused": return ko ? "일시정지" : "Paused"
        case "autoPaused": return ko ? "자동 일시정지" : "Auto paused"
        default: return nil
        }
    }
}

/// 흐르는 타이머 — running 이면 시스템 틱, paused 면 정지값.
private struct RunTimerText: View {
    let state: RunActivityAttributes.ContentState

    var body: some View {
        if let basis = state.timerBasis {
            Text(timerInterval: basis...basis.addingTimeInterval(48 * 3600), countsDown: false)
                .monospacedDigit()
        } else {
            Text(Fmt.time(state.activeSec))
                .monospacedDigit()
        }
    }
}

/// 거리 잔디 게이지 — 1km = 1칸, 14칸 (워치 v5 이식). 넘치면 슬라이딩.
private struct GrassGauge: View {
    let distanceM: Double
    private let cells = 14

    var body: some View {
        let km = distanceM / 1000.0
        let whole = Int(km)
        let filled = whole <= cells ? whole : ((whole - 1) % cells) + 1
        let fraction = km - Double(whole)
        HStack(spacing: 3) {
            ForEach(0..<cells, id: \.self) { i in
                RoundedRectangle(cornerRadius: 2)
                    .fill(i < filled ? Palette.emerald
                          : i == filled ? Palette.emerald.opacity(max(0.12, fraction * 0.8))
                          : Palette.emeraldDim.opacity(0.35))
                    .frame(height: 6)
            }
        }
    }
}

private struct StateChip: View {
    let label: String

    var body: some View {
        Text(label)
            .font(.caption2.weight(.semibold))
            .foregroundColor(Palette.paused)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(Palette.paused.opacity(0.18)))
    }
}

// MARK: - 잠금화면 카드

private struct LockScreenView: View {
    let context: ActivityViewContext<RunActivityAttributes>

    private var ko: Bool { context.attributes.locale.lowercased().hasPrefix("ko") }

    var body: some View {
        let state = context.state
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "figure.run")
                    .font(.footnote.weight(.bold))
                    .foregroundColor(Palette.emerald)
                Text("Routinist")
                    .font(.footnote.weight(.heavy))
                    .foregroundColor(Palette.emerald)
                Spacer()
                if let label = Fmt.stateLabel(state.sessionState, ko: ko) {
                    StateChip(label: label)
                }
            }

            HStack(alignment: .lastTextBaseline, spacing: 16) {
                RunTimerText(state: state)
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
                    .frame(maxWidth: 150, alignment: .leading)

                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(Fmt.km(state.distanceM)) km")
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                        .foregroundColor(.white)
                        .monospacedDigit()
                    Text("\(Fmt.pace(state.paceSecPerKm)) /km")
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundColor(.white.opacity(0.7))
                        .monospacedDigit()
                    // v22 미러 고도화: 워치 심박 (폰 러닝은 nil → 미표시)
                    if let hr = state.heartRate, hr > 0 {
                        HStack(spacing: 3) {
                            Image(systemName: "heart.fill")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(.red)
                            Text("\(Int(hr))")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                                .foregroundColor(.white.opacity(0.85))
                                .monospacedDigit()
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }

            GrassGauge(distanceM: state.distanceM)
        }
        .padding(16)
    }
}

// MARK: - 위젯 정의

struct RunLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RunActivityAttributes.self) { context in
            LockScreenView(context: context)
                .activityBackgroundTint(Palette.bg)
                .activitySystemActionForegroundColor(Palette.emerald)
        } dynamicIsland: { context in
            let ko = context.attributes.locale.lowercased().hasPrefix("ko")
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    RunTimerText(state: context.state)
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundColor(.white)
                        .frame(maxWidth: 110, alignment: .leading)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("\(Fmt.km(context.state.distanceM)) km")
                            .font(.system(size: 20, weight: .bold, design: .rounded))
                            .foregroundColor(.white)
                            .monospacedDigit()
                        Text("\(Fmt.pace(context.state.paceSecPerKm)) /km")
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                            .foregroundColor(.white.opacity(0.7))
                            .monospacedDigit()
                        if let hr = context.state.heartRate, hr > 0 {
                            HStack(spacing: 2) {
                                Image(systemName: "heart.fill")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundColor(.red)
                                Text("\(Int(hr))")
                                    .font(.system(size: 13, weight: .bold, design: .rounded))
                                    .foregroundColor(.white.opacity(0.85))
                                    .monospacedDigit()
                            }
                        }
                    }
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 6) {
                        if let label = Fmt.stateLabel(context.state.sessionState, ko: ko) {
                            StateChip(label: label)
                        }
                        GrassGauge(distanceM: context.state.distanceM)
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Image(systemName: "figure.run")
                    .foregroundColor(Palette.emerald)
            } compactTrailing: {
                Text("\(Fmt.km(context.state.distanceM))km")
                    .font(.caption2.weight(.bold))
                    .foregroundColor(.white)
                    .monospacedDigit()
            } minimal: {
                Image(systemName: "figure.run")
                    .foregroundColor(Palette.emerald)
            }
            .keylineTint(Palette.emerald)
        }
    }
}

@main
struct RoutinistLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        RunLiveActivityWidget()
    }
}
