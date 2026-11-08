import AppKit
import WebKit

/// One bridge belongs to one actual WKWebView, one verified launch and its
/// successive documents. Nothing received from JavaScript invokes an action.
@MainActor
final class NativeCommandBridge: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    private let receipt: () -> EngineReceipt?
    private let state: NativeCommandState
    private let connectionLost: (() -> Void)?
    private let targetReady: (() -> Void)?
    private let target = NativeSessionTarget()
    private let profile: String?
    private var visible = true
    private var storage: WorkspaceStorageBridge?
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

    init?(webView: WKWebView, receipt: @escaping () -> EngineReceipt?, connectionLost: (() -> Void)? = nil,
          workspaceStorage: WorkspaceStorage? = nil, targetReady: (() -> Void)? = nil) {
        guard let current = receipt(), let state = NativeCommandState(receipt: current) else { return nil }
        self.webView = webView
        self.receipt = receipt
        self.state = state
        self.connectionLost = connectionLost
        self.targetReady = targetReady
        self.profile = workspaceStorage?.profile.digest
        super.init()
        let controller = webView.configuration.userContentController
        controller.add(self, contentWorld: .page, name: NativeCommandScript.handler)
        controller.addUserScript(NativeCommandScript.userScript)
        if let workspaceStorage {
            storage = WorkspaceStorageBridge(webView: webView, storage: workspaceStorage) { [weak self] in
                guard let self else { return false }
                return self.installed && self.state.matches(self.receipt())
            }
            controller.add(self, contentWorld: .page, name: WorkspaceStorageScript.handler)
            controller.addUserScript(WorkspaceStorageScript.userScript)
        }
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

    /// Read-only eligibility for focused shell adapters. It grants no operation
    /// authority and becomes false while a document loads or this launch retires.
    func currentDocument(in candidate: WKWebView) -> NativeDocumentBinding? {
        guard installed, candidate === webView, state.matches(receipt()),
              state.ready, state.allows(candidate.url) else { return nil }
        return state.binding
    }

    func navigationStarted(in candidate: WKWebView, navigation: WKNavigation?) {
        guard candidate === webView else { return }
        self.navigation = navigation
        state.endDocument()
        target.end()
        storage?.endDocument()
    }

    func navigationFinished(in candidate: WKWebView, navigation: WKNavigation?) {
        guard installed, candidate === webView, let navigation, navigation === self.navigation, state.allows(candidate.url),
              let binding = state.beginDocument(receipt: receipt()) else { return }
        call("return window.__nacDesktop?.activate(binding) === true", arguments: ["binding": object(binding)], binding: binding)
        if let profile {
            target.begin(binding, profile: profile)
            call("return window.__nacDesktop?.activateSessionTarget(binding, profile) === true",
                 arguments: ["binding": object(binding), "profile": profile], binding: binding)
        }
        setVisibility(visible)
        storage?.activate(binding, endpoint: state.origin.absoluteString)
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

    func retire(completion: @escaping (Bool) -> Void = { _ in }) {
        guard installed else { completion(false); return }
        installed = false
        target.end()
        navigation = nil
        storage?.retire()
        state.retire()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: NativeCommandScript.handler, contentWorld: .page)
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: WorkspaceStorageScript.handler, contentWorld: .page)
        guard let webView else { completion(false); return }
        // Disposal belongs to this exact view, including its unactivated page
        // or the old page during provisional navigation. It invokes no action.
        webView.callAsyncJavaScript("return window.__nacDesktop?.retireView() === true",
            arguments: [:], in: nil, in: .page) { result in
            let acknowledged: Bool
            if case .success(let value) = result { acknowledged = (value as? Bool) == true }
            else { acknowledged = false }
            if let storage = self.storage { storage.flush { completion(acknowledged && $0) } }
            else { completion(acknowledged) }
        }
        // This bridge must be installed before its view's first load. It does
        // not remove other owners' user scripts or reuse a retired WebView.
    }

    @discardableResult
    func openSessionTarget(session: String, occurrence: String, completion: @escaping (NativeSessionTarget.Outcome) -> Void) -> Bool {
        // This response follows explicit OS activation. Menu responder ownership
        // stays unchanged; React separately protects IME/modal/local editors.
        guard installed, state.matches(receipt()), target.ready else { return false }
        if webView?.window?.attachedSheet != nil || NSApp.modalWindow != nil {
            completion(.deferred); return true
        }
        guard NSApp.isActive, webView?.window?.isKeyWindow == true,
              state.matches(receipt()), let binding = state.binding,
              let request = target.issue(session: session, occurrence: occurrence, completion: completion) else { return false }
        call("return window.__nacDesktop?.dispatchSessionTarget(binding, request) === true",
             arguments: ["binding": object(binding), "request": object(request)], binding: binding)
        return true
    }

    func setVisibility(_ next: Bool) {
        visible = next
        guard installed, state.matches(receipt()), let binding = state.binding else { return }
        call("return window.__nacDesktop?.setVisibility(binding, visible) === true",
             arguments: ["binding": object(binding), "visible": next], binding: binding)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard installed, let webView, message.webView === webView,
              userContentController === webView.configuration.userContentController,
              [NativeCommandScript.handler, WorkspaceStorageScript.handler].contains(message.name),
              let body = message.body as? String else {
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
        if message.name == WorkspaceStorageScript.handler {
            guard message.frameInfo.isMainFrame, state.matches(receipt()), state.allows(components.url),
                  let binding = state.binding else { return }
            _ = storage?.receive(body, expected: binding)
            return
        }
        if message.frameInfo.isMainFrame, state.matches(receipt()), state.allows(components.url),
           let binding = state.binding, target.receive(body, expected: binding) {
            if target.ready { targetReady?() }
            return
        }
        let accepted = state.receive(body, origin: components.url, mainFrame: message.frameInfo.isMainFrame,
                                     currentView: message.webView === webView, receipt: receipt())
        if accepted, let binding = state.pendingConnectionLoss {
            // Receipt admission fences commands immediately. Retiring the WK
            // handler/view must wait until this message callback has returned.
            RunLoop.main.perform(inModes: [.common]) { [weak self, weak webView] in
                MainActor.assumeIsolated {
                    guard let self, let webView, self.installed, self.webView === webView,
                          self.state.matches(self.receipt()),
                          self.state.consumeConnectionLoss(binding) else { return }
                    self.connectionLost?()
                }
            }
        }
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
            if case .failure = result { self.state.endDocument(); self.target.end() }
            else if case .success(let value) = result, (value as? Bool) != true { self.state.endDocument(); self.target.end() }
        }
    }

    private func object<T: Encodable>(_ value: T) -> [String: Any] {
        // Only fixed shell-owned Codable DTOs reach WebKit argument serialization.
        (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(value))) as? [String: Any] ?? [:]
    }
}
