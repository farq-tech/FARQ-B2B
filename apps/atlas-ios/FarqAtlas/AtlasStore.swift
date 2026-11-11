import SwiftUI
import MapKit
import Observation

/// Where a flow screen leads (docs/atlas-ios-flows.md). Each flow is at most three screens.
enum Route: Hashable {
    case ownerActivity, ownerDistricts, ownerDistrict(String)
    case marketerAudience, marketerDistricts, marketerDistrict(String)
    case distributorSetup, distributorRegions, distributorRegion(Int)
    case analystTable, compare
    case realEstateKind, realEstateDeals, listing(Listing), listingCluster([Listing])
}

/// The data of one city and the choices made inside the flows. No layout state lives here.
@MainActor
@Observable
final class AtlasStore {
    // place
    var cities: [City] = [City(en: "Riyadh", ar: "الرياض", districts: nil)]
    var citiesLoading = false
    var citiesError: String?
    var city: City = City(en: "Riyadh", ar: "الرياض", districts: nil)
    var shapes: [DistrictShape] = []
    private(set) var geometryVersion = 0
    private(set) var territoryVersion = 0
    private(set) var cityRegion: MKCoordinateRegion?
    var summary: CitySummary?
    var loading = false
    var error: String?
    var summaryLoading = false
    var summaryError: String?

    // layers, keyed by the district's canonical Arabic name
    var counts: [String: DistrictCounts] = [:]
    var audience: [String: Audience] = [:]
    var income: [String: Income] = [:]
    var housing: [String: Housing] = [:]
    var growth: [String: Growth] = [:]
    var audienceLoading = false
    var incomeLoading = false
    var layersLoading = false
    var audienceAvailable: Bool?
    var incomeAvailable: Bool?
    var housingAvailable: Bool?
    var growthAvailable: Bool?
    var layerErrors: [String: String] = [:]
    private var pendingLayerLoads = 0
    private var layerTasks: [Task<Void, Never>] = []

    // the chosen activity (owners, distributors)
    var activity: Activity?
    var activityCounts: [String: DistrictCounts] = [:]
    var gaps: [String: Gap] = [:]
    var gapFitScoresFromService = false
    var activityLoading = false
    var activityError: String?

    // owners: the exact spot
    var pin: CLLocationCoordinate2D?
    var around: Around?
    var aroundLoading = false
    var aroundError: String?
    let radius: Double = 1000

    // marketers
    var segment: Segment = .everyone
    var minIncome: Double = 0

    // distributors
    var repCount = 5
    var territories: [Territory] = []
    var territoryOf: [String: Int] = [:]
    var territoriesLoading = false
    var territoriesError: String?
    private var territoriesToken = UUID()

    // analysts and every «قارن مع حي آخر»
    var compare: [String] = []

    // real estate
    var listingKind = "rent"
    static let opportunityRange: ClosedRange<Double> = -30 ... -10
    // Keep each response and its listing rows light; users can request the next page explicitly.
    static let listingPageSize = 20
    var listings: [Listing] = []
    var listingsTotal = 0
    private var listingsLoadedCount = 0
    var listingsHasMore = false
    var listingsRetrieved: String?
    var listingsLoading = false
    var listingsError: String?
    private var listingsToken = UUID()

    var path = NavigationPath()

    /// Bumped whenever source data changes so dependent values and score caches can be refreshed.
    private(set) var dataVersion = 0
    @ObservationIgnored private var marketFitCache = VersionedMarketFitCache()

    private let api: AtlasAPI
    private var loadToken = UUID()
    private var cityDataLoadTask: Task<[DistrictShape], Error>?
    private var citiesTask: Task<Void, Never>?
    private var citiesToken = UUID()

    init(api: AtlasAPI = .shared) {
        self.api = api
    }

    // MARK: lookups

    func shape(named name: String) -> DistrictShape? { shapes.first { $0.name == name } }

    func district(at coordinate: CLLocationCoordinate2D) -> DistrictShape? {
        // Match the map's polygon draw order: when source outlines overlap, the last rendered shape
        // is the visible one and must receive the tap as well.
        shapes.reversed().first { $0.contains(coordinate) }
    }

