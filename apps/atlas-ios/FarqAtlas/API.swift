import Foundation
import CoreLocation
import CryptoKit
import MapKit

// MARK: - Models (the same read-only resources the Atlas web map reads through /api/market)

struct City: Decodable, Identifiable, Hashable {
    let en: String
    let ar: String?
    let districts: Int?
    var id: String { en }
    var name: String { ar ?? en }
}

/// One district outline: rings of coordinates (outer ring first) per polygon part.
struct DistrictShape: Identifiable {
    private struct Bounds {
        let minLatitude: Double
        let maxLatitude: Double
        let minLongitude: Double
        let maxLongitude: Double

        func contains(_ point: CLLocationCoordinate2D) -> Bool {
            (minLatitude...maxLatitude).contains(point.latitude)
                && (minLongitude...maxLongitude).contains(point.longitude)
        }
    }

    let id: String
    let name: String
    let areaKm2: Double?
    let polygons: [[[CLLocationCoordinate2D]]]
    private let bounds: Bounds?
    /// Outer rings simplified for drawing only (about 15 m tolerance); hit-testing keeps the full outline.
    let drawRings: [[CLLocationCoordinate2D]]
    /// Renderable MapKit polygons with their simplified interior rings preserved as cutouts.
    let drawPolygons: [MKPolygon]

    init(id: String, name: String, areaKm2: Double?, polygons: [[[CLLocationCoordinate2D]]]) {
        self.id = id
        self.name = name
        self.areaKm2 = areaKm2
        self.polygons = polygons
        var minLatitude = Double.infinity, maxLatitude = -Double.infinity
        var minLongitude = Double.infinity, maxLongitude = -Double.infinity
        for polygon in polygons {
            for ring in polygon {
                for point in ring {
                    minLatitude = min(minLatitude, point.latitude)
                    maxLatitude = max(maxLatitude, point.latitude)
                    minLongitude = min(minLongitude, point.longitude)
                    maxLongitude = max(maxLongitude, point.longitude)
                }
            }
        }
        self.bounds = minLatitude.isFinite
            ? Bounds(minLatitude: minLatitude, maxLatitude: maxLatitude, minLongitude: minLongitude, maxLongitude: maxLongitude)
            : nil
        var outerRings: [[CLLocationCoordinate2D]] = []
        var drawPolygons: [MKPolygon] = []
        for rings in polygons {
            guard let outer = rings.first else { continue }
            let simplifiedOuter = Self.simplify(outer, tolerance: 0.00015)
            guard simplifiedOuter.count >= 3 else { continue }
            let holes = rings.dropFirst().map { Self.simplify($0, tolerance: 0.00015) }.filter { $0.count >= 3 }
            outerRings.append(simplifiedOuter)
            let interiorPolygons = holes.map { MKPolygon(coordinates: $0, count: $0.count) }
            drawPolygons.append(MKPolygon(coordinates: simplifiedOuter, count: simplifiedOuter.count, interiorPolygons: interiorPolygons))
        }
        self.drawRings = outerRings
        self.drawPolygons = drawPolygons
    }

    /// Douglas–Peucker: drops points that sit within `tolerance` degrees of the line between their neighbours.
    /// A closed ring (first point = last point) is split at its farthest point from the start and each half simplified,
    /// because a segment from a point to itself measures every other point at distance zero and would erase the ring.
    static func simplify(_ ring: [CLLocationCoordinate2D], tolerance: Double) -> [CLLocationCoordinate2D] {
        guard ring.count > 4 else { return ring }
        let first = ring[0], last = ring[ring.count - 1]
        if abs(first.latitude - last.latitude) < 1e-12 && abs(first.longitude - last.longitude) < 1e-12 {
            func gap(_ p: CLLocationCoordinate2D) -> Double {
                let dx = p.longitude - first.longitude, dy = p.latitude - first.latitude
                return dx * dx + dy * dy
            }
            let split = (1..<(ring.count - 1)).max { gap(ring[$0]) < gap(ring[$1]) } ?? ring.count / 2
            let head = line(Array(ring[0...split]), tolerance: tolerance)
            let tail = line(Array(ring[split...]), tolerance: tolerance)
            return head + tail.dropFirst()
        }
        return line(ring, tolerance: tolerance)
    }

    /// Douglas–Peucker on an open line: keeps both ends and every point farther than `tolerance` from the chord.
    private static func line(_ points: [CLLocationCoordinate2D], tolerance: Double) -> [CLLocationCoordinate2D] {
        guard points.count > 2 else { return points }
        var keep = [Bool](repeating: false, count: points.count)
        keep[0] = true; keep[points.count - 1] = true
        var stack = [(0, points.count - 1)]
        while let (a, b) = stack.popLast() {
            guard b > a + 1 else { continue }
            let p = points[a], q = points[b]
            let dx = q.longitude - p.longitude, dy = q.latitude - p.latitude
            let length = max((dx * dx + dy * dy).squareRoot(), 1e-12)
            var far = 0.0, index = a
            for i in (a + 1)..<b {
                let r = points[i]
                let distance = abs(dy * (r.longitude - p.longitude) - dx * (r.latitude - p.latitude)) / length
                if distance > far { far = distance; index = i }
            }
            if far > tolerance { keep[index] = true; stack.append((a, index)); stack.append((index, b)) }
        }
        return points.indices.filter { keep[$0] }.map { points[$0] }
    }

