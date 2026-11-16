#if PREVIEW_SMOKE && !LOCAL_APP
import AppKit
import WebKit

/// DOM-driven production setup and Responses requests; never a second client.
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

    private func click(_ title: String) async throws {
        try await wait { try await self.js(Self.visible + #"""
        const buttons=[...document.querySelectorAll('button')].filter(b=>visible(b)&&!b.disabled&&b.textContent.trim()===title);
        if(buttons.length!==1)return false; buttons[0].click(); return true;
        """#, ["title": title]) as? Bool == true }
    }

    private func input(_ label: String, _ value: String) async throws {
        guard try await js(Self.visible + #"""
        const fields=[...document.querySelectorAll('input')].filter(e=>visible(e)&&e.getAttribute('aria-label')===label);
        if(fields.length!==1)return false;
        const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
        setter.call(fields[0],value); fields[0].dispatchEvent(new Event('input',{bubbles:true}));return true;
        """#, ["label": label, "value": value]) as? Bool == true else { throw OfflineProviderPolicy.Refusal.invalid }
    }

    private func select(_ label: String, _ title: String) async throws {
        guard try await js(Self.visible + #"""
        const rows=[...document.querySelectorAll('[role=group][aria-labelledby]')].filter(e=>{
          const l=document.getElementById(e.getAttribute('aria-labelledby'));
          return visible(e)&&l&&l.textContent.trim().replace(/\*$/,'')===label;
        });
        if(rows.length!==1)return false;
        const buttons=[...rows[0].querySelectorAll('button')].filter(visible);
        if(buttons.length!==1)return false;buttons[0].click();return true;
        """#, ["label": label]) as? Bool == true else { throw OfflineProviderPolicy.Refusal.invalid }
        try await click(title)
    }

    private func setup() async throws {
        guard try await js(#"""
        const r=await fetch('/model-configs');if(!r.ok)return false;
        return (await r.json()).configurations.length===0;
        """#) as? Bool == true else { throw OfflineProviderPolicy.Refusal.invalid }
        // The project was seeded without a model/key. This is the actual form.
        try await click("Advanced presets and provider setup")
        try await click("Browse Models")
        try await click("Create New")
        try await select("Model Provider", "Custom")
        try await select("Protocol", "OpenAI Responses")
        try await input("Name", OfflineProviderPolicy.setupName)
        try await input("API Key", OfflineProviderPolicy.key)
        try await input("Model", "gpt-5.6-sol")
        try await input("Base URL", fence.origin.absoluteString)
        // Verify the explicit choice; the fresh Custom form defaults to Arcee.
        guard try await js(Self.visible + #"""
        const rows=[...document.querySelectorAll('[role=group][aria-labelledby]')];
        return rows.some(e=>visible(e)&&document.getElementById(e.getAttribute('aria-labelledby'))?.textContent.trim().replace(/\*$/,'')==='Protocol'&&e.textContent.includes('Responses'));
        """#) as? Bool == true else { throw OfflineProviderPolicy.Refusal.invalid }
        try await click("Create chat")
        try await wait { try await self.js("return /^#\\/session\\/[^/]+/.test(location.hash)&&!!document.querySelector('[role=combobox][aria-label=Message]')") as? Bool == true }
    }

    private func saved() async throws -> [String: Any] {
        guard let config = try await js(#"""
        const r=await fetch('/model-configs');if(!r.ok)throw new Error('readback');
        const rows=(await r.json()).configurations.filter(x=>x.name===name);
        if(rows.length!==1)throw new Error('readback');
        const c=rows[0];
        if(c.backend!=='openai-responses'||c.model!=='gpt-5.6-sol'||c.base_url!==origin||!c.api_key_env||'api_key' in c)throw new Error('readback');
        return {config_id:c.config_id,api_key_env:c.api_key_env,backend:c.backend,model:c.model,base_url:c.base_url};
        """#, ["name": OfflineProviderPolicy.setupName, "origin": fence.origin.absoluteString]) as? [String: Any] else { throw OfflineProviderPolicy.Refusal.invalid }
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
              base_url:endpoint,allow_insecure_http:true,api_key_env:config.api_key_env,light_model:null,orchestrator_compaction_threshold:0});
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
        let config = try await saved()
        try await rustControls("before", config: config)
        let count = fence.policy.responseAccepted
        let providerCount = app.provider.responseCount
        _ = try await js(#"""
        const e=document.querySelector('[role=combobox][aria-label=Message]');
        if(!e)throw new Error('composer');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'OFFLINE_LOCAL_RESPONSE');
        e.dispatchEvent(new Event('input',{bubbles:true}));return true;
        """#)
        try await wait { try await self.js("return !!document.querySelector('button[aria-label=Send]:not(:disabled)')") as? Bool == true }
        _ = try await js("document.querySelector('button[aria-label=Send]:not(:disabled)').click();return true")
        try await wait { try await self.js("return __previewEvidence.partial===true") as? Bool == true }
        try await wait { try await self.js("return document.body.innerText.includes('Hello from the isolated NAC Mac preview.')&&!document.querySelector('button[aria-label=\"Stop run\"]')") as? Bool == true }
        guard fence.policy.responseAccepted > count, fence.policy.responseAccepted - count == app.provider.responseCount - providerCount else { throw OfflineProviderPolicy.Refusal.missingObservation }
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
        return ["scope": "ordinary-production-engine-local-API-key; DOM-driven; HTTP(S)-outage-only",
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
