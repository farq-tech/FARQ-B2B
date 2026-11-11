import SwiftUI
import MapKit
import Observation

/// Where a flow screen leads (docs/atlas-ios-flows.md). Each flow is at most three screens.
enum Route: Hashable {
    case ownerActivity, ownerDistricts, ownerDistrict(String)
    case marketerAudience, marketerDistricts, marketerDistrict(String)
    case distributorSetup, distributorRegions, distributorRegion(Int)
    case analystTable, compare
    case realEstateKind, realEstateDeals, listing(Listing)
}

/// The data of one city and the choices made inside the flows. No layout state lives here.
@MainActor
@Observable
final class AtlasStore {
    // place
    var cities: [City] = [City(en: "Riyadh", ar: "الرياض", districts: nil)]
    var city: City = City(en: "Riyadh", ar: "الرياض", districts: nil)
    var shapes: [DistrictShape] = []
    var summary: CitySummary?
    var loading = false
    var error: String?

    // layers, keyed by the district's canonical Arabic name
    var counts: [String: DistrictCounts] = [:]
    var audience: [String: Audience] = [:]
    var income: [String: Income] = [:]
    var housing: [String: Housing] = [:]
    var growth: [String: Growth] = [:]

    // the chosen activity (owners, distributors)
    var activity: Activity?
    var activityCounts: [String: DistrictCounts] = [:]
    var gaps: [String: Gap] = [:]
    var activityLoading = false

    // owners: the exact spot
    var pin: CLLocationCoordinate2D?
    var around: Around?
    var aroundLoading = false
    let radius: Double = 1000

    // marketers
    var segment: Segment = .everyone
    var minIncome: Double = 0

    // distributors
    var repCount = 5
    var territories: [Territory] = []
    var territoryOf: [String: Int] = [:]
    var territoriesLoading = false

    // analysts and every «قارن مع حي آخر»
    var compare: [String] = []

    // real estate
    var listingKind = "rent"
    var listingTypes: Set<String> = []
    var listingDeal: String? = "rent_year"
    var listingDistrictIDs: Set<String> = []
    var listingMinBeds: Double?
    var listingMaxAge: Double?
    var listingMaxPrice: Double?
    var listingMinDensity: Double?
    static let opportunityRange: ClosedRange<Double> = -30 ... -10
    static let opportunityCount = 40
    var listings: [Listing] = []
    var listingsLoading = false

    var path = NavigationPath()

    /// Bumped whenever a layer changes, so the map redraws only then (AtlasMap compares it).
    private(set) var dataVersion = 0

    private let api = AtlasAPI.shared
    private var loadToken = UUID()

    // MARK: lookups

    func shape(named name: String) -> DistrictShape? { shapes.first { $0.name == name } }

    func district(at coordinate: CLLocationCoordinate2D) -> DistrictShape? {
        shapes.first { $0.contains(coordinate) }
    }

    func value(_ metric: Metric, _ name: String) -> Double? {
        switch metric {
        case .shortfall: return gaps[name]?.shortfall
        case .activityResidentsPer: return activityCounts[name]?.residents_per
        case .activityPerKm2: return activityCounts[name]?.per_km2
        case .activityBusinesses: return activityCounts[name]?.n
        case .population: return counts[name]?.population
        case .density: return counts[name]?.density
        case .businesses: return counts[name]?.n
        case .residentsPerBusiness: return counts[name]?.residents_per
        case .whatsapp: return counts[name]?.n_whatsapp
        case .wholesale: return counts[name]?.n_wholesale
        case .audience: return audienceSize(name)
        case .saudiPct: return audience[name]?.saudi_pct
        case .malePct: return audience[name]?.male_pct
        case .income: return income[name]?.income_all
        case .villaShare: return housing[name]?.villa_share_pct
        case .underConstruction: return growth[name]?.under_construction
        }
    }

    func values(_ metric: Metric) -> [String: Double] {
        var out: [String: Double] = [:]
        for shape in shapes { if let v = value(metric, shape.name) { out[shape.name] = v } }
        return out
    }

    /// The districts ranked by a metric, highest first; districts without the figure are left out.
    func ranked(_ metric: Metric, ascending: Bool = false) -> [(shape: DistrictShape, value: Double)] {
        shapes.compactMap { shape in value(metric, shape.name).map { (shape, $0) } }
            .sorted { ascending ? $0.value < $1.value : $0.value > $1.value }
    }

