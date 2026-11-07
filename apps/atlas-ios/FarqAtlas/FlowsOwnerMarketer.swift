import SwiftUI

// MARK: - 1. أفتح فرعاً

/// Screen 1: «وش نشاطك؟»
struct OwnerActivityView: View {
    @Environment(AtlasStore.self) private var store
    @State private var query = ""

    var body: some View {
        let activities = (store.summary?.main_activities ?? []).filter { query.isEmpty || $0.main_ar.contains(query) }
        FlowScreen(title: "أفتح فرعاً", question: "وش نشاطك؟", note: "نرتّب لك الأحياء التي ينقصها نشاطك أكثر.",
                   primary: .init("اعرض الأحياء", enabled: store.activity != nil) { store.path.append(Route.ownerDistricts) }) {
            ActivityList(activities: activities, query: $query)
        }
    }
}

/// The activities as large choice rows with a search field.
struct ActivityList: View {
    @Environment(AtlasStore.self) private var store
    let activities: [Activity]
    @Binding var query: String

    var body: some View {
        VStack(spacing: 10) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(Tokens.mutedForeground)
                TextField("ابحث عن نشاط", text: $query).font(Typo.body)
            }
            .shadCard()
            if store.summary == nil {
                ForEach(0..<5, id: \.self) { _ in SkeletonLoader().frame(height: 56) }
            }
            ForEach(activities) { activity in
                OptionRow(title: activity.main_ar, trailing: Fmt.int(activity.n), selected: store.activity == activity) {
                    Task { await store.choose(activity: activity) }
                }
                .accessibilityIdentifier("activity-\(activity.main_id ?? activity.main_ar)")
            }
        }
    }
}

/// Screen 2: «أين يحتاجك الناس أكثر؟»
struct OwnerDistrictsView: View {
    @Environment(AtlasStore.self) private var store
    @State private var showAll = false

    var body: some View {
        let ranked = store.ranked(.shortfall)
        let shown = showAll ? ranked : Array(ranked.prefix(5))
        FlowScreen(title: "أفتح فرعاً", question: "أين يحتاج الناس \(store.activity?.main_ar ?? "نشاطك") أكثر؟",
                   note: "الأحياء التي فيها منشآت أقل مما يتحمّله عدد سكانها.",
                   map: AtlasMap(shapes: store.shapes, fills: store.fills(.shortfall), key: "gap-\(store.activity?.id ?? "")-\(store.dataVersion)",
                                 highlighted: Set(ranked.prefix(5).map(\.shape.name)), focus: store.cityRegion,
                                 onTap: { if let hit = store.district(at: $0) { store.path.append(Route.ownerDistrict(hit.name)) } })) {
            Legend()
            if store.activityLoading { ForEach(0..<5, id: \.self) { _ in SkeletonLoader().frame(height: 74) } }
            ForEach(Array(shown.enumerated()), id: \.element.shape.id) { index, item in
                let counts = store.activityCounts[item.shape.name]
                Button { store.path.append(Route.ownerDistrict(item.shape.name)) } label: {
                    DistrictRow(rank: index + 1, name: item.shape.name,
                                sentence: "السكان \(Fmt.int(store.counts[item.shape.name]?.population)) · المنافسون \(Fmt.int(counts?.n))",
                                figure: item.value > 0 ? "+\(Fmt.int(item.value))" : Fmt.int(item.value))
                }
                .buttonStyle(.farqPress)
                .accessibilityIdentifier("district-\(index)")
                .accessibilityValue(Fmt.int(item.value))
            }
            Explained(title: "فرص التوسع", lines: Explain.gap) {
                Text("الرقم = منشآت إضافية يتحمّلها الحي بمعدل المدينة. كيف حُسب؟").font(Typo.caption).foregroundStyle(Palette.brand)
            }
            .buttonStyle(.plain)
            if ranked.count > 5 {
                Button(showAll ? "اعرض أول 5 فقط" : "اعرض كل الأحياء (\(Fmt.int(ranked.count)))") { withAnimation(Motion.slide) { showAll.toggle() } }
                    .buttonStyle(.farqSecondary).font(Typo.font(15, .semibold))
            }
        }
    }
}

