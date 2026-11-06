import SwiftUI
import Pow

/// The actions of the active lens, in the order of its decision.
struct LensTools: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        Group {
            switch store.lens {
            case .owners: OwnersTools()
            case .marketers: MarketersTools()
            case .distributors: DistributorsTools()
            case .analysts: AnalystsTools()
            case .realEstate: RealEstateTools()
            }
        }
        .id(store.lens)
        .transition(.asymmetric(insertion: .movingParts.move(edge: .bottom).combined(with: .opacity), removal: .opacity))
    }
}

/// The activity as a rail of chips; the pick slides between them.
struct ActivityPicker: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        let activities = store.summary?.main_activities ?? []
        VStack(alignment: .leading, spacing: 8) {
            Text("النشاط").font(Typo.font(13, .semibold)).foregroundStyle(Tokens.mutedForeground)
            FarqChips(options: activities.map(\.main_ar), selection: Binding(
                get: { store.activity?.main_ar },
                set: { name in
                    guard let pick = activities.first(where: { $0.main_ar == name }) else { return }
                    Task { await store.choose(activity: pick) }
                }))
        }
    }
}

// MARK: owners

struct OwnersTools: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        @Bindable var store = store
        VStack(alignment: .leading, spacing: 12) {
            ActivityPicker()
            SectionTitle(text: "ضع دبوساً على موقع مرشّح")
            FarqSwitch(title: store.pinMode ? "انقر على الخريطة لوضع الدبوس" : "وضع الدبوس", isOn: $store.pinMode, symbol: "mappin")
                .shadCard()
                .conditionalEffect(.repeat(.glow(color: Palette.accent.opacity(0.6), radius: 24), every: 1.6), condition: store.pinMode)
            FarqSegments(options: [(500.0, "500 م"), (1000.0, "1 كم"), (2000.0, "2 كم"), (3000.0, "3 كم")], selection: $store.radius)
                .onChange(of: store.radius) { _, _ in if let pin = store.pin { Task { await store.place(pin: pin) } } }
            Explained(title: "نطاق القيادة", lines: Explain.driveTime) {
                HStack(spacing: 8) {
                    Image(systemName: "car.fill").foregroundStyle(Tokens.primaryInk)
                    Text("نطاق 5 · 10 · 15 دقيقة قيادة").font(Typo.font(13, .medium))
                    Spacer()
                    FarqBadge(title: "يحتاج تسجيل الدخول", tone: .warning)
                }
                .shadCard()
            }
            if store.pin != nil {
                let around = store.around
                let residentsPer: Double? = {
                    guard let p = around?.population, let b = around?.businesses, b > 0 else { return nil }
                    return p / b
                }()
                FigureGrid {
                    Figure(label: "السكان داخل النطاق", number: around?.population, explain: Explain.aroundPeople, badge: around?.population == nil ? nil : "تقدير")
                    Figure(label: "المنشآت داخل النطاق", number: around?.businesses, explain: Explain.aroundBusinesses)
                    Figure(label: "ساكن لكل منشأة", number: residentsPer, explain: Explain.aroundScore)
                    Figure(label: "الوحدات السكنية", number: around?.dwellings, explain: ["عدد الوحدات السكنية في المباني داخل الدائرة، من طبقة مباني فرق."])
                }
                .skeleton(isLoading: store.aroundLoading)
                HStack(spacing: 10) {
                    Button { withAnimation(Motion.bouncy) { store.saveSite() } } label: { Label("احفظ للمقارنة", systemImage: "bookmark.fill") }
                        .buttonStyle(.farqSecondary).disabled(store.around == nil)
                    if !store.sites.isEmpty {
                        NavigationLink(value: Route.sites) { Label("قارن المواقع (\(Fmt.int(store.sites.count)))", systemImage: "square.split.2x1.fill") }
                            .buttonStyle(.farqPrimary)
                            .transition(.movingParts.pop(Palette.accent))
                    }
                }
                .font(Typo.font(15, .semibold))
            }
            TopDistricts(title: "أعلى الأحياء في \(store.metric.label)")
        }
    }
}

// MARK: marketers

