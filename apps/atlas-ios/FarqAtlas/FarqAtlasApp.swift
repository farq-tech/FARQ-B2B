import SwiftUI
import UIKit

@main
struct FarqAtlasApp: App {
    @State private var store = AtlasStore()

    init() {
        // UIKit-backed controls (segmented pickers, navigation titles) in IBM Plex Sans Arabic too
        let regular = UIFont(name: "IBMPlexSansArabic-Medium", size: 13) ?? .systemFont(ofSize: 13)
        let bold = UIFont(name: "IBMPlexSansArabic-SemiBold", size: 13) ?? .boldSystemFont(ofSize: 13)
        UISegmentedControl.appearance().setTitleTextAttributes([.font: regular], for: .normal)
        UISegmentedControl.appearance().setTitleTextAttributes([.font: bold], for: .selected)
        let title = UIFont(name: "IBMPlexSansArabic-SemiBold", size: 17) ?? .boldSystemFont(ofSize: 17)
        UINavigationBar.appearance().titleTextAttributes = [.font: title]
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(\.layoutDirection, .rightToLeft)
                .environment(\.locale, Locale(identifier: "ar@numbers=latn"))
                .font(Typo.body)
                .tint(Palette.brand)
        }
    }
}
