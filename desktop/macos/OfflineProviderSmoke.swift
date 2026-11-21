#if PREVIEW_SMOKE && !LOCAL_APP
import AppKit
import WebKit

/// API-seeded loopback route, UI-selected session, and production Responses requests.
@MainActor
final class OfflineProviderSmoke {
    private unowned let app: PreviewApp
    private let fence: OfflineNetworkFence
    private var document: NativeDocumentBinding?
    private var receipt: EngineReceipt?
    private var pid: pid_t = 0

    init(app: PreviewApp, fence: OfflineNetworkFence) { self.app = app; self.fence = fence }

    private func owned() throws -> WKWebView {
        guard let view = app.webView, let receipt, app.engine.receipt?.incarnation == receipt.incarnation, app.engine.receipt?.identity == receipt.identity,
              pid > 0, app.engine.pid == pid, let document,
              app.commands?.currentDocument(in: view) == document else { throw OfflineProviderPolicy.Refusal.invalid }
        try fence.requireStore(view)
        return view
    }

    private func js(_ script: String, _ arguments: [String: Any] = [:]) async throws -> Any {
        let view = try owned()
        let result = try await view.callAsyncJavaScript(script, arguments: arguments, in: nil, contentWorld: .page)
        guard try owned() === view else { throw OfflineProviderPolicy.Refusal.invalid }
        return result ?? NSNull()
    }

