import XCTest

/// Walks every flow of docs/atlas-ios-flows.md the way a person does, checks the figures against the live server,
/// and times each step.
final class FarqAtlasUITests: XCTestCase {
    private var app: XCUIApplication!

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

    private func shot(_ name: String) {
        sleep(2)
        try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/private/tmp/claude-501/-Users-m4pro-FARQ-B2B/e48876d7-fcf7-4df9-932d-3200e8f29bd3/scratchpad/flows/\(name).png"))
    }

    /// Screens of every flow, for review (not an assertion).
    func testZScreens() throws {
        shot("0-home")
        app.buttons["way-أفتح فرعاً"].tap(); _ = app.buttons["activity-build"].waitForExistence(timeout: 30)
        app.buttons["activity-build"].tap(); shot("1a-owner-activity")
        app.buttons["primary"].tap(); _ = app.buttons["district-0"].waitForExistence(timeout: 60); shot("1b-owner-districts")
        app.buttons["district-0"].tap(); shot("1c-owner-verdict")
        app.navigationBars.buttons.firstMatch.tap(); app.navigationBars.buttons.firstMatch.tap(); app.navigationBars.buttons.firstMatch.tap()
        app.buttons["way-أصل لجمهوري"].tap(); _ = app.buttons["segment-women"].waitForExistence(timeout: 10)
        app.buttons["segment-women"].tap(); shot("2a-marketer-audience")
        app.buttons["primary"].tap(); _ = app.buttons["district-0"].waitForExistence(timeout: 60); shot("2b-marketer-districts")
        app.navigationBars.buttons.firstMatch.tap(); app.navigationBars.buttons.firstMatch.tap()
        app.buttons["way-أوزّع على مندوبيني"].tap(); _ = app.buttons["activity-food"].waitForExistence(timeout: 10)
        app.buttons["activity-food"].tap(); app.buttons["primary"].tap(); _ = app.buttons["region-1"].waitForExistence(timeout: 60); shot("3-distributor-regions")
        app.navigationBars.buttons.firstMatch.tap(); app.navigationBars.buttons.firstMatch.tap()
        app.buttons["way-أقارن الأحياء"].tap(); _ = app.buttons["row-0"].waitForExistence(timeout: 10)
        app.buttons["row-0"].tap(); app.buttons["row-1"].tap(); shot("4a-analyst-table")
        app.buttons["primary"].tap(); shot("4b-compare")
        app.navigationBars.buttons.firstMatch.tap(); app.navigationBars.buttons.firstMatch.tap()
        app.buttons["way-أدوّر عقاراً"].tap(); _ = app.buttons["kind-rent"].waitForExistence(timeout: 10)
        app.buttons["type-apartment"].tap(); scrollTo("beds-2"); app.buttons["beds-2"].tap(); shot("5a-real-estate-filters")
        app.buttons["primary"].tap(); _ = app.buttons["listing-0"].waitForExistence(timeout: 60); shot("5b-deals")
        app.buttons["listing-0"].tap(); shot("5b-listing")
    }

    /// How long the test tool itself takes to find an element that is already on screen: subtract it from step times.
    func testToolOverhead() {
        let started = Date()
        _ = app.staticTexts["وش تبي تسوي اليوم؟"].waitForExistence(timeout: 5)
        print("UITEST tool overhead \(String(format: "%.2f", Date().timeIntervalSince(started)))s")
    }

