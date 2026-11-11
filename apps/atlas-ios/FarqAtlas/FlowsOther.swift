import SwiftUI

// MARK: - 3. أوزّع على مندوبيني

/// Screen 1: «وش نشاط عملائك؟ وكم مندوب عندك؟»
struct DistributorSetupView: View {
    @Environment(AtlasStore.self) private var store
    @State private var query = ""

    var body: some View {
        @Bindable var store = store
        let activities = (store.summary?.main_activities ?? []).filter { query.isEmpty || $0.main_ar.contains(query) }
        FlowScreen(title: "أوزّع على مندوبيني", question: "كم مندوب عندك؟ ووش نشاط عملائك؟",
                   primary: .init("قسّم المدينة", enabled: store.activity != nil) {
                       store.path.append(Route.distributorRegions)
                       Task { await store.loadTerritories() }
                   }) {
            HStack {
                Text("عدد المندوبين").font(Typo.font(16, .semibold))
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
            SectionTitle(text: "نشاط عملائك")
            ActivityList(activities: activities, query: $query)
        }
    }
}

/// Screen 2: the city split into balanced, contiguous regions.
struct DistributorRegionsView: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        FlowScreen(title: "أوزّع على مندوبيني", question: "مناطق مندوبيك",
                   note: "كل منطقة متجاورة، ولكل مندوب حصة متقاربة من عملاء \(store.activity?.main_ar ?? "النشاط").",
                   map: AtlasMap(shapes: store.shapes, fills: territoryFills, key: "terr-\(store.repCount)-\(store.activity?.id ?? "")-\(store.dataVersion)",
                                 focus: store.cityRegion,
                                 onTap: { if let hit = store.district(at: $0), let t = store.territoryOf[hit.name] { store.path.append(Route.distributorRegion(t)) } })) {
            if store.territoriesLoading { ForEach(0..<store.repCount, id: \.self) { _ in SkeletonLoader().frame(height: 64) } }
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
                    .shadCard()
                }
                .buttonStyle(.farqPress)
                .accessibilityIdentifier("region-\(t.territory)")
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
                   map: AtlasMap(shapes: store.shapes, fills: store.fills(metric), key: "an-\(metric.rawValue)-\(store.dataVersion)",
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
        FlowScreen(title: "المقارنة", question: names.joined(separator: " · ")) {
            VStack(spacing: 0) {
                ForEach(rows) { metric in
                    let values = names.map { store.value(metric, $0) }
                    let best = values.compactMap { $0 }.max()
                    HStack(spacing: 8) {
                        Explained(title: metric.label, lines: metric.explain) {
                            Text(metric == .activityBusinesses ? "منشآت \(store.activity?.main_ar ?? "")" : metric.label)
                                .font(Typo.font(13, .medium)).foregroundStyle(Tokens.mutedForeground)
                                .frame(width: 100, alignment: .leading).lineLimit(2)
                        }
                        .buttonStyle(.plain)
                        ForEach(Array(values.enumerated()), id: \.offset) { _, value in
                            let top = value != nil && value == best && names.count > 1
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
            Button("ابدأ مقارنة جديدة") { store.compare = []; store.path.removeLast() }
                .buttonStyle(.farqSecondary).font(Typo.font(15, .semibold))
        }
    }
}

// MARK: - 5. أدوّر عقاراً

/// Screen 1: choose rent or sale and narrow the search before asking the server for listings.
struct RealEstateKindView: View {
    @Environment(AtlasStore.self) private var store
    @State private var showingDistricts = false
    @State private var districtQuery = ""

    var body: some View {
        FlowScreen(title: "أدوّر عقاراً", question: "وش مواصفات العقار؟",
                   note: "اختر الإيجار أو الشراء وحدد ما يناسبك. نطبّق الفلاتر على العروض قبل ترتيبها.",
                   primary: .init("اعرض أفضل العروض") {
                       store.path.append(Route.realEstateDeals)
                       Task { await store.loadListings() }
                   }) {
            SectionTitle(text: "إيجار ولا شراء؟")
            HStack(spacing: 8) {
                ListingFilterChip(title: "إيجار", selected: store.listingKind == "rent", id: "kind-rent") {
                    store.listingKind = "rent"; store.listingDeal = "rent_year"
                }
                ListingFilterChip(title: "شراء", selected: store.listingKind == "sale", id: "kind-sale") {
                    store.listingKind = "sale"; store.listingDeal = nil; store.listingMinBeds = nil; store.listingMaxPrice = nil
                }
            }

            if store.listingKind == "rent" {
                SectionTitle(text: "مدة الإيجار")
                HStack(spacing: 8) {
                    ListingFilterChip(title: "أي مدة", selected: store.listingDeal == nil, id: "deal-any") { store.listingDeal = nil; store.listingMaxPrice = nil }
                    ListingFilterChip(title: "سنوي", selected: store.listingDeal == "rent_year", id: "deal-year") { store.listingDeal = "rent_year"; store.listingMaxPrice = nil }
                    ListingFilterChip(title: "شهري", selected: store.listingDeal == "rent_month", id: "deal-month") { store.listingDeal = "rent_month"; store.listingMaxPrice = nil }
                }
            }

            SectionTitle(text: "نوع العقار")
            let types = ["apartment", "studio", "floor", "villa", "house", "building", "room", "store", "showroom", "office",
                         "warehouse", "land", "rest_house", "chalet", "farm", "factory", "workshop", "compound", "other"]
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(types, id: \.self) { type in
                    ListingFilterChip(title: ListingText.type(type), selected: store.listingTypes.contains(type), id: "type-\(type)") {
                        if store.listingTypes.contains(type) { store.listingTypes.remove(type) }
                        else { store.listingTypes.insert(type) }
                    }
                }
            }
            Text("اترك الأنواع بدون تحديد لعرضها كلها.").font(Typo.caption).foregroundStyle(Tokens.mutedForeground)

            SectionTitle(text: "الحد الأدنى للغرف")
            choiceRow([(nil, "أي عدد"), (1, "غرفة"), (2, "غرفتان"), (3, "3 غرف"), (4, "4 غرف أو أكثر")],
                      selected: store.listingMinBeds, id: "beds") { store.listingMinBeds = $0 }

            SectionTitle(text: "أقصى عمر للعقار")
            choiceRow([(nil, "أي عمر"), (0, "جديد فقط"), (5, "5 سنوات"), (10, "10 سنوات"), (20, "20 سنة")],
                      selected: store.listingMaxAge, id: "age") { store.listingMaxAge = $0 }

            if store.listingKind == "sale" {
                SectionTitle(text: "الحد الأعلى لسعر الشراء")
                choiceRow([(nil, "بلا حد"), (300000, "300,000 ر.س"), (600000, "600,000 ر.س"), (1000000, "1,000,000 ر.س"), (1500000, "1,500,000 ر.س")],
                          selected: store.listingMaxPrice, id: "price") { store.listingMaxPrice = $0 }
            } else if store.listingDeal == "rent_year" {
                SectionTitle(text: "الحد الأعلى للإيجار السنوي")
                choiceRow([(nil, "بلا حد"), (30000, "30,000 ر.س"), (60000, "60,000 ر.س"), (100000, "100,000 ر.س"), (150000, "150,000 ر.س")],
                          selected: store.listingMaxPrice, id: "price") { store.listingMaxPrice = $0 }
            } else if store.listingDeal == "rent_month" {
                SectionTitle(text: "الحد الأعلى للإيجار الشهري")
                choiceRow([(nil, "بلا حد"), (1000, "1,000 ر.س"), (2000, "2,000 ر.س"), (4000, "4,000 ر.س"), (6000, "6,000 ر.س")],
                          selected: store.listingMaxPrice, id: "price") { store.listingMaxPrice = $0 }
            } else {
                Text("اختر مدة الإيجار لتحديد ميزانية سنوية أو شهرية قابلة للمقارنة.")
                    .font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
            }

            SectionTitle(text: "أقل كثافة سكانية للحي")
            choiceRow([(nil, "أي كثافة"), (1000, "1,000 / كم²"), (5000, "5,000 / كم²"), (10000, "10,000 / كم²")],
                      selected: store.listingMinDensity, id: "density") { store.listingMinDensity = $0 }
            Text("الأحياء التي لا تتوفر لها كثافة سكانية لا تدخل في هذا الفلتر.")
                .font(Typo.caption).foregroundStyle(Tokens.mutedForeground)

            SectionTitle(text: "الأحياء")
            if store.shapes.isEmpty {
                Text("أسماء الأحياء غير متاحة لهذه المدينة حالياً.").font(Typo.callout).foregroundStyle(Tokens.mutedForeground).shadCard()
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Button {
                        showingDistricts.toggle()
                    } label: {
                        HStack {
                            Text(store.listingDistrictIDs.isEmpty ? "اختر الأحياء (اختياري)" : "الأحياء المختارة: \(Fmt.int(store.listingDistrictIDs.count))")
                            Spacer()
                            Image(systemName: showingDistricts ? "chevron.up" : "chevron.down")
                        }
                        .font(Typo.callout).foregroundStyle(Tokens.foreground)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("districts-toggle")
                    if showingDistricts {
                        TextField("ابحث عن حي", text: $districtQuery)
                            .font(Typo.callout)
                            .padding(10)
                            .background(Tokens.background, in: .rect(cornerRadius: 10, style: .continuous))
                            .accessibilityIdentifier("district-search")
                        LazyVStack(spacing: 4) {
                        ForEach(store.shapes.filter { districtQuery.isEmpty || $0.name.localizedCaseInsensitiveContains(districtQuery) }
                            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }) { shape in
                            Toggle(isOn: Binding(get: { store.listingDistrictIDs.contains(shape.id) }, set: { selected in
                                if selected { store.listingDistrictIDs.insert(shape.id) }
                                else { store.listingDistrictIDs.remove(shape.id) }
                            })) {
                                Text(shape.name).font(Typo.callout).foregroundStyle(Tokens.foreground)
                            }
                            .accessibilityIdentifier("district-\(shape.id)")
                        }
                    }
                    .padding(.top, 8)
                    }
                }
                .shadCard()
            }
        }
    }

    private func choiceRow(_ options: [(Double?, String)], selected: Double?, id: String,
                           action: @escaping (Double?) -> Void) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            ForEach(Array(options.enumerated()), id: \.offset) { entry in
                let option = entry.element
                let optionID = option.0.map { String(Int($0)) } ?? "any"
                ListingFilterChip(title: option.1, selected: option.0 == selected, id: "\(id)-\(optionID)") {
                    action(option.0)
                }
            }
        }
    }
}

