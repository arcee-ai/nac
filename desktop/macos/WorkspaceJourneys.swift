#if PREVIEW_SMOKE
import AppKit
import WebKit

@MainActor
extension WorkspaceSmoke {
    func directJourney() async {
        await check("orchestration-opt-in") {
            try await self.require("Direct-only policy or behavior choices changed", "return !(await (await fetch('/ui-config')).json()).orchestration_enabled && document.querySelectorAll('[role=radio]').length === 0;")
            return "NAC_ORCHESTRATION=0, no behavior radio group"
        }
        await check("direct") {
            try await self.createChat("direct")
            try await self.send("WK_RICH")
            try await self.waitJS("rich streamed answer", "return document.body.innerText.includes('WK_RICH_COMPLETE');")
            try await self.idle()
            return "Production Create chat/Send; immutable behavior read back from Rust"
        }
        await check("managed-disabled") {
            try await self.require("Managed host unexpectedly enabled", "return (await fetch('/managed/status')).status === 404 && ![...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Add repository');")
            try await self.button("Managed host")
            try await self.waitJS("unconfigured managed status", "return document.body.innerText.includes('Managed host status is unavailable.');")
            try await self.button("Close")
            return "Existing Managed host status entry is inert/unconfigured (404); no Add repository action"
        }
        await check("markdown-math") {
            try await self.waitJS("table, formula and highlighted code", "return !!document.querySelector('table') && !!document.querySelector('mjx-container') && !!document.querySelector('pre span[style]');")
            try await self.snapshot("rich-chat.png")
            return "Actual Markdown table, MathJax and highlighted TypeScript in production transcript"
        }
        await check("transcript") {
            _ = try await self.js("window.__wkReloading = true; return true;")
            self.app.webView.reload()
            try await self.waitJS("persisted rich transcript", "return !window.__wkReloading && document.body.innerText.includes('WK_RICH_COMPLETE');")
            try await self.require("Persisted response missing", "return (await (await fetch('/sessions/' + \(self.quote(self.sessionID)))).json()).messages.some(m => m.role === 'assistant' && JSON.stringify(m.content).includes('WK_RICH_COMPLETE'));")
            return "Reloaded production document and authoritative persisted assistant record"
        }
        await check("fonts-chunks") {
            try await self.waitJS("local formula fonts", "await document.fonts.ready; return performance.getEntriesByType('resource').some(e => /mathjax.*woff/i.test(e.name));")
            let value = try await self.js("await document.fonts.load('16px Inter'); return performance.getEntriesByType('resource').map(e => e.name);")
            self.record(["resources": value])
            try await self.require("Font/chunk delivery failed", "return document.fonts.check('16px Inter') && performance.getEntriesByType('resource').filter(e => e.name.includes('/assets/dist/assets/') && e.name.endsWith('.js')).length >= 3;")
            return "Inter, lazy JS and MathJax font loaded from embedded production assets"
        }
        await check("offline-assets") {
            try await self.require("Nonlocal resource or script error", "return performance.getEntriesByType('resource').every(e => new URL(e.name).origin === location.origin) && __previewEvidence.errors.length === 0;")
            return "All exercised document/font/chunk/formula requests are loopback; no host network setting changed"
        }
        await check("css-layout") {
            try await self.require("CSS feature or layout unavailable", "const e = document.querySelector('[data-nac-runtime]'); return CSS.supports('color','oklch(50% 0.1 100)') && CSS.supports('height','100dvh') && CSS.supports('selector(:has(*))') && e.getBoundingClientRect().width > 300 && document.documentElement.scrollWidth <= innerWidth + 1;")
            self.record(["computed_css": try await self.js("const e=document.querySelector('[data-nac-runtime]'); return {width:e.getBoundingClientRect().width, background:getComputedStyle(document.body).backgroundColor, nesting:CSS.supports('selector(&)')};")])
            return "Tailwind production layout, oklch, dynamic viewport units, :has and measured bounds"
        }
        await check("settings") {
            try await self.button("Session settings")
            try await self.waitJS("loaded settings form", "return !!document.querySelector('input[aria-label=\"Session title\"]');")
            try await self.fill("input[aria-label='Session title']", "WK settings saved")
            try await self.button("Save")
            try await self.waitJS("settings saved", "return !document.querySelector('[role=dialog]') && document.body.innerText.includes('WK settings saved');")
            try await self.button("Session settings")
            try await self.waitJS("settings readback", "return document.querySelector('input[aria-label=\"Session title\"]')?.value === 'WK settings saved';")
            try await self.button("Close")
            return "Production settings Save and reopened title readback"
        }
        await check("provider") {
            try await self.button("Configurations")
            try await self.waitJS("saved dummy provider", "return document.querySelector('input[aria-label=\"Configuration name\"]')?.value === 'Mac preview — deterministic local fixture';")
            try await self.fill("input[aria-label='Configuration name']", "WK local fixture configuration")
            try await self.button("Save")
            try await self.waitJS("provider configuration readback", "return (await (await fetch('/model-configs')).json()).configurations.some(c => c.name === 'WK local fixture configuration') && !document.body.innerText.includes('preview-dummy-only');")
            try await self.button("Close")
            return "Saved dummy local provider renamed through production configuration form; no vendor-auth claim"
        }
        await check("mcp") {
            try await self.button("MCP servers")
            try await self.button("Custom server")
            try await self.fill("input[placeholder='my_server']", "wk_disabled_fixture")
            try await self.button("Stdio")
            try await self.button("Legacy")
            try await self.fill("input[placeholder='npx']", "/bin/sh")
            try await self.button("Add argument")
            try await self.fill("input[aria-label='Argument 1']", self.app.profile!.root.appendingPathComponent("tmp/workspace-mcp.sh").path)
            // An intentionally disabled fixture never executes a process at session startup.
            _ = try await self.js("const e=[...document.querySelectorAll('[role=switch]')].find(e => e.getAttribute('aria-checked') === 'true'); if(e)e.click(); return true;")
            try await self.button("Test connection")
            try await self.waitJS("local MCP tool discovery", "return document.body.innerText.includes('1 tool found') && document.body.innerText.includes('wk_fixture_echo');")
            try await self.button("Save")
            try await self.waitJS("saved MCP configuration", "return (await (await fetch('/mcp_library/servers')).json()).servers.some(s => s.name === 'wk_disabled_fixture' && s.enabled === false);")
            try await self.button("Close")
            return "Production outgoing MCP test discovers one inert owned stdio tool, then saves disabled configuration; no OAuth/vendor-auth claim"
        }
        await check("overlays-focus") { try await self.overlayJourney() }
        await check("resize-zoom") { try await self.resizeJourney() }
        await check("synthetic-composition") {
            let count = self.app.provider.responseCount
            try await self.fill("[role=combobox][aria-label=Message]", "日本語 composition fixture")
            _ = try await self.js("const e=document.querySelector('[role=combobox][aria-label=Message]'); e.dispatchEvent(new CompositionEvent('compositionstart',{data:'に',bubbles:true})); e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,isComposing:true,bubbles:true})); e.dispatchEvent(new CompositionEvent('compositionend',{data:'日本語',bubbles:true})); return true;")
            try await self.require("Composition lost draft", "return document.querySelector('[role=combobox][aria-label=Message]').value === '日本語 composition fixture';")
            guard self.app.provider.responseCount == count else { throw PreviewError.message("Synthetic composing Enter submitted") }
            try await self.fill("[role=combobox][aria-label=Message]", "")
            return "Synthetic composition/Enter guard only; real CJK row remains unavailable"
        }
        await check("files") {
            try await self.navigate("files")
            if (try? await self.js("return !!document.querySelector('button[aria-label=\"Show panel\"]');")) as? Bool == true { try await self.button("Show panel") }
            try await self.button("All files")
            _ = try await self.js("const e=[...document.querySelectorAll('button')].find(e => e.textContent.includes('workspace.ts')); if(!e)throw Error('Missing fixture source file'); e.click(); return true;")
            try await self.waitJS("highlighted source file", "return document.body.innerText.includes('export const workspaceFileFixture = 351;');")
            try await self.snapshot("files.png")
            return "Production Files list opens actual isolated workspace.ts"
        }
        await check("git") {
            try await self.require("Git branch unavailable", "return [...document.querySelectorAll('button')].some(b => (b.getAttribute('aria-label') || b.textContent).includes('Branch: main'));")
            try await self.require("Git changed-file receipt missing", "const r=await fetch('/sessions/' + \(self.quote(self.sessionID)) + '/workspace/diff?path=workspace.ts&stage=all&context=3'); if(!r.ok)return false; return JSON.stringify(await r.json()).includes('workspaceFileFixture');")
            try await self.waitJS("rendered Git diff", "return document.body.innerText.includes('@@') && document.body.innerText.includes('export const workspaceFileFixture = 351;');")
            return "Actual Git branch, authoritative file diff and rendered hunk; no terminal input claim"
        }
        await check("approvals") {
            try await self.send("WK_APPROVAL")
            try await self.waitJS("real Rust approval request", "return [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Allow once') && document.body.innerText.includes('approval.txt');")
            try await self.snapshot("approval.png")
            try await self.button("Allow once")
            try await self.waitJS("approval settlement", "return document.body.innerText.includes('WK_APPROVAL_COMPLETE');")
            try await self.idle()
            return "Scripted provider requests read outside workspace; production Allow once, normal Rust authorization"
        }
        await check("goals") {
            try await self.send("/goal WK bounded goal fixture")
            try await self.waitJS("durable goal", "return (await (await fetch('/sessions/' + \(self.quote(self.sessionID)) + '/goal')).json())?.objective === 'WK bounded goal fixture';")
            // Goal attachment advances its revision. As in embedded.e2e.ts,
            // reload before versioned controls; background polling can pause
            // while this console is locked. Never replay an uncertain mutation.
            _ = try await self.js("window.__wkReloading = true; return true;")
            self.app.webView.reload()
            try await self.waitJS("fresh goal controls after attachment", "return !window.__wkReloading && !!document.querySelector('[aria-label=\"Edit goal: Active\"]');")
            try await self.button("Edit goal: Active")
            try await self.button("Pause goal")
            try await self.waitJS("paused durable goal", "return (await (await fetch('/sessions/' + \(self.quote(self.sessionID)) + '/goal')).json())?.status === 'paused';")
            try await self.button("Close goal editor")
            return "Literal production /goal creation and versioned Pause; scripted provider, no real vendor schema claim (ALL-422 supplier separate)"
        }
        await check("projects") {
            try await self.button("All projects")
            try await self.waitJS("project list", "return location.hash === '#/' && document.body.innerText.includes('Disposable Mac preview');")
            try await self.snapshot("projects.png")
            return "Actual production projects route and seeded local project"
        }
        checks["links"] = ["status": "unavailable", "detail": "Markdown renders internal/source and safe external anchors; actual external native handoff not qualified by this preview. ALL-346/348 integration remains separate."]
    }

