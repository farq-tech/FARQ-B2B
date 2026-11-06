import SwiftUI
import Pow

/// The persistent bottom panel: the lens journey on top, then the district card or the city summary, then the lens tools.
struct Panel: View {
    @Environment(AtlasStore.self) private var store
    @State private var showError = false

    var body: some View {
        @Bindable var store = store
        NavigationStack(path: $store.path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    LensHeader()
                    if let shape = store.selected {
                        DistrictCard(shape: shape)
                            .transition(.movingParts.move(edge: .bottom).combined(with: .opacity))
                    } else {
                        LensTools()
                        CitySummaryView()
                    }
                }
                .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 40)
                .animation(Motion.slide, value: store.selected?.id)
            }
            .scrollIndicators(.hidden)
            .background(FarqWash())
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { route in
                Group {
                    switch route {
                    case .cities: CityPicker()
                    case .search: SearchView()
                    case .ranking: RankingView()
                    case .compare: CompareView()
                    case .sites: SitesView()
                    case .listing(let listing): ListingDetail(listing: listing)
                    }
                }
                .scrollContentBackground(.hidden)
                .background(FarqWash())
                .toolbar(.visible, for: .navigationBar)
            }
        }
        // a failed load surfaces as a toast that offers a retry (SwiftPieces Toast)
        .modifier(Toast(isPresented: $showError, message: store.error ?? "تعذر تحميل البيانات.", systemImage: "wifi.exclamationmark",
                        style: .error, duration: 6, position: .top,
                        action: .init("إعادة المحاولة") { Task { await store.load() } },
                        appearance: .init(surface: Tokens.card, label: Tokens.foreground, secondaryLabel: Tokens.mutedForeground, action: Palette.brand)))
        .onChange(of: store.error) { _, error in showError = error != nil }
    }
}

/// The lens question, its numbered steps and the metric that colours the map.
struct LensHeader: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        @Bindable var store = store
        VStack(alignment: .leading, spacing: 14) {
            Text(store.lens.question)
                .font(Typo.title)
                .foregroundStyle(Tokens.foreground)
                .id(store.lens)
                .transition(.asymmetric(insertion: .movingParts.move(edge: .trailing).combined(with: .opacity), removal: .opacity))
            FarqSteps(steps: store.lens.steps, current: Binding(get: { store.lensStep }, set: { store.goTo(step: $0) }))
                .id(store.lens)
            if store.lens != .realEstate {
                if store.lens.metrics.count <= 3 {
                    FarqSegments(options: store.lens.metrics.map { ($0, $0.label) }, selection: $store.metric, height: 38)
                } else {
                    FarqChips(options: store.lens.metrics.map(\.label), selection: Binding(
                        get: { store.metric.label },
                        set: { label in if let m = store.lens.metrics.first(where: { $0.label == label }) { store.metric = m } }))
                }
                if !(store.lens == .distributors && store.showTerritories) { Legend(metric: store.metric) }
            } else {
                LegendDot(color: Palette.accent, text: "عرض أقل من وسيط حيّه")
            }
        }
        .animation(Motion.slide, value: store.lens)
    }
}

struct LegendDot: View {
    let color: Color
    let text: String
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 10, height: 10)
                .conditionalEffect(.repeat(.glow(color: color, radius: 10), every: 2.2), condition: true)
            Text(text).font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
        }
    }
}

struct Legend: View {
    let metric: Metric
    var body: some View {
        Explained(title: "ألوان الخريطة", lines: Explain.shading) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 3) {
                    ForEach(0..<5, id: \.self) { Palette.ramp[$0].frame(height: 8).clipShape(.capsule) }
                }
                HStack {
                    Text("أقل في المدينة")
                    Spacer()
                    HStack(spacing: 4) { Circle().fill(Palette.missing).frame(width: 8, height: 8); Text(Fmt.unavailable) }
                    Spacer()
                    Text("أعلى في المدينة")
                }
                .font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
            }
        }
    }
}

