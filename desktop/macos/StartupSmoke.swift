import AppKit
import WebKit

/// Instrumentation for the real LOCAL_APP bundle. Uses the ordinary startup,
/// shared production UI and Rust endpoints, on an externally owned test profile.
@MainActor
final class StartupSmoke {
    private unowned let app: PreviewApp
    private let output: URL
    private let scenario: String
    private let arguments = CommandLine.arguments
    private var evidence: [String: Any] = [:]
    private var passed = false

    init(app: PreviewApp) {
        self.app = app
        output = URL(fileURLWithPath: arguments[arguments.firstIndex(of: "--smoke-output")! + 1])
        scenario = arguments[arguments.firstIndex(of: "--smoke-scenario")! + 1]
        app.webView.customUserAgent = "NACStartupSmoke/ALL-342 AppleWebKit/605.1.15"
        CommandEnvironment.isolatedFixturePaths = scenario.contains("missing-")
    }

    static func launchArguments(_ arguments: [String]) -> [String] {
        var result: [String] = []
        var index = 0
        while index < arguments.count {
            if arguments[index].hasPrefix("--smoke-") { index += 2 }
            else { result.append(arguments[index]); index += 1 }
        }
        return result
    }

    private func value(_ name: String) -> String? {
        arguments.firstIndex(of: name).map { arguments[$0 + 1] }
    }

    func start() {
        evidence = ["app_pid": getpid(), "scenario": scenario, "passed": false]
        write()
        Task {
            do {
                if ["startup-invalid-config", "startup-future-store", "startup-missing-git", "startup-bad-directory"].contains(scenario) {
                    try await wait("actionable native failure") { self.app.failure != nil }
                    let text = app.window.contentView!.subviews.compactMap { ($0 as? NSTextField)?.stringValue }.joined(separator: "\n")
                    let expected = scenario == "startup-invalid-config" ? "config.toml" :
                        scenario == "startup-missing-git" ? "Git was not found" :
                        scenario == "startup-bad-directory" ? "store directory" : "compatible version"
                    guard text.contains(expected), app.baseURL == nil, app.webView.isHidden else {
                        throw DesktopStartupError.message("Failure did not provide recovery before workspace activation")
                    }
                    evidence["native_failure"] = text
                    evidence["workspace_not_activated"] = true
                } else {
                    try await waitJS("shared onboarding", "return document.body.innerText.includes('No projects yet');")
                    try await wait("identified workspace activation") { !self.app.webView.isHidden }
                    guard let receipt = app.engine.receipt,
                          receipt.store == value("--smoke-expected-store") else {
                        throw DesktopStartupError.message("Finder startup selected the wrong store")
                    }
                    evidence["ready_store"] = receipt.store
                    evidence["ready_source"] = receipt.identity?.source_revision
                    evidence["ready_build"] = receipt.identity?.build_id
                    evidence["ready_track"] = receipt.identity?.track
                    evidence["launch_incarnation"] = receipt.incarnation
                    evidence["onboarding"] = true
                    evidence["workspace_activated"] = true
                    let policy = try await js("return await (await fetch('/ui-config')).json();") as! [String: Any]
                    evidence["ui_policy"] = policy
                    guard policy["orchestration_enabled"] as? Bool == (ProcessInfo.processInfo.environment["NAC_ORCHESTRATION"] == "1") else {
                        throw DesktopStartupError.message("Numeric orchestration policy changed")
                    }
                    if ["startup-missing-ssh", "startup-missing-podman", "startup-missing-mcp", "startup-custom-mcp"].contains(scenario) {
                        try await commandJourney()
                    } else if scenario != "startup-fresh" { try await configuredJourney() }
                }
                passed = true
            } catch {
                evidence["error"] = String(describing: error)
                if let body = try? await js("return document.body.textContent;") { evidence["dom"] = body }
            }
            evidence["passed"] = passed
            evidence["engine_pid"] = app.engine.pid
            evidence["base_url"] = app.baseURL?.absoluteString
            evidence["selected_cwd"] = app.launchConfiguration?.cwd.path
            evidence["selected_store"] = app.launchConfiguration?.store.path
            evidence["internal_fixture_provider"] = "excluded_from_LOCAL_APP"
            if evidence["paint"] == nil {
                evidence["paint"] = value("--smoke-paint") == "1" ? "not_captured" : "pending_locked_session"
            }
            write()
            RunLoop.main.perform(inModes: [.common]) { [self] in
                MainActor.assumeIsolated { app.window.performClose(nil) }
            }
        }
    }

