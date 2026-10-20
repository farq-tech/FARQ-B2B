import SwiftUI
import WebKit

@main
struct FarqB2BApp: App {
    var body: some Scene {
        WindowGroup { FarqWebView() }
    }
}

private struct FarqWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.websiteDataStore = .default()

        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.isOpaque = false
        view.backgroundColor = .systemBackground
        view.scrollView.backgroundColor = .systemBackground
        view.load(URLRequest(url: Self.appURL, cachePolicy: .reloadRevalidatingCacheData))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) { }

    private static let appURL = URL(string: "https://farq-pricing-production.up.railway.app/opportunity-map")!

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            showRetryPage(in: webView)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            showRetryPage(in: webView)
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
            if ["tel", "mailto"].contains(url.scheme), UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url)
                return decisionHandler(.cancel)
            }
            decisionHandler(.allow)
        }

        private func showRetryPage(in webView: WKWebView) {
            let html = """
            <!doctype html><html dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#f7f8f6;color:#1d2a26;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:grid;min-height:100vh;place-items:center;text-align:center}.card{max-width:300px;padding:32px}h1{font-size:25px;margin:0 0 12px}p{line-height:1.65;color:#5e6a66}button{border:0;border-radius:14px;background:#087e69;color:white;padding:13px 24px;font-weight:700;font-size:16px}</style></head><body><main class="card"><h1>تعذّر فتح فرق للأعمال</h1><p>تحقق من اتصال الإنترنت ثم أعد المحاولة.</p><button onclick="window.webkit.messageHandlers.retry.postMessage('retry')">إعادة المحاولة</button></main></body></html>
            """
            let controller = webView.configuration.userContentController
            controller.removeScriptMessageHandler(forName: "retry")
            controller.add(RetryHandler { [weak webView] in
                webView?.load(URLRequest(url: FarqWebView.appURL, cachePolicy: .reloadRevalidatingCacheData))
            }, name: "retry")
            webView.loadHTMLString(html, baseURL: nil)
        }
    }
}

private final class RetryHandler: NSObject, WKScriptMessageHandler {
    private let retry: () -> Void
    init(retry: @escaping () -> Void) { self.retry = retry }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) { retry() }
}
