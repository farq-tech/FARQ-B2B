import SwiftUI
import MapKit

/// A point drawn on the map (a listing, a pinned site).
struct MapDot: Identifiable, Equatable {
    let id: String
    let coordinate: CLLocationCoordinate2D
    let color: Color
    static func == (a: MapDot, b: MapDot) -> Bool { a.id == b.id && a.color == b.color }
}

/// The district map, drawn once per change of what it shows. It compares only `key`, the highlight, the dots and the
/// circle, so a rolling number or a sliding panel elsewhere on the screen never redraws thousands of outline points.
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
    var onTap: ((CLLocationCoordinate2D) -> Void)? = nil
    var onDot: ((String) -> Void)? = nil

    @State private var camera: MapCameraPosition = .automatic

    static func == (a: AtlasMap, b: AtlasMap) -> Bool {
        a.key == b.key && a.highlighted == b.highlighted && a.dots == b.dots
            && a.circle?.latitude == b.circle?.latitude && a.circle?.longitude == b.circle?.longitude
            && a.focus?.center.latitude == b.focus?.center.latitude && a.focus?.span.latitudeDelta == b.focus?.span.latitudeDelta
            && a.shapes.count == b.shapes.count
    }

    var body: some View {
        MapReader { proxy in
            Map(position: $camera, interactionModes: [.pan, .zoom]) {
                ForEach(shapes) { shape in
                    let on = highlighted.contains(shape.name)
                    let fill = fills[shape.id] ?? Palette.missing
                    ForEach(Array(shape.drawRings.enumerated()), id: \.offset) { _, ring in
                        MapPolygon(coordinates: ring)
                            .foregroundStyle(fill.opacity(0.72))
                            .stroke(on ? Palette.accent : Color.white.opacity(0.7), lineWidth: on ? 3.5 : 0.5)
                    }
                }
                ForEach(dots) { dot in
                    Annotation("", coordinate: dot.coordinate, anchor: .center) {
                        Circle().fill(dot.color).frame(width: 13, height: 13)
                            .overlay(Circle().stroke(.white, lineWidth: 2))
                            .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
                            .contentShape(.circle.inset(by: -10))
                            .onTapGesture { onDot?(dot.id) }
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
            .onTapGesture { point in
                guard let onTap, let coordinate = proxy.convert(point, from: .local) else { return }
                onTap(coordinate)
            }
        }
        .onAppear { if let focus { camera = .region(focus) } }
        .onChange(of: focus?.center.latitude) { _, _ in
            if let focus { withAnimation(.smooth(duration: 0.6)) { camera = .region(focus) } }
        }
    }
}
