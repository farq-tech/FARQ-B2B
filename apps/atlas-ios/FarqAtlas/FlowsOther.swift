import SwiftUI

enum ListingResultMessage {
    static func empty(filtersApplied: Bool, hasMore: Bool) -> String {
        if !filtersApplied { return "غيّرت الفلاتر؛ اضغط «اعرض أفضل العروض» لتطبيقها." }
        if hasMore { return "لا توجد عروض تطابق الفلاتر ضمن النتائج المحمّلة بعد. حمّل المزيد قبل توسيع الاختيارات." }
        return "لا توجد عروض تطابق هذه الفلاتر. جرّب توسيع الاختيارات أو امسح الفلاتر."
    }
}

// MARK: - 3. أوزّع على مندوبيني

/// Screen 1: «وش نشاط عملائك؟ وكم مندوب عندك؟»
struct DistributorSetupView: View {
    @Environment(AtlasStore.self) private var store
    @State private var query = ""

    var body: some View {
        @Bindable var store = store
        let activities = (store.summary?.main_activities ?? []).filter { query.isEmpty || $0.matches(query) }
        FlowScreen(title: "أوزّع على مندوبيني", question: "كم مندوب عندك؟ ووش نشاط عملائك؟",
                   primary: .init("قسّم المدينة", enabled: store.activity != nil) {
                       store.path.append(Route.distributorRegions)
                       Task { await store.loadTerritories() }
                   }) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("عدد المندوبين").font(Typo.font(16, .semibold))
                    Text("اختر من \(Fmt.int(2)) إلى \(Fmt.int(12)) مندوباً").font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
                }
                Spacer()
                Button { if store.repCount > 2 { store.repCount -= 1 } } label: { Image(systemName: "minus") }
                    .buttonStyle(.farqStep(primary: false))
                    .accessibilityLabel("أقل")
                Text(Fmt.int(store.repCount)).font(Typo.font(24, .bold)).monospacedDigit().frame(minWidth: 40)
                    .accessibilityIdentifier("rep-count")
                Button { if store.repCount < 12 { store.repCount += 1 } } label: { Image(systemName: "plus") }
                    .buttonStyle(.farqStep(primary: true))
                    .accessibilityLabel("أكثر")
            }
            .shadCard()
            HStack(spacing: 6) {
                Image(systemName: "info.circle.fill")
                Text("يمكنك تعديل العدد قبل إنشاء المناطق.")
            }
            .font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
            SectionTitle(text: "نشاط عملائك")
            ActivityList(activities: activities, query: $query)
        }
    }
}

/// Screen 2: the city split into balanced, contiguous regions.
struct DistributorRegionsView: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        let maxWeight = store.territories.compactMap(\.weight).max() ?? 0
        let advisorFacts = AtlasAdvisorFacts.block([
            "المسار: توزيع العملاء على المندوبين",
            "المدينة: \(store.city.name)",
            "النشاط: \(store.activity?.main_ar ?? Fmt.unavailable)",
            "عدد المندوبين: \(Fmt.int(store.repCount))",
            "عدد المناطق: \(Fmt.int(store.territories.count))",
            "مجموع العملاء المقاسين: \(store.territories.allSatisfy { $0.weight != nil } ? AtlasAdvisorFacts.number(store.territories.reduce(0.0) { $0 + ($1.weight ?? 0) }) : Fmt.unavailable)",
            "توزيع المناطق والأحياء والعملاء المقاسين:",
        ] + store.territories.map { territory in
            "المنطقة \(Fmt.int(territory.territory)): \(Fmt.int(territory.districts.count)) أحياء، \(AtlasAdvisorFacts.number(territory.weight)) عميل، الأحياء: \(territory.districts.map(\.district_ar).joined(separator: "، "))"
        })
        FlowScreen(title: "أوزّع على مندوبيني", question: "مناطق مندوبيك",
                   note: "كل منطقة متجاورة، ولكل مندوب حصة متقاربة من عملاء \(store.activity?.main_ar ?? "النشاط").",
                   map: AtlasMap(shapes: store.shapes, fills: territoryFills, key: "terr-\(store.repCount)-\(store.activity?.id ?? "")-\(store.geometryVersion)-\(store.territoryVersion)",
                                 focus: store.cityRegion,
                                  interactionKey: "\(store.territoryVersion)",
                                 onTap: { if let hit = store.district(at: $0), let t = store.territoryOf[hit.name] { store.path.append(Route.distributorRegion(t)) } })) {
            if store.territoriesLoading { ForEach(0..<store.repCount, id: \.self) { _ in SkeletonLoader().frame(height: 64) } }
            if let error = store.territoriesError {
                RetryNotice(message: error) { Task { await store.loadTerritories() } }
            } else if !store.territoriesLoading && store.territories.isEmpty {
                Text("لا تتوفر مناطق لهذا الاختيار الآن.").font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground)
            }
            ForEach(store.territories) { t in
                Button { store.path.append(Route.distributorRegion(t.territory)) } label: {
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 6).fill(Palette.territories[(t.territory - 1) % Palette.territories.count]).frame(width: 22, height: 22)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("المنطقة \(Fmt.int(t.territory))").font(Typo.font(16, .bold)).foregroundStyle(Tokens.foreground)
                            Text(Fmt.counted(t.districts.count, .district)).font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(Fmt.int(t.weight)).font(Typo.font(16, .bold)).monospacedDigit()
                            Text("عميل").font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
                        }
                        NextChevron().font(.footnote.weight(.bold)).foregroundStyle(Tokens.mutedForeground)
                    }
                    .padding(12)
                    .background(Tokens.card, in: .rect(cornerRadius: Tokens.radius, style: .continuous))
                    .overlay(alignment: .bottom) {
                        if let weight = t.weight, maxWeight > 0 {
                            GeometryReader { proxy in
                                Capsule().fill(Palette.territories[(t.territory - 1) % Palette.territories.count])
                                    .frame(width: proxy.size.width * min(weight / maxWeight, 1), height: 4)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .frame(height: 4).padding(.horizontal, 12).padding(.bottom, 4)
                            .accessibilityHidden(true)
                        }
                    }
                    .overlay(RoundedRectangle(cornerRadius: Tokens.radius).strokeBorder(Tokens.border, lineWidth: 1))
                }
                .buttonStyle(.farqPress)
                .accessibilityIdentifier("region-\(t.territory)")
            }
            if !store.territories.isEmpty {
                AtlasPathAdvisor(mode: .distribution, facts: advisorFacts)
            }
            Explained(title: "مناطق المندوبين", lines: Explain.territory) {
                Text("كيف قُسّمت المناطق؟").font(Typo.caption).foregroundStyle(Palette.brand)
            }
            .buttonStyle(.plain)
            Text("مسار الزيارة الأمثل يحتاج تسجيل الدخول في أطلس.").font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
        }
    }

    private var territoryFills: [String: Color] {
        var out: [String: Color] = [:]
        for shape in store.shapes {
            if let t = store.territoryOf[shape.name] { out[shape.id] = Palette.territories[(t - 1) % Palette.territories.count] }
        }
        return out
    }
}