    var center: CLLocationCoordinate2D {
        let ring = polygons.max(by: { ($0.first?.count ?? 0) < ($1.first?.count ?? 0) })?.first ?? []
        guard !ring.isEmpty else { return CLLocationCoordinate2D(latitude: 0, longitude: 0) }
        let lat = ring.map(\.latitude).reduce(0, +) / Double(ring.count)
        let lon = ring.map(\.longitude).reduce(0, +) / Double(ring.count)
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    /// Ray casting on the outer ring minus holes, for every polygon part.
    func contains(_ point: CLLocationCoordinate2D) -> Bool {
        // Most city taps are outside any particular district's box; skip its full-resolution rings immediately.
        guard bounds?.contains(point) == true else { return false }
        return polygons.contains { rings in
            guard let outer = rings.first, Self.inside(point, outer) else { return false }
            return !rings.dropFirst().contains { Self.inside(point, $0) }
        }
    }

    static func inside(_ p: CLLocationCoordinate2D, _ ring: [CLLocationCoordinate2D]) -> Bool {
        var result = false
        var j = ring.count - 1
        for i in 0..<ring.count {
            let a = ring[i], b = ring[j]
            if (a.latitude > p.latitude) != (b.latitude > p.latitude),
               p.longitude < (b.longitude - a.longitude) * (p.latitude - a.latitude) / (b.latitude - a.latitude) + a.longitude {
                result.toggle()
            }
            j = i
        }
        return result
    }
}

/// The per-district figures that colour the map (district-counts). Missing values stay nil → «غير متاح».
struct DistrictCounts: Decodable {
    let district_ar: String
    let n: Double?
    let n_whatsapp: Double?
    let n_wholesale: Double?
    let area_km2: Double?
    let population: Double?
    let residents_per: Double?
    let per_km2: Double?
    let density: Double?
}

struct Activity: Decodable, Hashable, Identifiable {
    let main_id: String?
    let main_ar: String
    let n: Double
    /// A typed query is resolved by the taxonomy service to a precise subcategory.
    let query: String?

    init(main_id: String?, main_ar: String, n: Double, query: String? = nil) {
        self.main_id = main_id
        self.main_ar = main_ar
        self.n = n
        self.query = query
    }

    var id: String { query.map { "query:\($0)" } ?? (main_id ?? main_ar) }

    func matches(_ query: String) -> Bool {
        let category = Self.searchKey(main_ar), term = Self.searchKey(query)
        return category.contains(term) || term.contains(category)
    }

    private static func searchKey(_ text: String) -> String {
        text.lowercased()
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "ar"))
            .replacingOccurrences(of: "أ", with: "ا")
            .replacingOccurrences(of: "إ", with: "ا")
            .replacingOccurrences(of: "آ", with: "ا")
            .replacingOccurrences(of: "ى", with: "ي")
    }
}

struct ActivitySearchResponse: Decodable {
    struct Understanding: Decodable {
        let labels: [String]
        let more: Int
    }
    let total: Double?
    let understood: Understanding?

    func suggestion(query: String) throws -> Activity? {
        guard let labels = understood?.labels, !labels.isEmpty else { return nil }
        guard let total, total.isFinite, total >= 0 else {
            throw APIError.server("تعذر قراءة عدد المنشآت لهذا التخصص.")
        }
        return Activity(main_id: nil, main_ar: labels.joined(separator: "، "), n: total, query: query)
    }
}

/// A table response must state its rows explicitly; a missing/null table is not an empty measurement.
struct DistrictRows<T: Decodable>: Decodable {
    let available: Bool?
    let districts: [T]

    var hasSource: Bool { available ?? !districts.isEmpty }
}

struct CitySummary: Decodable {
    let total: Double?
    let districts_count: Double?
    let n_wholesale: Double?
    let n_whatsapp: Double?
    let main_activities: [Activity]
}

struct AgeRow: Decodable, Hashable {
    let age_group: String
    let total: Double
}

struct Growth: Decodable, Hashable {
    let district_ar: String
    let under_construction: Double?
    let new_buildings: Double?
    let homes_under_construction: Double?
}

struct DistrictProfile: Decodable {
    let district: String
    let population: Double?
    let male: Double?
    let female: Double?
    let ages: [AgeRow]?
    let saudi_pct: Double?
    let businesses: Double?
    let whatsapp: Double?
    let wholesale: Double?
    let main_activities: [Activity]?
    let growth: Growth?
}

/// Measured sex and nationality shares per district (910ths cities only), with the segment sizes worked out server-side.
struct Audience: Decodable {
    let district_ar: String
    let male_pct: Double?
    let saudi_pct: Double?
    let men: Double?
    let women: Double?
    let saudi: Double?
    let non_saudi: Double?
}

struct Income: Decodable {
    let district_ar: String
    let income_all: Double?
    let income_male: Double?
    let income_female: Double?
    let income_saudi: Double?
    let income_non_saudi: Double?

    func workingIncome(for segment: Segment) -> Double? {
        let value: Double?
        switch segment {
        case .everyone: value = income_all
        case .men: value = income_male
        case .women: value = income_female
        case .saudi: value = income_saudi
        case .nonSaudi: value = income_non_saudi
        }
        guard let value, value.isFinite, value >= 0 else { return nil }
        return value
    }
}

struct Housing: Decodable {
    let district_ar: String
    let villa_share_pct: Double?
    let villa_units: Double
    let classified_home_units: Double
}

/// Districts where an activity has fewer businesses than the city rate would carry for its residents.
struct Gap: Decodable {
    let district_ar: String
    let population: Double?
    let businesses: Double?
    let expected_businesses: Double?
    let shortfall: Double?
    let residents_per_business: Double?
    let fit_score: Double?
}

struct GapTable: Decodable {
    let residents_per_business: Double?
    let fit_sample_districts: Int?
    let districts: [Gap]
}

struct Territory: Decodable, Identifiable {
    struct Member: Decodable { let district_ar: String; let weight: Double? }
    let territory: Int
    let weight: Double?
    let districts: [Member]
    var id: Int { territory }
}

