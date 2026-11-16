import AppKit
import WebKit

/// Actual LOCAL_APP instrumentation, compiled only for the343 fixture bundle.
/// External controls live in this run's private fixture directory. They drive
/// native presentation/Retry; they grant no engine or execution authority.
@MainActor
final class InstanceSmoke {
    private let window: NSWindow
    private let currentView: () -> WKWebView?
    private let documentGeneration: () -> Int
    private var activeView: ViewBinding?
    private let engine: PreviewEngine
    private let conflicts: StoreConflictRetry
    private let retryButton: () -> NSButton?
    private let baseURL: () -> URL?
    private let failure: () -> String?
    private let requestQuit: () -> Void
    private var retiring = false
    private let output: URL
    private let control: URL
    private let scenario: String
    private let expectedStore: String
    private var evidence: [String: Any] = [:]
    private var reopenCount = 0
    private let fixtureIncarnation = UUID().uuidString

    init(window: NSWindow, currentView: @escaping () -> WKWebView?,
         documentGeneration: @escaping () -> Int, engine: PreviewEngine, conflicts: StoreConflictRetry,
         retryButton: @escaping () -> NSButton?, baseURL: @escaping () -> URL?, failure: @escaping () -> String?,
         requestQuit: @escaping () -> Void) {
        self.window = window
        self.currentView = currentView
        self.documentGeneration = documentGeneration
        self.engine = engine
        self.conflicts = conflicts
        self.retryButton = retryButton
        self.baseURL = baseURL
        self.failure = failure
        self.requestQuit = requestQuit
        let arguments = CommandLine.arguments
        func value(_ name: String) -> String {
            arguments[arguments.firstIndex(of: name)! + 1]
        }
        output = URL(fileURLWithPath: value("--instance-output"))
        control = URL(fileURLWithPath: value("--instance-control"))
        scenario = value("--instance-scenario")
        expectedStore = value("--instance-store")
    }

    /// Non-owning operation token: never keeps a retiring document alive.
    @MainActor private final class ViewBinding {
        weak var view: WKWebView?
        let generation: Int
        let run: String
        let enginePID: pid_t
        let receipt: EngineReceipt?
        init(view: WKWebView, generation: Int, run: String, enginePID: pid_t, receipt: EngineReceipt?) {
            self.view = view; self.generation = generation; self.run = run
            self.enginePID = enginePID; self.receipt = receipt
        }
    }

    /// The failed operation keeps its own weak view/receipt proof across reporting.
    private struct ViewOperationFailure: Error {
        let binding: ViewBinding
        let cause: Error
    }

    private func pinCurrentView() throws -> ViewBinding {
        try Task.checkCancellation()
        guard !retiring, let view = currentView() else { throw InstanceViewChanged() }
        return ViewBinding(view: view, generation: documentGeneration(), run: fixtureIncarnation,
                           enginePID: engine.pid, receipt: engine.receipt)
    }

    private func requireCurrentView(_ binding: ViewBinding) throws -> WKWebView {
        try Task.checkCancellation()
        guard !retiring, binding.run == fixtureIncarnation,
              binding.generation == documentGeneration(),
              let view = binding.view, view === currentView(),
              engine.pid == binding.enginePID, sameReceipt(engine.receipt, binding.receipt) else {
            throw InstanceViewChanged()
        }
        return view
    }

    private func requireActiveView() throws {
        guard let activeView else { throw InstanceViewChanged() }
        _ = try requireCurrentView(activeView)
    }

    private func sameReceipt(_ lhs: EngineReceipt?, _ rhs: EngineReceipt?) -> Bool {
        switch (lhs, rhs) {
        case (nil, nil): return true
        case let (lhs?, rhs?):
            return lhs.kind == rhs.kind && lhs.version == rhs.version && lhs.incarnation == rhs.incarnation &&
                lhs.endpoint == rhs.endpoint && lhs.identity == rhs.identity && lhs.store == rhs.store &&
                lhs.schema == rhs.schema && lhs.stage == rhs.stage && lhs.code == rhs.code && lhs.message == rhs.message
        default: return false
        }
    }

