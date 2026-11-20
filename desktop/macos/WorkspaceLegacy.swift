#if PREVIEW_SMOKE
import AppKit
import WebKit

@MainActor
extension WorkspaceSmoke {
    func legacyJourney() async {
        await check("legacy") {
            // Home's composer carries the behavior chip; its menu lists the choices.
            try await self.waitJS("Home composer", Self.homeComposerScript)
            try await self.require("Orchestration is not explicitly enabled", "return (await (await fetch('/ui-config')).json()).orchestration_enabled && !!document.querySelector('button[aria-label^=\"Behavior: \"]');")
            try await self.require("Legacy creation default changed", "return document.querySelector('button[aria-label^=\"Behavior: \"]').getAttribute('aria-label') === 'Behavior: Orchestrator';")
            _ = try await self.js("document.querySelector('button[aria-label^=\"Behavior: \"]').click(); return true;")
            let choices = "[...document.querySelectorAll('[role=menu][aria-label=\"Session behavior\"] [role=menuitemradio]')]"
            try await self.waitJS("three behavior choices", "return \(choices).length === 3;")
            try await self.require("Legacy creation default changed", "return \(choices).map(r => r.querySelector('.type-label')?.textContent.trim()).join('|') === 'Agent|Agent + Orchestrator|Orchestrator' && \(choices).some(r => r.querySelector('.type-label')?.textContent.trim() === 'Orchestrator' && r.getAttribute('aria-checked') === 'true');")
            // Keep the default: choosing it again only closes the menu.
            _ = try await self.js("\(choices).find(r => r.querySelector('.type-label')?.textContent.trim() === 'Orchestrator').click(); return true;")
            try await self.createChat("orchestrator", prompt: "WK_LEGACY")
            try await self.waitJS("legacy response", "return document.body.innerText.includes('Hello from the isolated NAC Mac preview.');")
            try await self.idle()
            try await self.snapshot("legacy.png", expecting: .transcript(id: self.sessionID, message: FixtureProvider.answer))
            return "Explicit NAC_ORCHESTRATION=1; three behavior choices, Orchestrator default, production Home start (first prompt) and persisted behavior"
        }
        await check("hybrid") {
            // The sidebar's New session opens Home's composer for this project.
            let previous = self.sessionID
            try await self.button("New session")
            try await self.waitJS("Home composer for the session's project", "return location.hash.startsWith('#/?project=') && document.activeElement?.id === 'home-composer';")
            try await self.createChat("direct-with-orchestrator", prompt: "WK_HYBRID")
            try await self.require("Hybrid session is new", "return location.hash.split('/')[2] !== \(self.quote(previous));")
            try await self.waitJS("hybrid response", "return document.body.innerText.includes('Hello from the isolated NAC Mac preview.');")
            try await self.idle()
            try await self.snapshot("hybrid.png", expecting: .transcript(id: self.sessionID, message: FixtureProvider.answer))
            return "Production sidebar New session/Home composer creates and runs direct-with-orchestrator; immutable behavior readback"
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
            guard let receipts = result as? [String: Any],
                  let child = receipts["child"] as? [String: Any], let childID = child["child_session_id"] as? String,
                  let managed = receipts["managed"] as? [String: Any], let managedID = managed["orchestrator_session_id"] as? String else {
                throw PreviewError.message("Delegation fixture returned no exact target identities")
            }
            try await self.navigate("delegated")
            _ = try await self.js("window.__wkReloading = true; return true;")
            self.app.webView.reload()
            try await self.waitJS("fresh delegated projection after fixture setup", "return !window.__wkReloading && !!document.querySelector('[role=combobox][aria-label=Message]');")
            // The docked Subagents tab sits beside the transcripts at 1280px.
            try await self.drawerPanel("Subagents")
            for (title, targetID, prompt) in [("WK traditional child", childID, "WK_CHILD"), ("WK managed orchestrator", managedID, "WK_MANAGED")] {
                try await self.button(title)
                try await self.button("Open")
                try await self.waitJS("read-only delegated transcript", "return !document.querySelector('[role=combobox][aria-label=Message]') && !!document.querySelector('button[aria-label$=\", parent chat\"]');")
                // No composer (+ menu, goal) and, in the Session menu, no branch
                // picker or Fork/Rename/Delete actions for a delegated transcript.
                try await self.require("Delegated transcript exposes mutation controls", "return !document.querySelector('button[aria-label=\"Add to message\"]') && !document.querySelector('[aria-label^=\"Edit goal\"],[aria-label=\"Set durable goal\"]');")
                _ = try await self.js("document.querySelector('button[aria-label=\"Session menu\"]').click(); return true;")
                try await self.waitJS("delegated Session menu", "return !!document.querySelector('[role=dialog][aria-label=\"Session\"]');")
                try await self.require("Delegated transcript exposes mutation controls", "const m=document.querySelector('[role=dialog][aria-label=\"Session\"]'); return ![...m.querySelectorAll('button')].some(b => (b.getAttribute('aria-label') || '').startsWith('Branch:') || ['Fork from latest reply','Rename','Delete'].includes(b.textContent.trim()));")
                _ = try await self.js("document.querySelector('button[aria-label=\"Session menu\"]').click(); return true;")
                try await self.waitJS("delegated Session menu closed", "return !document.querySelector('[role=dialog][aria-label=\"Session\"]');")
                try await self.snapshot(title == "WK traditional child" ? "traditional-transcript.png" : "managed-transcript.png",
                    expecting: .transcript(id: targetID, message: FixtureProvider.answer, readOnly: true, identityText: prompt))
                _ = try await self.js("document.querySelector('button[aria-label$=\", parent chat\"]').click();return true;")
                try await self.waitJS("parent composer", "return !!document.querySelector('[role=combobox][aria-label=Message]');")
            }
            return "Two distinct durable topologies seeded through production HTTP; actual Subagents drawer/Open/parent-chat navigation and read-only transcript controls"
        }
    }
}
#endif
