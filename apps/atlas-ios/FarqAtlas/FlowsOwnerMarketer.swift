import SwiftUI

// MARK: - 1. أفتح فرعاً

/// Screen 1: «وش نشاطك؟»
struct OwnerActivityView: View {
    @Environment(AtlasStore.self) private var store
    @State private var query = ""

    var body: some View {
        let activities = (store.summary?.main_activities ?? []).filter { query.isEmpty || $0.matches(query) }
        FlowScreen(title: "أفتح فرعاً", question: "وش نشاطك؟", note: "نرتّب الأحياء بحسب نقص النشاط ودخل العامل الشهري المقاس.",
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
    @State private var suggestion: Activity?
    @State private var searchLoading = false
    @State private var searchError: String?

    var body: some View {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let matches = activities.filter { term.isEmpty || $0.matches(term) }
        VStack(spacing: 10) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(Tokens.mutedForeground)
                TextField("مثال: مساج، مطعم، مخبز", text: $query).font(Typo.body)
                    .submitLabel(.search)
                if !query.isEmpty {
                    Button { query = "" } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(Tokens.mutedForeground)
                    }
                    .accessibilityLabel("مسح البحث")
                    .accessibilityIdentifier("clear-activity-search")
                }
            }
            .shadCard()
            if store.summaryLoading && store.summary == nil {
                ForEach(0..<5, id: \.self) { _ in SkeletonLoader().frame(height: 56) }
            } else if let error = store.summaryError {
                RetryNotice(message: error) { Task { await store.retrySummary() } }
            }
            ForEach(matches) { activity in
                OptionRow(title: activity.main_ar, trailing: Fmt.int(activity.n), selected: store.activity == activity) {
                    Task { await store.choose(activity: activity) }
                }
                .accessibilityIdentifier("activity-\(activity.main_id ?? activity.main_ar)")
            }
            if term.count >= 2 {
                if let suggestion {
                    SectionTitle(text: "التخصص المطابق")
                    OptionRow(title: suggestion.main_ar,
                              trailing: suggestion.n > 0 ? "\(Fmt.int(suggestion.n)) منشأة" : "لا توجد سجلات",
                              selected: store.activity == suggestion,
                              enabled: suggestion.n > 0) {
                        Task { await store.choose(activity: suggestion) }
                    }
                    .accessibilityIdentifier("activity-search-result")
                    Text("فهمنا «\(term)» كـ\(suggestion.main_ar). العدد من المنشآت المصنّفة لهذا التخصص في \(store.city.name).")
                        .font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
                } else if searchLoading {
                    HStack(spacing: 8) { ProgressView(); Text("نبحث عن التخصص المطابق…").font(Typo.subheadline) }
                        .foregroundStyle(Tokens.mutedForeground).frame(maxWidth: .infinity, minHeight: 44)
                } else if let searchError {
                    RetryNotice(message: searchError) { Task { await updateSuggestion(for: query) } }
                } else {
                    Text("ما لقينا تخصصًا مطابقًا لـ«\(term)». جرّب اسمًا أدق أو اختر الفئة العامة الظاهرة أعلاه.")
                        .font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            if store.activityLoading {
                HStack(spacing: 8) { ProgressView(); Text("جارٍ تحميل بيانات النشاط…").font(Typo.subheadline) }
                    .foregroundStyle(Tokens.mutedForeground)
                    .frame(maxWidth: .infinity, minHeight: 44)
            } else if let error = store.activityError {
                RetryNotice(message: error) { Task { await store.retryActivity() } }
            }
        }
        .task(id: query) { await updateSuggestion(for: query) }
    }

    @MainActor
    private func updateSuggestion(for rawQuery: String) async {
        let term = rawQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard term.count >= 2 else {
            suggestion = nil
            searchError = nil
            searchLoading = false
            return
        }
        searchLoading = true
        searchError = nil
        suggestion = nil
        try? await Task.sleep(nanoseconds: 300_000_000)
        guard !Task.isCancelled else { return }
        do {
            let result = try await store.suggestActivity(term)
            guard !Task.isCancelled, query.trimmingCharacters(in: .whitespacesAndNewlines) == term else { return }
            suggestion = result
        } catch {
            guard !Task.isCancelled, query.trimmingCharacters(in: .whitespacesAndNewlines) == term else { return }
            searchError = "تعذر البحث عن التخصص. تحقق من اتصالك ثم أعد المحاولة."
        }
        searchLoading = false
    }
}

/// Screen 2: «أين يحتاجك الناس أكثر؟»
struct OwnerDistrictsView: View {
    @Environment(AtlasStore.self) private var store
    @State private var showAll = false
    @State private var showMap = true

