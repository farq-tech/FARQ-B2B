import SwiftUI

// Motion shared by the screens; the controls themselves come from the libraries in Kit.swift.

enum Motion {
    static let press = Animation.spring(response: 0.25, dampingFraction: 0.6)
    static let slide = Animation.spring(response: 0.42, dampingFraction: 0.78)
    static let bouncy = Animation.spring(response: 0.5, dampingFraction: 0.62)
    static let reveal = Animation.spring(response: 0.6, dampingFraction: 0.82)
}

// MARK: - Motion helpers

/// Cards rise into place one after another.
struct Rise: ViewModifier {
    let index: Int
    @State private var shown = false
    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 14)
            .scaleEffect(shown ? 1 : 0.97, anchor: .top)
            .onAppear { withAnimation(Motion.reveal.delay(Double(min(index, 10)) * 0.04)) { shown = true } }
    }
}

extension View {
    func rise(_ index: Int = 0) -> some View { modifier(Rise(index: index)) }
    /// Figures roll digit by digit when they change.
    func rollingNumber(_ key: String) -> some View {
        contentTransition(.numericText()).animation(Motion.slide, value: key)
    }
}

/// A score ring that sweeps to its value with a spring and a glowing tip.
struct ScoreRing: View {
    let score: Double?
    var size: CGFloat = 70
    @State private var shown: Double = 0

    var body: some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.18), lineWidth: 8)
            Circle()
                .trim(from: 0, to: shown / 100)
                .stroke(AngularGradient(colors: [Palette.mint, .white], center: .center), style: StrokeStyle(lineWidth: 8, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .shadow(color: Palette.mint.opacity(0.6), radius: 6)
            Text(score.map { Fmt.int($0) } ?? "—")
                .font(Typo.font(22, .bold)).monospacedDigit()
                .foregroundStyle(.white)
                .contentTransition(.numericText())
        }
        .frame(width: size, height: size)
        .onAppear { withAnimation(Motion.reveal.delay(0.15)) { shown = score ?? 0 } }
        .onChange(of: score) { _, new in withAnimation(Motion.reveal) { shown = new ?? 0 } }
    }
}
