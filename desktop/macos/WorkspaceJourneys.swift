#if PREVIEW_SMOKE
import AppKit
import WebKit

@MainActor
extension WorkspaceSmoke {
    // Resolve the owned form's Enabled switch, never another checked switch.
    // The exact probe is exercised by test_workspace_mcp.mjs.
    static let disabledMcpFixtureScript = #"""
    const visible = e => {
      if (!e || e.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
      for (let n=e; n; n=n.parentElement) {
        const s=getComputedStyle(n);
        if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) < 0.99) return false;
      }
      const r=e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    // Settings › MCP servers renders the manager into a SettingsSurface
    // section (data-settings-surface) inside the page region of the same name.
    const dialogs=[...document.querySelectorAll('section[aria-label="MCP servers"][data-settings-surface="true"]')].filter(visible);
    if (dialogs.length !== 1) throw Error('Expected one visible owned MCP settings surface');
    const names=[...dialogs[0].querySelectorAll('input[placeholder="my_server"]')].filter(visible);
    if (names.length !== 1 || names[0].value !== 'wk_disabled_fixture') throw Error('Expected the owned MCP fixture form');
    // Input/InputWrapper add nested divs. The unique owned active surface
    // already scopes this form; do not infer its row from a fixed depth.
    const labels=[...dialogs[0].querySelectorAll('.label-small')].filter(e => e.textContent.trim() === 'Enabled' && visible(e));
    const controls=[...dialogs[0].querySelectorAll('[role="switch"][aria-label="Enabled"]')].filter(visible);
    const control=labels.length === 1 && controls.length === 1 ? controls[0] : null;
    if (!control || control.getAttribute('role') !== 'switch' || !visible(control) ||
        control.matches(':disabled,[aria-disabled="true"]')) throw Error('Expected one actionable owned Enabled switch');
    const checked=control.getAttribute('aria-checked');
    if (checked !== 'true' && checked !== 'false') throw Error('Missing owned Enabled state');
    if (disable && checked === 'true') control.click();
    return control.getAttribute('aria-checked') === 'false';
    """#

    func directJourney() async {
        await check("direct-only-policy") {
            try await self.require("Direct-only policy or behavior choices changed", "return (await fetch('/ui-config')).status === 404 && !!document.getElementById('home-composer') && !document.querySelector('button[aria-label^=\"Behavior: \"]');")
            return "Retired policy endpoint returns 404 and Home's direct composer is visible"
        }
        await check("direct") {
            try await self.createChat("direct", prompt: "WK_RICH")
            try await self.waitJS("rich streamed answer", "return document.body.innerText.includes('WK_RICH_COMPLETE');")
            try await self.idle()
            return "Production Home composer/Start session (first prompt WK_RICH); immutable behavior read back from Rust"
        }
        await check("managed-disabled") {
            try await self.require("Managed host unexpectedly enabled", "return (await fetch('/managed/status')).status === 404 && ![...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Add repository');")
            // Managed host is a Settings section listed only on a managed host;
            // a direct link to it falls back to General while unconfigured.
            try await self.button("Settings")
            try await self.waitJS("Settings sections without Managed host", "const nav=document.querySelector('nav[aria-label=\"Settings sections\"]'); const names=[...(nav?.querySelectorAll('a') || [])].map(a => a.textContent.trim()); return location.hash.startsWith('#/settings/') && names.includes('Accounts & keys') && !names.includes('Managed host');")
            _ = try await self.js("location.hash = '#/settings/managed'; return true;")
            try await self.waitJS("unconfigured Managed host route falls back", "return location.hash === '#/settings/general' && !document.querySelector('main[aria-label=\"Managed host\"]');")
            try await self.button("Back")
            try await self.waitJS("session after Settings", "return location.hash.startsWith('#/session/' + \(self.quote(self.sessionID)) + '/') && !!document.querySelector('[role=combobox][aria-label=Message]');")
            return "Managed host Settings section is absent and its route inert while unconfigured (404); no Add repository action"
        }
        await check("markdown-math") {
            try await self.waitJS("table, formula and highlighted code", "return !!document.querySelector('table') && !!document.querySelector('mjx-container') && !!document.querySelector('pre span[style]');")
            try await self.snapshot("rich-chat.png", expecting: .rich(id: self.sessionID, markdown: WorkspaceFixture.rich))
            return "Actual Markdown table, MathJax and highlighted TypeScript in production transcript"
        }
        await check("transcript") {
            try await self.recordAssetDocument("before-reload")
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
            try await self.recordAssetDocument("after-reload")
            guard self.assetDocumentsPass("fonts_chunks_ok") else {
                throw PreviewError.message("Font/chunk delivery missing or failed in an observed document")
            }
            return "Inter, lazy JS and MathJax font loaded from embedded production assets"
        }
        await check("offline-assets") {
            try await self.recordAssetDocument("after-reload")
            guard self.assetDocumentsPass("offline_ok") else {
                throw PreviewError.message("Nonlocal resource, script error or missing document asset observation")
            }
            return "All exercised document/font/chunk/formula requests are loopback; no host network setting changed"
        }
        await check("css-layout") {
            try await self.require("CSS feature or layout unavailable", "const e = document.querySelector('[data-nac-runtime]'); return CSS.supports('color','oklch(50% 0.1 100)') && CSS.supports('height','100dvh') && CSS.supports('selector(:has(*))') && e.getBoundingClientRect().width > 300 && document.documentElement.scrollWidth <= innerWidth + 1;")
            self.record(["computed_css": try await self.js("const e=document.querySelector('[data-nac-runtime]'); return {width:e.getBoundingClientRect().width, background:getComputedStyle(document.body).backgroundColor, nesting:CSS.supports('selector(&)')};")])
            return "Tailwind production layout, oklch, dynamic viewport units, :has and measured bounds"
        }
        await check("settings") {
            try await self.sessionAction("Rename")
            try await self.waitJS("loaded rename form", "return !!document.querySelector('[role=dialog][aria-label=\"Rename session\"] input');")
            try await self.fill("[role=dialog][aria-label='Rename session'] input:not([type=checkbox])", "WK settings saved")
            try await self.button("Save")
            try await self.waitJS("title saved", "return !document.querySelector('[role=dialog]') && document.body.innerText.includes('WK settings saved');")
            try await self.sessionAction("Rename")
            try await self.waitJS("title readback", "return document.querySelector('[role=dialog][aria-label=\"Rename session\"] input').value === 'WK settings saved';")
            try await self.button("Cancel")
            return "Shared Rename saves and reopens the persisted session title"
        }
        await check("provider") {
            try await self.settingsSection("Accounts & keys")
            try await self.waitJS("provider account controls", "const page=document.querySelector('main[aria-label=\"Accounts & keys\"]'); return !!page && page.innerText.includes('Subscriptions') && page.innerText.includes('API keys') && !page.innerText.includes('preview-dummy-only');")
            try await self.leaveSettings()
            return "Shared Accounts & keys exposes subscription and key controls without displaying the fixture secret"
        }
        await check("mcp") {
            try await self.settingsSection("MCP servers")
            try await self.button("Custom server")
            try await self.fill("input[placeholder='my_server']", "wk_disabled_fixture")
            try await self.button("Stdio")
            try await self.button("Legacy")
            try await self.fill("input[placeholder='npx']", "/bin/sh")
            try await self.button("Add argument")
            try await self.fill("input[aria-label='Argument 1']", self.app.profile!.root.appendingPathComponent("tmp/workspace-mcp.sh").path)
            // An intentionally disabled fixture never executes a process at session startup.
            try await self.waitJS("owned MCP fixture ready and disabled", "const disable=true;" + Self.disabledMcpFixtureScript)
            try await self.waitJS("owned MCP fixture disabled before test/save", "const disable=false;" + Self.disabledMcpFixtureScript)
            try await self.button("Test connection")
            try await self.waitJS("local MCP tool discovery", "return document.body.innerText.includes('1 tool found') && document.body.innerText.includes('wk_fixture_echo');")
            try await self.button("Save")
            try await self.waitJS("saved MCP configuration", "return (await (await fetch('/mcp_library/servers')).json()).servers.some(s => s.name === 'wk_disabled_fixture' && s.enabled === false);")
            try await self.leaveSettings()
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
            // The session panel button opens the drawer, then its Files tab.
            // The docked layout (1280px) lays it beside the
            // chat as the old side column was, outside any dialog layer.
            try await self.drawerPanel("Files")
            try await self.waitJS("docked Files panel", "return !!document.querySelector('aside[aria-label=\"Files\"] [role=tab][aria-label=\"Files\"][aria-selected=\"true\"]') && ![...document.querySelectorAll('[role=dialog]')].some(d => d.querySelector('[role=tablist][aria-label=\"Session panels\"]'));")
            try await self.button("All files")
            let fileRow = """
            if (location.hash !== '#/session/' + \(self.quote(self.sessionID)) + '/files') return [];
            const lists = [...document.querySelectorAll('[role="separator"][aria-label="Resize list panel"]')]
              .map(e => e.parentElement).filter(e => e &&
                e.querySelector('button[aria-label="All files"][aria-pressed="true"]'));
            if (lists.length !== 1) return [];
            return [...lists[0].querySelectorAll('button[title="workspace.ts"]')].filter(e => {
              const rect = e.getBoundingClientRect();
              if (e.disabled || e.closest('[inert]') || !e.getClientRects().length ||
                  rect.width <= 0 || rect.height <= 0) return false;
              for (let node = e; node; node = node.parentElement) {
                const style = getComputedStyle(node);
                if (node.hidden || style.display === 'none' || style.visibility !== 'visible' ||
                    Number(style.opacity) === 0) return false;
              }
              return true;
            });
            """
            try await self.waitJS("owned Files workspace.ts row", "const rows=(() => { \(fileRow) })(); return rows.length === 1;")
            _ = try await self.js("const rows=(() => { \(fileRow) })(); if(rows.length !== 1)throw Error('Missing or ambiguous owned fixture source file'); rows[0].click(); return true;")
            try await self.waitJS("highlighted source file", "return document.body.innerText.includes('export const workspaceFileFixture = 351;');")
            try await self.snapshot("files.png", expecting: .file(id: self.sessionID, path: "workspace.ts",
                content: "export const workspaceFileFixture = 351;\n"))
            return "Production drawer Files list opens actual isolated workspace.ts"
        }
        await check("git") {
            // The branch picker is a Details row of the header's Session menu:
            // open it just long enough to read that row, then shut it again.
            let branch = """
            const trigger = document.querySelector('button[aria-label="Session menu"]');
            if (!trigger) return false;
            const menu = () => document.querySelector('[role=dialog][aria-label="Session"]');
            const opened = !menu();
            if (opened) trigger.click();
            let found = false;
            for (let i = 0; i < 40 && !found; i++) {
              await new Promise(resolve => setTimeout(resolve, 50));
              found = [...(menu()?.querySelectorAll('button') || [])].some(b => (b.getAttribute('aria-label') || '').includes('Branch: main'));
            }
            if (opened && menu()) trigger.click();
            return found;
            """
            try await self.require("Git branch unavailable", branch)
            try await self.require("Git changed-file receipt missing", "const r=await fetch('/sessions/' + \(self.quote(self.sessionID)) + '/workspace/diff?path=workspace.ts&stage=all&context=3'); if(!r.ok)return false; return JSON.stringify(await r.json()).includes('workspaceFileFixture');")
            try await self.navigate("files")
            try await self.drawerPanel("Files")
            try await self.button("Diff of changed files")
            let gitRow = """
            if (location.hash !== '#/session/' + \(self.quote(self.sessionID)) + '/files') return [];
            const lists = [...document.querySelectorAll('[role="separator"][aria-label="Resize list panel"]')]
              .map(e => e.parentElement).filter(e => e &&
                e.querySelector('button[aria-label="Diff of changed files"][aria-pressed="true"]'));
            if (lists.length !== 1) return [];
            return [...lists[0].querySelectorAll('button[title="workspace.ts"]')].filter(e => {
              const rect = e.getBoundingClientRect();
              if (e.disabled || e.closest('[inert]') || !e.getClientRects().length ||
                  rect.width <= 0 || rect.height <= 0) return false;
              for (let node = e; node; node = node.parentElement) {
                const style = getComputedStyle(node);
                if (node.hidden || style.display === 'none' || style.visibility !== 'visible' ||
                    Number(style.opacity) === 0) return false;
              }
              return true;
            });
            """
            try await self.waitJS("owned Git workspace.ts row", "const rows=(() => { \(gitRow) })(); return rows.length === 1;")
            _ = try await self.js("const rows=(() => { \(gitRow) })(); if(rows.length !== 1)throw Error('Missing or ambiguous owned fixture source file'); rows[0].click(); return true;")
            let gitDiff = """
            if (location.hash !== '#/session/' + \(self.quote(self.sessionID)) + '/files') return false;
            const panes = [...document.querySelectorAll('span[title="workspace.ts"]')].filter(title => {
              if (title.closest('button,[inert],[role=dialog]')) return false;
              const header = title.parentElement, scroller = header?.nextElementSibling;
              if (!header?.classList.contains('type-strong') || !scroller?.classList.contains('overflow-auto')) return false;
              const panel = scroller.parentElement?.parentElement;
              if (panel?.querySelectorAll('button[title="workspace.ts"][aria-pressed="true"]').length !== 1 ||
                  !panel.querySelector('button[aria-label="Diff of changed files"][aria-pressed="true"]')) return false;
              const visible = e => {
                const range = document.createRange(); range.selectNodeContents(e);
                const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
                if (!rects.length || typeof document.elementFromPoint !== 'function') return false;
                for (const rect of rects) {
                  let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
                  for (let node = e; node; node = node.parentElement) {
                    const style = getComputedStyle(node), bounds = node.getBoundingClientRect();
                    if (node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true' ||
                        style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
                    if (node !== e && /^(auto|scroll|hidden|clip)$/.test(style.overflowX || style.overflow)) {
                      left = Math.max(left, bounds.left + node.clientLeft);
                      right = Math.min(right, bounds.left + node.clientLeft + node.clientWidth);
                    }
                    if (node !== e && /^(auto|scroll|hidden|clip)$/.test(style.overflowY || style.overflow)) {
                      top = Math.max(top, bounds.top + node.clientTop);
                      bottom = Math.min(bottom, bounds.top + node.clientTop + node.clientHeight);
                    }
                  }
                  if (rect.left < left || rect.top < top || rect.right > right || rect.bottom > bottom) return false;
                  const dx = Math.min(0.5, rect.width / 4), dy = Math.min(0.5, rect.height / 4);
                  if (![[rect.left + dx, rect.top + dy], [rect.right - dx, rect.top + dy],
                      [rect.left + dx, rect.bottom - dy], [rect.right - dx, rect.bottom - dy],
                      [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2]]
                      .every(([x,y]) => e.contains(document.elementFromPoint(x,y)))) return false;
                  if ([...document.querySelectorAll('.nac-toast')].some(toast => {
                    for (let node = toast; node; node = node.parentElement) {
                      const style = getComputedStyle(node);
                      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
                    }
                    const b = toast.getBoundingClientRect();
                    return b.width > 0 && b.height > 0 && b.left < rect.right && b.right > rect.left &&
                      b.top < rect.bottom && b.bottom > rect.top;
                  })) return false;
                }
                return true;
              };
              const rows = [...scroller.querySelectorAll('div')];
              // A hunk row is an aria-hidden gutter mark and its "@@ … @@" code
              // line; a source row is gutter, aria-hidden sign column and code.
              return rows.some(row => row.children.length === 2 && row.firstElementChild.matches('span[aria-hidden="true"]') &&
                  row.lastElementChild.matches('span.code') && visible(row.lastElementChild) &&
                  /^@@ -[0-9]+,[0-9]+ [+][0-9]+,[0-9]+ @@(?: .*)?$/.test(row.lastElementChild.textContent.trim())) &&
                rows.some(row => row.children.length === 3 && row.lastElementChild.matches('span.code') &&
                  row.lastElementChild.textContent === 'export const workspaceFileFixture = 351;');
            });
            return panes.length === 1;
            """
            try await self.waitJS("owned rendered Git diff", gitDiff)
            let gitReadiness = try await self.captureReadiness(.file(id: self.sessionID, path: "workspace.ts",
                content: "export const workspaceFileFixture = 351;\n"))
            guard gitReadiness["ready"] as? Bool == true else { throw PreviewError.message("Owned Git diff file readiness failed") }
            try await self.require("Owned Git diff changed during file readback", gitDiff)
            return "Actual Git branch, authoritative file diff and rendered hunk; no terminal input claim"
        }
        await check("approvals") {
            _ = try WorkspaceFixture.requireExternalReadTarget()
            try await self.send("WK_APPROVAL")
            try await self.waitJS("real Rust approval request", "return [...document.querySelectorAll('[role=dialog][aria-label=\"Permission required\"] button')].some(b => (\(Self.buttonName))(b) === 'Allow once') && document.body.innerText.includes('Approval needed') && document.body.innerText.includes('approval.txt');")
            // Keep the POSIX canonical identity bound before model invocation.
            // Use the stored POSIX spelling directly for the exact-match target.
            let path = try WorkspaceFixture.requireExternalReadTarget()
            guard let requestID = try await self.js("const r=await fetch('/sessions/' + \(self.quote(self.sessionID)) + '/permissions',{cache:'no-store'}); if(!r.ok)return null; const state=await r.json(); return state.requests.length === 1 ? state.requests[0].id : null;") as? String else {
                throw PreviewError.message("Expected one owned pending approval request")
            }
            try await self.snapshot("approval.png", expecting: .approval(id: self.sessionID, requestID: requestID, path: path))
            try await self.button("Allow once")
            try await self.waitJS("approval settlement", "return document.body.innerText.includes('WK_APPROVAL_COMPLETE');")
            try await self.idle()
            return "Scripted provider requests read outside workspace; production approval card Allow once, normal Rust authorization"
        }
        if checks["approvals"]?["status"] as? String == "pass" {
            await check("goals") {
                try await self.send("/goal WK bounded goal fixture")
                try await self.waitJS("durable goal", "return (await (await fetch('/sessions/' + \(self.quote(self.sessionID)) + '/goal')).json())?.objective === 'WK bounded goal fixture';")
                // Goal attachment advances its revision. As in embedded.e2e.ts,
                // reload before versioned controls; background polling can pause
                // while this console is locked. Never replay an uncertain mutation.
                _ = try await self.js("window.__wkReloading = true; return true;")
                self.app.webView.reload()
                try await self.waitJS("fresh composer after attachment", "return !window.__wkReloading && !!document.querySelector('[role=combobox][aria-label=Message]');")
                // Focus edits the goal from the composer's + menu; its row is
                // named for the freshly loaded goal, so it waits on the reload.
                try await self.button("Add to message")
                try await self.button("Edit goal: Active")
                try await self.button("Pause goal")
                try await self.waitJS("paused durable goal", "return (await (await fetch('/sessions/' + \(self.quote(self.sessionID)) + '/goal')).json())?.status === 'paused';")
                try await self.button("Close goal editor")
                return "Literal production /goal creation and versioned Pause; scripted provider, no real vendor schema claim (ALL-422 supplier separate)"
            }
        } else {
            // Dependency-blocked, not an independently exercised goal failure.
            // Preserve a failing suite even if the prerequisite record is absent.
            checks["goals"] = ["status": "fail", "blocked_by": "approvals", "executed": false,
                "detail": "Goals not exercised: approval check did not pass; no goal input/API operation attempted"]
            record(["checks": checks])
        }
        await check("projects") {
            guard let projectID = try await self.js("return (await (await fetch('/projects')).json()).projects.find(p => p.name === 'Disposable Mac preview')?.project_id;") as? String else {
                throw PreviewError.message("Missing owned fixture project")
            }
            try await self.button("Home")
            try await self.snapshot("projects.png", expecting: .project(id: projectID, title: "Disposable Mac preview"))
            return "Actual production Home route and seeded local project tile"
        }
        checks["links"] = ["status": "unavailable", "executed": false, "detail": "Markdown renders internal/source and safe external anchors; actual external native handoff not qualified by this preview. ALL-346/348 integration remains separate."]
    }

    /// Opens one action of the session header's Session menu (⋯) popover.
    /// A pressed trigger toggles, so it is pressed only while the menu is shut.
    /// Opens the session drawer if needed and selects the requested tab.
    /// The tab is looked up only inside the drawer's tab strip, so a closing
    /// Session menu row with the same name can never take the click.
    func drawerPanel(_ label: String) async throws {
        let tab = "[...document.querySelectorAll('[role=tablist][aria-label=\"Session panels\"] [role=tab]')].find(t => t.getAttribute('aria-label') === \(quote(label)) && t.getClientRects().length && !t.closest('[inert]'))"
        if (try? await js("return (\(tab))?.getAttribute('aria-selected') === 'true';")) as? Bool != true {
            if (try? await js("return !(\(tab));")) as? Bool == true { try await button("Session panel") }
            try await waitJS("drawer \(label) tab", "return !!(\(tab));")
            _ = try await js("(\(tab)).click(); return true;")
        }
        try await waitJS("drawer on \(label)", "return (\(tab))?.getAttribute('aria-selected') === 'true';")
    }

    func sessionAction(_ item: String, rememberAs: String? = nil) async throws {
        try await waitJS("Session menu trigger", "return !!document.querySelector('button[aria-label=\"Session menu\"]:not(:disabled)');")
        let remember = rememberAs.map { "window[\(quote($0))]=b;" } ?? ""
        _ = try await js("const b=document.querySelector('button[aria-label=\"Session menu\"]'); \(remember) if (b.getAttribute('aria-expanded') !== 'true') { b.focus(); b.click(); } return true;")
        let entry = "[...(document.querySelector('[role=dialog][aria-label=\"Session\"]')?.querySelectorAll('button') || [])].find(b => (\(Self.buttonName))(b) === \(quote(item)) && !b.disabled)"
        try await waitJS("Session menu action \(item)", "return !!(\(entry));")
        _ = try await js("\(entry).click(); return true;")
    }

    /// Opens a Settings section: the sidebar's Settings gear, then its link.
    func settingsSection(_ label: String) async throws {
        try await button("Settings")
        let entry = "[...(document.querySelector('nav[aria-label=\"Settings sections\"]')?.querySelectorAll('a') || [])].find(a => a.textContent.trim() === \(quote(label)))"
        try await waitJS("Settings section \(label) link", "return location.hash.startsWith('#/settings/') && !!(\(entry));")
        _ = try await js("\(entry).click(); return true;")
        try await waitJS("Settings section \(label)", "return [...document.querySelectorAll('main[aria-label]')].some(e => e.getAttribute('aria-label') === \(quote(label)) && e.getClientRects().length);")
    }

    /// Settings' Back returns to the session it was opened from.
    func leaveSettings() async throws {
        try await button("Back")
        try await waitJS("session after Settings", "return location.hash.startsWith('#/session/' + \(quote(sessionID)) + '/') && !!document.querySelector('[role=combobox][aria-label=Message]');")
    }

    func overlayJourney() async throws -> String {
        var layouts: [[String: Any]] = []
        for collapsed in [false, true] {
            if collapsed { try await button("Hide sidebar") }
            record(["overlay_layout_in_progress": collapsed ? "collapsed" : "expanded"])
            // The rename action hands its focus return to the Session menu trigger.
            try await sessionAction("Rename", rememberAs: "__wkModalOpener")
            try await waitJS("instance inert background", "return !!document.querySelector('[data-nac-runtime] [inert]') && !!document.querySelector('[role=dialog][aria-label=\"Rename session\"]');")
            try await require("Dialog overflows viewport", "const r=document.querySelector('[role=dialog][aria-label=\"Rename session\"]').getBoundingClientRect();return r.left>=-1 && r.right<=innerWidth+1;")
            _ = try await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;")
            try await waitJS("Escape closes layer", "return !document.querySelector('[role=dialog]');")
            try await waitJS("modal focus return", "return document.activeElement === window.__wkModalOpener;")
            try await waitJS("model chip", "return !!document.querySelector('button[aria-label^=\"Model: \"]:not(:disabled)');")
            _ = try await js("const chip=document.querySelector('button[aria-label^=\"Model: \"]'); window.__wkModelChip=chip; chip.focus(); chip.click(); return true;")
            let modelList = "document.querySelector('[role=dialog][aria-label=\"Model settings\"] button[aria-label^=\"Choose model\"]')"
            try await waitJS("model settings dialog", "return !!(\(modelList));")
            _ = try await js("window.__wkPopoverOpener=\(modelList); window.__wkPopoverOpener.focus(); window.__wkPopoverOpener.click(); return true;")
            try await waitJS("production model popover", "return !!document.querySelector('input[aria-label=\"Search models\"]') && window.__wkPopoverOpener.getAttribute('aria-expanded') === 'true';")
            try await require("Popover overflows viewport", "const input=document.querySelector('input[aria-label=\"Search models\"]');const panel=input.closest('[data-radix-popper-content-wrapper]');if(!panel)return false;const r=panel.getBoundingClientRect();return r.left>=-1 && r.right<=innerWidth+1;")
            _ = try await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;")
            try await waitJS("popover dismissed and focus restored", "return !document.querySelector('input[aria-label=\"Search models\"]') && document.activeElement === window.__wkPopoverOpener && window.__wkPopoverOpener.getAttribute('aria-expanded') === 'false';")
            _ = try await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;")
            try await waitJS("model settings dismissed and focus restored", "return !document.querySelector('[role=dialog][aria-label=\"Model settings\"]') && document.activeElement === window.__wkModelChip;")
            layouts.append(["sidebar": collapsed ? "collapsed" : "expanded", "modal_focus_return": true, "popover_focus_return": true])
            record(["overlay_layouts": layouts])
            if collapsed { try await button("Show sidebar") }
        }
        return "Expanded + hidden sidebar: Rename modal/model-popover bounds, inertness, synthetic Escape and exact focus return; real keyboard/VoiceOver separate"
    }

    func resizeJourney() async throws -> String {
        let original = app.window.frame
        defer { app.webView.pageZoom = 1; app.window.setFrame(original, display: true) }
        for size in [(900.0, 650.0), (640.0, 600.0), (1280.0, 800.0)] {
            app.window.setContentSize(NSSize(width: size.0, height: size.1))
            for zoom in [1.0, 1.25, 1.5] {
                app.webView.pageZoom = zoom
                try await waitJS("resized production layout", "return document.documentElement.scrollWidth <= innerWidth+1 && document.querySelector('[role=combobox][aria-label=Message]').getBoundingClientRect().width > 40;")
                try await snapshot("resize-\(Int(size.0))-zoom-\(Int(zoom * 100)).png",
                    expecting: .transcript(id: sessionID, message: "WK_RICH_COMPLETE"))
            }
        }
        return "Native window sizes 900/640/1280; WKWebView pageZoom 100/125/150%; snapshots and document bounds"
    }
}
#endif