    func value(_ metric: Metric, _ name: String) -> Double? {
        switch metric {
        case .shortfall: return gaps[name]?.shortfall
        case .marketFit: return marketFitScore(name)
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
        if metric == .marketFit { return marketFitScores() }
        var out: [String: Double] = [:]
        for shape in shapes { if let v = value(metric, shape.name) { out[shape.name] = v } }
        return out
    }

    /// The districts ranked by a metric, highest first; districts without the figure are left out.
    func ranked(_ metric: Metric, ascending: Bool = false) -> [(shape: DistrictShape, value: Double)] {
        let metricValues = metric == .marketFit ? marketFitScores() : nil
        return shapes.compactMap { shape in
            let metricValue: Double?
            if metric == .marketFit { metricValue = metricValues?[shape.name] }
            else { metricValue = value(metric, shape.name) }
            return metricValue.map { (shape, $0) }
        }.sorted { ascending ? $0.value < $1.value : $0.value > $1.value }
    }

    /// Score out of 100 within the city for a district on a metric.
    func score(_ metric: Metric, _ name: String) -> Double? {
        if metric == .marketFit { return marketFitScore(name) }
        return Quintiles.score(value(metric, name), among: Array(values(metric).values))
    }

    /// Worker income is the only available purchasing-power input; no housing proxy stands in for missing income.
    var purchasingPowerLabel: String { "دخل العامل" }

    func purchasingPower(_ name: String) -> Double? {
        MarketFitScorer.measuredPurchasingPower(income: income[name]?.income_all)
    }

    /// 50% unmet-activity rank + 50% purchasing-power rank, each relative to the same city.
    /// Missing either source leaves the score unavailable instead of treating it as zero.
    func marketFitScore(_ name: String) -> Double? {
        marketFitScores()[name]
    }

    private func marketFitScores() -> [String: Double] {
        if let cached = marketFitCache.values(for: dataVersion) { return cached }
        if gapFitScoresFromService {
            var scores: [String: Double] = [:]
            for (name, gap) in gaps {
                guard let score = gap.fit_score, score.isFinite, (0...100).contains(score) else { continue }
                scores[name] = score
            }
            marketFitCache.store(scores, for: dataVersion)
            return scores
        }
        var demandByDistrict: [String: Double] = [:]
        var purchasingPowerByDistrict: [String: Double] = [:]
        for (name, gap) in gaps {
            if let demand = gap.shortfall { demandByDistrict[name] = demand }
        }
        for shape in shapes {
            if let power = purchasingPower(shape.name) { purchasingPowerByDistrict[shape.name] = power }
        }
        let scores = MarketFitScorer.scores(demandByDistrict: demandByDistrict,
                                           purchasingPowerByDistrict: purchasingPowerByDistrict)
        marketFitCache.store(scores, for: dataVersion)
        return scores
    }

    /// Segment size of a district if it passes the income bar; nil when it does not or a needed figure is unmeasured.
    func audienceSize(_ name: String) -> Double? {
        if minIncome > 0 { guard let pay = audienceIncome(name), pay >= minIncome else { return nil } }
        switch segment {
        case .everyone: return counts[name]?.population
        case .men: return audience[name]?.men
        case .women: return audience[name]?.women
        case .saudi: return audience[name]?.saudi
        case .nonSaudi: return audience[name]?.non_saudi
        }
    }

    func audienceIncome(_ name: String) -> Double? {
        income[name]?.workingIncome(for: segment)
    }

    func hasIncome(for segment: Segment) -> Bool {
        incomeAvailable == true && income.values.contains { $0.workingIncome(for: segment) != nil }
    }

    private var audienceEligibleNames: [String]? {
        guard !shapes.isEmpty else { return nil }
        if minIncome == 0 { return shapes.map(\.name) }
        var names: [String] = []
        for shape in shapes {
            guard let pay = audienceIncome(shape.name) else { return nil }
            if pay >= minIncome { names.append(shape.name) }
        }
        return names
    }

    var audienceEligibleDistrictCount: Int? { audienceEligibleNames?.count }

    var audienceTotal: Double? {
        guard let names = audienceEligibleNames else { return nil }
        return AudienceCoverage.total(names.map { audienceSize($0) }, eligibleDistrictCount: names.count)
    }

    var hasAudience: Bool { audienceAvailable == true && !audience.isEmpty }
    var hasIncome: Bool { incomeAvailable == true && !income.isEmpty }
    var failedLayerNames: [String] {
        ["counts", "audience", "income", "housing", "growth"].filter { layerErrors[$0] != nil }
    }
    var layersError: String? {
        let labels = failedLayerNames.compactMap { key -> String? in
            switch key {
            case "counts": return "عدادات الأحياء"
            case "audience": return "قياسات الجمهور"
            case "income": return "بيانات الدخل"
            case "housing": return "مستوى السكن"
            case "growth": return "البناء والنمو"
            default: return nil
            }
        }
        guard !labels.isEmpty else { return nil }
        return "تعذر تحميل \(labels.joined(separator: "، ")). أعد المحاولة لعرضها بدل اعتبارها غير متاحة."
    }

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
        citiesTask?.cancel()
        citiesTask = nil
        loading = true
        summaryLoading = true
        error = nil
        summaryError = nil
        let token = beginCityCatalogLoad()
        guard await fetchCityCatalog(token: token) else {
            loading = false
            summaryLoading = false
            guard !Task.isCancelled else { return }
            error = "تعذر التحقق من عدد أحياء المدينة. تحقق من اتصالك ثم أعد المحاولة."
            return
        }
        guard city.districts != nil else {
            loading = false
            summaryLoading = false
            error = "عدد أحياء المدينة غير متاح؛ لم نعرض خريطة قد تكون ناقصة. أعد تحميل قائمة المدن."
            return
        }
        await load()
    }

