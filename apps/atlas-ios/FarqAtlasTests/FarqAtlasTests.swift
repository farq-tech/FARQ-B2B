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
}
