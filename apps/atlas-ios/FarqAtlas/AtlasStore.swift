import SwiftUI
import MapKit
import Observation

/// A site the owner pinned, kept for side-by-side comparison in this session.
struct Site: Identifiable, Hashable {
    let id = UUID()
    let coordinate: CLLocationCoordinate2D
    let radius: Double
    let population: Double?
    let businesses: Double?
    var residentsPer: Double? {
        guard let population, let businesses, businesses > 0 else { return nil }
        return population / businesses
    }
    static func == (a: Site, b: Site) -> Bool { a.id == b.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

enum Route: Hashable {
    case cities, search, ranking, compare, sites, listing(Listing)
}

@MainActor
@Observable
final class AtlasStore {
    // place
    var cities: [City] = [City(en: "Riyadh", ar: "الرياض", districts: nil)]
    var city: City = City(en: "Riyadh", ar: "الرياض", districts: nil)
    var shapes: [DistrictShape] = []
    var summary: CitySummary?

    // lens
    var lens: Lens = .owners
    var metric: Metric = .shortfall
    var activity: Activity?

    // layers, keyed by the district's canonical Arabic name
    var counts: [String: DistrictCounts] = [:]
    var activityCounts: [String: DistrictCounts] = [:]
    var gaps: [String: Gap] = [:]
    var gapRate: Double?
    var audience: [String: Audience] = [:]
    var income: [String: Income] = [:]
    var housing: [String: Housing] = [:]
    var growth: [String: Growth] = [:]

    // selection
    var selected: DistrictShape?
    var compare: [DistrictShape] = []

    // owners: pin and range
    var pinMode = false
    var pin: CLLocationCoordinate2D?
    var radius: Double = 1000
    var around: Around?
    var aroundLoading = false
    var sites: [Site] = []

    // marketers: audience filters
    var segment: Segment = .everyone
    var minSaudi: Double = 0
    var minIncome: Double = 0

    // distributors: territories
    var showTerritories = false
    var territoryCount = 5
    var territoryWeight = "population"
    var territories: [Territory] = []
    var territoryOf: [String: Int] = [:]

    // real estate
    var listingKind = "rent"
    /// Only the opportunities: priced 10%–30% under their district median (past 30% is more often a typo than a bargain),
    /// so the lens answers «أي عرض يناسبني» without the person filtering thousands of ads.
    static let opportunityRange: ClosedRange<Double> = -30 ... -10
    static let opportunityCount = 40
    var listings: [Listing] = []
    var listingsLoading = false

    // panel
    var path = NavigationPath()
    var detent: PresentationDetent = .fraction(0.32)
    var loading = false
    var error: String?

    private let api = AtlasAPI.shared
    private var loadToken = UUID()

    // MARK: values

    /// The current metric for every district; missing figures are absent (→ «غير متاح»).
    func values(_ metric: Metric) -> [String: Double] {
        var out: [String: Double] = [:]
        for shape in shapes {
            if let v = value(metric, shape.name) { out[shape.name] = v }
        }
        return out
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

    /// Segment size of a district if it passes the filters; nil when it does not or a needed figure is unmeasured.
    func audienceSize(_ name: String) -> Double? {
        if minSaudi > 0 { guard let pct = audience[name]?.saudi_pct, pct >= minSaudi else { return nil } }
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

    // MARK: lens journey

    /// Where the person is in the active lens's numbered steps, read from what they have done so far.
    var lensStep: Int {
        switch lens {
        case .owners: return !sites.isEmpty ? 2 : pin != nil ? 1 : 0
        case .marketers: return selected != nil ? 1 : 0
        case .distributors: return metric == .underConstruction ? 1 : 0
        case .analysts: return compare.count >= 2 ? 1 : 0
        case .realEstate: return selected != nil ? 1 : 0
        }
    }

    /// A tap on a step takes the person to that step's tool.
    func goTo(step: Int) {
        switch (lens, step) {
        case (.owners, 0): pin = nil; around = nil; pinMode = false
        case (.owners, 1): pinMode = true; detent = .medium
        case (.owners, 2): if !sites.isEmpty { path.append(Route.sites); detent = .large }
        case (.distributors, 0): metric = .activityBusinesses
        case (.distributors, 1): metric = .underConstruction
        case (.analysts, 0): path.append(Route.ranking); detent = .large
        case (.analysts, 1): if compare.count >= 2 { path.append(Route.compare); detent = .large }
        case (_, 0): selected = nil
        default: break
        }
    }

    // MARK: lifecycle

    func start() async {
        if let rows = try? await api.cities(), !rows.isEmpty {
            cities = rows
            if let match = rows.first(where: { $0.en == city.en }) { city = match }
        }
        await load()
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-lens"), i + 1 < args.count, let lens = Lens(rawValue: args[i + 1]) { choose(lens: lens) }
        if let i = args.firstIndex(of: "-district"), i + 1 < args.count, let shape = shapes.first(where: { $0.name == args[i + 1] }) { select(shape) }
        if args.contains("-pin"), let center = cityRegion?.center { await place(pin: center) }
        if args.contains("-territories") { showTerritories = true; await loadTerritories() }
        if args.contains("-large") { detent = .large }
        if args.contains("-listing") { await loadListings(); if let first = listings.first { path.append(Route.listing(first)); detent = .large } }
        if args.contains("-compare") { compare = Array(shapes.sorted { $0.name < $1.name }.prefix(3)); path.append(Route.compare); detent = .large }
        #endif
    }

    func choose(city: City) async {
        guard city != self.city else { return }
        self.city = city
        selected = nil
        compare = []
        pin = nil
        around = nil
        sites = []
        await load()
    }

    func choose(lens: Lens) {
        self.lens = lens
        if !lens.metrics.contains(metric) { metric = lens.metrics[0] }
        pinMode = false
        Task {
            if lens == .realEstate && listings.isEmpty { await loadListings() }
            if lens == .distributors && showTerritories && territories.isEmpty { await loadTerritories() }
        }
    }

    func choose(activity: Activity) async {
        self.activity = activity
        await loadActivity()
        if showTerritories && territoryWeight == "businesses" { await loadTerritories() }
    }

    func select(_ shape: DistrictShape?) {
        selected = shape
        if shape != nil { detent = .medium }
    }

    func toggleCompare(_ shape: DistrictShape) {
        if let i = compare.firstIndex(where: { $0.id == shape.id }) { compare.remove(at: i) }
        else if compare.count < 4 { compare.append(shape) }
    }

    func load() async {
        let token = UUID()
        loadToken = token
        loading = true
        error = nil
        shapes = []; counts = [:]; summary = nil
        activityCounts = [:]; gaps = [:]; audience = [:]; income = [:]; housing = [:]; growth = [:]
        territories = []; territoryOf = [:]; listings = []
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

        // the rest fills in as it arrives; each layer that fails simply stays «غير متاح»
        async let summary = try? api.summary(city: name)
        async let audience = try? api.audience(city: name)
        async let income = try? api.income(city: name)
        async let housing = try? api.housing(city: name)
        async let growth = try? api.growth(city: name)
        let sum = await summary
        guard token == loadToken else { return }
        self.summary = sum
        if activity == nil || !(sum?.main_activities ?? []).contains(activity!) { activity = sum?.main_activities?.first }
        async let activityLoad: Void = loadActivity()
        let (a, i, h, g) = await (audience, income, housing, growth)
        guard token == loadToken else { return }
        self.audience = Self.index(a ?? [], \.district_ar)
        self.income = Self.index(i ?? [], \.district_ar)
        self.housing = Self.index(h ?? [], \.district_ar)
        self.growth = Self.index(g ?? [], \.district_ar)
        await activityLoad
        if lens == .realEstate { await loadListings() }
        if lens == .distributors && showTerritories { await loadTerritories() }
    }

    func loadActivity() async {
        guard let id = activity?.main_id else { activityCounts = [:]; gaps = [:]; return }
        let name = city.en
        async let counts = try? api.counts(city: name, mainId: id)
        async let gaps = try? api.gaps(city: name, mainId: id)
        let (c, g) = await (counts, gaps)
        guard name == city.en, id == activity?.main_id else { return }
        activityCounts = Self.index(c ?? [], \.district_ar)
        self.gaps = Self.index(g?.districts ?? [], \.district_ar)
        gapRate = g?.residents_per_business
    }

    func loadTerritories() async {
        var body = (city: city.en, count: territoryCount, weight: territoryWeight)
        if territoryWeight == "businesses" && activity?.main_id == nil { body.weight = "population" }
        let rows: [Territory]
        do { rows = try await api.territories(city: body.city, count: body.count, weight: body.weight) }
        catch { return }
        guard body.city == city.en else { return }
        territories = rows
        var map: [String: Int] = [:]
        for t in rows { for d in t.districts { map[d.district_ar] = t.territory } }
        territoryOf = map
    }

    func loadListings() async {
        listingsLoading = true
        let name = city.en
        let result = try? await api.listings(city: name, kind: listingKind, types: nil, maxPrice: nil, limit: 400)
        guard name == city.en else { return }
        // the server sends the best value first; keep the believable bargains only
        listings = Array((result?.rows ?? []).filter { row in
            row.check != true && row.vs_district_pct.map { Self.opportunityRange.contains($0) } == true
        }.prefix(Self.opportunityCount))
        listingsLoading = false
    }

    func place(pin coordinate: CLLocationCoordinate2D) async {
        pin = coordinate
        around = nil
        aroundLoading = true
        detent = .medium
        around = try? await api.around(coordinate, radius: radius)
        aroundLoading = false
    }

    func saveSite() {
        guard let pin, let around else { return }
        sites.append(Site(coordinate: pin, radius: radius, population: around.population, businesses: around.businesses))
        if sites.count > 4 { sites.removeFirst() }
    }

    func district(at coordinate: CLLocationCoordinate2D) -> DistrictShape? {
        shapes.first { $0.contains(coordinate) }
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
        let points = core.flatMap { $0.polygons.compactMap(\.first).flatMap { $0 } }
        guard points.count > 2 else { return nil }
        func range(_ values: [Double]) -> (Double, Double) {
            let sorted = values.sorted()
            return (sorted[Int(Double(sorted.count - 1) * 0.01)], sorted[Int(Double(sorted.count - 1) * 0.99)])
        }
        let (minLat, maxLat) = range(points.map(\.latitude))
        let (minLon, maxLon) = range(points.map(\.longitude))
        return MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2 - (maxLat - minLat) * 0.18, longitude: (minLon + maxLon) / 2),
            span: MKCoordinateSpan(latitudeDelta: (maxLat - minLat) * 1.7, longitudeDelta: (maxLon - minLon) * 1.15))
    }
}
