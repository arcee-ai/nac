import AppKit
import WebKit

/// Separate from the UI-only menu receipt handler. One bridge owns one view,
/// one identified engine and one cancellable sheet; Rust owns project admission.
@MainActor
final class NativePathBridge: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    private let receipt: () -> EngineReceipt?
    private let source: () -> NativeDocumentBinding?
    private let state: NativeCommandState
    private let panel = NativeFolderPanel()
    private var navigation: WKNavigation?
    private var installed = true
    private var sequence = 0
    private var pending: (id: Int, token: UUID)?
    #if PREVIEW_SMOKE
    private var choices = 0
    private var cancellations = 0
    private var selections: [String] = []
    var smokeSnapshot: [String: Any] {
        ["installed": installed, "pending": pending != nil, "choices": choices,
         "cancellations": cancellations, "selections": selections]
    }
    #endif

    init?(webView: WKWebView, receipt: @escaping () -> EngineReceipt?,
          source: @escaping () -> NativeDocumentBinding?) {
        guard let receiptValue = receipt(), let state = NativeCommandState(receipt: receiptValue) else { return nil }
        self.webView = webView
        self.receipt = receipt
        self.source = source
        self.state = state
        super.init()
        let controller = webView.configuration.userContentController
        controller.add(self, contentWorld: .page, name: NativePathScript.handler)
        controller.addUserScript(NativePathScript.userScript)
    }

    func navigationStarted(in candidate: WKWebView, navigation: WKNavigation?) {
        guard candidate === webView else { return }
        self.navigation = navigation
        endDocument()
    }

    func navigationFinished(in candidate: WKWebView, navigation: WKNavigation?) {
        guard installed, candidate === webView, let navigation, navigation === self.navigation,
              state.allows(candidate.url), let binding = state.beginDocument(receipt: receipt()) else { return }
        candidate.callAsyncJavaScript("return window.__nacLocalPaths?.activate(binding) === true",
                                      arguments: ["binding": object(binding)], in: nil, in: .page) { [weak self] result in
            guard let self, self.state.binding == binding else { return }
            if case .success(let value) = result, (value as? Bool) == true { return }
            self.endDocument()
        }
    }

    func retire() {
        guard installed else { return }
        installed = false
        endDocument()
        state.retire()
        panel.retire()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: NativePathScript.handler, contentWorld: .page)
    }

    /// Closing/hiding an intact workspace cancels its sheet without retiring
    /// the document/menu bridge that the lifecycle owner keeps for reopening.
    func cancelPending() {
        let id = pending?.id
        pending = nil
        panel.cancel()
        if let id, let binding = state.binding { settle(binding, id: id, path: nil, error: false) }
    }

    private func endDocument() {
        if let binding = state.binding {
            webView?.callAsyncJavaScript("window.__nacLocalPaths?.retire(binding)",
                                         arguments: ["binding": object(binding)], in: nil, in: .page)
        }
        state.endDocument()
        sequence = 0
        pending = nil
        panel.cancel()
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard installed, let webView, message.webView === webView,
              controller === webView.configuration.userContentController,
              message.name == NativePathScript.handler, message.frameInfo.isMainFrame,
              state.matches(receipt()), state.allows(webView.url),
              let binding = state.binding,
              let body = message.body as? String else { return }
        let origin = message.frameInfo.securityOrigin
        guard origin.protocol == state.origin.scheme, origin.host == state.origin.host,
              origin.port == state.origin.port,
              let request = NativePathRequest.decode(body, binding: binding) else { return }
        switch request {
        case .cancel(let id):
            guard pending?.id == id else { return }
            let token = pending?.token
            pending = nil
            panel.cancel(token)
        case .choose(let id, let path):
            guard id > sequence else { return }
            sequence = id
            #if PREVIEW_SMOKE
            choices += 1
            #endif
            pending = nil
            panel.cancel()
            guard let sourceBinding = source() else { settle(binding, id: id, path: nil, error: true); return }
            guard let window = webView.window, window.isVisible, window.isKeyWindow, NSApp.isActive,
                  !webView.isHidden, window.attachedSheet == nil else {
                settle(binding, id: id, path: nil, error: true); return
            }
            let current = { [weak self] in
                guard let self else { return false }
                return self.installed && self.state.binding == binding && self.state.matches(self.receipt()) &&
                    self.source() == sourceBinding && self.state.allows(self.webView?.url)
            }
            guard let token = panel.choose(in: window, initialPath: path, current: current, completion: { [weak self] path in
                guard let self, current(), self.pending?.id == id else { return }
                self.pending = nil
                #if PREVIEW_SMOKE
                if let path { self.selections = Array((self.selections + [path]).suffix(8)) }
                else { self.cancellations += 1 }
                #endif
                self.settle(binding, id: id, path: path, error: false)
            }) else { settle(binding, id: id, path: nil, error: true); return }
            pending = (id, token)
        }
    }

    private func settle(_ binding: NativeDocumentBinding, id: Int, path: String?, error: Bool) {
        guard installed, state.binding == binding, state.matches(receipt()) else { return }
        webView?.callAsyncJavaScript("return window.__nacLocalPaths?.settle(binding, request, path, error) === true",
                                     arguments: ["binding": object(binding), "request": id,
                                                 "path": path as Any? ?? NSNull(), "error": error], in: nil, in: .page)
    }

    private func object(_ binding: NativeDocumentBinding) -> [String: Any] {
        ["launch": binding.launch, "view": binding.view, "document": binding.document]
    }
}
