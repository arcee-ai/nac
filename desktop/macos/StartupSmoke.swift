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
                    let retiredPolicyStatus = try await js("return (await fetch('/ui-config')).status;") as? Int
                    evidence["retired_ui_policy_status"] = retiredPolicyStatus
                    guard retiredPolicyStatus == 404 else {
                        throw DesktopStartupError.message("Retired UI policy endpoint remains available")
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
                // ALL-344 close now preserves normal work. Fixture cleanup
                // explicitly selects Stop on the real native Quit sheet.
                MainActor.assumeIsolated { app.quit.stopFixture() }
            }
        }
    }

    private struct LaunchModel {
        let backend: String
        let model: String
        let displayName: String
        let account: String
        let endpoint: String
        let credential: String
    }

    private func configuredJourney() async throws {
        let vendor = scenario == "startup-real-arcee"
        let selectionOnly = vendor && value("--smoke-selection-only") == "1"
        let responseText = vendor ? "NAC_LOCAL_ARCEE_OK" : "Finder configured local response."
        let model = try await (vendor ? vendorLaunchModel() : scriptedLaunchModel())
        _ = try await js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Get Started').click(); return true;")
        try await waitJS("project creation dialog", "return document.body.innerText.includes('New Project');")
        let workspace = value("--smoke-workspace")!
        let workingFolder = "document.querySelector('button[aria-label^=\"Choose Working Folder\"]')"
        try await waitJS("working-folder control", "return !!(\(workingFolder));")
        _ = try await js("\(workingFolder).click(); return true;")
        // LOCAL_APP hands Working Folder to the real AppKit sheet. The smoke
        // settles that open sheet with the fixture folder through the panel's
        // own checks; NativePathJourney's XCTest covers a person's clicks in it.
        try await wait("native folder sheet") {
            self.app.window.attachedSheet is NSOpenPanel && self.app.nativePaths?.smokeSnapshot["pending"] as? Bool == true
        }
        guard app.nativePaths?.smokeChooseFolder(workspace) == true else {
            throw DesktopStartupError.message("Native folder sheet had no pending request to settle")
        }
        try await waitJS("selected working folder", "return \(workingFolder)?.getAttribute('aria-label') === \(json("Choose Working Folder: " + workspace));")
        let create = "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Create Project' && !b.disabled)"
        try await waitJS("configured project ready", "return !!(\(create));")
        _ = try await js("\(create).click(); return true;")
        try await waitJS("new project's Home composer", """
        return location.hash.startsWith('#/?project=') && !!document.querySelector('textarea#home-composer');
        """)
        let selectedProject = try await js("""
        return new URLSearchParams(location.hash.split('?')[1]).get('project');
        """)
        guard let projectID = selectedProject as? String, !projectID.isEmpty else {
            throw DesktopStartupError.message("Home did not select the newly created project")
        }
        let project = try await js("""
        return (await (await fetch('/projects')).json()).projects.find(project => project.project_id === \(json(projectID)));
        """) as? [String: Any]
        guard project?["cwd"] as? String == URL(fileURLWithPath: workspace).resolvingSymlinksInPath().path,
              project?["ssh_host"] == nil || project?["ssh_host"] is NSNull,
              try await js("return (await (await fetch('/sessions')).json()).length === 0;") as? Bool == true else {
            throw DesktopStartupError.message("Project creation must retain the selected local folder and wait for the first prompt")
        }
        evidence["project_created_in_shared_ui"] = true
        let prompt = vendor ? "Do not use tools. Reply only with the uppercase sequence obtained by joining NAC, LOCAL, ARCEE, OK with underscores." : "FINDER_CONFIGURED_LOCAL_" + scenario
        if vendor {
            try await fenceVendorLaunch(model, projectID: projectID, prompt: prompt, selectionOnly: selectionOnly)
        }
        try await selectHomeModel(model)
        _ = try await js("""
        const input = document.querySelector('textarea#home-composer');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,\(json(prompt)));
        input.dispatchEvent(new Event('input',{bubbles:true})); return true;
        """)
        let start = "document.querySelector('button[aria-label=\"Start session\"]:not(:disabled)')"
        try await waitJS("enabled Home Start session", "return !!(\(start));")
        if vendor {
            _ = try await js("""
            if (window.__startupVendorGate?.arm() !== true) throw new Error('The vendor fixture transport is not guarded');
            \(start).click(); return true;
            """)
        } else {
            _ = try await js("\(start).click(); return true;")
        }
        try await waitJS("configured local chat", "return location.hash.includes('/session/') && !!document.querySelector('[role=combobox][aria-label=Message]');")
        if vendor {
            try await waitJS("verified vendor session", "return window.__startupVendorGate?.session === location.hash.split('/')[2];")
            evidence["vendor_backend"] = model.backend
            evidence["credential_source"] = "existing ARCEE_API_KEY environment reference"
            evidence["vendor_model"] = model.model
            evidence["vendor_selection_verified"] = true
            if selectionOnly {
                evidence["model_requests_sent"] = 0
                return
            }
        }
        try await waitJS("configured local response", "return document.body.innerText.includes(\(json(responseText)));")
        try await waitJS("configured run settlement", "return (await (await fetch('/sessions/'+location.hash.split('/')[2])).json()).active_run == null;")
        let snapshot = try await js("return await (await fetch('/sessions/'+location.hash.split('/')[2])).json();") as! [String: Any]
        let metadata = snapshot["metadata"] as! [String: Any]
        let config = try await js("return await (await fetch('/sessions/'+location.hash.split('/')[2]+'/config')).json();") as! [String: Any]
        let summaries = snapshot["sessions"] as? [[String: Any]] ?? []
        guard let summary = summaries.first(where: { ($0["session_id"] as? String) == (metadata["session_id"] as? String) }),
              summary["sandboxed"] as? Bool == false,
              summary["ssh_host"] == nil || summary["ssh_host"] is NSNull,
              metadata["project_id"] as? String == projectID,
              config["model"] as? String == model.model,
              config["backend"] as? String == model.backend,
              config["base_url"] as? String == model.endpoint,
              config["api_key_env"] as? String == model.credential else {
            throw DesktopStartupError.message("Configured run did not retain its Local project and exact selected model route")
        }
        evidence["session_id"] = metadata["session_id"]
        evidence["execution_backend"] = "local"
        evidence["configured_local_run"] = true
        evidence["real_vendor_run"] = vendor
        evidence["behavior"] = metadata["behavior"]
        _ = try await js("window.__startupReloading = true; return true;")
        app.webView.reload()
        try await waitJS("retained configured transcript", "return !window.__startupReloading && document.body.innerText.includes(\(json(responseText)));")
        evidence["persisted_reload"] = true
        if value("--smoke-paint") == "1" {
            guard let sessionID = metadata["session_id"] as? String else {
                throw DesktopStartupError.message("Configured capture has no owned session")
            }
            try await capture(expectedAnswer: responseText, sessionID: sessionID)
        }
    }

    private func scriptedLaunchModel() async throws -> LaunchModel {
        let provider = value("--smoke-provider")!
        let saved = try await js("""
        const response = await fetch('/provider-connections', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          backend:'openai-responses', base_url:\(json(provider)), api_key:'preview-dummy-only'})});
        if (!response.ok) throw new Error(await response.text());
        const catalog = await (await fetch('/models')).json();
        const route = catalog.providers.find(p => p.id === 'openai-responses')?.connection;
        if (!route || route.base_url !== \(json(provider))) throw new Error('Scripted provider route is missing');
        return route;
        """) as! [String: Any]
        guard let credential = saved["api_key_env"] as? String,
              let endpoint = saved["base_url"] as? String else {
            throw DesktopStartupError.message("Scripted provider config did not expose its non-secret credential selector")
        }
        _ = try await js("window.__startupReloading = true; return true;")
        app.webView.reload()
        try await waitJS("onboarding after configuration", "return !window.__startupReloading && [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Get Started');")
        let displayName = try await js("""
        const provider = (await (await fetch('/models')).json()).providers.find(p => p.id === 'openai-responses');
        if (!provider || provider.connection?.base_url !== \(json(endpoint)) || provider.connection?.api_key_env !== \(json(credential)))
          throw new Error('Scripted provider route is not in the shared model catalog');
        const model = provider.models.find(m => m.id === 'gpt-5.6-sol');
        if (!model) throw new Error('Scripted model is not in the shared model catalog');
        return model.display_name || model.id;
        """) as! String
        return LaunchModel(backend: "openai-responses", model: "gpt-5.6-sol", displayName: displayName,
                           account: "OpenAI", endpoint: endpoint, credential: credential)
    }

    private func vendorLaunchModel() async throws -> LaunchModel {
        let available = try await js("""
        const response = await fetch('/providers/models', {method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({backend:'arcee-api',api_key_env:'ARCEE_API_KEY'})});
        if (!response.ok) throw new Error('Existing provider model discovery returned HTTP '+response.status);
        return (await response.json()).models;
        """) as! [[String: Any]]
        let selected = available.first(where: { $0["id"] as? String == "trinity-large-thinking" }) ?? available.first
        guard let model = selected?["id"] as? String else {
            throw DesktopStartupError.message("The existing API credential has no available model for qualification")
        }
        let endpoint = try await js("""
        const provider = (await (await fetch('/models')).json()).providers.find(p => p.id === 'arcee-api');
        if (!provider || provider.connection?.api_key_env !== 'ARCEE_API_KEY')
          throw new Error('Arcee catalog has no environment-backed route');
        return provider.connection.base_url;
        """) as! String
        evidence["vendor_discovery"] = "existing authenticated /providers/models using environment variable name"
        evidence["available_model_count"] = available.count
        evidence["selected_available_model"] = model
        return LaunchModel(backend: "arcee-api", model: model, displayName: selected?["display_name"] as? String ?? model,
                           account: "Arcee (API key)", endpoint: endpoint, credential: "ARCEE_API_KEY")
    }

    private func selectHomeModel(_ model: LaunchModel) async throws {
        let chip = "document.querySelector('button[aria-label^=\"Model: \"], button[aria-label=\"Choose a model\"]')"
        try await waitJS("Home model chip", "return !!(\(chip)) && !\(chip).disabled;")
        _ = try await js("\(chip).click(); return true;")
        let search = "input[aria-label=\"Search models\"]"
        let settings = "[role=dialog][aria-label=\"Model settings\"]"
        let modelMenu = "document.querySelector(\(json(settings + " button[aria-label^=\"Choose model\"]")))"
        try await waitJS("Home model list entry", "return !!document.querySelector(\(json(search))) || !!(\(modelMenu));")
        _ = try await js("if (!document.querySelector(\(json(search)))) \(modelMenu).click(); return true;")
        try await waitJS("Home model search", "return !!document.querySelector(\(json(search)));")
        try await fill(search, model.model)
        let label = model.displayName.replacingOccurrences(of: #"^[^:]+:\s+"#, with: "", options: .regularExpression)
        let selection = "[...document.querySelectorAll('[role=menu][aria-label=Model] [role=menuitemradio]')].find(row => row.parentElement.firstElementChild?.textContent.trim() === \(json(model.account)) && row.firstElementChild?.textContent.trim() === \(json(label)))"
        try await waitJS("exact provider model row", "return !!(\(selection));")
        _ = try await js("\(selection).click(); return true;")
        try await waitJS("committed Home model choice", "return !!(\(modelMenu)) && !document.querySelector(\(json(search))) && \(chip)?.getAttribute('aria-label')?.startsWith(\(json("Model: " + label))) === true;")
        _ = try await js("""
        const chooser = \(modelMenu);
        chooser.focus();
        if (document.activeElement !== chooser) throw new Error('Home model chooser did not own keyboard focus');
        chooser.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
        return true;
        """)
        try await waitJS("Home model settings closed", "return !document.querySelector(\(json(settings))) && \(chip)?.getAttribute('aria-expanded') === 'false';")
    }

    /// Home sends its first prompt once the session exists. The real-provider
    /// smoke still checks the exact created model route before allowing any run.
    private func fenceVendorLaunch(_ model: LaunchModel, projectID: String, prompt: String, selectionOnly: Bool) async throws {
        guard let base = app.baseURL else {
            throw DesktopStartupError.message("Cannot guard the vendor fixture without the owned engine origin")
        }
        let source = """
        (() => {
        if (location.origin !== new URL(\(json(base.absoluteString))).origin) return;
        const originalFetch = window.fetch.bind(window);
        const expected = record => record?.backend === \(json(model.backend)) && record.model === \(json(model.model))
          && record.base_url === \(json(model.endpoint)) && record.api_key_env === \(json(model.credential));
        const payload = async (input, options) => {
          const body = options?.body ?? (input instanceof Request ? await input.clone().text() : null);
          return typeof body === 'string' ? JSON.parse(body) : null;
        };
        let observedProjectRead = false, armed = false, creating = false, runSent = false, session = null;
        Object.defineProperty(window, '__startupVendorGate', {value: Object.freeze({
          get observedProjectRead() { return observedProjectRead; },
          get session() { return session; },
          arm() {
            if (!observedProjectRead || armed) return false;
            armed = true;
            return true;
          }
        })});
        window.fetch = async (input, options) => {
          const path = new URL(input instanceof Request ? input.url : input, location.href);
          const method = (options?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
          if (path.origin !== location.origin) return originalFetch(input, options);
          if (method === 'GET' && path.pathname === '/projects') {
            const headers = new Headers(options?.headers ?? (input instanceof Request ? input.headers : undefined));
            if (headers.has('x-nac-request-id')) observedProjectRead = true;
          }
          if (method === 'POST' && path.pathname === '/sessions') {
            const body = await payload(input, options);
            if (!armed || creating || body?.project_id !== \(json(projectID)) || !expected(body))
              throw new Error('The vendor launch request did not select the verified model route');
            creating = true;
            const response = await originalFetch(input, options);
            if (!response.ok) return response;
            const created = await response.clone().json();
            const createdID = created.metadata?.session_id;
            if (!createdID) throw new Error('Vendor launch returned no session');
            const config = await originalFetch('/sessions/' + encodeURIComponent(createdID) + '/config');
            if (!config.ok || !expected(await config.json()))
              throw new Error('Created vendor session did not retain the verified model route');
            session = createdID;
            return response;
          }
          if (method === 'POST' && /^\\/sessions\\/[^/]+\\/runs$/.test(path.pathname)) {
            const body = await payload(input, options);
            if (!armed || \(selectionOnly ? "true" : "false") || runSent || !session
                || path.pathname !== '/sessions/' + encodeURIComponent(session) + '/runs'
                || body?.prompt !== \(json(prompt)))
              throw new Error('The vendor fixture did not authorize this model run');
            runSent = true;
          }
          return originalFetch(input, options);
        };
        })();
        """
        // main.tsx binds fetch when the client is constructed. Install before
        // reload so that binding captures this guard, then observe a real client
        // read. The smoke deliberately sends no project probe during this wait.
        app.webView.configuration.userContentController.addUserScript(
            WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        _ = try await js("window.__startupReloading = true; return true;")
        app.webView.reload()
        try await waitJS("vendor guard captured by the reloaded Home client", """
        return !window.__startupReloading && window.__startupVendorGate?.observedProjectRead === true
          && new URLSearchParams(location.hash.split('?')[1]).get('project') === \(json(projectID))
          && !!document.querySelector('textarea#home-composer');
        """)
    }

    func didStop() {
        evidence["stopped"] = app.engine.pid == 0 && app.engine.receipt == nil
        write()
    }

    private func commandJourney() async throws {
        if scenario.contains("mcp") {
            // MCP servers is a Settings section: the sidebar's Settings gear,
            // then the section link (the shell has no MCP button).
            try await waitJS("shared Settings navigation", "return !!document.querySelector('button[aria-label=Settings]');")
            _ = try await js("document.querySelector('button[aria-label=Settings]').click(); return true;")
            let mcpEntry = "[...(document.querySelector('nav[aria-label=\"Settings sections\"]')?.querySelectorAll('a') || [])].find(a => a.textContent.trim() === 'MCP servers')"
            try await waitJS("shared Settings sections", "return !!(\(mcpEntry));")
            _ = try await js("\(mcpEntry).click(); return true;")
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
        if scenario == "startup-missing-ssh" {
            _ = try await js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Get Started').click(); return true;")
            try await waitJS("SSH project location", "return [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'SSH');")
            _ = try await js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'SSH').click(); return true;")
            try await waitJS("SSH host control", "return !!document.querySelector('input[placeholder=\"example@192.0.2.10 or build-box\"]');")
            try await fill("input[placeholder=\"example@192.0.2.10 or build-box\"]", "fixture@missing-command.invalid")
            _ = try await js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Connect').click(); return true;")
            try await waitJS("missing SSH guidance", "return document.body.textContent.includes('SSH connect failed:');")
            try await waitJS("SSH still selected", "return [...document.querySelectorAll('button[aria-pressed=true]')].some(b => b.textContent.trim() === 'SSH');")
            evidence["selected_backend_preserved"] = "ssh"
        } else {
            let launchFolder = "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Use launch folder' && !b.disabled)"
            try await waitJS("local launch folder", "return !!(\(launchFolder));")
            _ = try await js("\(launchFolder).click(); return true;")
            let settings = "document.querySelector('button[aria-label=\"Additional settings\"]:not(:disabled)')"
            try await waitJS("local workspace settings", "return location.hash.startsWith('#/?project=') && !!(\(settings));")
            _ = try await js("\(settings).click(); return true;")
            let sandbox = "document.querySelector('[role=switch][aria-label=Sandbox]:not(:disabled)')"
            try await waitJS("sandbox setting", "return !!(\(sandbox));")
            _ = try await js("\(sandbox).click(); return true;")
            try await waitJS("missing Podman guidance with sandbox retained", """
            return \(sandbox)?.getAttribute('aria-checked') === 'true'
              && document.body.textContent.toLowerCase().includes('podman is not installed')
              && !!document.querySelector('button[aria-label="Start sandbox session"]:disabled');
            """)
            evidence["selected_backend_preserved"] = "sandbox"
        }
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

    static let configuredPaintReadinessScript = #"""
    const route = location.hash.split('/');
    if (window.__startupReloading || route[1] !== 'session' || route[2] !== expectedSessionID ||
        document.visibilityState !== 'visible' ||
        document.querySelector('[aria-label="Loading conversation"]') ||
        document.querySelectorAll('[data-nac-runtime]').length !== 1) return false;
    const visible = element => {
      if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      const bounds = element.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0 || bounds.left < 0 || bounds.top < 0 ||
          bounds.right > innerWidth || bounds.bottom > innerHeight) return false;
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) < .99)
          return false;
      }
      return true;
    };
    return [...document.querySelectorAll('[data-nac-runtime] p')]
      .filter(element => element.textContent.trim() === expectedAnswer && visible(element)).length === 1;
    """#

    private func capture(expectedAnswer: String, sessionID: String) async throws {
        let probe = "const expectedAnswer=\(json(expectedAnswer)); const expectedSessionID=\(json(sessionID));" + Self.configuredPaintReadinessScript
        try await waitJS("visible configured transcript", probe)
        _ = try await js("window.__startupPaintFrame=false; requestAnimationFrame(()=>requestAnimationFrame(()=>window.__startupPaintFrame=true)); return true;")
        try await waitJS("fresh configured transcript frame", "return window.__startupPaintFrame === true;")
        try await waitJS("configured transcript after frame", probe)
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
        guard (try await js(probe)) as? Bool == true else {
            throw DesktopStartupError.message("Configured transcript changed around capture")
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
