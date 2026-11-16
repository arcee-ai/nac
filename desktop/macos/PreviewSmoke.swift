import AppKit
import WebKit

/// Instrumentation compiled only for `preview.sh smoke`; UI commands use the production bridge.
@MainActor
final class PreviewSmoke {
    private unowned let app: PreviewApp
    private let destination: URL
    private let scenario: String
    private var evidence: [String: Any] = [:]
    private(set) var offline: OfflineNetworkFence?
    private var passed = false
    private var cleanupError: String?
    private var pausedFirstLoad = false

    init(app: PreviewApp) {
        self.app = app
        let args = CommandLine.arguments
        destination = URL(fileURLWithPath: args[args.firstIndex(of: "--smoke-output")! + 1])
        scenario = args[args.firstIndex(of: "--smoke-scenario")! + 1]
        if let view = app.webView { configure(view) }
        let observer = #"""
        window.__previewEvidence = {errors: [], partial: false, deltas: []};
        addEventListener('error', e => __previewEvidence.errors.push(String(e.message)));
        addEventListener('unhandledrejection', e => __previewEvidence.errors.push(String(e.reason)));
        const NativeEventSource = window.EventSource;
        window.EventSource = class extends NativeEventSource {
          constructor(...args) {
            super(...args);
            this.addEventListener('assistant_delta', e => __previewEvidence.deltas.push(e.data));
          }
        };
        new MutationObserver(() => {
          const text = document.body?.innerText || '';
          if (text.includes('Hello from the isolated') && !text.includes('Hello from the isolated NAC Mac preview.'))
            __previewEvidence.partial = true;
        }).observe(document, {childList: true, subtree: true, characterData: true});
        """#
        app.webView.configuration.userContentController.addUserScript(WKUserScript(
            source: observer, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    /// Each recovery view keeps the fixture classification before its first load.
    func configure(_ view: WKWebView) {
        if scenario == "external-navigation-recording" { ExternalNavigationSmoke.installObserver(in: view) }
        view.customUserAgent = scenario == "external-auth"
            ? "NACExternalAuthWK/ALL348 AppleWebKit/605.1.15"
            : "NACPreviewSmoke/ALL-340 AppleWebKit/605.1.15"
    }

    func start() {
        evidence["app_pid"] = getpid()
        evidence["scenario"] = scenario
        if scenario == "offline-api-key" { evidence["offline_phase"] = "await_workspace" }
        write()
        Task {
            do {
                if scenario == "offline-api-key" {
                    try await wait("owned offline workspace", timeout: 60) { self.offline != nil && self.app.baseURL != nil }
                    guard let offline else { throw PreviewError.message("Offline fence was not installed") }
                    evidence["offline_phase"] = "offline_journey"
                    recordOfflineDiagnostic()
                    evidence["offline_provider"] = try await OfflineProviderSmoke(app: app, fence: offline).run()
                } else if scenario.hasPrefix("workspace-") {
                    try await WorkspaceSmoke(app: app, scenario: scenario, output: destination) { [self] fields in
                        evidence.merge(fields) { _, new in new }
                        write()
                    }.run()
                } else if scenario == "external-navigation-recording" {
                    evidence["external_navigation_recording"] = try await ExternalNavigationSmoke(app: app, checkpoint: { self.recordOwnership() }).run()
                } else if scenario == "external-auth" {
                    evidence["external_auth"] = try await ExternalAuthSmoke(app: app, checkpoint: { self.recordOwnership() }).run()
                } else if ["commands", "commands-input"].contains(scenario) {
                    evidence["commands"] = try await NativeCommandSmoke(app: app, commands: app.commands).run(
                        trustedInput: scenario == "commands-input", captures: destination.deletingLastPathComponent())
                } else if ["paths-xctest", "paths-failure-xctest"].contains(scenario) {
                    let paths = try await NativePathSmoke.awaitBridge(app: app) { self.recordOwnership() }
                    evidence["native_paths"] = try await NativePathSmoke(app: app, paths: paths).run(failure: scenario == "paths-failure-xctest") { record in
                        record.forEach { self.evidence[$0] = $1 }
                        self.write()
                    }
                } else if ["normal", "ci-terminal", "ci-terminal-xctest", "slow-drain", "watchdog", "parent-loss-active", "channel-loss-active", "stale-launch"].contains(scenario) {
                    if scenario == "stale-launch" {
                        try await wait("first launch load barrier") { self.pausedFirstLoad }
                        let previous = app.engine.receipt!.incarnation
                        // Suppress successor bootstrap only in this fixture.
                        // The delayed old success must never load its document.
                        app.engine.onReady = { _ in }
                        await withCheckedContinuation { continuation in
                            app.engine.stop { continuation.resume() }
                            evidence["identity_retired_before_reap"] = app.engine.pid > 0 && app.engine.receipt == nil
                        }
                        guard evidence["identity_retired_before_reap"] as? Bool == true else {
                            throw PreviewError.message("Stopping launch retained active identity")
                        }
                        try app.engine.launch(executable: Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/nac-web"),
                                              profile: app.profile!, provider: app.provider)
                        try await wait("new launch receipt") { self.app.engine.receipt?.incarnation != nil && self.app.engine.receipt?.incarnation != previous }
                        let successor = app.engine.pid
                        try await Task.sleep(nanoseconds: 31_000_000_000)
                        guard app.engine.pid == successor, app.failure == nil,
                              app.baseURL == nil, app.webView.isHidden else {
                            throw PreviewError.message("Stale launch callback affected successor")
                        }
                        evidence["stale_callbacks_fenced"] = true
                        evidence["stale_workspace_not_activated"] = true
                        try captureNative()
                    }
                    if scenario != "stale-launch" {
                        try await journey()
                        if !["normal", "ci-terminal", "ci-terminal-xctest"].contains(scenario) { try await lifecycle() }
                    }
                }
                else if ["parent-loss-startup", "channel-loss-startup", "parent-loss-initialization", "channel-loss-initialization"].contains(scenario) {
                    try await wait("engine awaiting hello") { self.app.engine.pid > 0 }
                    if scenario.hasSuffix("initialization") {
                        try await wait("post-adoption manager entry") {
                            if let failure = self.app.failure { throw PreviewError.message(failure) }
                            return self.app.engine.log.contains("project:")
                        }
                        evidence["post_adoption_verified"] = true
                        evidence["startup_engine_log"] = app.engine.log
                    }
                    if scenario.hasPrefix("parent-loss") { try await lifecycle() }
                    else {
                        if scenario == "channel-loss-initialization" {
                            evidence["engine_pid"] = app.engine.pid
                            evidence["profile"] = app.profile!.root.path
                            evidence["lifecycle_ready"] = true
                            write()
                        }
                        app.engine.loseChannel()
                        try await wait("startup channel loss") { self.app.failure != nil }
                        evidence["workspace_not_activated"] = app.baseURL == nil
                        guard app.baseURL == nil else { throw PreviewError.message("Startup channel loss activated workspace") }
                        try captureNative()
                    }
                }
                else if scenario == "close-startup" {
                    try await wait("engine starting") { self.app.engine.pid > 0 }
                } else {
                    if scenario == "engine-exit" {
                        try await waitJS("loaded production workspace", "return !!document.querySelector('[role=dialog]');")
                        kill(app.engine.pid, SIGTERM)
                    }
                    try await wait("native failure/recovery state", timeout: 65) {
                        self.app.failure != nil || (scenario == "engine-exit" && self.app.recovery.needsRecovery && !self.app.recovery.busy)
                    }
                    let message = app.failure ?? "The bundled engine stopped; explicit recovery is required."
                    let expected: String
                    switch scenario {
                    case "missing": expected = "missing or not executable"
                    case "timeout", "missing-receipt": expected = "within 30 seconds"
                    case "exit", "engine-exit": expected = "engine"
                    case "migration-failure", "bind-conflict": expected = "could not initialize"
                    case "truncated": expected = "channel closed"
                    default: expected = "invalid launch receipt"
                    }
                    guard message.contains(expected) else { throw PreviewError.message("Unexpected failure: \(message)") }
                    guard app.engine.receipt == nil else { throw PreviewError.message("Failed launch retained active identity") }
                    guard (app.commands?.smokeSnapshot["installed"] as? Bool ?? false) == false else {
                        throw PreviewError.message("Failure retained the native command bridge")
                    }
                    guard app.baseURL == nil || scenario == "engine-exit" else {
                        throw PreviewError.message("Unverified engine activated the workspace")
                    }
                    evidence["workspace_not_activated"] = app.baseURL == nil
                    evidence["native_failure"] = message
                    evidence["diagnostic_bytes_retained"] = app.engine.log.utf8.count
                    if scenario == "malformed" {
                        guard (60000...65536).contains(app.engine.log.utf8.count) else {
                            throw PreviewError.message("Diagnostic retention exceeded its bound or pressure fixture did not drain")
                        }
                    }
                    try captureNative()
                }
                passed = true
            } catch {
                if scenario == "offline-api-key" {
                    evidence["offline_failure_phase"] = evidence["offline_phase"]
                    recordOfflineDiagnostic()
                    evidence["error"] = "Offline qualification failed; no network/credential payload retained"
                } else {
                    evidence["error"] = String(describing: error)
                    evidence["engine_log"] = app.engine.log
                    if let body = try? await js("return document.body.innerText;") { evidence["dom"] = body }
                }
            }
            offline?.close()
            evidence["engine_pid"] = app.engine.pid
            evidence["profile"] = app.profile?.root.path
            evidence["base_url"] = app.baseURL?.absoluteString
            evidence["provider_url"] = app.provider.baseURL?.absoluteString
            evidence["provider_responses"] = app.provider.responseCount
            evidence["scenario"] = scenario
            if let receipt = app.engine.receipt {
                evidence["launch_incarnation"] = receipt.incarnation
                evidence["ready_store"] = receipt.store
                evidence["ready_endpoint"] = receipt.endpoint
                evidence["ready_source"] = receipt.identity?.source_revision
                evidence["ready_build"] = receipt.identity?.build_id
                evidence["ready_track"] = receipt.identity?.track
                evidence["ready_schema"] = receipt.schema
            }
            write()
            // Exercise the actual NSWindow close delegate and termination reply.
            // AppKit's terminateLater spins a native loop. Leave the Swift task
            // first so that loop can drain the main dispatch queue during shutdown.
            RunLoop.main.perform(inModes: [.common]) { [self] in
                MainActor.assumeIsolated { app.window.performClose(nil) }
            }
        }
    }

    func configure(_ profile: PreviewProfile) throws {
        if scenario == "migration-failure" {
            try Data("not a SQLite store".utf8).write(to: profile.store)
        }
        if scenario.hasSuffix("initialization") {
            evidence["profile"] = profile.root.path
            evidence["startup_store_barrier_ready"] = true
            write()
        }
    }

    func beforeLaunch(_ profile: PreviewProfile) async throws {
        if OfflineProviderPolicy.selected() {
            guard offline == nil, app.baseURL == nil, app.engine.pid == 0, let view = app.webView else {
                throw PreviewError.message("Offline fence admission is not pre-launch")
            }
            evidence["offline_phase"] = "fence_admission"
            recordOfflineDiagnostic()
            offline = try OfflineNetworkFence(provider: app.provider, view: view)
            evidence["offline_phase"] = "prelaunch_controls"
            recordOfflineDiagnostic()
            try await offline!.initialControls()
            evidence["offline_phase"] = "prelaunch_controls_passed"
            recordOfflineDiagnostic()
        }
        if scenario.hasSuffix("initialization") {
            try await wait("startup store barrier") {
                FileManager.default.fileExists(atPath: profile.root.appendingPathComponent("startup-go").path)
            }
        }
    }

    func configure(_ engine: PreviewEngine) {
        engine.holdHello = ["parent-loss-startup", "channel-loss-startup"].contains(scenario)
    }

    func beforeLoad() async throws {
        if scenario == "stale-launch" && !pausedFirstLoad {
            pausedFirstLoad = true
            try await Task.sleep(nanoseconds: 5_000_000_000)
        }
    }

    private func lifecycle() async throws {
        if scenario.hasSuffix("active") {
            // Exercise the existing revision-fenced human terminal API from the
            // actual shared WebView. This is lifecycle evidence, not OS input QA.
            _ = try await js(#"""
            const session = location.hash.split('/')[2];
            const post = async (path, body) => {
              const response = await fetch(path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
              if (!response.ok) throw new Error(await response.text());
              return response.json();
            };
            const terminal = await post(`/sessions/${session}/user-terminals`, {protocol_version:1, launch_id:crypto.randomUUID(), cols:80, rows:24});
            const path = `/sessions/${session}/executions/${terminal.terminal_id}`;
            const control = await (await fetch(path + '/input-control')).json();
            const command = "set +H\r/bin/sleep 90 & child=$!; printf '%s' $child > descendant-pid\r";
            const receipt = await post(path + '/input', {protocol_version:1, expected_revision:control.revision, bytes:[...new TextEncoder().encode(command)]});
            if (receipt.outcome !== 'written') throw new Error('fixture input was not written');
            return true;
            """#)
            let file = app.profile!.workspace.appendingPathComponent("descendant-pid")
            try await wait("real terminal descendant") { FileManager.default.fileExists(atPath: file.path) }
            evidence["descendant_pid"] = Int(try String(contentsOf: file, encoding: .utf8))
        }
        if scenario.hasPrefix("parent-loss") {
            if scenario != "parent-loss-active" {
                evidence["workspace_not_activated"] = app.baseURL == nil && app.webView.isHidden
                evidence["startup_stage"] = scenario == "parent-loss-startup" ? "awaiting_hello" : "initializing_store"
                guard evidence["workspace_not_activated"] as? Bool == true else {
                    throw PreviewError.message("Startup parent-loss fixture activated the workspace")
                }
                if scenario == "parent-loss-startup" {
                    guard !FileManager.default.fileExists(atPath: app.profile!.store.path) else {
                        throw PreviewError.message("Pre-adoption fixture performed store work")
                    }
                    evidence["store_work_absent"] = true
                }
            }
            // A shell helper must not inherit the parent side of the channel.
            let helper = Process()
            helper.executableURL = URL(fileURLWithPath: "/bin/sleep")
            let argument = "90.\(UInt32.random(in: 100000000...999999999))"
            helper.arguments = [argument]
            try helper.run()
            evidence["app_helper_pid"] = helper.processIdentifier
            evidence["app_helper_argument"] = argument
        }
        evidence["engine_pid"] = app.engine.pid
        evidence["profile"] = app.profile!.root.path
        evidence["base_url"] = app.baseURL?.absoluteString
        if let receipt = app.engine.receipt {
            evidence["launch_incarnation"] = receipt.incarnation
            evidence["ready_endpoint"] = receipt.endpoint
            evidence["ready_store"] = receipt.store
            evidence["ready_build"] = receipt.identity?.build_id
            evidence["ready_source"] = receipt.identity?.source_revision
            evidence["ready_track"] = receipt.identity?.track
            evidence["ready_schema"] = receipt.schema
        }
        evidence["lifecycle_ready"] = true
        write()
        if scenario.hasPrefix("parent-loss") {
            try await wait("runner kills owning app", timeout: 70) { false }
        } else if scenario == "channel-loss-active" {
            app.engine.loseChannel()
            try await wait("runtime channel loss") { self.app.failure != nil || self.app.recovery.needsRecovery }
            guard app.engine.receipt == nil else { throw PreviewError.message("Channel loss retained active identity") }
            try captureNative()
        } else {
            try await wait("runner owns store write barrier") {
                FileManager.default.fileExists(atPath: self.app.profile!.root.appendingPathComponent("shutdown-go").path)
            }
        }
    }

    private func journey() async throws {
        try await waitJS("production new-chat dialog", "return [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Create chat' && !b.disabled);")
        _ = try await js("document.querySelectorAll('button').forEach(b => { if(b.textContent.trim() === 'Create chat') b.click(); }); return true;")
        try await waitJS("production-created direct session", "return location.hash.includes('/session/') && !!document.querySelector('[role=combobox][aria-label=Message]');")
        let sessionID = try await js("return location.hash.split('/')[2];") as! String
        evidence["session_id"] = sessionID
        let snapshot = try await js("return await (await fetch('/sessions/' + location.hash.split('/')[2])).json();")
        guard let record = snapshot as? [String: Any], let metadata = record["metadata"] as? [String: Any],
              metadata["behavior"] as? String == "direct" else {
            throw PreviewError.message("UI did not create a direct fixture session: \(snapshot)")
        }
        evidence["behavior"] = "direct"
        try await sendPrompt("MAC_PREVIEW_STREAM")
        try await waitJS("incremental streamed response", "return __previewEvidence.partial;")
        try await waitJS("completed response", "return document.body.innerText.includes('Hello from the isolated NAC Mac preview.') && ![...document.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === 'Stop run');")
        let assets = try await js(#"""
        await document.fonts.ready;
        await document.fonts.load('16px Inter');
        const resources = performance.getEntriesByType('resource').map(e => e.name);
        return {resources, inter: document.fonts.check('16px Inter'), errors: __previewEvidence.errors,
                partial: __previewEvidence.partial, deltas: __previewEvidence.deltas,
                userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight]};
        """#) as! [String: Any]
        evidence["webkit"] = assets
        let resources = assets["resources"] as? [String] ?? []
        guard assets["inter"] as? Bool == true,
              resources.contains(where: { $0.contains("Inter") && $0.contains(".woff2") }),
              resources.filter({ $0.contains("/assets/dist/assets/") && $0.hasSuffix(".js") }).count >= 2,
              resources.allSatisfy({ URL(string: $0)?.host == "127.0.0.1" }),
              (assets["errors"] as? [String])?.isEmpty == true else {
            throw PreviewError.message("Production fonts/chunks/local resources or JS errors failed: \(assets)")
        }
        try await captureWeb("streamed-chat.png")
        // Reload the actual production document: transcript must come from Rust persistence.
        _ = try await js("window.__previewReloading = true; return true;")
        app.webView.reload()
        try await waitJS("persisted transcript after reload", "return !window.__previewReloading && document.body.innerText.includes('Hello from the isolated NAC Mac preview.');")
        evidence["persisted_reload"] = true
        let persisted = try await js("return await (await fetch('/sessions/' + location.hash.split('/')[2])).json();")
        guard let stored = persisted as? [String: Any],
              let messages = stored["messages"] as? [[String: Any]],
              messages.contains(where: { $0["role"] as? String == "assistant" &&
                  String(describing: $0["content"] ?? "").contains(FixtureProvider.answer) }) else {
            throw PreviewError.message("Reload did not expose the persisted assistant transcript")
        }
        evidence["persisted_assistant_message"] = true
        try await settleReloadCapture(sessionID: sessionID)
        try await captureWeb("persisted-chat.png")
        if ["ci-terminal", "ci-terminal-xctest"].contains(scenario) {
            let ready: (([String: Any]) -> Void)? = scenario == "ci-terminal-xctest" ? { fields in
                self.evidence.merge(fields) { _, new in new }
                self.recordOwnership()
                self.write()
            } : nil
            evidence["trusted_terminal"] = try await CITerminal.run(app: app, sessionID: sessionID, externalReady: ready) {
                try await self.captureWeb("trusted-terminal.png")
            }
        }
        // Close with a real active run to exercise cancellation and server settlement.
        try await sendPrompt("MAC_PREVIEW_CLOSE_ACTIVE")
        try await wait("second provider request") { self.app.provider.responseCount == 2 }
        evidence["close_with_active_run"] = true
    }

    // Fixture observations only: wait for the shared transcript owner to reveal
    // its content and finish its fade, rather than changing its loading policy.
    private static let captureReadiness = #"""
    const matches = () => location.origin === new URL(expectedOrigin).origin
      && location.hash.split('/')[2] === expectedSession;
    if (phase === 'bind') {
      if (!matches() || window.__previewReloading) return {ready:false, reason:'document'};
      const binding = {token:documentToken, document, href:location.href,
        fontsReady:false, paintReady:false, framesPending:false};
      window.__previewCapture = binding;
      Promise.all([document.fonts.ready, document.fonts.load('16px Inter')]).then(
        () => { binding.fontsReady = true; }, () => { binding.fontFailed = true; });
      return {ready:false, reason:'bound'};
    }
    const binding = window.__previewCapture;
    const visible = element => {
      if (!(element instanceof Element) || !element.isConnected) return false;
      const r = element.getBoundingClientRect();
      if (![r.left,r.top,r.right,r.bottom,r.width,r.height].every(Number.isFinite)
          || r.width <= 0 || r.height <= 0 || r.right <= 0 || r.bottom <= 0
          || r.left >= innerWidth || r.top >= innerHeight) return false;
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility !== 'visible'
            || Number(style.opacity) !== 1) return false;
      }
      return true;
    };
    const inspect = () => {
      if (!matches() || window.__previewReloading || !binding
          || window.__previewCapture !== binding || binding.token !== documentToken
          || binding.document !== document || binding.href !== location.href)
        return {ready:false, reason:'document'};
      if (!binding.fontsReady || binding.fontFailed || document.fonts.status !== 'loaded'
          || !document.fonts.check('16px Inter')) return {ready:false, reason:'fonts'};
      const answers = [...document.querySelectorAll('p')]
        .filter(node => node.textContent === expectedAnswer);
      const inputs = [...document.querySelectorAll('[role=combobox][aria-label=Message]')];
      if (answers.length !== 1 || inputs.length !== 1)
        return {ready:false, reason:'content', answers:answers.length, inputs:inputs.length};
      const loading = [...document.querySelectorAll('[role=status][aria-label="Loading conversation"]')]
        .some(node => node.parentElement?.contains(answers[0]));
      if (loading) return {ready:false, reason:'loading'};
      if (!visible(answers[0]) || !visible(inputs[0])) return {ready:false, reason:'layout'};
      return {ready:true, reason:'settled'};
    };
    const state = inspect();
    if (!state.ready) {
      if (binding) binding.paintReady = false;
      return state;
    }
    if (binding.paintReady) return state;
    if (!binding.framesPending) {
      binding.framesPending = true;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        binding.framesPending = false;
        binding.paintReady = inspect().ready;
      }));
    }
    return {ready:false, reason:'frames'};
    """#

    private func settleReloadCapture(sessionID: String) async throws {
        let view = app.webView!
        guard let base = app.baseURL, let incarnation = app.engine.receipt?.incarnation else {
            throw PreviewError.message("Reload capture lost its owned engine")
        }
        let token = UUID().uuidString
        func observe(_ phase: String) async throws -> [String: Any] {
            guard app.webView === view, app.engine.receipt?.incarnation == incarnation else {
                throw PreviewError.message("Reload capture lost its owned document")
            }
            let value = try await view.callAsyncJavaScript(Self.captureReadiness,
                arguments: ["phase": phase, "expectedSession": sessionID,
                            "expectedOrigin": base.absoluteString, "expectedAnswer": FixtureProvider.answer,
                            "documentToken": token], in: nil, contentWorld: .page)
            guard let facts = value as? [String: Any] else {
                throw PreviewError.message("Reload capture readiness was malformed")
            }
            return facts
        }
        _ = try await observe("bind")
        try await wait("settled persisted transcript capture") {
            let facts = try await observe("probe")
            self.evidence["persisted_capture_readiness"] = facts
            return facts["ready"] as? Bool == true
        }
    }

    private func sendPrompt(_ prompt: String) async throws {
        _ = try await js("""
        const input = document.querySelector('[role=combobox][aria-label=Message]');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(input, '\(prompt)');
        input.dispatchEvent(new Event('input', {bubbles:true}));
        return true;
        """)
        try await waitJS("enabled Send button", "return !!document.querySelector('button[aria-label=Send]:not(:disabled)');")
        _ = try await js("document.querySelector('button[aria-label=Send]:not(:disabled)').click(); return true;")
    }

    private func js(_ source: String) async throws -> Any {
        try await app.webView.callAsyncJavaScript(source, arguments: [:], in: nil, contentWorld: .page) ?? NSNull()
    }
    private func waitJS(_ label: String, _ source: String) async throws {
        try await wait(label) { (try? await self.js(source)) as? Bool == true }
    }
    private func wait(_ label: String, timeout: TimeInterval = 25, _ condition: () async throws -> Bool) async throws {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            recordOwnership()
            if try await condition() { return }
            if app.failure != nil && ["normal", "ci-terminal", "ci-terminal-xctest"].contains(scenario) { throw PreviewError.message(app.failure!) }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw PreviewError.message("Timed out waiting for \(label)")
    }

    // Only closed fixture stage names, booleans and the existing redacted counts.
    // A false observation never asserts that an engine was never launched.
    private func recordOfflineDiagnostic() {
        guard scenario == "offline-api-key" else { return }
        let previous = evidence["offline_diagnostic"] as? [String: Any] ?? [:]
        let next: [String: Any] = [
            "phase": evidence["offline_phase"] as? String ?? "await_workspace",
            "network_stage": offline?.diagnosticStage ?? "not_created",
            "fence_created": offline != nil,
            "startup_failure_observed": app.failure != nil,
            "engine_pid_observed_positive": previous["engine_pid_observed_positive"] as? Bool == true || app.engine.pid > 0,
            "ready_receipt_observed": previous["ready_receipt_observed"] as? Bool == true || app.engine.receipt != nil,
            "network_observations": offline?.policy.snapshot ?? [:]]
        if !NSDictionary(dictionary: previous).isEqual(to: next) {
            evidence["offline_diagnostic"] = next
            write()
        }
    }

    private func recordOwnership() {
        recordOfflineDiagnostic()
        let root = app.profile?.root.path
        guard evidence["engine_pid"] as? Int32 != app.engine.pid || evidence["profile"] as? String != root else { return }
        evidence["engine_pid"] = app.engine.pid
        evidence["profile"] = root
        write()
    }

    private func captureWeb(_ name: String) async throws {
        evidence["frontmost_at_capture"] = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        let image = try await app.webView.takeSnapshot(configuration: nil)
        try writePNG(image, name)
    }
    private func captureNative() throws {
        evidence["frontmost_at_capture"] = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        let view = app.window.contentView!
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else {
            throw PreviewError.message("Native failure capture unavailable")
        }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        guard let png = bitmap.representation(using: .png, properties: [:]) else {
            throw PreviewError.message("Native failure capture encoding failed")
        }
        try png.write(to: destination.deletingLastPathComponent().appendingPathComponent("\(scenario).png"))
    }
    private func writePNG(_ image: NSImage, _ name: String) throws {
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else {
            throw PreviewError.message("WKWebView snapshot encoding failed")
        }
        try png.write(to: destination.deletingLastPathComponent().appendingPathComponent(name))
    }
    func cleanupFailed(_ error: Error) { cleanupError = String(describing: error) }
    func didCleanUp() {
        if scenario != "offline-api-key" { evidence["engine_log_after_shutdown"] = app.engine.log }
        evidence["profile_removed"] = app.profile.map { !FileManager.default.fileExists(atPath: $0.root.path) } ?? true
        evidence["engine_reaped"] = app.engine.pid == 0
        evidence["identity_retired"] = app.engine.receipt == nil
        evidence["commands_retired"] = (app.commands?.smokeSnapshot["installed"] as? Bool ?? false) == false
        evidence["cleanup_error"] = cleanupError
        evidence["passed"] = passed && cleanupError == nil && evidence["profile_removed"] as? Bool == true
            && evidence["commands_retired"] as? Bool == true
        write()
    }
    private func write() {
        do {
            let data = try JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: destination, options: .atomic)
        } catch { fputs("Smoke evidence write failed: \(error)\n", stderr) }
    }
}
