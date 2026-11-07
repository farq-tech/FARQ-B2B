import Foundation
import CoreLocation
import CryptoKit

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
    let id: String
    let name: String
    let areaKm2: Double?
    let polygons: [[[CLLocationCoordinate2D]]]
    /// Outer rings simplified for drawing only (about 15 m tolerance); hit-testing keeps the full outline.
    let drawRings: [[CLLocationCoordinate2D]]

    init(id: String, name: String, areaKm2: Double?, polygons: [[[CLLocationCoordinate2D]]]) {
        self.id = id
        self.name = name
        self.areaKm2 = areaKm2
        self.polygons = polygons
        self.drawRings = polygons.compactMap(\.first).map { Self.simplify($0, tolerance: 0.00015) }.filter { $0.count >= 3 }
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
        polygons.contains { rings in
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
    var id: String { main_id ?? main_ar }
}

struct CitySummary: Decodable {
    let total: Double?
    let districts_count: Double?
    let n_wholesale: Double?
    let n_whatsapp: Double?
    let main_activities: [Activity]?
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
}

struct Housing: Decodable {
    let district_ar: String
    let villa_share_pct: Double?
}

/// Districts where an activity has fewer businesses than the city rate would carry for its residents.
struct Gap: Decodable {
    let district_ar: String
    let population: Double?
    let businesses: Double?
    let expected_businesses: Double?
    let shortfall: Double?
    let residents_per_business: Double?
}

struct GapTable: Decodable {
    let residents_per_business: Double?
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
    let vs_district_pct: Double?

    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
}

// MARK: - Client

enum APIError: LocalizedError {
    case server(String)
    var errorDescription: String? {
        switch self { case .server(let message): return message }
    }
}

final class AtlasAPI {
    static let shared = AtlasAPI()
    let base = URL(string: "https://atlas.farq.sa/api/market/")!
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 45
        config.requestCachePolicy = .reloadRevalidatingCacheData
        return URLSession(configuration: config)
    }()

    /// Every response is kept on the phone. A fresh copy (under `fresh` old) is served at once and refreshed quietly in
    /// the background; with no network, the last copy is served whatever its age, so a weak connection never freezes a
    /// screen. Data on the server changes at most daily.
    private let fresh: TimeInterval = 6 * 3600
    private let cacheDir: URL = {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("atlas-api", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

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

    private func fetch(_ request: URLRequest, into file: URL) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError.server(message ?? "تعذر تحميل البيانات.")
        }
        try? data.write(to: file, options: .atomic)
        return data
    }

    private func data(_ resource: String, query: [URLQueryItem] = [], body: [String: Any]? = nil) async throws -> Data {
        let request = try request(resource, query: query, body: body)
        let file = cacheFile(request)
        let cached = try? Data(contentsOf: file)
        let age = (try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate).map { Date().timeIntervalSince($0) }
        if let cached, let age, age < fresh {
            Task.detached(priority: .utility) { [self] in _ = try? await fetch(request, into: file) }
            return cached
        }
        do {
            return try await fetch(request, into: file)
        } catch {
            if let cached { return cached }
            throw error
        }
    }

    /// Cities with districts in the golden atlas, largest first (same filter as useCities on the web).
    func cities() async throws -> [City] {
        let rows = try JSONDecoder().decode([City].self, from: try await data("cities"))
        return rows.filter { ($0.districts ?? 0) > 0 }
    }

    func districts(city: String) async throws -> [DistrictShape] {
        let raw = try await data("districts", query: [URLQueryItem(name: "city", value: city)])
        return try Self.parseDistricts(raw)
    }

    func counts(city: String, mainId: String? = nil) async throws -> [DistrictCounts] {
        var body: [String: Any] = ["city": city]
        if let mainId { body["main_id"] = mainId }
        return try await decode(Rows<DistrictCounts>.self, "district-counts", body).districts
    }

    func audience(city: String) async throws -> [Audience] { try await decode(Rows<Audience>.self, "district-audience", ["city": city]).districts }
    func income(city: String) async throws -> [Income] { try await decode(Rows<Income>.self, "district-income", ["city": city]).districts }
    func housing(city: String) async throws -> [Housing] { try await decode(Rows<Housing>.self, "housing-level", ["city": city]).districts }
    func growth(city: String) async throws -> [Growth] { try await decode(Rows<Growth>.self, "growth", ["city": city]).districts }

    func gaps(city: String, mainId: String) async throws -> GapTable {
        try await decode(GapTable.self, "market-gaps", ["city": city, "main_id": mainId, "limit": 200])
    }

    func territories(city: String, count: Int, weight: String, mainId: String? = nil) async throws -> [Territory] {
        struct Envelope: Decodable { let territories: [Territory] }
        var body: [String: Any] = ["city": city, "count": count, "weight": weight]
        if let mainId { body["main_id"] = mainId }
        return try await decode(Envelope.self, "territories", body).territories
    }

    func around(_ point: CLLocationCoordinate2D, radius: Double) async throws -> Around {
        try await decode(Around.self, "population-around", ["lon": point.longitude, "lat": point.latitude, "radius_m": radius])
    }

    func listings(city: String, kind: String, types: [String]?, maxPrice: Double?, limit: Int = 600) async throws -> (total: Int, rows: [Listing]) {
        struct Envelope: Decodable { let total: Int?; let listings: [Listing]? }
        var body: [String: Any] = ["city": city, "kind": kind, "limit": limit]
        if let types, !types.isEmpty { body["types"] = types }
        if let maxPrice { body["max_price"] = maxPrice }
        let envelope = try await decode(Envelope.self, "real-estate-listings", body)
        return (envelope.total ?? 0, envelope.listings ?? [])
    }

    private struct Rows<T: Decodable>: Decodable {
        let districts: [T]
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            districts = try c.decodeIfPresent([T].self, forKey: .districts) ?? []
        }
        enum CodingKeys: String, CodingKey { case districts }
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

    /// GeoJSON FeatureCollection → shapes. Polygon and MultiPolygon; anything else is skipped.
    static func parseDistricts(_ raw: Data) throws -> [DistrictShape] {
        guard let root = try JSONSerialization.jsonObject(with: raw) as? [String: Any],
              let features = root["features"] as? [[String: Any]] else { return [] }
        func ring(_ value: Any) -> [CLLocationCoordinate2D] {
            (value as? [[Double]] ?? []).compactMap { $0.count >= 2 ? CLLocationCoordinate2D(latitude: $0[1], longitude: $0[0]) : nil }
        }
        return features.compactMap { feature in
            let props = feature["properties"] as? [String: Any] ?? [:]
            guard let geometry = feature["geometry"] as? [String: Any], let type = geometry["type"] as? String else { return nil }
            let coordinates = geometry["coordinates"]
            var polygons: [[[CLLocationCoordinate2D]]] = []
            if type == "Polygon", let rings = coordinates as? [Any] {
                polygons = [rings.map(ring)]
            } else if type == "MultiPolygon", let parts = coordinates as? [[Any]] {
                polygons = parts.map { $0.map(ring) }
            } else { return nil }
            let id = props["id"].map { "\($0)" } ?? feature["id"].map { "\($0)" } ?? UUID().uuidString
            let name = (props["ar"] as? String) ?? (props["district_ar"] as? String) ?? id
            return DistrictShape(id: id, name: name, areaKm2: props["area_km2"] as? Double, polygons: polygons)
        }
    }
}
