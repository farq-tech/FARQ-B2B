import XCTest
import CoreLocation
@testable import FarqAtlas

final class FarqAtlasTests: XCTestCase {
    func testFiguresUseEnglishDigitsAndPercent() {
        XCTAssertEqual(Fmt.int(1234567.0), "\u{2066}1,234,567\u{2069}")
        XCTAssertEqual(Fmt.percent(48.4), "\u{2066}48%\u{2069}")
        XCTAssertEqual(Fmt.int(nil as Double?), "غير متاح")
        XCTAssertFalse(Fmt.int(9876.0).contains("٩"))
    }

    func testCountedAgreement() {
        XCTAssertEqual(Fmt.counted(1, .district), "حي واحد")
        XCTAssertEqual(Fmt.counted(2, .district), "حيّان")
        XCTAssertEqual(Fmt.counted(5, .district), "\u{2066}5\u{2069} أحياء")
        XCTAssertEqual(Fmt.counted(23, .district), "\u{2066}23\u{2069} حياً")
        XCTAssertEqual(Fmt.counted(100, .district), "\u{2066}100\u{2069} حي")
    }

    func testRealEstateFiltersAreSentToTheServerBeforeListingLimit() {
        let body = AtlasAPI.listingsBody(city: "Riyadh", kind: "rent", types: ["apartment"], deal: "rent_year",
                                         districtIDs: ["district-7"], minBeds: 2, maxAge: 10, maxPrice: 60000,
                                         minDensity: 5000, limit: 600)
        XCTAssertEqual(body["city"] as? String, "Riyadh")
        XCTAssertEqual(body["kind"] as? String, "rent")
        XCTAssertEqual(body["types"] as? [String], ["apartment"])
        XCTAssertEqual(body["deal"] as? String, "rent_year")
        XCTAssertEqual(body["district_ids"] as? [String], ["district-7"])
        XCTAssertEqual(body["min_beds"] as? Double, 2)
        XCTAssertEqual(body["max_age"] as? Double, 10)
        XCTAssertEqual(body["max_price"] as? Double, 60000)
        XCTAssertEqual(body["min_density"] as? Double, 5000)
        XCTAssertEqual(body["limit"] as? Int, 600)
    }

    func testEmptyRealEstateFiltersDoNotInventCriteria() {
        let body = AtlasAPI.listingsBody(city: "Riyadh", kind: "sale", types: [], deal: nil,
                                         districtIDs: [], minBeds: nil, maxAge: nil, maxPrice: nil, minDensity: nil, limit: 600)
        XCTAssertNil(body["types"])
        XCTAssertNil(body["deal"])
        XCTAssertNil(body["district_ids"])
        XCTAssertNil(body["min_beds"])
        XCTAssertNil(body["max_age"])
        XCTAssertNil(body["max_price"])
        XCTAssertNil(body["min_density"])
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
