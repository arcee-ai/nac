#if PREVIEW_SMOKE
import AppKit
import WebKit

/// Actual-app fixture controls, not trusted OS input or actual crash proof.
/// An approved external actuator must cause genuine renderer/engine process
/// loss. Callback injection and observations are explicitly labelled below.
@MainActor
final class RecoverySmoke {
    private unowned let app: PreviewApp
    private let output: URL
    private let control: URL
    private var timer: Timer?
    private var seen: Set<String> = []
    private weak var originalView: WKWebView?
    private var evidence: [String: Any] = [:]
    private var capturing = false
    private var baselinePID: Int32 = 0
    private var baselineLaunch: String?
    private var baselineBinding: [String: Any]?
    private var baselineResponses = 0
    private var profileOpenWaiters: [UUID: CheckedContinuation<Void, Never>] = [:]
    private var publicationSequence = 0

    init(app: PreviewApp) {
        self.app = app
        let args = CommandLine.arguments
        func value(_ key: String) -> URL { URL(fileURLWithPath: args[args.firstIndex(of: key)! + 1]) }
        output = value("--recovery-output")
        control = value("--recovery-control")
        originalView = app.webView
        app.webView.configuration.userContentController.addUserScript(Self.script)
        #if LOCAL_APP
        WorkspaceStorage.smokeBeforeOpen = { [weak self] profile in
            guard let self else { return }
            await self.holdProfileOpen(profile)
        }
        WorkspaceStorage.smokeDidOpen = { [weak self] _ in
            guard let self else { return }
            self.evidence["profile_open_completed_calls"] = (self.evidence["profile_open_completed_calls"] as? Int ?? 0) + 1
            self.publish()
        }
        #endif
    }

