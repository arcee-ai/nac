#if NATIVE_AUTH_FIXTURE && LOCAL_APP && PREVIEW_SMOKE
import AppKit
import WebKit

enum DeviceAuthSmokeMode: Equatable {
    case active, externalXCTest

    init?(scenario: String) {
        switch scenario {
        case "device-success", "device-denied", "device-expired", "device-cancel", "device-timeout",
             "device-restart", "device-canceled-restart": self = .active
        case "device-external-xctest": self = .externalXCTest
        default: return nil
        }
    }
}

/// Observation only: no UI, HTTP, opener or lifecycle operation is available here.
struct DeviceAuthPassiveObservation: Equatable {
    enum Phase: String { case waiting, ready, stopping, failed, retired }
    enum Failure: String {
        case nativeFailure = "native-failure", readinessTimeout = "readiness-timeout"
        case invalidEngine = "invalid-engine", staleBinding = "stale-binding", incompleteRetirement = "incomplete-retirement"
        case missingOutput = "missing-output"
    }
    struct Binding: Equatable {
        let identity: EngineIdentity
        let incarnation: String
        let endpoint: String
        let store: String
        let schema: Int
        let pid: Int32
        let document: NativeDocumentBinding

        init?(receipt: EngineReceipt, pid: Int32, document: NativeDocumentBinding) {
            guard let identity = receipt.identity, identity.isNativeAuthFixture, identity.track == "dev",
                  !identity.source_revision.isEmpty, identity.source_revision.utf8.count <= 128,
                  identity.build_id.utf8.count <= 256, identity.product_version.utf8.count <= 64,
                  receipt.incarnation.utf8.count <= 64, !receipt.incarnation.isEmpty,
                  NativeCommandState(receipt: receipt) != nil,
                  let endpoint = receipt.endpoint, endpoint.utf8.count <= 128,
                  let port = URL(string: endpoint)?.port, port > 0, port <= 65535,
                  let store = receipt.store, store.hasPrefix("/"), store.utf8.count <= 4096,
                  let schema = receipt.schema, schema > 0,
                  pid > 0, document.launch == receipt.incarnation,
                  !document.view.isEmpty, document.view.utf8.count <= 64,
                  !document.document.isEmpty, document.document.utf8.count <= 64 else { return nil }
            self.identity = identity; incarnation = receipt.incarnation
            self.endpoint = endpoint; self.store = store; self.schema = schema
            self.pid = pid; self.document = document
        }
    }
    private(set) var phase = Phase.waiting
    private(set) var failure: Failure?
    private(set) var binding: Binding?
    private(set) var stopped = false
    private(set) var commandsRetired = false

    init(outputAvailable: Bool = true) {
        if !outputAvailable { fail(.missingOutput) }
    }

    mutating func observe(receipt: EngineReceipt?, pid: Int32, document: NativeDocumentBinding?,
                          nativeFailure: Bool, stopping: Bool, readinessExpired: Bool) {
        guard phase != .retired, failure == nil else { return }
        if nativeFailure { fail(.nativeFailure); return }
        if stopping { phase = .stopping; return }
        // A stopped launch cannot be revived by a late ready observation.
        if phase == .stopping { fail(.staleBinding); return }
        if let receipt, receipt.identity?.isNativeAuthFixture != true || receipt.identity?.track != "dev" {
            fail(.invalidEngine); return
        }
        if binding == nil && readinessExpired { fail(.readinessTimeout); return }
        if let binding {
            guard let receipt, let document,
                  Binding(receipt: receipt, pid: pid, document: document) == binding else {
                fail(.staleBinding); return
            }
        } else if let receipt, let document {
            guard let candidate = Binding(receipt: receipt, pid: pid, document: document) else {
                fail(.invalidEngine); return
            }
            binding = candidate
        } else {
            return
        }
        phase = .ready
    }

    mutating func didStop(pid: Int32, receipt: EngineReceipt?, document: NativeDocumentBinding?) {
        guard phase != .retired else { return }
        stopped = pid == 0 && receipt == nil
        commandsRetired = document == nil
        if !stopped || !commandsRetired { fail(.incompleteRetirement) }
        phase = .retired
    }

    private mutating func fail(_ reason: Failure) { failure = failure ?? reason; phase = .failed }

