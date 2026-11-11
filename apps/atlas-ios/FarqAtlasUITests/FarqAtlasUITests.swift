import XCTest

/// Walks every flow of docs/atlas-ios-flows.md the way a person does, checks the figures against the live server,
/// and times each step.
final class FarqAtlasUITests: XCTestCase {
    private var app: XCUIApplication!
    /// Measured by testToolOverhead: XCTest takes about 1.1s to query an element already on screen.
    private let elementQueryOverhead = 1.1

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["وش تبي تسوي اليوم؟"].waitForExistence(timeout: 20), "the home question never appeared")
        // the city must be loaded before a flow starts
        let loaded = NSPredicate(format: "label CONTAINS 'منشأة'")
        if !app.staticTexts.matching(loaded).firstMatch.waitForExistence(timeout: 120) {
            print("UITEST TREE", app.debugDescription)
            XCTFail("Riyadh never loaded")
        }
    }

    /// How long the test tool itself takes to find an element that is already on screen: subtract it from step times.
    func testToolOverhead() {
        let started = Date()
        _ = app.staticTexts["وش تبي تسوي اليوم؟"].waitForExistence(timeout: 5)
        print("UITEST tool overhead \(String(format: "%.2f", Date().timeIntervalSince(started)))s")
    }

    func testCityWithoutDistrictCoverageIsSelectableAndDisclosed() {
        let cityButton = app.buttons.matching(NSPredicate(format: "label CONTAINS 'المدينة:'")).firstMatch
        XCTAssertTrue(cityButton.waitForExistence(timeout: 10))
        cityButton.tap()

        let search = app.searchFields["ابحث عن مدينة"]
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()
        search.typeText("بارق")

        let bariq = app.buttons.matching(NSPredicate(format: "label CONTAINS 'بارق'")).firstMatch
        XCTAssertTrue(bariq.waitForExistence(timeout: 10), "a city without district boundaries must remain selectable")
        XCTAssertTrue(bariq.label.contains("الأحياء غير متاحة"), "the city picker must disclose missing boundaries")
        bariq.tap()

        let selectedCity = app.buttons.matching(NSPredicate(format: "label CONTAINS 'بارق'")).firstMatch
        XCTAssertTrue(selectedCity.waitForExistence(timeout: 10))
        let notice = app.descendants(matching: .any)["city-boundaries-unavailable"]
        XCTAssertTrue(notice.waitForExistence(timeout: 120), "the home screen must explain that district-level results are unavailable")

        step("real estate without boundaries: open", tap: app.buttons["way-أدوّر عقاراً"], until: app.buttons["kind-rent"], limit: 5)
        app.buttons["kind-rent"].tap()
        let districtFilter = app.buttons["listing-filter-district"]
        XCTAssertTrue(districtFilter.waitForExistence(timeout: 30), "property filters should remain available in a city without district boundaries")
        XCTAssertTrue(districtFilter.label.contains("غير متاح"), "the district filter must disclose missing boundaries")
        XCTAssertFalse(districtFilter.isEnabled, "a district filter with no available districts must not submit an empty selection")
        XCTAssertTrue(app.staticTexts["listing-district-unavailable"].exists,
                      "the property screen should explain why neighborhood filtering is unavailable")
    }

    /// Taps, then waits for the next screen's element; reports how long it took.
    @discardableResult
    private func step(_ name: String, tap: XCUIElement, until next: XCUIElement, limit: Double) -> Double {
        XCTAssertTrue(tap.waitForExistence(timeout: 10), "\(name): nothing to tap")
        let started = Date()
        tap.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let came = next.waitForExistence(timeout: max(limit, 90))
        let elapsed = Date().timeIntervalSince(started)
        let appResponse = max(0, elapsed - elementQueryOverhead)
        print("UITEST \(name) \(String(format: "%.2f", appResponse))s app response (\(String(format: "%.2f", elapsed))s including XCTest)")
        if !came { print("UITEST TREE", app.debugDescription) }
        XCTAssertTrue(came && appResponse <= limit,
                      "\(name): next screen took \(String(format: "%.2f", appResponse))s after removing XCTest element-query overhead (limit \(limit)s)")
        return appResponse
    }

    /// Reads a POST resource from the live server the app reads.
    private func server(_ resource: String, _ body: [String: Any]) throws -> [String: Any] {
        var request = URLRequest(url: URL(string: "https://atlas.farq.sa/api/market/\(resource)")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        var out: [String: Any] = [:]
        let done = expectation(description: resource)
        URLSession.shared.dataTask(with: request) { data, _, _ in
            out = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 30)
        return out
    }

    private func english(_ value: Double) -> String {
        let f = NumberFormatter(); f.locale = Locale(identifier: "en_US"); f.numberStyle = .decimal; f.maximumFractionDigits = 0
        return f.string(from: NSNumber(value: value.rounded())) ?? ""
    }

    func testOwnerFlow() throws {
        step("owner: open", tap: app.buttons["way-أفتح فرعاً"], until: app.buttons["activity-build"], limit: 5)
        let activityOptions = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'activity-'" )).allElementsBoundByIndex
        XCTAssertGreaterThanOrEqual(activityOptions.count, 2, "at least two activity rows should be available to check adjacent taps")
        for option in activityOptions.prefix(2) {
            option.tap()
            XCTAssertTrue(option.isSelected, "center tap should select the activity row that was tapped: \(option.identifier)")
            for neighbor in activityOptions where neighbor.identifier != option.identifier {
                XCTAssertFalse(neighbor.isSelected, "tapping \(option.identifier) must not select neighboring \(neighbor.identifier)")
            }
        }
        let buildActivity = app.buttons["activity-build"]
        buildActivity.tap()
        XCTAssertTrue(buildActivity.isSelected, "the chosen activity must remain selected before continuing")
        step("owner: districts", tap: app.buttons["primary"], until: app.buttons["district-0"], limit: 60)
        // The displayed value is the combined city-relative market-fit score, not the raw shortfall.
        let shown = (app.buttons["district-0"].value as? String) ?? ""
        let score = Int(String(shown.filter { $0.isASCII && $0.isNumber })) ?? -1
        XCTAssertTrue((0...100).contains(score),
                      "top district should show a 0-100 market-fit score, got \(shown)")
        XCTAssertTrue(app.buttons["district-0"].label.contains("نقص النشاط"))
        XCTAssertTrue(app.buttons["district-0"].label.contains("دخل العامل"))
        step("owner: verdict", tap: app.buttons["district-0"], until: app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'هل يناسبك حي'")).firstMatch, limit: 5)
        XCTAssertTrue(app.buttons["advisor-open-branch"].exists, "the branch path should offer advice tied to the selected district")
        let pinToggle = app.buttons["pin-toggle"]
        XCTAssertTrue(pinToggle.waitForExistence(timeout: 5), "pin mode control missing")
        pinToggle.tap()
        XCTAssertEqual(pinToggle.value as? String, "مفعّل", "tapping the center of the pin control must turn it on")
        let map = app.descendants(matching: .any)["atlas-map"]
        XCTAssertTrue(map.waitForExistence(timeout: 5), "district map missing")
        map.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.images["دبوس على خريطة"].waitForExistence(timeout: 5), "map tap did not place the pin")
        app.scrollViews["flow-scroll"].swipeUp()
        let aroundPopulation = app.buttons["around-population-figure"]
        XCTAssertTrue(aroundPopulation.waitForExistence(timeout: 5), "placing the pin did not show its 1 km population result")
    }

    func testOwnerActivitySearchResolvesMassageToExactSpecialty() throws {
        step("owner: open", tap: app.buttons["way-أفتح فرعاً"], until: app.buttons["activity-build"], limit: 5)
        let search = app.textFields["مثال: مساج، مطعم، مخبز"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("مساج")
        let result = app.buttons["activity-search-result"]
        XCTAssertTrue(result.waitForExistence(timeout: 30), "semantic activity search did not suggest an exact specialty")
        XCTAssertTrue(result.label.contains("سبا ومساج"), "expected massage to resolve to Spa and Massage, got \(result.label)")
        result.tap()
        app.buttons["primary"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'سبا ومساج'"))
            .firstMatch.waitForExistence(timeout: 60), "selected specialty was not carried to the opportunity screen")
    }

    func testMarketerFlow() throws {
        step("marketer: open", tap: app.buttons["way-أصل لجمهوري"], until: app.buttons["segment-women"], limit: 5)
        for segment in ["everyone", "men", "saudi", "nonSaudi", "women"] {
            let selected = app.buttons["segment-\(segment)"]
            XCTAssertTrue(selected.waitForExistence(timeout: 5), "segment \(segment) missing")
            if segment != "everyone" {
                let audienceLoading = app.staticTexts["audience-loading"]
                let loaded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: audienceLoading)
                XCTAssertEqual(XCTWaiter.wait(for: [loaded], timeout: 30), .completed,
                               "gender and nationality choices must wait for their source, not look unavailable while loading")
            }
            selected.tap()
            XCTAssertTrue(selected.isSelected, "tap did not select segment \(segment)")
            let incomeFilter = app.descendants(matching: .any)["audience-income-filter"]
            XCTAssertTrue(incomeFilter.exists, "income filter should identify the selected worker segment")
            let incomeTerms = ["everyone": "العاملين", "men": "الرجال", "women": "النساء",
                               "saudi": "السعوديين", "nonSaudi": "غير السعوديين"]
            XCTAssertTrue(incomeFilter.label.contains(incomeTerms[segment] ?? ""),
                          "income filter should follow the selected audience segment")
            for other in ["everyone", "men", "saudi", "nonSaudi", "women"] where other != segment {
                XCTAssertFalse(app.buttons["segment-\(other)"].isSelected, "tap on \(segment) selected neighbor \(other)")
            }
        }
        step("marketer: districts", tap: app.buttons["primary"], until: app.buttons["district-0"], limit: 3)
        XCTAssertTrue(app.buttons["advisor-open-audience"].exists, "the audience path should offer advice tied to the selected segment")
        let audience = try server("district-audience", ["city": "Riyadh"])
        let women = ((audience["districts"] as? [[String: Any]]) ?? []).compactMap { $0["women"] as? Double }.max() ?? 0
        let shown = (app.buttons["district-0"].value as? String) ?? ""
        XCTAssertTrue(shown.contains(english(women)), "top district shows \(shown), server says \(english(women))")
        XCTAssertTrue(app.buttons["district-0"].label.contains("سكان الحي: نساء"))
        XCTAssertFalse(app.buttons["district-0"].label.contains("منشآت"))
        step("marketer: district", tap: app.buttons["district-0"], until: app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'حي '")).firstMatch, limit: 5)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'منشآت'" )).firstMatch.exists,
                       "a consumer-audience screen must not show business counts")
        app.buttons["التفاصيل"].tap()
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'منشآت'" )).firstMatch.exists,
                       "audience district details must remain about residents, not businesses")
    }

    func testDistributorFlow() throws {
        step("distributor: open", tap: app.buttons["way-أوزّع على مندوبيني"], until: app.buttons["activity-food"], limit: 3)
        app.buttons["activity-food"].tap()
        step("distributor: regions", tap: app.buttons["primary"], until: app.buttons["region-1"], limit: 60)
        XCTAssertTrue(app.buttons["advisor-open-distribution"].exists, "the distributor path should offer advice tied to its territories")
        XCTAssertTrue(app.buttons["region-5"].exists, "five reps should give five regions")
        step("distributor: region", tap: app.buttons["region-1"], until: app.descendants(matching: .any)["region-district-0"], limit: 2)
    }

    func testAnalystFlow() throws {
        step("analyst: open", tap: app.buttons["way-أقارن الأحياء"], until: app.buttons["row-0"], limit: 5)
        app.buttons["row-0"].tap()
        app.buttons["row-1"].tap()
        step("analyst: compare", tap: app.buttons["primary"], until: app.navigationBars["المقارنة"], limit: 5)
        XCTAssertTrue(app.buttons["advisor-open-analysis"].exists, "the analysis path should offer advice tied to the compared metrics")
    }

    func testRealEstateFlow() throws {
        step("real estate: open", tap: app.buttons["way-أدوّر عقاراً"], until: app.buttons["kind-rent"], limit: 3)
        step("real estate: deals", tap: app.buttons["kind-rent"], until: app.buttons["listing-0"], limit: 60)
        let advisor = app.buttons["advisor-open-real_estate"]
        XCTAssertTrue(advisor.exists, "the property path should offer advice tied to the active filters and matching ads")
        advisor.tap()
        let advisorSubmit = app.buttons["advisor-submit"]
        XCTAssertTrue(advisorSubmit.waitForExistence(timeout: 10), "the property advisor should open")
        XCTAssertTrue(advisorSubmit.isEnabled, "the advisor should start from the available property data without requiring a typed profile")
        advisorSubmit.tap()
        let localAdvisorReply = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'اقتراح عام لمسار العقار'")).firstMatch
        XCTAssertTrue(localAdvisorReply.waitForExistence(timeout: 30), "the property advisor should compare visible listings when the account endpoint requires sign-in")
        XCTAssertFalse(app.textFields["advisor-login-email"].exists, "the local real-estate comparison should not stop at a login form")
        app.buttons["advisor-close"].tap()
        for identifier in ["listing-filter-type", "listing-filter-deal",
                           "listing-filter-district", "listing-filter-beds", "listing-filter-age", "listing-filter-density"] {
            XCTAssertTrue(app.descendants(matching: .any)[identifier].exists, "real-estate filter \(identifier) is missing")
        }
        let initialPage = try server("real-estate-listings", [
            "city": "Riyadh", "kind": "rent", "limit": 20, "offset": 0,
            "min_vs_district_pct": -30, "max_vs_district_pct": -10,
        ])
        let matchingTotal = initialPage["total"] as? Int
        XCTAssertNotNil(matchingTotal, "the exact matching offer count should be available to the test")
        let firstIDs = Set((initialPage["listings"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String })
        let flowScroll = app.scrollViews["flow-scroll"]
        XCTAssertTrue(flowScroll.waitForExistence(timeout: 5), "flow content scroll view is missing")
        let loadMore = app.buttons["listing-load-more"]
        if let matchingTotal, matchingTotal > 20 {
            let secondPage = try server("real-estate-listings", [
                "city": "Riyadh", "kind": "rent", "limit": 20, "offset": 20,
                "min_vs_district_pct": -30, "max_vs_district_pct": -10,
            ])
            XCTAssertEqual(secondPage["offset"] as? Int, 20, "the service must return the requested page")
            XCTAssertEqual(secondPage["total"] as? Int, matchingTotal, "pagination must preserve the exact filtered total")
            let secondIDs = Set((secondPage["listings"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String })
            XCTAssertTrue(firstIDs.isDisjoint(with: secondIDs), "adjacent pages must not repeat offers")
            for _ in 0..<40 {
                flowScroll.swipeUp(velocity: .fast)
                if loadMore.isHittable { break }
            }
            XCTAssertTrue(loadMore.waitForExistence(timeout: 10), "the next results page should be reachable when the exact total exceeds the first page")
            XCTAssertTrue(loadMore.isHittable, "load more should follow the first page of listings")
            loadMore.tap()
            let nextListing = app.buttons["listing-20"]
            XCTAssertTrue(nextListing.waitForExistence(timeout: 30), "the app must append the requested second page")
        } else {
            XCTAssertFalse(loadMore.exists, "no load-more control should appear when the exact matching result set ends on the first page")
        }
        let typeFilter = app.buttons["listing-filter-type"]
        for _ in 0..<18 {
            flowScroll.swipeDown(velocity: .fast)
        }
        XCTAssertTrue(typeFilter.isHittable, "the result filters should remain reachable above the listings")
        typeFilter.tap()
        let apartment = app.buttons["شقة"]
        XCTAssertTrue(apartment.waitForExistence(timeout: 5), "property type options did not open")
        apartment.tap()
        XCTAssertTrue(typeFilter.label.contains("شقة"), "the property type selection was not applied")

        let dealFilter = app.buttons["listing-filter-deal"]
        dealFilter.tap()
        let monthly = app.buttons["شهري"]
        XCTAssertTrue(monthly.waitForExistence(timeout: 5), "rental-period options did not open")
        monthly.tap()
        XCTAssertTrue(dealFilter.label.contains("شهري"), "the rental period selection was not applied")

        let budgetFilter = app.buttons["listing-filter-budget"]
        XCTAssertTrue(budgetFilter.waitForExistence(timeout: 5), "choosing a rental period should make its matching budget limits available")

        let bedsFilter = app.buttons["listing-filter-beds"]
        bedsFilter.tap()
        let twoBedrooms = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "2", "غرف أو أكثر")).firstMatch
        XCTAssertTrue(twoBedrooms.waitForExistence(timeout: 5), "bedroom filter options did not open")
        twoBedrooms.tap()
        XCTAssertTrue(bedsFilter.label.contains("2") && bedsFilter.label.contains("غرف أو أكثر"), "the bedroom selection was not applied")

        let districtFilter = app.buttons["listing-filter-district"]
        districtFilter.tap()
        let districtSearch = app.searchFields["ابحث عن حي"]
        XCTAssertTrue(districtSearch.waitForExistence(timeout: 5), "the searchable neighborhood picker did not open")
        districtSearch.tap()
        districtSearch.typeText("أحد")
        let districtOption = app.buttons["district-option-أحد"]
        XCTAssertTrue(districtOption.waitForExistence(timeout: 5), "search did not find the requested neighborhood")
        districtOption.tap()
        XCTAssertTrue(districtFilter.label.contains("أحد"), "the district selection was not applied")
        districtFilter.tap()
        let reopenedDistrictSearch = app.searchFields["ابحث عن حي"]
        XCTAssertTrue(reopenedDistrictSearch.waitForExistence(timeout: 5), "the neighborhood picker did not reopen")
        reopenedDistrictSearch.tap()
        reopenedDistrictSearch.typeText("العليا")
        XCTAssertTrue(app.buttons["district-option-العليا"].waitForExistence(timeout: 5),
                      "reopening the picker must clear the previous search before another district can be found")
        app.buttons["إغلاق قائمة الأحياء"].tap()
        XCTAssertFalse(app.buttons["district-option-all"].waitForExistence(timeout: 2),
                       "the close button must dismiss the neighborhood picker before the property filters are used")
        XCTAssertTrue(districtFilter.label.contains("أحد"), "closing the picker must preserve the selected district")
        let resetFilters = app.buttons["listing-filter-reset"]
        XCTAssertTrue(resetFilters.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(resetFilters.frame.width, 300, "reset should have a wide touch target")
        XCTAssertGreaterThanOrEqual(resetFilters.frame.height, 44, "reset must meet the minimum touch target")
        for _ in 0..<5 {
            if resetFilters.isHittable { break }
            flowScroll.swipeUp(velocity: .fast)
        }
        XCTAssertTrue(resetFilters.isHittable, "reset must be hittable after the neighborhood picker closes")
        resetFilters.tap()
        XCTAssertTrue(typeFilter.label.contains("كل الأنواع"), "reset did not clear property type")
        XCTAssertTrue(dealFilter.label.contains("كل المدد"), "reset did not clear the rental period")
        XCTAssertTrue(districtFilter.label.contains("كل الأحياء"), "reset did not clear the neighborhood")
        XCTAssertFalse(budgetFilter.exists, "reset should hide the period-specific budget until a period is selected")

        let listingCards = app.buttons.matching(NSPredicate(format: "identifier MATCHES %@", "listing-[0-9]+"))
        var listingToOpen: XCUIElement?
        for _ in 0..<24 {
            if let visible = listingCards.allElementsBoundByIndex.first(where: { listing in
                let frame = listing.frame
                return listing.isHittable && frame.minY >= 130 && frame.maxY <= 750
            }) {
                listingToOpen = visible
                break
            }
            flowScroll.swipeUp(velocity: .fast)
        }
        let selectedListing = try XCTUnwrap(listingToOpen, "swiping the results screen should reveal a listing card")
        step("real estate: listing", tap: selectedListing, until: app.navigationBars["العرض"], limit: 5)
        XCTAssertTrue(app.descendants(matching: .any)["listing-beds"].exists, "listing detail should show the advertised bedroom count")
        XCTAssertTrue(app.descendants(matching: .any)["listing-livings"].exists, "listing detail should show living rooms or mark them unavailable")
        XCTAssertTrue(app.descendants(matching: .any)["listing-bathrooms"].exists, "listing detail should show bathrooms or mark them unavailable")
        XCTAssertTrue(app.descendants(matching: .any)["listing-source-link"].exists, "the original listing must remain an optional contact path")
        let directContact = app.descendants(matching: .any)["listing-contact-reveal"]
        if directContact.exists {
            XCTAssertTrue(directContact.isHittable, "available advertiser contact should be reachable from the native app")
        }
    }
}