struct MarketersTools: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        @Bindable var store = store
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle(text: "الجمهور")
            FarqSegments(options: Segment.allCases.map { ($0, $0.label) }, selection: $store.segment)
                .disabled(!store.hasAudience)
            FilterSlider(title: "نسبة السعوديين لا تقل عن", value: $store.minSaudi, range: 0...90, step: 10,
                         display: store.minSaudi == 0 ? "بلا حد" : Fmt.percent(store.minSaudi))
                .disabled(!store.hasAudience)
            FilterSlider(title: "متوسط الدخل لا يقل عن", value: $store.minIncome, range: 0...30000, step: 2500,
                         display: !store.hasIncome ? Fmt.unavailable : store.minIncome == 0 ? "بلا حد" : Fmt.withUnit(store.minIncome, "ر.س"))
                .disabled(!store.hasIncome)
            if !store.hasAudience {
                Text("الجنس والجنسية غير متاحين لهذه المدينة.").font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
            }
            if store.minSaudi > 0 || store.minIncome > 0 || store.segment != .everyone {
                Button { withAnimation(Motion.slide) { store.segment = .everyone; store.minSaudi = 0; store.minIncome = 0 } } label: {
                    Label("إعادة ضبط الفلاتر", systemImage: "arrow.counterclockwise")
                }
                .buttonStyle(.farqSecondary)
                .transition(.movingParts.pop(Palette.brand))
            }
            Explained(title: "حجم الجمهور", lines: Explain.audienceTotal) {
                HeroStat(title: "حجم الجمهور المطابق", value: store.audienceTotal,
                         caption: Fmt.counted(store.shapes.filter { store.audienceSize($0.name) != nil }.count, .district))
            }
            TopDistricts(title: "أعلى الأحياء مطابقةً")
        }
    }
}

/// A labelled slider on a shadcn card; the value reads in English digits.
struct FilterSlider: View {
    let title: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double
    let display: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title).font(Typo.font(14, .medium))
                Spacer()
                Text(display).font(Typo.font(15, .bold)).monospacedDigit().contentTransition(.numericText()).animation(Motion.slide, value: display)
            }
            Slider(value: $value, in: range, step: step).tint(Palette.brand)
        }
        .shadCard()
        .sensoryFeedback(.selection, trigger: value)
    }
}

// MARK: distributors

struct DistributorsTools: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        @Bindable var store = store
        VStack(alignment: .leading, spacing: 12) {
            ActivityPicker()
            SectionTitle(text: "مناطق المندوبين")
            FarqSwitch(title: "قسّم المدينة إلى مناطق", isOn: $store.showTerritories, symbol: "square.grid.3x3.fill")
                .shadCard()
                .onChange(of: store.showTerritories) { _, on in if on { Task { await store.loadTerritories() } } }
            if store.showTerritories {
                HStack {
                    Text("عدد المندوبين").font(Typo.font(14, .medium))
                    Spacer()
                    Button { if store.territoryCount > 2 { store.territoryCount -= 1 } } label: { Image(systemName: "minus") }
                        .buttonStyle(.elastic(style: .init(fill: Tokens.secondary, ink: Tokens.primaryInk, radius: 12, height: 44, padding: 14, depth: false)))
                    RollingFigure(value: Double(store.territoryCount), font: Typo.font(22, .bold)).frame(minWidth: 36)
                    Button { if store.territoryCount < 12 { store.territoryCount += 1 } } label: { Image(systemName: "plus") }
                        .buttonStyle(.elastic(style: .init(fill: Palette.brand, ink: .white, radius: 12, height: 44, padding: 14)))
                }
                .shadCard()
                .onChange(of: store.territoryCount) { _, _ in Task { await store.loadTerritories() } }
                FarqSegments(options: [("population", "السكان"), ("businesses", "منشآت النشاط")], selection: $store.territoryWeight)
                    .onChange(of: store.territoryWeight) { _, _ in Task { await store.loadTerritories() } }
                Explained(title: "مناطق المندوبين", lines: Explain.territory) {
                    VStack(spacing: 10) {
                        let top = store.territories.compactMap(\.weight).max() ?? 1
                        ForEach(store.territories) { t in
                            let color = Palette.territories[(t.territory - 1) % Palette.territories.count]
                            VStack(alignment: .leading, spacing: 5) {
                                HStack {
                                    RoundedRectangle(cornerRadius: 5).fill(color).frame(width: 18, height: 18)
                                    Text("المنطقة \(Fmt.int(t.territory))").font(Typo.font(14, .semibold))
                                    Spacer()
                                    Text(Fmt.counted(t.districts.count, .district)).font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
                                    Text(Fmt.int(t.weight)).font(Typo.font(14, .bold)).monospacedDigit()
                                }
                                FarqProgress(value: (t.weight ?? 0) / top * 100)
                            }
                            .rise(t.territory)
                        }
                        if store.territories.isEmpty { SkeletonLoader().frame(height: 120) }
                    }
                    .shadCard()
                }
                Text("مسار الزيارة الأمثل لكل منطقة يحتاج تسجيل الدخول في أطلس.").font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
            }
            TopDistricts(title: "أعلى الأحياء في \(store.metric.label)")
        }
    }
}

// MARK: analysts

struct AnalystsTools: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            NavigationLink(value: Route.ranking) {
                RowCard(symbol: "tablecells.fill", title: "جدول الأحياء", subtitle: "فرز بأي مقياس، ويتحدّث معه تلوين الخريطة")
            }
            .buttonStyle(.farqPress)
            if store.compare.isEmpty {
                Text("انقر حياً ثم «أضف للمقارنة» لتقارن حتى 4 أحياء جنباً إلى جنب.").font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
            } else {
                NavigationLink(value: Route.compare) {
                    RowCard(symbol: "square.split.2x1.fill", title: "المقارنة", subtitle: store.compare.map(\.name).joined(separator: " · "))
                }
                .buttonStyle(.farqPress)
                .transition(.movingParts.pop(Palette.brand))
            }
            TopDistricts(title: "أعلى الأحياء في \(store.metric.label)")
        }
    }
}

