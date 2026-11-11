import SwiftUI
import MapKit

/// A point drawn on the map (a listing, a pinned site).
struct MapDot: Identifiable, Equatable {
    let id: String
    let coordinate: CLLocationCoordinate2D
    let color: Color
    var count: Int = 1
    static func == (a: MapDot, b: MapDot) -> Bool {
        a.id == b.id && a.color == b.color
            && a.count == b.count
            && a.coordinate.latitude == b.coordinate.latitude && a.coordinate.longitude == b.coordinate.longitude
    }
}

/// Distinct property ads can share a geocoded point. Group only their map markers;
/// keep every listing reachable from the cluster and its own list row.
struct ListingMapCluster: Identifiable {
    private struct CoordinateKey: Hashable { let latitude: Int; let longitude: Int }
    let listings: [Listing]

    var id: String { listings.map(\.id).sorted().joined(separator: "|") }
    var coordinate: CLLocationCoordinate2D { listings[0].coordinate }
    var count: Int { listings.count }

    static func group(_ listings: [Listing]) -> [ListingMapCluster] {
        var groups: [CoordinateKey: [Listing]] = [:]
        for listing in listings {
            // Coordinates rounded to five decimals group only effectively identical geocodes (about 1 m).
            // Larger cells made unrelated listings hundreds of metres apart look like one shared location.
            let key = CoordinateKey(latitude: Int((listing.lat * 100_000).rounded()),
                                    longitude: Int((listing.lon * 100_000).rounded()))
            groups[key, default: []].append(listing)
        }
        return groups.values.map { ListingMapCluster(listings: $0.sorted { $0.id < $1.id }) }
            .sorted { $0.id < $1.id }
    }
}

/// The district map, redrawn when its geometry, visible fills, pins, viewport, or interaction meaning changes. A rolling
/// number or a sliding panel elsewhere on the screen never rebuilds thousands of outline points.
struct AtlasMap: View, Equatable {
    let shapes: [DistrictShape]
    let fills: [String: Color]
    /// Changes whenever `fills` changes (metric + data version).
    let key: String
    var highlighted: Set<String> = []
    var dots: [MapDot] = []
    var circle: CLLocationCoordinate2D? = nil
    var radius: Double = 1000
    var focus: MKCoordinateRegion?
    /// Changes when a gesture's meaning changes, so EquatableView refreshes the captured action.
    var interactionKey = ""
    var onTap: ((CLLocationCoordinate2D) -> Void)? = nil
    var onDot: ((String) -> Void)? = nil

    @State private var camera: MapCameraPosition = .automatic
    @State private var hasAppliedInitialFocus = false

    /// The geographic candidates inside a screen-space tap square. Projection is much more expensive than
    /// these simple comparisons, so only nearby pins need to be converted back to screen coordinates.
    static func pinCandidates(_ dots: [MapDot], within corners: [CLLocationCoordinate2D]) -> [MapDot] {
        guard corners.count == 4 else { return dots }
        let minLatitude = corners.map(\.latitude).min() ?? -90
        let maxLatitude = corners.map(\.latitude).max() ?? 90
        let minLongitude = corners.map(\.longitude).min() ?? -180
        let maxLongitude = corners.map(\.longitude).max() ?? 180
        return dots.filter {
            (minLatitude...maxLatitude).contains($0.coordinate.latitude)
                && (minLongitude...maxLongitude).contains($0.coordinate.longitude)
        }
    }

    static func == (a: AtlasMap, b: AtlasMap) -> Bool {
        a.key == b.key && a.highlighted == b.highlighted && a.dots == b.dots
            && a.fills == b.fills
            && a.interactionKey == b.interactionKey && a.radius == b.radius
            && a.circle?.latitude == b.circle?.latitude && a.circle?.longitude == b.circle?.longitude
            && a.focus?.center.latitude == b.focus?.center.latitude && a.focus?.center.longitude == b.focus?.center.longitude
            && a.focus?.span.latitudeDelta == b.focus?.span.latitudeDelta && a.focus?.span.longitudeDelta == b.focus?.span.longitudeDelta
            && a.shapes.count == b.shapes.count
    }

    /// Track the full viewport target; a new district can keep latitude while changing longitude or zoom.
    private var focusSignature: [Double]? {
        guard let focus else { return nil }
        return [focus.center.latitude, focus.center.longitude,
                focus.span.latitudeDelta, focus.span.longitudeDelta]
    }