/// Screen 3: a region's districts, by number of customers.
struct DistributorRegionView: View {
    @Environment(AtlasStore.self) private var store
    let id: Int

    var body: some View {
        let names = store.territories.first { $0.territory == id }?.districts.map(\.district_ar) ?? []
        let rows = names.map { ($0, store.activityCounts[$0]?.n) }.sorted { ($0.1 ?? -1) > ($1.1 ?? -1) }
        FlowScreen(title: "أوزّع على مندوبيني", question: "المنطقة \(Fmt.int(id))", note: "أحياؤها مرتبة بعدد عملاء \(store.activity?.main_ar ?? "النشاط").") {
            ForEach(Array(rows.enumerated()), id: \.element.0) { index, row in
                let building = store.growth[row.0]?.under_construction
                HStack(spacing: 12) {
                    Text(Fmt.int(index + 1)).font(Typo.font(13, .bold)).foregroundStyle(Tokens.mutedForeground).frame(width: 26)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(row.0).font(Typo.font(16, .semibold)).foregroundStyle(Tokens.foreground)
                        if let building, building > 0 {
                            Text("يُبنى الآن: \(Fmt.int(building)) مبنى").font(Typo.caption).foregroundStyle(Palette.warning)
                        }
                    }
                    Spacer()
                    Text(Fmt.int(row.1)).font(Typo.font(16, .bold)).monospacedDigit()
                }
                .shadCard()
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("region-district-\(index)")
            }
        }
    }
}

// MARK: - 4. أقارن الأحياء

/// Screen 1: the districts table, ranked by one metric; pick up to four to compare.
struct AnalystTableView: View {
    @Environment(AtlasStore.self) private var store
    @State private var metric: Metric = .population

    var body: some View {
        let ranked = store.ranked(metric)
        FlowScreen(title: "أقارن الأحياء", question: "رتّب الأحياء",
                   map: AtlasMap(shapes: store.shapes, fills: store.fills(metric), key: "an-\(metric.rawValue)-\(store.geometryVersion)",
                                 highlighted: Set(store.compare), focus: store.cityRegion),
                   primary: .init(store.compare.count >= 2 ? "قارن (\(Fmt.int(store.compare.count)))" : "اختر حيين للمقارنة", enabled: store.compare.count >= 2) {
                       store.path.append(Route.compare)
                   }) {
            Menu {
                ForEach(Lens.analystMetrics) { m in Button(m.label) { metric = m } }
            } label: {
                HStack {
                    Text("رتّب حسب").font(Typo.font(14, .medium)).foregroundStyle(Tokens.mutedForeground)
                    Text(metric.label).font(Typo.font(16, .bold)).foregroundStyle(Tokens.foreground)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down").foregroundStyle(Tokens.mutedForeground)
                }
                .shadCard()
            }
            .accessibilityIdentifier("metric-menu")
            if !store.compare.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("أحياء المقارنة").font(Typo.font(13, .semibold)).foregroundStyle(Tokens.mutedForeground)
                        Spacer()
                        Text("\(Fmt.int(store.compare.count)) / \(Fmt.int(4))").font(Typo.caption.monospacedDigit()).foregroundStyle(Tokens.mutedForeground)
                    }
                    ScrollView(.horizontal) {
                        HStack(spacing: 8) {
                            ForEach(store.compare, id: \.self) { name in
                                Button { store.compare.removeAll { $0 == name } } label: {
                                    HStack(spacing: 6) {
                                        Text(name).lineLimit(1)
                                        Image(systemName: "xmark.circle.fill")
                                    }
                                    .font(Typo.caption.weight(.semibold))
                                    .foregroundStyle(Palette.brand)
                                    .padding(.horizontal, 10).padding(.vertical, 7)
                                    .background(Tokens.accent, in: .capsule)
                                }
                                .buttonStyle(.farqPress)
                                .accessibilityLabel("إزالة حي \(name) من المقارنة")
                            }
                        }
                    }
                    .scrollIndicators(.hidden)
                }
                .shadCard()
            }
            Legend()
            LazyVStack(spacing: 8) {
            ForEach(Array(ranked.enumerated()), id: \.element.shape.id) { index, item in
                let picked = store.compare.contains(item.shape.name)
                Button {
                    if picked { store.compare.removeAll { $0 == item.shape.name } } else { store.addToCompare(item.shape.name) }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: picked ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 20)).foregroundStyle(picked ? Palette.brand : Tokens.mutedForeground)
                        Text(Fmt.int(index + 1)).font(Typo.font(13, .bold)).foregroundStyle(Tokens.mutedForeground).frame(width: 30)
                        Text(item.shape.name).font(Typo.font(15, .semibold)).foregroundStyle(Tokens.foreground)
                        Spacer()
                        Text(metric.format(item.value)).font(Typo.font(15, .bold)).monospacedDigit().foregroundStyle(Tokens.foreground)
                    }
                    .padding(.vertical, 10).padding(.horizontal, 12)
                    .background(picked ? Tokens.accent : Tokens.card, in: .rect(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.farqPress)
                .accessibilityIdentifier("row-\(index)")
            }
            }
        }
    }
}

