import AppKit
import WebKit

/// AppKit owns menu dispatch/Edit; React owns every workspace action and focus.
@MainActor
final class NativeCommands: NSObject, NSMenuItemValidation, WKUIDelegate {
    private weak var webView: WKWebView?
    private let receipt: () -> EngineReceipt?
    private var bridge: NativeCommandBridge?
    private var externalNavigation: ExternalNavigation?
    private var bound = false
    #if PREVIEW_SMOKE
    var smokeSnapshot: [String: Any] { bridge?.smokeSnapshot ?? ["installed": false] }
    #endif

    init(webView: WKWebView, receipt: @escaping () -> EngineReceipt?) {
        self.webView = webView
        self.receipt = receipt
        super.init()
        // macOS defaults this preference to true. Require WebKit's public
        // user-interaction popup gate before any new-window browser handoff.
        webView.configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        webView.uiDelegate = self
    }

    /// Call once before loading the verified launch's first workspace document.
    func bind() {
        guard !bound, let webView, receipt() != nil else { return }
        bound = true
        bridge = NativeCommandBridge(webView: webView, receipt: receipt)
        externalNavigation = ExternalNavigation(webView: webView, receipt: receipt)
    }

    func navigationStarted(in view: WKWebView, navigation: WKNavigation?) { bridge?.navigationStarted(in: view, navigation: navigation) }
    func navigationFinished(in view: WKWebView, navigation: WKNavigation?) { bridge?.navigationFinished(in: view, navigation: navigation) }
    func currentDocument(in view: WKWebView) -> NativeDocumentBinding? { bridge?.currentDocument(in: view) }
    func allows(_ action: WKNavigationAction, in view: WKWebView) -> Bool {
        if bridge?.allows(action, in: view) == true { return true }
        guard bridge?.currentDocument(in: view) != nil else { return false }
        if action.targetFrame == nil {
            // An allowed popup reaches the UI delegate, which opens it once in
            // the system browser and supplies no WKWebView for external content.
            return externalNavigation?.allows(action, in: view, popup: true) ?? false
        }
        externalNavigation?.open(action, in: view, popup: false)
        return false
    }
    func retire() {
        externalNavigation?.retire()
        externalNavigation = nil
        bridge?.retire()
        bridge = nil
    }

    func installMenus(applicationName: String = "NAC") {
        let main = NSMenu()
        let app = submenu(applicationName, in: main)
        app.addItem(withTitle: "About \(applicationName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(.separator())
        item("Settings…", #selector(settings(_:)), ",", in: app, target: self)
        app.addItem(.separator())
        app.addItem(withTitle: "Hide \(applicationName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let others = app.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        others.keyEquivalentModifierMask = [.command, .option]
        app.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "Quit \(applicationName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let file = submenu("File", in: main)
        item("New Session", #selector(newSession(_:)), "n", in: file, target: self)
        let edit = submenu("Edit", in: main)
        item("Undo", Selector(("undo:")), "z", in: edit)
        let redo = item("Redo", Selector(("redo:")), "z", in: edit)
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        item("Cut", #selector(NSText.cut(_:)), "x", in: edit)
        item("Copy", #selector(NSText.copy(_:)), "c", in: edit)
        item("Paste", #selector(NSText.paste(_:)), "v", in: edit)
        item("Select All", #selector(NSText.selectAll(_:)), "a", in: edit)
        let view = submenu("View", in: main)
        item("Projects", #selector(projects(_:)), "", in: view, target: self)
        let window = submenu("Window", in: main)
        window.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        window.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        NSApp.windowsMenu = window
        NSApp.mainMenu = main
    }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool { bridge?.available ?? false }
    @objc private func newSession(_ sender: Any?) { bridge?.send(.newSession) }
    @objc private func settings(_ sender: Any?) { bridge?.send(.settings) }
    @objc private func projects(_ sender: Any?) { bridge?.send(.projects) }

    // External content never acquires a shell-owned view or the native bridge.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if bridge?.currentDocument(in: webView) != nil {
            externalNavigation?.open(navigationAction, in: webView, popup: true)
        }
        return nil
    }

    private func submenu(_ title: String, in parent: NSMenu) -> NSMenu {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        let menu = NSMenu(title: title)
        item.submenu = menu
        parent.addItem(item)
        return menu
    }
    @discardableResult
    private func item(_ title: String, _ action: Selector, _ key: String, in menu: NSMenu, target: AnyObject? = nil) -> NSMenuItem {
        let item = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
        item.target = target // nil deliberately preserves the AppKit/WK responder chain.
        return item
    }
}
