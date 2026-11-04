import AppKit
import WebKit

@MainActor
final class PreviewApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate {
    private(set) var window: NSWindow!
    private(set) var webView: WKWebView!
    private(set) var commands: NativeCommands!
    #if !LOCAL_APP
    private(set) var profile: PreviewProfile?
    let provider = FixtureProvider()
    private var fixtureProject: String?
    #endif
    let engine = PreviewEngine()
    private(set) var baseURL: URL?
    private(set) var failure: String?
    private(set) var stopping = false
    private(set) var launchConfiguration: EngineLaunchConfiguration?
    private var startup: Task<Void, Never>?
    private var loading: Task<Void, Never>?
    private var workspaceIncarnation: String?
    private var navigationIncarnations: [WKNavigation: String] = [:]
    private var activeNavigation: WKNavigation?
    private var workspaceRetirement: WorkspaceRetirement?
    private let ephemeralDataStore = WKWebsiteDataStore.nonPersistent()
    private var workspaceStorage: WorkspaceStorage?
    #if LOCAL_APP
    private var workspaceStorageSelection: (profile: String, task: Task<WorkspaceStorage?, Never>)?
    #endif
    private var workspaceDataStore: WKWebsiteDataStore { workspaceStorage?.websiteDataStore ?? ephemeralDataStore }
    private(set) lazy var recovery = WorkspaceRecovery(app: self)
    private var status: NSTextField!
    #if LOCAL_APP
    private(set) lazy var quit = AppQuit(app: self)
    private let appInstance = AppInstance()
    private let storeConflictRetry = StoreConflictRetry()
    private var storeRetryButton: NSButton?
    private var launchIdentity: EngineIdentity?
    private var failedViewRetainedEngine = false
    #endif
    #if PREVIEW_SMOKE
    #if LIFECYCLE_SMOKE || !LOCAL_APP
    private var recoverySmoke: RecoverySmoke?
    #endif
    #if LIFECYCLE_SMOKE
    private var lifecycleSmoke: LifecycleSmoke?
    #elseif INSTANCE_SMOKE
    private var instanceSmoke: InstanceSmoke?
    #elseif LOCAL_APP
    var startupSmoke: StartupSmoke?
    #else
    var smoke: PreviewSmoke?
    #endif
    #endif

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.appearance = NSAppearance(named: .darkAqua)
        #if LOCAL_APP
        let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "NAC"
        #else
        let name = "NAC Development Preview"
        #endif
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        #if LOCAL_APP
        window.title = name
        #else
        window.title = "NAC Development Preview — disposable local fixture"
        #endif
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.center()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = workspaceDataStore
        webView = WKWebView(frame: window.contentView!.bounds, configuration: configuration)
        #if INSTANCE_SMOKE
        InstanceSmoke.configure(webView)
        #endif
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.isHidden = true
        window.contentView!.addSubview(webView)
        commands = NativeCommands(webView: webView, receipt: { [weak self] in self?.engine.receipt },
            connectionLost: { [weak self] in self?.recovery.connectionLost() })
        commands.installMenus(applicationName: name)
        #if LOCAL_APP
        status = NSTextField(wrappingLabelWithString: "Starting NAC…")
        #else
        status = NSTextField(wrappingLabelWithString: "Starting the isolated NAC preview…")
        #endif
        status.frame = NSRect(x: 40, y: 100, width: 1160, height: 580)
        status.autoresizingMask = [.width, .height]
        status.font = .systemFont(ofSize: 16)
        window.contentView!.addSubview(status)
        recovery.install()
        #if LOCAL_APP
        let retry = NSButton(title: "Retry", target: self, action: #selector(retryStoreConflict(_:)))
        retry.frame = NSRect(x: 40, y: 45, width: 140, height: 32)
        retry.autoresizingMask = [.maxXMargin, .maxYMargin]
        retry.bezelStyle = .rounded
        retry.isHidden = true
        retry.isEnabled = false
        window.contentView!.addSubview(retry)
        storeRetryButton = retry
        appInstance.install(window: window)
        #endif
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        #if PREVIEW_SMOKE
        #if LIFECYCLE_SMOKE
        if CommandLine.arguments.contains("--recovery-output") {
            recoverySmoke = RecoverySmoke(app: self)
            recoverySmoke?.start()
        } else {
            lifecycleSmoke = LifecycleSmoke(app: self)
            lifecycleSmoke?.start()
        }
        #elseif INSTANCE_SMOKE
        instanceSmoke = InstanceSmoke(window: window, currentView: { [weak self] in self?.webView },
            // Bind every fixture operation to the current recovery document epoch.
            documentGeneration: { [weak self] in self?.recovery.documentGeneration ?? -1 }, engine: engine, conflicts: storeConflictRetry,
            retryButton: { [weak self] in self?.storeRetryButton }, baseURL: { [weak self] in self?.baseURL },
            failure: { [weak self] in self?.failure }, requestQuit: { [weak self] in self?.quit.stopFixture() })
        instanceSmoke?.start()
        #elseif LOCAL_APP
        startupSmoke = StartupSmoke(app: self)
        startupSmoke?.start()
        #else
        if CommandLine.arguments.contains("--recovery-output") {
            recoverySmoke = RecoverySmoke(app: self)
            recoverySmoke?.start()
        } else {
            smoke = PreviewSmoke(app: self)
            smoke?.start()
        }
        #endif
        #endif
        startup = Task { await start() }
    }

