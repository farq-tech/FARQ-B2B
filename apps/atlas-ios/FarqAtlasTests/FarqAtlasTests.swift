import XCTest
import CoreLocation
import UIKit
@testable import FarqAtlas

private final class DelayedCityURLProtocol: URLProtocol {
    private final class State: @unchecked Sendable {
        let lock = NSLock()
        var firstDistrictStarted = false
        var firstDistrictCancelled = false
        var delayNextCounts = false
        var slowCountsStarted = false
        var slowCountsCancelled = false
        var delayCityCatalog = false
        var cityCatalogStarted = false
        var cityCatalogCompleted = false
        var districtRequestedBeforeCatalog = false
    }

    private static let state = State()
    private let instanceLock = NSLock()
    private var delayedFirstDistrict = false
    private var delayedSlowCounts = false
    private var delayedResponse: DispatchWorkItem?
    private var stopped = false

    static func reset(delayCounts: Bool = false, delayCatalog: Bool = false) {
        state.lock.lock()
        state.firstDistrictStarted = false
        state.firstDistrictCancelled = false
        state.delayNextCounts = delayCounts
        state.slowCountsStarted = false
        state.slowCountsCancelled = false
        state.delayCityCatalog = delayCatalog
        state.cityCatalogStarted = false
        state.cityCatalogCompleted = false
        state.districtRequestedBeforeCatalog = false
        state.lock.unlock()
    }

    static var didStartCityCatalog: Bool {
        state.lock.lock()
        defer { state.lock.unlock() }
        return state.cityCatalogStarted
    }

    static var didRequestDistrictsBeforeCityCatalog: Bool {
        state.lock.lock()
        defer { state.lock.unlock() }
        return state.districtRequestedBeforeCatalog
    }

    private static func beginDelayedCountsIfRequested() -> Bool {
        state.lock.lock()
        defer { state.lock.unlock() }
        guard state.delayNextCounts, !state.slowCountsStarted else { return false }
        state.slowCountsStarted = true
        return true
    }

    static var didStartFirstDistrict: Bool {
        state.lock.lock()
        defer { state.lock.unlock() }
        return state.firstDistrictStarted
    }

    static var didCancelFirstDistrict: Bool {
        state.lock.lock()
        defer { state.lock.unlock() }
        return state.firstDistrictCancelled
    }

    static var didStartSlowCounts: Bool {
        state.lock.lock()
        defer { state.lock.unlock() }
        return state.slowCountsStarted
    }

