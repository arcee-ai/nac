#if NATIVE_AUTH_FIXTURE && LOCAL_APP && PREVIEW_SMOKE
import AppKit
import WebKit

/// A distinctly marked fixture engine runs the actual local provider state
/// owner and shared sign-in controls. No inference or physical input is proved.
@MainActor
final class DeviceAuthSmoke {
    private unowned let app: PreviewApp
    private let arguments = CommandLine.arguments
    private var evidence: [String: Any] = [:]
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
        app.webView.customUserAgent = "NACDeviceAuthWK/ALL348 AppleWebKit/605.1.15"
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
        write()
        Task {
            do {
                guard output != nil, ["device-success", "device-denied", "device-expired", "device-cancel", "device-timeout",
                    "device-restart", "device-canceled-restart"].contains(scenario) else {
                    throw PreviewError.message("Missing named device fixture scenario/output")
                }
                try await wait("verified fixture workspace") { self.app.commands.currentDocument(in: self.app.webView) != nil }
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
                guard app.commands.currentDocument(in: app.webView) != nil else { throw PreviewError.message("Sign-in retired its source document") }
                let admission = try await js("const r=await fetch('/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return r.status") as? Int
                guard admission == 403 else { throw PreviewError.message("Fixture admitted a harness effect") }
                evidence["harness_effect_refused"] = true
                evidence["passed"] = true
            } catch {
                evidence["error"] = String(describing: error)
            }
            checkpoint()
            RunLoop.main.perform(inModes: [.common]) { NSApp.terminate(nil) }
        }
    }

    func didStop() {
        evidence["stopped"] = app.engine.pid == 0 && app.engine.receipt == nil
        evidence["commands_retired"] = app.commands.currentDocument(in: app.webView) == nil
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
        return try await withCheckedThrowingContinuation { continuation in
            var resolved = false
            let timeout = Task { @MainActor in
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard !Task.isCancelled, !resolved else { return }
                resolved = true
                continuation.resume(throwing: PreviewError.message("Device fixture WK evaluation timed out"))
            }
            app.webView.callAsyncJavaScript(source, arguments: arguments, in: nil, in: .page) { result in
                guard !resolved else { return }
                resolved = true; timeout.cancel()
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