    private func configuredJourney() async throws {
        let provider = value("--smoke-provider")!
        _ = try await js("""
        const response = await fetch('/model-configs', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          name:'Finder configured fixture', backend:'openai-responses', model:'gpt-5.6-sol',
          base_url:'\(provider)', api_key:'preview-dummy-only', extra_headers:{}, orchestrator_compaction_threshold:0})});
        if (!response.ok) throw new Error(await response.text());
        return await response.json();
        """)
        _ = try await js("window.__startupReloading = true; return true;")
        app.webView.reload()
        try await waitJS("onboarding after configuration", "return !window.__startupReloading && [...document.querySelectorAll('button')].some(b => b.textContent.includes('Get Started'));")
        _ = try await js("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Get Started')).click(); return true;")
        try await waitJS("project creation dialog", "return document.body.innerText.includes('New Project');")
        let workspace = value("--smoke-workspace")!
        let initial = app.launchConfiguration!.cwd.path
        let workingFolder = "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === \(json(initial)) || b.textContent.includes('/path/to/project'))"
        try await waitJS("working-folder control", "return !!(\(workingFolder));")
        _ = try await js("\(workingFolder).click(); return true;")
        try await waitJS("shared folder picker", "return !!document.querySelector('input[placeholder=\"/path/to/directory\"]');")
        _ = try await js("""
        const input = document.querySelector('input[placeholder="/path/to/directory"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, \(json(workspace)));
        input.dispatchEvent(new Event('input',{bubbles:true})); return true;
        """)
        _ = try await js("document.querySelector('input[placeholder=\"/path/to/directory\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return true;")
        try await waitJS("selected working folder", "return document.body.innerText.includes(\(json("Selected: " + workspace)));")
        _ = try await js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Select' && !b.disabled).click(); return true;")
        try await waitJS("configured project ready", "return [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Create Project' && !b.disabled);")
        _ = try await js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Create Project' && !b.disabled).click(); return true;")
        try await waitJS("configured local chat", "return location.hash.includes('/session/') && !!document.querySelector('[role=combobox][aria-label=Message]');")
        _ = try await js("""
        const input=document.querySelector('[role=combobox][aria-label=Message]');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,\(json("FINDER_CONFIGURED_LOCAL_" + scenario)));
        input.dispatchEvent(new Event('input',{bubbles:true})); return true;
        """)
        try await waitJS("enabled shared Send", "return !!document.querySelector('button[aria-label=Send]:not(:disabled)');")
        _ = try await js("document.querySelector('button[aria-label=Send]').click(); return true;")
        try await waitJS("configured local response", "return document.body.innerText.includes('Finder configured local response.');")
        let snapshot = try await js("return await (await fetch('/sessions/'+location.hash.split('/')[2])).json();") as! [String: Any]
        let metadata = snapshot["metadata"] as! [String: Any]
        let summaries = snapshot["sessions"] as? [[String: Any]] ?? []
        guard let summary = summaries.first(where: { ($0["session_id"] as? String) == (metadata["session_id"] as? String) }),
              summary["sandboxed"] as? Bool == false,
              summary["ssh_host"] == nil || summary["ssh_host"] is NSNull else {
            throw DesktopStartupError.message("Configured run did not retain Local execution")
        }
        evidence["session_id"] = metadata["session_id"]
        evidence["execution_backend"] = "local"
        evidence["project_created_in_shared_ui"] = true
        evidence["configured_local_run"] = true
        evidence["behavior"] = (snapshot["metadata"] as? [String: Any])?["behavior"]
        _ = try await js("window.__startupReloading = true; return true;")
        app.webView.reload()
        try await waitJS("retained configured transcript", "return !window.__startupReloading && document.body.innerText.includes('Finder configured local response.');")
        evidence["persisted_reload"] = true
        if value("--smoke-paint") == "1" { try await capture() }
    }

    func didStop() {
        evidence["stopped"] = app.engine.pid == 0 && app.engine.receipt == nil
        write()
    }

