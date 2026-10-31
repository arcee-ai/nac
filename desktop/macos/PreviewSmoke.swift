import AppKit
import WebKit

/// Compiled only for `preview.sh smoke`. There is no script message bridge.
@MainActor
final class PreviewSmoke {
    private unowned let app: PreviewApp
    private let destination: URL
    private let scenario: String
    private var evidence: [String: Any] = [:]
    private var passed = false
    private var cleanupError: String?

    init(app: PreviewApp) {
        self.app = app
        let args = CommandLine.arguments
        destination = URL(fileURLWithPath: args[args.firstIndex(of: "--smoke-output")! + 1])
        scenario = args[args.firstIndex(of: "--smoke-scenario")! + 1]
        // Attribute decoy requests to this fixture on a shared interactive host.
        app.webView.customUserAgent = "NACPreviewSmoke/ALL-340 AppleWebKit/605.1.15"
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

    func start() {
        evidence["app_pid"] = getpid()
        evidence["scenario"] = scenario
        write()
        Task {
            do {
                if ["normal", "ci-terminal", "ci-terminal-xctest"].contains(scenario) { try await journey() }
                else if scenario == "close-startup" {
                    try await wait("engine starting") { self.app.engine.pid > 0 }
                } else {
                    if scenario == "engine-exit" {
                        try await waitJS("loaded production workspace", "return !!document.querySelector('[role=dialog]');")
                        kill(app.engine.pid, SIGTERM)
                    }
                    try await wait("native failure state", timeout: 65) { self.app.failure != nil }
                    let message = app.failure!
                    let expected = scenario == "missing" ? "missing or not executable" :
                        scenario == "timeout" ? "within 30 seconds" : "engine stopped"
                    guard message.contains(expected) else { throw PreviewError.message("Unexpected failure: \(message)") }
                    evidence["native_failure"] = message
                    try captureNative()
                }
                passed = true
            } catch {
                evidence["error"] = String(describing: error)
                evidence["engine_log"] = app.engine.log
                if let body = try? await js("return document.body.innerText;") { evidence["dom"] = body }
            }
            evidence["engine_pid"] = app.engine.pid
            evidence["profile"] = app.profile?.root.path
            evidence["base_url"] = app.baseURL?.absoluteString
            evidence["provider_url"] = app.provider.baseURL?.absoluteString
            evidence["provider_responses"] = app.provider.responseCount
            evidence["scenario"] = scenario
            write()
            // Exercise the actual NSWindow close delegate and termination reply.
            // AppKit's terminateLater spins a native loop. Leave the Swift task
            // first so that loop can drain the main dispatch queue during shutdown.
            RunLoop.main.perform(inModes: [.common]) { [self] in
                MainActor.assumeIsolated { app.window.performClose(nil) }
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

    private func recordOwnership() {
        let root = app.profile?.root.path
        guard evidence["engine_pid"] as? Int32 != app.engine.pid || evidence["profile"] as? String != root else { return }
        evidence["engine_pid"] = app.engine.pid
        evidence["profile"] = root
        write()
    }

    private func captureWeb(_ name: String) async throws {
        let image = try await app.webView.takeSnapshot(configuration: nil)
        try writePNG(image, name)
    }
    private func captureNative() throws {
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
        evidence["profile_removed"] = app.profile.map { !FileManager.default.fileExists(atPath: $0.root.path) } ?? true
        evidence["engine_reaped"] = app.engine.pid == 0
        evidence["cleanup_error"] = cleanupError
        evidence["passed"] = passed && cleanupError == nil && evidence["profile_removed"] as? Bool == true
        write()
    }
    private func write() {
        do {
            let data = try JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: destination, options: .atomic)
        } catch { fputs("Smoke evidence write failed: \(error)\n", stderr) }
    }
}