    static var didCancelSlowCounts: Bool {
        state.lock.lock()
        defer { state.lock.unlock() }
        return state.slowCountsCancelled
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "atlas.farq.sa"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
        let city = components?.queryItems?.first(where: { $0.name == "city" })?.value
        let resource = request.url?.lastPathComponent ?? ""
        if resource == "cities" {
            Self.state.lock.lock()
            Self.state.cityCatalogStarted = true
            let delay = Self.state.delayCityCatalog
            Self.state.lock.unlock()
            let complete: () -> Void = { [weak self] in
                Self.state.lock.lock()
                Self.state.cityCatalogCompleted = true
                Self.state.lock.unlock()
                self?.finish(with: #"[{"en":"Riyadh","ar":"الرياض","districts":1}]"#)
            }
            if delay { DispatchQueue.global().asyncAfter(deadline: .now() + 0.2, execute: complete) }
            else { complete() }
            return
        }
        if resource == "districts" {
            Self.state.lock.lock()
            if !Self.state.cityCatalogCompleted { Self.state.districtRequestedBeforeCatalog = true }
            Self.state.lock.unlock()
        }
        if resource == "district-counts", Self.beginDelayedCountsIfRequested() {
            delayedSlowCounts = true
            scheduleResponse(after: 5) { $0.finish(with: #"{"districts":[{"district_ar":"حي الاختبار","n":7}]}"#) }
            return
        }
        if resource == "districts", city == "AtlasDelayedFirst" {
            delayedFirstDistrict = true
            Self.state.lock.lock()
            Self.state.firstDistrictStarted = true
            Self.state.lock.unlock()
            scheduleResponse(after: 5) { $0.finish(with: #"{"type":"FeatureCollection","features":[]}"#) }
            return
        }

        let body: String
        switch resource {
        case "districts" where city?.hasPrefix("AtlasSlowCounts-") == true:
            body = #"{"type":"FeatureCollection","features":[{"type":"Feature","id":"1","properties":{"id":"1","ar":"حي الاختبار"},"geometry":{"type":"Polygon","coordinates":[[[46,24],[46.1,24],[46.1,24.1],[46,24.1],[46,24]]]}}]}"#
        case "districts": body = #"{"type":"FeatureCollection","features":[]}"#
        case "district-counts": body = #"{"districts":[]}"#
        case "market-summary": body = #"{"summary":{"total":0,"main_activities":[]}}"#
        default: body = #"{"available":false,"districts":[]}"#
        }
        finish(with: body)
    }

    override func stopLoading() {
        instanceLock.lock()
        stopped = true
        let response = delayedResponse
        delayedResponse = nil
        instanceLock.unlock()
        response?.cancel()
        if delayedFirstDistrict {
            Self.state.lock.lock()
            Self.state.firstDistrictCancelled = true
            Self.state.lock.unlock()
        }
        if delayedSlowCounts {
            Self.state.lock.lock()
            Self.state.slowCountsCancelled = true
            Self.state.lock.unlock()
        }
    }

    private func scheduleResponse(after delay: TimeInterval, action: @escaping (DelayedCityURLProtocol) -> Void) {
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            action(self)
        }
        instanceLock.lock()
        delayedResponse = work
        instanceLock.unlock()
        DispatchQueue.global().asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func finish(with body: String) {
        instanceLock.lock()
        let shouldFinish = !stopped
        instanceLock.unlock()
        guard shouldFinish, let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"]) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

private final class AdvisorAuthURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "atlas.farq.sa" && request.url?.path == "/api/advisor"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: 401, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"]) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"error":"سجّل الدخول لاستخدام المستشار."}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

final class FarqAtlasTests: XCTestCase {
    @MainActor
    func testChangingCityCancelsSupersededDistrictRequest() async {
        DelayedCityURLProtocol.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DelayedCityURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let cacheDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("farq-atlas-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: cacheDirectory) }
        let store = AtlasStore(api: AtlasAPI(session: session, cacheDirectory: cacheDirectory))
        let first = City(en: "AtlasDelayedFirst", ar: "مدينة اختبار أولى", districts: 0)
        let second = City(en: "AtlasImmediateSecond", ar: "مدينة اختبار ثانية", districts: 0)

        let firstLoad = Task { await store.choose(city: first) }
        for _ in 0..<200 where !DelayedCityURLProtocol.didStartFirstDistrict {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertTrue(DelayedCityURLProtocol.didStartFirstDistrict, "the first city's boundary request should be in flight")

        await store.choose(city: second)
        for _ in 0..<200 where !DelayedCityURLProtocol.didCancelFirstDistrict {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertTrue(DelayedCityURLProtocol.didCancelFirstDistrict, "switching cities should cancel the superseded URLSession request")
        await firstLoad.value

        XCTAssertEqual(store.city.en, second.en)
        XCTAssertNil(store.error, "a cancelled old request must not surface as the new city's error")
        XCTAssertTrue(store.shapes.isEmpty, "the second city's explicit empty boundary set should remain empty")
        session.finishTasksAndInvalidate()
    }

    @MainActor
    func testSlowDistrictCountsDoNotBlockCityGeometry() async {
        DelayedCityURLProtocol.reset(delayCounts: true)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DelayedCityURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let cacheDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("farq-atlas-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: cacheDirectory) }
        let store = AtlasStore(api: AtlasAPI(session: session, cacheDirectory: cacheDirectory))
        let city = City(en: "AtlasSlowCounts-\(UUID().uuidString)", ar: "مدينة عدادات بطيئة", districts: 1)
        let nextCity = City(en: "AtlasImmediateSecond", ar: "مدينة اختبار ثانية", districts: 0)
        let started = Date()

        await store.choose(city: city)
        let geometryReadyIn = Date().timeIntervalSince(started)
        for _ in 0..<200 where !DelayedCityURLProtocol.didStartSlowCounts {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }

        XCTAssertTrue(DelayedCityURLProtocol.didStartSlowCounts, "the slow counts request should start independently")
        XCTAssertLessThan(geometryReadyIn, 2, "valid neighborhood outlines should become usable without waiting on counts")
        XCTAssertFalse(store.loading)
        XCTAssertEqual(store.shapes.count, 1)
        XCTAssertTrue(store.counts.isEmpty, "counts remain unavailable while their source is pending")
        XCTAssertTrue(store.layersLoading, "pending city metrics remain visible while the map is usable")

        await store.choose(city: nextCity)
        for _ in 0..<200 where !DelayedCityURLProtocol.didCancelSlowCounts {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertTrue(DelayedCityURLProtocol.didCancelSlowCounts, "switching cities should cancel the old optional counts request")
        XCTAssertEqual(store.city.en, nextCity.en)
        XCTAssertTrue(store.shapes.isEmpty)
        session.finishTasksAndInvalidate()
    }

    @MainActor
    func testABoundaryStartupWaitsForCityCatalogBeforeLoadingAndValidatingBoundaries() async {
        DelayedCityURLProtocol.reset(delayCatalog: true)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DelayedCityURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let cacheDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("farq-atlas-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: cacheDirectory) }
        let store = AtlasStore(api: AtlasAPI(session: session, cacheDirectory: cacheDirectory))

        await store.start()

        XCTAssertTrue(DelayedCityURLProtocol.didStartCityCatalog)
        XCTAssertFalse(DelayedCityURLProtocol.didRequestDistrictsBeforeCityCatalog,
                       "district geometry must wait until its canonical expected count is known")
        XCTAssertEqual(store.city.districts, 1)
        XCTAssertTrue(store.error?.contains("عدد حدود الأحياء لا يطابق") == true,
                       "a partial boundary response must be rejected against the count from the city catalog")
        XCTAssertTrue(store.shapes.isEmpty)
        XCTAssertFalse(store.loading)
    }

    func testRealEstateEmptyStateDistinguishesUnappliedFiltersPartialPagesAndExhaustedSearch() {
        XCTAssertTrue(ListingResultMessage.empty(filtersApplied: false, hasMore: true).contains("اضغط «اعرض أفضل العروض»"),
                      "stale results must not be presented as the result of filters that have not been applied")
        XCTAssertTrue(ListingResultMessage.empty(filtersApplied: true, hasMore: true).contains("حمّل المزيد"),
                      "no match in the loaded page must not imply there are no matching listings overall")
        XCTAssertTrue(ListingResultMessage.empty(filtersApplied: true, hasMore: false).contains("امسح الفلاتر"),
                      "after pagination ends, a zero-match result can suggest changing filters")
    }

    func testOfflineCacheNeverExceedsThePublishedDataFreshnessWindow() {
        XCTAssertTrue(APICachePolicy.isFresh(age: 0))
        XCTAssertTrue(APICachePolicy.isFresh(age: APICachePolicy.freshFor - 1))
        XCTAssertFalse(APICachePolicy.isFresh(age: APICachePolicy.freshFor))

        XCTAssertTrue(APICachePolicy.mayServeImmediately(age: APICachePolicy.freshFor), "a stale but permitted copy must not wait for the network")
        XCTAssertTrue(APICachePolicy.mayServeImmediately(age: APICachePolicy.offlineMaximumAge))
        XCTAssertFalse(APICachePolicy.mayServeImmediately(age: APICachePolicy.offlineMaximumAge + 1))
        XCTAssertFalse(APICachePolicy.mayServeImmediately(age: nil), "an unknown cache age is not assumed fresh")
        XCTAssertFalse(APICachePolicy.mayServeImmediately(age: -1), "a future modification date is not trusted")
    }

    func testCacheRejectsNonJSONAndNonContainerResponses() {
        XCTAssertTrue(APICachePolicy.isCacheableJSON(#"{"ok":true}"#.data(using: .utf8)!))
        XCTAssertTrue(APICachePolicy.isCacheableJSON(#"[{"id":1}]"#.data(using: .utf8)!))
        XCTAssertFalse(APICachePolicy.isCacheableJSON("<html>gateway error</html>".data(using: .utf8)!))
        XCTAssertFalse(APICachePolicy.isCacheableJSON("{broken".data(using: .utf8)!))
        XCTAssertFalse(APICachePolicy.isCacheableJSON("null".data(using: .utf8)!))
        XCTAssertFalse(APICachePolicy.isCacheableJSON("42".data(using: .utf8)!))
    }

    func testListingPagesRefreshOnlineToAvoidMixingMarketSnapshots() {
        XCTAssertTrue(APICachePolicy.refreshBeforeServingCachedResponse(resource: "real-estate-listings"))
        XCTAssertFalse(APICachePolicy.refreshBeforeServingCachedResponse(resource: "district-counts"))
    }

    func testHousingCacheRejectsLegacyMetricAndExposesItAsUnavailable() throws {
        let legacy = #"{"available":true,"districts":[{"district_ar":"العليا","villas":80,"dwelling_units":500,"villa_share_pct":16.0}]}"#.data(using: .utf8)!
        let corrected = #"{"available":true,"districts":[{"district_ar":"العليا","villa_share_pct":42.5,"villa_units":212,"classified_home_units":500}]}"#.data(using: .utf8)!
        let unavailable = #"{"available":false,"districts":[]}"#.data(using: .utf8)!
        let impossible = #"{"available":true,"districts":[{"district_ar":"العليا","villa_share_pct":42.5,"villa_units":501,"classified_home_units":500}]}"#.data(using: .utf8)!

        XCTAssertTrue(APICachePolicy.isValidResponse(legacy, resource: "housing-level"), "the known legacy schema is a usable response state")
        XCTAssertFalse(APICachePolicy.isValidCachedResponse(legacy, resource: "housing-level"), "do not serve the old buildings-to-dwellings ratio from cache")
        XCTAssertFalse(APICachePolicy.shouldCacheResponse(legacy, resource: "housing-level"))
        let legacyResult = try AtlasAPI.parseHousing(legacy)
        XCTAssertFalse(legacyResult.hasSource)
        XCTAssertTrue(legacyResult.districts.isEmpty)
        XCTAssertTrue(APICachePolicy.isValidResponse(corrected, resource: "housing-level"))
        XCTAssertTrue(APICachePolicy.isValidCachedResponse(corrected, resource: "housing-level"))
        XCTAssertTrue(try AtlasAPI.parseHousing(corrected).hasSource)
        XCTAssertTrue(APICachePolicy.isValidResponse(unavailable, resource: "housing-level"), "an explicit unavailable response is a valid server response")
        XCTAssertFalse(APICachePolicy.isValidCachedResponse(unavailable, resource: "housing-level"), "a temporary unavailable response must not replace a measured cache")
        XCTAssertFalse(APICachePolicy.shouldCacheResponse(unavailable, resource: "housing-level"))
        XCTAssertTrue(APICachePolicy.shouldCacheResponse(corrected, resource: "housing-level"))
        XCTAssertFalse(APICachePolicy.isValidCachedResponse(impossible, resource: "housing-level"), "villa units cannot exceed classified home units")
    }

    func testFiguresUseEnglishDigitsAndPercent() {
        XCTAssertEqual(Fmt.int(1234567.0), "\u{2066}1,234,567\u{2069}")
        XCTAssertEqual(Fmt.percent(48.4), "\u{2066}48%\u{2069}")
        XCTAssertEqual(Fmt.int(nil as Double?), "غير متاح")
        XCTAssertFalse(Fmt.int(9876.0).contains("٩"))
    }

    func testFixedNumericCopyUsesTheSharedFigureFormat() {
        let copy = (Explain.villaShare + Explain.marketFit + Explain.score + Explain.opportunities).joined(separator: " ")
        for formatted in [Fmt.int(200), Fmt.percent(50), Fmt.int(100), Fmt.percent(10), Fmt.percent(30), Fmt.int(40)] {
            XCTAssertTrue(copy.contains(formatted), "fixed interface copy should format \(formatted) through Fmt")
        }
        let nonEnglishDigits = CharacterSet(charactersIn: "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹")
        XCTAssertNil(copy.rangeOfCharacter(from: nonEnglishDigits))
    }

    func testCountedAgreement() {
        XCTAssertEqual(Fmt.counted(1, .district), "حي واحد")
        XCTAssertEqual(Fmt.counted(2, .district), "حيّان")
        XCTAssertEqual(Fmt.counted(5, .district), "\u{2066}5\u{2069} أحياء")
        XCTAssertEqual(Fmt.counted(23, .district), "\u{2066}23\u{2069} حياً")
        XCTAssertEqual(Fmt.counted(100, .district), "\u{2066}100\u{2069} حي")
    }

    func testHomeSummaryDoesNotPresentMissingDistrictBoundariesAsZero() {
        let unavailable = CityCoverageCopy.summary(city: "بارق", total: 1_551, districtCount: 0)
        XCTAssertTrue(unavailable.contains("1,551"))
        XCTAssertTrue(unavailable.contains("حدود الأحياء غير متاحة"))
        XCTAssertFalse(unavailable.contains("0 حي"))

        let available = CityCoverageCopy.summary(city: "الرياض", total: 100, districtCount: 5)
        XCTAssertTrue(available.contains("5"))
        XCTAssertFalse(available.contains("غير متاحة"))
    }

    func testQuintilesAndScore() {
        let values = Array(stride(from: 1.0, through: 10.0, by: 1.0))
        let q = Quintiles(values)
        XCTAssertEqual(q.bin(1), 0)
        XCTAssertEqual(q.bin(10), 4)
        XCTAssertNil(q.bin(nil))
        XCTAssertEqual(Quintiles.score(10, among: values), 100)
        XCTAssertEqual(Quintiles.score(1, among: values), 0)
    }

    func testAudienceTotalRequiresCompleteEligibleDistrictCoverage() {
        XCTAssertEqual(AudienceCoverage.total([10, 20, 30], eligibleDistrictCount: 3), 60)
        XCTAssertNil(AudienceCoverage.total([10, nil, 30], eligibleDistrictCount: 3))
        XCTAssertNil(AudienceCoverage.total([10, 20], eligibleDistrictCount: 3))
        XCTAssertNil(AudienceCoverage.total([10, .infinity], eligibleDistrictCount: 2))
        XCTAssertNil(AudienceCoverage.total([10, -1], eligibleDistrictCount: 2))
        XCTAssertEqual(AudienceCoverage.total([], eligibleDistrictCount: 0), 0)
    }

    func testComparisonHighlightsMaximumOnlyWithACompleteMeasurementForEveryDistrict() {
        XCTAssertEqual(CompleteMetricComparison.maximum([12, 20, 18], selectedCount: 3), 20)
        XCTAssertEqual(CompleteMetricComparison.maximum([12, 12], selectedCount: 2), 12, "ties remain equally highest")
        XCTAssertNil(CompleteMetricComparison.maximum([12, nil, 18], selectedCount: 3))
        XCTAssertNil(CompleteMetricComparison.maximum([12, 18], selectedCount: 3))
        XCTAssertNil(CompleteMetricComparison.maximum([12, .infinity], selectedCount: 2))
        XCTAssertNil(CompleteMetricComparison.maximum([12], selectedCount: 1))
    }

    func testPreciseActivityMatchesArabicSearchTerms() {
        let spa = Activity(main_id: nil, main_ar: "سبا ومساج", n: 8)
        XCTAssertTrue(spa.matches("مساج"))
        XCTAssertTrue(spa.matches("سبا"))
    }

    func testAdvisorRequestCarriesTheSelectedWorkflowAndVisibleFacts() throws {
        let modes: [(AtlasAdvisorMode, String)] = [
            (.branch, "branch"), (.audience, "audience"), (.distribution, "distribution"),
            (.analysis, "analysis"), (.realEstate, "real_estate"),
        ]
        for (mode, rawValue) in modes {
            let body = AtlasAPI.advisorBody(mode: mode, facts: "حي النخيل: سكان غير متاح", profile: "ميزانية محددة", turns: [])
            XCTAssertEqual(body["mode"] as? String, rawValue)
            XCTAssertEqual(body["facts"] as? String, "حي النخيل: سكان غير متاح")
            XCTAssertEqual(body["profile"] as? String, "ميزانية محددة")
            XCTAssertEqual((body["turns"] as? [[String: String]])?.count, 0)
        }
    }

    func testRealEstateAdvisorReturnsVisibleDataComparisonWhenSignInIsRequired() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AdvisorAuthURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.finishTasksAndInvalidate() }
        let api = AtlasAPI(session: session)
        let facts = "المدينة: الرياض\nعدد العروض المطابقة من النتائج المحملة: 1\nعرض 1: شقة، إيجار سنوي، حي النخيل، السعر \(Fmt.withUnit(48_000, "ر.س"))، المساحة \(Fmt.withUnit(120, "م²"))، غرف النوم 3"

        let reply = try await api.advise(mode: .realEstate, facts: facts, profile: "أبحث عن ثلاث غرف", turns: [])

        XCTAssertTrue(reply.contains("اقتراح عام لمسار العقار"))
        XCTAssertTrue(reply.contains(Fmt.withUnit(48_000, "ر.س")))
        XCTAssertFalse(reply.contains("سجّل الدخول"), "the local comparison should be useful without opening an account gate")
    }

    func testRealEstateAdvisorTurnsModelRefusalIntoGuidedResponse() {
        let riyal = "ر.س"
        let squareMeters = "م²"
        let firstListing = "عرض 1: شقة، إيجار سنوي، حي النخيل، السعر \(Fmt.withUnit(48_000, riyal))، المساحة \(Fmt.withUnit(120, squareMeters))، غرف النوم \(Fmt.int(3))، العمر غير متاح، فرق السعر عن وسيط الحي \(Fmt.percent(-12))"
        let secondListing = "عرض 2: شقة، إيجار سنوي، حي الياسمين، السعر \(Fmt.withUnit(54_000, riyal))، المساحة \(Fmt.withUnit(140, squareMeters))، غرف النوم \(Fmt.int(2))، العمر غير متاح، فرق السعر عن وسيط الحي \(Fmt.percent(-10))"
        let facts = "المدينة: الرياض\nنوع الصفقة: إيجار\nالحي: النخيل\nعدد العروض المطابقة من النتائج المحملة: 4\n\(firstListing)"
        let turns = [AtlasAdvisorTurn(role: "user", content: "هل السعر مناسب؟")]
        let fallback = AtlasAPI.advisorFallback(statusCode: 422, mode: .realEstate, facts: facts, profile: "أبحث عن ثلاث غرف", turns: turns)
        XCTAssertNotNil(fallback)
        XCTAssertTrue(fallback?.contains("اقتراح عام لمسار العقار") == true)
        XCTAssertTrue(fallback?.contains("أبحث عن ثلاث غرف") == true)
        XCTAssertTrue(fallback?.contains("عدد العروض المطابقة من النتائج المحملة: 4") == true)
        XCTAssertTrue(fallback?.contains(Fmt.withUnit(48_000, "ر.س")) == true)
        XCTAssertTrue(fallback?.contains(Fmt.percent(-12)) == true)
        XCTAssertTrue(fallback?.contains("مع المعلن") == true)
        XCTAssertFalse(fallback?.contains("تعذّر") == true)
        XCTAssertFalse(fallback?.contains("أنسب استثمار") == true)
        let empty = AtlasAPI.advisorFallback(mode: .realEstate, facts: "المدينة: الرياض\nعدد العروض المطابقة من النتائج المحملة: 0")
        XCTAssertTrue(empty?.contains("لا تظهر عروض محمّلة للمقارنة") == true)
        XCTAssertTrue(empty?.contains("لا يعني عدم وجود عروض أخرى في السوق") == true)
        let comparableFacts = facts + "\n" + secondListing
        let cheapest = AtlasAPI.advisorFallback(mode: .realEstate, facts: comparableFacts, profile: "أبحث عن الأرخص")
        XCTAssertTrue(cheapest?.contains("الأقل سعراً بين الإعلانات الظاهرة") == true)
        XCTAssertTrue(cheapest?.contains("هو عرض 1 بسعر") == true)
        XCTAssertTrue(cheapest?.contains(Fmt.int(48_000)) == true)
        let tiedPrices = comparableFacts.replacingOccurrences(of: "السعر \(Fmt.withUnit(54_000, riyal))", with: "السعر \(Fmt.withUnit(48_000, riyal))")
        let tied = AtlasAPI.advisorFallback(mode: .realEstate, facts: tiedPrices, profile: "أبحث عن الأرخص")
        XCTAssertTrue(tied?.contains("يتعادل عرض 1 وعرض 2 كأقل سعر معلن") == true, tied ?? "nil")
        let onePrice = comparableFacts.replacingOccurrences(of: "السعر \(Fmt.withUnit(54_000, riyal))", with: "السعر غير متاح")
        let incomplete = AtlasAPI.advisorFallback(mode: .realEstate, facts: onePrice, profile: "أبحث عن الأرخص")
        XCTAssertTrue(incomplete?.contains("لا يتوفر سعر معلن لعَرضين على الأقل") == true)
        let larger = AtlasAPI.advisorFallback(mode: .realEstate, facts: comparableFacts, profile: "مساحة أكبر")
        XCTAssertTrue(larger?.contains("أكبر مساحة بين العروض الظاهرة") == true)
        XCTAssertTrue(larger?.contains("لدى عرض 2") == true)
        let moreBedrooms = AtlasAPI.advisorFallback(mode: .realEstate, facts: comparableFacts, turns: [AtlasAdvisorTurn(role: "user", content: "أريد غرف أكثر")])
        XCTAssertTrue(moreBedrooms?.contains("أكثر غرف النوم بين العروض الظاهرة") == true)
        XCTAssertTrue(moreBedrooms?.contains("لدى عرض 1") == true)
        let differentDeals = comparableFacts.replacingOccurrences(of: "إيجار سنوي، حي الياسمين", with: "إيجار شهري، حي الياسمين")
        let notComparable = AtlasAPI.advisorFallback(mode: .realEstate, facts: differentDeals, profile: "أبحث عن الأرخص")
        XCTAssertTrue(notComparable?.contains("مدة الإيجار تختلف") == true)
        XCTAssertNil(AtlasAPI.advisorFallback(statusCode: 422, mode: .branch))
        XCTAssertNotNil(AtlasAPI.advisorFallback(statusCode: 429, mode: .realEstate))
        XCTAssertNotNil(AtlasAPI.advisorFallback(statusCode: 503, mode: .realEstate))
        XCTAssertNotNil(AtlasAPI.advisorFallback(statusCode: 401, mode: .realEstate))
        XCTAssertNil(AtlasAPI.advisorFallback(statusCode: 401, mode: .branch))
        XCTAssertNil(AtlasAPI.advisorFallback(statusCode: 403, mode: .realEstate))
        XCTAssertNil(AtlasAPI.advisorFallback(mode: .branch))
        XCTAssertTrue(AtlasAPI.advisorFallback(mode: .realEstate)?.contains("اقتراح عام") == true)
    }

    func testAdvisorContextTruncatesAtFactBoundariesAndDisclosesOmittedFacts() {
        let first = String(repeating: "أ", count: 7_400)
        let omitted = "المنطقة 2: " + String(repeating: "أ", count: 100)
        let context = AtlasAdvisorFacts.block([first, omitted])
        XCTAssertLessThanOrEqual(context.count, 7_500)
        XCTAssertTrue(context.hasPrefix(first))
        XCTAssertTrue(context.hasSuffix("تنبيه: أُسقطت بقية الأسطر لأن حجم السياق بلغ الحد."))
        XCTAssertFalse(context.contains("المنطقة 2"))

        XCTAssertEqual(AtlasAdvisorFacts.block(["المدينة: الرياض", "السكان: غير متاح"]), "المدينة: الرياض\nالسكان: غير متاح")
    }

    func testActivitySearchDoesNotTurnMissingCountIntoNoRecords() throws {
        let valid = try JSONDecoder().decode(ActivitySearchResponse.self, from: Data(#"{"total":0,"understood":{"labels":["مساج"],"more":0}}"#.utf8))
        XCTAssertEqual(try valid.suggestion(query: "مساج")?.n, 0, "an explicit zero is a measured empty result")

        let missing = try JSONDecoder().decode(ActivitySearchResponse.self, from: Data(#"{"understood":{"labels":["مساج"],"more":0}}"#.utf8))
        XCTAssertThrowsError(try missing.suggestion(query: "مساج"))
    }

    func testDistrictTablesRequireAnExplicitArrayButAllowAnExplicitEmptyResult() throws {
        let empty = try JSONDecoder().decode(DistrictRows<DistrictCounts>.self, from: Data(#"{"districts":[]}"#.utf8))
        XCTAssertTrue(empty.districts.isEmpty)
        XCTAssertThrowsError(try JSONDecoder().decode(DistrictRows<DistrictCounts>.self, from: Data("{}".utf8)))
        XCTAssertThrowsError(try JSONDecoder().decode(DistrictRows<DistrictCounts>.self, from: Data(#"{"districts":null}"#.utf8)))
    }

    func testOptionalDistrictLayersDistinguishUnavailableSourcesFromRequestFailures() throws {
        let measured = try JSONDecoder().decode(DistrictRows<Income>.self,
            from: Data(#"{"available":true,"districts":[{"district_ar":"العليا","income_all":12000}]}"#.utf8))
        XCTAssertTrue(measured.hasSource)
        XCTAssertEqual(measured.districts.first?.income_all, 12_000)

        let unavailable = try JSONDecoder().decode(DistrictRows<Income>.self,
            from: Data(#"{"available":false,"districts":[]}"#.utf8))
        XCTAssertFalse(unavailable.hasSource, "an explicit missing source must remain unavailable, not a network error")

        let legacy = try JSONDecoder().decode(DistrictRows<Income>.self,
            from: Data(#"{"districts":[{"district_ar":"العليا","income_all":12000}]}"#.utf8))
        XCTAssertTrue(legacy.hasSource, "older replies with measured rows remain readable")
    }

    func testIncomeFilterUsesTheSelectedWorkersMeasuredIncomeWithoutFallback() throws {
        let income = try JSONDecoder().decode(Income.self, from: Data(#"{"district_ar":"العليا","income_all":10000,"income_male":12000,"income_female":8000,"income_saudi":14000,"income_non_saudi":6000}"#.utf8))
        XCTAssertEqual(income.workingIncome(for: .everyone), 10_000)
        XCTAssertEqual(income.workingIncome(for: .men), 12_000)
        XCTAssertEqual(income.workingIncome(for: .women), 8_000)
        XCTAssertEqual(income.workingIncome(for: .saudi), 14_000)
        XCTAssertEqual(income.workingIncome(for: .nonSaudi), 6_000)

        let partial = try JSONDecoder().decode(Income.self, from: Data(#"{"district_ar":"العليا","income_all":10000}"#.utf8))
        XCTAssertNil(partial.workingIncome(for: .men), "a missing men-specific measure must not fall back to all workers")
        XCTAssertNil(Income(district_ar: "الحي", income_all: -1, income_male: .infinity,
                            income_female: nil, income_saudi: nil, income_non_saudi: nil).workingIncome(for: .men))
    }

    func testCityListKeepsCitiesWithoutDistrictsAndRejectsInvalidCatalogs() throws {
        let cities = try AtlasAPI.cityCatalog([
            City(en: "Riyadh", ar: "الرياض", districts: 150),
            City(en: "Unsupported", ar: "غير مدعومة", districts: 0),
            City(en: "Legacy", ar: "قديمة", districts: nil),
        ])
        XCTAssertEqual(cities.map(\.en), ["Riyadh", "Unsupported", "Legacy"])
        XCTAssertThrowsError(try AtlasAPI.cityCatalog([]))
        XCTAssertThrowsError(try AtlasAPI.cityCatalog([City(en: "", ar: nil, districts: 0)]))
        XCTAssertThrowsError(try AtlasAPI.cityCatalog([
            City(en: "Riyadh", ar: "الرياض", districts: 150),
            City(en: "Riyadh", ar: "الرياض", districts: 0),
        ]))
    }

    func testCitySummaryRequiresAnExplicitActivityList() throws {
        let empty = try JSONDecoder().decode(CitySummary.self, from: Data(#"{"main_activities":[]}"#.utf8))
        XCTAssertTrue(empty.main_activities.isEmpty)
        XCTAssertThrowsError(try JSONDecoder().decode(CitySummary.self, from: Data("{}".utf8)))
    }

    func testMarketFitUsesBothDemandAndPurchasingPowerAndFailsClosed() {
        let scores = MarketFitScorer.scores(
            demandByDistrict: ["الأعلى نقصاً": 100, "الأعلى دخلاً": 50, "الوسط": 10],
            purchasingPowerByDistrict: ["الأعلى نقصاً": 2_000, "الأعلى دخلاً": 12_000, "الوسط": 6_000]
        )
        XCTAssertEqual(scores["الأعلى نقصاً"], 50)
        XCTAssertEqual(scores["الأعلى دخلاً"], 75)
    }

    func testMarketFitPowerRequiresMeasuredWorkerIncome() {
        XCTAssertEqual(MarketFitScorer.measuredPurchasingPower(income: 5_822), 5_822)
        XCTAssertNil(MarketFitScorer.measuredPurchasingPower(income: nil), "a housing-mix proxy cannot replace missing income")
        XCTAssertNil(MarketFitScorer.measuredPurchasingPower(income: -1))
        XCTAssertNil(MarketFitScorer.measuredPurchasingPower(income: .infinity))
    }

    func testBatchMarketFitMatchesPerDistrictScoresWithTiesAndMissingData() {
        let demand = ["أ": 10.0, "ب": 10.0, "ج": 100.0, "د": 50.0]
        let power = ["أ": 2_000.0, "ب": 12_000.0, "ج": 6_000.0]
        let batch = MarketFitScorer.scores(demandByDistrict: demand, purchasingPowerByDistrict: power)

        XCTAssertEqual(Set(batch.keys), ["أ", "ب", "ج"])
        XCTAssertEqual(batch["أ"], 13, "tied demand ranks use their average within the shared measured cohort")
        XCTAssertEqual(batch["ب"], 63)
        XCTAssertEqual(batch["ج"], 75)
        XCTAssertNil(batch["د"], "a missing purchasing-power source must stay unavailable")
    }

    func testMarketFitSingletonUsesNeutralRankAndOldGapPayloadRemainsDetectable() throws {
        XCTAssertEqual(MarketFitScorer.scores(demandByDistrict: ["الوحيد": 7], purchasingPowerByDistrict: ["الوحيد": 9_000]), ["الوحيد": 50])

        let current = try JSONDecoder().decode(GapTable.self, from: Data(#"{"fit_sample_districts":1,"districts":[{"district_ar":"حي","fit_score":50}]}"#.utf8))
        XCTAssertEqual(current.fit_sample_districts, 1)
        XCTAssertEqual(current.districts.first?.fit_score, 50)
        let legacy = try JSONDecoder().decode(GapTable.self, from: Data(#"{"districts":[{"district_ar":"حي"}]}"#.utf8))
        XCTAssertNil(legacy.fit_sample_districts, "old services are distinguishable from an explicitly unavailable score")
    }

    func testMarketFitScoreCacheReusesOneRevisionAndInvalidatesOnNewData() {
        var cache = VersionedMarketFitCache()
        XCTAssertNil(cache.values(for: 7))
        let first = ["الربيع": 75.0]
        cache.store(first, for: 7)
        XCTAssertEqual(cache.values(for: 7), first)
        XCTAssertNil(cache.values(for: 8), "a city/activity data revision must not reuse the previous scores")
    }

    func testMapClustersKeepSeparateListingsAtSharedCoordinates() throws {
        let json = """
        [
          {"id":"a","lat":24.7,"lon":46.7},
          {"id":"b","lat":24.700001,"lon":46.700001},
          {"id":"c","lat":24.71,"lon":46.71},
          {"id":"d","lat":24.704,"lon":46.704}
        ]
        """.data(using: .utf8)!
        let listings = try JSONDecoder().decode([Listing].self, from: json)
        let clusters = ListingMapCluster.group(listings)
        XCTAssertEqual(clusters.count, 3, "listings hundreds of metres apart must not be merged")
        XCTAssertEqual(clusters.first(where: { $0.count == 2 })?.listings.map(\.id), ["a", "b"])
        XCTAssertEqual(clusters.filter { $0.count == 1 }.flatMap { $0.listings.map(\.id) }.sorted(), ["c", "d"])
        XCTAssertEqual(clusters.reduce(0) { $0 + $1.count }, listings.count, "grouping map pins must not discard ads")
    }

    func testMapPinHitTestPrefiltersDistantPinsAndKeepsBoundaryFallback() {
        func dot(_ id: String, _ latitude: Double, _ longitude: Double) -> MapDot {
            MapDot(id: id, coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude), color: Palette.accent)
        }
        let nearby = dot("nearby", 24.7002, 46.7002)
        let center = dot("center", 24.7, 46.7)
        let distant = dot("distant", 25, 47)
        let dots = [nearby, center, distant]
        let corners = [
            CLLocationCoordinate2D(latitude: 24.699, longitude: 46.699),
            CLLocationCoordinate2D(latitude: 24.699, longitude: 46.701),
            CLLocationCoordinate2D(latitude: 24.701, longitude: 46.699),
            CLLocationCoordinate2D(latitude: 24.701, longitude: 46.701),
        ]

        XCTAssertEqual(Set(AtlasMap.pinCandidates(dots, within: corners).map(\.id)), ["nearby", "center"])
        XCTAssertEqual(AtlasMap.pinCandidates(dots, within: Array(corners.prefix(3))).map(\.id), dots.map(\.id),
                       "when the touch square cannot be converted fully, keep the original accurate hit test")
    }

    func testMapEquatableTracksVisibleFillAndGeometryChanges() {
        let unchanged = AtlasMap(shapes: [], fills: ["district": Palette.brand], key: "metric-geometry-1")
        let sameMap = AtlasMap(shapes: [], fills: ["district": Palette.brand], key: "metric-geometry-1")
        let changedColor = AtlasMap(shapes: [], fills: ["district": Palette.warning], key: "metric-geometry-1")
        let changedGeometry = AtlasMap(shapes: [], fills: ["district": Palette.brand], key: "metric-geometry-2")

        XCTAssertEqual(unchanged, sameMap, "unrelated state changes should not invalidate the map")
        XCTAssertNotEqual(unchanged, changedColor, "a visible fill change must redraw the districts")
        XCTAssertNotEqual(unchanged, changedGeometry, "new city geometry must redraw even when colors match")
    }

    func testListingSourceUnavailableIsDifferentFromAnAvailableEmptyResult() throws {
        let empty = Data(#"{"available":true,"retrieved":"2026-11-09","total":0,"listings":[]}"#.utf8)
        let result = try AtlasAPI.parseListings(empty)
        XCTAssertEqual(result.retrieved, "2026-11-09")
        XCTAssertEqual(result.total, 0)
        XCTAssertEqual(result.offset, 0)
        XCTAssertTrue(result.rows.isEmpty)

        let unavailable = Data(#"{"available":false,"total":0,"listings":[]}"#.utf8)
        XCTAssertThrowsError(try AtlasAPI.parseListings(unavailable))
        let unavailableWithRows = Data(#"{"available":false,"total":1,"listings":[{"id":"a","lat":24.7,"lon":46.7}]}"#.utf8)
        XCTAssertThrowsError(try AtlasAPI.parseListings(unavailableWithRows))

        let incomplete = Data(#"{"available":true,"listings":[]}"#.utf8)
        XCTAssertThrowsError(try AtlasAPI.parseListings(incomplete))
        let missingAvailability = Data(#"{"total":0,"listings":[]}"#.utf8)
        XCTAssertThrowsError(try AtlasAPI.parseListings(missingAvailability))
    }

    func testListingPaginationRejectsAnUnpagedOrMismatchedServiceReply() throws {
        let secondPage = Data(#"{"available":true,"total":250,"offset":100,"listings":[{"id":"b","lat":24.7,"lon":46.7}]}"#.utf8)
        let firstPageRepeated = Data(#"{"available":true,"total":250,"listings":[{"id":"a","lat":24.7,"lon":46.7}]}"#.utf8)
        let wrongPage = Data(#"{"available":true,"total":250,"offset":0,"listings":[{"id":"a","lat":24.7,"lon":46.7}]}"#.utf8)
        let pageExceedsTotal = Data(#"{"available":true,"total":101,"offset":100,"listings":[{"id":"b","lat":24.7,"lon":46.7},{"id":"c","lat":24.71,"lon":46.71}]}"#.utf8)
        let rowsAfterTotal = Data(#"{"available":true,"total":100,"offset":100,"listings":[{"id":"b","lat":24.7,"lon":46.7}]}"#.utf8)

        XCTAssertEqual(try AtlasAPI.parseListings(secondPage, expectedOffset: 100).offset, 100)
        XCTAssertThrowsError(try AtlasAPI.parseListings(firstPageRepeated, expectedOffset: 100),
                             "an older API that ignores offset must not duplicate page one")
        XCTAssertThrowsError(try AtlasAPI.parseListings(wrongPage, expectedOffset: 100),
                             "a page must confirm its requested offset")
        XCTAssertThrowsError(try AtlasAPI.parseListings(pageExceedsTotal, expectedOffset: 100),
                             "the total must include earlier pages and every returned row")
        XCTAssertThrowsError(try AtlasAPI.parseListings(rowsAfterTotal, expectedOffset: 100),
                             "a page at the total must be empty")
        let emptyBeforeEnd = Data(#"{"available":true,"total":250,"offset":100,"listings":[]}"#.utf8)
        XCTAssertThrowsError(try AtlasAPI.parseListings(emptyBeforeEnd, expectedOffset: 100),
                             "an empty page before the exact total must not look like a successful page")
    }

    func testListingCacheRejectsAStaleResponseFromTheWrongPage() {
        let repeatedFirstPage = Data(#"{"available":true,"total":250,"listings":[{"id":"a","lat":24.7,"lon":46.7}]}"#.utf8)
        let correctSecondPage = Data(#"{"available":true,"total":250,"offset":100,"listings":[{"id":"b","lat":24.7,"lon":46.7}]}"#.utf8)

        XCTAssertFalse(APICachePolicy.isValidCachedResponse(repeatedFirstPage, resource: "real-estate-listings", expectedListingOffset: 100),
                       "a semantically invalid cached page must be discarded so the current service can be queried")
        XCTAssertTrue(APICachePolicy.isValidCachedResponse(correctSecondPage, resource: "real-estate-listings", expectedListingOffset: 100))
        XCTAssertTrue(APICachePolicy.isValidCachedResponse(repeatedFirstPage, resource: "district-counts"),
                      "resources without page semantics retain the shared JSON cache policy")
    }

    func testListingSourceDateMayBeUnavailableWithoutBlockingValidListings() throws {
        let data = Data(#"{"available":true,"total":1,"listings":[{"id":"a","lat":24.7,"lon":46.7}]}"#.utf8)
        let result = try AtlasAPI.parseListings(data)
        XCTAssertNil(result.retrieved)
        XCTAssertEqual(result.rows.count, 1)

        let invalidDay = Data(#"{"available":true,"retrieved":"2026-13-40","total":1,"listings":[{"id":"a","lat":24.7,"lon":46.7}]}"#.utf8)
        XCTAssertNil(try AtlasAPI.parseListings(invalidDay).retrieved)
    }

    func testListingKeepsExplicitZeroLivingRoomsAndBathrooms() throws {
        let data = Data(#"{"available":true,"total":1,"listings":[{"id":"a","lat":24.7,"lon":46.7,"livings":0,"wc":0}]}"#.utf8)
        let listing = try XCTUnwrap(AtlasAPI.parseListings(data).rows.first)
        XCTAssertEqual(listing.livings, 0)
        XCTAssertEqual(listing.wc, 0)
    }

    func testAdvertiserPhoneIsAvailableOnlyAsASeparateTapAndValidatedAsSaudiMobile() throws {
        let data = Data(#"{"available":true,"total":1,"listings":[{"id":"7","lat":24.7,"lon":46.7,"has_phone":true}]}"#.utf8)
        let result = try AtlasAPI.parseListings(data)
        XCTAssertEqual(result.rows.first?.has_phone, true)
        XCTAssertTrue(AtlasAPI.isSaudiMobile("0501234567"))
        XCTAssertFalse(AtlasAPI.isSaudiMobile("050123456"))
        XCTAssertFalse(AtlasAPI.isSaudiMobile("٠٥٠١٢٣٤٥٦٧"))
        XCTAssertFalse(AtlasAPI.isSaudiMobile("050123456x"))
    }

    func testBundledHuwiyaOTFWeightsAreRegistered() {
        for name in ["itfHuwiyaArabic-Regular", "itfHuwiyaArabic-Medium", "itfHuwiyaArabic-Bold", "itfHuwiyaArabic-Black"] {
            XCTAssertNotNil(UIFont(name: name, size: 16), "missing bundled Huwiya font \(name)")
        }
    }

    func testListingResponseRejectsInvalidCoordinatesDuplicateIDsAndInconsistentTotals() {
        let invalidCoordinate = Data(#"{"available":true,"total":1,"listings":[{"id":"a","lat":91,"lon":46.7}]}"#.utf8)
        let duplicateIDs = Data(#"{"available":true,"total":2,"listings":[{"id":"a","lat":24.7,"lon":46.7},{"id":"a","lat":24.71,"lon":46.71}]}"#.utf8)
        let inconsistentTotal = Data(#"{"available":true,"total":0,"listings":[{"id":"a","lat":24.7,"lon":46.7}]}"#.utf8)

        XCTAssertThrowsError(try AtlasAPI.parseListings(invalidCoordinate))
        XCTAssertThrowsError(try AtlasAPI.parseListings(duplicateIDs))
        XCTAssertThrowsError(try AtlasAPI.parseListings(inconsistentTotal))
    }

    func testListingFiltersUseNeighborhoodBedsAgeAndMeasuredDensity() {
        func listing(_ id: String, district: String?, beds: Double?, age: Double?) -> Listing {
            Listing(id: id, url: nil, lon: 46.7, lat: 24.7, district_ar: district, kind: "rent", deal: nil,
                    group: nil, type: "apartment", price_sar: nil, area_sqm: nil, sar_per_sqm: nil, check: nil,
                    photo: nil, photos: nil, beds: beds, livings: nil, wc: nil, age: age, street_width: nil,
                    listed_on: nil, updated_on: nil, vs_district_pct: -20, has_phone: nil)
        }
        let candidate = listing("a", district: "العليا", beds: 3, age: 4)
        let missingDistrict = listing("b", district: nil, beds: 3, age: 4)
        let missingBeds = listing("c", district: "العليا", beds: nil, age: 4)
        let filter = ListingSearchFilter(district: "العليا", minimumBeds: 2, maximumAge: 5, minimumDistrictDensity: 4_000)

        XCTAssertTrue(filter.matches(candidate, densityByDistrict: ["العليا": 5_000]))
        XCTAssertFalse(filter.matches(missingDistrict, densityByDistrict: ["العليا": 5_000]))
        XCTAssertFalse(filter.matches(missingBeds, densityByDistrict: ["العليا": 5_000]))
        XCTAssertFalse(filter.matches(candidate, densityByDistrict: [:]), "unknown density must not pass an active density filter")
        XCTAssertFalse(filter.matches(candidate, densityByDistrict: ["العليا": 3_999]))
    }

    func testListingFilterSelectionsAreForwardedToTheServer() throws {
        let body = AtlasAPI.listingsBody(city: "Riyadh", kind: "rent", types: ["apartment"], deal: "rent_month", maxPrice: 5_000,
                                        districtIDs: ["101", "202"], minimumBeds: 3, maxAge: 10,
                                        minDiscountPct: 10, maxDiscountPct: 30, limit: 100, offset: 200)
        let encoded = try JSONSerialization.data(withJSONObject: body)
        let decoded = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])

        XCTAssertEqual(decoded["district_ids"] as? [String], ["101", "202"])
        XCTAssertEqual(decoded["min_beds"] as? Double, 3)
        XCTAssertEqual(decoded["max_age"] as? Double, 10)
        XCTAssertEqual(decoded["min_vs_district_pct"] as? Double, 10)
        XCTAssertEqual(decoded["max_vs_district_pct"] as? Double, 30)
        XCTAssertEqual(decoded["types"] as? [String], ["apartment"])
        XCTAssertEqual(decoded["deal"] as? String, "rent_month")
        XCTAssertEqual(decoded["limit"] as? Int, 100)
        XCTAssertEqual(decoded["offset"] as? Int, 200)
        XCTAssertEqual(decoded["max_price"] as? Double, 5_000)
    }

    func testListingTypeDealAndBudgetFiltersRequireMatchingAdvertisedValues() {
        func listing(_ id: String, type: String?, deal: String?, price: Double?) -> Listing {
            Listing(id: id, url: nil, lon: 46.7, lat: 24.7, district_ar: "العليا", kind: "rent", deal: deal,
                    group: nil, type: type, price_sar: price, area_sqm: nil, sar_per_sqm: nil, check: nil,
                    photo: nil, photos: nil, beds: 2, livings: nil, wc: nil, age: 4, street_width: nil,
                    listed_on: nil, updated_on: nil, vs_district_pct: -20, has_phone: nil)
        }
        let matching = listing("a", type: "apartment", deal: "rent_month", price: 4_500)
        let wrongType = listing("b", type: "villa", deal: "rent_month", price: 4_500)
        let wrongPeriod = listing("c", type: "apartment", deal: "rent_year", price: 4_500)
        let overBudget = listing("d", type: "apartment", deal: "rent_month", price: 5_001)
        let missingPrice = listing("e", type: "apartment", deal: "rent_month", price: nil)
        let filter = ListingSearchFilter(type: "apartment", deal: "rent_month", maximumPrice: 5_000)

        XCTAssertTrue(filter.matches(matching, densityByDistrict: [:]))
        XCTAssertFalse(filter.matches(wrongType, densityByDistrict: [:]))
        XCTAssertFalse(filter.matches(wrongPeriod, densityByDistrict: [:]))
        XCTAssertFalse(filter.matches(overBudget, densityByDistrict: [:]))
        XCTAssertFalse(filter.matches(missingPrice, densityByDistrict: [:]), "unknown price must not pass an active budget")
    }

    func testListingAgeLimitUsesSingularAfterTwenty() {
        XCTAssertEqual(ListingText.ageLimit(5), "حتى \(Fmt.int(5)) سنوات")
        XCTAssertEqual(ListingText.ageLimit(20), "حتى \(Fmt.int(20)) سنة")
    }

    func testListingDensityRankIsApproximateWhenDistrictsShareTheCutoff() {
        XCTAssertEqual(ListingText.densityRank(75, cutoff: 4_000), "أعلى \(Fmt.int(75))% تقريباً (من \(Fmt.int(4_000)) ساكن/كم²)")
    }

    func testListingDensityFilterDisclosesDistrictsWithoutMeasurements() {
        XCTAssertEqual(ListingText.densityCoverageUnavailable(3), "\(Fmt.int(3)) حي بلا كثافة متاحة؛ لا يدخل في نتائج فلتر الكثافة.")
        XCTAssertNil(ListingText.densityCoverageUnavailable(0), "complete density coverage needs no warning")
    }

    func testParseDistrictsAndHitTest() throws {
        let json = """
        {"type":"FeatureCollection","features":[
          {"type":"Feature","id":1,"properties":{"ar":"نمار","id":1,"area_km2":2.5},
           "geometry":{"type":"Polygon","coordinates":[[[46,24],[47,24],[47,25],[46,25],[46,24]]]}},
          {"type":"Feature","id":2,"properties":{"ar":"العليا","id":2},
           "geometry":{"type":"MultiPolygon","coordinates":[[[[48,24],[49,24],[49,25],[48,25],[48,24]]]]}}
        ]}
        """.data(using: .utf8)!
        let shapes = try AtlasAPI.parseDistricts(json)
        XCTAssertEqual(shapes.map(\.name), ["نمار", "العليا"])
        XCTAssertEqual(shapes[0].areaKm2, 2.5)
        XCTAssertTrue(shapes[0].contains(CLLocationCoordinate2D(latitude: 24.5, longitude: 46.5)))
        XCTAssertFalse(shapes[0].contains(CLLocationCoordinate2D(latitude: 24.5, longitude: 48.5)))
        XCTAssertTrue(shapes[1].contains(CLLocationCoordinate2D(latitude: 24.5, longitude: 48.5)))
    }

    func testDistrictBoundsSpeedUpHitTestingWithoutChangingPolygonMembership() {
        func point(_ latitude: Double, _ longitude: Double) -> CLLocationCoordinate2D {
            CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        }
        let concave = DistrictShape(id: "l", name: "حي متعرج", areaKm2: nil, polygons: [[[
            point(24, 46), point(24, 48), point(25, 48), point(25, 47),
            point(26, 47), point(26, 46), point(24, 46),
        ]]])

        XCTAssertTrue(concave.contains(point(24.5, 47.5)), "a point inside the district box and polygon remains a hit")
        XCTAssertFalse(concave.contains(point(25.5, 47.5)), "a point in the box's concave notch remains outside the polygon")
        XCTAssertFalse(concave.contains(point(23.5, 46.5)), "a point outside the precomputed box is rejected")
    }

    func testDistrictDrawingPreservesInteriorCutouts() {
        func point(_ latitude: Double, _ longitude: Double) -> CLLocationCoordinate2D {
            CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        }
        let outer = [point(24, 46), point(24, 48), point(26, 48), point(26, 46), point(24, 46)]
        let hole = [point(24.5, 46.5), point(24.5, 47.5), point(25.5, 47.5), point(25.5, 46.5), point(24.5, 46.5)]
        let shape = DistrictShape(id: "1", name: "حي فيه تجويف", areaKm2: nil, polygons: [[outer, hole]])

        XCTAssertEqual(shape.drawRings.count, 1, "the outer outline remains available for map framing")
        XCTAssertEqual(shape.drawPolygons.first?.interiorPolygons?.count, 1, "MapKit must render the hole as a cutout")
        XCTAssertFalse(shape.contains(point(25, 47)), "the cutout must remain outside the district during hit-testing")
    }

    @MainActor
    func testOverlappingDistrictTapSelectsTheTopmostRenderedShape() {
        func rectangle(_ name: String, west: Double, east: Double) -> DistrictShape {
            let points = [
                CLLocationCoordinate2D(latitude: 24, longitude: west),
                CLLocationCoordinate2D(latitude: 24, longitude: east),
                CLLocationCoordinate2D(latitude: 25, longitude: east),
                CLLocationCoordinate2D(latitude: 25, longitude: west),
                CLLocationCoordinate2D(latitude: 24, longitude: west),
            ]
            return DistrictShape(id: name, name: name, areaKm2: nil, polygons: [[points]])
        }
        let firstDrawn = rectangle("الأول", west: 46, east: 48)
        let lastDrawn = rectangle("الأخير", west: 47, east: 49)
        let store = AtlasStore()
        store.shapes = [firstDrawn, lastDrawn]

        let hit = store.district(at: CLLocationCoordinate2D(latitude: 24.5, longitude: 47.5))

        XCTAssertEqual(hit?.name, "الأخير", "the selected district should match the visible polygon at an overlap")
    }

    func testDistrictParserRejectsMalformedOrPartialGeometryInsteadOfSilentlyDroppingIt() throws {
        let malformed = #"{"type":"FeatureCollection","features":[]}"#.data(using: .utf8)!
        XCTAssertNoThrow(try AtlasAPI.parseDistricts(malformed), "an explicit empty feature list is a valid empty result")

        let invalidRoot = #"{"type":"FeatureCollection","features":null}"#.data(using: .utf8)!
        XCTAssertThrowsError(try AtlasAPI.parseDistricts(invalidRoot))

        let partial = #"{"type":"FeatureCollection","features":[{"type":"Feature","id":1,"properties":{"ar":"حي سليم"},"geometry":{"type":"Polygon","coordinates":[[[46,24],[47,24],[47,25]]]}}]}"#.data(using: .utf8)!
        XCTAssertThrowsError(try AtlasAPI.parseDistricts(partial), "a malformed feature must fail the whole table instead of disappearing")

        let missingIdentity = #"{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[46,24],[47,24],[47,25],[46,24]]]}}]}"#.data(using: .utf8)!
        XCTAssertThrowsError(try AtlasAPI.parseDistricts(missingIdentity))

        let duplicateNames = #"{"type":"FeatureCollection","features":[{"type":"Feature","id":1,"properties":{"ar":"حي النخيل","id":1},"geometry":{"type":"Polygon","coordinates":[[[46,24],[47,24],[47,25],[46,25],[46,24]]]}},{"type":"Feature","id":2,"properties":{"ar":"حي النخيل","id":2},"geometry":{"type":"Polygon","coordinates":[[[48,24],[49,24],[49,25],[48,25],[48,24]]]}}]}"#.data(using: .utf8)!
        XCTAssertThrowsError(try AtlasAPI.parseDistricts(duplicateNames),
                             "within one city, two IDs with the same displayed name would merge their metrics")
    }

    func testDistrictCountMustMatchTheCityCatalogWhenTheCatalogProvidesIt() throws {
        XCTAssertNoThrow(try AtlasAPI.validateDistrictCount(0, expected: 0), "a city without district coverage has an exact empty result")
        XCTAssertNoThrow(try AtlasAPI.validateDistrictCount(12, expected: 12))
        XCTAssertNoThrow(try AtlasAPI.validateDistrictCount(12, expected: nil), "legacy city responses without a count remain compatible")
        XCTAssertThrowsError(try AtlasAPI.validateDistrictCount(0, expected: 12), "an empty or truncated layer must not pass as complete")
        XCTAssertThrowsError(try AtlasAPI.validateDistrictCount(11, expected: 12), "a partial layer must not pass as complete")
    }

    /// A closed outline must survive simplification: it keeps its corners and drops only points on a straight edge.
    func testSimplifyKeepsClosedRings() {
        func c(_ lat: Double, _ lon: Double) -> CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
        // a square with extra points along each edge, closed back on its first point
        let ring = [c(24, 46), c(24, 46.5), c(24, 47), c(24.5, 47), c(25, 47), c(25, 46.5), c(25, 46), c(24.5, 46), c(24, 46)]
        let simple = DistrictShape.simplify(ring, tolerance: 0.001)
        XCTAssertEqual(simple.count, 5, "a square keeps its 4 corners plus the closing point")
        let shape = DistrictShape(id: "1", name: "x", areaKm2: nil, polygons: [[ring]])
        XCTAssertEqual(shape.drawRings.count, 1, "the ring must not vanish")
        XCTAssertGreaterThanOrEqual(shape.drawRings[0].count, 4)
    }
}
