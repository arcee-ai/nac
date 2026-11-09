#if PREVIEW_SMOKE && !LOCAL_APP
import Foundation
import WebKit

/// Bridge-free acquisition control. The product and probe share the exact store;
/// the baseline uses a different store and is never promoted into the product.
@MainActor
final class OfflineWebProbe: NSObject, WKNavigationDelegate {
    let view: WKWebView
    private var expected: WKNavigation?
    private var settled = false
    private var status = -1
    private var timedOut = false

    init(store: WKWebsiteDataStore) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = store
        view = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        view.navigationDelegate = self
    }

    func close() { expected = nil; view.stopLoading(); view.navigationDelegate = nil }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if navigation === expected { settled = true }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if navigation === expected { timedOut = (error as? URLError)?.code == .timedOut; settled = true }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if navigation === expected { timedOut = (error as? URLError)?.code == .timedOut; settled = true }
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        status = (response.response as? HTTPURLResponse)?.statusCode ?? -1
        decisionHandler(.allow)
    }

    private func settle() async throws {
        let end = ProcessInfo.processInfo.systemUptime + 8
        while !settled, ProcessInfo.processInfo.systemUptime < end {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        guard settled, !timedOut else { throw OfflineProviderPolicy.Refusal.missingObservation }
    }

    func navigate(_ url: URL) async throws -> Int {
        settled = false; status = -1; timedOut = false
        expected = view.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5))
        guard expected != nil else { throw OfflineProviderPolicy.Refusal.invalid }
        try await settle()
        return status
    }

    func fetch(_ url: URL, base: URL) async throws -> [String: Any] {
        // No product CSP, script-message handler, native bridge or URL interpolation.
        settled = false; status = -1; timedOut = false
        expected = view.loadHTMLString("<!doctype html><title>Owned offline control</title>", baseURL: base)
        guard expected != nil else { throw OfflineProviderPolicy.Refusal.invalid }
        try await settle()
        let result = try await view.callAsyncJavaScript(#"""
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),5000);
        try {
          const response=await fetch(target,{cache:'no-store',signal:controller.signal});
          let nonce=null;
          try { nonce=(await response.json()).nonce ?? null; } catch {}
          return {status:response.status,nonce};
        } catch { return {status:-1,aborted:controller.signal.aborted}; }
        finally { clearTimeout(timer); }
        """#, arguments: ["target": url.absoluteString], in: nil, contentWorld: .page)
        guard let facts = result as? [String: Any], facts["aborted"] as? Bool != true else { throw OfflineProviderPolicy.Refusal.invalid }
        return facts
    }
}
#endif