    private func wait(_ condition: () async throws -> Bool) async throws {
        let end = ProcessInfo.processInfo.systemUptime + 25
        while ProcessInfo.processInfo.systemUptime < end {
            guard app.failure == nil else { throw OfflineProviderPolicy.Refusal.invalid }
            if try await condition() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw OfflineProviderPolicy.Refusal.missingObservation
    }

    private static let visible = #"""
    const visible=e=>!!e && !e.closest('[hidden],[inert],[aria-hidden=true]') &&
      e.getBoundingClientRect().width>0 && e.getBoundingClientRect().height>0;
    """#

    private func input(_ label: String, _ value: String) async throws {
        guard try await js(Self.visible + #"""
        const fields=[...document.querySelectorAll('input')].filter(e=>visible(e)&&e.getAttribute('aria-label')===label);
        if(fields.length!==1)return false;
        const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
        setter.call(fields[0],value); fields[0].dispatchEvent(new Event('input',{bubbles:true}));return true;
        """#, ["label": label, "value": value]) as? Bool == true else { throw OfflineProviderPolicy.Refusal.invalid }
    }

    private func setup() async throws {
        // The current product exposes provider keys in Settings but does not
        // offer custom endpoint entry. Seed the isolated loopback connection
        // through its production API, then select its model in the real UI.
        guard try await js(#"""
        const r=await fetch('/provider-connections',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({backend:'openai-responses',base_url:origin,allow_insecure_http:true,api_key:key})});
        if(r.status!==201)return false;const c=await r.json();
        return !JSON.stringify(c).includes(key);
        """#, ["origin": fence.origin.absoluteString, "key": OfflineProviderPolicy.key]) as? Bool == true else { throw OfflineProviderPolicy.Refusal.invalid }
        // Refresh the production catalog after API seeding. Bind the new
        // document to the same owned view and engine before issuing UI input.
        let previous = document!
        let view = try owned()
        view.reload()
        let end = ProcessInfo.processInfo.systemUptime + 25
        while ProcessInfo.processInfo.systemUptime < end {
            if let next = app.commands?.currentDocument(in: view), next != previous {
                guard next.launch == previous.launch, next.view == previous.view else { throw OfflineProviderPolicy.Refusal.invalid }
                document = next; break
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        guard document != previous else { throw OfflineProviderPolicy.Refusal.missingObservation }
        try await wait { try await self.js(Self.visible + #"""
        const f=document.getElementById('home-composer');
        const chip=document.querySelector('button[aria-label="Choose a model"], button[aria-label^="Model: "]');
        return !!f&&!f.disabled&&[...f.labels].some(l=>l.textContent.trim()==='What should we work on?')&&visible(chip)&&!chip.disabled;
        """#) as? Bool == true }
        _ = try await js(#"document.querySelector('button[aria-label="Choose a model"], button[aria-label^="Model: "]').click();return true;"#)
        try await wait { try await self.js("return !!document.querySelector('[role=dialog][aria-label=\"Model settings\"] button[aria-label^=\"Choose model\"]');") as? Bool == true }
        _ = try await js("document.querySelector('[role=dialog][aria-label=\"Model settings\"] button[aria-label^=\"Choose model\"]').click();return true;")
        try await wait { try await self.js("return !!document.querySelector('input[aria-label=\"Search models\"]');") as? Bool == true }
        try await input("Search models", "gpt-5.6-sol")
        try await wait { try await self.js(Self.visible + #"""
        const rows=[...document.querySelectorAll('[role=group][aria-label="OpenAI"] [role=menuitemradio]')]
          .filter(b=>visible(b)&&!b.disabled&&b.textContent.toLowerCase().includes('gpt-5.6'));
        if(rows.length!==1)return false;rows[0].click();return true;
        """#) as? Bool == true }
        try await wait { try await self.js(#"""
        const settings=document.querySelector('[role=dialog][aria-label="Model settings"]');
        const chooser=settings?.querySelector('button[aria-label^="Choose model"]');
        const chip=document.querySelector('button[aria-label^="Model: "]');
        if(!chooser||settings?.querySelector('input[aria-label="Search models"]')||!chip)return false;
        chooser.focus();if(document.activeElement!==chooser)throw new Error('chooser focus');
        chooser.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;
        """#) as? Bool == true }
        try await wait { try await self.js(#"return !document.querySelector('[role=dialog][aria-label="Model settings"]') && document.querySelector('button[aria-label^="Model: "]')?.getAttribute('aria-expanded') === 'false';"#) as? Bool == true }
        guard try await js(#"""
        const f=document.getElementById('home-composer');
        if(!f)return false;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(f,'OFFLINE_LOCAL_RESPONSE');
        f.dispatchEvent(new Event('input',{bubbles:true}));return f.value==='OFFLINE_LOCAL_RESPONSE';
        """#) as? Bool == true else { throw OfflineProviderPolicy.Refusal.invalid }
    }

    private func saved() async throws -> [String: Any] {
        guard let config = try await js(#"""
        const id=location.hash.split('/')[2];
        const r=await fetch('/sessions/'+encodeURIComponent(id)+'/config');if(!r.ok)throw new Error('readback');
        const c=await r.json();
        if(c.backend!=='openai-responses'||c.model!=='gpt-5.6-sol'||c.base_url!==origin||c.allow_insecure_http!==true||!c.api_key_env||'api_key' in c)throw new Error('readback');
        return {api_key_env:c.api_key_env,backend:c.backend,model:c.model,base_url:c.base_url};
        """#, ["origin": fence.origin.absoluteString]) as? [String: Any] else { throw OfflineProviderPolicy.Refusal.invalid }
        return config
    }

    private func rustControls(_ phase: String, config: [String: Any]) async throws {
        func attempt(_ endpoint: URL) async throws {
            let accepted = fence.policy.responseAccepted
            guard let control = try await js(#"""
            const post=async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error('control');return r.json()};
            const current=await (await fetch('/sessions/'+location.hash.split('/')[2])).json();
            if(current.metadata.behavior!=='direct')throw new Error('control');
            const created=await post('/sessions',{project_id:current.metadata.project_id,behavior:'direct',backend:config.backend,model:config.model,
              base_url:endpoint,allow_insecure_http:true,api_key_env:config.api_key_env,orchestrator_compaction_threshold:0});
            const id=created.metadata.session_id;
            const run=await post('/sessions/'+id+'/runs',{prompt:'OFFLINE_TRANSPORT_CONTROL'});
            return {session:id,run:run.run_id};
            """#, ["config": config, "endpoint": endpoint.absoluteString]) as? [String: Any],
                  let sessionID = control["session"] as? String else { throw OfflineProviderPolicy.Refusal.invalid }
            try await wait {
                try await self.js(#"""
                const r=await fetch('/sessions/'+encodeURIComponent(id));if(!r.ok)return false;
                const s=await r.json();return s.active_run==null&&s.run_failure!=null;
                """#, ["id": sessionID]) as? Bool == true
            }
            guard fence.policy.responseAccepted == accepted else { throw OfflineProviderPolicy.Refusal.invalid }
        }
        try await fence.httpControl(phase + "-rust-provider-http", providerRequest: true, operation: attempt)
        let token = try fence.policy.canary()
        let target = fence.target(token: token, host: token + ".invalid", secure: true)
        let label = phase + "-rust-provider-https"
        try fence.policy.begin(label, authority: target.host! + ":443", request: .httpsConnect)
        var base = URLComponents(url: target, resolvingAgainstBaseURL: false)!
        base.path = ""
        try await attempt(base.url!)
        try fence.policy.finish(label, directToken: token)
    }

    func run() async throws -> [String: Any] {
        guard let current = app.engine.receipt, let view = app.webView,
              let binding = app.commands?.currentDocument(in: view), current.identity != nil else { throw OfflineProviderPolicy.Refusal.invalid }
        receipt = current; document = binding; pid = app.engine.pid
        try fence.requireStore(view)
        try await setup()
        let initialDocument = binding.document
        // Start session creates the selected direct session and
        // delivers its first prompt, so the streamed local response is
        // observed here and the outage controls follow once it has settled.
        let count = fence.policy.responseAccepted
        let providerCount = app.provider.responseCount
        try await wait { try await self.js("return !!document.querySelector('button[aria-label=\"Start session\"]:not(:disabled)')") as? Bool == true }
        _ = try await js("document.querySelector('button[aria-label=\"Start session\"]:not(:disabled)').click();return true")
        try await wait { try await self.js("return /^#\\/session\\/[^/]+/.test(location.hash)&&!!document.querySelector('[role=combobox][aria-label=Message]')") as? Bool == true }
        try await wait { try await self.js("return __previewEvidence.partial===true") as? Bool == true }
        try await wait { try await self.js("return document.body.innerText.includes('Hello from the isolated NAC Mac preview.')&&!document.querySelector('button[aria-label=\"Stop run\"]')") as? Bool == true }
        guard fence.policy.responseAccepted > count, fence.policy.responseAccepted - count == app.provider.responseCount - providerCount else { throw OfflineProviderPolicy.Refusal.missingObservation }
        let config = try await saved()
        try await rustControls("before", config: config)
        let previous = document!
        view.reload()
        let end = ProcessInfo.processInfo.systemUptime + 25
        while ProcessInfo.processInfo.systemUptime < end {
            if let next = app.commands?.currentDocument(in: view), next != previous {
                guard next.launch == previous.launch, next.view == previous.view else { throw OfflineProviderPolicy.Refusal.invalid }
                document = next; break
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        guard document != previous else { throw OfflineProviderPolicy.Refusal.missingObservation }
        try await wait { try await self.js(#"""
        if(!document.body.innerText.includes('Hello from the isolated NAC Mac preview.'))return false;
        const r=await fetch('/sessions/'+location.hash.split('/')[2]);if(!r.ok)return false;
        const s=await r.json();return s.active_run==null&&s.sessions.some(summary=>summary.session_id===s.metadata.session_id&&summary.total_tokens>=16)&&s.messages.some(m=>m.role==='assistant'&&JSON.stringify(m.content).includes('Hello from the isolated NAC Mac preview.'));
        """#) as? Bool == true }
        let reloaded = try await saved()
        guard NSDictionary(dictionary: config).isEqual(to: reloaded) else { throw OfflineProviderPolicy.Refusal.invalid }
        try await rustControls("after", config: config)
        try await fence.controls("after")
        _ = try owned()
        let navigation = app.commands?.smokeExternalNavigation ?? [:]
        guard let actions = navigation["actions"] as? [[String: Any]], actions.isEmpty else { throw OfflineProviderPolicy.Refusal.invalid }
        guard let profile = app.profile else { throw OfflineProviderPolicy.Refusal.invalid }
        for name in ["auth.json", "arcee_auth.json"] {
            guard !FileManager.default.fileExists(atPath: profile.root.appendingPathComponent("nac-home/" + name).path) else { throw OfflineProviderPolicy.Refusal.invalid }
        }
        return ["scope": "ordinary-production-engine-local-API-key; API-seeded endpoint, UI-selected model; HTTP(S)-outage-only",
                "offline_supported_local_provider": true, "whole_machine_offline": false,
                "physical_input_qualified": false, "real_vendor_qualified": false,
                "setup_saved_read_back": true, "streamed_response": true, "persisted_transcript": true,
                "no_managed_login": true, "external_open_attempts": 0,
                "store_bound_through_reload": true,
                "binding": ["launch": document!.launch, "view": document!.view, "document": document!.document,
                            "initial_document": initialDocument, "engine_pid": pid], "network": fence.snapshot]
    }
}
#endif