/// Up to four districts side by side; the highest figure in each row is marked.
struct CompareView: View {
    @Environment(AtlasStore.self) private var store
    private let metrics: [Metric] = [.population, .density, .businesses, .residentsPerBusiness, .whatsapp, .wholesale, .saudiPct, .malePct, .income, .villaShare, .underConstruction]

    var body: some View {
        let names = store.compare
        let rows: [Metric] = (store.activity != nil ? [Metric.activityBusinesses, .shortfall] : []) + metrics
        let advisorFacts = AtlasAdvisorFacts.block([
            "المسار: مقارنة الأحياء",
            "المدينة: \(store.city.name)",
            "النشاط المختار: \(store.activity?.main_ar ?? Fmt.unavailable)",
            "المؤشرات المعروضة لكل حي:",
        ] + names.flatMap { name in
            ["الحي: \(name)"] + rows.map { metric in
                "\(metric.label): \(metric.format(store.value(metric, name)))"
            }
        })
        FlowScreen(title: "المقارنة", question: names.joined(separator: " · ")) {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Text("المؤشر")
                        .font(Typo.font(12, .bold)).foregroundStyle(Tokens.mutedForeground)
                        .frame(width: 100, alignment: .leading)
                    ForEach(names, id: \.self) { name in
                        Text(name).font(Typo.font(12, .bold)).foregroundStyle(Tokens.primaryInk)
                            .lineLimit(2).minimumScaleFactor(0.75)
                            .frame(maxWidth: .infinity, minHeight: 38)
                            .background(Tokens.accent, in: .rect(cornerRadius: 8))
                    }
                }
                .padding(.bottom, 8)
                Text("نميّز الأعلى فقط إذا كان القياس متاحاً لكل الأحياء.")
                    .font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, 4)
                ForEach(rows) { metric in
                    let values = names.map { store.value(metric, $0) }
                    let best = CompleteMetricComparison.maximum(values, selectedCount: names.count)
                    HStack(spacing: 8) {
                        Explained(title: metric.label, lines: metric.explain) {
                            Text(metric == .activityBusinesses ? "منشآت \(store.activity?.main_ar ?? "")" : metric.label)
                                .font(Typo.font(13, .medium)).foregroundStyle(Tokens.mutedForeground)
                                .frame(width: 100, alignment: .leading).lineLimit(2)
                        }
                        .buttonStyle(.plain)
                        ForEach(Array(values.enumerated()), id: \.offset) { _, value in
                            let top = best != nil && value != nil && value == best
                            Text(metric.format(value))
                                .font(Typo.font(14, top ? .bold : .regular)).monospacedDigit()
                                .foregroundStyle(value == nil ? Tokens.mutedForeground : Tokens.foreground)
                                .frame(maxWidth: .infinity).padding(.vertical, 5)
                                .background(top ? Tokens.accent : .clear, in: .rect(cornerRadius: 6))
                                .lineLimit(1).minimumScaleFactor(0.6)
                        }
                    }
                    .padding(.vertical, 7)
                    Divider().overlay(Tokens.border)
                }
            }
            .shadCard()
            AtlasPathAdvisor(mode: .analysis, facts: advisorFacts)
            Button("ابدأ مقارنة جديدة") { store.compare = []; store.path.removeLast() }
                .buttonStyle(.farqSecondary).font(Typo.font(15, .semibold))
        }
    }
}

// MARK: - 5. أدوّر عقاراً

/// Screen 1: «إيجار ولا شراء؟»
struct RealEstateKindView: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        FlowScreen(title: "أدوّر عقاراً", question: "إيجار ولا شراء؟") {
            ForEach([("rent", "إيجار", "key.fill", "استكشف العروض وقارن سعر المتر بحيّها."),
                     ("sale", "شراء", "house.fill", "شاهد عروض البيع وموقع كل عقار على الخريطة.")], id: \.0) { kind in
                Button {
                    store.listingKind = kind.0
                    store.path.append(Route.realEstateDeals)
                    Task { await store.loadListings() }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: kind.2).font(.system(size: 22, weight: .semibold)).foregroundStyle(.white)
                            .frame(width: 54, height: 54).background(Palette.hero, in: .rect(cornerRadius: 16, style: .continuous))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(kind.1).font(Typo.font(18, .bold)).foregroundStyle(Tokens.foreground)
                            Text(kind.3).font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer()
                        NextChevron().font(.body.weight(.bold)).foregroundStyle(Tokens.mutedForeground)
                    }
                    .padding(14)
                    .background(Tokens.card, in: .rect(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Tokens.border, lineWidth: 1))
                }
                .buttonStyle(.farqPress)
                .accessibilityIdentifier("kind-\(kind.0)")
            }
        }
    }
}

/// Screen 2: the best matching property opportunities.
struct RealEstateDealsView: View {
    @Environment(AtlasStore.self) private var store
    @State private var selectedDistrict = ""
    @State private var selectedType = ""
    @State private var selectedRentDeal = ""
    @State private var maximumPrice = 0.0
    @State private var minimumBeds = 0
    @State private var maximumAge = 0
    @State private var densityRank = 0
    @State private var selectionMatchesLoadedQuery = true
    @State private var showingDistrictPicker = false

    private var densityValues: [Double] {
        store.shapes.compactMap { densityByDistrict[$0.name] }.filter { $0.isFinite && $0 >= 0 }.sorted()
    }

    private func densityCutoff(for topPercent: Int) -> Double? {
        guard topPercent > 0, !densityValues.isEmpty else { return nil }
        let percentile = 1 - Double(topPercent) / 100
        let index = Int((Double(densityValues.count - 1) * percentile).rounded(.down))
        return densityValues[index]
    }

    private var densityByDistrict: [String: Double] {
        store.counts.reduce(into: [:]) { result, entry in
            if let density = entry.value.density, density.isFinite, density >= 0 {
                result[entry.key] = density
            }
        }
    }

    private var districtsWithoutDensity: Int {
        store.shapes.filter { densityByDistrict[$0.name] == nil }.count
    }