struct Around: Decodable {
    struct Top: Decodable, Hashable { let activity: String; let n: Double }
    let radius_m: Double?
    let dwellings: Double?
    let population: Double?
    let businesses: Double?
    let top_activities: [Top]?
}

struct Listing: Decodable, Identifiable, Hashable {
    let id: String
    let url: String?
    let lon: Double
    let lat: Double
    let district_ar: String?
    let kind: String?
    let deal: String?
    let group: String?
    let type: String?
    let price_sar: Double?
    let area_sqm: Double?
    let sar_per_sqm: Double?
    let check: Bool?
    let photo: String?
    let photos: [String]?
    let beds: Double?
    let livings: Double?
    let wc: Double?
    let age: Double?
    let street_width: Double?
    let listed_on: String?
    let updated_on: String?
    let vs_district_pct: Double?
    let has_phone: Bool?

    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
}

/// Local filters for the user-reviewed real-estate opportunity list.
/// An active filter excludes records whose corresponding source value is unavailable.
struct ListingSearchFilter: Equatable {
    var district: String?
    var type: String? = nil
    var deal: String? = nil
    var maximumPrice: Double? = nil
    var minimumBeds: Double?
    var maximumAge: Double?
    var minimumDistrictDensity: Double?

    var isActive: Bool {
        district != nil || type != nil || deal != nil || maximumPrice != nil
            || minimumBeds != nil || maximumAge != nil || minimumDistrictDensity != nil
    }

    func matches(_ listing: Listing, densityByDistrict: [String: Double]) -> Bool {
        if let district, listing.district_ar != district { return false }
        if let type, listing.type != type { return false }
        if let deal, listing.deal != deal { return false }
        if let maximumPrice {
            guard let price = listing.price_sar, price <= maximumPrice else { return false }
        }
        if let minimumBeds {
            guard let beds = listing.beds, beds >= minimumBeds else { return false }
        }
        if let maximumAge {
            guard let age = listing.age, age <= maximumAge else { return false }
        }
        if let minimumDistrictDensity {
            guard let name = listing.district_ar,
                  let density = densityByDistrict[name], density >= minimumDistrictDensity else { return false }
        }
        return true
    }
}

// MARK: - Client

enum APIError: LocalizedError {
    case server(String)
    case listingsPaginationUnsupported
    case authenticationRequired
    case authorizationRequired
    case advisorAuthenticationRequired
    var errorDescription: String? {
        switch self {
        case .server(let message): return message
        case .listingsPaginationUnsupported: return "خدمة العروض لا تدعم تحميل بقية النتائج بعد؛ حدّث الخدمة ثم أعد المحاولة."
        case .authenticationRequired: return "سجّل الدخول إلى أطلس لعرض رقم المعلن."
        case .authorizationRequired: return "حسابك غير مخول لاستخدام مستشار أطلس."
        case .advisorAuthenticationRequired: return "سجّل الدخول إلى أطلس لاستخدام المستشار."
        }
    }
}

enum APICachePolicy {
    static let freshFor: TimeInterval = 6 * 60 * 60
    static let offlineMaximumAge: TimeInterval = 24 * 60 * 60

    static func isFresh(age: TimeInterval?) -> Bool {
        guard let age, age >= 0 else { return false }
        return age < freshFor
    }

    static func mayServeImmediately(age: TimeInterval?) -> Bool {
        guard let age, age >= 0 else { return false }
        return age <= offlineMaximumAge
    }

    static func refreshBeforeServingCachedResponse(resource: String) -> Bool {
        // Cached listing pages may belong to different market snapshots, so refresh them before pagination.
        resource == "real-estate-listings"
    }

    static func isCacheableJSON(_ data: Data) -> Bool {
        guard let value = try? JSONSerialization.jsonObject(with: data) else { return false }
        return value is [Any] || value is [String: Any]
    }

    static func isValidResponse(_ data: Data, resource: String, expectedListingOffset: Int? = nil) -> Bool {
        guard isCacheableJSON(data) else { return false }
        if resource == "real-estate-listings", let expectedListingOffset {
            return (try? AtlasAPI.parseListings(data, expectedOffset: expectedListingOffset)) != nil
        }
        if resource == "housing-level" { return isValidHousingResponse(data) || isLegacyHousingResponse(data) }
        return true
    }

    static func isValidCachedResponse(_ data: Data, resource: String, expectedListingOffset: Int? = nil) -> Bool {
        guard isValidResponse(data, resource: resource, expectedListingOffset: expectedListingOffset) else { return false }
        // An unavailable housing snapshot may be temporary while the service rebuilds its classified-unit table.
        return resource != "housing-level" || (housingAvailability(data) == true && !isLegacyHousingResponse(data))
    }

    static func shouldCacheResponse(_ data: Data, resource: String) -> Bool {
        resource != "housing-level" || (housingAvailability(data) == true && !isLegacyHousingResponse(data))
    }