    /// Score out of 100 within the city for a district on a metric.
    func score(_ metric: Metric, _ name: String) -> Double? {
        Quintiles.score(value(metric, name), among: Array(values(metric).values))
    }

    /// Segment size of a district if it passes the income bar; nil when it does not or a needed figure is unmeasured.
    func audienceSize(_ name: String) -> Double? {
        if minIncome > 0 { guard let pay = income[name]?.income_all, pay >= minIncome else { return nil } }
        switch segment {
        case .everyone: return counts[name]?.population
        case .men: return audience[name]?.men
        case .women: return audience[name]?.women
        case .saudi: return audience[name]?.saudi
        case .nonSaudi: return audience[name]?.non_saudi
        }
    }

    var audienceTotal: Double? {
        let rows = shapes.compactMap { audienceSize($0.name) }
        return rows.isEmpty ? nil : rows.reduce(0, +)
    }

    var hasAudience: Bool { !audience.isEmpty }
    var hasIncome: Bool { !income.isEmpty }

    /// The city map's fill for a metric: the city quintile of each district, grey when the figure is unavailable.
    func fills(_ metric: Metric) -> [String: Color] {
        let values = values(metric)
        let quintiles = Quintiles(Array(values.values))
        var out: [String: Color] = [:]
        for shape in shapes { if let bin = quintiles.bin(values[shape.name]) { out[shape.id] = Palette.ramp[bin] } }
        return out
    }

    // MARK: lifecycle

    func start() async {
        if let rows = try? await api.cities(), !rows.isEmpty {
            cities = rows
            if let match = rows.first(where: { $0.en == city.en }) { city = match }
        }
        await load()
    }

    func choose(city: City) async {
        guard city != self.city else { return }
        self.city = city
        await load()
    }

    func load() async {
        let token = UUID()
        loadToken = token
        loading = true
        error = nil
        shapes = []; counts = [:]; summary = nil; audience = [:]; income = [:]; housing = [:]; growth = [:]
        activityCounts = [:]; gaps = [:]; territories = []; territoryOf = [:]; listings = []
        compare = []; pin = nil; around = nil
        let name = city.en
        do {
            async let shapes = api.districts(city: name)
            async let counts = api.counts(city: name)
            let (s, c) = try await (shapes, counts)
            guard token == loadToken else { return }
            self.shapes = s
            self.counts = Self.index(c, \.district_ar)
        } catch {
            guard token == loadToken else { return }
            self.error = error.localizedDescription
            loading = false
            return
        }
        loading = false
        dataVersion += 1

        // the rest fills in as it arrives; a layer that fails simply stays «غير متاح»
        async let summary = try? api.summary(city: name)
        async let audience = try? api.audience(city: name)
        async let income = try? api.income(city: name)
        async let housing = try? api.housing(city: name)
        async let growth = try? api.growth(city: name)
        let (sum, a, i, h, g) = await (summary, audience, income, housing, growth)
        guard token == loadToken else { return }
        self.summary = sum
        self.audience = Self.index(a ?? [], \.district_ar)
        self.income = Self.index(i ?? [], \.district_ar)
        self.housing = Self.index(h ?? [], \.district_ar)
        self.growth = Self.index(g ?? [], \.district_ar)
        if let activity, !(sum?.main_activities ?? []).contains(activity) { self.activity = nil }
        dataVersion += 1
    }

    func choose(activity: Activity) async {
        self.activity = activity
        guard let id = activity.main_id else { return }
        activityLoading = true
        let name = city.en
        async let counts = try? api.counts(city: name, mainId: id)
        async let gaps = try? api.gaps(city: name, mainId: id)
        let (c, g) = await (counts, gaps)
        guard name == city.en, id == self.activity?.main_id else { return }
        activityCounts = Self.index(c ?? [], \.district_ar)
        self.gaps = Self.index(g?.districts ?? [], \.district_ar)
        activityLoading = false
        dataVersion += 1
    }

    func loadTerritories() async {
        territoriesLoading = true
        let name = city.en, count = repCount, id = activity?.main_id
        let rows = try? await api.territories(city: name, count: count, weight: id == nil ? "population" : "businesses", mainId: id)
        guard name == city.en, count == repCount else { return }
        territories = rows ?? []
        var map: [String: Int] = [:]
        for t in territories { for d in t.districts { map[d.district_ar] = t.territory } }
        territoryOf = map
        territoriesLoading = false
        dataVersion += 1
    }

