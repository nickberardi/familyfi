import SwiftUI
import WidgetKit

// The countdown both apps show on an iPhone's Lock Screen and in its Dynamic Island, drawn the same
// way in each: the FamilyFi app's timed block (its widget extension, `targets/pause-activity`) and
// FamilyFi Me's heads-up before a block starts (`targets/heads-up`). Each app's widget extension
// links this file; its own `ActivityConfiguration` maps its attributes to a `FFCountdown` and lays
// these views into the activity's regions. The Android counterpart is `android/…/Countdown.kt`.
// Nothing here reads the clock beyond the system's own timers, so a countdown keeps running
// between the app's updates.

/// One countdown, in the app's own words (familyfi's display functions write them).
struct FFCountdown {
    /// What it is for: a group's name, or the block that starts.
    let name: String
    /// Its line: the group's status, or when the block starts.
    let line: String
    /// The group's monogram or the person's initials; nil draws the pause mark instead.
    let monogram: String?
    /// When the counted time began, for the bar; nil counts from now.
    let from: Date?
    let until: Date
    /// The card's buttons, quiet first and the strong one last (More time, then Unblock).
    let actions: [FFCountdownAction]

    /// What is left; never backwards once the end has passed.
    var remaining: ClosedRange<Date> { Date.now...max(until, Date.now) }
    /// The whole span, for the bar.
    var span: ClosedRange<Date> { min(from ?? Date.now, until)...until }
    /// Room for "1:05:00" while an hour or more is left, "42:17" after, at 15 points.
    var timerWidth: CGFloat { until.timeIntervalSinceNow >= 3600 ? 64 : 46 }
}

struct FFCountdownAction {
    let label: String
    let url: URL
    /// The card's strong button: filled in the accent.
    let strong: Bool
}

/// The design system's colours for a countdown (familyfi `src/ui/palette.ts`): the block's paused
/// ink, the accent, and the opaque Lock Screen card, light and dark. The Dynamic Island is always dark.
enum FFCountdownPalette {
    static let pausedLight = Color(red: 192 / 255, green: 76 / 255, blue: 0)
    static let pausedDark = Color(red: 1, green: 179 / 255, blue: 107 / 255)
    static let accentLight = Color(red: 0, green: 102 / 255, blue: 204 / 255)
    static let accentDark = Color(red: 112 / 255, green: 181 / 255, blue: 1)
    static let card = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 28 / 255, green: 28 / 255, blue: 30 / 255, alpha: 1) : .white })

    static func paused(_ scheme: ColorScheme) -> Color { scheme == .dark ? pausedDark : pausedLight }
    static func accent(_ scheme: ColorScheme) -> Color { scheme == .dark ? accentDark : accentLight }
}

/// The Lock Screen: mark, name and line, the countdown, the bar, and the buttons.
struct FFCountdownLockScreen: View {
    let countdown: FFCountdown
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let ink = FFCountdownPalette.paused(scheme)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                FFCountdownMark(monogram: countdown.monogram, ink: ink, scheme: scheme)
                VStack(alignment: .leading, spacing: 1) {
                    Text(countdown.name).font(.headline).lineLimit(1)
                    Text(countdown.line).font(.system(size: 14)).foregroundStyle(.secondary).lineLimit(2)
                }
                Spacer(minLength: 8)
                FFCountdownTimer(countdown: countdown, size: 28, ink: ink)
            }
            FFCountdownBar(countdown: countdown, ink: ink)
            FFCountdownActions(actions: countdown.actions, scheme: scheme)
        }
        .padding(16)
    }
}

/// The expanded Dynamic Island's leading region: mark and name.
struct FFCountdownIslandLeading: View {
    let countdown: FFCountdown

    var body: some View {
        HStack(spacing: 10) {
            FFCountdownMark(monogram: countdown.monogram, ink: FFCountdownPalette.pausedDark, scheme: .dark)
            Text(countdown.name).font(.headline).lineLimit(1)
        }
        .frame(maxHeight: .infinity)
    }
}

/// The expanded Dynamic Island's trailing region: the countdown.
struct FFCountdownIslandTrailing: View {
    let countdown: FFCountdown

    var body: some View {
        FFCountdownTimer(countdown: countdown, size: 28, ink: FFCountdownPalette.pausedDark)
            .frame(maxHeight: .infinity)
    }
}

/// The expanded Dynamic Island's bottom region: the line, the bar and the buttons.
struct FFCountdownIslandBottom: View {
    let countdown: FFCountdown

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(countdown.line).font(.system(size: 14)).foregroundStyle(.white.opacity(0.75)).lineLimit(2)
            FFCountdownBar(countdown: countdown, ink: FFCountdownPalette.pausedDark)
            FFCountdownActions(actions: countdown.actions, scheme: .dark)
        }
        .padding(.top, 4)
    }
}

/// The compact Dynamic Island's leading side: the pause mark and the name.
struct FFCountdownCompactLeading: View {
    let countdown: FFCountdown