    func overlayJourney() async throws -> String {
        try await button("Configurations")
        _ = try await js("window.__wkModalOpener=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Configurations' && b.getClientRects().length);return true;")
        try await waitJS("instance inert background", "return !!document.querySelector('[data-nac-runtime] [inert]') && !!document.querySelector('[role=dialog]');")
        try await require("Dialog overflows viewport", "const r=document.querySelector('[role=dialog]').getBoundingClientRect();return r.left>=-1 && r.right<=innerWidth+1;")
        _ = try await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;")
        try await waitJS("Escape closes layer", "return !document.querySelector('[role=dialog]');")
        try await waitJS("modal focus return", "return document.activeElement === window.__wkModalOpener;")
        _ = try await js("window.__wkPopoverOpener=document.querySelector('button[aria-label=Model]');return true;")
        try await button("Model")
        try await waitJS("production model popover", "return !!document.querySelector('input[placeholder=\"Search models…\"]') && document.querySelector('button[aria-label=Model]').getAttribute('aria-expanded') === 'true';")
        try await require("Popover overflows viewport", "const input=document.querySelector('input[placeholder=\"Search models…\"]');const panel=input.closest('[data-radix-popper-content-wrapper]');if(!panel)return false;const r=panel.getBoundingClientRect();return r.left>=-1 && r.right<=innerWidth+1;")
        _ = try await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;")
        try await waitJS("popover dismissed and focus restored", "return !document.querySelector('input[placeholder=\"Search models…\"]') && document.activeElement === window.__wkPopoverOpener && window.__wkPopoverOpener.getAttribute('aria-expanded') === 'false';")
        return "Production modal + model-popover bounds, inertness, synthetic Escape and focus return; real keyboard/VoiceOver remain separate"
    }

    func resizeJourney() async throws -> String {
        let original = app.window.frame
        defer { app.webView.pageZoom = 1; app.window.setFrame(original, display: true) }
        for size in [(900.0, 650.0), (640.0, 600.0), (1280.0, 800.0)] {
            app.window.setContentSize(NSSize(width: size.0, height: size.1))
            for zoom in [1.0, 1.25, 1.5] {
                app.webView.pageZoom = zoom
                try await waitJS("resized production layout", "return document.documentElement.scrollWidth <= innerWidth+1 && document.querySelector('[role=combobox][aria-label=Message]').getBoundingClientRect().width > 40;")
                try await snapshot("resize-\(Int(size.0))-zoom-\(Int(zoom * 100)).png")
            }
        }
        return "Native window sizes 900/640/1280; WKWebView pageZoom 100/125/150%; snapshots and document bounds"
    }
}
#endif