    private var filters: ListingSearchFilter {
        ListingSearchFilter(
            district: selectedDistrict.isEmpty ? nil : selectedDistrict,
            type: selectedType.isEmpty ? nil : selectedType,
            deal: selectedRentDeal.isEmpty ? nil : selectedRentDeal,
            maximumPrice: maximumPrice == 0 ? nil : maximumPrice,
            minimumBeds: minimumBeds == 0 ? nil : Double(minimumBeds),
            maximumAge: maximumAge == 0 ? nil : Double(maximumAge == 1 ? 0 : maximumAge),
            minimumDistrictDensity: densityCutoff(for: densityRank)
        )
    }

    private func clearFilters() {
        selectedDistrict = ""
        selectedType = ""
        selectedRentDeal = ""
        maximumPrice = 0
        minimumBeds = 0
        maximumAge = 0
        densityRank = 0
        selectionMatchesLoadedQuery = false
    }

    private var filteredListings: [Listing] {
        store.listings.filter { filters.matches($0, densityByDistrict: densityByDistrict) }
    }

    private func loadSelectedListings(appending: Bool = false) async {
        if !appending { selectionMatchesLoadedQuery = true }
        let threshold = densityCutoff(for: densityRank)
        let ids: [String]?
        if !selectedDistrict.isEmpty {
            let meetsDensity: Bool
            if let threshold, let density = densityByDistrict[selectedDistrict] {
                meetsDensity = density >= threshold
            } else {
                meetsDensity = threshold == nil
            }
            if let shape = store.shapes.first(where: { $0.name == selectedDistrict }), meetsDensity {
                ids = [shape.id]
            } else {
                ids = []
            }
        } else if let threshold {
            ids = store.shapes.compactMap { shape -> String? in
                guard let density = densityByDistrict[shape.name], density >= threshold else { return nil }
                return shape.id
            }
        } else {
            ids = nil
        }
        let maxAge = maximumAge == 0 ? nil : (maximumAge == 1 ? 0 : Double(maximumAge))
        let deal = selectedRentDeal.isEmpty ? nil : selectedRentDeal
        let types = selectedType.isEmpty ? nil : [selectedType]
        await store.loadListings(types: types, deal: deal, maxPrice: maximumPrice == 0 ? nil : maximumPrice,
                                 districtIDs: ids,
                                 minimumBeds: minimumBeds == 0 ? nil : Double(minimumBeds),
                                 maxAge: maxAge, appending: appending)
    }

    private var availablePropertyTypes: [(String, String)] {
        let common = [("apartment", "شقة"), ("floor", "دور"), ("villa", "فيلا"),
                      ("store", "محل"), ("office", "مكتب"), ("warehouse", "مستودع")]
        return store.listingKind == "sale" ? common + [("land", "أرض")] : [("room", "غرفة")] + common
    }

    private var budgetSteps: [Double] {
        if store.listingKind == "sale" { return [700_000, 1_000_000, 1_500_000, 2_500_000, 4_000_000] }
        if selectedRentDeal == "rent_month" { return [2_000, 3_000, 5_000, 8_000, 12_000] }
        return [30_000, 50_000, 80_000, 120_000, 200_000]
    }