    private static func housingAvailability(_ data: Data) -> Bool? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return object["available"] as? Bool
    }

    private static func isValidHousingResponse(_ data: Data) -> Bool {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let available = object["available"] as? Bool,
              let districts = object["districts"] as? [[String: Any]] else { return false }
        if !available { return districts.isEmpty }
        return districts.allSatisfy { row in
            guard let name = row["district_ar"] as? String, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let share = row["villa_share_pct"] as? NSNumber,
                  let villas = row["villa_units"] as? NSNumber,
                  let classified = row["classified_home_units"] as? NSNumber else { return false }
            return share.doubleValue.isFinite && (0...100).contains(share.doubleValue)
                && villas.doubleValue.isFinite && villas.doubleValue >= 0
                && classified.doubleValue.isFinite && classified.doubleValue >= 0
                && villas.doubleValue <= classified.doubleValue
        }
    }

    /// The live API can temporarily serve its old mixed-unit schema during a rebuild. Treat that
    /// known schema as a successful but unavailable measurement so the UI says “غير متاح”.
    static func isLegacyHousingResponse(_ data: Data) -> Bool {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["available"] as? Bool == true,
              let districts = object["districts"] as? [[String: Any]], !districts.isEmpty else { return false }
        return districts.allSatisfy { row in
            guard let name = row["district_ar"] as? String, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let share = row["villa_share_pct"] as? NSNumber,
                  let villas = row["villas"] as? NSNumber,
                  let dwellings = row["dwelling_units"] as? NSNumber else { return false }
            return row["villa_units"] == nil && row["classified_home_units"] == nil
                && share.doubleValue.isFinite && (0...100).contains(share.doubleValue)
                && villas.doubleValue.isFinite && villas.doubleValue >= 0
                && dwellings.doubleValue.isFinite && dwellings.doubleValue >= 0
        }
    }
}

final class AtlasAPI {
    static let shared = AtlasAPI()
    let base = URL(string: "https://atlas.farq.sa/api/market/")!
    private let session: URLSession
    private let cacheDir: URL

    init(session: URLSession? = nil, cacheDirectory: URL? = nil) {
        let directory = cacheDirectory ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("atlas-api", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        self.cacheDir = directory
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 45
            config.requestCachePolicy = .reloadRevalidatingCacheData
            config.httpCookieStorage = .shared
            config.httpShouldSetCookies = true
            self.session = URLSession(configuration: config)
        }
    }

