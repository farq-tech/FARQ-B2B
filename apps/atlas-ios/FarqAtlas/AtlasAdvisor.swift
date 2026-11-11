import SwiftUI

enum AtlasAdvisorMode: String {
    case branch
    case audience
    case distribution
    case analysis
    case realEstate = "real_estate"

    var title: String {
        switch self {
        case .branch: return "مستشار فتح الفرع"
        case .audience: return "مستشار الجمهور"
        case .distribution: return "مستشار التوزيع"
        case .analysis: return "مستشار التحليل"
        case .realEstate: return "مستشار العقار"
        }
    }

    var prompt: String {
        switch self {
        case .branch: return "ما فكرة الفرع أو ميزانيتك؟"
        case .audience: return "ما النتيجة التي تريدها من حملتك؟"
        case .distribution: return "ما الذي تريد تحسينه في توزيع المندوبين؟"
        case .analysis: return "ما السؤال الذي تريد أن تجيب عنه الأرقام؟"
        case .realEstate: return "من سيستخدم العقار، وما أهم شرط لك؟"
        }
    }
}

struct AtlasAdvisorTurn: Codable, Equatable {
    let role: String
    let content: String
}

enum AtlasAdvisorFacts {
    private static let maximumLength = 7_500
    private static let truncationNote = "تنبيه: أُسقطت بقية الأسطر لأن حجم السياق بلغ الحد."

    static func number(_ value: Double?, unit: String = "") -> String {
        guard let value, value.isFinite else { return Fmt.unavailable }
        return unit.isEmpty ? Fmt.int(value) : Fmt.withUnit(value, unit)
    }

    static func block(_ lines: [String]) -> String {
        var included: [String] = []
        var length = 0
        for line in lines {
            let nextLength = length + (included.isEmpty ? 0 : 1) + line.utf16.count
            guard nextLength <= maximumLength else { break }
            included.append(line)
            length = nextLength
        }
        guard included.count < lines.count else { return included.joined(separator: "\n") }
        while let last = included.last, length + 1 + truncationNote.utf16.count > maximumLength {
            let previousCount = included.count
            included.removeLast()
            length -= last.utf16.count + (previousCount > 1 ? 1 : 0)
        }
        return (included + [truncationNote]).joined(separator: "\n")
    }
}

struct AtlasPathAdvisor: View {
    let mode: AtlasAdvisorMode
    let facts: String

    @State private var isPresented = false

    var body: some View {
        Button { isPresented = true } label: {
            HStack(spacing: 10) {
                Image(systemName: "sparkles")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Palette.brand)
                VStack(alignment: .leading, spacing: 3) {
                    Text("حسّن قرارك مع المستشار")
                        .font(Typo.font(15, .bold)).foregroundStyle(Tokens.foreground)
                    Text("اقتراح مرتبط ببيانات هذا المسار")
                        .font(Typo.caption).foregroundStyle(Tokens.mutedForeground)
                }
                Spacer(minLength: 8)
                NextChevron().foregroundStyle(Tokens.mutedForeground)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Tokens.card, in: .rect(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Tokens.border))
        }
        .buttonStyle(.farqPress)
        .accessibilityIdentifier("advisor-open-\(mode.rawValue)")
        .sheet(isPresented: $isPresented) {
            NavigationStack {
                AtlasPathAdvisorSheet(mode: mode, facts: facts)
                    .navigationTitle(mode.title)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("إغلاق") { isPresented = false }
                                .accessibilityIdentifier("advisor-close")
                        }
                    }
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }
}

private struct AtlasPathAdvisorSheet: View {
    private enum Phase: Equatable { case ready, loading, conversation, login, loginError, denied, error }

    let mode: AtlasAdvisorMode
    let facts: String

    @State private var profile = ""
    @State private var turns: [AtlasAdvisorTurn] = []
    @State private var draft = ""
    @State private var phase: Phase = .ready
    @State private var message = ""
    @State private var email = ""
    @State private var password = ""
    @FocusState private var focusedField: Field?

    private enum Field { case profile, draft, email, password }

