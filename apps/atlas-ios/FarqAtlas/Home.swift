import SwiftUI

/// The app's root: one question, five ways in (docs/atlas-ios-flows.md).
struct RootView: View {
    @Environment(AtlasStore.self) private var store

    var body: some View {
        @Bindable var store = store
        NavigationStack(path: $store.path) {
            HomeView()
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .ownerActivity: OwnerActivityView()
                    case .ownerDistricts: OwnerDistrictsView()
                    case .ownerDistrict(let name): OwnerDistrictView(name: name)
                    case .marketerAudience: MarketerAudienceView()
                    case .marketerDistricts: MarketerDistrictsView()
                    case .marketerDistrict(let name): MarketerDistrictView(name: name)
                    case .distributorSetup: DistributorSetupView()
                    case .distributorRegions: DistributorRegionsView()
                    case .distributorRegion(let id): DistributorRegionView(id: id)
                    case .analystTable: AnalystTableView()
                    case .compare: CompareView()
                    case .realEstateKind: RealEstateKindView()
                    case .realEstateDeals: RealEstateDealsView()
                    case .listing(let listing): ListingDetail(listing: listing)
                    }
                }
        }
        .task { await store.start() }
    }
}

struct HomeView: View {
    @Environment(AtlasStore.self) private var store
    @State private var pickingCity = false

    private struct Way: Identifiable {
        let id: Route
        let title: String
        let line: String
        let symbol: String
    }

    private let ways: [Way] = [
        Way(id: .ownerActivity, title: "أفتح فرعاً", line: "أين يحتاجك الناس أكثر؟", symbol: "storefront.fill"),
        Way(id: .marketerAudience, title: "أصل لجمهوري", line: "أين يسكن جمهورك؟", symbol: "megaphone.fill"),
        Way(id: .distributorSetup, title: "أوزّع على مندوبيني", line: "قسّم المدينة بينهم بالعدل", symbol: "shippingbox.fill"),
        Way(id: .analystTable, title: "أقارن الأحياء", line: "أرقام موثوقة جنباً إلى جنب", symbol: "chart.bar.xaxis"),
        Way(id: .realEstateKind, title: "أدوّر عقاراً", line: "أفضل الفرص اليوم", symbol: "house.fill"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Button { pickingCity = true } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "mappin.and.ellipse")
                        Text(store.city.name).font(Typo.headline)
                        Image(systemName: "chevron.down").font(.caption.weight(.bold))
                    }
                    .foregroundStyle(Tokens.primaryInk)
                    .padding(.horizontal, 14).frame(height: 40)
                    .background(Tokens.accent, in: .capsule)
                }
                .buttonStyle(.farqPress)
                .accessibilityLabel("المدينة: \(store.city.name)")

                Text("وش تبي تسوي اليوم؟")
                    .font(Typo.font(30, .bold))
                    .foregroundStyle(Tokens.foreground)

                VStack(spacing: 12) {
                    ForEach(ways) { way in
                        Button { store.path.append(way.id) } label: {
                            HStack(spacing: 14) {
                                Image(systemName: way.symbol)
                                    .font(.system(size: 22, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .frame(width: 54, height: 54)
                                    .background(Palette.hero, in: .rect(cornerRadius: 16, style: .continuous))
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(way.title).font(Typo.font(19, .bold)).foregroundStyle(Tokens.foreground)
                                    Text(way.line).font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground)
                                }
                                Spacer()
                                NextChevron().font(.body.weight(.bold)).foregroundStyle(Tokens.mutedForeground)
                            }
                            .padding(16)
                            .background(Tokens.card, in: .rect(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Tokens.border, lineWidth: 1))
                            .shadow(color: .black.opacity(0.04), radius: 6, y: 2)
                        }
                        .buttonStyle(.farqPress)
                        .accessibilityIdentifier("way-\(way.title)")
                    }
                }

                if let error = store.error {
                    HStack {
                        Text(error).font(Typo.subheadline)
                        Spacer()
                        Button("إعادة المحاولة") { Task { await store.load() } }.font(Typo.font(14, .bold))
                    }
                    .shadCard(tint: Palette.warning)
                } else if store.loading {
                    HStack(spacing: 8) { ProgressView(); Text("جارٍ تحميل \(store.city.name)…").font(Typo.subheadline) }
                        .foregroundStyle(Tokens.mutedForeground)
                } else if let total = store.summary?.total {
                    Text("في \(store.city.name): \(Fmt.int(total)) منشأة في \(Fmt.counted(store.shapes.count, .district))")
                        .font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground)
                }
            }
            .padding(.horizontal, 18).padding(.top, 12).padding(.bottom, 30)
        }
        .background(FarqWash())
        .navigationTitle("فرق أطلس")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $pickingCity) { CityPicker() }
    }
}
