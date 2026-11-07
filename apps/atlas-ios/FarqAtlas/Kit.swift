import SwiftUI
import Pow
import SwiftUIX
import ComponentsKit

// The one place the libraries meet Farq: every component below is a SwiftPieces / ComponentsKit / Pow / SwiftUIX
// piece dressed in the Atlas shadcn tokens (apps/atlas/app/globals.css), so iOS and the web read as one product.

enum Tokens {
    static func adaptive(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(Color(hex: dark)) : UIColor(Color(hex: light)) })
    }
    static let background = adaptive(0xF7F5F1, 0x111511)
    static let foreground = adaptive(0x172A1E, 0xF1EEE8)
    static let card = adaptive(0xFFFFFF, 0x1A201A)
    static let secondary = adaptive(0xEEF2E6, 0x223022)
    static let muted = adaptive(0xF1EEE8, 0x1F241F)
    static let mutedForeground = adaptive(0x6B6358, 0xA39C90)
    static let accent = adaptive(0xE7F0DE, 0x263826)
    static let border = adaptive(0xE6E0D6, 0x2B332B)
    static let ring = Color(hex: 0xA3B80F)
    static let primaryInk = adaptive(0x3E573B, 0xB9D4A8)
    static let radius: CGFloat = 13
}

/// English digits everywhere, whatever the app's Arabic locale would pick (foundation §5).
let englishNumber = FloatingPointFormatStyle<Double>.number.locale(Locale(identifier: "en_US")).precision(.fractionLength(0))

// MARK: - Buttons

/// A press with no gesture of its own: it reads only the system's `isPressed`, so a tap inside a scrolling screen always
/// reaches the action. (A drag gesture on every button swallowed taps in scroll views; see the improvement log.)
struct FarqButtonStyle: SwiftUI.ButtonStyle {
    enum Kind { case primary, secondary, press }
    var kind: Kind
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        return Group {
            switch kind {
            case .press:
                configuration.label
            case .primary, .secondary:
                configuration.label
                    .font(Typo.font(compact ? 18 : 16, .bold))
                    .foregroundStyle(kind == .primary ? Color.white : Tokens.primaryInk)
                    .padding(.horizontal, compact ? 14 : 18)
                    .frame(maxWidth: compact ? nil : .infinity, minHeight: compact ? 44 : 52)
                    .background(kind == .primary ? AnyShapeStyle(Palette.brand) : AnyShapeStyle(Tokens.secondary),
                                in: .rect(cornerRadius: Tokens.radius, style: .continuous))
            }
        }
        .contentShape(.rect)
        .scaleEffect(pressed ? 0.96 : 1)
        .opacity(pressed && kind == .press ? 0.85 : 1)
        .animation(.spring(response: 0.22, dampingFraction: 0.7), value: pressed)
        .sensoryFeedback(.impact(weight: .light), trigger: pressed) { _, now in now }
    }
}

extension SwiftUI.ButtonStyle where Self == FarqButtonStyle {
    /// The one primary action of a screen.
    static var farqPrimary: FarqButtonStyle { FarqButtonStyle(kind: .primary) }
    /// A quiet secondary action.
    static var farqSecondary: FarqButtonStyle { FarqButtonStyle(kind: .secondary) }
    /// Cards and rows: a soft squish and a haptic tick.
    static var farqPress: FarqButtonStyle { FarqButtonStyle(kind: .press) }
    /// A small square stepper button.
    static func farqStep(primary: Bool) -> FarqButtonStyle { FarqButtonStyle(kind: primary ? .primary : .secondary, compact: true) }
}

// MARK: - Numbers

/// A figure in English digits; it rolls digit by digit only when its value changes, never on its own. «غير متاح» when missing.
struct RollingFigure: View {
    let value: Double?
    var unit: String = ""
    var font: Font = Typo.figure