    private func start(retryConfiguration: EngineLaunchConfiguration? = nil) async {
        do {
            #if !LOCAL_APP
            if profile == nil {
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
            }
            #endif
            guard !stopping else { return }
            #if LOCAL_APP
            guard let launch = quit.beginLaunch() else { return }
            #endif
            let executable = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/nac-web")
            engine.onReady = { [weak self] url in
                guard let self, !self.stopping, self.failure == nil,
                      let incarnation = self.engine.receipt?.incarnation else { return }
                self.loading = Task { await self.load(url, incarnation: incarnation) }
            }
            engine.onExit = { [weak self] status in
                #if LOCAL_APP
                self?.quit.childExited(launch)
                #endif
                guard let self else { return }
                if self.failure != nil { self.fail("The bundled engine stopped (status \(status)).") }
                else { self.recovery.engineExited("The bundled engine stopped (status \(status)).") }
            }
            engine.onFailure = { [weak self] failure in self?.engineFailed(failure) }
            #if LOCAL_APP
            let identityURL = executable.deletingLastPathComponent().appendingPathComponent("engine-identity.json")
            let identity = try JSONDecoder().decode(EngineIdentity.self, from: Data(contentsOf: identityURL))
            launchIdentity = identity
            var arguments = Array(CommandLine.arguments.dropFirst())
            #if PREVIEW_SMOKE
            #if LIFECYCLE_SMOKE
            arguments = recoverySmoke != nil ? RecoverySmoke.launchArguments(arguments) : LifecycleSmoke.launchArguments(arguments)
            #elseif INSTANCE_SMOKE
            arguments = InstanceSmoke.launchArguments(arguments)
            #else
            arguments = StartupSmoke.launchArguments(arguments)
            #endif
            #endif
            let configuration: EngineLaunchConfiguration
            if let retryConfiguration {
                configuration = retryConfiguration
            } else {
                let options = try DesktopStartup.Options(arguments: arguments)
                configuration = try await DesktopStartup.select(executable: executable, identity: identity,
                    options: options, inherited: ProcessInfo.processInfo.environment)
            }
            guard !stopping, !Task.isCancelled else { return }
            launchConfiguration = configuration
            try engine.launch(executable: executable, configuration: configuration)
            #else
            guard let profile else { return }
            var environment = profile.environment
            environment["MODELS_DEV_URL"] = provider.baseURL.appendingPathComponent("models-dev").absoluteString
            let configuration = retryConfiguration ?? EngineLaunchConfiguration(cwd: profile.workspace, store: profile.store, environment: environment)
            launchConfiguration = configuration
            try engine.launch(executable: executable, configuration: configuration)
            #endif
        } catch { if !stopping, !Task.isCancelled { fail(error.localizedDescription) } }
    }

