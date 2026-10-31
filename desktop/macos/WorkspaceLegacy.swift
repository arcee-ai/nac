#if PREVIEW_SMOKE
import AppKit
import WebKit

@MainActor
extension WorkspaceSmoke {
    func legacyJourney() async {
        await check("legacy") {
            try await self.require("Orchestration is not explicitly enabled", "return (await (await fetch('/ui-config')).json()).orchestration_enabled && document.querySelectorAll('[role=radio]').length === 3;")
            try await self.require("Legacy creation default changed", "return [...document.querySelectorAll('[role=radio]')].some(r => r.textContent.includes('NAC orchestrator') && r.getAttribute('aria-checked') === 'true');")
            try await self.createChat("orchestrator")
            try await self.send("WK_LEGACY")
            try await self.waitJS("legacy response", "return document.body.innerText.includes('Hello from the isolated NAC Mac preview.');")
            try await self.idle()
            try await self.snapshot("legacy.png")
            return "Explicit NAC_ORCHESTRATION=1; three choices, legacy default, production creation/send and persisted behavior"
        }
        await check("hybrid") {
            _ = try await self.js("const b=[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent.trim()).toLowerCase() === 'new session' && b.getClientRects().length); if(!b)throw Error('Missing New Session'); b.click();return true;")
            try await self.button("Agent + Orchestrator Session")
            try await self.waitJS("hybrid session", "return location.hash.split('/')[2] !== \(self.quote(self.sessionID)) && !!document.querySelector('[role=combobox][aria-label=Message]');")
            self.sessionID = try await self.js("return location.hash.split('/')[2];") as! String
            try await self.require("Hybrid immutable behavior differs", "return (await (await fetch('/sessions/' + \(self.quote(self.sessionID)))).json()).metadata.behavior === 'direct-with-orchestrator';")
            try await self.send("WK_HYBRID")
            try await self.waitJS("hybrid response", "return document.body.innerText.includes('Hello from the isolated NAC Mac preview.');")
            try await self.idle()
            try await self.snapshot("hybrid.png")
            return "Production New Session popover creates and runs direct-with-orchestrator; immutable behavior readback"
        }
        await check("delegation") {
            // Explicit simulated fixture setup via existing production endpoints.
            // It never manufactures a trusted event or a privileged bridge.
            let result = try await self.js("""
            const base='/sessions/' + \(self.quote(self.sessionID));
            const post=async (suffix, body) => {
              const r=await fetch(base+suffix,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
              if(!r.ok)throw Error(suffix + ': ' + r.status + ' ' + await r.text());
              return r.json();
            };
            const child=await post('/children',{profile:'general',description:'WK traditional child',prompt:'WK_CHILD',background:false});
            const managed=await post('/orchestrators',{description:'WK managed orchestrator',prompt:'WK_MANAGED',background:true});
            return {child,managed};
            """)
            self.record(["delegation_fixture_receipts": result])
            try await self.navigate("delegated")
            _ = try await self.js("window.__wkReloading = true; return true;")
            self.app.webView.reload()
            try await self.waitJS("fresh delegated projection after fixture setup", "return !window.__wkReloading && !!document.querySelector('[role=combobox][aria-label=Message]');")
            if (try? await self.js("return !!document.querySelector('button[aria-label=\"Show panel\"]');")) as? Bool == true { try await self.button("Show panel") }
            for title in ["WK traditional child", "WK managed orchestrator"] {
                try await self.button(title)
                try await self.button("Open")
                try await self.waitJS("read-only delegated transcript", "return !document.querySelector('[role=combobox][aria-label=Message]') && !!document.querySelector('button[aria-label$=\", parent chat\"]');")
                try await self.require("Delegated transcript exposes mutation controls", "return !document.querySelector('[aria-label=\"Set durable goal\"]') && ![...document.querySelectorAll('button')].some(b => (b.getAttribute('aria-label') || '').startsWith('Branch:'));")
                try await self.snapshot(title == "WK traditional child" ? "traditional-transcript.png" : "managed-transcript.png")
                _ = try await self.js("document.querySelector('button[aria-label$=\", parent chat\"]').click();return true;")
                try await self.waitJS("parent composer", "return !!document.querySelector('[role=combobox][aria-label=Message]');")
            }
            return "Two distinct durable topologies seeded through production HTTP; actual Subagents/Open/Parent navigation and read-only transcript controls"
        }
    }
}
#endif