    var facts: [String: Any] {
        var result: [String: Any] = ["observer_schema": "nac348-passive-device-v1", "observer_phase": phase.rawValue,
            "ready_observed": binding != nil, "binding_current": phase == .ready,
            "stopped": stopped, "commands_retired": commandsRetired,
            "observer_input_issued": false, "observer_auth_mutation_issued": false,
            "observer_opener_invoked": false, "observer_auto_termination_requested": false]
        if let failure { result["observer_failure"] = failure.rawValue }
        if let binding {
            result["engine_identity"] = ["product_version": binding.identity.product_version,
                "build_id": binding.identity.build_id, "source_revision": binding.identity.source_revision,
                "track": binding.identity.track]
            result["ready_source"] = binding.identity.source_revision
            result["ready_build"] = binding.identity.build_id
            result["launch_incarnation"] = binding.incarnation
            result["origin"] = binding.endpoint
            result["pinned_engine_pid"] = binding.pid
            result["ready_schema"] = binding.schema
            result["view"] = binding.document.view
            result["document"] = binding.document.document
        }
        return result
    }
}

/// A distinctly marked fixture engine runs the actual local provider state
/// owner and shared sign-in controls. No inference or physical input is proved.
@MainActor
final class DeviceAuthSmoke {
    private unowned let app: PreviewApp
    private let arguments = CommandLine.arguments
    private var evidence: [String: Any] = [:]
    private var passive: DeviceAuthPassiveObservation?
    private var passiveTask: Task<Void, Never>?
    private var output: URL? {
        guard let index = arguments.firstIndex(of: "--smoke-output"), index + 1 < arguments.count else { return nil }
        return URL(fileURLWithPath: arguments[index + 1])
    }
    private var scenario: String {
        guard let index = arguments.firstIndex(of: "--smoke-scenario"), index + 1 < arguments.count else { return "" }
        return arguments[index + 1]
    }

    init(app: PreviewApp) {
        self.app = app
    }

    private var currentDocument: NativeDocumentBinding? {
        guard let view = app.webView else { return nil }
        return app.commands?.currentDocument(in: view)
    }

    static func configure(_ view: WKWebView) {
        view.customUserAgent = "NACDeviceAuthWK/ALL348 AppleWebKit/605.1.15"
    }

    static func launchArguments(_ arguments: [String]) -> [String] {
        var selected: [String] = []
        var index = 0
        while index < arguments.count {
            if arguments[index].hasPrefix("--smoke-") { index += 2 }
            else { selected.append(arguments[index]); index += 1 }
        }
        return selected
    }