    static func launchArguments(_ arguments: [String]) -> [String] {
        var result: [String] = []
        var index = 0
        while index < arguments.count {
            if arguments[index].hasPrefix("--instance-") { index += 2 }
            else { result.append(arguments[index]); index += 1 }
        }
        return result
    }

    func start() {
        // Synchronous: PreviewApp calls this before creating its engine startup Task.
        evidence = ["scenario": scenario, "app_pid": getpid(), "passed": false,
                    "instrumentation": "INSTANCE_SMOKE", "expected_store": expectedStore]
        publish("starting")
        Task {
            var failureBinding: ViewBinding?
            do {
                if scenario == "conflict" { try await conflictJourney() }
                else { try await workspaceJourney() }
                try await command("finish")
                try requireActiveView()
                evidence["passed"] = true
                publish("finished")
            } catch {
                guard let binding = await reportWorkspaceFailure(error) else { return }
                failureBinding = binding
            }
            guard let finishBinding = failureBinding ?? activeView,
                  (try? requireCurrentView(finishBinding)) != nil else { return }
            RunLoop.main.perform(inModes: [.common]) { [self] in
                // Keep the operation token through the prefix's existing
                // native Quit owner, including its queued callback.
                MainActor.assumeIsolated {
                    guard (try? requireCurrentView(finishBinding)) != nil else { return }
                    requestQuit()
                }
            }
        }
    }

    func didReopen() {
        reopenCount += 1
        evidence["reopen_count"] = reopenCount
        write()
    }

    func didStop() {
        evidence["stopped"] = engine.pid == 0 && engine.receipt == nil
        write(terminal: true)
    }

    func prepareForStop() { retiring = true; activeView = nil }

    private func workspaceJourney() async throws {
        try await readyWorkspace()
        let firstPID = engine.pid
        guard let firstReceipt = engine.receipt, !retiring else { throw InstanceFixtureError("Workspace retired before reopen") }
        let firstWindow = window.windowNumber
        try await capture("workspace")
        publish("ready")
        try await command("minimize")
        guard NSApp.isActive, window.isKeyWindow else {
            throw InstanceFixtureError("User focus changed before fixture minimization")
        }
        window.miniaturize(nil)
        try await wait("miniaturized native window") { self.window.isMiniaturized }
        try requireActiveView()
        let count = reopenCount
        publish("miniaturized")
        try await wait("LaunchServices reopens the existing window") {
            self.reopenCount > count && !self.window.isMiniaturized && self.window.isVisible
        }
        try requireActiveView()
        guard engine.pid == firstPID, engine.receipt?.incarnation == firstReceipt.incarnation,
              window.windowNumber == firstWindow else {
            throw InstanceFixtureError("Reopen replaced the window or serving engine")
        }
        evidence["same_window_reopened"] = true
        evidence["same_engine_reopened"] = true
        try await capture("reopened")
        publish("reopened")
    }

    private func conflictJourney() async throws {
        try await readyConflict()
        guard let first = conflicts.episode, !retiring else { throw InstanceFixtureError("Conflict retired before retry") }
        try await capture("conflict")
        publish("conflict")
        try await command("retry-live")
        try clickRetry()
        try await wait("retry while original owner lives returns a new conflict") {
            self.conflicts.episode?.id != nil &&
            self.conflicts.episode?.id != first.id && self.conflicts.canRetry
        }
        try await readyConflict()
        evidence["live_owner_retry_remained_conflict"] = true
        publish("live-retry-conflict")
        try await command("retry-exited")
        try clickRetry()
        try await readyWorkspace()
        evidence["retry_loaded_same_store"] = true
        try await capture("retry-workspace")
        publish("retry-ready")
    }

