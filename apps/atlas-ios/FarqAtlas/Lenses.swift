import SwiftUI

/// A figure that can colour the map. Every value comes straight from a golden table through /api/market; the app never
/// recomputes a figure the server already publishes.
enum Metric: String, CaseIterable, Identifiable {
    // the chosen activity (owners, distributors)
    case shortfall, marketFit, activityResidentsPer, activityPerKm2, activityBusinesses
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
        case .marketFit: return "ملاءمة السوق"
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
        case .marketFit: return Explain.marketFit
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

/// The figures an analyst can rank and colour the city by.
enum Lens {
    static let analystMetrics: [Metric] = [.population, .density, .businesses, .residentsPerBusiness, .whatsapp, .wholesale,
                                           .saudiPct, .malePct, .income, .villaShare, .underConstruction]
}

/// The audience segment a marketer targets. Sex and nationality are measured separately, so they are never multiplied.
enum Segment: String, CaseIterable, Identifiable {
    case everyone, men, women, saudi, nonSaudi
    var id: String { rawValue }
    var incomeLabel: String {
        switch self {
        case .everyone: return "متوسط دخل العاملين"
        case .men: return "متوسط دخل الرجال العاملين"
        case .women: return "متوسط دخل النساء العاملات"
        case .saudi: return "متوسط دخل العاملين السعوديين"
        case .nonSaudi: return "متوسط دخل العاملين غير السعوديين"
        }
    }
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

/// A city total is valid only when every eligible district has a measured, nonnegative value.
enum AudienceCoverage {
    static func total(_ values: [Double?], eligibleDistrictCount: Int) -> Double? {
        guard eligibleDistrictCount >= 0,
              values.count == eligibleDistrictCount,
              values.allSatisfy({ value in value.map { $0.isFinite && $0 >= 0 } == true }) else { return nil }
        return values.compactMap { $0 }.reduce(0, +)
    }
}

/// A comparison leader is meaningful only when every selected district has a finite measurement.
enum CompleteMetricComparison {
    static func maximum(_ values: [Double?], selectedCount: Int) -> Double? {
        guard selectedCount >= 2, values.count == selectedCount,
              values.allSatisfy({ $0.map(\.isFinite) == true }) else { return nil }
        return values.compactMap { $0 }.max()
    }
}

enum MarketFitScorer {
    /// Market-fit power must be a measured worker-income value; housing mix is not a purchasing-power measure.
    static func measuredPurchasingPower(income: Double?) -> Double? {
        guard let income, income.isFinite, income >= 0 else { return nil }
        return income
    }

    /// Scores only districts with both figures, so each component uses the same city cohort as the service.
    /// The former per-district path filtered both city arrays for every score, making map fills quadratic.
    static func scores(demandByDistrict: [String: Double], purchasingPowerByDistrict: [String: Double]) -> [String: Double] {
        let candidates = demandByDistrict.compactMap { name, demand -> (String, Double, Double)? in
            guard demand.isFinite, let power = purchasingPowerByDistrict[name], power.isFinite, power >= 0 else { return nil }
            return (name, demand, power)
        }
        guard !candidates.isEmpty else { return [:] }
        if candidates.count == 1 { return [candidates[0].0: 50] }
        let demand = candidates.map(\.1).sorted()
        let power = candidates.map(\.2).sorted()

        var result: [String: Double] = [:]
        for (name, demandValue, powerValue) in candidates {
            let demandRank = rank(demandValue, in: demand)
            let powerRank = rank(powerValue, in: power)
            result[name] = ((demandRank + powerRank) / 2).rounded()
        }
        return result
    }

    /// Average tied rank scaled to 0–100, matching market_analytics._percentile_ranks.
    private static func rank(_ value: Double, in sorted: [Double]) -> Double {
        var low = 0, high = sorted.count
        while low < high {
            let middle = low + (high - low) / 2
            if sorted[middle] < value { low = middle + 1 } else { high = middle }
        }
        let first = low
        low = first; high = sorted.count
        while low < high {
            let middle = low + (high - low) / 2
            if sorted[middle] <= value { low = middle + 1 } else { high = middle }
        }
        let averageRank = Double(first + low - 1) / 2
        return 100 * averageRank / Double(sorted.count - 1)
    }
}

/// Keeps the city-wide ranking stable across SwiftUI body passes and invalidates it when the store's data revision moves.
struct VersionedMarketFitCache {
    private var revision: Int?
    private var cachedScores: [String: Double] = [:]

    func values(for revision: Int) -> [String: Double]? {
        guard self.revision == revision else { return nil }
        return cachedScores
    }

    mutating func store(_ scores: [String: Double], for revision: Int) {
        self.revision = revision
        cachedScores = scores
    }
}