private struct ListingFilterChip: View {
    let title: String
    let selected: Bool
    let id: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title).font(Typo.font(14, .semibold)).foregroundStyle(Tokens.foreground)
                .frame(maxWidth: .infinity, minHeight: 46)
                .padding(.horizontal, 7)
                .background(selected ? Tokens.accent : Tokens.card, in: .rect(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(selected ? Palette.brand.opacity(0.55) : Tokens.border, lineWidth: selected ? 1.5 : 1))
                .contentShape(.rect)
        }
        .buttonStyle(.farqPress)
        .accessibilityIdentifier(id)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Screen 2: the best 40 deals today.
struct RealEstateDealsView: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        let dots = store.listings.map { MapDot(id: $0.id, coordinate: $0.coordinate, color: Palette.accent) }
        FlowScreen(title: "أدوّر عقاراً", question: "أفضل فرص \(store.listingKind == "rent" ? "الإيجار" : "الشراء") اليوم",
                   note: "عروض سعر مترها أقل من وسيط حيّها بين \(Fmt.percent(10)) و\(Fmt.percent(30)).",
                   map: AtlasMap(shapes: [], fills: [:], key: "deals-\(store.listingKind)-\(store.dataVersion)", dots: dots, focus: store.cityRegion,
                                 onDot: { id in if let l = store.listings.first(where: { $0.id == id }) { store.path.append(Route.listing(l)) } })) {
            if store.listingsLoading { ForEach(0..<4, id: \.self) { _ in SkeletonLoader().frame(height: 96) } }
            if store.listings.isEmpty && !store.listingsLoading {
                Text("لا توجد فرص واضحة الآن في \(store.city.name).").font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground)
            }
            ForEach(Array(store.listings.enumerated()), id: \.element.id) { index, listing in
                Button { store.path.append(Route.listing(listing)) } label: { ListingRow(listing: listing) }
                    .buttonStyle(.farqPress)
                    .accessibilityIdentifier("listing-\(index)")
            }
            Explained(title: "الفرص", lines: Explain.opportunities) {
                Text("كيف اخترنا الفرص؟").font(Typo.caption).foregroundStyle(Palette.brand)
            }
            .buttonStyle(.plain)
        }
    }
}