    var body: some View {
        if let value, value.isFinite {
            HStack(spacing: 4) {
                Text(Fmt.int(value)).font(font).monospacedDigit().foregroundStyle(Tokens.foreground)
                    .contentTransition(.numericText(value: value))
                    .animation(.snappy, value: value)
                if !unit.isEmpty { Text(unit).font(Typo.font(14, .semibold)).foregroundStyle(Tokens.mutedForeground) }
            }
        } else {
            Text(Fmt.unavailable).font(Typo.callout).foregroundStyle(Tokens.mutedForeground)
        }
    }
}

// MARK: - Badges (ComponentsKit SUBadge)

struct FarqBadge: View {
    enum Tone { case estimate, warning, good }
    let title: String
    var tone: Tone = .estimate

    var body: some View {
        SUBadge(model: {
            var m = BadgeVM()
            m.title = title
            m.style = .light
            m.font = .custom(name: "IBMPlexSansArabic-SemiBold", size: 11)
            m.paddings = .init(horizontal: 8, vertical: 3)
            let main: Color = tone == .warning ? Palette.warning : tone == .good ? Palette.accent : Palette.brand
            m.color = ComponentColor(main: .universal(.color(main)), contrast: .universal(.color(.white)))
            return m
        }())
    }
}

// MARK: - Progress (ComponentsKit SUProgressBar)

struct FarqProgress: View {
    let value: Double?
    var body: some View {
        SUProgressBar(model: {
            var m = ProgressBarVM()
            m.currentValue = CGFloat(value ?? 0)
            m.style = .light
            m.size = .small
            m.color = ComponentColor(main: .universal(.color(Palette.accent)), contrast: .universal(.color(.white)),
                                     background: .universal(.color(Palette.accent.opacity(0.15))))
            return m
        }())
        .environment(\.layoutDirection, .rightToLeft)
    }
}

// MARK: - Surfaces

/// The shadcn card: white, a hairline border, 13pt radius, a whisper of shadow.
struct ShadCard: ViewModifier {
    var tint: Color? = nil
    func body(content: Content) -> some View {
        content
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: Tokens.radius, style: .continuous)
                    .fill(tint.map { AnyShapeStyle($0.opacity(0.08)) } ?? AnyShapeStyle(Tokens.card))
                    .overlay(RoundedRectangle(cornerRadius: Tokens.radius, style: .continuous).strokeBorder(tint?.opacity(0.25) ?? Tokens.border, lineWidth: 1))
                    .shadow(color: .black.opacity(0.04), radius: 3, y: 1)
            }
    }
}

/// Farq's page wash: warm stone with a still field of hex dots (the web's .atlas-dots), drawn once.
struct FarqWash: View {
    var body: some View {
        ZStack {
            Tokens.background
            Canvas { context, size in
                let cell: CGFloat = 20, row = cell * 0.8660254
                var y: CGFloat = 0, odd = false
                while y < size.height {
                    var x: CGFloat = odd ? cell / 2 : 0
                    while x < size.width {
                        context.fill(Path(ellipseIn: CGRect(x: x - 1, y: y - 1, width: 2, height: 2)), with: .color(Color(hex: 0x9C8F7B).opacity(0.35)))
                        x += cell
                    }
                    y += row; odd.toggle()
                }
            }
            .drawingGroup()
        }
        .ignoresSafeArea()
    }
}

/// The frosted bar behind the top controls (SwiftUIX blur).
struct FrostedBar: View {
    var body: some View {
        VisualEffectBlurView(blurStyle: .systemUltraThinMaterial)
            .mask(LinearGradient(colors: [.black, .black, .black.opacity(0)], startPoint: .top, endPoint: .bottom))
            .ignoresSafeArea()
    }
}

extension View {
    func shadCard(tint: Color? = nil) -> some View { modifier(ShadCard(tint: tint)) }

    /// A soft shine across a card each time its subject changes (Pow).
    func shineOnChange<V: Equatable>(_ value: V) -> some View { changeEffect(.shine(duration: 0.9), value: value) }

    /// A shake when something fails (Pow).
    func shakeOnChange<V: Equatable>(_ value: V) -> some View { changeEffect(.shake(rate: .fast), value: value) }
}