    var body: some View {
        let ranked = store.ranked(.marketFit)
        let shown = showAll ? ranked : Array(ranked.prefix(5))
        FlowScreen(title: "أفتح فرعاً", question: "أين تلائم السوقَ فكرةُ \(store.activity?.main_ar ?? "نشاطك")؟",
                   note: "الترتيب يوازن بين نقص النشاط ودخل العامل الشهري المقاس، لا السكان وحدهم.",
                   map: showMap ? AtlasMap(shapes: store.shapes, fills: store.fills(.marketFit), key: "fit-\(store.activity?.id ?? "")-\(store.geometryVersion)",
                                 highlighted: Set(ranked.prefix(5).map(\.shape.name)), focus: store.cityRegion,
                                 onTap: { if let hit = store.district(at: $0) { store.path.append(Route.ownerDistrict(hit.name)) } }) : nil) {
            Button {
                withAnimation(Motion.slide) { showMap.toggle() }
            } label: {
                Label(showMap ? "إخفاء الخريطة" : "إظهار الخريطة",
                      systemImage: showMap ? "map.fill" : "map")
                    .font(Typo.font(14, .semibold))
                    .foregroundStyle(Palette.brand)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.farqPress)
            .accessibilityIdentifier("owner-map-toggle")
            Legend()
            if store.activityLoading { ForEach(0..<5, id: \.self) { _ in SkeletonLoader().frame(height: 74) } }
            if let error = store.activityError {
                RetryNotice(message: error) { Task { await store.retryActivity() } }
            }
            if ranked.isEmpty && !store.activityLoading {
                Text("درجة الملاءمة غير متاحة؛ يلزم قياس نقص النشاط ودخل العامل في الحي.")
                    .font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground)
            }
            ForEach(Array(shown.enumerated()), id: \.element.shape.id) { index, item in
                let gap = store.gaps[item.shape.name]?.shortfall
                let power = store.purchasingPower(item.shape.name)
                let powerText = Fmt.withUnit(power, "ر.س/عامل/شهر")
                Button { store.path.append(Route.ownerDistrict(item.shape.name)) } label: {
                    DistrictRow(rank: index + 1, name: item.shape.name,
                                sentence: "نقص النشاط \(gap.map { $0 > 0 ? "+\(Fmt.int($0))" : Fmt.int($0) } ?? Fmt.unavailable) · \(store.purchasingPowerLabel) \(powerText)",
                                figure: "درجة \(Fmt.int(item.value))")
                }
                .buttonStyle(.farqPress)
                .accessibilityIdentifier("district-\(index)")
                .accessibilityValue(Fmt.int(item.value))
            }
            Explained(title: "درجة ملاءمة السوق", lines: Explain.marketFit) {
                Text("\(Fmt.percent(50)) ترتيب نقص النشاط + \(Fmt.percent(50)) ترتيب دخل العامل الشهري. اضغط للتفاصيل.").font(Typo.caption).foregroundStyle(Palette.brand)
            }
            .buttonStyle(.plain)
            if ranked.count > 5 {
                Button(showAll ? "اعرض أول \(Fmt.int(5)) فقط" : "اعرض كل الأحياء (\(Fmt.int(ranked.count)))") { withAnimation(Motion.slide) { showAll.toggle() } }
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
            let advisorFacts = AtlasAdvisorFacts.block([
                "المسار: فتح فرع",
                "المدينة: \(store.city.name)",
                "النشاط: \(store.activity?.main_ar ?? Fmt.unavailable)",
                "الحي: \(name)",
                "السكان: \(AtlasAdvisorFacts.number(store.counts[name]?.population))",
                "منشآت النشاط: \(AtlasAdvisorFacts.number(counts?.n))",
                "النقص المتوقع للنشاط: \(AtlasAdvisorFacts.number(store.gaps[name]?.shortfall))",
                "ساكن لكل منشأة من النشاط: \(AtlasAdvisorFacts.number(counts?.residents_per))",
                "متوسط دخل العامل: \(AtlasAdvisorFacts.number(store.income[name]?.income_all, unit: "ر.س"))",
                "مستوى السكن/حصة الفلل: \(AtlasAdvisorFacts.number(store.housing[name]?.villa_share_pct, unit: "%"))",
            ])
            FlowScreen(title: "أفتح فرعاً", question: "هل يناسبك حي \(name)؟",
                       note: pinning ? "المس الخريطة لتضع الدبوس على الموقع المرشّح." : nil,
                       map: AtlasMap(shapes: store.shapes, fills: store.fills(.marketFit), key: "fit-\(store.activity?.id ?? "")-\(store.geometryVersion)",
                                     highlighted: [name], circle: store.pin, radius: store.radius, focus: store.region(of: shape),
                                 interactionKey: pinning ? "pinning" : "browse",
                                     onTap: { coordinate in if pinning { Task { await store.place(pin: coordinate) } } }),
                       primary: .init(store.compare.contains(name) && store.compare.count >= 2 ? "افتح المقارنة" : "قارن مع حي آخر") { compareAction(store, name) { store.path.removeLast() } }) {
                VStack(alignment: .leading, spacing: 10) {
                    Button { pinning.toggle() } label: {
                        HStack(spacing: 10) {
                            Label("جرّب موقعاً بالضبط", systemImage: "mappin.and.ellipse")
                                .font(Typo.font(15, .semibold))
                            Spacer(minLength: 8)
                            Image(systemName: pinning ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 22, weight: .medium))
                                .foregroundStyle(pinning ? Palette.brand : Tokens.mutedForeground)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.farqPress)
                    .accessibilityIdentifier("pin-toggle")
                    .accessibilityValue(pinning ? "مفعّل" : "غير مفعّل")
                }
                .shadCard()
                ScoreHero(title: "فرص التوسع لـ\(store.activity?.main_ar ?? "نشاطك")", value: store.gaps[name]?.shortfall,
                          score: store.score(.marketFit, name), city: store.city.name, lines: Explain.marketFit)
                FigureGrid {
                    Figure(label: "السكان", number: store.counts[name]?.population, explain: Explain.population)
                    Figure(label: "المنافسون", number: counts?.n, explain: Metric.activityBusinesses.explain)
                    Figure(label: "ساكن لكل منافس", number: counts?.residents_per, explain: Metric.activityResidentsPer.explain)
                    Figure(label: "المنافسون لكل كم²", number: counts?.per_km2, explain: Metric.activityPerKm2.explain)
                }
                AtlasPathAdvisor(mode: .branch, facts: advisorFacts)
                if store.pin != nil {
                    FigureGrid {
                        Figure(label: "السكان داخل \(Fmt.int(1)) كم", number: store.around?.population, explain: Explain.aroundPeople, badge: "تقدير")
                            .accessibilityIdentifier("around-population-figure")
                        Figure(label: "المنشآت داخل \(Fmt.int(1)) كم", number: store.around?.businesses, explain: Explain.aroundBusinesses)
                    }
                    .skeleton(isLoading: store.aroundLoading)
                    if let error = store.aroundError {
                        HStack(spacing: 10) {
                            Text(error).font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
                            Spacer(minLength: 4)
                            Button("إعادة المحاولة") { Task { await store.retryAround() } }
                                .buttonStyle(.farqSecondary)
                        }
                    }
                }
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
        let audienceNote = store.layerErrors["audience"] != nil || store.hasAudience || store.audienceLoading
            ? nil
            : "الجنس والجنسية غير متاحين في \(store.city.name)، فالمتاح «الكل» فقط."
        FlowScreen(title: "أصل لجمهوري", question: "مين جمهورك؟", note: audienceNote,
                   primary: .init("اعرض الأحياء") { store.path.append(Route.marketerDistricts) }) {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(Segment.allCases) { segment in
                    SegmentCard(segment: segment, selected: store.segment == segment,
                                enabled: segment == .everyone || store.hasAudience) {
                        store.segment = segment
                    }
                }
            }
            if store.audienceLoading {
                Text("جار تحميل قياسات الجمهور في \(store.city.name)…")
                    .font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
                    .accessibilityIdentifier("audience-loading")
            }
            SectionTitle(text: store.segment.incomeLabel)
                .accessibilityIdentifier("audience-income-filter")
            if store.incomeLoading {
                HStack(spacing: 8) { ProgressView(); Text("جار تحميل بيانات الدخل…").font(Typo.subheadline) }
                    .foregroundStyle(Tokens.mutedForeground).frame(minHeight: 44)
            } else if store.layerErrors["income"] != nil {
                Text("تعذر تحميل بيانات الدخل؛ أعد المحاولة من التنبيه أعلى الشاشة.")
                    .font(Typo.subheadline).foregroundStyle(Palette.warning)
            } else if store.hasIncome(for: store.segment) {
                ForEach([0.0, 10000, 15000, 20000], id: \.self) { bar in
                    OptionRow(title: bar == 0 ? "بلا حد" : "\(Fmt.int(bar)) ر.س أو أكثر", selected: store.minIncome == bar) { store.minIncome = bar }
                }
            } else {
                Text("قياس دخل هذه الفئة \(Fmt.unavailable) في \(store.city.name)، لذلك لا يمكن تطبيق حد الدخل عليها.")
                    .font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground)
            }
        }
    }
}

private struct SegmentCard: View {
    let segment: Segment
    let selected: Bool
    let enabled: Bool
    let action: () -> Void