    private func readyConflict() async throws {
        try await wait("retired conflicting app attempt with native Retry") {
            self.conflicts.canRetry && self.engine.pid == 0
        }
        guard let conflict = conflicts.episode?.conflict,
              conflict.canonicalStore == expectedStore,
              engine.receipt == nil, baseURL() == nil, currentView()?.isHidden == true,
              retryButton()?.isEnabled == true else {
            throw InstanceFixtureError("Conflict activated a workspace or lost its canonical store binding")
        }
        let text = window.contentView!.subviews.compactMap { ($0 as? NSTextField)?.stringValue }.joined(separator: "\n")
        guard text.contains("Another NAC process"), text.contains(expectedStore),
              text.contains("--store-path") else {
            throw InstanceFixtureError("Native conflict omitted owner or deliberate recovery guidance")
        }
        activeView = try pinCurrentView()
        evidence["native_conflict"] = text
        evidence["conflict_track"] = conflict.track
        evidence["workspace_not_activated_during_conflict"] = true
    }

    private func clickRetry() throws {
        guard NSApp.isActive, window.isKeyWindow else {
            throw InstanceFixtureError("User focus changed before fixture Retry")
        }
        guard let button = retryButton(), button.isEnabled,
              engine.pid == 0, engine.receipt == nil else {
            throw InstanceFixtureError("Native Retry was available before failed child retirement")
        }
        button.performClick(nil)
    }

    private func readyWorkspace() async throws {
        var operationBinding: ViewBinding?
        do {
            let deadline = ProcessInfo.processInfo.systemUptime + 45
            try await wait("identified system WKWebView workspace", timeout: 45) {
                guard self.currentView()?.isHidden == false, let receipt = self.engine.receipt else { return false }
                return receipt.store == self.expectedStore && self.failure() == nil
            }
            guard let receipt = engine.receipt, let origin = workspaceOrigin(baseURL()) else {
                throw InstanceFixtureError("Workspace lost its identified loopback origin")
            }
            let binding = try pinCurrentView()
            operationBinding = binding
            var ready = false
            var observationErrors: [String] = []
            var observationErrorCount = 0
            while ProcessInfo.processInfo.systemUptime < deadline {
                try requireWorkspaceBinding(binding, incarnation: receipt.incarnation, origin: origin)
                let remaining = deadline - ProcessInfo.processInfo.systemUptime
                guard remaining > 0 else { break }
                var observation: [String: Any]?
                var decoded: InstanceWorkspaceObservation?
                do {
                    let value = try await observeWorkspace(binding, origin: origin, timeout: min(1, remaining))
                    try requireWorkspaceBinding(binding, incarnation: receipt.incarnation, origin: origin)
                    observation = value
                    guard let parsed = decodeInstanceWorkspaceObservation(value) else {
                        evidence["workspace_observation"] = value
                        throw InstanceFixtureError("Malformed workspace observation; readiness remains unknown")
                    }
                    decoded = parsed
                } catch {
                    try requireWorkspaceBinding(binding, incarnation: receipt.incarnation, origin: origin)
                    observationErrorCount += 1
                    let cause = String(error.localizedDescription.prefix(1500))
                    if observationErrors.count < 16 { observationErrors.append(cause) }
                    evidence["workspace_observation_errors"] = observationErrors
                    evidence["workspace_observation_error_count"] = observationErrorCount
                    evidence["workspace_observation_last_error"] = cause
                    write()
                }
                if let observation { evidence["workspace_observation"] = observation; write() }
                // A failed read grants no authority to continue after native retirement.
                try requireWorkspaceBinding(binding, incarnation: receipt.incarnation, origin: origin)
                if let observation {
                    if let errors = observation["errors"] as? [Any], !errors.isEmpty {
                        throw InstanceFixtureError("Production workspace reported JavaScript or resource errors")
                    }
                    if ProcessInfo.processInfo.systemUptime < deadline,
                       readyWorkspaceObservation(decoded, origin: origin), !(try requireCurrentView(binding)).isLoading {
                        ready = true
                        break
                    }
                }
                let pause = min(0.05, deadline - ProcessInfo.processInfo.systemUptime)
                if pause > 0 { try await Task.sleep(nanoseconds: UInt64(pause * 1_000_000_000)) }
            }
            guard ready else {
                throw InstanceFixtureError("Timed out waiting for the identified production workspace semantics")
            }
            try requireWorkspaceBinding(binding, incarnation: receipt.incarnation, origin: origin)
            activeView = binding
            evidence["launch_incarnation"] = receipt.incarnation
            evidence["ready_store"] = receipt.store
            evidence["ready_schema"] = receipt.schema
            if let identity = receipt.identity {
                evidence["engine_identity"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(identity))
            }
            evidence["workspace_activated"] = true
        } catch {
            if error is InstanceViewChanged || error is CancellationError { throw error }
            let binding: ViewBinding
            if let operationBinding { binding = operationBinding }
            else {
                // No DOM callback was issued before readiness admission. Record
                // only the current view at this synchronous wait-failure boundary.
                binding = try pinCurrentView()
            }
            _ = try requireCurrentView(binding)
            throw ViewOperationFailure(binding: binding, cause: error)
        }
    }