    func start() {
        evidence = ["app_pid": getpid(), "scenario": scenario, "passed": false,
            "scope": "isolated fixture-engine actual-app/system-WK/device-owner/local-double; DOM-driven",
            "physical_input_qualified": false, "real_vendor_qualified": false, "inference_qualified": false]
        if DeviceAuthSmokeMode(scenario: scenario) == .externalXCTest {
            startPassiveObservation()
            return
        }
        write()
        Task {
            do {
                guard output != nil, DeviceAuthSmokeMode(scenario: scenario) == .active else {
                    throw PreviewError.message("Missing named device fixture scenario/output")
                }
                try await wait("verified fixture workspace") { self.currentDocument != nil }
                guard let receipt = app.engine.receipt, receipt.identity?.isNativeAuthFixture == true else {
                    throw PreviewError.message("Device fixture received an ordinary engine")
                }
                evidence["ready_source"] = receipt.identity?.source_revision
                evidence["ready_build"] = receipt.identity?.build_id
                evidence["launch_incarnation"] = receipt.incarnation
                evidence["ready_store"] = receipt.store
                try await wait("shared onboarding") {
                    try await self.js("return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Get Started')") as? Bool == true
                }
                try await click("Get Started")
                try await wait("provider connections control") {
                    try await self.js("return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Provider connections')") as? Bool == true
                }
                try await click("Provider connections")
                try await wait("actual Arcee sign-in card") { try await self.cardText().contains("Arcee sign-in") }

                if scenario == "device-restart" {
                    try await wait("persisted signed-in readback") { try await self.cardText().contains("Signed in") }
                    guard try await signedIn() else { throw PreviewError.message("Restart lost the stored credential") }
                    evidence["persisted_sign_in"] = true
                    evidence["start_command_issued"] = false
                } else if scenario == "device-canceled-restart" {
                    guard !(try await signedIn()) else { throw PreviewError.message("Canceled login persisted credentials") }
                    try await wait("canceled restart offers fresh sign-in") { try await self.cardText().contains("Sign in with Arcee") }
                    evidence["canceled_restart_unsigned"] = true
                    evidence["start_command_issued"] = false
                } else {
                    let browserBefore = try await browserObservations()
                    try await click("Sign in with Arcee", inCard: true)
                    evidence["start_command_issued"] = true
                    try await wait("provider prompt or result") {
                        let text = try await self.cardText()
                        return text.contains("Open Arcee") || text.contains("Signed in") || text.lowercased().contains("denied") || text.lowercased().contains("expired")
                    }
                    // An asynchronous auto-open may lose activation. Exercise
                    // the production explicit retry control when still pending.
                    if try await cardText().contains("Open Arcee") { try await click("Open Arcee", inCard: true) }
                    try await wait("external browser reached the owned double without a native bridge") {
                        if try await self.browserObservations() > browserBefore { return true }
                        if try await self.cardText().lowercased().contains("expired") {
                            self.evidence["handoff_coverage_missing"] = true
                            throw PreviewError.message("Device expiry occurred before observed browser handoff; coverage missing")
                        }
                        return false
                    }
                    evidence["external_browser_observed"] = true
                    if scenario == "device-success" {
                        try await wait("shared signed-in UI") { try await self.cardText().contains("Signed in") }
                        guard try await signedIn() else { throw PreviewError.message("UI success has no stored sign-in") }
                        evidence["actual_owner_completed"] = true
                    } else if scenario == "device-cancel" {
                        try await click("Cancel", inCard: true)
                        try await wait("canceled UI") { try await self.cardText().contains("Sign in with Arcee") }
                        guard !(try await signedIn()) else { throw PreviewError.message("Canceled pending login stored credentials") }
                        evidence["actual_owner_canceled"] = true
                    } else {
                        let expected = scenario == "device-denied" ? "denied" : "expired"
                        try await wait("shared failure status") { try await self.cardText().lowercased().contains(expected) }
                        guard !(try await signedIn()) else { throw PreviewError.message("Failed pending login stored credentials") }
                        evidence["actual_owner_failure"] = expected
                    }
                }
                guard currentDocument != nil else { throw PreviewError.message("Sign-in retired its source document") }
                let admission = try await js("const r=await fetch('/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return r.status") as? Int
                guard admission == 403 else { throw PreviewError.message("Fixture admitted a harness effect") }
                evidence["harness_effect_refused"] = true
                evidence["passed"] = true
            } catch {
                evidence["error"] = String(describing: error)
            }
            checkpoint()
            RunLoop.main.perform(inModes: [.common]) {
                MainActor.assumeIsolated { self.app.quit.stopFixture() }
            }
        }
    }

    func didStop() {
        if passive != nil {
            passiveTask?.cancel()
            passiveTask = nil
            passive?.didStop(pid: app.engine.pid, receipt: app.engine.receipt,
                             document: currentDocument)
            writePassiveObservation()
            return
        }
        evidence["stopped"] = app.engine.pid == 0 && app.engine.receipt == nil
        evidence["commands_retired"] = currentDocument == nil
        write()
    }

