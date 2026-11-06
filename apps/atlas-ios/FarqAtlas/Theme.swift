import SwiftUI

/// Farq identity: olive #3E573B primary, emerald #00805F accent, charcoal #303030, IBM Plex Sans Arabic.
enum Palette {
    static let brand = Color(hex: 0x3E573B)
    static let accent = Color(hex: 0x00805F)
    static let charcoal = Color(hex: 0x303030)
    static let warning = Color(hex: 0xB7791F)
    static let brandLight = Color(hex: 0x56744F)
    static let brandDeep = Color(hex: 0x24361F)
    static let mint = Color(hex: 0x7FE0B5)
    /// The hero surface: deep olive into emerald.
    static let hero = LinearGradient(colors: [Color(hex: 0x2C4128), Color(hex: 0x3E573B), Color(hex: 0x0E6B50)], startPoint: .topLeading, endPoint: .bottomTrailing)

    /// Five sequential greens, light → dark, one per city quintile (light = lower in the city, dark = higher).
    static let ramp: [Color] = [
        Color(hex: 0xE3EDDC), Color(hex: 0xB8D3A8), Color(hex: 0x83AE73), Color(hex: 0x54804A), Color(hex: 0x33522E),
    ]
    static let missing = Color.gray.opacity(0.22)

    /// Distinct, calm colours for sales territories.
    static let territories: [Color] = [
        Color(hex: 0x3E573B), Color(hex: 0x00805F), Color(hex: 0xC27C2C), Color(hex: 0x4A6FA5), Color(hex: 0x9C4F7A),
        Color(hex: 0x6B8E23), Color(hex: 0xB5523B), Color(hex: 0x2F7F8F), Color(hex: 0x7A6A3A), Color(hex: 0x5E4B8B),
        Color(hex: 0xA0522D), Color(hex: 0x3F7F5F),
    ]

    /// Listing price against its district median: cheaper (emerald) → near → dearer (amber/red).
    static func versus(_ pct: Double?) -> Color {
        guard let pct else { return .gray }
        if pct <= -10 { return accent }
        if pct < 10 { return Color(hex: 0x8A8F86) }
        return Color(hex: 0xC2552C)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}

/// IBM Plex Sans Arabic, scaling with Dynamic Type; figures are tabular so columns line up.
enum Typo {
    enum Weight: String { case regular = "Regular", medium = "Medium", semibold = "SemiBold", bold = "Bold" }

    static func font(_ size: CGFloat, _ weight: Weight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom("IBMPlexSansArabic-\(weight.rawValue)", size: size, relativeTo: style)
    }

    static let largeTitle = font(30, .bold, relativeTo: .largeTitle)
    static let title = font(22, .bold, relativeTo: .title2)
    static let headline = font(17, .semibold, relativeTo: .headline)
    static let body = font(16, .regular, relativeTo: .body)
    static let callout = font(15, .medium, relativeTo: .callout)
    static let subheadline = font(14, .regular, relativeTo: .subheadline)
    static let caption = font(12, .regular, relativeTo: .caption)
    static let figure = font(22, .bold, relativeTo: .title3)
    static let bigFigure = font(30, .bold, relativeTo: .title)
}

/// A rounded, softly shadowed card surface.
struct CardBackground: ViewModifier {
    var tint: Color? = nil
    func body(content: Content) -> some View {
        content
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(tint.map { AnyShapeStyle($0.opacity(0.1)) } ?? AnyShapeStyle(Color(.systemBackground).opacity(0.85)))
                    .shadow(color: .black.opacity(tint == nil ? 0.06 : 0), radius: 10, y: 4)
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.primary.opacity(0.05), lineWidth: 1))
            }
    }
}

extension View {
    func card(tint: Color? = nil) -> some View { modifier(ShadCard(tint: tint)) }
}

/// A left-pointing chevron («next» in an Arabic line), drawn without layout mirroring so it never flips.
struct NextChevron: View {
    var body: some View {
        Image(systemName: "chevron.left").environment(\.layoutDirection, .leftToRight)
    }
}