    func loadListings() async {
        listingsLoading = true
        let name = city.en, kind = listingKind, types = listingTypes.sorted(), deal = listingDeal
        let districtIDs = listingDistrictIDs.sorted(), minBeds = listingMinBeds, maxAge = listingMaxAge
        let maxPrice = listingMaxPrice, minDensity = listingMinDensity
        let result = try? await api.listings(city: name, kind: kind, types: types, deal: deal, districtIDs: districtIDs,
                                             minBeds: minBeds, maxAge: maxAge, maxPrice: maxPrice, minDensity: minDensity, limit: 600)
        guard name == city.en, kind == listingKind, types == listingTypes.sorted(), deal == listingDeal,
              districtIDs == listingDistrictIDs.sorted(), minBeds == listingMinBeds, maxAge == listingMaxAge,
              maxPrice == listingMaxPrice, minDensity == listingMinDensity else { return }
        // the server sends the best value first; keep the believable bargains only
        listings = Array((result?.rows ?? []).filter { row in
            row.check != true && row.vs_district_pct.map { Self.opportunityRange.contains($0) } == true
        }.prefix(Self.opportunityCount))
        listingsLoading = false
        dataVersion += 1
    }

    func place(pin coordinate: CLLocationCoordinate2D) async {
        pin = coordinate
        around = nil
        aroundLoading = true
        let result = try? await api.around(coordinate, radius: radius)
        guard pin?.latitude == coordinate.latitude, pin?.longitude == coordinate.longitude else { return }
        around = result
        aroundLoading = false
    }

    /// Adds a district to the comparison (up to four) and says whether it is now there.
    @discardableResult
    func addToCompare(_ name: String) -> Bool {
        if compare.contains(name) { return true }
        guard compare.count < 4 else { return false }
        compare.append(name)
        return true
    }

    private static func index<T>(_ rows: [T], _ key: KeyPath<T, String>) -> [String: T] {
        Dictionary(rows.map { ($0[keyPath: key], $0) }, uniquingKeysWith: { first, _ in first })
    }

    /// A camera that frames the city's districts: those whose centre lies within 1° of the median centre, then the
    /// 1st–99th percentile of their outline points, so one misplaced outline cannot zoom out to the whole country.
    var cityRegion: MKCoordinateRegion? {
        let centers = shapes.map(\.center)
        guard !centers.isEmpty else { return nil }
        let midLat = centers.map(\.latitude).sorted()[centers.count / 2]
        let midLon = centers.map(\.longitude).sorted()[centers.count / 2]
        let core = shapes.filter { abs($0.center.latitude - midLat) < 1 && abs($0.center.longitude - midLon) < 1 }
        let points = core.flatMap { $0.drawRings.flatMap { $0 } }
        guard points.count > 2 else { return nil }
        func range(_ values: [Double]) -> (Double, Double) {
            let sorted = values.sorted()
            return (sorted[Int(Double(sorted.count - 1) * 0.01)], sorted[Int(Double(sorted.count - 1) * 0.99)])
        }
        let (minLat, maxLat) = range(points.map(\.latitude))
        let (minLon, maxLon) = range(points.map(\.longitude))
        return MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2),
                                  span: MKCoordinateSpan(latitudeDelta: (maxLat - minLat) * 1.08, longitudeDelta: (maxLon - minLon) * 1.08))
    }

    /// A camera around one district.
    func region(of shape: DistrictShape) -> MKCoordinateRegion {
        let points = shape.drawRings.flatMap { $0 }
        let lats = points.map(\.latitude), lons = points.map(\.longitude)
        guard let minLat = lats.min(), let maxLat = lats.max(), let minLon = lons.min(), let maxLon = lons.max() else {
            return MKCoordinateRegion(center: shape.center, latitudinalMeters: 3000, longitudinalMeters: 3000)
        }
        return MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2),
                                  span: MKCoordinateSpan(latitudeDelta: max(0.01, (maxLat - minLat) * 1.6), longitudeDelta: max(0.01, (maxLon - minLon) * 1.6)))
    }
}