    func retryCities() {
        citiesTask?.cancel()
        let needsInitialLoad = city.districts == nil
        let token = beginCityCatalogLoad()
        citiesTask = Task { [weak self] in
            guard let self else { return }
            let loaded = await self.fetchCityCatalog(token: token)
            guard loaded, needsInitialLoad, self.city.districts != nil, !Task.isCancelled else { return }
            await self.load()
        }
    }

    private func beginCityCatalogLoad() -> UUID {
        let token = UUID()
        citiesToken = token
        citiesLoading = true
        citiesError = nil
        return token
    }

    private func fetchCityCatalog(token: UUID) async -> Bool {
        do {
            let rows = try await api.cities()
            guard token == citiesToken, !Task.isCancelled else { return false }
            cities = rows
            if let match = rows.first(where: { $0.en == city.en }) { city = match }
            citiesError = nil
            citiesLoading = false
            return true
        } catch {
            guard token == citiesToken else { return false }
            citiesLoading = false
            guard !Task.isCancelled else { return false }
            citiesError = "تعذر تحميل قائمة المدن. تحقق من اتصالك ثم أعد المحاولة."
            return false
        }
    }

    func choose(city: City) async {
        guard city != self.city else { return }
        self.city = city
        await load()
    }

    func load() async {
        cityDataLoadTask?.cancel()
        cityDataLoadTask = nil
        layerTasks.forEach { $0.cancel() }
        layerTasks.removeAll()
        pendingLayerLoads = 0
        layersLoading = false
        let token = UUID()
        loadToken = token
        loading = true
        error = nil
        summaryLoading = true
        summaryError = nil
        activityLoading = false
        activityError = nil
        territoriesLoading = false
        territoriesError = nil
        listingsLoading = false
        listingsError = nil
        listingsToken = UUID()
        aroundLoading = false
        aroundError = nil
        shapes = []; geometryVersion += 1; territoryVersion += 1
        cityRegion = nil; counts = [:]; summary = nil; audience = [:]; income = [:]; housing = [:]; growth = [:]
        activityCounts = [:]; gaps = [:]; gapFitScoresFromService = false; territories = []; territoryOf = [:]; listings = []; listingsTotal = 0; listingsLoadedCount = 0; listingsHasMore = false; listingsRetrieved = nil
        audienceLoading = false; incomeLoading = false
        audienceAvailable = nil; incomeAvailable = nil; housingAvailable = nil; growthAvailable = nil
        layerErrors = [:]
        compare = []; pin = nil; around = nil
        dataVersion += 1
        let name = city.en
        guard let expectedDistrictCount = city.districts else {
            error = "عدد أحياء المدينة غير متاح؛ لم نعرض خريطة قد تكون ناقصة. أعد تحميل قائمة المدن."
            summaryLoading = false
            loading = false
            return
        }
        let cityDataTask = Task { () throws -> [DistrictShape] in
            try await api.districts(city: name, expectedCount: expectedDistrictCount)
        }
        cityDataLoadTask = cityDataTask
        do {
            let s = try await cityDataTask.value
            guard token == loadToken else { return }
            cityDataLoadTask = nil
            self.shapes = s
            geometryVersion += 1
            self.cityRegion = Self.makeCityRegion(for: s)
        } catch {
            guard token == loadToken else { return }
            cityDataLoadTask = nil
            self.error = error.localizedDescription
            summaryLoading = false
            summaryError = "تعذر تحميل بيانات المدينة. تحقق من اتصالك ثم أعد المحاولة."
            loading = false
            return
        }
        loading = false
        dataVersion += 1

        let selectedActivity = activity
        pendingLayerLoads = 6
        layersLoading = true
        summaryLoading = true
        summaryError = nil
        audienceLoading = true
        incomeLoading = true

        // Each optional source is committed as soon as it returns; one slow metric must not hold back the city summary
        // or the other layers. The token prevents a late response from an older city replacing current data.
        let api = self.api
        layerTasks = [
            Task { [weak self] in
                guard let self else { return }
                await self.fetchCounts(city: name, token: token, initial: true)
            },
            Task { [weak self] in
                let result = try? await api.summary(city: name)
                guard let self, !Task.isCancelled, token == self.loadToken else { return }
                self.summary = result
                self.summaryLoading = false
                self.summaryError = result == nil ? "تعذر تحميل الأنشطة. تحقق من اتصالك ثم أعد المحاولة." : nil
                self.finishLayerLoad(token)
                if let selectedActivity,
                   selectedActivity.query == nil,
                   !(result?.main_activities ?? []).contains(selectedActivity) {
                    self.activity = nil
                } else if let selectedActivity {
                    await self.choose(activity: selectedActivity)
                }
            },
            Task { [weak self] in
                guard let self else { return }
                await self.fetchAudience(city: name, token: token, initial: true)
            },
            Task { [weak self] in
                guard let self else { return }
                await self.fetchIncome(city: name, token: token, initial: true)
            },
            Task { [weak self] in
                guard let self else { return }
                await self.fetchHousing(city: name, token: token, initial: true)
            },
            Task { [weak self] in
                guard let self else { return }
                await self.fetchGrowth(city: name, token: token, initial: true)
            },
        ]
    }

