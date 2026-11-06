import Foundation

/// Every figure in Atlas is written in English digits with English separators and «%»
/// (docs/atlas-product-foundation.md §5) — the twin of `numberFormat` in apps/atlas/lib/insights-api.ts.
enum Fmt {
    static let unavailable = "غير متاح"

    private static let number: NumberFormatter = {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_US")
        f.numberStyle = .decimal
        f.maximumFractionDigits = 0
        return f
    }()

    /// Keeps a figure whole and in reading order inside an Arabic line (left-to-right isolate).
    static func ltr(_ text: String) -> String { "\u{2066}\(text)\u{2069}" }

    static func int(_ value: Double?) -> String {
        guard let value, value.isFinite else { return unavailable }
        return ltr(number.string(from: NSNumber(value: value.rounded())) ?? unavailable)
    }

    static func int(_ value: Int?) -> String { int(value.map(Double.init)) }

    static func percent(_ value: Double?) -> String {
        guard let value, value.isFinite else { return unavailable }
        return ltr("\(number.string(from: NSNumber(value: value.rounded())) ?? "")%")
    }

    /// A count with its noun in Arabic agreement — the twin of `counted` in apps/atlas/lib/insights-api.ts.
    enum Noun {
        case district, business
        var forms: [String] {
            switch self {
            case .district: return ["حي واحد", "حيّان", "أحياء", "حياً", "حي"]
            case .business: return ["منشأة واحدة", "منشأتان", "منشآت", "منشأة", "منشأة"]
            }
        }
    }

    static func counted(_ value: Int, _ noun: Noun) -> String {
        let f = noun.forms
        if value == 1 { return f[0] }
        if value == 2 { return f[1] }
        let size = abs(value)
        let word = (3...10).contains(size) ? f[2] : (size % 100 >= 11 ? f[3] : f[4])
        return "\(int(value)) \(word)"
    }

    static func withUnit(_ value: Double?, _ unit: String) -> String {
        guard value != nil else { return unavailable }
        return "\(int(value)) \(unit)"
    }
}