    private func commandJourney() async throws {
        if scenario.contains("mcp") {
            _ = try await js("document.querySelector('button[aria-label^=\"MCP servers\"]').click(); return true;")
            try await waitJS("shared MCP library", "return [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Custom server');")
            _ = try await js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Custom server').click(); return true;")
            try await waitJS("MCP transport choices", "return [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Stdio');")
            _ = try await js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Stdio').click(); return true;")
            try await waitJS("MCP command form", "return !!document.querySelector('input[placeholder=npx]');")
            try await fill("input[placeholder=my_server]", "finder_command_fixture")
            try await fill("input[placeholder=npx]", scenario == "startup-custom-mcp" ? "finder-mcp" : "missing-finder-mcp")
            _ = try await js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Test connection').click(); return true;")
            let expected = scenario == "startup-custom-mcp" ? "1 tool found" : "Test failed:"
            try await waitJS("MCP command result", "return document.body.textContent.includes(\(json(expected)));")
            evidence["mcp_command_result"] = try await js("return document.body.innerText;")
            evidence["custom_path_mcp_connected"] = scenario == "startup-custom-mcp"
            evidence["missing_mcp_recovery"] = scenario == "startup-missing-mcp"
            evidence["command_fixture"] = "controlled executable lookup through normal MCP settings"
            return
        }
        _ = try await js("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Get Started')).click(); return true;")
        try await waitJS("environment choices", "return [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'SSH');")
        let mode = scenario == "startup-missing-ssh" ? "SSH" : "Sandbox"
        _ = try await js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === \(json(mode))).click(); return true;")
        if mode == "SSH" {
            try await waitJS("SSH host control", "return !!document.querySelector('input[placeholder=\"example@192.0.2.10 or build-box\"]');")
            try await fill("input[placeholder=\"example@192.0.2.10 or build-box\"]", "fixture@missing-command.invalid")
            _ = try await js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Connect').click(); return true;")
            try await waitJS("missing SSH guidance", "return document.body.textContent.includes('SSH connect failed:');")
        } else {
            try await waitJS("missing Podman guidance", "return document.body.textContent.includes('podman is not installed');")
        }
        let selected = try await js("return [...document.querySelectorAll('button[aria-pressed=true]')].some(b => b.textContent.trim() === \(json(mode)));")
        guard selected as? Bool == true else { throw DesktopStartupError.message("Missing command changed the selected backend") }
        evidence["selected_backend_preserved"] = mode.lowercased()
        evidence["command_fixture"] = "controlled missing executable; real backend not qualified"
        evidence["command_guidance"] = try await js("return document.body.innerText;")
    }

    private func fill(_ selector: String, _ value: String) async throws {
        _ = try await js("""
        const input=document.querySelector(\(json(selector)));
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,\(json(value)));
        input.dispatchEvent(new Event('input',{bubbles:true})); return true;
        """)
    }

    private func js(_ body: String) async throws -> Any {
        (try await app.webView.callAsyncJavaScript(body, arguments: [:], in: nil, contentWorld: .page)) ?? NSNull()
    }

    private func wait(_ label: String, timeout: TimeInterval = 35, _ condition: () throws -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try condition() { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw DesktopStartupError.message("Timed out: \(label)")
    }

    private func waitJS(_ label: String, _ body: String) async throws {
        let deadline = Date().addingTimeInterval(35)
        while Date() < deadline {
            if let failure = app.failure { throw DesktopStartupError.message(failure) }
            if let result = try? await js(body), result as? Bool == true { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw DesktopStartupError.message("Timed out: \(label)")
    }

    private func json(_ value: String) -> String {
        let data = try! JSONSerialization.data(withJSONObject: [value])
        return String(decoding: data, as: UTF8.self).dropFirst().dropLast().description
    }

    private func capture() async throws {
        let image = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<NSImage, Error>) in
            app.webView.takeSnapshot(with: nil) { image, error in
                if let image { continuation.resume(returning: image) }
                else { continuation.resume(throwing: error ?? DesktopStartupError.message("Snapshot unavailable")) }
            }
        }
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else {
            throw DesktopStartupError.message("Snapshot encoding failed")
        }
        try png.write(to: output.deletingLastPathComponent().appendingPathComponent("configured-local.png"))
        evidence["paint"] = "captured_unverified"
    }

    private func write() {
        if let data = try? JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted,.sortedKeys]) {
            try? data.write(to: output, options: .atomic)
        }
    }
}