    private func load(_ url: URL, incarnation: String) async {
        do {
            var firstProfileDocument = false
            #if LOCAL_APP
            let route = "#/"
            #else
            guard let profile else { return }
            let project: String
            if let fixtureProject { project = fixtureProject }
            else {
                project = try await FixtureBootstrap.seed(base: url, profile: profile, provider: provider)
                guard !Task.isCancelled, !stopping, engine.receipt?.incarnation == incarnation else { return }
                fixtureProject = project
            }
            #if PREVIEW_SMOKE
            try await smoke?.beforeLoad()
            #endif
            let route = "#/project/\(project)"
            #endif
            guard !stopping, !Task.isCancelled, failure == nil, engine.pid > 0,
                  engine.receipt?.incarnation == incarnation else { return }
            baseURL = url
            guard let receipt = engine.receipt else { return }
            #if LOCAL_APP
            let documentGeneration = recovery.documentGeneration
            let ownsInitialDocument = !recovery.isSuspended && !recovery.busy
            let initialView = { [weak view = webView] in view }
            let selectingProfile = workspaceStorage == nil
            try await prepareWorkspaceStorage(receipt: receipt)
            guard ownsInitialDocument, !stopping, !Task.isCancelled, failure == nil,
                  recovery.documentGeneration == documentGeneration,
                  webView === initialView(),
                  engine.receipt?.incarnation == receipt.incarnation else { return }
            if selectingProfile {
                firstProfileDocument = true
                // This is the still-blank bootstrap view, before any product
                // document/bridge was loaded. Product recovery uses retirement.
                commands?.retire()
                webView?.navigationDelegate = nil
                webView?.uiDelegate = nil
                webView?.removeFromSuperview()
                webView = nil
                commands = nil
            }
            #endif
            recovery.seedRoute(String(route.dropFirst()))
            guard recovery.engineReady(receipt) else { return }
            guard !recovery.isSuspended, !recovery.busy else { return }
            if webView == nil {
                replaceWorkspace(receipt: receipt, fragment: recovery.restoredFragment ?? String(route.dropFirst()),
                                 initial: firstProfileDocument)
                return
            }
            workspaceIncarnation = incarnation
            commands.bind()
            if let navigation = webView.load(URLRequest(url: URL(string: route, relativeTo: url)!.absoluteURL)) {
                navigationIncarnations[navigation] = incarnation
                activeNavigation = navigation
            }
        } catch {
            if !stopping, !Task.isCancelled, engine.receipt?.incarnation == incarnation { fail(error.localizedDescription) }
        }
    }

    /// Profile ownership outlives a canceled renderer load. Each current caller
    /// still fences its own launch/document after awaiting this shared operation.
    func prepareWorkspaceStorage(receipt: EngineReceipt) async throws {
        #if LOCAL_APP
        try Task.checkCancellation()
        guard let configuration = launchConfiguration,
              let profile = currentWorkspaceStorageProfile(receipt: receipt) else {
            throw PreviewError.message("The selected workspace profile is unavailable.")
        }
        if let storage = workspaceStorage {
            guard storage.profile.digest == profile.digest else {
                throw PreviewError.message("The selected workspace profile changed. Reopen NAC explicitly.")
            }
            return
        }
        let pending: Task<WorkspaceStorage?, Never>
        if let selection = workspaceStorageSelection {
            guard selection.profile == profile.digest else {
                throw PreviewError.message("The selected workspace profile changed. Reopen NAC explicitly.")
            }
            pending = selection.task
        } else {
            // App-owned unstructured work: retiring a renderer cancels its waiter,
            // not this one bounded profile open or its exclusive checkpoint lease.
            pending = Task { await WorkspaceStorage.open(receipt: receipt, configuration: configuration) }
            workspaceStorageSelection = (profile.digest, pending)
        }
        let selected = await pending.value
        try Task.checkCancellation()
        guard currentWorkspaceStorageProfile(receipt: receipt)?.digest == profile.digest else {
            throw PreviewError.message("Profile selection was retired by the current launch.")
        }
        guard let selected else {
            throw PreviewError.message("The selected workspace profile is unavailable.")
        }
        workspaceStorage = selected
        workspaceStorageSelection = nil
        #endif
    }