    private func fetchCounts(city name: String, token: UUID, initial: Bool = false) async {
        do {
            let result = try await api.counts(city: name)
            guard token == loadToken else { return }
            counts = Self.index(result, \.district_ar)
            layerErrors.removeValue(forKey: "counts")
        } catch {
            guard token == loadToken else { return }
            layerErrors["counts"] = "تعذر تحميل عدادات الأحياء في \(city.name)."
        }
        if initial { finishLayerLoad(token) }
    }

    private func fetchAudience(city name: String, token: UUID, initial: Bool = false) async {
        do {
            let result = try await api.audience(city: name)
            guard token == loadToken else { return }
            audienceAvailable = result.hasSource
            audience = result.hasSource ? Self.index(result.districts, \.district_ar) : [:]
            layerErrors.removeValue(forKey: "audience")
        } catch {
            guard token == loadToken else { return }
            layerErrors["audience"] = "تعذر تحميل قياسات الجنس والجنسية في \(city.name)."
        }
        audienceLoading = false
        if initial { finishLayerLoad(token) }
    }

    private func fetchIncome(city name: String, token: UUID, initial: Bool = false) async {
        do {
            let result = try await api.income(city: name)
            guard token == loadToken else { return }
            incomeAvailable = result.hasSource
            income = result.hasSource ? Self.index(result.districts, \.district_ar) : [:]
            layerErrors.removeValue(forKey: "income")
        } catch {
            guard token == loadToken else { return }
            layerErrors["income"] = "تعذر تحميل بيانات الدخل في \(city.name)."
        }
        incomeLoading = false
        if initial { finishLayerLoad(token) }
    }