    var body: some View {
        HStack(spacing: 6) {
            FFCountdownGlyph(ink: FFCountdownPalette.pausedDark, size: 20)
            Text(countdown.name).font(.subheadline.weight(.semibold)).lineLimit(1).frame(maxWidth: 64, alignment: .leading)
        }
    }
}

/// The compact Dynamic Island's trailing side: the countdown, sized to its digits.
struct FFCountdownCompactTrailing: View {
    let countdown: FFCountdown

    var body: some View {
        Text(timerInterval: countdown.remaining, countsDown: true)
            .font(.subheadline.weight(.semibold).monospacedDigit())
            .multilineTextAlignment(.trailing)
            .foregroundStyle(FFCountdownPalette.pausedDark)
            .frame(width: countdown.timerWidth)
    }
}

/// The minimal Dynamic Island: a ring emptying around the pause mark.
struct FFCountdownMinimal: View {
    let countdown: FFCountdown

    var body: some View {
        ProgressView(timerInterval: countdown.span, countsDown: true) {
            EmptyView()
        } currentValueLabel: {
            Image(systemName: "pause.fill").font(.system(size: 9, weight: .bold))
        }
        .progressViewStyle(.circular)
        .tint(FFCountdownPalette.pausedDark)
        .foregroundStyle(FFCountdownPalette.pausedDark)
    }
}

/// A paired Apple Watch's Smart Stack: the pause mark and name, the countdown and the bar.
struct FFCountdownSmall: View {
    let countdown: FFCountdown
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let ink = FFCountdownPalette.paused(scheme)
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                FFCountdownGlyph(ink: ink, size: 16)
                Text(countdown.name).font(.headline).lineLimit(1)
            }
            FFCountdownTimer(countdown: countdown, size: 26, ink: ink)
            FFCountdownBar(countdown: countdown, ink: ink)
        }
        .padding(10)
    }
}

/// The countdown in the paused ink: the system keeps it running between updates.
struct FFCountdownTimer: View {
    let countdown: FFCountdown
    let size: CGFloat
    let ink: Color

    var body: some View {
        Text(timerInterval: countdown.remaining, countsDown: true)
            .font(.system(size: size, weight: .semibold).monospacedDigit())
            .multilineTextAlignment(.trailing)
            .foregroundStyle(ink)
            .frame(width: countdown.timerWidth * size / 15)
    }
}

/// How much time is left, emptying as it runs, in both apps.
struct FFCountdownBar: View {
    let countdown: FFCountdown
    let ink: Color

    var body: some View {
        ProgressView(timerInterval: countdown.span, countsDown: true) {
            EmptyView()
        } currentValueLabel: {
            EmptyView()
        }
        .progressViewStyle(.linear)
        .tint(ink)
    }
}

/// The card's buttons, right-aligned: quiet ones outlined, the strong one filled in the accent.
struct FFCountdownActions: View {
    let actions: [FFCountdownAction]
    let scheme: ColorScheme

    var body: some View {
        if !actions.isEmpty {
            HStack(spacing: 8) {
                Spacer()
                ForEach(Array(actions.enumerated()), id: \.offset) { _, action in
                    Link(destination: action.url) {
                        if action.strong {
                            Text(action.label)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(scheme == .dark ? Color.black : Color.white)
                                .padding(.horizontal, 14).padding(.vertical, 7)
                                .background(Capsule().fill(FFCountdownPalette.accent(scheme)))
                        } else {
                            Text(action.label)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(scheme == .dark ? Color.white : Color.primary)
                                .padding(.horizontal, 14).padding(.vertical, 7)
                                .background(Capsule().fill(scheme == .dark ? Color.white.opacity(0.14) : Color.clear))
                                .overlay(Capsule().strokeBorder(scheme == .dark ? Color.clear : Color.primary.opacity(0.14)))
                        }
                    }
                }
            }
        }
    }
}

/// The countdown's mark: the group's monogram on the paused tint, or the pause mark when it has none.
struct FFCountdownMark: View {
    let monogram: String?
    let ink: Color
    let scheme: ColorScheme

    var body: some View {
        Group {
            if let monogram, !monogram.isEmpty {
                Text(monogram).font(.system(size: 13, weight: .bold)).foregroundStyle(ink)
            } else {
                FFCountdownGlyph(ink: ink, size: 18)
            }
        }
        .frame(width: 30, height: 30)
        .background(Circle().fill(ink.opacity(scheme == .dark ? 0.22 : 0.12)))
    }
}

/// The pause mark: SF Symbols' pause in a circle, which Android draws with Material's `pause_circle`.
struct FFCountdownGlyph: View {
    let ink: Color
    let size: CGFloat

    var body: some View {
        Image(systemName: "pause.circle.fill")
            .resizable()
            .frame(width: size, height: size)
            .foregroundStyle(ink)
    }
}