    var body: some View {
        MapReader { proxy in
            ZStack {
                Map(position: $camera, interactionModes: [.pan, .zoom]) {
                    ForEach(shapes) { shape in
                        let on = highlighted.contains(shape.name)
                        let fill = fills[shape.id] ?? Palette.missing
                        ForEach(Array(shape.drawPolygons.enumerated()), id: \.offset) { _, polygon in
                            MapPolygon(polygon)
                                .foregroundStyle(fill.opacity(0.72))
                                .stroke(on ? Palette.accent : Color.white.opacity(0.7), lineWidth: on ? 3.5 : 0.5)
                        }
                    }
                    ForEach(dots) { dot in
                        Annotation("", coordinate: dot.coordinate, anchor: .center) {
                            Group {
                                if dot.count == 1 {
                                    Circle().fill(dot.color).frame(width: 13, height: 13)
                                        .overlay(Circle().stroke(.white, lineWidth: 2))
                                } else {
                                    Text(Fmt.int(Double(dot.count)))
                                        .font(Typo.font(12, .bold)).monospacedDigit().foregroundStyle(.white)
                                        .frame(minWidth: 28, minHeight: 28)
                                        .background(dot.color, in: .circle)
                                        .overlay(Circle().stroke(.white, lineWidth: 2))
                                }
                            }
                            .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
                            .allowsHitTesting(false)
                        }
                    }
                    if let circle {
                        MapCircle(center: circle, radius: radius)
                            .foregroundStyle(Palette.accent.opacity(0.15))
                            .stroke(Palette.accent, lineWidth: 2)
                        Annotation("", coordinate: circle, anchor: .bottom) {
                            Image(systemName: "mappin.circle.fill")
                                .font(.system(size: 34))
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, Palette.accent)
                                .shadow(color: .black.opacity(0.25), radius: 4, y: 2)
                        }
                    }
                }
                .mapStyle(.standard(pointsOfInterest: .excludingAll))
                .overlay {
                    Color.clear
                        .contentShape(Rectangle())
                        .highPriorityGesture(SpatialTapGesture(coordinateSpace: .local).onEnded { touch in
                            // Keep map taps separate from drags so a surrounding ScrollView can own vertical swipes.
                            let point = touch.location
                            // Nearby listing hit areas used to overlap, so a tap on one pin could open its neighbour.
                            // Resolve map taps by the closest visible pin center instead of expanding every annotation.
                            let candidates: [MapDot]
                            if dots.count > 32 {
                                let radius: CGFloat = 24
                                let corners = [
                                    CGPoint(x: point.x - radius, y: point.y - radius),
                                    CGPoint(x: point.x + radius, y: point.y - radius),
                                    CGPoint(x: point.x - radius, y: point.y + radius),
                                    CGPoint(x: point.x + radius, y: point.y + radius),
                                ].compactMap { proxy.convert($0, from: .local) }
                                candidates = Self.pinCandidates(dots, within: corners)
                            } else {
                                candidates = dots
                            }
                            let closest = candidates.compactMap { dot -> (id: String, distance: CGFloat)? in
                                guard let center = proxy.convert(dot.coordinate, to: .local) else { return nil }
                                let dx = center.x - point.x, dy = center.y - point.y
                                return (dot.id, (dx * dx + dy * dy).squareRoot())
                            }.min { $0.distance < $1.distance }
                            if let closest, closest.distance <= 24 {
                                onDot?(closest.id)
                                return
                            }
                            guard let onTap, let coordinate = proxy.convert(point, from: .local) else { return }
                            onTap(coordinate)
                        })
                }
            }
        }
        .accessibilityIdentifier("atlas-map")
        .task(id: focusSignature) {
            guard let focus else { return }
            // MapKit can publish a camera binding update while SwiftUI is still reconciling the Map.
            // Yield until that render pass completes before applying an asynchronously loaded city focus.
            await Task.yield()
            guard !Task.isCancelled else { return }
            if hasAppliedInitialFocus {
                withAnimation(.smooth(duration: 0.6)) { camera = .region(focus) }
            } else {
                camera = .region(focus)
                hasAppliedInitialFocus = true
            }
        }
    }
}
