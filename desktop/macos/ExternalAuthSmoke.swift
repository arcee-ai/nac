#if PREVIEW_SMOKE && !LOCAL_APP
import AppKit
import WebKit
import CoreFoundation

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
        guard let receipt = app.engine.receipt, let identity = receipt.identity, let schema = receipt.schema else {
            throw PreviewError.message("Missing owned auth engine identity")
        }
        var witness = ExternalAuthCallbackWitness(source: identity.source_revision, build: identity.build_id,
            schema: schema, pid: Int(app.engine.pid))
        var capture: ExternalAuthCallbackCapture?
        guard let detach = app.engine.observeExternalAuthDiagnostics(incarnation: receipt.incarnation,
                makeConsumer: { atBoundary in
                    let next = ExternalAuthCallbackCapture(witness: witness, atRecordBoundary: atBoundary)
                    capture = next
                    return { next.receive($0) }
                }), let capture else { throw ExternalAuthCallbackWitness.Refusal.invalid }
        defer { detach() }

        var results: [String: Any] = ["physical_input_qualified": false, "device_server_owner_qualified": false]
        for mode in ["success", "denied", "wrong-state", "hold"] {
            try await configure(mode, credential: credential)
            try await openPanel()
            guard let binding = currentDocument else { throw PreviewError.message("Auth document unavailable") }
            witness = try capture.snapshot()
            let baseline = witness.owners
            try await clickButton("Authenticate")
            try await wait("production authorization link") {
                try await self.js("return [...document.querySelectorAll('a')].some(a => a.textContent.trim() === 'Continue OAuth authorization')") as? Bool == true
            }
            var owner: UInt64?
            try await wait("bound callback listener observation") {
                guard self.currentDocument == binding, self.app.engine.pid == enginePID,
                      self.app.engine.receipt?.incarnation == receipt.incarnation,
                      self.app.engine.receipt?.identity == identity else { throw ExternalAuthCallbackWitness.Refusal.invalid }
                witness = try capture.snapshot()
                owner = try witness.newOwner(after: baseline)
                return owner != nil
            }
            guard let owner else { throw ExternalAuthCallbackWitness.Refusal.invalid }
            let tokenBaseline = try await tokenCounts()
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
            case "wrong-state":
                var rejectionObserved: UInt64 = 0
                var cancelIssued: UInt64 = 0
                try await ExternalAuthCallbackWitness.rejectThenCancel(rejection: {
                    try await self.wait("received wrong-state callback rejection") {
                        guard self.currentDocument == binding, self.app.engine.pid == enginePID,
                              self.app.engine.receipt?.incarnation == receipt.incarnation,
                              self.app.engine.receipt?.identity == identity else { throw ExternalAuthCallbackWitness.Refusal.invalid }
                        witness = try capture.snapshot()
                        return try witness.rejection(owner: owner, baseline: baseline)
                    }
                    guard try await self.tokenCounts() == tokenBaseline else { throw ExternalAuthCallbackWitness.Refusal.invalid }
                    rejectionObserved = DispatchTime.now().uptimeNanoseconds
                }, waiting: { try await self.oauthStatus("Waiting for authorization") },
                   cancel: {
                       guard try await self.tokenCounts() == tokenBaseline else { throw ExternalAuthCallbackWitness.Refusal.invalid }
                       guard self.currentDocument == binding, self.app.engine.pid == enginePID,
                             self.app.engine.receipt?.incarnation == receipt.incarnation,
                             self.app.engine.receipt?.identity == identity else { throw ExternalAuthCallbackWitness.Refusal.invalid }
                       witness = try capture.snapshot()
                       guard try witness.rejection(owner: owner, baseline: baseline) else { throw ExternalAuthCallbackWitness.Refusal.invalid }
                       cancelIssued = DispatchTime.now().uptimeNanoseconds
                       try await self.clickButton("Cancel authorization")
                   },
                   settled: { try await self.oauthStatus("Ready to connect") })
                guard try await tokenCounts() == tokenBaseline else { throw ExternalAuthCallbackWitness.Refusal.invalid }
                guard rejectionObserved > 0, cancelIssued > rejectionObserved else { throw ExternalAuthCallbackWitness.Refusal.invalid }
                var proof = try witness.proof(owner: owner)
                proof["engine_incarnation"] = receipt.incarnation
                proof["document"] = binding.document
                proof["view"] = binding.view
                proof["launch"] = binding.launch
                proof["rejection_observed_ns"] = String(rejectionObserved)
                proof["cancel_issued_ns"] = String(cancelIssued)
                proof["token_counts_before"] = tokenBaseline
                proof["token_counts_after"] = try await tokenCounts()
                results["wrong_state_callback_witness"] = proof
                results["wrong_state_rejected_then_canceled"] = true
            case "hold":
                try await oauthStatus("Waiting for authorization")
                try await clickButton("Cancel authorization")
                try await oauthStatus("Ready to connect")
                results["pending_authorization_canceled"] = true
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

    private func tokenCounts() async throws -> [Int] {
        let evidence = try await fixtureEvidence()
        guard let issued = evidence["tokens_issued"] as? Int, let events = evidence["events"] as? [[String: Any]] else {
            throw ExternalAuthCallbackWitness.Refusal.invalid
        }
        return [issued, events.filter { $0["kind"] as? String == "token_exchange" }.count]
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
// BEGIN EXTERNAL AUTH CALLBACK WITNESS (Foundation-only inert controls)
struct ExternalAuthCallbackWitness {
    enum Refusal: Error { case invalid }
    let source: String
    let build: String
    let schema: Int
    let pid: Int
    private(set) var recorder: String?
    private(set) var owners: Set<UInt64> = []
    private var rejected: Set<UInt64> = []
    private var seen: [String: String] = [:]
    private var processBound = false
    private(set) var liveAccounting: [String: Any]?

    init(source: String, build: String, schema: Int, pid: Int) {
        self.source = source
        self.build = build
        self.schema = schema
        self.pid = pid
    }

    private func integer(_ value: Any?) throws -> UInt64 {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              !["d", "f"].contains(String(cString: number.objCType)),
              let value = UInt64(number.stringValue) else { throw Refusal.invalid }
        return value
    }

    private func flag(_ value: Any?) throws -> Bool {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { throw Refusal.invalid }
        return number.boolValue
    }

    private func runtime(_ row: [String: Any]) throws {
        guard let runtime = row["runtime"] as? [String: Any],
              Set(runtime.keys) == Set(["source_revision", "build_id", "scenario", "store_engine", "journal_mode", "schema_version"]),
              runtime["source_revision"] as? String == source, runtime["build_id"] as? String == build,
              runtime["scenario"] as? String == "native-external-auth",
              runtime["store_engine"] as? String == "sqlite", runtime["journal_mode"] as? String == "wal",
              try integer(runtime["schema_version"]) == UInt64(schema), runtime["host"] == nil else {
            throw Refusal.invalid
        }
    }

    mutating func ingest(_ log: String, replayAllowed: Bool = true) throws {
        // The final fragment may still be in flight. It can never qualify a row.
        let complete = log.split(separator: "\n", omittingEmptySubsequences: false).dropLast()
        var occurrences: Set<String> = []
        for line in complete.map(String.init) {
            let event = line.hasPrefix("nac-telemetry ")
            let accounting = line.hasPrefix("nac-telemetry-export ")
            guard event || accounting else { continue }
            let prefix = event ? "nac-telemetry " : "nac-telemetry-export "
            guard let data = String(line.dropFirst(prefix.count)).data(using: .utf8),
                  let row = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Refusal.invalid }
            if event {
                guard let name = row["name"] as? String else { throw Refusal.invalid }
                guard ["nac.mcp.oauth.callback.listening", "nac.mcp.oauth.callback.state_rejected"].contains(name) else { continue }
                try runtime(row)
                guard Set(row.keys) == Set(["timestamp_unix_ms", "export_recorder_id", "name", "kind", "outcome", "correlation", "runtime"]),
                      row["kind"] as? String == "diagnostic",
                      let correlation = row["correlation"] as? [String: Any], Set(correlation.keys) == ["generation"],
                      let id = row["export_recorder_id"] as? String, UUID(uuidString: id) != nil else { throw Refusal.invalid }
                let owner = try integer(correlation["generation"])
                guard owner > 0, try integer(row["timestamp_unix_ms"]) > 0,
                      recorder == nil || recorder == id else { throw Refusal.invalid }
                recorder = id
                let key = "\(owner):\(name)"
                guard occurrences.insert(key).inserted else { throw Refusal.invalid }
                if let previous = seen[key] {
                    guard replayAllowed && previous == line else { throw Refusal.invalid }
                    continue
                }
                if name.hasSuffix(".listening") {
                    guard owners.count < 4, seen.count < 8, row["outcome"] as? String == "started", owners.insert(owner).inserted else { throw Refusal.invalid }
                } else {
                    guard seen.count < 8, row["outcome"] as? String == "error", owners.contains(owner), rejected.insert(owner).inserted else { throw Refusal.invalid }
                }
                seen[key] = line
            } else {
                try runtime(row)
                guard let id = row["recorder_id"] as? String, UUID(uuidString: id) != nil,
                      recorder == nil || recorder == id, try integer(row["process_id"]) == UInt64(pid),
                      try flag(row["final_receipt"]) == false,
                      let stats = row["stats"] as? [String: Any],
                      try integer(stats["dropped"]) == 0, try integer(stats["failures"]) == 0,
                      try integer(row["receipt_failures"]) == 0 else { throw Refusal.invalid }
                recorder = id
                processBound = true
                liveAccounting = row
            }
        }
    }

    func newOwner(after baseline: Set<UInt64>) throws -> UInt64? {
        let added = owners.subtracting(baseline)
        guard added.count <= 1 else { throw Refusal.invalid }
        return processBound ? added.first : nil
    }

    func rejection(owner: UInt64, baseline: Set<UInt64>) throws -> Bool {
        guard owners == baseline.union([owner]), processBound else { throw Refusal.invalid }
        return rejected.contains(owner)
    }

    func proof(owner: UInt64) throws -> [String: Any] {
        guard processBound, owners.contains(owner), rejected.contains(owner), let recorder else { throw Refusal.invalid }
        let rows = try ["nac.mcp.oauth.callback.listening", "nac.mcp.oauth.callback.state_rejected"].map { name -> Any in
            guard let line = seen["\(owner):\(name)"], let data = String(line.dropFirst("nac-telemetry ".count)).data(using: .utf8) else { throw Refusal.invalid }
            return try JSONSerialization.jsonObject(with: data)
        }
        return ["observations": rows, "owner": String(owner), "recorder_id": recorder, "source": source, "build": build,
                "schema": schema, "engine_pid": pid, "state_rejection_observed": true,
                "rejection_before_cancel": true, "complete_stream_capture": false]
    }

    static func rejectThenCancel(rejection: () async throws -> Void, waiting: () async throws -> Void,
                                 cancel: () async throws -> Void, settled: () async throws -> Void) async throws {
        try await rejection()
        try await waiting()
        try await cancel()
        try await settled()
    }
}
// The existing MainActor pipe reader calls this before trimming its ordinary log.
// Retain only the validated four-flow witness (at most eight positive rows), one
// matching live accounting row, and one bounded partial byte record. No new queue.
final class ExternalAuthCallbackCapture {
    private var witness: ExternalAuthCallbackWitness
    private var partial = Data()
    private var refused = false
    private var discardingInitialFragment: Bool
    private let maximumLineBytes = 65_536

    init(witness: ExternalAuthCallbackWitness, atRecordBoundary: Bool) {
        self.witness = witness
        discardingInitialFragment = !atRecordBoundary
    }

    func receive(_ data: Data) {
        guard !refused else { return }
        for byte in data {
            // Only a known pre-subscription fragment is skipped. The first full
            // record after its real LF is processed, even in this same chunk.
            if discardingInitialFragment {
                if byte == 10 { discardingInitialFragment = false }
                continue
            }
            if byte == 10 {
                guard let line = String(data: partial, encoding: .utf8) else { refuse(); return }
                partial.removeAll(keepingCapacity: true)
                do { try witness.ingest(line + "\n", replayAllowed: false) }
                catch { refuse(); return }
            } else {
                guard partial.count < maximumLineBytes else { refuse(); return }
                partial.append(byte)
            }
        }
    }

    private func refuse() {
        refused = true
        partial.removeAll(keepingCapacity: false)
    }

    func snapshot() throws -> ExternalAuthCallbackWitness {
        guard !refused else { throw ExternalAuthCallbackWitness.Refusal.invalid }
        return witness
    }
}
// END EXTERNAL AUTH CALLBACK WITNESS

#endif
