import AppKit
import WebKit

@MainActor
final class PreviewApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate {
    private(set) var window: NSWindow!
    private(set) var webView: WKWebView!
    private(set) var profile: PreviewProfile?
    let provider = FixtureProvider()
    let engine = PreviewEngine()
    private(set) var baseURL: URL?
    private(set) var failure: String?
    private(set) var stopping = false
    private var startup: Task<Void, Never>?
    private var status: NSTextField!
    #if PREVIEW_SMOKE
    var smoke: PreviewSmoke?
    #endif

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.appearance = NSAppearance(named: .darkAqua)
        let menu = NSMenu()
        let item = NSMenuItem()
        menu.addItem(item)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit NAC Development Preview", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = appMenu
        NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "NAC Development Preview — disposable local fixture"
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.center()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: window.contentView!.bounds, configuration: configuration)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.isHidden = true
        window.contentView!.addSubview(webView)
        status = NSTextField(wrappingLabelWithString: "Starting the isolated NAC preview…")
        status.frame = NSRect(x: 40, y: 100, width: 1160, height: 580)
        status.autoresizingMask = [.width, .height]
        status.font = .systemFont(ofSize: 16)
        window.contentView!.addSubview(status)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        #if PREVIEW_SMOKE
        smoke = PreviewSmoke(app: self)
        smoke?.start()
        #endif
        startup = Task { await start() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard let self, self.baseURL == nil, self.failure == nil, !self.stopping else { return }
            self.fail("The bundled engine did not become ready within 30 seconds.")
        }
    }

    private func start() async {
        do {
            let profile = try PreviewProfile()
            self.profile = profile
            try await provider.start()
            guard !stopping else { return }
            let executable = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/nac-web")
            engine.onReady = { [weak self] url in
                guard let self, !self.stopping, self.failure == nil else { return }
                self.startup = Task { await self.load(url) }
            }
            engine.onExit = { [weak self] status in
                self?.fail("The bundled engine stopped (status \(status)). Close this window and relaunch the preview.")
            }
            try engine.launch(executable: executable, profile: profile, provider: provider)
        } catch { if !stopping { fail(error.localizedDescription) } }
    }

    private func load(_ url: URL) async {
        do {
            guard let profile else { return }
            let project = try await FixtureBootstrap.seed(base: url, profile: profile, provider: provider)
            guard !stopping, failure == nil, engine.pid > 0 else { return }
            baseURL = url
            webView.load(URLRequest(url: URL(string: "#/project/\(project)", relativeTo: url)!.absoluteURL))
        } catch { if !stopping { fail(error.localizedDescription) } }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !stopping, failure == nil else { return }
        status.isHidden = true
        webView.isHidden = false
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, let baseURL,
              url.scheme == baseURL.scheme, url.host == baseURL.host, url.port == baseURL.port else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if !stopping { fail("Could not load the bundled workspace: \(error.localizedDescription)") }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if !stopping { fail("The workspace renderer stopped. Close this window and relaunch the preview.") }
    }

    private func fail(_ message: String) {
        guard !stopping, failure == nil else { return }
        failure = message
        webView.stopLoading()
        webView.isHidden = true
        status.isHidden = false
        status.stringValue = "NAC preview could not continue\n\n\(message)\n\nClose this window to clean up the disposable fixture.\n\n\(engine.log.suffix(4000))"
        provider.stop()
        engine.stop {}
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool { NSApp.terminate(nil); return false }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !stopping else { return .terminateLater }
        stopping = true
        startup?.cancel()
        webView.stopLoading()
        webView.isHidden = true
        status.isHidden = false
        status.stringValue = "Stopping the isolated engine and removing fixture data…"
        // Let Rust cancel runs and settle persistence before stopping the provider.
        engine.stop { [weak self] in
            guard let self else { return }
            self.provider.stop()
            do { try self.profile?.remove() }
            catch {
                fputs("NAC preview fixture cleanup failed: \(error)\n", stderr)
                #if PREVIEW_SMOKE
                self.smoke?.cleanupFailed(error)
                #endif
            }
            #if PREVIEW_SMOKE
            self.smoke?.didCleanUp()
            #endif
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }
}
