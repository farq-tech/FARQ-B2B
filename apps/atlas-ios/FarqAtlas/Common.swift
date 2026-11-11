import SwiftUI
import MapKit

/// One flow screen: an optional map on top, one question, its answer, and persistent actions at the bottom.
struct FlowScreen<Content: View>: View {
    @Environment(AtlasStore.self) private var store
    let title: String
    let question: String
    var note: String? = nil
    var map: AtlasMap? = nil
    var primary: Primary? = nil
    var secondary: Primary? = nil
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    if let map {
                        map.equatable()
                            .frame(maxWidth: .infinity)
                            .frame(height: 300)
                            .clipShape(.rect(bottomLeadingRadius: 22, bottomTrailingRadius: 22, style: .continuous))
                            .padding(.horizontal, -16)
                    }
                    if store.city.districts == 0 {
                        Label(CityCoverageCopy.limitation(city: store.city.name), systemImage: "map")
                            .font(Typo.caption).foregroundStyle(Palette.warning)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("city-boundaries-unavailable")
                    }
                    if store.layersLoading {
                        Label("جار تحميل بعض مؤشرات المدينة…", systemImage: "arrow.triangle.2.circlepath")
                            .font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
                            .accessibilityIdentifier("city-layers-loading")
                    }
                    if let error = store.layersError {
                        RetryNotice(message: error) { store.retryFailedLayers() }
                            .accessibilityIdentifier("city-layers-error")
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text(question).font(Typo.title).foregroundStyle(Tokens.foreground)
                        if let note { Text(note).font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground) }
                    }
                    content()
                }
                .padding(.horizontal, 16).padding(.top, 18).padding(.bottom, secondary == nil ? (primary == nil ? 24 : 112) : 176)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.hidden)
            .accessibilityIdentifier("flow-scroll")
            if primary != nil || secondary != nil {
                VStack(spacing: 8) {
                    if let secondary {
                        Button(secondary.title, action: secondary.action)
                            .buttonStyle(.farqSecondary)
                            .font(Typo.font(15, .semibold))
                            .disabled(!secondary.enabled)
                            .opacity(secondary.enabled ? 1 : 0.45)
                            .accessibilityIdentifier("listing-filter-reset")
                    }
                    if let primary {
                        Button(primary.title, action: primary.action)
                            .buttonStyle(.farqPrimary)
                            .font(Typo.font(16, .bold))
                            .disabled(!primary.enabled)
                            .opacity(primary.enabled ? 1 : 0.45)
                            .accessibilityIdentifier("primary")
                    }
                }
                .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 8)
                .background(Tokens.background.shadow(.drop(color: .black.opacity(0.06), radius: 8, y: -2)))
            }
        }
        .background(Tokens.background.ignoresSafeArea())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct RetryNotice: View {
    let message: String
    let action: () -> Void
    var messageAccessibilityIdentifier: String? = nil

    @ViewBuilder
    private var messageText: some View {
        let label = Text(message).font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground)
        if let messageAccessibilityIdentifier {
            label.accessibilityIdentifier(messageAccessibilityIdentifier)
        } else {
            label
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            messageText
            Button("إعادة المحاولة", action: action)
                .buttonStyle(.farqSecondary)
        }
        .shadCard(tint: Palette.warning)
        .accessibilityElement(children: .contain)
    }
}

/// The one main button of a flow screen.
struct Primary {
    let title: String
    var enabled = true
    let action: () -> Void
    init(_ title: String, enabled: Bool = true, action: @escaping () -> Void) {
        self.title = title; self.enabled = enabled; self.action = action
    }
}

/// A large choice row: a radio mark, a title and an optional line under it.
struct OptionRow: View {
    let title: String
    var subtitle: String? = nil
    var trailing: String? = nil
    let selected: Bool
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(selected ? Palette.brand : Tokens.mutedForeground)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(Typo.font(16, .semibold)).foregroundStyle(Tokens.foreground)
                    if let subtitle { Text(subtitle).font(Typo.caption).foregroundStyle(Tokens.mutedForeground) }
                }
                Spacer()
                if let trailing { Text(trailing).font(Typo.font(14, .semibold)).monospacedDigit().foregroundStyle(Tokens.mutedForeground) }
            }
            .padding(14)
            .background(selected ? Tokens.accent : Tokens.card, in: .rect(cornerRadius: Tokens.radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Tokens.radius, style: .continuous).strokeBorder(selected ? Palette.brand.opacity(0.5) : Tokens.border, lineWidth: selected ? 1.5 : 1))
        }
        .buttonStyle(.farqPress)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A ranked district row that leads to the next screen: rank, name, one plain sentence, and the figure.
struct DistrictRow: View {
    let rank: Int
    let name: String
    let sentence: String
    let figure: String

    var body: some View {
        HStack(spacing: 12) {
            Text(Fmt.int(rank))
                .font(Typo.font(13, .bold)).foregroundStyle(rank == 1 ? .white : Tokens.primaryInk)
                .frame(width: 28, height: 28)
                .background(rank == 1 ? AnyShapeStyle(Palette.brand) : AnyShapeStyle(Tokens.accent), in: .circle)
            VStack(alignment: .leading, spacing: 3) {
                Text(name).font(Typo.font(16, .bold)).foregroundStyle(Tokens.foreground)
                Text(sentence).font(Typo.font(13, .regular)).foregroundStyle(Tokens.mutedForeground).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Text(figure).font(Typo.font(16, .bold)).monospacedDigit().foregroundStyle(Tokens.foreground)
            NextChevron().font(.footnote.weight(.bold)).foregroundStyle(Tokens.mutedForeground)
        }
        .shadCard()
    }
}

/// One figure; tapping it explains how it was worked out.
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

/// The colour key under a shaded map.
struct Legend: View {
    var body: some View {
        Explained(title: "ألوان الخريطة", lines: Explain.shading) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 3) { ForEach(0..<5, id: \.self) { Palette.ramp[$0].frame(height: 8).clipShape(.capsule) } }
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
        .buttonStyle(.plain)
    }
}