    /// Taps, then waits for the next screen's element; reports how long it took.
    @discardableResult
    private func step(_ name: String, tap: XCUIElement, until next: XCUIElement, limit: Double) -> Double {
        XCTAssertTrue(tap.waitForExistence(timeout: 10), "\(name): nothing to tap")
        let started = Date()
        tap.tap()
        let came = next.waitForExistence(timeout: max(limit, 90))
        let secs = Date().timeIntervalSince(started)
        print("UITEST \(name) \(String(format: "%.2f", secs))s")
        if !came { print("UITEST TREE", app.debugDescription) }
        XCTAssertTrue(came && secs <= limit, "\(name): next screen took \(String(format: "%.2f", secs))s (limit \(limit)s)")
        return secs
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
        step("owner: open", tap: app.buttons["way-أفتح فرعاً"], until: app.buttons["activity-build"], limit: 3)
        app.buttons["activity-build"].tap()
        step("owner: districts", tap: app.buttons["primary"], until: app.buttons["district-0"], limit: 60)
        // the top district must be the server's largest shortfall for this activity
        let gaps = try server("market-gaps", ["city": "Riyadh", "main_id": "build", "limit": 200])
        let rows = (gaps["districts"] as? [[String: Any]]) ?? []
        let best = rows.compactMap { $0["shortfall"] as? Double }.max() ?? 0
        let shown = (app.buttons["district-0"].value as? String) ?? ""
        XCTAssertTrue(shown.contains(english(best)), "top district shows \(shown), server says \(english(best))")
        step("owner: verdict", tap: app.buttons["district-0"], until: app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'هل يناسبك حي'")).firstMatch, limit: 2)
    }

    func testMarketerFlow() throws {
        step("marketer: open", tap: app.buttons["way-أصل لجمهوري"], until: app.buttons["segment-women"], limit: 3)
        app.buttons["segment-women"].tap()
        step("marketer: districts", tap: app.buttons["primary"], until: app.buttons["district-0"], limit: 3)
        let audience = try server("district-audience", ["city": "Riyadh"])
        let women = ((audience["districts"] as? [[String: Any]]) ?? []).compactMap { $0["women"] as? Double }.max() ?? 0
        let shown = (app.buttons["district-0"].value as? String) ?? ""
        XCTAssertTrue(shown.contains(english(women)), "top district shows \(shown), server says \(english(women))")
        step("marketer: district", tap: app.buttons["district-0"], until: app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'حي '")).firstMatch, limit: 2)
    }

    func testDistributorFlow() throws {
        step("distributor: open", tap: app.buttons["way-أوزّع على مندوبيني"], until: app.buttons["activity-food"], limit: 3)
        app.buttons["activity-food"].tap()
        step("distributor: regions", tap: app.buttons["primary"], until: app.buttons["region-1"], limit: 60)
        XCTAssertTrue(app.buttons["region-5"].exists, "five reps should give five regions")
        step("distributor: region", tap: app.buttons["region-1"], until: app.descendants(matching: .any)["region-district-0"], limit: 2)
    }

    func testAnalystFlow() throws {
        step("analyst: open", tap: app.buttons["way-أقارن الأحياء"], until: app.buttons["row-0"], limit: 3)
        app.buttons["row-0"].tap()
        app.buttons["row-1"].tap()
        step("analyst: compare", tap: app.buttons["primary"], until: app.navigationBars["المقارنة"], limit: 2)
    }

    func testRealEstateFlow() throws {
        step("real estate: open", tap: app.buttons["way-أدوّر عقاراً"], until: app.buttons["kind-rent"], limit: 3)
        XCTAssertTrue(app.buttons["type-apartment"].exists, "property type filters missing")
        app.buttons["type-apartment"].tap()
        scrollTo("beds-2")
        XCTAssertTrue(app.buttons["beds-2"].waitForExistence(timeout: 10), "bedroom filter missing")
        app.buttons["beds-2"].tap()
        step("real estate: filtered deals", tap: app.buttons["primary"], until: app.buttons["listing-0"], limit: 60)
        step("real estate: listing", tap: app.buttons["listing-0"], until: app.navigationBars["العرض"], limit: 5)
        XCTAssertTrue(app.buttons["primary"].exists, "«افتح الإعلان» missing")
    }

    private func scrollTo(_ identifier: String) {
        let scrollView = app.scrollViews.firstMatch
        for _ in 0..<8 where !app.buttons[identifier].isHittable {
            scrollView.swipeUp()
        }
    }

}