    var body: some View {
        let clusters = ListingMapCluster.group(filteredListings)
        let dots = clusters.map { MapDot(id: $0.id, coordinate: $0.coordinate, color: Palette.accent, count: $0.count) }
        let advisorFacts = AtlasAdvisorFacts.block([
            "المسار: البحث عن عقار",
            "المدينة: \(store.city.name)",
            "نوع الصفقة: \(store.listingKind == "rent" ? "إيجار" : "شراء")",
            "نوع العقار: \(selectedType.isEmpty ? "كل الأنواع" : ListingText.type(selectedType))",
            "مدة الإيجار: \(store.listingKind == "rent" ? (selectedRentDeal.isEmpty ? "كل المدد" : ListingText.deal(selectedRentDeal)) : "غير منطبق")",
            "الحي: \(selectedDistrict.isEmpty ? "كل الأحياء" : selectedDistrict)",
            "الحد الأعلى للسعر: \(maximumPrice == 0 ? "بلا حد" : Fmt.withUnit(maximumPrice, "ر.س"))",
            "أقل عدد غرف: \(minimumBeds == 0 ? "أي عدد" : Fmt.int(Double(minimumBeds)))",
            "حد عمر العقار: \(maximumAge == 0 ? "أي عمر" : (maximumAge == 1 ? "جديد فقط" : ListingText.ageLimit(maximumAge)))",
            "رتبة كثافة الحي المختارة: \(densityRank == 0 ? "أي كثافة" : "أعلى \(Fmt.int(densityRank))% من الأحياء ذات البيانات")",
            "عدد العروض المطابقة من النتائج المحملة: \(Fmt.int(filteredListings.count))",
            "نتائج من عينة الإعلانات المتاحة؛ لا تؤكد استمرار توفر الإعلان:",
        ] + filteredListings.prefix(8).enumerated().map { index, listing in
            "عرض \(Fmt.int(index + 1)): \(ListingText.type(listing.type))، \(ListingText.deal(listing.deal))، حي \(listing.district_ar ?? Fmt.unavailable)، السعر \(AtlasAdvisorFacts.number(listing.price_sar, unit: "ر.س"))، المساحة \(AtlasAdvisorFacts.number(listing.area_sqm, unit: "م²"))، غرف النوم \(AtlasAdvisorFacts.number(listing.beds))، العمر \(ListingText.age(listing.age))، فرق السعر عن وسيط الحي \(listing.vs_district_pct.map(Fmt.percent) ?? Fmt.unavailable)"
        })
        FlowScreen(title: "أدوّر عقاراً", question: "أفضل فرص \(store.listingKind == "rent" ? "الإيجار" : "الشراء")",
                   note: "عروض سعر مترها أقل من وسيط حيّها بين \(Fmt.percent(10)) و\(Fmt.percent(30)). جمع العينة: \(store.listingsRetrieved.map(Fmt.ltr) ?? Fmt.unavailable). تاريخ الإعلان لا يؤكد استمرار توفره.",
                   map: AtlasMap(shapes: [], fills: [:], key: "deals-\(store.listingKind)-\(store.geometryVersion)", dots: dots, focus: store.cityRegion,
                                 onDot: { id in
                                     guard let cluster = clusters.first(where: { $0.id == id }) else { return }
                                     if cluster.count == 1, let listing = cluster.listings.first { store.path.append(Route.listing(listing)) }
                                     else { store.path.append(Route.listingCluster(cluster.listings)) }
                                 }),
                   primary: Primary("اعرض أفضل العروض", enabled: !store.listingsLoading, action: {
                       Task { await loadSelectedListings() }
                   }),
                   secondary: filters.isActive ? Primary("مسح الفلاتر", action: { clearFilters() }) : nil) {
            VStack(alignment: .leading, spacing: 10) {
                SectionTitle(text: "صفِّ العروض")
                Menu {
                    Button("كل الأنواع") { selectedType = "" }
                    ForEach(availablePropertyTypes, id: \.0) { type in
                        Button(type.1) { selectedType = type.0 }
                    }
                } label: {
                    ListingFilterLabel(title: "نوع العقار", value: selectedType.isEmpty ? "كل الأنواع" : ListingText.type(selectedType))
                }
                .accessibilityIdentifier("listing-filter-type")

                if store.listingKind == "rent" {
                    Menu {
                        Button("كل المدد") { selectedRentDeal = ""; maximumPrice = 0 }
                        Button("سنوي") { selectedRentDeal = "rent_year"; maximumPrice = 0 }
                        Button("شهري") { selectedRentDeal = "rent_month"; maximumPrice = 0 }
                    } label: {
                        ListingFilterLabel(title: "مدة الإيجار", value: selectedRentDeal.isEmpty ? "كل المدد" : ListingText.deal(selectedRentDeal))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("listing-filter-deal")
                }

                if store.listingKind == "sale" || !selectedRentDeal.isEmpty {
                    Menu {
                        Button("بلا حد") { maximumPrice = 0 }
                        ForEach(budgetSteps, id: \.self) { amount in
                            Button("حتى \(Fmt.int(amount)) ر.س") { maximumPrice = amount }
                        }
                    } label: {
                        ListingFilterLabel(title: "الحد الأعلى للسعر", value: maximumPrice == 0 ? "بلا حد" : "حتى \(Fmt.int(maximumPrice)) ر.س")
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("listing-filter-budget")
                } else {
                    LabeledContent("الميزانية", value: "اختر مدة الإيجار أولاً")
                        .font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
                }

                Button { showingDistrictPicker = true } label: {
                    ListingFilterLabel(title: "الحي", value: store.city.districts == 0 ? "غير متاح" : selectedDistrict.isEmpty ? "كل الأحياء" : selectedDistrict)
                }
                .buttonStyle(.plain)
                .disabled(store.city.districts == 0)
                .accessibilityIdentifier("listing-filter-district")
                if store.city.districts == 0 {
                    Text("لا تتوفر حدود الأحياء في هذه المدينة، لذلك فلتر الحي غير متاح. بقية فلاتر العقار ما زالت تعمل.")
                        .font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("listing-district-unavailable")
                }

                Menu {
                    Button("أي عدد") { minimumBeds = 0 }
                    ForEach(1...6, id: \.self) { beds in
                        Button(beds == 6 ? "\(Fmt.int(6)) غرف أو أكثر" : "\(Fmt.int(Double(beds))) غرف أو أكثر") { minimumBeds = beds }
                    }
                } label: {
                    let value = minimumBeds == 0 ? "أي عدد" : (minimumBeds == 6 ? "\(Fmt.int(6)) غرف أو أكثر" : "\(Fmt.int(Double(minimumBeds))) غرف أو أكثر")
                    ListingFilterLabel(title: "غرف النوم", value: value)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("listing-filter-beds")

                Menu {
                    Button("أي عمر") { maximumAge = 0 }
                    Button("جديد فقط") { maximumAge = 1 }
                    ForEach([5, 10, 20], id: \.self) { age in
                        Button(ListingText.ageLimit(age)) { maximumAge = age }
                    }
                } label: {
                    ListingFilterLabel(title: "عمر العقار", value: maximumAge == 0 ? "أي عمر" : (maximumAge == 1 ? "جديد فقط" : ListingText.ageLimit(maximumAge)))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("listing-filter-age")

                if densityValues.isEmpty {
                    LabeledContent("كثافة سكان الحي", value: Fmt.unavailable)
                        .font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground)
                } else {
                    Menu {
                        Button("أي كثافة") { densityRank = 0 }
                        ForEach([75, 50, 25], id: \.self) { rank in
                            let cutoff = densityCutoff(for: rank) ?? 0
                            Button(ListingText.densityRank(rank, cutoff: cutoff)) { densityRank = rank }
                        }
                    } label: {
                        let value = densityRank == 0 ? "أي كثافة" : ListingText.densityRank(densityRank, cutoff: densityCutoff(for: densityRank) ?? 0)
                        ListingFilterLabel(title: "كثافة سكان الحي", value: value)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("listing-filter-density")
                }
                if densityRank > 0, !store.summaryLoading, store.layerErrors["counts"] == nil,
                   let disclosure = ListingText.densityCoverageUnavailable(districtsWithoutDensity) {
                    Text(disclosure)
                        .font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("listing-density-coverage")
                }

                Text(counterLabel)
                    .font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
            }
            .shadCard()

            if !store.listingsLoading && store.listingsError == nil {
                AtlasPathAdvisor(mode: .realEstate, facts: advisorFacts)
            }

            if store.listingsLoading { ForEach(0..<4, id: \.self) { _ in SkeletonLoader().frame(height: 96) } }
            if let error = store.listingsError, store.listings.isEmpty {
                RetryNotice(message: error) {
                    Task { await loadSelectedListings(appending: !store.listings.isEmpty && store.listingsHasMore) }
                }
            } else if store.listings.isEmpty && !store.listingsLoading {
                Text("لا توجد فرص واضحة الآن في \(store.city.name).").font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground)
            } else if filteredListings.isEmpty && !store.listingsLoading {
                Text(ListingResultMessage.empty(filtersApplied: selectionMatchesLoadedQuery, hasMore: store.listingsHasMore))
                    .font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground)
            }
            ForEach(Array(filteredListings.enumerated()), id: \.element.id) { index, listing in
                Button { store.path.append(Route.listing(listing)) } label: { ListingRow(listing: listing) }
                    .buttonStyle(.farqPress)
                    .accessibilityIdentifier("listing-\(index)")
            }
            if let error = store.listingsError, !store.listings.isEmpty {
                RetryNotice(message: error, action: {
                    Task { await loadSelectedListings(appending: store.listingsHasMore) }
                }, messageAccessibilityIdentifier: "listing-pagination-error")
            }
            if store.listingsHasMore && selectionMatchesLoadedQuery && store.listingsError == nil {
                Button {
                    Task { await loadSelectedListings(appending: true) }
                } label: {
                    HStack(spacing: 8) {
                        if store.listingsLoading { ProgressView().tint(.white) }
                        Text(store.listingsLoading ? "جارٍ تحميل المزيد…" : "حمّل المزيد من العروض")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.farqPrimary)
                .disabled(store.listingsLoading)
                .accessibilityIdentifier("listing-load-more")
            }
            Explained(title: "الفرص", lines: Explain.opportunities) {
                Text("كيف اخترنا الفرص؟").font(Typo.caption).foregroundStyle(Palette.brand)
            }
            .buttonStyle(.plain)
        }
        .sheet(isPresented: $showingDistrictPicker) {
            ListingDistrictPicker(
                selection: $selectedDistrict,
                isPresented: $showingDistrictPicker,
                districts: store.shapes.map(\.name).sorted { $0.localizedStandardCompare($1) == .orderedAscending }
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .onChange(of: selectedDistrict) { selectionMatchesLoadedQuery = false }
        .onChange(of: store.city.en) {
            selectedDistrict = ""
            densityRank = 0
            selectionMatchesLoadedQuery = false
        }
        .onChange(of: selectedType) { selectionMatchesLoadedQuery = false }
        .onChange(of: selectedRentDeal) { selectionMatchesLoadedQuery = false }
        .onChange(of: maximumPrice) { selectionMatchesLoadedQuery = false }
        .onChange(of: store.listingKind) {
            selectedType = ""
            selectedRentDeal = ""
            maximumPrice = 0
            selectionMatchesLoadedQuery = false
        }
        .onChange(of: minimumBeds) { selectionMatchesLoadedQuery = false }
        .onChange(of: maximumAge) { selectionMatchesLoadedQuery = false }
        .onChange(of: densityRank) { selectionMatchesLoadedQuery = false }
    }

    private var counterLabel: String {
        if store.listingsLoading { return "جارٍ تحديث العروض…" }
        if !selectionMatchesLoadedQuery { return "\(Fmt.int(Double(filteredListings.count))) من النتائج المحمّلة تطابق اختيارك" }
        if filteredListings.count < store.listingsTotal {
            return "عرض \(Fmt.int(Double(filteredListings.count))) من \(Fmt.int(Double(store.listingsTotal))) فرصة"
        }
        return "\(Fmt.int(Double(filteredListings.count))) عرض مطابق"
    }
}

private struct ListingDistrictPicker: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var selection: String
    @Binding var isPresented: Bool
    @State private var query = ""
    let districts: [String]

    private var matches: [String] {
        guard !query.isEmpty else { return districts }
        return districts.filter { $0.localizedStandardContains(query) }
    }

    private func close() {
        isPresented = false
        dismiss()
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    Button("إغلاق قائمة الأحياء", action: close)
                        .font(Typo.subheadline)
                        .foregroundStyle(Palette.brand)
                        .accessibilityIdentifier("district-picker-dismiss")
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 10)

                List {
                    Button {
                        selection = ""
                        close()
                    } label: {
                        HStack {
                            Text("كل الأحياء")
                            Spacer()
                            if selection.isEmpty { Image(systemName: "checkmark").foregroundStyle(Palette.brand) }
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("district-option-all")

                    ForEach(matches, id: \.self) { district in
                        Button {
                            selection = district
                            close()
                        } label: {
                            HStack {
                                Text(district)
                                Spacer()
                                if selection == district { Image(systemName: "checkmark").foregroundStyle(Palette.brand) }
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("district-option-\(district)")
                    }

                    if matches.isEmpty {
                        Text("لا يوجد حي بهذا الاسم في المدينة المختارة.")
                            .font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground)
                            .accessibilityIdentifier("district-search-empty")
                    }
                }
                .listStyle(.plain)
                .searchable(text: $query, prompt: "ابحث عن حي")
            }
            .navigationTitle("الحي")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear { query = "" }
        }
        .environment(\.layoutDirection, .rightToLeft)
    }
}

private struct ListingFilterLabel: View {
    let title: String
    let value: String

    var body: some View {
        row
    }

    private var row: some View {
        HStack(spacing: 10) {
            titleLabel
            Spacer(minLength: 8)
            valueLabel
            Image(systemName: "chevron.up.chevron.down")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Tokens.primaryInk)
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .center)
        .contentShape(Rectangle())
    }

    private var titleLabel: some View {
        Text(title)
            .font(Typo.subheadline)
            .foregroundStyle(Tokens.mutedForeground)
    }

    private var valueLabel: some View {
        Text(value)
            .font(Typo.subheadline.weight(.semibold))
            .foregroundStyle(Tokens.primaryInk)
            .lineLimit(1)
            .minimumScaleFactor(0.75)
    }
}

/// A map pin can represent several separate ads at the same or nearly the same point.
struct ListingClusterView: View {
    @Environment(AtlasStore.self) private var store
    let listings: [Listing]

    var body: some View {
        FlowScreen(title: "عروض عقارية", question: "\(Fmt.int(Double(listings.count))) عروض في النطاق نفسه",
                   note: "تجمع الخريطة الإعلانات ذات الإحداثيات المتقاربة إلى نحو متر. كل إعلان مستقل ويمكن فتحه.") {
            ForEach(Array(listings.enumerated()), id: \.element.id) { index, listing in
                Button { store.path.append(Route.listing(listing)) } label: { ListingRow(listing: listing) }
                    .buttonStyle(.farqPress)
                    .accessibilityIdentifier("cluster-listing-\(index)")
            }
        }
    }
}

enum ListingText {
    static func updated(_ day: String?) -> String { "آخر تحديث: \(day ?? Fmt.unavailable)" }

    static func densityRank(_ percentage: Int, cutoff: Double) -> String {
        "أعلى \(Fmt.int(Double(percentage)))% تقريباً (من \(Fmt.int(cutoff)) ساكن/كم²)"
    }

    static func densityCoverageUnavailable(_ count: Int) -> String? {
        guard count > 0 else { return nil }
        return "\(Fmt.int(Double(count))) حي بلا كثافة متاحة؛ لا يدخل في نتائج فلتر الكثافة."
    }

    static func ageLimit(_ years: Int) -> String {
        "حتى \(Fmt.int(Double(years))) \(years > 10 ? "سنة" : "سنوات")"
    }

    static func type(_ id: String?) -> String {
        ["room": "غرفة", "apartment": "شقة", "studio": "استوديو", "floor": "دور", "villa": "فيلا", "house": "بيت", "building": "عمارة",
         "store": "محل", "showroom": "معرض", "office": "مكتب", "warehouse": "مستودع", "land": "أرض", "rest_house": "استراحة",
         "chalet": "شاليه", "farm": "مزرعة"][id ?? ""] ?? "عقار"
    }

    static func deal(_ deal: String?) -> String {
        switch deal {
        case "sale": return "للبيع"
        case "rent_year": return "إيجار سنوي"
        case "rent_month": return "إيجار شهري"
        case "rent_unstated": return "إيجار (المدة غير مذكورة)"
        default: return Fmt.unavailable
        }
    }

    static func versus(_ pct: Double?) -> String {
        guard let pct else { return Fmt.unavailable }
        if abs(pct) < 1 { return "مثل وسيط الحي" }
        return pct < 0 ? "أقل من الحي بـ \(Fmt.percent(-pct))" : "أعلى من الحي بـ \(Fmt.percent(pct))"
    }

    static func age(_ age: Double?) -> String {
        guard let age else { return Fmt.unavailable }
        switch Int(age) {
        case 0: return "جديد"
        case 1: return "سنة"
        case 2: return "سنتان"
        case 3...10: return "\(Fmt.int(age)) سنوات"
        default: return "\(Fmt.int(age)) سنة"
        }
    }
}

struct ListingRow: View {
    let listing: Listing
    var body: some View {
        let comparison = listing.vs_district_pct
        let comparisonFill = comparison.map { $0 < 0 ? Palette.brand.opacity(0.12) : Palette.warning.opacity(0.14) } ?? Tokens.muted
        let comparisonText = comparison.map { $0 < 0 ? Palette.brand : Palette.warning } ?? Tokens.mutedForeground
        HStack(spacing: 12) {
            AsyncImage(url: listing.photo.flatMap(URL.init(string:))) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Rectangle().fill(Tokens.muted).overlay(Image(systemName: "photo").foregroundStyle(Tokens.mutedForeground))
            }
            .frame(width: 80, height: 80)
            .clipShape(.rect(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text("\(ListingText.type(listing.type)) · \(listing.district_ar ?? Fmt.unavailable)").font(Typo.font(15, .semibold)).lineLimit(1)
                Text("\(Fmt.int(listing.price_sar)) ر.س").font(Typo.font(17, .bold)).monospacedDigit()
                Text(ListingText.versus(comparison)).font(Typo.caption.weight(.semibold)).foregroundStyle(comparisonText)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(comparisonFill, in: .capsule)
                Text(ListingText.updated(listing.updated_on)).font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
            }
            .foregroundStyle(Tokens.foreground)
            Spacer()
            NextChevron().font(.footnote.weight(.bold)).foregroundStyle(Tokens.mutedForeground)
        }
        .shadCard()
    }
}

/// Screen 3: the listing, and the district around it.
private struct ListingContact: View {
    let id: String
    @State private var phone: String?
    @State private var loading = false
    @State private var showSignIn = false
    @State private var error: String?

    private func reveal() async {
        loading = true
        error = nil
        defer { loading = false }
        do {
            phone = try await AtlasAPI.shared.listingPhone(id)
            if phone == nil { error = "رقم المعلن غير متاح لهذا العرض." }
        } catch APIError.authenticationRequired {
            showSignIn = true
        } catch {
            self.error = error.localizedDescription
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let phone {
                let international = "966" + String(phone.dropFirst())
                HStack(spacing: 10) {
                    if let call = URL(string: "tel:+\(international)") {
                        Link(destination: call) {
                            Label("اتصال · \(phone)", systemImage: "phone.fill")
                                .frame(maxWidth: .infinity).padding(.vertical, 12)
                                .background(Palette.brand, in: .rect(cornerRadius: 12, style: .continuous))
                                .foregroundStyle(.white)
                        }
                    }
                    if let whatsapp = URL(string: "https://wa.me/\(international)") {
                        Link(destination: whatsapp) {
                            Label("واتساب", systemImage: "message.fill")
                                .frame(maxWidth: .infinity).padding(.vertical, 12)
                                .background(Tokens.card, in: .rect(cornerRadius: 12, style: .continuous))
                                .foregroundStyle(Tokens.foreground)
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Tokens.border))
                        }
                    }
                }
                .font(Typo.font(14, .semibold))
                .environment(\.layoutDirection, .leftToRight)
            } else {
                Button {
                    Task { await reveal() }
                } label: {
                    Label(loading ? "جارٍ جلب الرقم…" : "اعرض رقم المعلن", systemImage: loading ? "hourglass" : "phone")
                        .font(Typo.font(15, .bold))
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(Palette.brand, in: .rect(cornerRadius: 12, style: .continuous))
                        .foregroundStyle(.white)
                }
                .buttonStyle(.farqPress)
                .disabled(loading)
                .accessibilityIdentifier("listing-contact-reveal")
            }
            if let error {
                Text(error).font(Typo.caption).foregroundStyle(Palette.warning)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("listing-contact-error")
            }
            Text("لن يظهر الرقم في القوائم. اختر الاتصال أو واتساب بنفسك.")
                .font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
        }
        .padding(12)
        .background(Tokens.card, in: .rect(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Tokens.border))
        .sheet(isPresented: $showSignIn) {
            ListingSignInSheet {
                Task { await reveal() }
            }
        }
    }
}

private struct ListingSignInSheet: View {
    let onSignedIn: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var loading = false