/// One figure; tapping it explains how it was worked out. A number rolls digit by digit when it changes.
struct Figure: View {
    let label: String
    var value: String? = nil
    var number: Double? = nil
    var unit: String = ""
    var explain: [String] = []
    var badge: String? = nil

    init(label: String, value: String, explain: [String] = [], badge: String? = nil) {
        self.label = label; self.value = value; self.explain = explain; self.badge = badge
    }

    init(label: String, number: Double?, unit: String = "", explain: [String] = [], badge: String? = nil) {
        self.label = label; self.number = number; self.unit = unit; self.explain = explain; self.badge = badge
    }

    var body: some View {
        Explained(title: label, lines: explain.isEmpty ? ["رقم من بيانات فرق."] : explain) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(label).font(Typo.font(13, .medium)).foregroundStyle(Tokens.mutedForeground).lineLimit(1)
                    if let badge { FarqBadge(title: badge, tone: badge == "تقدير" ? .estimate : .warning) }
                }
                Group {
                    if let value {
                        Text(value)
                            .font(value == Fmt.unavailable ? Typo.callout : Typo.figure)
                            .foregroundStyle(value == Fmt.unavailable ? Tokens.mutedForeground : Tokens.foreground)
                            .monospacedDigit()
                            .rollingNumber(value)
                            .lineLimit(1).minimumScaleFactor(0.6)
                    } else {
                        RollingFigure(value: number, unit: unit)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .shadCard()
        }
        .buttonStyle(.farqPress)
    }
}

struct FigureGrid<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10, content: content)
    }
}

struct SectionTitle: View {
    let text: String
    var body: some View { Text(text).font(Typo.headline).foregroundStyle(Tokens.foreground).padding(.top, 4) }
}

/// The city when nothing is selected.
struct CitySummaryView: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle(text: "ملخص \(store.city.name)")
            FigureGrid {
                Figure(label: "المنشآت", number: store.summary?.total, explain: Explain.cityBusinesses)
                Figure(label: "الأحياء", number: store.shapes.isEmpty ? nil : Double(store.shapes.count), explain: ["الأحياء الرسمية للمدينة في الأطلس."])
                Figure(label: "منشآت بواتساب", number: store.summary?.n_whatsapp, explain: Metric.whatsapp.explain)
                Figure(label: "منشآت الجملة", number: store.summary?.n_wholesale, explain: Metric.wholesale.explain)
            }
            .skeleton(isLoading: store.summary == nil && store.error == nil)
            if let rows = store.summary?.main_activities, !rows.isEmpty {
                ActivityList(rows: Array(rows.prefix(6)))
            }
            HStack(spacing: 10) {
                NavigationLink(value: Route.ranking) { Label("ترتيب الأحياء", systemImage: "list.number") }
                    .buttonStyle(.farqPrimary)
                if !store.compare.isEmpty {
                    NavigationLink(value: Route.compare) { Label("المقارنة (\(Fmt.int(store.compare.count)))", systemImage: "square.split.2x1.fill") }
                        .buttonStyle(.farqSecondary)
                        .transition(.movingParts.pop(Palette.brand))
                }
            }
            .font(Typo.font(15, .semibold))
        }
    }
}

/// The largest activities as a ring you scrub (SwiftPieces RingBreakdown), in Farq's map colours.
struct ActivityList: View {
    let rows: [Activity]
    @State private var picked: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Explained(title: "أكبر الأنشطة", lines: Explain.activities) {
                HStack {
                    Text("أكبر الأنشطة").font(Typo.font(13, .semibold)).foregroundStyle(Tokens.mutedForeground)
                    Spacer()
                    Image(systemName: "info.circle").font(.footnote).foregroundStyle(Tokens.mutedForeground)
                }
            }
            RingBreakdown(slices: rows.enumerated().map { index, row in
                                .init(label: row.main_ar, value: row.n, color: Palette.territories[index % Palette.territories.count])
                          },
                          thickness: 26, format: englishNumber, showsLegend: true,
                          selection: $picked)
                .font(Typo.font(15, .semibold))
                .frame(maxWidth: .infinity)
        }
        .shadCard()
    }
}