    private func startPassiveObservation() {
        passive = DeviceAuthPassiveObservation(outputAvailable: output != nil)
        evidence["scope"] = "passive marked-engine identity/document observer; external public XCTest owns lifecycle"
        evidence["driver"] = "external-xctest"
        writePassiveObservation()
        // No fallback to the active driver, even on missing output or failure.
        guard output != nil else {
            fputs("Passive device observer requires its evidence output.\n", stderr)
            return
        }
        let deadline = ProcessInfo.processInfo.systemUptime + 35
        passiveTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let before = self.passive
                self.passive?.observe(receipt: self.app.engine.receipt, pid: self.app.engine.pid,
                    document: self.currentDocument,
                    nativeFailure: self.app.failure != nil, stopping: self.app.stopping,
                    readinessExpired: ProcessInfo.processInfo.systemUptime >= deadline)
                if before != self.passive || self.evidence["engine_pid"] as? Int32 != self.app.engine.pid {
                    self.writePassiveObservation()
                }
                if self.passive?.failure != nil { return }
                do { try await Task.sleep(nanoseconds: 100_000_000) } catch { return }
            }
        }
    }

    private func writePassiveObservation() {
        guard let passive else { return }
        evidence.merge(passive.facts) { _, current in current }
        evidence["engine_pid"] = app.engine.pid
        write()
    }

    private func cardText() async throws -> String {
        try await js("const section=document.querySelector('section[aria-label=\"Provider connections\"]');const card=[...section?.children||[]].find(e=>e.textContent.includes('Arcee sign-in'));return card?.textContent||''") as? String ?? ""
    }

    private func click(_ title: String, inCard: Bool = false) async throws {
        let found = try await js(#"""
        const section=document.querySelector('section[aria-label="Provider connections"]');
        const root=inCard?[...section?.children||[]].find(e=>e.textContent.includes('Arcee sign-in')):document;
        const control=[...root?.querySelectorAll('button,a[href]')||[]].find(b=>b.textContent.trim()===title&&!b.disabled);
        control?.click();return !!control;
        """#, arguments: ["title": title, "inCard": inCard]) as? Bool
        guard found == true else { throw PreviewError.message("Device fixture UI control unavailable") }
    }

    private func signedIn() async throws -> Bool {
        try await js("const r=await fetch('/auth');if(!r.ok)throw new Error('status');const v=await r.json();return v.providers.some(p=>p.provider==='arcee'&&p.signed_in)") as? Bool == true
    }

    private func browserObservations() async throws -> Int {
        guard let origin = ProcessInfo.processInfo.environment["NAC_NATIVE_AUTH_FIXTURE_ORIGIN"],
              let base = URL(string: origin), base.scheme == "http", base.host == "127.0.0.1", base.port != nil,
              base.user == nil, base.password == nil, base.query == nil, base.fragment == nil, ["", "/"].contains(base.path) else {
            throw PreviewError.message("Owned device double origin unavailable")
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 3; configuration.timeoutIntervalForResource = 3
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let (data, response) = try await session.data(from: base.appendingPathComponent("evidence"))
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let events = value["events"] as? [[String: Any]] else {
            throw PreviewError.message("Device double observation unavailable")
        }
        let observations = events.filter { $0["kind"] as? String == "browser_observation" }
        guard observations.allSatisfy({ $0["bridge"] as? Bool == false && $0["webkit_fixture"] as? Bool == false }) else {
            throw PreviewError.message("Device auth page inherited a native bridge or stayed inside WK")
        }
        return observations.count
    }

    private func checkpoint() {
        evidence["engine_pid"] = app.engine.pid
        evidence["selected_store"] = app.launchConfiguration?.store.path
        write()
    }

    private func js(_ source: String, arguments: [String: Any] = [:]) async throws -> Any {
        checkpoint()
        guard let view = app.webView, let binding = currentDocument else {
            throw PreviewError.message("Auth fixture current document is unavailable")
        }
        return try await withCheckedThrowingContinuation { continuation in
            var resolved = false
            let timeout = Task { @MainActor in
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard !Task.isCancelled, !resolved else { return }
                resolved = true
                continuation.resume(throwing: PreviewError.message("Device fixture WK evaluation timed out"))
            }
            view.callAsyncJavaScript(source, arguments: arguments, in: nil, in: .page) { [weak view] result in
                guard !resolved else { return }
                resolved = true; timeout.cancel()
                guard let view, self.app.webView === view, self.currentDocument == binding else {
                    continuation.resume(throwing: PreviewError.message("Auth fixture document retired during evaluation"))
                    return
                }
                switch result {
                case .success(let value): continuation.resume(returning: value)
                case .failure: continuation.resume(throwing: PreviewError.message("Device fixture WK evaluation failed"))
                }
            }
        }
    }

    private func wait(_ label: String, _ condition: () async throws -> Bool) async throws {
        let deadline = Date().addingTimeInterval(35)
        while Date() < deadline {
            checkpoint()
            if let failure = app.failure { throw PreviewError.message(failure) }
            if try await condition() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw PreviewError.message("Timed out waiting for \(label)")
    }

    private func write() {
        guard let output, let data = try? JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys]) else { return }
        try? data.write(to: output, options: .atomic)
    }
}
#endif