    #if LOCAL_APP
    private func currentWorkspaceStorageProfile(receipt: EngineReceipt) -> WorkspaceStorageProfile? {
        guard !stopping, failure == nil, engine.pid > 0,
              let current = engine.receipt, let configuration = launchConfiguration,
              current.incarnation == receipt.incarnation, current.endpoint == receipt.endpoint,
              current.identity == receipt.identity, current.store == receipt.store,
              current.schema == receipt.schema else { return nil }
        return WorkspaceStorageProfile(receipt: current, configuration: configuration)
    }
    #endif

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard webView === self.webView, !stopping, failure == nil else { return }
        // Every callback fences the previous document, but only an admitted
        // navigation may replace the tracked completion/timeout identity.
        defer { commands?.navigationStarted(in: webView, navigation: activeNavigation) }
        guard let navigation, let incarnation = workspaceIncarnation,
              engine.receipt?.incarnation == incarnation else { return }
        if let tracked = navigationIncarnations[navigation] {
            guard tracked == incarnation else { return }
        } else {
            guard let url = webView.url, let baseURL, url.scheme == baseURL.scheme,
                  url.host == baseURL.host, url.port == baseURL.port else { return }
            // Includes ordinary WebView reloads while retaining the launch binding.
            navigationIncarnations[navigation] = incarnation
        }
        activeNavigation = navigation
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === self.webView, let navigation,
              navigation === activeNavigation,
              let incarnation = navigationIncarnations.removeValue(forKey: navigation),
              !stopping, failure == nil, incarnation == engine.receipt?.incarnation else { return }
        commands.navigationFinished(in: webView, navigation: navigation)
        status.isHidden = true
        webView.isHidden = false
        recovery.documentLoaded()
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard commands?.allows(action, in: webView) == true else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard webView === self.webView, let navigation else { return }
        let incarnation = navigationIncarnations.removeValue(forKey: navigation)
        guard navigation === activeNavigation else { return }
        if !stopping, incarnation != nil, incarnation == engine.receipt?.incarnation {
            recovery.rendererFailed("Could not load the bundled workspace.")
        }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard webView === self.webView, let navigation, navigation === activeNavigation,
              let incarnation = navigationIncarnations.removeValue(forKey: navigation),
              incarnation == engine.receipt?.incarnation else { return }
        recovery.rendererFailed("The workspace navigation failed.")
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard webView === self.webView else { return }
        if !stopping { recovery.rendererFailed("The workspace renderer stopped.") }
    }

    private func engineFailed(_ reason: EngineFailure) {
        guard !stopping else { return }
        if failure != nil { fail(reason.localizedDescription); return }
        if baseURL != nil || recovery.engineStateLost {
            recovery.engineExited(reason.localizedDescription)
            return
        }
        #if LOCAL_APP
        if reason == .storeOwned, let configuration = launchConfiguration, let identity = launchIdentity {
            let conflict = StoreConflict(canonicalStore: configuration.store.path, track: identity.track)
            let episode = storeConflictRetry.present(conflict)
            fail(reason.localizedDescription)
            status.stringValue = conflict.message
            storeRetryButton?.isHidden = false
            engine.stop { [weak self] in
                guard let self else { return }
                self.storeConflictRetry.retired(episode, ownedChildHasExited: self.engine.pid == 0)
                self.storeRetryButton?.isEnabled = !self.stopping && self.storeConflictRetry.canRetry
            }
            return
        }
        #endif
        fail(reason.localizedDescription)
    }

    #if LOCAL_APP
    @objc private func retryStoreConflict(_ sender: Any?) {
        guard let configuration = launchConfiguration,
              storeConflictRetry.episode?.conflict.canonicalStore == configuration.store.path,
              storeConflictRetry.beginRetry(ownedChildHasExited: engine.pid == 0, appIsStopping: stopping) != nil else { return }
        startup?.cancel()
        loading?.cancel()
        failure = nil
        baseURL = nil
        workspaceIncarnation = nil
        navigationIncarnations.removeAll()
        storeRetryButton?.isHidden = true
        storeRetryButton?.isEnabled = false
        status.stringValue = "Retrying the selected NAC store…"
        startup = Task { await start(retryConfiguration: configuration) }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        let result = appInstance.reopen()
        #if INSTANCE_SMOKE
        instanceSmoke?.didReopen()
        #endif
        return result
    }
    #endif

    private func fail(_ message: String) {
        guard !stopping else { return }
        if failure != nil {
            #if LOCAL_APP
            // A later channel failure/exit invalidates the prior continuation
            // claim. EngineRun still owns its original cleanup; do not resend it.
            if failedViewRetainedEngine, engine.receipt == nil {
                let next = engine.pid > 0
                    ? "The background service is unavailable. Cleanup may still be finishing. Choose Quit NAC before relaunching."
                    : "The background service has stopped. Quit NAC and relaunch after correcting the reported problem."
                status.stringValue = "NAC could not continue\n\n\(message)\n\n\(next)"
            }
            #endif
            return
        }
        #if LOCAL_APP
        // A failed view is not an instruction to cancel running work. Engine
        // failures invalidate their receipt before this callback; those still
        // use normal cleanup. Only a verified launch with a live Quit owner stays.
        let retainingEngine = engine.pid > 0 && engine.receipt?.kind == "ready" && quit.launch != nil
        failedViewRetainedEngine = retainingEngine
        #endif
        failure = message
        #if LOCAL_APP
        workspaceStorageSelection?.task.cancel()
        workspaceStorageSelection = nil
        #endif
        recovery.cancelPending()
        commands?.retire()
        webView?.stopLoading()
        webView?.isHidden = true
        status.isHidden = false
        #if LOCAL_APP
        storeRetryButton?.isHidden = true
        storeRetryButton?.isEnabled = false
        let store = launchConfiguration.map { "\n\nSelected store: \($0.store.path)" } ?? ""
        let next = retainingEngine
            ? "Your running work continues. Choose Quit NAC to review activity and stop it before relaunching."
            : "Quit NAC and relaunch after correcting the reported problem."
        status.stringValue = "NAC could not continue\n\n\(message)\(store)\n\n\(next)"
        #else
        status.stringValue = "NAC preview could not continue\n\n\(message)\n\nClose this window to clean up the disposable fixture.\n\n\(engine.log.suffix(4000))"
        #endif
        #if !LOCAL_APP
        provider.stop()
        #endif
        #if LOCAL_APP
        if retainingEngine { return }
        let launch = quit.launch
        engine.stop { [weak self] in
            if let launch { self?.quit.childExited(launch) }
        }
        #else
        engine.stop {}
        #endif
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        #if LOCAL_APP
        return quit.canCloseWindow
        #else
        NSApp.terminate(nil)
        return false
        #endif
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    #if LIFECYCLE_SMOKE
    func applicationWillTerminate(_ notification: Notification) { lifecycleSmoke?.willTerminate() }
    #endif

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        recovery.applicationQuitRequested()
        #if LOCAL_APP
        return quit.shouldTerminate()
        #else
        guard !stopping else { return .terminateLater }
        beginShutdown { NSApp.reply(toApplicationShouldTerminate: true) }
        return .terminateLater
        #endif
    }

    #if PREVIEW_SMOKE
    var smokeProfileSnapshot: [String: Any] {
        #if LOCAL_APP
        return ["selected": workspaceStorage != nil, "pending": workspaceStorageSelection != nil,
                "retired": stopping || failure != nil,
                "available": workspaceStorage?.available ?? false,
                "profile": workspaceStorage?.profile.digest ?? "",
                "website_store": workspaceStorage?.profile.identifier.uuidString ?? "",
                "persistent": workspaceStorage?.websiteDataStore.isPersistent ?? false]
        #else
        return ["selected": false, "pending": false, "preview_ephemeral": true]
        #endif
    }
    func smokeProfileFailure() { fail("The fixture retired pending profile initialization.") }
    #endif

    func showShutdownStatus(_ message: String) {
        status.isHidden = false
        status.stringValue = message
    }

    #if LIFECYCLE_SMOKE
    var lifecycleFailureStatus: String { status.stringValue }
    #endif

    func beginShutdown(completion: @escaping () -> Void) {
        guard !stopping else { return }
        stopping = true
        recovery.close()
        commands?.retire()
        #if LOCAL_APP
        storeConflictRetry.clear()
        storeRetryButton?.isEnabled = false
        workspaceStorageSelection?.task.cancel()
        workspaceStorageSelection = nil
        #endif
        startup?.cancel()
        loading?.cancel()
        #if INSTANCE_SMOKE
        instanceSmoke?.prepareForStop()
        #endif
        // Closing a window retains the document. Actual Stop releases the
        // document itself; stopLoading alone does not release its ownership.
        workspaceIncarnation = nil
        navigationIncarnations.removeAll()
        activeNavigation = nil
        window.makeFirstResponder(nil)
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
        webView?.stopLoading()
        webView?.removeFromSuperview()
        webView = nil
        status.isHidden = false
        #if LOCAL_APP
        status.stringValue = "Stopping NAC…"
        #else
        status.stringValue = "Stopping the isolated engine and removing fixture data…"
        #endif
        // Let Rust cancel runs and settle persistence before stopping the provider.
        engine.stop { [weak self] in
            guard let self else { return }
            #if !LOCAL_APP
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
            #endif
            #if PREVIEW_SMOKE
            #if LIFECYCLE_SMOKE
            if let recoverySmoke = self.recoverySmoke { recoverySmoke.didStop() }
            else { self.lifecycleSmoke?.didStop() }
            #elseif INSTANCE_SMOKE
            self.instanceSmoke?.didStop()
            #elseif LOCAL_APP
            self.startupSmoke?.didStop()
            #else
            if let recoverySmoke = self.recoverySmoke { recoverySmoke.didStop() }
            else { self.smoke?.didCleanUp() }
            #endif
            #endif
            if let storage = self.workspaceStorage {
                storage.flush { durable in
                    if !durable { fputs("NAC workspace storage did not confirm a durable checkpoint before Quit.\n", stderr) }
                    completion()
                }
            } else { completion() }
        }
    }

    var canRecoverWorkspace: Bool {
        guard !stopping, failure == nil else { return false }
        #if LOCAL_APP
        return quit.lifecycle.phase == .running
        #else
        return true
        #endif
    }

    /// Synchronous native fences precede all asynchronous disposal/revalidation.
    func beginWorkspaceRetirement() -> WorkspaceRetirement {
        // Repeated retirement still fences a newly bound renderer waiter.
        // Its app-owned profile open remains alive for the current successor.
        if baseURL != nil { loading?.cancel() }
        if let workspaceRetirement { return workspaceRetirement }
        workspaceIncarnation = nil
        activeNavigation = nil
        navigationIncarnations.removeAll()
        // Do not force an IME composition commit by changing the responder
        // before the live page has closed its terminal input lifetime.
        let retirement = WorkspaceRetirement(view: webView, commands: commands) { [weak self, weak previous = webView] in
            guard let self, self.webView === previous else { return }
            self.webView = nil
            self.commands = nil
        }
        workspaceRetirement = retirement
        return retirement
    }

    func replaceWorkspace(receipt: EngineReceipt, fragment: String?, initial: Bool = false,
                          requireTerminalAcknowledgement: Bool = false) {
        // Initial verified loading continues behind a Cancel-Quit confirmation,
        // as it did before profile selection. Recovery keeps its stricter gate.
        guard !stopping, failure == nil, initial || canRecoverWorkspace,
              let endpoint = receipt.endpoint, let base = URL(string: endpoint),
              engine.receipt?.incarnation == receipt.incarnation,
              engine.receipt?.endpoint == receipt.endpoint else { return }
        #if LOCAL_APP
        guard let storage = workspaceStorage,
              currentWorkspaceStorageProfile(receipt: receipt)?.digest == storage.profile.digest else { return }
        #endif
        workspaceRetirement = nil
        baseURL = base
        var address = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        address.fragment = fragment ?? "/"
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = workspaceDataStore
        if requireTerminalAcknowledgement {
            // A dead renderer cannot preserve its local delivery facts. Restrict
            // first-seen live executions in this same-engine replacement only;
            // this document fact contains no bytes, handles or input authority.
            configuration.userContentController.addUserScript(WKUserScript(source: """
                Object.defineProperty(window, "__nacRequireTerminalAcknowledgement", {
                    value: true, writable: false, configurable: false
                });
                """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        #if PREVIEW_SMOKE
        #if LIFECYCLE_SMOKE || !LOCAL_APP
        if recoverySmoke != nil { configuration.userContentController.addUserScript(RecoverySmoke.script) }
        #endif
        #endif
        var frame = window.contentView!.bounds
        frame.origin.y += recovery.noticeHeight
        frame.size.height -= recovery.noticeHeight
        let replacement = WKWebView(frame: frame, configuration: configuration)
        #if INSTANCE_SMOKE
        InstanceSmoke.configure(replacement)
        #endif
        replacement.autoresizingMask = [.width, .height]
        replacement.navigationDelegate = self
        replacement.isHidden = true
        webView = replacement
        window.contentView!.addSubview(replacement, positioned: .below, relativeTo: status)
        commands = NativeCommands(webView: replacement, receipt: { [weak self] in self?.engine.receipt },
            connectionLost: { [weak self] in self?.recovery.connectionLost() }, workspaceStorage: workspaceStorage)
        commands.installMenus(applicationName: Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "NAC")
        recovery.installMenus()
        recovery.showLossNotice()
        commands.bind()
        workspaceIncarnation = receipt.incarnation
        if let navigation = replacement.load(URLRequest(url: address.url!)) {
            navigationIncarnations[navigation] = receipt.incarnation
            activeNavigation = navigation
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self, weak replacement] in
                guard let self, let replacement, self.webView === replacement,
                      self.activeNavigation === navigation,
                      self.navigationIncarnations[navigation] != nil, !self.stopping else { return }
                self.recovery.rendererFailed("The workspace did not finish loading within ten seconds.")
            }
        }
    }

    func restartOwnedEngine() async throws {
        guard canRecoverWorkspace, let configuration = launchConfiguration else {
            throw PreviewError.message("The selected launch cannot be restarted during Quit or startup.")
        }
        #if LOCAL_APP
        let ownedLaunch = quit.launch
        #endif
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            var settled = false
            let finish: (Error?) -> Void = { error in
                guard !settled else { return }
                settled = true
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume() }
            }
            // Stop retires the live engine even if cleanup or relaunch later fails.
            if engine.pid > 0 { recovery.ownedEngineWillStop() }
            engine.stop { [weak self] in
                guard let self, self.engine.pid == 0 else {
                    finish(PreviewError.message("The original engine cleanup has not finished.")); return
                }
                #if LOCAL_APP
                if let ownedLaunch { self.quit.childExited(ownedLaunch) }
                #endif
                finish(nil)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 26) {
                finish(PreviewError.message("The original engine is still stopping. No replacement was launched."))
            }
        }
        try Task.checkCancellation()
        guard canRecoverWorkspace, engine.pid == 0 else {
            throw PreviewError.message("Restart was retired by application shutdown.")
        }
        failure = nil
        baseURL = nil
        await start(retryConfiguration: configuration)
    }
}