    private func submit() async {
        guard !loading else { return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            try await AtlasAPI.shared.signIn(email: email, password: password)
            password = ""
            dismiss()
            onSignedIn()
        } catch {
            password = ""
            self.error = error.localizedDescription
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("تسجيل الدخول إلى فرق أطلس") {
                    TextField("البريد الإلكتروني", text: $email)
                        .textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityIdentifier("listing-login-email")
                    SecureField("كلمة المرور", text: $password)
                        .textContentType(.password)
                        .accessibilityIdentifier("listing-login-password")
                    if let error { Text(error).font(Typo.caption).foregroundStyle(Palette.warning) }
                    Button {
                        Task { await submit() }
                    } label: {
                        HStack { Spacer(); if loading { ProgressView() }; Text(loading ? "جارٍ الدخول…" : "دخول"); Spacer() }
                    }
                    .disabled(loading || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty)
                    .accessibilityIdentifier("listing-login-submit")
                }
                Section {
                    Text("نطلب تسجيل الدخول قبل عرض رقم المعلن، ولا نرسل رسالة أو نجري اتصالاً نيابةً عنك.")
                        .font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
                }
            }
            .navigationTitle("دخول")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("إغلاق") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

struct ListingDetail: View {
    @Environment(AtlasStore.self) private var store
    let listing: Listing

    var body: some View {
        FlowScreen(title: "العرض", question: "\(ListingText.type(listing.type)) \(ListingText.deal(listing.deal))",
                   note: listing.district_ar.map { "حي \($0)" }) {
            let photos = listing.photos ?? listing.photo.map { [$0] } ?? []
            if !photos.isEmpty {
                TabView {
                    ForEach(photos, id: \.self) { url in
                        AsyncImage(url: URL(string: url)) { image in image.resizable().scaledToFill() } placeholder: { ProgressView() }
                            .frame(maxWidth: .infinity).clipped()
                    }
                }
                .tabViewStyle(.page)
                .frame(height: 240)
                .clipShape(.rect(cornerRadius: 18, style: .continuous))
            }
            Explained(title: "السعر مقارنة بالحي", lines: Explain.listingVersus) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("السعر").font(Typo.font(13, .medium)).foregroundStyle(.white.opacity(0.75))
                        Text("\(Fmt.int(listing.price_sar)) ر.س").font(Typo.font(28, .bold)).monospacedDigit().foregroundStyle(.white)
                    }
                    Spacer()
                    Text(ListingText.versus(listing.vs_district_pct)).font(Typo.font(13, .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 10).padding(.vertical, 6).background(.white.opacity(0.18), in: .capsule)
                }
                .padding(18)
                .background(Palette.hero, in: .rect(cornerRadius: 20, style: .continuous))
            }
            .buttonStyle(.farqPress)
            FigureGrid {
                Figure(label: "المساحة", value: Fmt.withUnit(listing.area_sqm, "م²"))
                Figure(label: "سعر المتر", value: Fmt.withUnit(listing.sar_per_sqm, "ر.س"), explain: Explain.listingPerSqm)
                Figure(label: "غرف النوم", number: listing.beds)
                    .accessibilityIdentifier("listing-beds")
                Figure(label: "الصالات", number: listing.livings,
                       explain: ["عدد الصالات كما سجله المعلن في الإعلان.", "يظهر «غير متاح» إذا لم يذكره الإعلان."])
                    .accessibilityIdentifier("listing-livings")
                Figure(label: "دورات المياه", number: listing.wc,
                       explain: ["عدد دورات المياه كما سجله المعلن في الإعلان.", "يظهر «غير متاح» إذا لم يذكره الإعلان."])
                    .accessibilityIdentifier("listing-bathrooms")
                Figure(label: "عمر العقار", value: ListingText.age(listing.age))
                Figure(label: "آخر تحديث", value: listing.updated_on ?? Fmt.unavailable,
                       explain: ["تاريخ آخر تحديث مسجّل في إعلان المصدر.", "لا يوجد في لقطة الدليل حقل يثبت أن المعلن أغلق الإعلان؛ لا نعرضه على أنه مغلق بلا حالة موثقة."])
            }
            if let name = listing.district_ar {
                SectionTitle(text: "عن حي \(name)")
                FigureGrid {
                    Figure(label: "السكان", number: store.counts[name]?.population, explain: Explain.population)
                    Figure(label: "السكان لكل كم²", number: store.counts[name]?.density, explain: Explain.density)
                    Figure(label: "متوسط الدخل", number: store.income[name]?.income_all, unit: "ر.س", explain: Explain.income)
                    Figure(label: "المنشآت", number: store.counts[name]?.n, explain: Explain.businesses)
                }
            }
            if listing.has_phone == true {
                ListingContact(id: listing.id)
            } else {
                Text("رقم التواصل المباشر غير متاح لهذا العرض.").font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
            }
            if let url = listing.url.flatMap(URL.init(string:)) {
                Link(destination: url) {
                    Label("افتح الإعلان في عقار", systemImage: "arrow.up.right.square")
                        .font(Typo.font(14, .semibold)).frame(maxWidth: .infinity).padding(.vertical, 12)
                        .foregroundStyle(Tokens.primaryInk)
                }
                .accessibilityIdentifier("listing-source-link")
            }
        }
    }
}