    private var symbol: String {
        switch segment {
        case .everyone: return "person.2.fill"
        case .men: return "figure.stand"
        case .women: return "figure.stand.dress"
        case .saudi: return "globe.americas.fill"
        case .nonSaudi: return "globe"
        }
    }

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Image(systemName: symbol).font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(selected ? Palette.brand : Tokens.mutedForeground)
                    Spacer()
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(selected ? Palette.brand : Tokens.mutedForeground)
                }
                Text(segment.label).font(Typo.font(15, .bold)).foregroundStyle(Tokens.foreground)
                    .lineLimit(1).minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
            .padding(12)
            .background(selected ? Tokens.accent : Tokens.card, in: .rect(cornerRadius: Tokens.radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Tokens.radius, style: .continuous)
                .strokeBorder(selected ? Palette.brand.opacity(0.55) : Tokens.border, lineWidth: selected ? 1.5 : 1))
            .contentShape(.rect)
        }
        .buttonStyle(.farqPress)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
        .accessibilityIdentifier("segment-\(segment.rawValue)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Screen 2: «أين يسكن جمهورك؟»
struct MarketerDistrictsView: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        let ranked = store.ranked(.audience)
        let advisorFacts = AtlasAdvisorFacts.block([
            "المسار: استهداف الجمهور",
            "المدينة: \(store.city.name)",
            "الفئة المقاسة: \(store.segment.label)",
            "حد متوسط دخل العامل: \(store.minIncome > 0 ? AtlasAdvisorFacts.number(store.minIncome, unit: "ر.س") : "بلا حد")",
            "حجم الفئة في الأحياء المتاحة: \(AtlasAdvisorFacts.number(store.audienceTotal))",
            "أفضل الأحياء المتاحة، من الأكبر للفئة إلى الأقل:",
        ] + ranked.prefix(10).map { item in
            "\(item.shape.name): جمهور \(AtlasAdvisorFacts.number(item.value))، سكان \(AtlasAdvisorFacts.number(store.counts[item.shape.name]?.population)), \(store.segment.incomeLabel) \(AtlasAdvisorFacts.number(store.audienceIncome(item.shape.name), unit: "ر.س"))"
        })
        FlowScreen(title: "أصل لجمهوري", question: "أين يسكن جمهورك؟",
                   map: AtlasMap(shapes: store.shapes, fills: store.fills(.audience), key: "aud-\(store.segment.rawValue)-\(store.minIncome)-\(store.geometryVersion)",
                                 highlighted: Set(ranked.prefix(5).map(\.shape.name)), focus: store.cityRegion,
                                 onTap: { if let hit = store.district(at: $0) { store.path.append(Route.marketerDistrict(hit.name)) } })) {
            HStack(spacing: 8) {
                Label(store.segment.label, systemImage: "person.crop.circle.fill")
                if store.minIncome > 0 {
                    Text("دخل العامل من \(Fmt.withUnit(store.minIncome, "ر.س"))")
                }
            }
            .font(Typo.caption.weight(.semibold))
            .foregroundStyle(Palette.brand)
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(Tokens.accent, in: .capsule)
            .accessibilityIdentifier("audience-context")
            AtlasPathAdvisor(mode: .audience, facts: advisorFacts)
            Explained(title: "حجم الجمهور", lines: Explain.audienceTotal) {
                HeroStat(title: "حجم جمهورك (\(store.segment.label))", value: store.audienceTotal,
                         caption: store.audienceEligibleDistrictCount.map {
                             "بيانات في \(Fmt.counted(ranked.count, .district)) من \(Fmt.counted($0, .district))"
                         } ?? "بيانات الدخل غير مكتملة لحصر الأحياء المؤهلة")
            }
            .buttonStyle(.farqPress)
            Legend()
            ForEach(Array(ranked.prefix(5).enumerated()), id: \.element.shape.id) { index, item in
                Button { store.path.append(Route.marketerDistrict(item.shape.name)) } label: {
                    DistrictRow(rank: index + 1, name: item.shape.name,
                                sentence: "سكان الحي: \(store.segment.label)",
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
            let advisorFacts = AtlasAdvisorFacts.block([
                "المسار: استهداف الجمهور",
                "المدينة: \(store.city.name)",
                "الشريحة المقاسة: \(store.segment.label)",
                "حد متوسط دخل العامل: \(store.minIncome > 0 ? AtlasAdvisorFacts.number(store.minIncome, unit: "ر.س") : "بلا حد")",
                "الحي: \(name)",
                "حجم الشريحة المقاسة: \(AtlasAdvisorFacts.number(store.audienceSize(name)))",
                "سكان الحي: \(AtlasAdvisorFacts.number(store.counts[name]?.population))",
                "نسبة السعوديين المقاسة: \(store.audience[name]?.saudi_pct.map(Fmt.percent) ?? Fmt.unavailable)",
                "\(store.segment.incomeLabel): \(AtlasAdvisorFacts.number(store.audienceIncome(name), unit: "ر.س"))",
            ])
            FlowScreen(title: "أصل لجمهوري", question: "حي \(name)",
                       map: AtlasMap(shapes: store.shapes, fills: store.fills(.audience), key: "aud-\(store.segment.rawValue)-\(store.minIncome)-\(store.geometryVersion)",
                                     highlighted: [name], focus: store.region(of: shape)),
                       primary: .init(store.compare.contains(name) && store.compare.count >= 2 ? "افتح المقارنة" : "قارن مع حي آخر") { compareAction(store, name) { store.path.removeLast() } }) {
                ScoreHero(title: "جمهورك هنا (\(store.segment.label))", value: store.audienceSize(name), score: store.score(.audience, name), city: store.city.name)
                FigureGrid {
                    Figure(label: "السكان", number: store.counts[name]?.population, explain: Explain.population)
                    Figure(label: "الفئة المستهدفة", number: store.audienceSize(name), explain: ["عدد السكان من فئة \(store.segment.label) المقاسة في هذا الحي.", "لا يشمل عدد المنشآت."])
                    Figure(label: "السعوديون", value: Fmt.percent(store.audience[name]?.saudi_pct), explain: Explain.saudi)
                    Figure(label: store.segment.incomeLabel, number: store.audienceIncome(name), unit: "ر.س",
                           explain: ["هذا هو متوسط دخل الفئة العاملة المختارة كما قيس في الحي.", "عند غياب القياس لا نستخدم متوسط دخل فئة أخرى مكانه."])
                }
                AtlasPathAdvisor(mode: .audience, facts: advisorFacts)
                DistrictDetails(shape: shape, includeBusinessMetrics: false)
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
