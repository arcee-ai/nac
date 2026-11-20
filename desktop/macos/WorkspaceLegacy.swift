#if PREVIEW_SMOKE
import AppKit
import WebKit

@MainActor
extension WorkspaceSmoke {
    func legacyJourney() async {
        await check("retired-controls") {
            try await self.waitJS("Home composer", Self.homeComposerScript)
            try await self.require("Retired controls remain available", "return (await fetch('/ui-config')).status === 404 && !document.querySelector('button[aria-label^=\"Behavior: \"]');")
            try await self.createChat("direct", prompt: "WK_LEGACY")
            try await self.waitJS("direct response", "return document.body.innerText.includes('Hello from the isolated NAC Mac preview.');")
            try await self.idle()
            try await self.snapshot("legacy.png", expecting: .transcript(id: self.sessionID, message: FixtureProvider.answer))
            return "Retired controls are absent; the created session is direct"
        }
        await check("new-session") {
            let previous = self.sessionID
            try await self.button("New session")
            try await self.waitJS("Home composer for the session's project", "return location.hash.startsWith('#/?project=') && document.activeElement?.id === 'home-composer';")
            try await self.createChat("direct", prompt: "WK_HYBRID")
            try await self.require("New session was not created", "return location.hash.split('/')[2] !== \(self.quote(previous));")
            try await self.waitJS("direct response", "return document.body.innerText.includes('Hello from the isolated NAC Mac preview.');")
            try await self.idle()
            try await self.snapshot("hybrid.png", expecting: .transcript(id: self.sessionID, message: FixtureProvider.answer))
            return "Sidebar New session creates a separate direct session"
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
            return {child};
            """)
            self.record(["delegation_fixture_receipts": result])
            guard let receipts = result as? [String: Any],
                  let child = receipts["child"] as? [String: Any], let childID = child["child_session_id"] as? String else {
                throw PreviewError.message("Delegation fixture returned no exact target identities")
            }
            try await self.navigate("delegated")
            _ = try await self.js("window.__wkReloading = true; return true;")
            self.app.webView.reload()
            try await self.waitJS("fresh delegated projection after fixture setup", "return !window.__wkReloading && !!document.querySelector('[role=combobox][aria-label=Message]');")
            // Panels open in the session drawer (the Session menu, then its
            // Subagents tab); docked (1280px) it sits beside the transcripts.
            try await self.drawerPanel("Subagents")
            if (try? await self.js("return !!document.querySelector('button[aria-label=\"Dock drawer\"]');")) as? Bool == true { try await self.button("Dock drawer") }
            for (title, targetID, prompt) in [("WK traditional child", childID, "WK_CHILD")] {
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
                try await self.snapshot("traditional-transcript.png",
                    expecting: .transcript(id: targetID, message: FixtureProvider.answer, readOnly: true, identityText: prompt))
                _ = try await self.js("document.querySelector('button[aria-label$=\", parent chat\"]').click();return true;")
                try await self.waitJS("parent composer", "return !!document.querySelector('[role=combobox][aria-label=Message]');")
            }
            return "Traditional child seeded through production HTTP; Subagents drawer, parent navigation and read-only transcript controls"
        }
    }
}
#endif