enum ListingText {
    static func type(_ id: String?) -> String {
        ["room": "غرفة", "apartment": "شقة", "studio": "استوديو", "floor": "دور", "villa": "فيلا", "house": "بيت", "building": "عمارة",
         "store": "محل", "showroom": "معرض", "office": "مكتب", "warehouse": "مستودع", "land": "أرض", "rest_house": "استراحة",
         "chalet": "شاليه", "farm": "مزرعة", "factory": "مصنع", "workshop": "ورشة", "compound": "مجمع", "other": "أخرى"][id ?? ""] ?? "عقار"
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
                Text(ListingText.versus(listing.vs_district_pct)).font(Typo.caption).foregroundStyle(Palette.accent)
            }
            .foregroundStyle(Tokens.foreground)
            Spacer()
            NextChevron().font(.footnote.weight(.bold)).foregroundStyle(Tokens.mutedForeground)
        }
        .shadCard()
    }
}

/// Screen 3: the listing, and the district around it.
struct ListingDetail: View {
    @Environment(AtlasStore.self) private var store
    let listing: Listing

    var body: some View {
        FlowScreen(title: "العرض", question: "\(ListingText.type(listing.type)) \(ListingText.deal(listing.deal))",
                   note: listing.district_ar.map { "حي \($0)" },
                   primary: listing.url.flatMap(URL.init(string:)).map { link in .init("افتح الإعلان") { UIApplication.shared.open(link) } }) {
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
                Figure(label: "عمر العقار", value: ListingText.age(listing.age))
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
            Text("التواصل مع المعلن من الإعلان نفسه.").font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
        }
    }
}
