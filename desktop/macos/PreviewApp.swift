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
    private(set) var launchConfiguration: EngineLaunchConfiguration?
    private var startup: Task<Void, Never>?
    private var workspaceIncarnation: String?
    private var navigationIncarnations: [WKNavigation: String] = [:]
    private var status: NSTextField!
    #if PREVIEW_SMOKE
    #if LOCAL_APP
    var startupSmoke: StartupSmoke?
    #else
    var smoke: PreviewSmoke?
    #endif
    #endif

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.appearance = NSAppearance(named: .darkAqua)
        let menu = NSMenu()
        let item = NSMenuItem()
        menu.addItem(item)
        let appMenu = NSMenu()
        #if LOCAL_APP
        let name = "NAC"
        #else
        let name = "NAC Development Preview"
        #endif
        appMenu.addItem(withTitle: "Quit \(name)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = appMenu
        NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        #if LOCAL_APP
        window.title = "NAC"
        #else
        window.title = "NAC Development Preview — disposable local fixture"
        #endif
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
        #if LOCAL_APP
        status = NSTextField(wrappingLabelWithString: "Starting NAC…")
        #else
        status = NSTextField(wrappingLabelWithString: "Starting the isolated NAC preview…")
        #endif
        status.frame = NSRect(x: 40, y: 100, width: 1160, height: 580)
        status.autoresizingMask = [.width, .height]
        status.font = .systemFont(ofSize: 16)
        window.contentView!.addSubview(status)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        #if PREVIEW_SMOKE
        #if LOCAL_APP
        startupSmoke = StartupSmoke(app: self)
        startupSmoke?.start()
        #else
        smoke = PreviewSmoke(app: self)
        smoke?.start()
        #endif
        #endif
        startup = Task { await start() }
    }

    private func start() async {
        do {
            #if !LOCAL_APP
            let profile = try PreviewProfile()
            self.profile = profile
            #if PREVIEW_SMOKE
            try smoke?.configure(profile)
            smoke?.configure(engine)
            #endif
            try await provider.start()
            #if PREVIEW_SMOKE
            try await smoke?.beforeLaunch(profile)
            #endif
            #endif
            guard !stopping else { return }
            let executable = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/nac-web")
            engine.onReady = { [weak self] url in
                guard let self, !self.stopping, self.failure == nil,
                      let incarnation = self.engine.receipt?.incarnation else { return }
                self.startup = Task { await self.load(url, incarnation: incarnation) }
            }
            engine.onExit = { [weak self] status in
                #if LOCAL_APP
                self?.fail("The bundled engine stopped (status \(status)). Close this window and relaunch NAC.")
                #else
                self?.fail("The bundled engine stopped (status \(status)). Close this window and relaunch the preview.")
                #endif
            }
            engine.onFailure = { [weak self] message in self?.fail(message) }
            #if LOCAL_APP
            let identityURL = executable.deletingLastPathComponent().appendingPathComponent("engine-identity.json")
            let identity = try JSONDecoder().decode(EngineIdentity.self, from: Data(contentsOf: identityURL))
            var arguments = Array(CommandLine.arguments.dropFirst())
            #if PREVIEW_SMOKE
            arguments = StartupSmoke.launchArguments(arguments)
            #endif
            let options = try DesktopStartup.Options(arguments: arguments)
            let configuration = try await DesktopStartup.select(executable: executable, identity: identity,
                options: options, inherited: ProcessInfo.processInfo.environment)
            guard !stopping, !Task.isCancelled else { return }
            launchConfiguration = configuration
            try engine.launch(executable: executable, configuration: configuration)
            #else
            try engine.launch(executable: executable, profile: profile, provider: provider)
            #endif
        } catch { if !stopping { fail(error.localizedDescription) } }
    }

    private func load(_ url: URL, incarnation: String) async {
        do {
            #if LOCAL_APP
            let route = "#/"
            #else
            guard let profile else { return }
            let project = try await FixtureBootstrap.seed(base: url, profile: profile, provider: provider)
            #if PREVIEW_SMOKE
            try await smoke?.beforeLoad()
            #endif
            let route = "#/project/\(project)"
            #endif
            guard !stopping, failure == nil, engine.pid > 0,
                  engine.receipt?.incarnation == incarnation else { return }
            baseURL = url
            workspaceIncarnation = incarnation
            if let navigation = webView.load(URLRequest(url: URL(string: route, relativeTo: url)!.absoluteURL)) {
                navigationIncarnations[navigation] = incarnation
            }
        } catch {
            if !stopping, engine.receipt?.incarnation == incarnation { fail(error.localizedDescription) }
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard let navigation, navigationIncarnations[navigation] == nil,
              let incarnation = workspaceIncarnation, engine.receipt?.incarnation == incarnation,
              let url = webView.url, let baseURL, url.scheme == baseURL.scheme,
              url.host == baseURL.host, url.port == baseURL.port else { return }
        // Includes ordinary WebView reloads while retaining the launch binding.
        navigationIncarnations[navigation] = incarnation
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let navigation,
              let incarnation = navigationIncarnations.removeValue(forKey: navigation),
              !stopping, failure == nil, incarnation == engine.receipt?.incarnation else { return }
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
        guard let navigation else { return }
        let incarnation = navigationIncarnations.removeValue(forKey: navigation)
        if !stopping, incarnation != nil, incarnation == engine.receipt?.incarnation {
            fail("Could not load the bundled workspace: \(error.localizedDescription)")
        }
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
        #if LOCAL_APP
        let store = launchConfiguration.map { "\n\nSelected store: \($0.store.path)" } ?? ""
        status.stringValue = "NAC could not continue\n\n\(message)\(store)\n\nClose this window and relaunch after correcting the problem. A store written by a newer NAC version requires a compatible version; keep the existing database. Check directory access and whether another NAC process owns this store."
        #else
        status.stringValue = "NAC preview could not continue\n\n\(message)\n\nClose this window to clean up the disposable fixture.\n\n\(engine.log.suffix(4000))"
        #endif
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
        #if LOCAL_APP
        status.stringValue = "Stopping NAC…"
        #else
        status.stringValue = "Stopping the isolated engine and removing fixture data…"
        #endif
        // Let Rust cancel runs and settle persistence before stopping the provider.
        engine.stop { [weak self] in
            guard let self else { return }
            self.provider.stop()
            do { try self.profile?.remove() }
            catch {
                fputs("NAC preview fixture cleanup failed: \(error)\n", stderr)
                #if PREVIEW_SMOKE
                #if !LOCAL_APP
                self.smoke?.cleanupFailed(error)
                #endif
                #endif
            }
            #if PREVIEW_SMOKE
            #if LOCAL_APP
            self.startupSmoke?.didStop()
            #else
            self.smoke?.didCleanUp()
            #endif
            #endif
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }
}