    var body: some View {
        ScrollViewReader { reader in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("يمكنك البدء من بيانات هذا المسار مباشرة، أو إضافة ما يهمك لتخصيص الاقتراح. لا يرسل المستشار رسائل أو ينفذ إجراءً عنك.")
                        .font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)

                    switch phase {
                    case .ready:
                        profileForm
                    case .loading:
                        if turns.isEmpty {
                            ProgressView("يراجع بيانات المسار…")
                                .frame(maxWidth: .infinity, minHeight: 90)
                        } else {
                            conversation(reader: reader)
                        }
                    case .conversation:
                        conversation(reader: reader)
                    case .login, .loginError:
                        signInForm
                    case .denied:
                        Text(message).font(Typo.subheadline).foregroundStyle(Palette.warning)
                    case .error:
                        if turns.isEmpty {
                            VStack(alignment: .leading, spacing: 10) {
                                Text(message).font(Typo.subheadline).foregroundStyle(Palette.warning)
                                Button("أعد المحاولة") { Task { await ask(turns) } }
                                    .buttonStyle(.farqSecondary)
                            }
                        } else {
                            conversation(reader: reader)
                        }
                    }
                }
                .padding(18)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Tokens.background.ignoresSafeArea())
        .accessibilityIdentifier("advisor-sheet-\(mode.rawValue)")
    }

    private var profileForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("تفاصيل تساعد على تخصيص الاقتراح (اختياري)")
                .font(Typo.font(16, .semibold)).foregroundStyle(Tokens.foreground)
            TextField(mode.prompt, text: $profile, axis: .vertical)
                .lineLimit(2...5)
                .focused($focusedField, equals: .profile)
                .padding(12)
                .background(Tokens.card, in: .rect(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Tokens.border))
                .accessibilityIdentifier("advisor-profile")
            Button {
                focusedField = nil
                Task { await ask([]) }
            } label: {
                Label(profile.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "اقترح من بيانات المسار" : "اطلب اقتراحاً", systemImage: "sparkles")
                    .font(Typo.font(15, .bold))
                    .frame(maxWidth: .infinity, minHeight: 46)
            }
            .buttonStyle(.farqPrimary)
            .accessibilityIdentifier("advisor-submit")
        }
    }

    private var signInForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(message).font(Typo.subheadline).foregroundStyle(Tokens.mutedForeground)
            TextField("البريد الإلكتروني", text: $email)
                .textContentType(.username).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                .focused($focusedField, equals: .email)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("advisor-login-email")
            SecureField("كلمة المرور", text: $password)
                .textContentType(.password)
                .focused($focusedField, equals: .password)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("advisor-login-password")
            if phase == .loginError {
                Text(message).font(Typo.caption).foregroundStyle(Palette.warning)
            }
            Button {
                Task { await signInAndRetry() }
            } label: {
                Label(phase == .loading ? "جار تسجيل الدخول…" : "دخول ومتابعة", systemImage: "person.crop.circle")
                    .font(Typo.font(15, .bold)).frame(maxWidth: .infinity, minHeight: 46)
            }
            .buttonStyle(.farqPrimary)
            .disabled(phase == .loading || email.isEmpty || password.isEmpty)
            .accessibilityIdentifier("advisor-login-submit")
        }
    }

    private func conversation(reader: ScrollViewProxy) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(turns.enumerated()), id: \.offset) { index, turn in
                Text(turn.content)
                    .font(Typo.body)
                    .foregroundStyle(turn.role == "assistant" ? Tokens.foreground : Tokens.primaryInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(turn.role == "assistant" ? Tokens.card : Tokens.accent, in: .rect(cornerRadius: 14, style: .continuous))
                    .id(index)
            }
            HStack(spacing: 8) {
                TextField("اسأل عن هذا المسار", text: $draft, axis: .vertical)
                    .lineLimit(1...3)
                    .focused($focusedField, equals: .draft)
                    .padding(10)
                    .background(Tokens.card, in: .rect(cornerRadius: 10, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Tokens.border))
                    .accessibilityIdentifier("advisor-followup")
                Button {
                    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !text.isEmpty else { return }
                    draft = ""
                    turns.append(AtlasAdvisorTurn(role: "user", content: text))
                    Task { await ask(turns) }
                } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 30)).foregroundStyle(Palette.brand)
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || phase == .loading)
                .accessibilityLabel("أرسل")
                .accessibilityIdentifier("advisor-followup-send")
            }
            if phase == .loading { ProgressView("يجهّز الرد…") }
            if phase == .error {
                VStack(alignment: .leading, spacing: 8) {
                    Text(message).font(Typo.caption).foregroundStyle(Palette.warning)
                    Button("أعد المحاولة") { Task { await ask(turns) } }
                        .buttonStyle(.farqSecondary)
                        .accessibilityIdentifier("advisor-followup-retry")
                }
            }
        }
        .onChange(of: turns.count) { _, _ in
            guard let last = turns.indices.last else { return }
            withAnimation { reader.scrollTo(last, anchor: .bottom) }
        }
        .accessibilityIdentifier("advisor-conversation")
    }

    @MainActor
    private func ask(_ requestTurns: [AtlasAdvisorTurn]) async {
        phase = .loading
        message = ""
        do {
            let reply = try await AtlasAPI.shared.advise(mode: mode, facts: facts, profile: profile, turns: requestTurns)
            turns = requestTurns + [AtlasAdvisorTurn(role: "assistant", content: reply)]
            phase = .conversation
        } catch APIError.advisorAuthenticationRequired {
            message = "سجّل الدخول إلى أطلس لاستخدام المستشار."
            phase = .login
        } catch APIError.authorizationRequired {
            message = "حسابك غير مخول لاستخدام المستشار."
            phase = .denied
        } catch {
            message = error.localizedDescription
            phase = .error
        }
    }

    @MainActor
    private func signInAndRetry() async {
        phase = .loading
        message = ""
        do {
            try await AtlasAPI.shared.signIn(email: email, password: password)
            password = ""
            await ask(turns)
        } catch {
            message = error.localizedDescription
            phase = .loginError
        }
    }
}