    private func fetchHousing(city name: String, token: UUID, initial: Bool = false) async {
        do {
            let result = try await api.housing(city: name)
            guard token == loadToken else { return }
            housingAvailable = result.hasSource
            housing = result.hasSource ? Self.index(result.districts, \.district_ar) : [:]
            layerErrors.removeValue(forKey: "housing")
        } catch {
            guard token == loadToken else { return }
            layerErrors["housing"] = "تعذر تحميل بيانات مستوى السكن في \(city.name)."
        }
        if initial { finishLayerLoad(token) }
    }

    private func fetchGrowth(city name: String, token: UUID, initial: Bool = false) async {
        do {
            let result = try await api.growth(city: name)
            guard token == loadToken else { return }
            growthAvailable = result.hasSource
            growth = result.hasSource ? Self.index(result.districts, \.district_ar) : [:]
            layerErrors.removeValue(forKey: "growth")
        } catch {
            guard token == loadToken else { return }
            layerErrors["growth"] = "تعذر تحميل بيانات البناء والنمو في \(city.name)."
        }
        if initial { finishLayerLoad(token) }
    }

    func retryFailedLayers() {
        let name = city.en, token = loadToken
        let failed = Set(failedLayerNames)
        guard !failed.isEmpty else { return }
        pendingLayerLoads = failed.count
        layersLoading = true
        if failed.contains("counts") {
            layerErrors.removeValue(forKey: "counts")
            layerTasks.append(Task { await fetchCounts(city: name, token: token, initial: true) })
        }
        if failed.contains("audience") {
            layerErrors.removeValue(forKey: "audience")
            audienceLoading = true
            layerTasks.append(Task { await fetchAudience(city: name, token: token, initial: true) })
        }
        if failed.contains("income") {
            layerErrors.removeValue(forKey: "income")
            incomeLoading = true
            layerTasks.append(Task { await fetchIncome(city: name, token: token, initial: true) })
        }
        if failed.contains("housing") {
            layerErrors.removeValue(forKey: "housing")
            layerTasks.append(Task { await fetchHousing(city: name, token: token, initial: true) })
        }
        if failed.contains("growth") {
            layerErrors.removeValue(forKey: "growth")
            layerTasks.append(Task { await fetchGrowth(city: name, token: token, initial: true) })
        }
    }

    private func finishLayerLoad(_ token: UUID) {
        guard token == loadToken else { return }
        pendingLayerLoads = max(0, pendingLayerLoads - 1)
        if pendingLayerLoads == 0 { layersLoading = false }
        dataVersion += 1
    }

    func retrySummary() async {
        let name = city.en, token = loadToken
        summaryLoading = true
        summaryError = nil
        let result = try? await api.summary(city: name)
        guard token == loadToken else { return }
        summary = result
        summaryLoading = false
        summaryError = result == nil ? "تعذر تحميل الأنشطة. تحقق من اتصالك ثم أعد المحاولة." : nil
    }

    func suggestActivity(_ query: String) async throws -> Activity? {
        let response = try await api.searchActivity(city: city.en, query: query)
        return try response.suggestion(query: query)
    }

    func choose(activity: Activity) async {
        self.activity = activity
        activityCounts = [:]
        gaps = [:]
        gapFitScoresFromService = false
        dataVersion += 1
        activityError = nil
        guard activity.main_id != nil || activity.query != nil else {
            activityLoading = false
            activityError = "تعذر تحديد هذا النشاط. اختر نشاطًا آخر."
            return
        }
        activityLoading = true
        let name = city.en
        async let counts = try? api.counts(city: name, mainId: activity.main_id, query: activity.query)
        async let gaps = try? api.gaps(city: name, mainId: activity.main_id, query: activity.query)
        let (c, g) = await (counts, gaps)
        guard name == city.en, activity == self.activity else { return }
        activityCounts = Self.index(c ?? [], \.district_ar)
        self.gaps = Self.index(g?.districts ?? [], \.district_ar)
        self.gapFitScoresFromService = g?.fit_sample_districts != nil
        activityLoading = false
        activityError = c == nil || g == nil ? "تعذر تحميل بيانات النشاط. تحقق من اتصالك ثم أعد المحاولة." : nil
        dataVersion += 1
    }

