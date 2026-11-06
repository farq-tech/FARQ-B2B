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

// MARK: - Segments (SwiftPieces GlassSegments)

struct FarqSegments<Value: Hashable>: View {
    let options: [(Value, String)]
    @Binding var selection: Value
    var height: CGFloat = 40

    var body: some View {
        GlassSegments(options: options.map(\.0), selection: $selection, height: height,
                      style: GlassSegmentsStyle(ink: Tokens.mutedForeground, selectedInk: .white, indicatorTint: Palette.brand,
                                                font: Typo.font(14, .semibold)),
                      label: { value in options.first { $0.0 == value }?.1 ?? "" })
    }
}

// MARK: - Switch (SwiftPieces LiquidSwitch)

struct FarqSwitch: View {
    let title: String
    @Binding var isOn: Bool
    var symbol: String? = nil

    var body: some View {
        LiquidSwitch(title, isOn: $isOn, symbol: symbol,
                     style: LiquidSwitchStyle(onTint: Palette.brand, symbol: Palette.brand, label: Tokens.foreground, font: Typo.font(15, .semibold)))
    }
}

// MARK: - Buttons (SwiftPieces ElasticButton)

extension SwiftUI.ButtonStyle where Self == ElasticButton {
    /// The one primary action: olive glass, white ink, squash-and-stretch with haptics.
    static var farqPrimary: ElasticButton { .elastic(style: .init(fill: Palette.brand, ink: .white, radius: Tokens.radius, height: 50, padding: 18)) }
    /// A quiet secondary action on the shadcn secondary surface.
    static var farqSecondary: ElasticButton { .elastic(style: .init(fill: Tokens.secondary, ink: Tokens.primaryInk, radius: Tokens.radius, height: 50, padding: 18, depth: false)) }
    /// Motion only, for cards and rows.
    static var farqPress: ElasticButton { .elastic(squash: 0.97, bounce: 0.15) }
}

// MARK: - Numbers (SwiftPieces Odometer)

/// A figure whose digits roll like a counter; «غير متاح» when missing.
struct RollingFigure: View {
    let value: Double?
    var unit: String = ""
    var font: Font = Typo.figure
    var showsDelta = false

    var body: some View {
        if let value, value.isFinite {
            HStack(spacing: 4) {
                Odometer(value: value.rounded(), format: englishNumber, showsDelta: showsDelta,
                         style: OdometerStyle(up: Palette.accent, down: Color(hex: 0xB3261E), ink: Tokens.foreground, muted: Tokens.mutedForeground))
                    .font(font)
                if !unit.isEmpty { Text(unit).font(Typo.font(14, .semibold)).foregroundStyle(Tokens.mutedForeground) }
            }
            .environment(\.layoutDirection, .leftToRight)
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

// MARK: - Lens steps (SwiftPieces StepTrail)

struct FarqSteps: View {
    let steps: [String]
    @Binding var current: Int

    var body: some View {
        StepTrail(steps: steps, selection: $current, reached: steps.count - 1, showsCaption: false,
                  messages: .init(label: "خطوات العدسة",
                                  caption: { p, c in "الخطوة \(p) من \(c)" },
                                  value: { p, c, t in "الخطوة \(p) من \(c)، \(t)" },
                                  complete: "اكتملت",
                                  goTo: { t in "انتقل إلى \(t)" }),
                  style: .init(accent: Palette.brand, accentInk: .white, label: Tokens.foreground, secondaryLabel: Tokens.mutedForeground, height: 32))
    }
}

// MARK: - Chips (SwiftPieces FilterRail)

/// One choice out of a rail of chips, bound to a single value.
struct FarqChips: View {
    let options: [String]
    @Binding var selection: String?

    var body: some View {
        FilterRail(options: options,
                   selection: Binding(get: { selection.map { Set([$0]) } ?? [] }, set: { selection = $0.first }),
                   style: .init(label: Tokens.foreground, secondaryLabel: Tokens.mutedForeground, indicator: Palette.brand, onIndicator: .white, chipHeight: 36))
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

/// Farq's page wash: warm stone with a field of hex dots that slowly breathes (the web's .atlas-dots).
struct FarqWash: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathe = false

    var body: some View {
        ZStack {
            Tokens.background
            Canvas { context, size in
                let cell: CGFloat = 20, row = cell * 0.8660254
                var y: CGFloat = 0, odd = false
                while y < size.height {
                    var x: CGFloat = odd ? cell / 2 : 0
                    while x < size.width {
                        context.fill(Path(ellipseIn: CGRect(x: x - 1, y: y - 1, width: 2, height: 2)), with: .color(Color(hex: 0x9C8F7B).opacity(0.5)))
                        x += cell
                    }
                    y += row; odd.toggle()
                }
            }
            .opacity(breathe ? 0.55 : 0.3)
            .scaleEffect(breathe ? 1.02 : 1, anchor: .center)
        }
        .ignoresSafeArea()
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 5.2).repeatForever(autoreverses: true)) { breathe = true }
        }
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
