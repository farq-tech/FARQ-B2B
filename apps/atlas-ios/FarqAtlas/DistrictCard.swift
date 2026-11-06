import SwiftUI
import Pow

/// The district summary on tap: the lens score first, then every figure once; missing figures read «غير متاح».
struct DistrictCard: View {
    @Environment(AtlasStore.self) private var store
    let shape: DistrictShape
    @State private var profile: DistrictProfile?
    @State private var failed = false

    private var row: DistrictCounts? { store.counts[shape.name] }
    private var loadingProfile: Bool { profile == nil && !failed }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("حي").font(Typo.font(13, .semibold)).foregroundStyle(Tokens.mutedForeground)
                    Text(shape.name).font(Typo.largeTitle).foregroundStyle(Tokens.foreground)
                        .contentTransition(.opacity)
                }
                Spacer()
                Button { withAnimation(Motion.slide) { store.select(nil) } } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Tokens.mutedForeground)
                        .frame(width: 36, height: 36)
                        .background(Tokens.muted, in: .circle)
                }
                .buttonStyle(.farqPress)
                .accessibilityLabel("إلغاء التحديد")
            }
            score
            FigureGrid {
                Figure(label: "السكان", number: row?.population ?? profile?.population, explain: Explain.population)
                Figure(label: "المنشآت", number: row?.n ?? profile?.businesses, explain: Explain.businesses)
                if store.lens.usesActivity, let activity = store.activity {
                    Figure(label: "منشآت \(activity.main_ar)", number: store.activityCounts[shape.name]?.n, explain: Metric.activityBusinesses.explain)
                    Figure(label: "فرص التوسع", number: store.gaps[shape.name]?.shortfall, explain: Explain.gap)
                }
                Figure(label: "ساكن لكل منشأة", number: row?.residents_per, explain: Metric.residentsPerBusiness.explain)
                Figure(label: "السكان لكل كم²", number: row?.density, explain: Explain.density)
                if store.lens != .distributors {
                    Figure(label: "ذكور · إناث", value: sexSplit, explain: Explain.sex)
                    Figure(label: "السعوديون", value: Fmt.percent(profile?.saudi_pct ?? store.audience[shape.name]?.saudi_pct), explain: Explain.saudi)
                    Figure(label: "متوسط الدخل", number: store.income[shape.name]?.income_all, unit: "ر.س", explain: Explain.income)
                    Figure(label: "حصة الفلل", value: Fmt.percent(store.housing[shape.name]?.villa_share_pct), explain: Explain.villaShare)
                }
                if store.lens != .marketers {
                    Figure(label: "مبانٍ تحت الإنشاء", number: store.growth[shape.name]?.under_construction ?? profile?.growth?.under_construction, explain: Metric.underConstruction.explain)
                }
                Figure(label: "منشآت بواتساب", number: row?.n_whatsapp ?? profile?.whatsapp, explain: Metric.whatsapp.explain)
                Figure(label: "منشآت الجملة", number: row?.n_wholesale ?? profile?.wholesale, explain: Metric.wholesale.explain)
                Figure(label: "المساحة", value: Fmt.withUnit(row?.area_km2 ?? shape.areaKm2, "كم²"), explain: ["مساحة الحي من حدوده الرسمية في الأطلس."])
                if store.lens == .marketers {
                    Figure(label: "أكبر شريحة عمرية", value: topAge, explain: Explain.topAge, badge: topAge == Fmt.unavailable ? nil : "تقدير")
                }
            }
            if let rows = profile?.main_activities, !rows.isEmpty {
                ActivityList(rows: Array(rows.prefix(6)))
                    .transition(.movingParts.move(edge: .bottom).combined(with: .opacity))
            } else if loadingProfile {
                SkeletonLoader().frame(height: 220)
            }
            if failed { Text("تعذر تحميل تفاصيل الحي.").font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground) }
            let inCompare = store.compare.contains { $0.id == shape.id }
            HStack(spacing: 10) {
                Button { withAnimation(Motion.bouncy) { store.toggleCompare(shape) } } label: {
                    Label(inCompare ? "أزل من المقارنة" : "أضف للمقارنة", systemImage: inCompare ? "minus.circle.fill" : "plus.circle.fill")
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(.farqSecondary)
                .disabled(!inCompare && store.compare.count >= 4)
                .changeEffect(.spray(origin: UnitPoint(x: 0.5, y: 0.2)) { Image(systemName: "plus").foregroundStyle(Palette.accent) }, value: store.compare.count, isEnabled: inCompare)
                if store.compare.count >= 2 {
                    NavigationLink(value: Route.compare) { Label("قارن (\(Fmt.int(store.compare.count)))", systemImage: "square.split.2x1.fill") }
                        .buttonStyle(.farqPrimary)
                        .transition(.movingParts.pop(Palette.brand))
                }
            }
            .font(Typo.font(15, .semibold))
            .animation(Motion.bouncy, value: store.compare.count)
        }
        .animation(Motion.reveal, value: profile == nil)
        .task(id: shape.id) {
            profile = nil
            failed = false
            do { profile = try await AtlasAPI.shared.profile(city: store.city.en, district: shape.name) }
            catch { failed = true }
        }
    }

    /// The lens metric as a score out of 100 within the city, on the olive hero surface.
    private var score: some View {
        let metric = store.metric
        let value = store.value(metric, shape.name)
        let points = Quintiles.score(value, among: Array(store.values(metric).values))
        return Explained(title: "الدرجة", lines: metric.explain + Explain.score) {
            HStack(alignment: .center, spacing: 16) {
                ScoreRing(score: points, size: 74)
                VStack(alignment: .leading, spacing: 4) {
                    Text(metric.label).font(Typo.font(13, .semibold)).foregroundStyle(.white.opacity(0.75))
                    if let value {
                        Odometer(value: value.rounded(), format: englishNumber, showsDelta: false,
                                 style: OdometerStyle(up: Palette.mint, down: Color(hex: 0xFFB4A8), ink: .white, muted: .white.opacity(0.6)))
                            .font(Typo.font(30, .bold))
                            .environment(\.layoutDirection, .leftToRight)
                    } else {
                        Text(Fmt.unavailable).font(Typo.font(20, .bold)).foregroundStyle(.white.opacity(0.85))
                    }
                    Text(points == nil ? "الدرجة غير متاحة" : "درجة من \(Fmt.int(100)) داخل \(store.city.name)")
                        .font(Typo.caption).foregroundStyle(.white.opacity(0.7))
                }
                Spacer()
            }
            .padding(18)
            .background(Palette.hero, in: .rect(cornerRadius: 20, style: .continuous))
            .shadow(color: Palette.brand.opacity(0.35), radius: 16, y: 8)
            .shineOnChange(shape.id)
        }
        .buttonStyle(.farqPress)
    }

    private var sexSplit: String {
        guard let m = profile?.male, let f = profile?.female, m + f > 0 else { return Fmt.unavailable }
        return "\(Fmt.percent(100 * m / (m + f))) · \(Fmt.percent(100 * f / (m + f)))"
    }

    private var topAge: String {
        guard let top = profile?.ages?.max(by: { $0.total < $1.total }) else { return Fmt.unavailable }
        return Fmt.ltr(top.age_group)
    }
}
