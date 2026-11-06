import SwiftUI
import MapKit
import Pow

/// The one screen: a full-bleed map, the lens bar over it, and a persistent panel underneath (foundation §1, «الخريطة هي الانطلاقة»).
struct MapScreen: View {
    @Environment(AtlasStore.self) private var store
    @State private var camera: MapCameraPosition = .region(MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 24.71, longitude: 46.68),
        span: MKCoordinateSpan(latitudeDelta: 0.6, longitudeDelta: 0.6)))

    var body: some View {
        @Bindable var store = store
        MapReader { proxy in
            Map(position: $camera, interactionModes: [.pan, .zoom]) {
                districtLayer
                listingLayer
                pinLayer
            }
            .mapStyle(.standard(pointsOfInterest: .excludingAll))
            .onTapGesture { point in
                guard let coordinate = proxy.convert(point, from: .local) else { return }
                if store.lens == .owners && store.pinMode {
                    Task { await store.place(pin: coordinate) }
                } else if let hit = store.district(at: coordinate) {
                    store.select(store.selected?.id == hit.id ? nil : hit)
                } else {
                    store.select(nil)
                }
            }
        }
        .ignoresSafeArea()
        .safeAreaInset(edge: .top) { TopBar() }
        .overlay {
            if store.loading {
                ProgressView { Text("جارٍ تحميل الأحياء…").font(Typo.subheadline) }
                    .padding(18).background(.regularMaterial, in: .rect(cornerRadius: 16, style: .continuous))
            }
        }
        .sheet(isPresented: .constant(true)) {
            Panel()
                .presentationDetents([.height(150), .fraction(0.32), .medium, .large], selection: $store.detent)
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                .presentationBackground(.regularMaterial)
                .presentationCornerRadius(26)
                .interactiveDismissDisabled()
                .environment(\.layoutDirection, .rightToLeft)
        }
        .onChange(of: store.shapes.count) { _, _ in
            if let region = store.cityRegion { withAnimation(.smooth(duration: 0.8)) { camera = .region(region) } }
        }
        .onChange(of: store.pin?.latitude) { _, _ in
            guard let pin = store.pin else { return }
            withAnimation(.smooth) { camera = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: pin.latitude - store.radius / 111_000 * 1.2, longitude: pin.longitude), latitudinalMeters: store.radius * 6, longitudinalMeters: store.radius * 6)) }
        }
        .task { await store.start() }
    }

    @MapContentBuilder private var districtLayer: some MapContent {
        // everything the polygons depend on is read here, in the tracked body, not inside the deferred ForEach closures
        let fills = districtFills
        let selectedId = store.selected?.id
        let compared = Set(store.compare.map(\.id))
        let opacity = store.lens == .distributors && store.showTerritories ? 0.6 : 0.74
        ForEach(store.shapes) { shape in
            let fill = fills[shape.id] ?? Palette.missing
            let isSelected = selectedId == shape.id
            let isCompared = compared.contains(shape.id)
            ForEach(Array(shape.polygons.enumerated()), id: \.offset) { _, rings in
                if let outer = rings.first {
                    MapPolygon(coordinates: outer)
                        .foregroundStyle(fill.opacity(opacity))
                        .stroke(isSelected ? Palette.accent : isCompared ? Color.orange : Color.white.opacity(0.75),
                                lineWidth: isSelected ? 3.5 : isCompared ? 2.5 : 0.6)
                }
            }
        }
    }

    /// The fill of every district for the active lens: territory colours, a quiet wash under listings, or the city quintile.
    private var districtFills: [String: Color] {
        var out: [String: Color] = [:]
        if store.lens == .distributors && store.showTerritories {
            let territoryOf = store.territoryOf
            for shape in store.shapes {
                if let t = territoryOf[shape.name] { out[shape.id] = Palette.territories[(t - 1) % Palette.territories.count] }
            }
        } else if store.lens == .realEstate {
            for shape in store.shapes { out[shape.id] = Palette.brand.opacity(0.28) }
        } else {
            let values = store.values(store.metric)
            let quintiles = Quintiles(Array(values.values))
            for shape in store.shapes {
                if let bin = quintiles.bin(values[shape.name]) { out[shape.id] = Palette.ramp[bin] }
            }
        }
        return out
    }

    @MapContentBuilder private var listingLayer: some MapContent {
        let listings = store.lens == .realEstate ? store.listings : []
        if !listings.isEmpty {
            ForEach(listings) { listing in
                Annotation("", coordinate: listing.coordinate, anchor: .center) {
                    Button {
                        store.path.append(Route.listing(listing))
                        store.detent = .large
                    } label: {
                        Circle()
                            .fill(Palette.versus(listing.vs_district_pct))
                            .frame(width: 12, height: 12)
                            .overlay(Circle().stroke(.white, lineWidth: 1.5))
                            .shadow(radius: 1)
                    }
                    .accessibilityLabel("عرض \(Fmt.int(listing.price_sar)) ر.س")
                }
            }
        }
    }

    @MapContentBuilder private var pinLayer: some MapContent {
        let sites = store.sites
        let radius = store.radius
        if store.lens == .owners, let pin = store.pin {
            MapCircle(center: pin, radius: radius)
                .foregroundStyle(Palette.accent.opacity(0.16))
                .stroke(Palette.accent, lineWidth: 2)
            Annotation("الموقع المرشّح", coordinate: pin, anchor: .bottom) {
                Image(systemName: "mappin.circle.fill")
                    .font(.system(size: 36))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, Palette.accent)
                    .shadow(color: Palette.accent.opacity(0.5), radius: 8, y: 4)
                    .symbolEffect(.bounce, value: pin.latitude)
                    .changeEffect(.spray(origin: .center) { Circle().fill(Palette.accent).frame(width: 6, height: 6) }, value: pin.latitude)
            }
            ForEach(sites) { site in
                Annotation("", coordinate: site.coordinate) {
                    Circle().fill(Color.orange).frame(width: 10, height: 10).overlay(Circle().stroke(.white, lineWidth: 1.5))
                }
            }
        }
    }
}

