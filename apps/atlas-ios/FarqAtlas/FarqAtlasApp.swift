import SwiftUI
import UIKit

@main
struct FarqAtlasApp: App {
    @State private var store = AtlasStore()

    init() {
        // Match UIKit-backed controls to the bundled Farq Huwiya typography too.
        let regular = UIFont(name: "itfHuwiyaArabic-Medium", size: 13) ?? .systemFont(ofSize: 13)
        let bold = UIFont(name: "itfHuwiyaArabic-Bold", size: 13) ?? .boldSystemFont(ofSize: 13)
        UISegmentedControl.appearance().setTitleTextAttributes([.font: regular], for: .normal)
        UISegmentedControl.appearance().setTitleTextAttributes([.font: bold], for: .selected)
        let title = UIFont(name: "itfHuwiyaArabic-Medium", size: 17) ?? .boldSystemFont(ofSize: 17)
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