    func retryActivity() async {
        guard let activity else { return }
        await choose(activity: activity)
    }

    func loadTerritories() async {
        let token = UUID()
        territoriesToken = token
        territoriesLoading = true
        territoriesError = nil
        let name = city.en, count = repCount, id = activity?.main_id, query = activity?.query
        territories = []
        territoryOf = [:]
        territoryVersion += 1
        let rows = try? await api.territories(city: name, count: count, weight: id == nil && query == nil ? "population" : "businesses", mainId: id, query: query)
        guard token == territoriesToken, name == city.en, count == repCount,
              id == activity?.main_id, query == activity?.query else { return }
        territories = rows ?? []
        territoriesError = rows == nil ? "تعذر تحميل تقسيم المناطق. تحقق من اتصالك ثم أعد المحاولة." : nil
        var map: [String: Int] = [:]
        for t in territories { for d in t.districts { map[d.district_ar] = t.territory } }
        territoryOf = map
        territoryVersion += 1
        territoriesLoading = false
        dataVersion += 1
    }

    func loadListings(types: [String]? = nil, deal: String? = nil, maxPrice: Double? = nil,
                      districtIDs: [String]? = nil, minimumBeds: Double? = nil, maxAge: Double? = nil,
                      appending: Bool = false) async {
        let token = UUID()
        listingsToken = token
        listingsLoading = true
        listingsError = nil
        if !appending {
            listings = []
            listingsTotal = 0
            listingsLoadedCount = 0
            listingsHasMore = false
            listingsRetrieved = nil
        }
        let name = city.en, kind = listingKind
        let offset = appending ? listingsLoadedCount : 0
        let result: (retrieved: String?, total: Int, offset: Int, rows: [Listing])?
        var paginationUnavailable = false
        do {
            result = try await api.listings(city: name, kind: kind, types: types, deal: deal, maxPrice: maxPrice,
                                            districtIDs: districtIDs, minimumBeds: minimumBeds, maxAge: maxAge,
                                            minDiscountPct: Self.opportunityRange.lowerBound,
                                            maxDiscountPct: Self.opportunityRange.upperBound, limit: Self.listingPageSize, offset: offset)
        } catch APIError.listingsPaginationUnsupported {
            result = nil
            paginationUnavailable = true
        } catch {
            result = nil
        }
        guard token == listingsToken, name == city.en, kind == listingKind else { return }
        if let result, appending, (result.total != listingsTotal || result.retrieved != listingsRetrieved) {
            listingsLoading = false
            listingsError = "تغيّرت عينة العروض أثناء التحميل؛ أعد تحميلها قبل المتابعة."
            return
        }
        let page = (result?.rows ?? []).filter { row in
            row.check != true && row.vs_district_pct.map { Self.opportunityRange.contains($0) } == true
        }
        listings = (appending ? listings : []) + page
        if let result {
            listingsTotal = result.total
            listingsLoadedCount = offset + result.rows.count
            listingsHasMore = listingsLoadedCount < result.total
            listingsRetrieved = result.retrieved
        }
        listingsLoading = false
        listingsError = result == nil
            ? (paginationUnavailable ? APIError.listingsPaginationUnsupported.localizedDescription : "تعذر تحميل العروض. تحقق من اتصالك ثم أعد المحاولة.")
            : nil
        dataVersion += 1
    }

    func place(pin coordinate: CLLocationCoordinate2D) async {
        pin = coordinate
        around = nil
        aroundLoading = true
        aroundError = nil
        let result = try? await api.around(coordinate, radius: radius)
        guard pin?.latitude == coordinate.latitude, pin?.longitude == coordinate.longitude else { return }
        around = result
        aroundLoading = false
        aroundError = result == nil ? "تعذر حساب بيانات الموقع. تحقق من الاتصال ثم أعد المحاولة." : nil
    }

    func retryAround() async {
        guard let pin else { return }
        await place(pin: pin)
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
    private static func makeCityRegion(for shapes: [DistrictShape]) -> MKCoordinateRegion? {
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