/// Screen 3: «هل يناسبك هذا الحي؟»
struct OwnerDistrictView: View {
    @Environment(AtlasStore.self) private var store
    let name: String
    @State private var pinning = false

    var body: some View {
        if let shape = store.shape(named: name) {
            let counts = store.activityCounts[name]
            FlowScreen(title: "أفتح فرعاً", question: "هل يناسبك حي \(name)؟",
                       note: pinning ? "المس الخريطة لتضع الدبوس على الموقع المرشّح." : nil,
                       map: AtlasMap(shapes: store.shapes, fills: store.fills(.shortfall), key: "gap-\(store.activity?.id ?? "")-\(store.dataVersion)",
                                     highlighted: [name], circle: store.pin, radius: store.radius, focus: store.region(of: shape),
                                     onTap: { coordinate in if pinning { Task { await store.place(pin: coordinate) } } }),
                       primary: .init(store.compare.contains(name) && store.compare.count >= 2 ? "افتح المقارنة" : "قارن مع حي آخر") { compareAction(store, name) { store.path.removeLast() } }) {
                ScoreHero(title: "فرص التوسع لـ\(store.activity?.main_ar ?? "نشاطك")", value: store.gaps[name]?.shortfall,
                          score: store.score(.shortfall, name), city: store.city.name)
                FigureGrid {
                    Figure(label: "السكان", number: store.counts[name]?.population, explain: Explain.population)
                    Figure(label: "المنافسون", number: counts?.n, explain: Metric.activityBusinesses.explain)
                    Figure(label: "ساكن لكل منافس", number: counts?.residents_per, explain: Metric.activityResidentsPer.explain)
                    Figure(label: "المنافسون لكل كم²", number: counts?.per_km2, explain: Metric.activityPerKm2.explain)
                }
                VStack(alignment: .leading, spacing: 10) {
                    Toggle(isOn: $pinning) {
                        Label("جرّب موقعاً بالضبط", systemImage: "mappin.and.ellipse").font(Typo.font(15, .semibold))
                    }
                    .tint(Palette.brand)
                    .accessibilityIdentifier("pin-toggle")
                    if store.pin != nil {
                        FigureGrid {
                            Figure(label: "السكان داخل 1 كم", number: store.around?.population, explain: Explain.aroundPeople, badge: "تقدير")
                            Figure(label: "المنشآت داخل 1 كم", number: store.around?.businesses, explain: Explain.aroundBusinesses)
                        }
                        .skeleton(isLoading: store.aroundLoading)
                    }
                }
                .shadCard()
                DistrictDetails(shape: shape)
            }
            .onDisappear { pinning = false }
        } else {
            ContentUnavailableView("الحي غير متاح", systemImage: "map")
        }
    }
}

// MARK: - 2. أصل لجمهوري

/// Screen 1: «مين جمهورك؟»
struct MarketerAudienceView: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        @Bindable var store = store
        FlowScreen(title: "أصل لجمهوري", question: "مين جمهورك؟", note: store.hasAudience ? nil : "الجنس والجنسية غير متاحين في \(store.city.name)، فالمتاح «الكل» فقط.",
                   primary: .init("اعرض الأحياء") { store.path.append(Route.marketerDistricts) }) {
            ForEach(Segment.allCases) { segment in
                OptionRow(title: segment.label, selected: store.segment == segment, enabled: segment == .everyone || store.hasAudience) {
                    store.segment = segment
                }
                .accessibilityIdentifier("segment-\(segment.rawValue)")
            }
            SectionTitle(text: "دخل الفرد العامل")
            if store.hasIncome {
                ForEach([0.0, 10000, 15000, 20000], id: \.self) { bar in
                    OptionRow(title: bar == 0 ? "بلا حد" : "\(Fmt.int(bar)) ر.س أو أكثر", selected: store.minIncome == bar) { store.minIncome = bar }
                }
            } else {
                Text("\(Fmt.unavailable) في \(store.city.name).").font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground)
            }
        }
    }
}