struct RowCard: View {
    let symbol: String
    let title: String
    let subtitle: String
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Tokens.primaryInk)
                .frame(width: 40, height: 40)
                .background(Tokens.accent, in: .rect(cornerRadius: 11, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Typo.headline).foregroundStyle(Tokens.foreground)
                Text(subtitle).font(Typo.caption).foregroundStyle(Tokens.mutedForeground).lineLimit(1)
            }
            Spacer()
            NextChevron().font(.footnote.weight(.bold)).foregroundStyle(Tokens.mutedForeground)
        }
        .shadCard()
    }
}

/// A headline figure on the olive hero surface.
struct HeroStat: View {
    let title: String
    let value: Double?
    var caption: String? = nil

    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(Typo.font(13, .semibold)).foregroundStyle(.white.opacity(0.75))
                if let value {
                    Odometer(value: value.rounded(), format: englishNumber, showsDelta: true,
                             style: OdometerStyle(up: Palette.mint, down: Color(hex: 0xFFB4A8), ink: .white, muted: .white.opacity(0.6)))
                        .font(Typo.font(34, .bold))
                        .environment(\.layoutDirection, .leftToRight)
                } else {
                    Text(Fmt.unavailable).font(Typo.font(20, .bold)).foregroundStyle(.white.opacity(0.8))
                }
            }
            Spacer()
            if let caption { Text(caption).font(Typo.font(13, .semibold)).foregroundStyle(.white.opacity(0.85)) }
        }
        .padding(18)
        .background(Palette.hero, in: .rect(cornerRadius: 18, style: .continuous))
        .shadow(color: Palette.brand.opacity(0.3), radius: 14, y: 8)
        .shineOnChange(value)
    }
}

// MARK: real estate

struct RealEstateTools: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        @Bindable var store = store
        VStack(alignment: .leading, spacing: 12) {
            FarqSegments(options: [("rent", "إيجار"), ("sale", "شراء")], selection: $store.listingKind)
                .onChange(of: store.listingKind) { _, _ in Task { await store.loadListings() } }
            Explained(title: "الفرص", lines: Explain.opportunities) {
                HeroStat(title: "أفضل الفرص في \(store.city.name)", value: store.listingsLoading ? nil : Double(store.listings.count),
                         caption: "أقل من وسيط الحي بين \(Fmt.percent(10)) و\(Fmt.percent(30))")
            }
            if store.listings.isEmpty && !store.listingsLoading {
                Text("لا توجد فرص واضحة الآن في هذه المدينة.").font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground)
            }
            if store.listingsLoading {
                ForEach(0..<3, id: \.self) { _ in SkeletonLoader().frame(height: 96) }
            }
            ForEach(Array(store.listings.enumerated()), id: \.element.id) { index, listing in
                NavigationLink(value: Route.listing(listing)) { ListingRow(listing: listing) }
                    .buttonStyle(.farqPress)
                    .rise(index)
            }
        }
    }
}

/// The top districts for the current metric; tapping one selects it on the map.
struct TopDistricts: View {
    @Environment(AtlasStore.self) private var store
    let title: String

    var body: some View {
        let values = store.values(store.metric)
        let top = store.shapes.filter { values[$0.name] != nil }.sorted { values[$0.name]! > values[$1.name]! }.prefix(5)
        let best = top.first.flatMap { values[$0.name] } ?? 1
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(text: title)
            if top.isEmpty {
                Text(Fmt.unavailable).font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground)
            }
            VStack(spacing: 0) {
                ForEach(Array(top.enumerated()), id: \.element.id) { index, shape in
                    Button { withAnimation(Motion.slide) { store.select(shape) } } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(Fmt.int(index + 1))
                                    .font(Typo.font(12, .bold)).foregroundStyle(index == 0 ? .white : Tokens.primaryInk)
                                    .frame(width: 24, height: 24)
                                    .background(index == 0 ? AnyShapeStyle(Palette.brand) : AnyShapeStyle(Tokens.accent), in: .circle)
                                Text(shape.name).font(Typo.font(15, .semibold)).foregroundStyle(Tokens.foreground)
                                Spacer()
                                Text(store.metric.format(values[shape.name])).font(Typo.font(15, .bold)).monospacedDigit().foregroundStyle(Tokens.foreground)
                            }
                            if best > 0, let v = values[shape.name], v > 0 { FarqProgress(value: v / best * 100) }
                        }
                        .padding(.vertical, 10)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.farqPress)
                    .rise(index)
                    if index < top.count - 1 { Divider().overlay(Tokens.border) }
                }
            }
            .shadCard()
        }
    }
}
