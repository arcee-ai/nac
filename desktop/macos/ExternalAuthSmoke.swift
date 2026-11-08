#if PREVIEW_SMOKE && !LOCAL_APP
import AppKit
import WebKit

/// Uses production React MCP controls and the real NSWorkspace opener. DOM
/// automation is explicit; this is not trusted physical-input qualification.
@MainActor
final class ExternalAuthSmoke {
    private unowned let app: PreviewApp
    private let fixture: URL
    private let checkpoint: () -> Void

    init(app: PreviewApp, checkpoint: @escaping () -> Void) throws {
        self.app = app
        self.checkpoint = checkpoint
        let args = CommandLine.arguments
        guard let option = args.firstIndex(of: "--external-auth-origin"), option + 1 < args.count,
              let fixture = URL(string: args[option + 1]), fixture.scheme == "http", fixture.host == "127.0.0.1",
              fixture.port != nil, fixture.user == nil, fixture.password == nil,
              fixture.query == nil, fixture.fragment == nil, ["", "/"].contains(fixture.path) else {
            throw PreviewError.message("Missing owned external-auth fixture origin")
        }
        self.fixture = fixture
        app.webView?.customUserAgent = "NACExternalAuthWK/ALL348 AppleWebKit/605.1.15"
    }

    // Fixture preparation only. A ready WK document alone does not mean the
    // asynchronous Create chat navigation and its modal teardown have settled.
    private static let sessionReadyScript = #"""
    const composer=document.querySelector('[role=combobox][aria-label=Message]');
    const bounds=composer?.getBoundingClientRect();
    return /^#\/session\/[^/]+(?:\/|$)/.test(location.hash) &&
      (!expectedRoute || location.hash===expectedRoute) &&
      !!bounds && bounds.width>0 && bounds.height>0 && !document.querySelector('[role=dialog]');
    """#

    private static let seedScript = #"""
    const post = async(path, body) => {
      const r = await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if (!r.ok) throw new Error('Auth fixture setup rejected'); return r.json();
    };
    const credential = await post('/credentials',{value:'local-fixture-client'});
    await post('/mcp_library/servers',{name:'external-auth-fixture',enabled:false,transport:'streamable_http',
      url:fixture+'/mcp',headers:{},args:[],env:{}});
    return credential.name;
    """#

    private static let configureScript = #"""
    const r=await fetch('/mcp_library/servers/external-auth-fixture/oauth/configure',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({
        registration:{type:'pre_registered',client_id_credential:credential},scopes:['fixture:read'],
        authorization_metadata:{authorization_endpoint:fixture+'/oauth/authorize/'+mode,
          token_endpoint:fixture+'/oauth/token',issuer:fixture,response_types_supported:['code'],
          code_challenge_methods_supported:['S256']}})});
    if(!r.ok)throw new Error('Fixture OAuth configure rejected');return true;
    """#

    private var currentDocument: NativeDocumentBinding? {
        guard let view = app.webView else { return nil }
        return app.commands?.currentDocument(in: view)
    }

    func run() async throws -> [String: Any] {
        try await wait("verified loaded workspace") { self.currentDocument != nil }
        try await wait("loaded production create-chat control") {
            try await self.js("return [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Create chat' && !b.disabled)") as? Bool == true
        }
        try await clickButton("Create chat")
        try await wait("created session route and production composer") {
            try await self.js(Self.sessionReadyScript, arguments: ["expectedRoute": ""]) as? Bool == true
        }
        guard let sessionRoute = try await js("return location.hash") as? String else {
            throw PreviewError.message("Created session route is unavailable")
        }
        // Seed only the disabled local fixture and fake public client. The only
        // value returned to Swift is its opaque name, never a credential value
        // or a state/code/token-bearing authorization URL.
        guard let credential = try await js(Self.seedScript, arguments: ["fixture": fixture.absoluteString]) as? String,
              !credential.isEmpty, let before = currentDocument, let view = app.webView else {
            throw PreviewError.message("Auth fixture setup did not complete")
        }
        let enginePID = app.engine.pid
        // Direct fixture writes bypass React mutation invalidation. Reload the
        // real document so the already-warm empty MCP cache cannot hide them.
        view.reload()
        try await wait("fresh document after auth fixture setup") {
            guard let current = self.currentDocument else { return false }
            return current.launch == before.launch && current.view == before.view &&
                current.document != before.document && self.app.engine.pid == enginePID
        }
        try await wait("same created session after fixture setup") {
            try await self.js(Self.sessionReadyScript, arguments: ["expectedRoute": sessionRoute]) as? Bool == true
        }
        var results: [String: Any] = ["physical_input_qualified": false, "device_server_owner_qualified": false]
        for mode in ["success", "denied", "wrong-state", "hold"] {
            try await configure(mode, credential: credential)
            try await openPanel()
            try await clickButton("Authenticate")
            try await wait("production authorization link") {
                try await self.js("return [...document.querySelectorAll('a')].some(a => a.textContent.trim() === 'Continue OAuth authorization')") as? Bool == true
            }
            let before = try await observations()
            _ = try await js("[...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'Continue OAuth authorization').click(); return true")
            try await wait("external browser request") { try await self.observations() > before }
            switch mode {
            case "success":
                try await oauthStatus("Connected")
                results["production_mcp_connected"] = true
            case "denied":
                try await oauthStatus("Authorization failed")
                results["production_mcp_denied"] = true
            case "wrong-state", "hold":
                try await oauthStatus("Waiting for authorization")
                try await clickButton("Cancel authorization")
                try await oauthStatus("Ready to connect")
                results[mode == "wrong-state" ? "wrong_state_rejected_then_canceled" : "pending_authorization_canceled"] = true
            default: break
            }
            guard let base = app.baseURL, app.webView?.url?.host == base.host, app.webView?.url?.port == base.port,
                  currentDocument != nil else {
                throw PreviewError.message("External sign-in replaced the verified workspace")
            }
            try await closePanel()
            _ = try await js("const r=await fetch('/mcp_library/servers/external-auth-fixture/oauth/logout',{method:'POST'}); if(!r.ok)throw new Error('Fixture logout rejected');return true")
        }
        let evidence = try await fixtureEvidence()
        guard let events = evidence["events"] as? [[String: Any]] else { throw PreviewError.message("Missing browser observations") }
        let observations = events.filter { $0["kind"] as? String == "browser_observation" }
        guard observations.count >= 4, observations.allSatisfy({ $0["bridge"] as? Bool == false && $0["webkit_fixture"] as? Bool == false }),
              evidence["tokens_issued"] as? Int == 1 else {
            throw PreviewError.message("External browser boundary or callback completion did not match")
        }
        results["external_browser_observations"] = observations.count
        results["external_content_has_no_bridge"] = true
        results["local_fake_key_create_chat_usable"] = true
        results["offline_qualified"] = false
        results["timeout_restart_qualified"] = false
        results["scope"] = "actual-app-system-WK-production-MCP-to-system-browser-local-double; DOM-driven"
        return results
    }

    private func configure(_ mode: String, credential: String) async throws {
        _ = try await js(Self.configureScript, arguments: ["mode": mode,
            "fixture": fixture.absoluteString, "credential": credential])
    }

    private func openPanel() async throws {
        try await wait("MCP navigation") {
            try await self.js("return !!document.querySelector('button[aria-label^=\"MCP servers\"]')") as? Bool == true
        }
        _ = try await js("document.querySelector('button[aria-label^=\"MCP servers\"]').click();return true")
        try await text("external-auth-fixture")
        try await wait("configured OAuth controls") {
            try await self.js("return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Authenticate'&&!b.disabled)") as? Bool == true
        }
    }

    private func closePanel() async throws {
        _ = try await js("document.querySelector('[role=dialog] button[aria-label=Close]')?.click();return true")
        try await wait("closed MCP dialog") { try await self.js("return !document.querySelector('[role=dialog]')") as? Bool == true }
    }

    private func clickButton(_ title: String) async throws {
        let found = try await js("const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===title&&!b.disabled);b?.click();return !!b", arguments: ["title": title]) as? Bool
        guard found == true else { throw PreviewError.message("Missing fixture UI control: \(title)") }
    }

    private static let oauthStatusScript = #"""
    const visible = e => {
      if (!e || e.closest('[hidden],[inert],[aria-hidden="true"],[data-covered]')) return false;
      for (let node=e; node; node=node.parentElement) {
        const style=getComputedStyle(node);
        if (style.display==='none' || style.visibility!=='visible' || Number(style.opacity)<0.99) return false;
      }
      const rect=e.getBoundingClientRect();return rect.width>0 && rect.height>0;
    };
    const dialogs=[...document.querySelectorAll('[role="dialog"][aria-label="MCP servers"][data-modal-open="true"]')].filter(visible);
    if (dialogs.length!==1) return false;
    const owner=dialogs[0];
    const names=[...owner.querySelectorAll('input[aria-label="Server name"]')].filter(visible);
    if (names.length!==1 || names[0].value!=='external-auth-fixture') return false;
    const sections=[...owner.querySelectorAll('section[aria-labelledby]')].filter(section=>{
      const heading=document.getElementById(section.getAttribute('aria-labelledby'));
      return visible(section) && heading && owner.contains(heading) && heading.textContent.trim()==='OAuth';
    });
    if (sections.length!==1) return false;
    const statuses=[...sections[0].querySelectorAll('[role="status"]')].filter(visible);
    return statuses.length===1 && statuses[0].textContent.trim()===value;
    """#

    private func oauthStatus(_ value: String) async throws {
        try await wait("OAuth UI status: \(value)") {
            try await self.js(Self.oauthStatusScript, arguments: ["value": value]) as? Bool == true
        }
    }

    private func text(_ value: String) async throws {
        try await wait("OAuth UI status: \(value)") {
            try await self.js("return [...document.querySelectorAll('span,div')].some(e=>e.textContent.trim()===value)", arguments: ["value": value]) as? Bool == true
        }
    }

    private func fixtureEvidence() async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(from: fixture.appendingPathComponent("evidence"))
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw PreviewError.message("Auth fixture evidence unavailable")
        }
        return value
    }

    private func observations() async throws -> Int {
        let events = try await fixtureEvidence()["events"] as? [[String: Any]] ?? []
        return events.filter { $0["kind"] as? String == "browser_observation" }.count
    }

    private func js(_ script: String, arguments: [String: Any] = [:]) async throws -> Any {
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
                continuation.resume(throwing: PreviewError.message("Auth WK fixture evaluation timed out"))
            }
            view.callAsyncJavaScript(script, arguments: arguments, in: nil, in: .page) { [weak view] result in
                guard !resolved else { return }
                resolved = true
                timeout.cancel()
                guard let view, self.app.webView === view, self.currentDocument == binding else {
                    continuation.resume(throwing: PreviewError.message("Auth fixture document retired during evaluation"))
                    return
                }
                switch result {
                case .success(let value): continuation.resume(returning: value)
                case .failure: continuation.resume(throwing: PreviewError.message("Auth WK fixture evaluation failed"))
                }
            }
        }
    }

    private func wait(_ label: String, timeout: TimeInterval = 25, _ condition: () async throws -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            checkpoint()
            if let failure = app.failure { throw PreviewError.message(failure) }
            if try await condition() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw PreviewError.message("Timed out waiting for \(label)")
    }
}
#endif
