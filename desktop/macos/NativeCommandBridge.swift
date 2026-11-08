import AppKit
import WebKit

/// One bridge belongs to one actual WKWebView, one verified launch and its
/// successive documents. Nothing received from JavaScript invokes an action.
@MainActor
final class NativeCommandBridge: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    private let receipt: () -> EngineReceipt?
    private let state: NativeCommandState
    private var installed = true
    private var navigation: WKNavigation?
    #if PREVIEW_SMOKE
    private var acceptedReceipts = 0
    private var rejectedReceipts = 0
    private var dispatches = 0
    var smokeSnapshot: [String: Any] {
        ["installed": installed, "ready": state.ready, "available": available,
         "binding": state.binding.map { object($0) } ?? [:], "request": state.smokeRequest,
         "accepted": acceptedReceipts, "rejected": rejectedReceipts, "dispatches": dispatches]
    }
    #endif

    init?(webView: WKWebView, receipt: @escaping () -> EngineReceipt?) {
        guard let current = receipt(), let state = NativeCommandState(receipt: current) else { return nil }
        self.webView = webView
        self.receipt = receipt
        self.state = state
        super.init()
        let controller = webView.configuration.userContentController
        controller.add(self, contentWorld: .page, name: NativeCommandScript.handler)
        controller.addUserScript(NativeCommandScript.userScript)
    }

    var available: Bool {
        installed && state.ready && state.matches(receipt()) && focused
    }

    private var focused: Bool {
        guard let webView, let window = webView.window, NSApp.isActive, window.isKeyWindow,
              let responder = window.firstResponder as? NSView else { return false }
        return responder === webView || responder.isDescendant(of: webView)
    }

    func allows(_ action: WKNavigationAction, in candidate: WKWebView) -> Bool {
        installed && candidate === webView && state.matches(receipt()) &&
            action.sourceFrame.isMainFrame && action.targetFrame?.isMainFrame == true &&
            !action.shouldPerformDownload && state.allows(action.request.url)
    }

    func navigationStarted(in candidate: WKWebView, navigation: WKNavigation?) {
        guard candidate === webView else { return }
        self.navigation = navigation
        state.endDocument()
    }

    func navigationFinished(in candidate: WKWebView, navigation: WKNavigation?) {
        guard installed, candidate === webView, let navigation, navigation === self.navigation, state.allows(candidate.url),
              let binding = state.beginDocument(receipt: receipt()) else { return }
        call("return window.__nacDesktop?.activate(binding) === true", arguments: ["binding": object(binding)], binding: binding)
    }

    @discardableResult
    func send(_ action: NativeUIAction) -> Bool {
        guard available, let binding = state.binding,
              let request = state.issue(action, receipt: receipt()) else { return false }
        #if PREVIEW_SMOKE
        dispatches += 1
        #endif
        call("return window.__nacDesktop?.dispatch(binding, request) === true",
             arguments: ["binding": object(binding), "request": object(request)], binding: binding)
        return true
    }

    func retire() {
        guard installed else { return }
        installed = false
        navigation = nil
        if let webView, let binding = state.binding {
            webView.callAsyncJavaScript("window.__nacDesktop?.retire(binding)",
                                        arguments: ["binding": object(binding)], in: nil, in: .page)
        }
        state.retire()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: NativeCommandScript.handler, contentWorld: .page)
        // This bridge must be installed before its view's first load. It does
        // not remove other owners' user scripts or reuse a retired WebView.
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard installed, let webView, message.webView === webView,
              userContentController === webView.configuration.userContentController,
              message.name == NativeCommandScript.handler, let body = message.body as? String else {
            #if PREVIEW_SMOKE
            rejectedReceipts += 1
            #endif
            return
        }
        let source = message.frameInfo.securityOrigin
        var components = URLComponents()
        components.scheme = source.protocol
        components.host = source.host
        components.port = source.port
        let accepted = state.receive(body, origin: components.url, mainFrame: message.frameInfo.isMainFrame,
                                     currentView: message.webView === webView, receipt: receipt())
        #if PREVIEW_SMOKE
        if accepted { acceptedReceipts += 1 } else { rejectedReceipts += 1 }
        #else
        _ = accepted
        #endif
    }

    private func call(_ script: String, arguments: [String: Any], binding: NativeDocumentBinding) {
        webView?.callAsyncJavaScript(script, arguments: arguments, in: nil, in: .page) { [weak self] result in
            guard let self, self.installed, self.state.binding == binding,
                  self.state.matches(self.receipt()) else { return }
            // Late failures may retire only the document which issued them.
            if case .failure = result { self.state.endDocument() }
            else if case .success(let value) = result, (value as? Bool) != true { self.state.endDocument() }
        }
    }

    private func object<T: Encodable>(_ value: T) -> [String: Any] {
        // Only fixed shell-owned Codable DTOs reach WebKit argument serialization.
        (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(value))) as? [String: Any] ?? [:]
    }
}