/// City, search and the five lenses, floating over the map in frosted glass.
struct TopBar: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        @Bindable var store = store
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                Button { open(.cities) } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "building.2.fill")
                        Text(store.city.name).font(Typo.headline).contentTransition(.opacity)
                        Image(systemName: "chevron.down").font(.caption.weight(.bold))
                    }
                }
                .buttonStyle(.elastic(style: .init(fill: Palette.brand, ink: .white, radius: 22, height: 46, padding: 16)))
                .accessibilityLabel("المدينة: \(store.city.name)")
                Button { open(.search) } label: {
                    HStack {
                        Image(systemName: "magnifyingglass")
                        Text("ابحث عن حي").font(Typo.callout)
                        Spacer()
                    }
                    .foregroundStyle(Tokens.mutedForeground)
                    .padding(.horizontal, 16).frame(height: 46)
                    .background(Tokens.card.opacity(0.92), in: .capsule)
                    .overlay(Capsule().strokeBorder(Tokens.border, lineWidth: 1))
                    .shadow(color: .black.opacity(0.06), radius: 8, y: 3)
                }
                .buttonStyle(.farqPress)
            }
            // the five lenses on one liquid glass track (SwiftPieces GlassSegments)
            GlassSegments(options: Lens.allCases, selection: Binding(get: { store.lens }, set: { lens in withAnimation(Motion.slide) { store.choose(lens: lens) } }),
                          height: 44,
                          style: GlassSegmentsStyle(ink: Tokens.foreground.opacity(0.75), selectedInk: .white, indicatorTint: Palette.brand, font: Typo.font(13, .bold)),
                          label: { $0.label })
        }
        .padding(.horizontal, 14).padding(.top, 4).padding(.bottom, 10)
        .background(FrostedBar())
    }

    private func open(_ route: Route) {
        store.path = NavigationPath()
        store.path.append(route)
        store.detent = .large
    }
}