    private func requireWorkspaceBinding(_ binding: ViewBinding, incarnation: String, origin: String) throws {
        let webView = try requireCurrentView(binding)
        guard !retiring, engine.pid > 0, engine.receipt?.incarnation == incarnation,
              engine.receipt?.store == expectedStore, failure() == nil,
              !webView.isHidden, window.isVisible,
              workspaceOrigin(baseURL()) == origin, workspaceOrigin(webView.url) == origin,
              webView.url?.path == "/" else {
            throw InstanceFixtureError("Workspace lost its serving binding or native presentation while loading")
        }
    }

    private func readyWorkspaceObservation(_ value: InstanceWorkspaceObservation?, origin: String) -> Bool {
        guard let value, value.ready, value.diagnostics_installed, value.errors?.isEmpty == true,
              value.ready_state == "complete", value.body_length > 80, value.body_text.utf16.count > 80,
              !value.body_text.contains("Internal Server Error"), !value.root_html.isEmpty,
              let semantic = value.semantic, ["empty-onboarding", "drain-fixture-project"].contains(semantic),
              let url = URL(string: value.url), workspaceOrigin(url) == origin, url.path == "/",
              ["", "/"].contains(url.fragment ?? "") else { return false }
        return true
    }

    /// Called for BOTH actual construction paths before the first product load.
    static func configure(_ webView: WKWebView) {
        webView.customUserAgent = "NACInstanceSmoke/ALL-343 AppleWebKit/605.1.15"
        if !webView.configuration.userContentController.userScripts.contains(where: { $0.source == Self.workspaceDiagnosticsScript }) {
            webView.configuration.userContentController.addUserScript(WKUserScript(
                source: Self.workspaceDiagnosticsScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
    }

    private func workspaceOrigin(_ url: URL?) -> String? {
        guard let url, url.scheme == "http", url.host == "127.0.0.1", let port = url.port,
              url.user == nil, url.password == nil else { return nil }
        return "http://127.0.0.1:\(port)"
    }

    private func observeWorkspace(_ binding: ViewBinding, origin: String, timeout: TimeInterval) async throws -> [String: Any] {
        try await withCheckedThrowingContinuation { continuation in
            let completion = InstanceWorkspaceCompletion<[String: Any]>(continuation, timeout: timeout,
                                                                        label: "workspace DOM observation")
            do {
                try requireCurrentView(binding).callAsyncJavaScript(Self.workspaceObservationScript,
                    arguments: ["expectedOrigin": origin], in: nil, in: .page) { [weak self] result in
                    do {
                        guard let self else { throw InstanceViewChanged() }
                        _ = try self.requireCurrentView(binding)
                        completion.finish(result.flatMap { value in
                            guard let record = value as? [String: Any] else {
                                return .failure(InstanceFixtureError("Workspace observation returned no object"))
                            }
                            return .success(record)
                        })
                    } catch { completion.finish(.failure(error)) }
                }
            } catch { completion.finish(.failure(error)) }
        }
    }

    private func reportWorkspaceFailure(_ error: Error) async -> ViewBinding? {
        guard !retiring, !Task.isCancelled,
              !(error is InstanceViewChanged), !(error is CancellationError) else { return nil }
        let binding: ViewBinding
        let cause: Error
        if let operation = error as? ViewOperationFailure {
            binding = operation.binding
            cause = operation.cause
        } else {
            // Non-readiness operations retain their existing active-view fence.
            guard let current = activeView ?? (try? pinCurrentView()) else { return nil }
            binding = current
            cause = error
        }
        guard (try? requireCurrentView(binding)) != nil else { return nil }
        evidence["error"] = cause.localizedDescription
        guard await recordWorkspaceFailure(binding) else { return nil }
        guard (try? requireCurrentView(binding)) != nil else { return nil }
        publish("failed", binding: binding)
        return binding
    }

    private func recordWorkspaceFailure(_ operation: ViewBinding? = nil) async -> Bool {
        guard let binding = operation ?? activeView ?? (try? pinCurrentView()),
              (try? requireCurrentView(binding)) != nil else { return false }
        do {
            let webView = try requireCurrentView(binding)
            evidence["workspace_failure_native"] = [
                "url": webView.url?.absoluteString ?? "", "loading": webView.isLoading,
                "hidden": webView.isHidden, "window_visible": window.isVisible,
                "engine_log_tail": String(engine.log.suffix(4000)), "native_failure": String((failure() ?? "").prefix(2000))]
        } catch { return false }
        do {
            let value = try await observeWorkspace(binding, origin: workspaceOrigin(baseURL()) ?? "", timeout: 1)
            _ = try requireCurrentView(binding)
            evidence["workspace_failure_dom"] = value
        } catch {
            guard (try? requireCurrentView(binding)) != nil else { return false }
            evidence["workspace_failure_dom_error"] = error.localizedDescription
        }
        do {
            let image: NSImage = try await withCheckedThrowingContinuation { continuation in
                let completion = InstanceWorkspaceCompletion<NSImage>(continuation, timeout: 2, label: "failure WK snapshot")
                do {
                    try requireCurrentView(binding).takeSnapshot(with: nil) { [weak self] image, error in
                        do {
                            guard let self else { throw InstanceViewChanged() }
                            _ = try self.requireCurrentView(binding)
                            if let image { completion.finish(.success(image)) }
                            else { completion.finish(.failure(error ?? InstanceFixtureError("Failure WK snapshot unavailable"))) }
                        } catch { completion.finish(.failure(error)) }
                    }
                } catch { completion.finish(.failure(error)) }
            }
            _ = try requireCurrentView(binding)
            guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                  let png = bitmap.representation(using: .png, properties: [:]) else {
                throw InstanceFixtureError("Failure WK snapshot encoding unavailable")
            }
            try validateWorkspaceSnapshotSize(png)
            let name = "workspace-failure.png"
            try png.write(to: output.deletingLastPathComponent().appendingPathComponent(name), options: .atomic)
            evidence["workspace_failure_snapshot"] = ["file": name, "kind": "actual WKWebView snapshot"]
        } catch {
            guard (try? requireCurrentView(binding)) != nil else { return false }
            evidence["workspace_failure_snapshot_error"] = error.localizedDescription
        }
        guard (try? requireCurrentView(binding)) != nil else { return false }
        write(binding: binding)
        return true
    }

    private static let workspaceDiagnosticsScript = #"""
    (() => {
      const events = [];
      const append = (kind, message, url = '') => {
        if (events.length < 16) events.push({kind, message: String(message).slice(0, 1500), url: String(url).slice(0, 500)});
      };
      window.__nacInstanceWorkspace = {events};
      window.addEventListener('error', event => {
        const target = event.target;
        if (target && target !== window) append('resource-error', target.tagName || '', target.src || target.href || '');
        else append('javascript-error', event.message || '', event.filename || '');
      }, true);
      window.addEventListener('unhandledrejection', event => append('unhandled-rejection', event.reason?.stack || event.reason));
    })();
    """#

    private static let workspaceObservationScript = #"""
    const text = document.body?.innerText || '';
    const visible = element => {
      if (!element || ![...element.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) return false;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (ancestor.hasAttribute('hidden') || ancestor.hasAttribute('inert') ||
            ancestor.getAttribute('aria-hidden')?.trim().toLowerCase() === 'true' ||
            style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) !== 1) return false;
      }
      return true;
    };
    const buttons = [...document.querySelectorAll('button')];
    const empty = text.includes('No projects yet') && buttons.some(button =>
      button.innerText.trim() === 'Get Started' && !button.disabled && visible(button));
    const populated = [...document.querySelectorAll('[role="button"][data-item-kind="project"][data-item-id]')].some(card =>
      visible(card) && card.innerText.includes('Native instance drain fixture'));
    const events = window.__nacInstanceWorkspace?.events || [];
    const semantic = empty ? 'empty-onboarding' : populated ? 'drain-fixture-project' : null;
    return {
      ready: location.origin === expectedOrigin && location.pathname === '/' &&
        ['', '#', '#/'].includes(location.hash) && document.readyState === 'complete' &&
        !!window.__nacInstanceWorkspace &&
        !!document.getElementById('root')?.childElementCount && text.length > 80 &&
        !text.includes('Internal Server Error') && events.length === 0 && semantic !== null,
      url: location.href, ready_state: document.readyState, semantic, body_length: text.length,
      body_text: text.slice(0, 8000), root_html: (document.getElementById('root')?.outerHTML || '').slice(0, 4000),
      diagnostics_installed: !!window.__nacInstanceWorkspace,
      errors: window.__nacInstanceWorkspace ? events.slice(0, 16) : null,
      buttons: buttons.slice(0, 16).map(button => ({text: button.innerText.slice(0, 100),
        label: button.getAttribute('aria-label'), disabled: button.disabled, visible: visible(button)})),
      resources: performance.getEntriesByType('resource').slice(-24).map(resource => ({
        url: resource.name.slice(0, 500), kind: resource.initiatorType, duration_ms: resource.duration,
        response_status: Number.isFinite(resource.responseStatus) ? resource.responseStatus : null}))
    };
    """#

    private func command(_ name: String) async throws {
        let file = control.appendingPathComponent(name)
        try await wait("fixture control \(name)", timeout: 70) {
            FileManager.default.fileExists(atPath: file.path)
        }
        try requireActiveView()
        try FileManager.default.removeItem(at: file)
    }

    private func wait(_ label: String, timeout: TimeInterval = 35, _ predicate: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            guard !retiring else { throw InstanceFixtureError("Workspace retired while awaiting \(label)") }
            if predicate() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw InstanceFixtureError("Timed out: \(label)")
    }

    private func publish(_ stage: String, binding: ViewBinding? = nil) {
        guard !retiring else { return }
        if let current = binding ?? activeView, (try? requireCurrentView(current)) == nil { return }
        evidence["stage"] = stage
        evidence["engine_pid"] = engine.pid
        evidence["base_url"] = baseURL()?.absoluteString
        evidence["window_number"] = window.windowNumber
        evidence["window_visible"] = window.isVisible
        evidence["window_key"] = window.isKeyWindow
        evidence["window_miniaturized"] = window.isMiniaturized
        evidence["workspace_window_count"] = NSApp.windows.filter {
            $0.styleMask.contains(.titled) && !($0 is NSPanel)
        }.count
        evidence["workspace_window_numbers"] = NSApp.windows.filter {
            $0.styleMask.contains(.titled) && !($0 is NSPanel)
        }.map { $0.windowNumber }
        evidence["reopen_count"] = reopenCount
        write(binding: binding)
    }

    private func capture(_ name: String) async throws {
        guard !retiring else { throw InstanceFixtureError("Workspace retired before snapshot") }
        let binding = try pinCurrentView()
        let image: NSImage
        if try requireCurrentView(binding).isHidden {
            let view = window.contentView!
            guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else {
                throw InstanceFixtureError("Native status snapshot unavailable")
            }
            view.cacheDisplay(in: view.bounds, to: bitmap)
            image = NSImage(size: view.bounds.size)
            image.addRepresentation(bitmap)
        } else {
            image = try await withCheckedThrowingContinuation { continuation in
                let completion = InstanceWorkspaceCompletion<NSImage>(continuation, timeout: 2,
                                                                     label: "workspace snapshot")
                do {
                    try requireCurrentView(binding).takeSnapshot(with: nil) { [weak self] image, error in
                        do {
                            guard let self else { throw InstanceViewChanged() }
                            _ = try self.requireCurrentView(binding)
                            if let image { completion.finish(.success(image)) }
                            else { completion.finish(.failure(error ?? InstanceFixtureError("Workspace snapshot unavailable"))) }
                        } catch { completion.finish(.failure(error)) }
                    }
                } catch { completion.finish(.failure(error)) }
            }
        }
        _ = try requireCurrentView(binding)
        guard !retiring, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else {
            throw InstanceFixtureError("Snapshot encoding failed")
        }
        try png.write(to: output.deletingLastPathComponent().appendingPathComponent(name + ".png"))
    }

    private func write(terminal: Bool = false, binding: ViewBinding? = nil) {
        if !terminal {
            guard !retiring else { return }
            if let current = binding ?? activeView, (try? requireCurrentView(current)) == nil { return }
        }
        if let data = try? JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: output, options: .atomic)
        }
    }
}

private struct InstanceViewChanged: Error {}

/// A late WebKit callback cannot resume twice or retain native UI through a timer.
@MainActor
private final class InstanceWorkspaceCompletion<Value> {
    private var continuation: CheckedContinuation<Value, Error>?
    private var timer: DispatchWorkItem?

    init(_ continuation: CheckedContinuation<Value, Error>, timeout: TimeInterval, label: String) {
        self.continuation = continuation
        let timer = DispatchWorkItem { self.finish(.failure(InstanceFixtureError("Timed out: \(label)"))) }
        self.timer = timer
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0, timeout), execute: timer)
    }

    func finish(_ result: Result<Value, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        timer?.cancel()
        timer = nil
        continuation.resume(with: result)
    }
}

private func validateWorkspaceSnapshotSize(_ png: Data) throws {
    guard png.count <= 2 * 1024 * 1024 else {
        throw InstanceFixtureError("Failure WK snapshot exceeds the 2 MiB export limit; pixel evidence not retained")
    }
}

private struct InstanceWorkspaceObservation: Decodable {
    struct PageError: Decodable { let kind: String; let message: String; let url: String }
    let ready: Bool
    let url: String
    let ready_state: String
    let semantic: String?
    let body_length: Int
    let body_text: String
    let root_html: String
    let diagnostics_installed: Bool
    let errors: [PageError]?
}

private func decodeInstanceWorkspaceObservation(_ value: [String: Any]) -> InstanceWorkspaceObservation? {
    guard let data = try? JSONSerialization.data(withJSONObject: value) else { return nil }
    return try? JSONDecoder().decode(InstanceWorkspaceObservation.self, from: data)
}

private struct InstanceFixtureError: LocalizedError {
    let text: String
    init(_ text: String) { self.text = text }
    var errorDescription: String? { text }
}