/// The score of a district on the olive hero surface.
struct ScoreHero: View {
    let title: String
    let value: Double?
    let score: Double?
    let city: String
    var lines: [String] = Explain.score

    var body: some View {
        Explained(title: title, lines: lines) {
            HStack(spacing: 16) {
                ScoreRing(score: score, size: 72)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(Typo.font(13, .semibold)).foregroundStyle(.white.opacity(0.75))
                    if let value {
                        Text(Fmt.int(value)).font(Typo.font(30, .bold)).monospacedDigit().foregroundStyle(.white)
                    } else {
                        Text(Fmt.unavailable).font(Typo.font(20, .bold)).foregroundStyle(.white.opacity(0.85))
                    }
                    Text(score == nil ? "الدرجة غير متاحة" : "درجة من \(Fmt.int(100)) داخل \(city)")
                        .font(Typo.caption).foregroundStyle(.white.opacity(0.7))
                }
                Spacer()
            }
            .padding(18)
            .background(Palette.hero, in: .rect(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.farqPress)
    }
}

/// Every figure of a district, folded behind «التفاصيل».
struct DistrictDetails: View {
    @Environment(AtlasStore.self) private var store
    let shape: DistrictShape
    var includeBusinessMetrics = true
    @State private var open = false

    var body: some View {
        let row = store.counts[shape.name]
        DisclosureGroup(isExpanded: $open) {
            FigureGrid {
                Figure(label: "السكان", number: row?.population, explain: Explain.population)
                if includeBusinessMetrics {
                    Figure(label: "المنشآت", number: row?.n, explain: Explain.businesses)
                    Figure(label: "ساكن لكل منشأة", number: row?.residents_per, explain: Metric.residentsPerBusiness.explain)
                }
                Figure(label: "السكان لكل كم²", number: row?.density, explain: Explain.density)
                Figure(label: "السعوديون", value: Fmt.percent(store.audience[shape.name]?.saudi_pct), explain: Explain.saudi)
                Figure(label: "الذكور", value: Fmt.percent(store.audience[shape.name]?.male_pct), explain: Explain.sex)
                Figure(label: "متوسط الدخل", number: store.income[shape.name]?.income_all, unit: "ر.س", explain: Explain.income)
                Figure(label: "حصة الفلل", value: Fmt.percent(store.housing[shape.name]?.villa_share_pct), explain: Explain.villaShare)
                Figure(label: "مبانٍ تحت الإنشاء", number: store.growth[shape.name]?.under_construction, explain: Metric.underConstruction.explain)
                if includeBusinessMetrics {
                    Figure(label: "منشآت بواتساب", number: row?.n_whatsapp, explain: Metric.whatsapp.explain)
                    Figure(label: "منشآت الجملة", number: row?.n_wholesale, explain: Metric.wholesale.explain)
                }
                Figure(label: "المساحة", value: Fmt.withUnit(row?.area_km2 ?? shape.areaKm2, "كم²"), explain: ["مساحة الحي من حدوده الرسمية في الأطلس."])
            }
            .padding(.top, 8)
        } label: {
            Text("التفاصيل").font(Typo.headline).foregroundStyle(Tokens.foreground)
        }
        .tint(Palette.brand)
        .shadCard()
    }
}

/// «قارن مع حي آخر»: adds the district and opens the comparison once there are two.
@MainActor func compareAction(_ store: AtlasStore, _ name: String, back: @escaping () -> Void) {
    store.addToCompare(name)
    if store.compare.count >= 2 { store.path.append(Route.compare) } else { back() }
}

struct CityPicker: View {
    @Environment(AtlasStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List(store.cities.filter { query.isEmpty || $0.name.contains(query) || $0.en.localizedCaseInsensitiveContains(query) }) { city in
                Button {
                    dismiss()
                    Task { await store.choose(city: city) }
                } label: {
                    HStack {
                        Text(city.name).font(Typo.body).foregroundStyle(Tokens.foreground)
                        Spacer()
                        if let n = city.districts, n > 0 {
                            Text(Fmt.counted(n, .district)).font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground)
                        } else if city.districts == 0 {
                            Text("الأحياء غير متاحة").font(Typo.caption).foregroundStyle(Palette.warning)
                        }
                        if city == store.city { Image(systemName: "checkmark").foregroundStyle(Palette.brand) }
                    }
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                if store.citiesLoading {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("جارٍ تحميل المدن…").font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground)
                        Spacer()
                    }
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Tokens.background)
                } else if let error = store.citiesError {
                    RetryNotice(message: error) { store.retryCities() }
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(Tokens.background)
                }
            }
            .searchable(text: $query, prompt: "ابحث عن مدينة")
            .navigationTitle("المدينة")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("إغلاق") { dismiss() } } }
        }
        .environment(\.layoutDirection, .rightToLeft)
    }
}