    private func holdProfileOpen(_ profile: WorkspaceStorageProfile) async {
        evidence["profile_open_calls"] = (evidence["profile_open_calls"] as? Int ?? 0) + 1
        evidence["expected_profile"] = profile.digest
        evidence["expected_website_store"] = profile.identifier.uuidString
        guard FileManager.default.fileExists(atPath: control.appendingPathComponent("profile-open-hold").path) else { return }
        let token = UUID()
        await withCheckedContinuation { continuation in
            profileOpenWaiters[token] = continuation
            evidence["profile_open_pending"] = true
            publish()
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
                guard let self, let waiting = self.profileOpenWaiters.removeValue(forKey: token) else { return }
                self.evidence["profile_open_timeout"] = true
                self.evidence["profile_open_pending"] = !self.profileOpenWaiters.isEmpty
                waiting.resume()
                self.publish()
            }
        }
        evidence["profile_open_pending"] = !profileOpenWaiters.isEmpty
        publish()
    }

    private func releaseProfileOpen() {
        let waiters = profileOpenWaiters.values
        profileOpenWaiters.removeAll()
        evidence["profile_open_pending"] = false
        waiters.forEach { $0.resume() }
    }

    static func launchArguments(_ arguments: [String]) -> [String] {
        var result: [String] = [], index = 0
        while index < arguments.count {
            if ["--recovery-output", "--recovery-control"].contains(arguments[index]) { index += 2 }
            else { result.append(arguments[index]); index += 1 }
        }
        return result
    }

    static var script: WKUserScript {
        WKUserScript(source: #"""
        (() => {
          if (window !== window.top) return;
          const actual = window.fetch.bind(window), rows = [];
          let drop = false;
          window.__nacRecoveryEvidence = Object.freeze({
            rows: () => rows.slice(), dropCommandResponse: () => { drop = true; }
          });
          window.fetch = async (input, init) => {
            const response = await actual(input, init);
            const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
            const method = (init?.method || input?.method || 'GET').toUpperCase();
            if (rows.length < 128) rows.push({path, method, status: response.status});
            if (drop && method === 'POST' && path.endsWith('/user-commands') && response.ok) {
              drop = false;
              throw new TypeError('Recovery fixture dropped one successful command response');
            }
            return response;
          };
        })();
        """#, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    func start() {
        evidence["fixture"] = "ALL-345"
        evidence["app_pid"] = getpid()
        evidence["control_actor_qualified"] = false
        evidence["trusted_input_proven"] = false
        evidence["actual_renderer_crash_proven"] = false
        timer = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
        RunLoop.main.add(timer!, forMode: .common)
        publish()
    }

    private func take(_ name: String) -> Bool {
        guard !seen.contains(name), FileManager.default.fileExists(atPath: control.appendingPathComponent(name).path) else { return false }
        seen.insert(name)
        evidence["actions"] = seen.sorted()
        return true
    }

    private func poll() {
        if take("baseline") {
            baselinePID = app.engine.pid
            baselineLaunch = app.engine.receipt?.incarnation
            baselineBinding = app.commands?.smokeSnapshot["binding"] as? [String: Any]
            originalView = app.webView
            #if !LOCAL_APP
            baselineResponses = app.provider.responseCount
            #endif
            evidence["baseline"] = ["pid": baselinePID, "launch": baselineLaunch ?? "", "binding": baselineBinding ?? [:]]
        }
        #if LOCAL_APP
        if take("engine-crash") {
            let current = app.commands?.smokeSnapshot["binding"] as? NSDictionary
            let bound = baselineBinding.map { current?.isEqual(to: $0) == true } == true
            let admitted = app.canRecoverWorkspace && baselinePID > 0 &&
                baselinePID == app.engine.pid && baselineLaunch != nil && bound &&
                app.commands?.smokeSnapshot["ready"] as? Bool == true
            let issued = baselineLaunch.map { admitted && app.engine.crashOwnedEngineForSmoke(expectedIncarnation: $0) } ?? false
            evidence["engine_fault_requested"] = issued
            evidence["engine_fault_refused"] = !issued
            evidence["fault_kind"] = "owned-engine-sigkill-request"
        }
        #endif
        #if !LOCAL_APP
        if take("provider-hold") { app.provider.holdResponses = true }
        if take("provider-release") { app.provider.releaseResponses() }
        evidence["provider_responses"] = app.provider.responseCount
        evidence["provider_barriers"] = app.provider.heldResponseCount
        evidence["profile"] = app.profile?.root.path
        #endif
        if take("connection-loss"), let view = app.webView {
            evidence["fault_kind"] = "page-reported-connection-loss"
            view.callAsyncJavaScript("""
                if (typeof window.__nacDesktop?.reportConnectionLost !== 'function') throw new Error('Connection port unavailable');
                window.__nacDesktop.reportConnectionLost(); return true;
                """, arguments: [:], in: nil, in: .page) { [weak self] result in
                    if case .success = result { self?.evidence["connection_loss_script_reply"] = true }
                    else { self?.evidence["connection_loss_script_reply"] = false }
                    self?.publish()
                }
        }
        if take("renderer-callback"), let view = app.webView {
            evidence["fault_kind"] = "delegate-injection"
            app.webViewWebContentProcessDidTerminate(view)
        }
        for index in 1...4 {
            if take("renderer-callback-\(index)"), let view = app.webView {
                evidence["fault_kind"] = "delegate-injection"
                app.webViewWebContentProcessDidTerminate(view)
            }
        }
        if take("late-original-callback"), let originalView {
            app.webViewWebContentProcessDidTerminate(originalView)
            evidence["late_callback_delivered"] = true
        }
        if take("reload") { app.recovery.smokeReload() }
        for index in 1...3 { if take("reload-\(index)") { app.recovery.smokeReload() } }
        if take("restart-request") { app.recovery.smokeRestartConfirmation() }
        if take("restart-cancel") { app.recovery.smokeAnswerRestart(stop: false) }
        if take("restart-confirm") { app.recovery.smokeAnswerRestart(stop: true) }
        if take("profile-open-release") { releaseProfileOpen() }
        if take("profile-open-common-failure") { app.smokeProfileFailure() }
        if take("sleep-notification") {
            evidence["sleep_before_base_url"] = app.baseURL == nil
            evidence["wake_kind"] = "callback-injection"
            app.recovery.smokeSleep()
        }
        if take("wake-notification") { app.recovery.smokeWake() }
        if take("drop-command-response"), let view = app.webView {
            view.callAsyncJavaScript("window.__nacRecoveryEvidence.dropCommandResponse()", arguments: [:], in: nil, in: .page)
        }
        if take("capture") { capture() }
        if take("assert-renderer-recovered") { assertRenderer() }
        if take("assert-engine-restarted") { assertRestart() }
        if take("stop") {
            #if LOCAL_APP
            app.quit.stopFixture()
            #else
            NSApp.terminate(nil)
            #endif
        }
        publish()
    }

    private func assertRenderer() {
        let current = app.commands?.smokeSnapshot["binding"] as? [String: Any]
        let passed = baselinePID > 0 && baselineLaunch != nil && baselineBinding != nil && app.engine.pid == baselinePID &&
            app.engine.receipt?.incarnation == baselineLaunch && originalView == nil && app.webView != nil &&
            current?["view"] as? String != baselineBinding?["view"] as? String &&
            current?["document"] as? String != baselineBinding?["document"] as? String &&
            app.commands?.smokeSnapshot["ready"] as? Bool == true &&
            !app.recovery.needsRecovery && !app.recovery.busy
        evidence["renderer_owner_assertion"] = passed
        #if !LOCAL_APP
        evidence["no_extra_provider_dispatch_assertion"] = app.provider.responseCount == baselineResponses
        #endif
        if !passed { evidence["assertion_failure"] = "Renderer replacement changed engine or failed view/document retirement." }
        // This is deliberately narrower than actual-crash + active-run +
        // canonical-transcript acceptance, which the approved actor must prove.
        evidence["assertion_scope"] = "native-view-and-owned-engine"
    }

    private func assertRestart() {
        let passed = baselineLaunch != nil && baselineBinding != nil && app.engine.pid > 0 &&
            app.engine.receipt?.incarnation != baselineLaunch && originalView == nil &&
            app.recovery.engineStateLost && app.commands?.smokeSnapshot["ready"] as? Bool == true
        evidence["restart_owner_assertion"] = passed
        if !passed { evidence["assertion_failure"] = "Explicit restart reused launch/view or lost its terminal-loss notice." }
    }

    private func capture() {
        guard !capturing, let view = app.webView else { return }
        capturing = true
        view.callAsyncJavaScript("return {requests: window.__nacRecoveryEvidence?.rows(), runtime: document.querySelector('[data-nac-runtime]')?.getAttribute('data-nac-runtime'), route: location.hash, storage_capability: typeof window.__nacDesktopStorage === 'object'}",
            arguments: [:], in: nil, in: .page) { [weak self, weak view] result in
            guard let self else { return }
            self.capturing = false
            guard let view, self.app.webView === view else {
                self.evidence["capture_retired"] = true; return
            }
            if case .success(let value) = result { self.evidence["document"] = value }
            if case .failure(let error) = result { self.evidence["capture_error"] = error.localizedDescription }
            self.publish()
        }
    }

    func didStop() {
        timer?.invalidate()
        timer = nil
        releaseProfileOpen()
        #if LOCAL_APP
        WorkspaceStorage.smokeBeforeOpen = nil
        WorkspaceStorage.smokeDidOpen = nil
        #endif
        evidence["engine_reaped"] = app.engine.pid == 0
        evidence["identity_retired"] = app.engine.receipt == nil
        evidence["workspace_released"] = app.webView == nil
        #if !LOCAL_APP
        evidence["profile_removed"] = app.profile.map { !FileManager.default.fileExists(atPath: $0.root.path) }
        #endif
        publish()
    }

    private func publish() {
        publicationSequence += 1
        evidence["publication_sequence"] = publicationSequence
        evidence["profile_storage"] = app.smokeProfileSnapshot
        evidence["recovery"] = app.recovery.smokeSnapshot
        #if LOCAL_APP
        // Keep the old run's exact reap witness through the explicit successor.
        if let fact = app.engine.smokeFaultReceipt { evidence["engine_fault"] = fact }
        #endif
        evidence["engine_pid"] = app.engine.pid
        evidence["launch"] = app.engine.receipt?.incarnation
        evidence["endpoint"] = app.engine.receipt?.endpoint
        evidence["original_view_released"] = originalView == nil
        evidence["view"] = app.webView.map { String(describing: ObjectIdentifier($0)) }
        evidence["bridge"] = app.commands?.smokeSnapshot ?? ["installed": false]
        do { try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys, .prettyPrinted]).write(to: output, options: .atomic) }
        catch { fputs("Recovery fixture observation write failed: \(error)\n", stderr) }
    }
}
#endif
