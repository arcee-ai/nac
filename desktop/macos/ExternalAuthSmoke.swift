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
        app.webView.customUserAgent = "NACExternalAuthWK/ALL348 AppleWebKit/605.1.15"
    }

    func run() async throws -> [String: Any] {
        try await wait("verified loaded workspace") { self.app.commands.currentDocument(in: self.app.webView) != nil }
        try await wait("loaded production create-chat control") {
            try await self.js("return [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Create chat' && !b.disabled)") as? Bool == true
        }
        try await clickButton("Create chat")
        try await wait("current workspace document") { self.app.commands.currentDocument(in: self.app.webView) != nil }
        // Seed only a disabled local MCP fixture and its fake public client ID.
        // Authorization URLs remain in the existing React panel; Swift never
        // receives or serializes state/code/token-bearing URLs.
        let seed = try await js(#"""
        const post = async(path, body) => {
          const r = await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
          if (!r.ok) throw new Error('Auth fixture setup rejected'); return r.json();
        };
        const credential = await post('/credentials',{value:'local-fixture-client'});
        await post('/mcp_library/servers',{name:'external-auth-fixture',enabled:false,transport:'streamable_http',
          url:fixture+'/mcp',headers:{},args:[],env:{}});
        window.__externalAuthFixture = {fixture, credential:credential.name};
        return true;
        """#, arguments: ["fixture": fixture.absoluteString]) as? Bool
        guard seed == true else { throw PreviewError.message("Auth fixture setup did not complete") }
        var results: [String: Any] = ["physical_input_qualified": false, "device_server_owner_qualified": false]
        for mode in ["success", "denied", "wrong-state", "hold"] {
            try await configure(mode)
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
                try await text("Connected")
                results["production_mcp_connected"] = true
            case "denied":
                try await text("Authorization failed")
                results["production_mcp_denied"] = true
            case "wrong-state", "hold":
                try await text("Waiting for authorization")
                try await clickButton("Cancel authorization")
                try await text("Ready to connect")
                results[mode == "wrong-state" ? "wrong_state_rejected_then_canceled" : "pending_authorization_canceled"] = true
            default: break
            }
            guard let base = app.baseURL, app.webView.url?.host == base.host, app.webView.url?.port == base.port,
                  app.commands.currentDocument(in: app.webView) != nil else {
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

    private func configure(_ mode: String) async throws {
        _ = try await js(#"""
        const f=window.__externalAuthFixture;
        const r=await fetch('/mcp_library/servers/external-auth-fixture/oauth/configure',{method:'POST',
          headers:{'Content-Type':'application/json'},body:JSON.stringify({
            registration:{type:'pre_registered',client_id_credential:f.credential},scopes:['fixture:read'],
            authorization_metadata:{authorization_endpoint:f.fixture+'/oauth/authorize/'+mode,
              token_endpoint:f.fixture+'/oauth/token',issuer:f.fixture,response_types_supported:['code'],
              code_challenge_methods_supported:['S256']}})});
        if(!r.ok)throw new Error('Fixture OAuth configure rejected');return true;
        """#, arguments: ["mode": mode])
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
        return try await withCheckedThrowingContinuation { continuation in
            var resolved = false
            let timeout = Task { @MainActor in
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard !Task.isCancelled, !resolved else { return }
                resolved = true
                continuation.resume(throwing: PreviewError.message("Auth WK fixture evaluation timed out"))
            }
            app.webView.callAsyncJavaScript(script, arguments: arguments, in: nil, in: .page) { result in
                guard !resolved else { return }
                resolved = true
                timeout.cancel()
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
