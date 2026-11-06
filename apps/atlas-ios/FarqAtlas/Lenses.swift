import SwiftUI

/// A figure that can colour the map. Every value comes straight from a golden table through /api/market; the app never
/// recomputes a figure the server already publishes.
enum Metric: String, CaseIterable, Identifiable {
    // the chosen activity (owners, distributors)
    case shortfall, activityResidentsPer, activityPerKm2, activityBusinesses
    // the whole directory
    case population, density, businesses, residentsPerBusiness, whatsapp, wholesale
    // audience layers
    case audience, saudiPct, malePct, income, villaShare
    // growth
    case underConstruction

    var id: String { rawValue }

    var label: String {
        switch self {
        case .shortfall: return "فرص التوسع"
        case .activityResidentsPer: return "ساكن لكل منافس"
        case .activityPerKm2: return "المنافسون لكل كم²"
        case .activityBusinesses: return "منشآت النشاط"
        case .population: return "السكان"
        case .density: return "السكان لكل كم²"
        case .businesses: return "المنشآت"
        case .residentsPerBusiness: return "ساكن لكل منشأة"
        case .whatsapp: return "منشآت بواتساب"
        case .wholesale: return "منشآت الجملة"
        case .audience: return "حجم الجمهور"
        case .saudiPct: return "السعوديون"
        case .malePct: return "الذكور"
        case .income: return "متوسط الدخل"
        case .villaShare: return "حصة الفلل"
        case .underConstruction: return "مبانٍ تحت الإنشاء"
        }
    }

    /// The unit written after the figure.
    var unit: String {
        switch self {
        case .saudiPct, .malePct, .villaShare: return "%"
        case .income: return " ر.س"
        default: return ""
        }
    }

    func format(_ value: Double?) -> String {
        guard let value else { return Fmt.unavailable }
        switch unit {
        case "%": return Fmt.percent(value)
        case "": return Fmt.int(value)
        default: return Fmt.withUnit(value, unit.trimmingCharacters(in: .whitespaces))
        }
    }

    /// How the figure is worked out — names the method, never an outside source (foundation §5).
    var explain: [String] {
        switch self {
        case .shortfall: return Explain.gap
        case .activityResidentsPer: return ["سكان الحي ÷ منشآت النشاط المختار فيه.", "كلما ارتفع الرقم قلّ المنافسون لكل ساكن."]
        case .activityPerKm2: return ["منشآت النشاط المختار ÷ مساحة الحي بالكيلومتر المربع."]
        case .activityBusinesses: return ["منشآت النشاط المختار القائمة في دليل فرق داخل الحي."]
        case .population: return Explain.population
        case .density: return Explain.density
        case .businesses: return Explain.businesses
        case .residentsPerBusiness: return ["السكان ÷ المنشآت.", "كلما ارتفع الرقم قلّت المنشآت التي تخدم السكان."]
        case .whatsapp: return ["منشآت الحي في دليل فرق التي لها رقم واتساب.", "التواصل يبقى يدوياً وبعد مراجعة."]
        case .wholesale: return ["منشآت الحي في دليل فرق التي تبيع بالجملة."]
        case .audience: return Explain.audience
        case .saudiPct: return Explain.saudi
        case .malePct: return Explain.sex
        case .income: return Explain.income
        case .villaShare: return Explain.villaShare
        case .underConstruction: return ["مبانٍ تحت الإنشاء أو الترميم في الحي، من طبقة مباني فرق.", "مؤشر لاتجاه الطلب القادم، لا عدد وحدات مؤكد."]
        }
    }
}

/// One lens per audience (docs/atlas-product-foundation.md §4): numbered steps in decision order and three map metrics.
enum Lens: String, CaseIterable, Identifiable {
    case owners, marketers, distributors, analysts, realEstate

    var id: String { rawValue }

    var label: String {
        switch self {
        case .owners: return "المتاجر"
        case .marketers: return "المسوّقون"
        case .distributors: return "الموزّعون"
        case .analysts: return "المحلّلون"
        case .realEstate: return "العقار"
        }
    }

    var symbol: String {
        switch self {
        case .owners: return "storefront.fill"
        case .marketers: return "megaphone.fill"
        case .distributors: return "shippingbox.fill"
        case .analysts: return "chart.bar.xaxis"
        case .realEstate: return "house.fill"
        }
    }

    var question: String {
        switch self {
        case .owners: return "أين أفتح فرعي التالي؟"
        case .marketers: return "أين أركّز ميزانيتي، وعلى مَن؟"
        case .distributors: return "كيف أغطي مدينتي بكفاءة؟"
        case .analysts: return "أرقام موثوقة قابلة للمقارنة"
        case .realEstate: return "أي عرض يناسبني، وفي أي حي؟"
        }
    }

    var steps: [String] {
        switch self {
        case .owners: return ["أين ينقص نشاطي؟", "المنافسون", "قارن المواقع"]
        case .marketers: return ["أين جمهوري؟", "منشآت الأحياء"]
        case .distributors: return ["المناطق", "أين يُبنى الآن؟"]
        case .analysts: return ["الأحياء والترتيب", "قارن الأحياء"]
        case .realEstate: return ["اختر عقاراً", "تعرّف على الحي"]
        }
    }

    var metrics: [Metric] {
        switch self {
        case .owners: return [.shortfall, .activityResidentsPer, .activityPerKm2]
        case .marketers: return [.audience, .density, .whatsapp]
        case .distributors: return [.activityBusinesses, .wholesale, .underConstruction]
        case .analysts: return [.population, .density, .businesses, .residentsPerBusiness, .whatsapp, .wholesale,
                                .saudiPct, .malePct, .income, .villaShare, .underConstruction]
        case .realEstate: return [.population, .density, .income]
        }
    }

    /// Whether the lens needs an activity chosen.
    var usesActivity: Bool { self == .owners || self == .distributors }
}

/// The audience segment a marketer targets. Sex and nationality are measured separately, so they are never multiplied.
enum Segment: String, CaseIterable, Identifiable {
    case everyone, men, women, saudi, nonSaudi
    var id: String { rawValue }
    var label: String {
        switch self {
        case .everyone: return "الكل"
        case .men: return "رجال"
        case .women: return "نساء"
        case .saudi: return "سعوديون"
        case .nonSaudi: return "غير سعوديين"
        }
    }
}

/// Rank of a value within its city, as a quintile 0…4 (every composite figure reads within its own city, §5).
struct Quintiles {
    let cuts: [Double]

    init(_ values: [Double]) {
        let sorted = values.filter(\.isFinite).sorted()
        guard !sorted.isEmpty else { cuts = []; return }
        cuts = (1...4).map { sorted[min(sorted.count - 1, Int(Double(sorted.count) * Double($0) / 5))] }
    }

    func bin(_ value: Double?) -> Int? {
        guard let value, value.isFinite, !cuts.isEmpty else { return nil }
        return cuts.firstIndex(where: { value < $0 }) ?? 4
    }

    /// Score out of 100 within the city: share of districts with a lower value.
    static func score(_ value: Double?, among values: [Double]) -> Double? {
        guard let value, value.isFinite, values.count > 1 else { return nil }
        let below = values.filter { $0 < value }.count
        return 100 * Double(below) / Double(values.count - 1)
    }
}
