import SwiftUI

struct CityPicker: View {
    @Environment(AtlasStore.self) private var store
    @State private var query = ""

    var body: some View {
        List(store.cities.filter { query.isEmpty || $0.name.contains(query) || $0.en.localizedCaseInsensitiveContains(query) }) { city in
            Button {
                store.path = .init()
                store.detent = .fraction(0.32)
                Task { await store.choose(city: city) }
            } label: {
                HStack {
                    Text(city.name).font(Typo.body).foregroundStyle(.primary)
                    Spacer()
                    if let n = city.districts { Text(Fmt.counted(n, .district)).font(Typo.subheadline).foregroundStyle(.secondary) }
                    if city == store.city { Image(systemName: "checkmark").foregroundStyle(Palette.brand) }
                }
            }
        }
        .searchable(text: $query, prompt: "ابحث عن مدينة")
        .navigationTitle("المدينة")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct SearchView: View {
    @Environment(AtlasStore.self) private var store
    @State private var query = ""

    var body: some View {
        let rows = store.shapes.filter { query.isEmpty || $0.name.contains(query) }.sorted { $0.name < $1.name }
        List {
            if rows.isEmpty {
                Text("لا توجد نتائج لـ«\(query)». جرّب جزءاً من اسم الحي.").font(Typo.subheadline).foregroundStyle(.secondary)
            }
            ForEach(rows) { shape in
                Button {
                    store.path = .init()
                    store.select(shape)
                } label: {
                    HStack {
                        Image(systemName: "mappin.circle").foregroundStyle(Palette.brand)
                        Text(shape.name).font(Typo.body).foregroundStyle(.primary)
                        Spacer()
                        Text("\(Fmt.int(store.counts[shape.name]?.population)) ساكن").font(Typo.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Section {
                Text("البحث عن منشأة بالاسم يحتاج تسجيل الدخول في أطلس.").font(Typo.caption).foregroundStyle(.secondary)
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "اسم الحي")
        .navigationTitle("بحث في \(store.city.name)")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Districts of the city sorted by any metric; the map shading follows the same metric.
struct RankingView: View {
    @Environment(AtlasStore.self) private var store
    @State private var query = ""
    @State private var descending = true

    var body: some View {
        @Bindable var store = store
        let values = store.values(store.metric)
        let rows = store.shapes
            .filter { query.isEmpty || $0.name.contains(query) }
            .sorted { a, b in
                switch (values[a.name], values[b.name]) {
                case let (x?, y?): return descending ? x > y : x < y
                case (nil, _?): return false
                case (_?, nil): return true
                default: return a.name < b.name
                }
            }
        List {
            Section {
                let metrics = Lens.analysts.metrics
                VStack(alignment: .leading, spacing: 8) {
                    Text("رتّب ولوّن حسب").font(Typo.font(13, .semibold)).foregroundStyle(Tokens.mutedForeground)
                    FarqChips(options: metrics.map(\.label), selection: Binding(
                        get: { store.metric.label },
                        set: { label in if let m = metrics.first(where: { $0.label == label }) { withAnimation(Motion.slide) { store.metric = m } } }))
                }
                .listRowBackground(Color.clear)
                FarqSwitch(title: "الأعلى أولاً", isOn: $descending, symbol: "arrow.down")
                    .listRowBackground(Tokens.card)
            }
            Section(Fmt.counted(rows.count, .district)) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, shape in
                    Button {
                        store.path = .init()
                        store.select(shape)
                    } label: {
                        HStack {
                            Text(Fmt.int(index + 1)).font(Typo.font(13, .bold)).foregroundStyle(.secondary).frame(minWidth: 30, alignment: .leading)
                            Text(shape.name).font(Typo.body).foregroundStyle(.primary)
                            Spacer()
                            Text(store.metric.format(values[shape.name])).font(Typo.font(15, .semibold)).monospacedDigit()
                                .foregroundStyle(values[shape.name] == nil ? .secondary : .primary)
                        }
                    }
                    .swipeActions {
                        Button(store.compare.contains { $0.id == shape.id } ? "أزل" : "قارن") { store.toggleCompare(shape) }.tint(Palette.brand)
                    }
                }
            }
        }
        .searchable(text: $query, prompt: "ابحث عن حي")
        .navigationTitle("ترتيب أحياء \(store.city.name)")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Up to four districts side by side; the highest figure in each row is gently marked.
struct CompareView: View {
    @Environment(AtlasStore.self) private var store
    private let metrics: [Metric] = [.population, .density, .businesses, .residentsPerBusiness, .whatsapp, .wholesale, .saudiPct, .malePct, .income, .villaShare, .underConstruction]

    var body: some View {
        let shapes = store.compare
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    Text("").frame(width: 110, alignment: .leading)
                    ForEach(shapes) { shape in
                        Text(shape.name).font(Typo.font(14, .bold)).frame(maxWidth: .infinity).multilineTextAlignment(.center).lineLimit(2)
                    }
                }
                .padding(.vertical, 10)
                ForEach(metrics) { metric in
                    let values = shapes.map { store.value(metric, $0.name) }
                    let best = values.compactMap { $0 }.max()
                    Divider()
                    HStack(spacing: 8) {
                        Explained(title: metric.label, lines: metric.explain) {
                            Text(metric.label).font(Typo.font(13, .medium)).foregroundStyle(.secondary).frame(width: 110, alignment: .leading)
                        }
                        ForEach(Array(values.enumerated()), id: \.offset) { _, value in
                            Text(metric.format(value))
                                .font(Typo.font(14, value != nil && value == best && values.count > 1 ? .bold : .regular))
                                .monospacedDigit()
                                .foregroundStyle(value == nil ? .secondary : .primary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 4)
                                .background(value != nil && value == best && shapes.count > 1 ? Palette.accent.opacity(0.1) : .clear, in: .rect(cornerRadius: 6))
                                .lineLimit(1).minimumScaleFactor(0.6)
                        }
                    }
                    .padding(.vertical, 8)
                }
                if shapes.count < 2 {
                    Text("أضف حياً آخر على الأقل من بطاقة الحي.").font(Typo.subheadline).foregroundStyle(.secondary).padding(.top)
                }
            }
            .padding()
        }
        .navigationTitle("مقارنة الأحياء")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("مسح") { store.compare = []; store.path = .init() }.disabled(shapes.isEmpty)
            }
        }
    }
}

/// Pinned sites side by side (owners, «قارن المواقع»).
struct SitesView: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        let ratios = store.sites.compactMap(\.residentsPer)
        List {
            ForEach(Array(store.sites.enumerated()), id: \.element.id) { index, site in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("الموقع \(Fmt.int(index + 1))").font(Typo.headline)
                        Spacer()
                        Text("دائرة \(Fmt.int(site.radius)) م").font(Typo.caption).foregroundStyle(.secondary)
                    }
                    HStack {
                        Figure(label: "السكان", value: Fmt.int(site.population), explain: Explain.aroundPeople)
                        Figure(label: "المنشآت", value: Fmt.int(site.businesses), explain: Explain.aroundBusinesses)
                        Figure(label: "ساكن لكل منشأة", value: Fmt.int(site.residentsPer), explain: Explain.aroundScore,
                               badge: site.residentsPer != nil && site.residentsPer == ratios.max() && ratios.count > 1 ? "الأعلى بين مواقعك" : nil)
                    }
                }
                .listRowSeparator(.hidden)
            }
            .onDelete { store.sites.remove(atOffsets: $0) }
        }
        .listStyle(.plain)
        .navigationTitle("قارن المواقع")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: real estate

enum ListingText {
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
        HStack(spacing: 12) {
            AsyncImage(url: listing.photo.flatMap(URL.init(string:))) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Rectangle().fill(Color(.tertiarySystemFill)).overlay(Image(systemName: "photo").foregroundStyle(.tertiary))
            }
            .frame(width: 76, height: 76)
            .clipShape(.rect(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text("\(ListingText.type(listing.type)) · \(listing.district_ar ?? Fmt.unavailable)").font(Typo.callout).lineLimit(1)
                Text("\(Fmt.int(listing.price_sar)) ر.س").font(Typo.headline).monospacedDigit()
                HStack(spacing: 4) {
                    Circle().fill(Palette.versus(listing.vs_district_pct)).frame(width: 8, height: 8)
                    Text(ListingText.versus(listing.vs_district_pct)).font(Typo.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            NextChevron().foregroundStyle(.tertiary)
        }
        .card()
    }
}

struct ListingDetail: View {
    @Environment(AtlasStore.self) private var store
    let listing: Listing

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
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
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(ListingText.type(listing.type)) \(ListingText.deal(listing.deal))").font(Typo.title)
                    Text(listing.district_ar ?? Fmt.unavailable).font(Typo.callout).foregroundStyle(.secondary)
                }
                Explained(title: "السعر مقارنة بالحي", lines: Explain.listingVersus) {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("السعر").font(Typo.font(13, .medium)).foregroundStyle(.secondary)
                            Text("\(Fmt.int(listing.price_sar)) ر.س").font(Typo.bigFigure).monospacedDigit()
                        }
                        Spacer()
                        Text(ListingText.versus(listing.vs_district_pct))
                            .font(Typo.font(14, .semibold))
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(Palette.versus(listing.vs_district_pct).opacity(0.15), in: .capsule)
                            .foregroundStyle(Palette.versus(listing.vs_district_pct))
                    }
                    .card(tint: Palette.brand)
                }
                if listing.check == true {
                    Explained(title: "تحقق من الإعلان", lines: Explain.listingCheck) {
                        Label("رقم في الإعلان يبدو غير صحيح", systemImage: "exclamationmark.triangle.fill").font(Typo.callout).foregroundStyle(Palette.warning).card(tint: Palette.warning)
                    }
                }
                FigureGrid {
                    Figure(label: "المساحة", value: Fmt.withUnit(listing.area_sqm, "م²"))
                    Figure(label: "سعر المتر", value: Fmt.withUnit(listing.sar_per_sqm, "ر.س"), explain: Explain.listingPerSqm)
                    Figure(label: "غرف النوم", value: Fmt.int(listing.beds))
                    Figure(label: "دورات المياه", value: Fmt.int(listing.wc))
                    Figure(label: "عمر العقار", value: ListingText.age(listing.age))
                    Figure(label: "عرض الشارع", value: Fmt.withUnit(listing.street_width, "م"))
                }
                if let date = listing.listed_on { Text("نُشر في \(Fmt.ltr(date))").font(Typo.caption).foregroundStyle(.secondary) }
                HStack(spacing: 10) {
                    if let name = listing.district_ar, let shape = store.shapes.first(where: { $0.name == name }) {
                        Button {
                            store.path = .init()
                            store.select(shape)
                        } label: { Label("تعرّف على الحي", systemImage: "map").frame(maxWidth: .infinity) }
                            .buttonStyle(.farqSecondary)
                    }
                    if let link = listing.url.flatMap(URL.init(string:)) {
                        Link(destination: link) { Label("افتح الإعلان", systemImage: "arrow.up.forward.app").frame(maxWidth: .infinity) }
                            .buttonStyle(.farqPrimary)
                    }
                }
                .font(Typo.callout).controlSize(.large)
                Text("التواصل مع المعلن من الإعلان نفسه.").font(Typo.caption).foregroundStyle(.secondary)
            }
            .padding()
        }
        .navigationTitle("العرض")
        .navigationBarTitleDisplayMode(.inline)
    }
}