    /// Valid JSON responses are kept on the phone. A copy under six hours old is served at once; a six-to-24-hour copy
    /// is also served at once while refreshing quietly. Offline fallback is limited to one day because market data can
    /// change daily; older, malformed, or undated copies are not shown as current.
    private func request(_ resource: String, query: [URLQueryItem], body: [String: Any]?) throws -> URLRequest {
        var components = URLComponents(url: base.appendingPathComponent(resource), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.setValue("FarqAtlas-iOS/1.0", forHTTPHeaderField: "user-agent")
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body, options: .sortedKeys)
        }
        return request
    }

    private func cacheFile(_ request: URLRequest) -> URL {
        let key = (request.url?.absoluteString ?? "") + "|" + String(decoding: request.httpBody ?? Data(), as: UTF8.self)
        let digest = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return cacheDir.appendingPathComponent(digest)
    }

    private func fetch(_ request: URLRequest, into file: URL, resource: String, expectedListingOffset: Int? = nil) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError.server(message ?? "تعذر تحميل البيانات.")
        }
        guard APICachePolicy.isValidResponse(data, resource: resource, expectedListingOffset: expectedListingOffset) else {
            throw APIError.server("تعذر قراءة رد البيانات؛ لم تُحفظ نسخة غير صالحة.")
        }
        if APICachePolicy.shouldCacheResponse(data, resource: resource) {
            try? data.write(to: file, options: .atomic)
        }
        return data
    }

    private func data(_ resource: String, query: [URLQueryItem] = [], body: [String: Any]? = nil) async throws -> Data {
        let request = try request(resource, query: query, body: body)
        let file = cacheFile(request)
        let diskData = try? Data(contentsOf: file)
        let expectedListingOffset = resource == "real-estate-listings" ? (body?["offset"] as? Int ?? 0) : nil
        let cached = diskData.flatMap {
            APICachePolicy.isValidCachedResponse($0, resource: resource, expectedListingOffset: expectedListingOffset) ? $0 : nil
        }
        if diskData != nil && cached == nil { try? FileManager.default.removeItem(at: file) }
        let age = (try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate).map { Date().timeIntervalSince($0) }
        if let cached, APICachePolicy.refreshBeforeServingCachedResponse(resource: resource) {
            do {
                return try await fetch(request, into: file, resource: resource, expectedListingOffset: expectedListingOffset)
            } catch {
                if APICachePolicy.mayServeImmediately(age: age) { return cached }
                throw error
            }
        }
        if let cached, APICachePolicy.mayServeImmediately(age: age) {
            if !APICachePolicy.isFresh(age: age) {
                Task.detached(priority: .utility) { [self] in
                    _ = try? await fetch(request, into: file, resource: resource, expectedListingOffset: expectedListingOffset)
                }
            }
            return cached
        }
        return try await fetch(request, into: file, resource: resource, expectedListingOffset: expectedListingOffset)
    }

    /// Keep cities without neighborhood geometry visible; callers label their district-level data as unavailable.
    static func cityCatalog(_ rows: [City]) throws -> [City] {
        guard !rows.isEmpty,
              rows.allSatisfy({ !$0.en.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && ($0.districts ?? 0) >= 0 }),
              Set(rows.map(\.en)).count == rows.count else {
            throw APIError.server("قائمة المدن غير مكتملة أو غير صالحة.")
        }
        return rows
    }

    func cities() async throws -> [City] {
        let rows = try JSONDecoder().decode([City].self, from: try await data("cities"))
        return try Self.cityCatalog(rows)
    }

    func districts(city: String, expectedCount: Int? = nil) async throws -> [DistrictShape] {
        let raw = try await data("districts", query: [URLQueryItem(name: "city", value: city)])
        let shapes = try Self.parseDistricts(raw)
        try Self.validateDistrictCount(shapes.count, expected: expectedCount)
        return shapes
    }

    static func validateDistrictCount(_ actual: Int, expected: Int?) throws {
        guard expected == nil || actual == expected else {
            throw APIError.server("عدد حدود الأحياء لا يطابق قائمة المدن؛ لم نعرض خريطة ناقصة.")
        }
    }

    func counts(city: String, mainId: String? = nil, query: String? = nil) async throws -> [DistrictCounts] {
        var body: [String: Any] = ["city": city]
        if let query { body["q"] = query }
        else if let mainId { body["main_id"] = mainId }
        return try await decode(DistrictRows<DistrictCounts>.self, "district-counts", body).districts
    }

    func searchActivity(city: String, query: String) async throws -> ActivitySearchResponse {
        try await decode(ActivitySearchResponse.self, "district-counts", ["city": city, "q": query])
    }

    func audience(city: String) async throws -> DistrictRows<Audience> { try await decode(DistrictRows<Audience>.self, "district-audience", ["city": city]) }
    func income(city: String) async throws -> DistrictRows<Income> { try await decode(DistrictRows<Income>.self, "district-income", ["city": city]) }
    func housing(city: String) async throws -> DistrictRows<Housing> {
        try Self.parseHousing(try await data("housing-level", body: ["city": city]))
    }

    static func parseHousing(_ data: Data) throws -> DistrictRows<Housing> {
        guard !APICachePolicy.isLegacyHousingResponse(data) else {
            return DistrictRows(available: false, districts: [])
        }
        return try JSONDecoder().decode(DistrictRows<Housing>.self, from: data)
    }
    func growth(city: String) async throws -> DistrictRows<Growth> { try await decode(DistrictRows<Growth>.self, "growth", ["city": city]) }

    func gaps(city: String, mainId: String? = nil, query: String? = nil) async throws -> GapTable {
        var body: [String: Any] = ["city": city, "limit": 200]
        if let query { body["q"] = query }
        else if let mainId { body["main_id"] = mainId }
        return try await decode(GapTable.self, "market-gaps", body)
    }

    func territories(city: String, count: Int, weight: String, mainId: String? = nil, query: String? = nil) async throws -> [Territory] {
        struct Envelope: Decodable { let territories: [Territory] }
        var body: [String: Any] = ["city": city, "count": count, "weight": weight]
        if let query { body["q"] = query }
        else if let mainId { body["main_id"] = mainId }
        return try await decode(Envelope.self, "territories", body).territories
    }

    /// Sends only the visible, aggregate context to the authenticated advisor endpoint; this request is never cached.
    func advise(mode: AtlasAdvisorMode, facts: String, profile: String, turns: [AtlasAdvisorTurn]) async throws -> String {
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        components.path = "/api/advisor"
        guard let url = components.url else { throw APIError.server("تعذر إعداد طلب المستشار.") }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("FarqAtlas-iOS/1.0", forHTTPHeaderField: "user-agent")
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue("https://atlas.farq.sa", forHTTPHeaderField: "origin")
        request.setValue("no-store", forHTTPHeaderField: "cache-control")
        request.httpBody = try JSONSerialization.data(withJSONObject: Self.advisorBody(mode: mode, facts: facts, profile: profile, turns: turns), options: .sortedKeys)
        let raw: Data
        let response: URLResponse
        do {
            (raw, response) = try await session.data(for: request)
        } catch {
            if let fallback = Self.advisorFallback(mode: mode, facts: facts, profile: profile, turns: turns) { return fallback }
            throw error
        }
        guard let http = response as? HTTPURLResponse else {
            if let fallback = Self.advisorFallback(mode: mode, facts: facts, profile: profile, turns: turns) { return fallback }
            throw APIError.server("تعذر الوصول إلى المستشار.")
        }
        if http.statusCode == 401 {
            if let fallback = Self.advisorFallback(statusCode: http.statusCode, mode: mode, facts: facts, profile: profile, turns: turns) {
                return fallback
            }
            throw APIError.advisorAuthenticationRequired
        }
        if http.statusCode == 403 { throw APIError.authorizationRequired }
        guard (200..<300).contains(http.statusCode) else {
            if let fallback = Self.advisorFallback(statusCode: http.statusCode, mode: mode, facts: facts, profile: profile, turns: turns) { return fallback }
            let message = (try? JSONSerialization.jsonObject(with: raw) as? [String: Any])?["error"] as? String
            throw APIError.server(message ?? "تعذر الحصول على رد المستشار.")
        }
        struct Envelope: Decodable { let reply: String }
        let envelope: Envelope
        do {
            envelope = try JSONDecoder().decode(Envelope.self, from: raw)
        } catch {
            if let fallback = Self.advisorFallback(mode: mode, facts: facts, profile: profile, turns: turns) { return fallback }
            throw error
        }
        guard !envelope.reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            if let fallback = Self.advisorFallback(mode: mode, facts: facts, profile: profile, turns: turns) { return fallback }
            throw APIError.server("تعذر الحصول على رد المستشار.")
        }
        return envelope.reply
    }

    static func advisorBody(mode: AtlasAdvisorMode, facts: String, profile: String, turns: [AtlasAdvisorTurn]) -> [String: Any] {
        ["mode": mode.rawValue, "facts": facts, "profile": profile,
         "turns": turns.map { ["role": $0.role, "content": $0.content] }]
    }

    static func advisorFallback(statusCode: Int, mode: AtlasAdvisorMode, facts: String = "", profile: String = "", turns: [AtlasAdvisorTurn] = []) -> String? {
        // Real-estate comparisons use only the listings already visible to the person, so they remain
        // useful before sign-in. A 403 is an explicit account restriction and still requires access.
        guard statusCode != 403 else { return nil }
        return advisorFallback(mode: mode, facts: facts, profile: profile, turns: turns)
    }

    static func advisorFallback(mode: AtlasAdvisorMode, facts: String = "", profile: String = "", turns: [AtlasAdvisorTurn] = []) -> String? {
        guard mode == .realEstate else { return nil }
        let lines = facts.split(separator: "\n").map(String.init)
        let filterPrefixes = ["المدينة:", "نوع الصفقة:", "نوع العقار:", "مدة الإيجار:", "الحي:", "الحد الأعلى للسعر:",
                              "أقل عدد غرف:", "حد عمر العقار:", "رتبة كثافة الحي المختارة:", "عدد العروض المطابقة من النتائج المحملة:"]
        let filters = lines.filter { line in
            filterPrefixes.contains { line.hasPrefix($0) }
        }
        let listings = lines.filter { $0.hasPrefix("عرض ") }.prefix(3)
        let requestedPriority = profile.trimmingCharacters(in: .whitespacesAndNewlines)
        let latestQuestion = turns.last(where: { $0.role == "user" })?.content.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let listingFacts = listings.compactMap(AdvisorFallbackListing.init)

        var reply = ["اقتراح عام لمسار العقار، مبني على البيانات الظاهرة فقط:"]
        if !requestedPriority.isEmpty { reply.append("الأولوية التي ذكرتها: \(requestedPriority)") }
        if !filters.isEmpty { reply.append(contentsOf: filters) }
        if listings.isEmpty {
            reply.append("لا تظهر عروض محمّلة للمقارنة الآن. جرّب تخفيف شرط واحد غير أساسي، ثم أعد تحميل العروض؛ هذا لا يعني عدم وجود عروض أخرى في السوق.")
        } else {
            reply.append("من العروض الظاهرة:")
            reply.append(contentsOf: listings.map { "- \($0)" })
            if let comparison = compareVisibleListings(listingFacts, requestedBy: "\(requestedPriority)\n\(latestQuestion)") {
                reply.append(comparison)
            } else {
                reply.append("قارن بين العروض على أساس مدة الإيجار ونوع العقار والغرف والمساحة، واستخدم فرق السعر عن وسيط الحي فقط عندما يكون متاحاً.")
            }
        }
        reply.append("العروض عينة إعلانات؛ السعر ليس صفقة مكتملة، وبيانات أطلس لا تثبت استمرار توفر الإعلان أو حالته. تحقق من التفاصيل مع المعلن.")
        return reply.joined(separator: "\n")
    }

    private struct AdvisorFallbackListing {
        let label: String
        let type: String
        let deal: String
        let price: Double?
        let area: Double?
        let beds: Double?

        init?(_ line: String) {
            let parts = line.components(separatedBy: "، ")
            guard parts.count >= 2, let split = parts[0].range(of: ": ") else { return nil }
            label = String(parts[0][..<split.lowerBound])
            type = String(parts[0][split.upperBound...])
            deal = parts[1]
            price = Self.number(in: parts, prefix: "السعر ", unit: " ر.س")
            area = Self.number(in: parts, prefix: "المساحة ", unit: " م²")
            beds = Self.number(in: parts, prefix: "غرف النوم ", unit: "")
        }

        private static func number(in parts: [String], prefix: String, unit: String) -> Double? {
            guard let field = parts.first(where: { $0.hasPrefix(prefix) }) else { return nil }
            let raw = String(field.dropFirst(prefix.count))
            let bidiControls = CharacterSet(charactersIn: "\u{200E}\u{200F}\u{202A}\u{202B}\u{202C}\u{202D}\u{202E}\u{2066}\u{2067}\u{2068}\u{2069}")
            let readable = String(String.UnicodeScalarView(raw.unicodeScalars.filter { !bidiControls.contains($0) }))
            let token = unit.isEmpty ? readable : String(readable.replacingOccurrences(of: unit, with: "").trimmingCharacters(in: .whitespaces))
            guard let value = Double(token.replacingOccurrences(of: ",", with: "")), value.isFinite, value >= 0 else { return nil }
            return value
        }
    }

    private static func compareVisibleListings(_ listings: [AdvisorFallbackListing], requestedBy text: String) -> String? {
        let request = text.lowercased()
        let wantsLowestPrice = ["الأرخص", "ارخص", "أقل سعر", "اقل سعر", "السعر الأقل", "السعر الاقل"].contains { request.contains($0) }
        let wantsMoreSpace = ["مساحة أكبر", "مساحه اكبر", "أكبر مساحة", "اكبر مساحة"].contains { request.contains($0) }
        let wantsMoreBeds = ["غرف أكثر", "غرف اكثر", "عدد غرف أكبر", "عدد غرف اكثر"].contains { request.contains($0) }

        if wantsLowestPrice {
            guard Set(listings.map(\.type)).count == 1, Set(listings.map(\.deal)).count == 1 else {
                return "لا أقارن السعر الكلي هنا لأن نوع العقار أو مدة الإيجار تختلف بين العروض الظاهرة."
            }
            let priced = listings.compactMap { listing -> (AdvisorFallbackListing, Double)? in
                listing.price.map { (listing, $0) }
            }
            guard priced.count >= 2 else { return "لا يتوفر سعر معلن لعَرضين على الأقل من النوع والمدة نفسيهما لإجراء مقارنة صحيحة." }
            guard let lowest = priced.map(\.1).min() else { return nil }
            let matches = priced.filter { $0.1 == lowest }.map { $0.0.label }
            let price = Fmt.int(lowest)
            let names = matches.joined(separator: " و")
            return matches.count == 1
                ? "الأقل سعراً بين الإعلانات الظاهرة من النوع والمدة نفسيهما هو \(names) بسعر \(price) ر.س. هذا لا يعني أنه الأنسب لاحتياجك."
                : "يتعادل \(names) كأقل سعر معلن (\(price) ر.س) بين العروض الظاهرة من النوع والمدة نفسيهما."
        }

        let measurement: (String, (AdvisorFallbackListing) -> Double?)?
        if wantsMoreSpace { measurement = ("المساحة", \.area) }
        else if wantsMoreBeds { measurement = ("عدد غرف النوم", \.beds) }
        else { measurement = nil }
        if let (label, valueFor) = measurement {
            let measured = listings.compactMap { listing -> (AdvisorFallbackListing, Double)? in
                valueFor(listing).map { (listing, $0) }
            }
            guard measured.count >= 2 else { return "لا تتوفر قيمة \(label) لعَرضين على الأقل لإجراء المقارنة." }
            guard let highest = measured.map(\.1).max() else { return nil }
            let matches = measured.filter { $0.1 == highest }.map { $0.0.label }
            let value = Fmt.int(highest)
            let names = matches.joined(separator: " و")
            let metric = label == "المساحة" ? "أكبر مساحة" : "أكثر غرف النوم"
            return matches.count == 1
                ? "\(metric) بين العروض الظاهرة في هذه العينة لدى \(names) (\(value)\(label == "المساحة" ? " م²" : " غرف"))."
                : "يتعادل \(names) في \(metric) بين العروض الظاهرة (\(value)\(label == "المساحة" ? " م²" : " غرف"))."
        }
        return nil
    }

    func around(_ point: CLLocationCoordinate2D, radius: Double) async throws -> Around {
        try await decode(Around.self, "population-around", ["lon": point.longitude, "lat": point.latitude, "radius_m": radius])
    }

    func listings(city: String, kind: String, types: [String]?, deal: String? = nil, maxPrice: Double?, districtIDs: [String]? = nil,
                  minimumBeds: Double? = nil, maxAge: Double? = nil, minDiscountPct: Double? = nil,
                  maxDiscountPct: Double? = nil, limit: Int = 1500, offset: Int = 0) async throws -> (retrieved: String?, total: Int, offset: Int, rows: [Listing]) {
        let body = Self.listingsBody(city: city, kind: kind, types: types, deal: deal, maxPrice: maxPrice,
                                     districtIDs: districtIDs, minimumBeds: minimumBeds, maxAge: maxAge,
                                     minDiscountPct: minDiscountPct, maxDiscountPct: maxDiscountPct, limit: limit, offset: offset)
        return try Self.parseListings(await data("real-estate-listings", body: body), expectedOffset: offset)
    }

    /// Fetch one advertiser number only after an explicit tap. Never route this response through the disk cache.
    func listingPhone(_ id: String) async throws -> String? {
        let request = try self.request("listing-phone", query: [], body: ["id": id])
        let (raw, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.server("تعذر تحميل رقم المعلن.") }
        if http.statusCode == 401 { throw APIError.authenticationRequired }
        guard (200..<300).contains(http.statusCode) else { throw APIError.server("تعذر جلب الرقم الآن.") }
        let envelope = try JSONDecoder().decode(ListingPhoneEnvelope.self, from: raw)
        guard let phone = envelope.phone else { return nil }
        guard Self.isSaudiMobile(phone) else { throw APIError.server("رقم المعلن غير صالح.") }
        return phone
    }

    /// Login uses Atlas's same-origin session endpoint; the HttpOnly cookie is shared with later phone requests.
    func signIn(email: String, password: String) async throws {
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        components.path = "/api/session/login"
        guard let url = components.url else { throw APIError.server("تعذر إعداد تسجيل الدخول.") }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue("https://atlas.farq.sa", forHTTPHeaderField: "origin")
        request.setValue("no-store", forHTTPHeaderField: "cache-control")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "password": password])
        let (raw, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.server("تعذر الوصول إلى خدمة الحسابات.") }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: raw) as? [String: Any])?["error"] as? String
            throw APIError.server(message ?? "تعذر تسجيل الدخول.")
        }
    }

    static func isSaudiMobile(_ value: String) -> Bool {
        let digits = value.utf8
        return digits.count == 10 && value.hasPrefix("05") && digits.allSatisfy { 48...57 ~= $0 }
    }

    private struct ListingPhoneEnvelope: Decodable { let phone: String? }

    static func listingsBody(city: String, kind: String, types: [String]?, deal: String? = nil, maxPrice: Double?,
                             districtIDs: [String]?, minimumBeds: Double?, maxAge: Double?,
                             minDiscountPct: Double?, maxDiscountPct: Double?, limit: Int, offset: Int = 0) -> [String: Any] {
        var body: [String: Any] = ["city": city, "kind": kind, "limit": limit, "offset": offset]
        if let types, !types.isEmpty { body["types"] = types }
        if let deal { body["deal"] = deal }
        if let maxPrice { body["max_price"] = maxPrice }
        if let districtIDs { body["district_ids"] = districtIDs }
        if let minimumBeds { body["min_beds"] = minimumBeds }
        if let maxAge { body["max_age"] = maxAge }
        if let minDiscountPct { body["min_vs_district_pct"] = minDiscountPct }
        if let maxDiscountPct { body["max_vs_district_pct"] = maxDiscountPct }
        return body
    }

    static func parseListings(_ data: Data, expectedOffset: Int = 0) throws -> (retrieved: String?, total: Int, offset: Int, rows: [Listing]) {
        struct Envelope: Decodable {
            let available: Bool
            let retrieved: String?
            let total: Int?
            let offset: Int?
            let listings: [Listing]?
        }
        let envelope = try JSONDecoder().decode(Envelope.self, from: data)
        guard envelope.available else {
            throw APIError.server("بيانات العروض العقارية غير متاحة الآن.")
        }
        guard let total = envelope.total, total >= 0, let listings = envelope.listings,
              expectedOffset >= 0 else {
            throw APIError.server("رد بيانات العروض العقارية غير مكتمل.")
        }
        let returnedOffset = envelope.offset ?? 0
        guard returnedOffset == expectedOffset, expectedOffset == 0 || envelope.offset != nil else {
            throw APIError.listingsPaginationUnsupported
        }
        if expectedOffset < total {
            guard !listings.isEmpty else {
                throw APIError.server("رد صفحة العروض فارغ رغم بقاء نتائج؛ أعد المحاولة.")
            }
            guard listings.count <= total - expectedOffset else {
                throw APIError.server("عدد عروض الصفحة يتجاوز الإجمالي المعلن؛ أعد تحميل العروض.")
            }
        } else if !listings.isEmpty {
            throw APIError.server("رد صفحة العروض يتجاوز الإجمالي المعلن؛ أعد تحميل العروض.")
        }
        var ids = Set<String>()
        for listing in listings {
            guard !listing.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  ids.insert(listing.id).inserted else {
                throw APIError.server("تعذر قراءة العروض العقارية؛ هوية أحد العروض غير صالحة أو مكررة.")
            }
            guard listing.lat.isFinite, listing.lon.isFinite,
                  (-90...90).contains(listing.lat), (-180...180).contains(listing.lon) else {
                throw APIError.server("تعذر قراءة العروض العقارية؛ إحداثيات أحد العروض خارج النطاق.")
            }
        }
        let retrieved: String?
        if let rawDay = envelope.retrieved {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            formatter.dateFormat = "yyyy-MM-dd"
            formatter.isLenient = false
            retrieved = formatter.date(from: rawDay).flatMap { formatter.string(from: $0) == rawDay ? rawDay : nil }
        } else {
            retrieved = nil
        }
        return (retrieved, total, returnedOffset, listings)
    }

    private func decode<T: Decodable>(_ type: T.Type, _ resource: String, _ body: [String: Any]) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await data(resource, body: body))
    }

    func summary(city: String) async throws -> CitySummary {
        struct Envelope: Decodable { let summary: CitySummary }
        return try JSONDecoder().decode(Envelope.self, from: try await data("market-summary", body: ["city": city])).summary
    }

    func profile(city: String, district: String) async throws -> DistrictProfile {
        try JSONDecoder().decode(DistrictProfile.self, from: try await data("district-profile", body: ["city": city, "district": district]))
    }

    /// GeoJSON FeatureCollection → shapes. Reject a malformed feature collection instead of showing a partial map.
    static func parseDistricts(_ raw: Data) throws -> [DistrictShape] {
        guard let root = try JSONSerialization.jsonObject(with: raw) as? [String: Any],
              root["type"] as? String == "FeatureCollection",
              let features = root["features"] as? [[String: Any]] else {
            throw APIError.server("تعذر قراءة حدود الأحياء؛ رد الخريطة غير صالح.")
        }
        func ring(_ value: Any) throws -> [CLLocationCoordinate2D] {
            guard let positions = value as? [[NSNumber]], positions.count >= 4 else {
                throw APIError.server("تعذر قراءة حدود الأحياء؛ أحد المضلعات غير مكتمل.")
            }
            let points = try positions.map { position -> CLLocationCoordinate2D in
                guard position.count >= 2 else {
                    throw APIError.server("تعذر قراءة حدود الأحياء؛ أحد الإحداثيات غير صالح.")
                }
                let lon = position[0].doubleValue, lat = position[1].doubleValue
                guard lon.isFinite, lat.isFinite, (-180...180).contains(lon), (-90...90).contains(lat) else {
                    throw APIError.server("تعذر قراءة حدود الأحياء؛ أحد الإحداثيات خارج النطاق.")
                }
                return CLLocationCoordinate2D(latitude: lat, longitude: lon)
            }
            guard let first = points.first, let last = points.last,
                  abs(first.latitude - last.latitude) < 1e-9,
                  abs(first.longitude - last.longitude) < 1e-9 else {
                throw APIError.server("تعذر قراءة حدود الأحياء؛ أحد المضلعات غير مغلق.")
            }
            return points
        }
        var ids = Set<String>()
        var names = Set<String>()
        return try features.map { feature in
            let props = feature["properties"] as? [String: Any] ?? [:]
            guard feature["type"] as? String == "Feature",
                  let geometry = feature["geometry"] as? [String: Any],
                  let type = geometry["type"] as? String else {
                throw APIError.server("تعذر قراءة حدود الأحياء؛ أحد عناصر الخريطة غير صالح.")
            }
            let coordinates = geometry["coordinates"]
            var polygons: [[[CLLocationCoordinate2D]]] = []
            if type == "Polygon", let rings = coordinates as? [Any] {
                polygons = [try rings.map(ring)]
            } else if type == "MultiPolygon", let parts = coordinates as? [[Any]] {
                polygons = try parts.map { try $0.map(ring) }
            } else {
                throw APIError.server("تعذر قراءة حدود الأحياء؛ نوع أحد المضلعات غير مدعوم.")
            }
            guard !polygons.isEmpty, polygons.allSatisfy({ !$0.isEmpty && $0[0].count >= 4 }) else {
                throw APIError.server("تعذر قراءة حدود الأحياء؛ أحد الأحياء بلا حدود صالحة.")
            }
            let rawID = props["id"] ?? feature["id"]
            guard let rawID, !(rawID is NSNull) else {
                throw APIError.server("تعذر قراءة حدود الأحياء؛ معرّف أحد الأحياء مفقود.")
            }
            let id = String(describing: rawID).trimmingCharacters(in: .whitespacesAndNewlines)
            let name = ((props["ar"] as? String) ?? (props["district_ar"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !id.isEmpty, !name.isEmpty, ids.insert(id).inserted, names.insert(name).inserted else {
                throw APIError.server("تعذر قراءة حدود الأحياء؛ اسم أو معرّف حي غير صالح أو مكرر.")
            }
            return DistrictShape(id: id, name: name, areaKm2: props["area_km2"] as? Double, polygons: polygons)
        }
    }
}
