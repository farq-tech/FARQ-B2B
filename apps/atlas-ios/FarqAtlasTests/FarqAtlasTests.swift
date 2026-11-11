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

    func testAudienceSubtitlesDescribeResidentsForEverySegment() {
        XCTAssertEqual(Segment.everyone.audienceSubtitle, "السكان في الحي")
        XCTAssertEqual(Segment.men.audienceSubtitle, "الرجال في الحي")
        XCTAssertEqual(Segment.women.audienceSubtitle, "النساء في الحي")
        XCTAssertEqual(Segment.saudi.audienceSubtitle, "السعوديون في الحي")
        XCTAssertEqual(Segment.nonSaudi.audienceSubtitle, "غير السعوديين في الحي")
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

    @MainActor
    func testAudienceTotalNamesMeasuredDistrictCoverageAndMissingFilterData() {
        let store = AtlasStore()
        store.shapes = ["أ", "ب", "ج", "د"].enumerated().map { pair in
            DistrictShape(id: String(pair.offset), name: pair.element, areaKm2: nil, polygons: [])
        }
        store.segment = .women
        store.audience["أ"] = Audience(district_ar: "أ", male_pct: nil, saudi_pct: nil, men: nil, women: 40, saudi: nil, non_saudi: nil)
        store.audience["ب"] = Audience(district_ar: "ب", male_pct: nil, saudi_pct: nil, men: nil, women: nil, saudi: nil, non_saudi: nil)
        store.audience["ج"] = Audience(district_ar: "ج", male_pct: nil, saudi_pct: nil, men: nil, women: 20, saudi: nil, non_saudi: nil)
        store.audience["د"] = Audience(district_ar: "د", male_pct: nil, saudi_pct: nil, men: nil, women: 30, saudi: nil, non_saudi: nil)
        store.income["أ"] = Income(district_ar: "أ", income_all: 12_000)
        store.income["ب"] = Income(district_ar: "ب", income_all: 15_000)
        store.income["د"] = Income(district_ar: "د", income_all: 8_000)

        XCTAssertEqual(store.audienceTotal, 90)
        XCTAssertEqual(store.audienceUnavailableCount, 1)
        XCTAssertEqual(store.audienceCaption, "في \(Fmt.int(3)) من \(Fmt.counted(4, .district)) مقاسة")

        store.minIncome = 10_000
        XCTAssertEqual(store.audienceTotal, 40)
        XCTAssertEqual(store.audienceUnavailableCount, 2, "a known low-income district is filtered, not missing")
        XCTAssertEqual(store.audienceCaption, "مطابق: \(Fmt.counted(1, .district)) · البيانات غير متاحة في \(Fmt.counted(2, .district))")
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
