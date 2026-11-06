#if PREVIEW_SMOKE
import AppKit
import WebKit
#if LOCAL_APP
import Darwin
#endif

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
    private var storageQ1Running = false
    #if LOCAL_APP
    private var storageQ1Ledger: [[String: Any]] = []
    private var storageQ1Owner: String?
    #endif

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
        #if LOCAL_APP
        if !storageQ1Running && take("storage-q1-seed") { storageQ1("seed") }
        if !storageQ1Running && take("storage-q1-restore") { storageQ1("restore") }
        #endif
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


    #if LOCAL_APP
    /// Private fixture actor through the existing React text/preference owners.
    /// It never submits, sends terminal input, or calls a domain mutation API.
    private func storageQ1(_ phase: String) {
        guard !storageQ1Running, let view = app.webView, let receipt = app.engine.receipt,
              let endpoint = receipt.endpoint,
              app.commands?.smokeSnapshot["ready"] as? Bool == true,
              let binding = app.commands?.smokeSnapshot["binding"] as? [String: Any],
              let launch = binding["launch"] as? String,
              let document = binding["document"] as? String,
              let viewID = binding["view"] as? String else { return }
        guard let bytes = try? StorageQ1PlanFile.read(control: control),
              let plan = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else {
            evidence["storage_q1"] = ["phase": phase, "status": "failed", "error": "Invalid bounded fixture plan"]
            publish()
            return
        }
        let generation = app.recovery.documentGeneration, enginePID = app.engine.pid
        guard app.canRecoverWorkspace, enginePID > 0 else { return }
        guard let nonce = plan["nonce"] as? String, UUID(uuidString: nonce) != nil,
              let sessionB = plan["b"] as? String,
              let profile = app.smokeProfileSnapshot["profile"] as? String else { return }
        guard let q1QuitLaunch = app.quit.launch else { return }
        WorkspaceStorage.smokeQ1Event = { [weak self, weak view] event, raw in
            guard let self, event["profile"] as? String == profile else { return }
            let current = self.app.commands?.smokeSnapshot["binding"] as? [String: Any]
            let live = view != nil && self.app.webView === view && self.app.canRecoverWorkspace &&
                self.app.recovery.documentGeneration == generation && self.app.engine.pid == enginePID &&
                self.app.engine.receipt?.incarnation == receipt.incarnation &&
                self.app.engine.receipt?.kind == receipt.kind && self.app.engine.receipt?.version == receipt.version &&
                self.app.engine.receipt?.stage == receipt.stage && self.app.engine.receipt?.code == receipt.code &&
                self.app.engine.receipt?.message == receipt.message &&
                self.app.engine.receipt?.endpoint == receipt.endpoint &&
                self.app.engine.receipt?.identity == receipt.identity &&
                self.app.engine.receipt?.store == receipt.store && self.app.engine.receipt?.schema == receipt.schema &&
                current?["launch"] as? String == launch && current?["view"] as? String == viewID &&
                current?["document"] as? String == document
            let finalFlush = event["kind"] as? String == "flush" && self.app.stopping &&
                self.app.engine.pid == 0 && self.evidence["engine_reaped"] as? Bool == true
            let draining: Bool = {
                guard self.app.stopping, self.storageQ1Owner != nil,
                      event["owner"] as? String == self.storageQ1Owner else { return false }
                // childExited clears lifecycle.launch; the immutable stop keeps its origin.
                switch self.app.quit.lifecycle.phase {
                case .stopping(let wait): return wait.stop.launch == q1QuitLaunch
                case .shutdownFailed(let stop), .finished(let stop): return stop.launch == q1QuitLaunch
                default: return false
                }
            }()
            guard live || draining else { return }
            let owner = event["owner"] as? String
            if self.storageQ1Owner == nil { self.storageQ1Owner = owner }
            guard owner == self.storageQ1Owner else { return }
            guard self.storageQ1Ledger.count < 96 else {
                self.evidence["storage_q1_overflow"] = true; self.publish(); return
            }
            var fact = event
            fact["nonce"] = nonce
            fact["launch"] = launch; fact["view"] = viewID; fact["document"] = document
            fact["generation"] = generation; fact["enginePID"] = enginePID
            fact["endpoint"] = endpoint; fact["terminalQuitFlush"] = finalFlush
            fact["quitDrain"] = draining
            if event["writeClass"] as? String == "ordinary",
               event["namespace"] as? String == "drafts", let raw,
               let data = raw.data(using: .utf8),
               let saved = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let rows = saved["drafts"] as? [[Any]] {
                fact["bPresent"] = rows.contains { $0.count >= 2 && $0[0] as? String == sessionB &&
                    ($0[1] as? String).map { !$0.isEmpty } == true }
            }
            self.storageQ1Ledger.append(fact)
            self.evidence["storage_q1_native_writes"] = self.storageQ1Ledger
            self.publish()
            // Retain observation through process exit; a late completion must remain visible.
        }
        storageQ1Running = true
        evidence["storage_q1"] = ["phase": phase, "status": "running"]
        publish()
        view.callAsyncJavaScript(Self.storageQ1Script,
            arguments: ["phase": phase, "plan": plan, "endpoint": endpoint,
                        "expected": ["launch": launch, "view": viewID, "document": document]],
            in: nil, in: .page) { [weak self, weak view] result in
            guard let self else { return }
            self.storageQ1Running = false
            let current = self.app.commands?.smokeSnapshot["binding"] as? [String: Any]
            guard let view, self.app.webView === view,
                  self.app.canRecoverWorkspace,
                  self.app.recovery.documentGeneration == generation, self.app.engine.pid == enginePID,
                  self.app.engine.receipt?.kind == receipt.kind, self.app.engine.receipt?.version == receipt.version,
                  self.app.engine.receipt?.stage == receipt.stage, self.app.engine.receipt?.code == receipt.code,
                  self.app.engine.receipt?.message == receipt.message,
                  self.app.engine.receipt?.endpoint == receipt.endpoint,
                  self.app.engine.receipt?.identity == receipt.identity,
                  self.app.engine.receipt?.store == receipt.store,
                  self.app.engine.receipt?.schema == receipt.schema,
                  self.app.engine.receipt?.incarnation == receipt.incarnation,
                  current?["launch"] as? String == launch,
                  current?["view"] as? String == viewID,
                  current?["document"] as? String == document else {
                self.evidence["storage_q1"] = ["phase": phase, "status": "retired"]
                self.publish()
                return
            }
            switch result {
            case .success(let value):
                self.evidence["storage_q1"] = value
            case .failure(let error):
                self.evidence["storage_q1"] = ["phase": phase, "status": "failed",
                                               "error": error.localizedDescription]
            }
            self.publish()
        }
    }

    private static let storageQ1Script = #"""
    const check = (value, message) => { if (!value) throw new Error(message); };
    check(['seed', 'restore'].includes(phase), 'Unknown storage fixture phase');
    check(plan.version === 1 && typeof plan.nonce === 'string' && typeof plan.aText === 'string' && typeof plan.bText === 'string' &&
      /^[a-f0-9-]{36}$/i.test(plan.a) && /^[a-f0-9-]{36}$/i.test(plan.b) && plan.a !== plan.b &&
      plan.aText.length < 4096 && plan.bText.length < 4096, 'Invalid fixed fixture plan');
    check(location.origin === new URL(endpoint).origin, 'Foreign engine origin');
    const deadline = performance.now() + 15000;
    const until = async predicate => {
      while (performance.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Storage Q1 UI observation timed out');
    };
    const port = await until(() => window.__nacDesktopStorage);
    const bootstrap = await Promise.race([port.open(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('No native storage bootstrap')), 1500))]);
    const same = value => value && ['launch', 'view', 'document'].every(key => value[key] === expected[key]);
    check(bootstrap.available && same(bootstrap.document) && bootstrap.endpoint === endpoint,
      'Unqualified native storage document');
    const acks = []; let acknowledgementOverflow = false;
    const unsubscribe = port.subscribe(ack => {
      if (same(ack.document)) {
        if (acks.length >= 64) acknowledgementOverflow = true;
        else acks.push(ack);
      }
    });
    const input = () => document.querySelector('textarea[role="combobox"][aria-label="Message"]');
    const go = async id => {
      const target = '#/session/' + id + '/files', previous = input(), oldRoute = location.hash;
      location.hash = target;
      await until(() => location.hash === target &&
        !document.querySelector('[aria-label="Loading conversation"]') && input() &&
        (oldRoute === target || input() !== previous));
    };
    const fill = async text => {
      const element = input(); check(element, 'Missing current composer');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(element, text);
      element.dispatchEvent(new Event('input', {bubbles: true}));
      await until(() => input()?.value === text);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    const button = name => [...document.querySelectorAll('button')].find(element =>
      element.getAttribute('aria-label') === name || element.textContent.trim() === name);
    const delivery = () => document.querySelector('[aria-label="Message delivery"]');
    const restore = () => [...(delivery()?.querySelectorAll('button') || [])]
      .find(element => element.textContent.trim() === 'Restore to composer');
    try {
      if (phase === 'seed') {
        if (!button('Hide sidebar')) { const show = button('Show sidebar'); check(show, 'No sidebar action'); show.click(); }
        await until(() => button('Hide sidebar'));
        button('Hide sidebar').click();
        await until(() => button('Show sidebar'));
        await go(plan.a); await fill(plan.aText);
        await go(plan.b); check(input().value === '', 'Session B inherited A');
        await fill(plan.bText);
        await go(plan.a); await until(() => input().value === plan.aText);
        await go(plan.b); await until(() => input().value === plan.bText);
        await fill('');
        await go(plan.a); await until(() => input().value === plan.aText);
      } else {
        check(button('Show sidebar'), 'Same-profile sidebar preference was not restored');
        await go(plan.b);
        check(input().value === '' && !delivery(), 'Cleared session B returned as a draft/review');
        await go(plan.a);
        await until(() => input().value === '' && [...(delivery()?.querySelectorAll('p') || [])].some(p => p.textContent === plan.aText) &&
          delivery()?.textContent.includes('Recovered text may be stale or already sent.'));
        const fresh = 'fresh unsent Q1 text';
        await fill(fresh);
        await until(() => restore()?.disabled === true);
        check(input().value === fresh, 'Cold review overwrote a fresh draft');
        await fill('');
        await until(() => restore() && !restore().disabled);
        restore().click();
        await until(() => input().value === plan.aText && !delivery());
      }
      check(!acknowledgementOverflow, 'Storage acknowledgement evidence overflow');
      check(!acks.some(ack => ack.durable !== true), 'Observed native storage durability failure');
      // This is UI evidence only. The external case still requires the exact
      // current owner flush barrier plus matching read-only checkpoint witness.
      return {phase, status: 'ui-passed-awaiting-durability', document: expected, binding: bootstrap.binding,
        a: plan.a, b: plan.b, aValue: input().value, clearedB: true,
        sidebarClosed: !!button('Show sidebar'), acknowledgements: acks,
        noSubmitActionInvoked: true, trustedInput: false};
    } finally { unsubscribe(); }
    """#
    #endif


    #if LOCAL_APP
    private enum StorageQ1PlanFile {
        static func read(control: URL) throws -> Data {
            let directory = open(control.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard directory >= 0 else { throw error() }
            defer { close(directory) }
            var ds = stat()
            guard fstat(directory, &ds) == 0, ds.st_uid == getuid(), ds.st_mode & 0o077 == 0 else { throw error() }
            let fd = openat(directory, "storage-q1.json", O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
            guard fd >= 0 else { throw error() }
            defer { close(fd) }
            var before = stat()
            guard fstat(fd, &before) == 0, before.st_mode & S_IFMT == S_IFREG,
                  before.st_uid == getuid(), before.st_nlink == 1, before.st_mode & 0o077 == 0,
                  before.st_size > 0, before.st_size <= 16_384 else { throw error() }
            var data = Data(), buffer = [UInt8](repeating: 0, count: 4096)
            while true {
                let n = Darwin.read(fd, &buffer, buffer.count)
                if n < 0 && errno == EINTR { continue }
                guard n >= 0 else { throw error() }
                if n == 0 { break }
                guard data.count + n <= 16_384 else { throw error() }
                data.append(contentsOf: buffer.prefix(n))
            }
            var after = stat(), entry = stat(), parent = stat()
            guard fstat(fd, &after) == 0,
                  fstatat(directory, "storage-q1.json", &entry, AT_SYMLINK_NOFOLLOW) == 0,
                  lstat(control.path, &parent) == 0,
                  before.st_dev == after.st_dev, before.st_ino == after.st_ino,
                  before.st_size == after.st_size,
                  before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
                  before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec,
                  before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec,
                  before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec,
                  entry.st_mode & S_IFMT == S_IFREG, entry.st_dev == before.st_dev, entry.st_ino == before.st_ino,
                  parent.st_mode & S_IFMT == S_IFDIR, parent.st_dev == ds.st_dev, parent.st_ino == ds.st_ino else { throw error() }
            return data
        }
        private static func error() -> NSError { NSError(domain: "StorageQ1Plan", code: 1) }
    }
    #endif

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