/// Screen 2: «أين يسكن جمهورك؟»
struct MarketerDistrictsView: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        let ranked = store.ranked(.audience)
        FlowScreen(title: "أصل لجمهوري", question: "أين يسكن جمهورك؟",
                   map: AtlasMap(shapes: store.shapes, fills: store.fills(.audience), key: "aud-\(store.segment.rawValue)-\(store.minIncome)-\(store.dataVersion)",
                                 highlighted: Set(ranked.prefix(5).map(\.shape.name)), focus: store.cityRegion,
                                 onTap: { if let hit = store.district(at: $0) { store.path.append(Route.marketerDistrict(hit.name)) } })) {
            Explained(title: "حجم الجمهور", lines: Explain.audienceTotal) {
                HeroStat(title: "حجم جمهورك (\(store.segment.label))", value: store.audienceTotal,
                         caption: Fmt.counted(ranked.count, .district))
            }
            .buttonStyle(.farqPress)
            Legend()
            ForEach(Array(ranked.prefix(5).enumerated()), id: \.element.shape.id) { index, item in
                Button { store.path.append(Route.marketerDistrict(item.shape.name)) } label: {
                    DistrictRow(rank: index + 1, name: item.shape.name,
                                sentence: "منشآت بواتساب \(Fmt.int(store.counts[item.shape.name]?.n_whatsapp))",
                                figure: Fmt.int(item.value))
                }
                .buttonStyle(.farqPress)
                .accessibilityIdentifier("district-\(index)")
                .accessibilityValue(Fmt.int(item.value))
            }
        }
    }
}

/// Screen 3: the district for a marketer.
struct MarketerDistrictView: View {
    @Environment(AtlasStore.self) private var store
    let name: String

    var body: some View {
        if let shape = store.shape(named: name) {
            FlowScreen(title: "أصل لجمهوري", question: "حي \(name)",
                       map: AtlasMap(shapes: store.shapes, fills: store.fills(.audience), key: "aud-\(store.segment.rawValue)-\(store.minIncome)-\(store.dataVersion)",
                                     highlighted: [name], focus: store.region(of: shape)),
                       primary: .init(store.compare.contains(name) && store.compare.count >= 2 ? "افتح المقارنة" : "قارن مع حي آخر") { compareAction(store, name) { store.path.removeLast() } }) {
                ScoreHero(title: "جمهورك هنا (\(store.segment.label))", value: store.audienceSize(name), score: store.score(.audience, name), city: store.city.name)
                FigureGrid {
                    Figure(label: "السكان", number: store.counts[name]?.population, explain: Explain.population)
                    Figure(label: "السعوديون", value: Fmt.percent(store.audience[name]?.saudi_pct), explain: Explain.saudi)
                    Figure(label: "متوسط الدخل", number: store.income[name]?.income_all, unit: "ر.س", explain: Explain.income)
                    Figure(label: "منشآت بواتساب", number: store.counts[name]?.n_whatsapp, explain: Metric.whatsapp.explain)
                }
                DistrictDetails(shape: shape)
            }
        } else {
            ContentUnavailableView("الحي غير متاح", systemImage: "map")
        }
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
                Text(value.map { Fmt.int($0) } ?? Fmt.unavailable)
                    .font(Typo.font(value == nil ? 20 : 32, .bold)).monospacedDigit().foregroundStyle(.white)
            }
            Spacer()
            if let caption { Text(caption).font(Typo.font(13, .semibold)).foregroundStyle(.white.opacity(0.85)) }
        }
        .padding(18)
        .background(Palette.hero, in: .rect(cornerRadius: 20, style: .continuous))
    }
}
