#if PREVIEW_SMOKE
import AppKit
import WebKit
import CryptoKit

/// ALL-351 only: drives the existing production document in a real WKWebView.
/// All keyboard/composition events below are synthetic and reported as such.
@MainActor
final class WorkspaceSmoke {
    let app: PreviewApp
    let scenario: String
    let output: URL
    let record: ([String: Any]) -> Void
    var checks: [String: [String: Any]] = [:]
    var paintDiagnostics: [String: Any] = [:]
    var sessionID = ""
    var assetDocuments: [[String: Any]] = []

    init(app: PreviewApp, scenario: String, output: URL, record: @escaping ([String: Any]) -> Void) {
        self.app = app
        self.scenario = scenario
        self.output = output.deletingLastPathComponent()
        self.record = record
    }

    func run() async throws {
        let args = CommandLine.arguments
        func argument(_ flag: String) -> String? {
            guard let at = args.firstIndex(of: flag), args.indices.contains(at + 1) else { return nil }
            return args[at + 1]
        }
        let priorPID = Int32(argument("--workspace-prior-pid") ?? "0") ?? 0
        let priorBundle = argument("--workspace-prior-bundle")
        let prior = priorPID > 0 ? NSRunningApplication(processIdentifier: priorPID) : nil
        let priorLaunch = prior?.launchDate
        defer {
            // Never overwrite a newer user focus choice or activate loginwindow.
            if NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid(),
               let prior, !prior.isTerminated, prior.bundleIdentifier == priorBundle,
               prior.launchDate == priorLaunch, prior.bundleIdentifier != "com.apple.loginwindow",
               prior.processIdentifier != getpid() {
                let restored = prior.activate(options: [])
                record(["prior_focus_restored": restored])
            }
        }
        let foreground = NSWorkspace.shared.frontmostApplication?.processIdentifier
        if !args.contains("--workspace-console-locked"), foreground == priorPID || foreground == getpid() {
            // A single normal activation of this owned fixture is authorized.
            // If the user selected another app, leave that choice untouched.
            app.window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
        // Do not preempt the preview's 30s engine watchdog. Initial document
        // and UI configuration reads also need their normal bounded window.
        try await waitJS("fixture configuration", "return !!document.querySelector('[role=dialog]');", timeout: 60)
        guard let profile = app.profile else { throw PreviewError.message("Missing isolated profile") }
        // Create and bind the canonical owned file before any fixture model read.
        try WorkspaceFixture.prepareExternalReadTarget(in: profile.root)
        try Data("export const workspaceFileFixture = 351;\n".utf8).write(to: profile.workspace.appendingPathComponent("workspace.ts"))
        try Data(WorkspaceFixture.mcpScript.utf8).write(to: profile.root.appendingPathComponent("tmp/workspace-mcp.sh"))
        record(["profile": profile.root.path, "engine_pid": app.engine.pid,
                "interaction_method": "scripted DOM in actual AppKit/system WKWebView; not real OS input",
                "user_agent": try await js("return navigator.userAgent;"),
                "surface": ["window_visible": app.window.isVisible,
                            "window_occlusion_visible": app.window.occlusionState.contains(.visible),
                            "window_key": app.window.isKeyWindow, "application_active": NSApp.isActive]])
        if scenario == "workspace-manual" {
            try await createChat("direct")
            try await send("WK_RICH")
            try await idle()
            record(["manual_stage_ready": true,
                    "manual_evidence": "Awaiting operator observations; no physical input or accessibility pass inferred"])
            // No further scripted UI/input after staging. The operator uses the
            // ordinary production controls and closes the owned window to quit.
            let deadline = Date().addingTimeInterval(15 * 60)
            while !app.stopping && Date() < deadline {
                try await Task.sleep(nanoseconds: 200_000_000)
            }
            throw PreviewError.message("Manual fixture ended; physical evidence requires operator observations")
        } else if scenario == "workspace-legacy" { await legacyJourney() }
        else { await directJourney() }
        record(["checks": checks])
        if checks.values.contains(where: { $0["status"] as? String == "fail" }) {
            throw PreviewError.message("ALL-351 workspace checks failed; see per-feature evidence")
        }
    }

    func check(_ id: String, _ operation: () async throws -> String) async {
        do {
            checks[id] = ["status": "pass", "detail": try await operation()]
        } catch {
            checks[id] = ["status": "fail", "detail": String(describing: error)]
            if let text = try? await js("return document.body.innerText.slice(-12000);") {
                checks[id]?["dom"] = text
            }
            try? await snapshot("failed-\(id).png")
            // Only the ordinary instance layer stack handles this test event.
            _ = try? await js("(document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); return true;")
        }
        record(["checks": checks])
    }

    func js(_ source: String) async throws -> Any {
        try await app.webView.callAsyncJavaScript(source, arguments: [:], in: nil, contentWorld: .page) ?? NSNull()
    }

    func waitJS(_ label: String, _ source: String, timeout: TimeInterval = 20) async throws {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            record(["profile": app.profile?.root.path ?? "", "engine_pid": app.engine.pid])
            if let failure = app.failure { throw PreviewError.message(failure) }
            if (try? await js(source)) as? Bool == true { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw PreviewError.message("Timed out waiting for \(label)")
    }

    func require(_ label: String, _ source: String) async throws {
        guard try await js(source) as? Bool == true else { throw PreviewError.message(label) }
    }

    func quote(_ value: String) -> String {
        let data = try! JSONSerialization.data(withJSONObject: [value])
        return String(decoding: data, as: UTF8.self).dropFirst().dropLast().description
    }

    func button(_ name: String, rememberAs: String? = nil) async throws {
        let predicate = "b => (b.getAttribute('aria-label') || b.textContent.trim()) === \(quote(name)) && !b.disabled && b.getClientRects().length && !b.closest('[inert]')"
        try await waitJS("button \(name)", "return [...document.querySelectorAll('button')].some(\(predicate));")
        // A focus assertion must retain the exact chosen opener before its
        // activation changes inertness or mounts another matching control.
        let remember = rememberAs.map { "window[\(self.quote($0))]=b;" } ?? ""
        _ = try await js("const b=[...document.querySelectorAll('button')].find(\(predicate)); \(remember) b.focus(); b.click(); return true;")
    }

    func fill(_ selector: String, _ value: String) async throws {
        _ = try await js("""
        const field = document.querySelector(\(quote(selector)));
        if (!field) throw new Error('Missing field ' + \(quote(selector)));
        field.focus();
        const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, \(quote(value)));
        field.dispatchEvent(new Event('input', {bubbles:true})); return true;
        """)
    }

    func send(_ prompt: String) async throws {
        try await fill("[role=combobox][aria-label=Message]", prompt)
        try await button("Send")
    }

    func idle() async throws {
        try await waitJS("authoritative run settlement", """
        const r = await fetch('/sessions/' + \(quote(sessionID)));
        if (!r.ok) return false;
        return !(await r.json()).active_run && !document.querySelector('button[aria-label="Stop run"]');
        """)
    }

    func createChat(_ behavior: String) async throws {
        if behavior != "direct" {
            let text = behavior == "orchestrator" ? "NAC orchestrator" : "Direct + NAC orchestration"
            _ = try await js("const r = [...document.querySelectorAll('[role=radio]')].find(e => e.textContent.includes(\(quote(text)))); if (!r) throw Error('Missing behavior choice'); r.click(); return true;")
        }
        try await button("Create chat")
        try await waitJS("production session", "return location.hash.includes('/session/') && !!document.querySelector('[role=combobox][aria-label=Message]');")
        sessionID = try await js("return location.hash.split('/')[2];") as! String
        try await require("Immutable behavior differs", "return (await (await fetch('/sessions/' + \(quote(sessionID)))).json()).metadata.behavior === \(quote(behavior));")
    }

    func navigate(_ panel: String) async throws {
        _ = try await js("location.hash = '/session/' + \(quote(sessionID)) + '/' + \(quote(panel)); return true;")
        try await waitJS("panel \(panel)", "return location.hash.endsWith('/' + \(quote(panel))) && !!document.querySelector('[role=combobox][aria-label=Message]');")
    }

    // Native-owned observations survive a WK document reload; each raw sample stays intact.
    static let assetEvidenceScript = #"""
    const resources = performance.getEntriesByType('resource').map(e => e.name);
    const complete = Array.isArray(window.__previewEvidence?.errors);
    const errors = complete ? window.__previewEvidence.errors.map(String) : [];
    return {complete, resources, errors, origin:location.origin, time_origin:performance.timeOrigin,
      fonts_chunks_ok:document.fonts.check('16px Inter') && resources.some(name=>/mathjax.*woff/i.test(name)) &&
        resources.filter(name=>name.includes('/assets/dist/assets/') && name.endsWith('.js')).length >= 3,
      offline_ok:complete && errors.length === 0 && resources.every(name=>new URL(name).origin === location.origin)};
    """#

    func recordAssetDocument(_ phase: String) async throws {
        guard var value = try await js(Self.assetEvidenceScript) as? [String: Any] else {
            throw PreviewError.message("Missing document asset observation")
        }
        value["phase"] = phase
        assetDocuments.append(value)
        record(["asset_documents": assetDocuments])
    }

    func assetDocumentsPass(_ predicate: String) -> Bool {
        let phases = Set(assetDocuments.compactMap { $0["phase"] as? String })
        return phases.contains("before-reload") && phases.contains("after-reload") &&
            assetDocuments.allSatisfy { $0["complete"] as? Bool == true && $0[predicate] as? Bool == true }
    }

    enum CaptureTarget {
        case project(id: String, title: String)
        case approval(id: String, requestID: String, path: String)
        case rich(id: String, markdown: String)
        case transcript(id: String, message: String, readOnly: Bool = false, identityText: String? = nil)
        case file(id: String, path: String, content: String)

        var payload: [String: Any] {
            switch self {
            case let .project(id, title): return ["kind": "project", "id": id, "text": title]
            case let .rich(id, markdown): return ["kind": "rich", "id": id, "markdown": markdown]
            case let .approval(id, requestID, path):
                return ["kind": "approval", "id": id, "requestID": requestID, "text": path]
            case let .file(id, path, content):
                return ["kind": "file", "id": id, "path": path, "content": content]
            case let .transcript(id, message, readOnly, identityText):
                var value: [String: Any] = ["kind": "transcript", "id": id, "text": message, "readOnly": readOnly]
                if let identityText { value["identityText"] = identityText }
                return value
            }
        }
    }

    // Exercised verbatim by test_workspace_capture.mjs. A URL/chrome update is
    // not proof that React has committed and revealed the requested content.
    static let captureReadinessScript = #"""
    const hash = location.hash;
    const loading = !!document.querySelector('[aria-label="Loading conversation"]');
    const composer = !!document.querySelector('[role=combobox][aria-label=Message]');
    const parent = !!document.querySelector('button[aria-label$=", parent chat"]');
    const parts = hash.split('/');
    const route = expected.kind === 'project' ? hash === '#/' : parts[1] === 'session' && parts[2] === expected.id;
    function findText(text) {
      const root = document.querySelector('[data-nac-content]') || document.body;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.textContent.includes(text) && node.parentElement.closest('.overflow-auto,.overflow-y-auto') &&
            !node.parentElement.closest('button,[role=button],header,aside,nav,[inert],[role=dialog]')) {
          return node.parentElement;
        }
      }
      return null;
    }
    if (expected.kind === 'approval') {
      const requests = permissionState?.requests || [];
      const request = requests.length === 1 ? requests[0] : null;
      const owned = request?.id === expected.requestID && request?.session_id === expected.id &&
        request?.tool === 'read' && request?.call_id === 'wk-approval' &&
        request.resources.some(r => r.action === 'read' && r.resource === expected.text && r.display === expected.text);
      // Diagnostics only: keep the owned conjunction above unchanged.
      const ownedPredicates = {
        one_request:requests.length === 1, request_id:request?.id === expected.requestID,
        session_id:request?.session_id === expected.id, tool:request?.tool === 'read',
        call_id:request?.call_id === 'wk-approval',
        exact_read_resource:Array.isArray(request?.resources) && request.resources.some(r =>
          r?.action === 'read' && r?.resource === expected.text && r?.display === expected.text)
      };
      const resourcePredicates = (Array.isArray(request?.resources) ? request.resources : []).slice(0,8).map(r => ({
        action:r?.action === 'read', resource:r?.resource === expected.text, display:r?.display === expected.text
      }));
      const dialogs = [...document.querySelectorAll('[data-nac-overlays] [role="dialog"]')];
      const dialog = dialogs.length === 1 ? dialogs[0] : null;
      const heading = dialog && document.getElementById(dialog.getAttribute('aria-labelledby'));
      const queue = dialog?.querySelector('[aria-label="Pending permission requests"]');
      const entries = [...(queue?.querySelectorAll('button') || [])];
      const selected = entries.length === 1 && entries[0].getAttribute('aria-pressed') === 'true' ? entries[0] : null;
      const access = dialog?.querySelector('[aria-label="Requested access"]');
      const allow = [...(dialog?.querySelectorAll('button') || [])].find(b => b.textContent.trim() === 'Allow once');
      const selection = heading?.textContent.trim() === 'Permission required' &&
        selected?.textContent.includes('(' + expected.id + '): read') &&
        access?.textContent.includes('(' + expected.id + ')') && access?.textContent.includes(expected.text);
      const enabled = allow && !allow.disabled && !allow.closest('[inert]') && selected && !selected.disabled;
      const surfaces = [dialog, heading, selected, access, allow].map(inspect);
      const visible = surfaces.every(s => s.visible);
      const reason = !route ? 'requested route not current' : !owned ? 'owned pending read no longer current' :
        !selection ? 'approval dialog does not match owned request' : !enabled ? 'approval control unavailable' :
        !visible ? 'approval dialog not fully visible' : document.visibilityState !== 'visible' ? 'document not visible' : 'ready';
      return {ready:reason === 'ready', reason, expected, hash, visibility:document.visibilityState,
        loadingConversation:loading, permission_request_id:request?.id || null, surfaces,
        approval_predicates:{...ownedPredicates, owned:!!owned, route,
          one_dialog:dialogs.length === 1, title:heading?.textContent.trim() === 'Permission required',
          one_selected:!!selected, selected_owner_tool:!!selected?.textContent.includes('(' + expected.id + '): read'),
          access_owner:!!access?.textContent.includes('(' + expected.id + ')'),
          access_path:!!access?.textContent.includes(expected.text), selection:!!selection,
          allow_enabled:!!allow && !allow.disabled, allow_not_inert:!!allow && !allow.closest('[inert]'),
          selected_enabled:!!selected && !selected.disabled, enabled:!!enabled, visible,
          document_visible:document.visibilityState === 'visible'},
        resource_predicates:resourcePredicates};
    }
    if (expected.kind === 'rich') {
      // Use the server's visible-message page, not its full canonical transcript.
      // Require the entire two-message visible fixture; never filter locally.
      const messages = sessionState?.messages || [];
      const index = messages.findIndex(m => m.role === 'assistant' && m.content === expected.markdown);
      const fullAnswer = index >= 0 ? messages[index].content : null;
      const settled = sessionState?.metadata?.session_id === expected.id && !sessionState.active_run &&
        !sessionState.active_compaction && !sessionState.run_failure && !sessionState.transcript_recovery_warning &&
        messages.length === 2 && index === 1 && messages[0].role === 'user' && messages[0].content === 'WK_RICH' &&
        sessionState.message_page?.start === 0 && sessionState.message_page?.end === 2 &&
        sessionState.message_page?.total === 2 && sessionState.message_page?.has_older === false;
      // Evaluate every conjunct separately for the retained observation only.
      // Strict visible 2/1 expectations remain; complete page metadata is required.
      const settledPredicates = {
        owner:sessionState?.metadata?.session_id === expected.id,
        no_active_run:!sessionState?.active_run, no_active_compaction:!sessionState?.active_compaction,
        no_run_failure:!sessionState?.run_failure, no_recovery_warning:!sessionState?.transcript_recovery_warning,
        message_count_2:messages.length === 2, answer_index_1:index === 1,
        first_role_user:messages[0]?.role === 'user', first_content_WK_RICH:messages[0]?.content === 'WK_RICH',
        page_absent:!sessionState?.message_page, page_start_0:sessionState?.message_page?.start === 0,
        page_total_2:sessionState?.message_page?.total === 2,
        page_end_2:sessionState?.message_page?.end === 2,
        page_no_older:sessionState?.message_page?.has_older === false,
        page_valid:sessionState?.message_page?.start === 0 && sessionState?.message_page?.end === 2 &&
          sessionState?.message_page?.total === 2 && sessionState?.message_page?.has_older === false,
        settled:!!settled
      };
      const candidates = [...document.querySelectorAll('[data-nac-content] .markdown-content')].filter(e =>
        !e.closest('[inert],[role=dialog]') && !e.classList.contains('streaming') && e.textContent.includes('WK_RICH_COMPLETE'));
      const rich = candidates.length === 1 ? candidates[0] : null;
      function richInspect(element) {
        const value = inspect(element);
        const r = element?.getBoundingClientRect();
        let bounded = !!r && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
        for (let a = element?.parentElement; a && bounded; a = a.parentElement) {
          if (a.hasAttribute('inert') || a.getAttribute('aria-hidden') === 'true') bounded = false;
          const style = getComputedStyle(a), clip = a.getBoundingClientRect();
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (r.left < clip.left || r.right > clip.right)) bounded = false;
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (r.top < clip.top || r.bottom > clip.bottom)) bounded = false;
        }
        return {...value, within_frame:bounded, visible:value.visible && bounded &&
          !element?.closest('[inert],[aria-hidden="true"]')};
      }
      const table = rich?.querySelector('table');
      const code = rich?.querySelector('pre code');
      const highlight = code?.querySelector('span[style]');
      const math = rich?.querySelector('mjx-container[jax="CHTML"]');
      const glyph = math?.querySelector('mjx-math mjx-c');
      const tableText = table && [...table.querySelectorAll('th,td')].map(e=>e.textContent.trim());
      const literal = JSON.stringify(tableText) === JSON.stringify(['Engine','Workspace','System WebKit','shared React']) &&
        code?.textContent.trim() === 'export const webkitFixture = 351;' && math?.parentElement?.textContent.includes('A formula');
      const fonts = document.fonts?.status === 'loaded' && document.fonts.check('16px Inter') &&
        performance.getEntriesByType('resource').some(e=>/mathjax.*woff/i.test(e.name));
      const surfaces = [table,code,highlight,math,glyph].map(richInspect);
      const sentinel = rich ? [...rich.querySelectorAll('p')].find(e=>e.textContent.trim()==='WK_RICH_COMPLETE') : null;
      const reason = !route ? 'requested route not current' : !settled ? 'owned full answer not settled' :
        loading || !composer || document.querySelector('button[aria-label="Stop run"],[role="alert"]') ? 'transcript loading or error' :
        !rich || !literal ? 'owned actual rich content missing' : !fonts ? 'rich fonts not ready' :
        !surfaces.every(s=>s.visible) ? 'rich targets outside visible frame' : document.visibilityState !== 'visible' ? 'document not visible' : 'ready';
      return {ready:reason==='ready',reason,expected,hash,loadingConversation:loading,visibility:document.visibilityState,
        full_answer:fullAnswer, message_identity:{session_id:expected.id,visible_index:index,
          created_at:sessionState?.message_created_at?.[index] ?? null,message_count:messages.length},
        message_page:sessionState?.message_page || null,
        viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},fonts_ready:!!fonts,surfaces,
        sentinel_observation:richInspect(sentinel), settled_predicates:settledPredicates};
    }
    if (expected.kind === 'file') {
      // The desktop FilePane and DiffPane share this detail header/scroller.
      // Text in the chat, file list or a hidden duplicate cannot own the image.
      const fileDiagnostics = [];
      const fileFact = (gate, passed, details = {}) => {
        if (fileDiagnostics.length < 48) fileDiagnostics.push({gate, passed, ...details});
        return passed;
      };
      const fileVisible = element => {
        if (!inspect(element).visible) return fileFact('style-visibility', false);
        const rect = element.getBoundingClientRect();
        let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
          if (/^(auto|scroll|hidden|clip)$/.test(style.overflowX || style.overflow)) {
            left = Math.max(left, bounds.left + parent.clientLeft);
            right = Math.min(right, bounds.left + parent.clientLeft + parent.clientWidth);
          }
          if (/^(auto|scroll|hidden|clip)$/.test(style.overflowY || style.overflow)) {
            top = Math.max(top, bounds.top + parent.clientTop);
            bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
          }
        }
        return fileFact('viewport-clipping', rect.left >= left - 0.5 && rect.top >= top - 0.5 &&
          rect.right <= right + 0.5 && rect.bottom <= bottom + 0.5,
          {rect:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom},clip:{left,top,right,bottom}});
      };
      const fileUncovered = element => {
        if (typeof document.elementFromPoint !== 'function') return fileFact('hit-api', false);
        // Inline code may wrap. Check each rendered fragment, not its union's
        // empty space, without dismissing notifications or changing the page.
        // Inspect text nodes so flexible spans and inline-token padding do not
        // become glyph evidence. Newline-only ranges may have zero width.
        const rectangles = [];
        const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (text.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(text.currentNode);
          rectangles.push(...[...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0));
        }
        if (!rectangles.length) return fileFact('fragment-count', false);
        for (const rect of rectangles) {
          if (rect.width <= 0 || rect.height <= 0) return fileFact('fragment-size', false);
          const insetX = Math.min(0.5, rect.width / 4), insetY = Math.min(0.5, rect.height / 4);
          const points = [[(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2],
            [rect.left + insetX, rect.top + insetY], [rect.right - insetX, rect.top + insetY],
            [rect.left + insetX, rect.bottom - insetY], [rect.right - insetX, rect.bottom - insetY]];
          if (!points.every(([x,y]) => {
            const top = document.elementFromPoint(x,y);
            return fileFact('hit-owner', !!top && element.contains(top), {x,y,
              target:element.tagName, targetClass:(element.getAttribute('class') || '').slice(0,128),
              targetPointerEvents:getComputedStyle(element).pointerEvents,
              top:top?.tagName || null, topClass:(top?.getAttribute('class') || '').slice(0,128)});
          })) return false;
          // Pointer-events:none paint is absent from hit testing. Production
          // notifications must also stop overlapping the requested text.
          if ([...document.querySelectorAll('.nac-toast')].some(toast => {
            for (let e = toast; e; e = e.parentElement) {
              const style = getComputedStyle(e);
              if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
            }
            const bounds = toast.getBoundingClientRect();
            const overlaps = bounds.width > 0 && bounds.height > 0 && bounds.left < rect.right &&
              bounds.right > rect.left && bounds.top < rect.bottom && bounds.bottom > rect.top;
            fileFact('notification-overlap', !overlaps,
              {bounds:{left:bounds.left,top:bounds.top,right:bounds.right,bottom:bounds.bottom}});
            return overlaps;
          })) return false;
        }
        return true;
      };
      const panes = [...document.querySelectorAll('span[title]')].flatMap(title => {
        if (title.getAttribute('title') !== expected.path || title.closest('button,[inert],[role=dialog]')) return [];
        const header = title.parentElement, scroller = header?.nextElementSibling;
        if (!header?.classList.contains('header-sm') || !scroller?.classList.contains('overflow-auto')) return [];
        const code = [...scroller.querySelectorAll('div')].filter(row => row.children.length === 2 &&
          row.firstElementChild.tagName === 'SPAN' && /^\d+$/.test(row.firstElementChild.textContent.trim()) &&
          row.lastElementChild.matches('span.code')).map(row => row.lastElementChild)
          .filter(e => e.textContent === expected.content.replace(/\n$/, ''));
        return code.filter(e => fileVisible(e) && fileVisible(title) && fileVisible(scroller) &&
          fileUncovered(e) && fileUncovered(title))
          .map(element => ({element, scroller}));
      });
      const panel = panes.length === 1 ? panes[0].scroller.parentElement?.parentElement : null;
      const selected = [...(panel?.querySelectorAll('button[title][aria-pressed=true]') || [])]
        .filter(e => e.getAttribute('title') === expected.path);
      const owned = fileState?.path === expected.path && fileState.content === expected.content &&
        fileState.binary === false && fileState.too_large === false;
      const loadingFile = panes.some(p => p.scroller.textContent.includes('Loading file…'));
      const observed = inspect(panes.length === 1 ? panes[0].element : null);
      const reason = hash !== '#/session/' + expected.id + '/files' ? 'requested file route not current' :
        !composer || loading ? 'requested workspace not mounted' : !owned ? 'file API identity/content differs' :
        selected.length !== 1 || panes.length !== 1 ? 'selected file detail not uniquely visible' :
        loadingFile ? 'file still loading' : document.visibilityState !== 'visible' ? 'document not visible' : 'ready';
      return {ready:reason === 'ready', reason, expected, hash, file_api_bound:owned,
        selected_count:selected.length, detail_count:panes.length, loadingFile, fileDiagnostics, ...observed};
    }
    let element = expected.kind === 'project' ? null : findText(expected.text);
    if (expected.kind === 'project') {
      // The reorder wrapper shares the card ID. Inspect the rendered title
      // under the actual animated ProjectCard, including all its ancestors.
      const card = [...document.querySelectorAll('[role="button"][data-item-kind="project"]')]
        .find(e => e.dataset.itemId === expected.id);
      if (card) {
        const title = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
        while (title.nextNode()) {
          if (title.currentNode.textContent.trim() === expected.text) {
            element = title.currentNode.parentElement;
            break;
          }
        }
      }
    }
    function inspect(element) {
      const ancestors = [];
      for (let e = element; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        ancestors.push({tag:e.tagName, display:s.display, visibility:s.visibility, opacity:s.opacity});
      }
      const rect = element?.getBoundingClientRect();
      const geometry = rect ? {x:rect.x,y:rect.y,width:rect.width,height:rect.height} : null;
      const visible = !!rect && rect.width > 0 && rect.height > 0 &&
        ancestors.every(s => s.display !== 'none' && s.visibility === 'visible' && Number(s.opacity) === 1);
      return {visible, geometry, ancestors, content:element?.textContent.slice(0,200) || null};
    }
    const observed = inspect(element);
    const identity = expected.identityText ? inspect(findText(expected.identityText)) : null;
    const chrome = expected.kind === 'project' ? !composer :
      expected.readOnly ? !composer && parent : composer;
    const reason = !route ? 'requested route not current' : !chrome ? 'requested view not mounted' :
      loading ? 'conversation still loading' : !element ? 'expected content not mounted' :
      !observed.visible || identity && !identity.visible ? 'expected content not fully visible' : document.visibilityState !== 'visible' ?
      'document not visible' : 'ready';
    return {ready:reason === 'ready', reason, expected, hash, loadingConversation:loading,
      composer, parent, visibility:document.visibilityState, ...observed, identity};
    """#

    func captureReadiness(_ target: CaptureTarget) async throws -> [String: Any] {
        var arguments: [String: Any] = ["expected": target.payload, "permissionState": NSNull(), "sessionState": NSNull()]
        var canonicalState: [String: Any]?
        if case let .rich(id, _) = target {
            canonicalState = try await js("const r=await fetch('/sessions/' + \(quote(id)) + '?include_sessions=false',{cache:'no-store'}); if(!r.ok)throw Error('Canonical snapshot unavailable'); return await r.json();") as? [String: Any]
            guard (canonicalState?["metadata"] as? [String: Any])?["session_id"] as? String == id else {
                throw PreviewError.message("Canonical snapshot owner differs")
            }
            arguments["sessionState"] = try await js("const r=await fetch('/sessions/' + \(quote(id)) + '?message_limit=3&include_system=false&include_sessions=false',{cache:'no-store'}); if(!r.ok)throw Error('Owned snapshot unavailable'); return await r.json();")
        }
        if case let .approval(id, _, _) = target {
            arguments["permissionState"] = try await js("const r=await fetch('/sessions/' + \(quote(id)) + '/permissions',{cache:'no-store'}); if(!r.ok)throw Error('Permission state unavailable'); return await r.json();")
        }
        if case let .file(id, path, _) = target {
            arguments["fileState"] = try await js("const r=await fetch('/sessions/' + \(quote(id)) + '/workspace/file?' + new URLSearchParams({path:\(quote(path))}),{cache:'no-store'}); if(!r.ok)throw Error('File snapshot unavailable'); return await r.json();")
        }
        guard var value = try await app.webView.callAsyncJavaScript(Self.captureReadinessScript,
            arguments: arguments, in: nil, contentWorld: .page) as? [String: Any] else {
            throw PreviewError.message("Capture readiness returned no observation")
        }
        if let canonicalState {
            // Keep the unfiltered canonical fixture transcript separately from
            // the explicit visible page. This does not identify any old lost text.
            value["canonical_snapshot"] = canonicalState
        }
        // Hash only the already-fetched visible page. No extra request, local
        // filtering, readiness override or retry is added. Full snapshots retain
        // canonical system messages and are not this probe's cardinality contract.
        if case .rich = target, let state = arguments["sessionState"] as? [String: Any] {
            let messages = state["messages"] as? [[String: Any]] ?? []
            let times = state["message_created_at"] as? [Any] ?? []
            value["message_observations"] = messages.prefix(32).enumerated().map { index, message -> [String: Any] in
                ["index": index, "role": diagnosticField(message["role"], text: true),
                 "type": diagnosticField(message["type"], text: true),
                 "kind": diagnosticField(message["kind"], text: true),
                 "content": diagnosticField(message["content"]),
                 "field_names": Array(message.keys.sorted().prefix(16)),
                 "tool_call_count": (message["tool_calls"] as? [Any])?.count ?? 0,
                 "created_at": diagnosticField(times.indices.contains(index) ? times[index] : nil, text: true)]
            }
            value["message_observations_truncated"] = messages.count > 32
            value["session_owner_observation"] = diagnosticField((state["metadata"] as? [String: Any])?["session_id"], text: true)
            value["message_page_observation"] = diagnosticField(state["message_page"])
        }
        if case let .approval(id, requestID, path) = target,
           let state = arguments["permissionState"] as? [String: Any] {
            let requests = state["requests"] as? [[String: Any]] ?? []
            value["approval_values"] = [
                "expected_session_id": diagnosticField(id, text: true),
                "expected_request_id": diagnosticField(requestID, text: true),
                "fixture_input_path": diagnosticField(WorkspaceFixture.externalPath, text: true),
                "expected_resolved_path": diagnosticField(path, text: true),
                "request_count": requests.count, "requests_truncated": requests.count > 4,
                "requests": requests.prefix(4).map { request -> [String: Any] in
                    let resources = request["resources"] as? [[String: Any]] ?? []
                    return ["id": diagnosticField(request["id"], text: true),
                            "session_id": diagnosticField(request["session_id"], text: true),
                            "tool": diagnosticField(request["tool"], text: true),
                            "call_id": diagnosticField(request["call_id"], text: true),
                            "resource_count": resources.count, "resources_truncated": resources.count > 8,
                            "resources": resources.prefix(8).map { resource in
                                ["action": diagnosticField(resource["action"], text: true),
                                 "resource": diagnosticField(resource["resource"], text: true),
                                 "display": diagnosticField(resource["display"], text: true)]
                            }]
                }]
        }
        return value
    }

    // Bounded fixture diagnostics; message content is hashed, never newly logged.
    // Strings hash their exact UTF-8; nonstrings hash sorted JSON, not source bytes.
    func diagnosticField(_ value: Any?, text: Bool = false) -> [String: Any] {
        guard let value else { return ["kind": "absent"] }
        if value is NSNull { return ["kind": "null"] }
        if let string = value as? String {
            var result: [String: Any] = ["kind": "string", "utf8_bytes": string.utf8.count,
                "sha256": SHA256.hash(data: Data(string.utf8)).map { String(format: "%02x", $0) }.joined()]
            if text { result["text"] = String(string.prefix(1024)); result["truncated"] = string.count > 1024 }
            return result
        }
        var result: [String: Any] = ["kind": value is [Any] ? "array" : value is [String: Any] ? "object" : "scalar"]
        if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .fragmentsAllowed]) {
            result["json_sha256"] = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        }
        return result
    }

    func snapshot(_ name: String, expecting target: CaptureTarget? = nil) async throws {
        var targetedCaptureCompleted = false
        defer {
            if target != nil && !targetedCaptureCompleted {
                checks["visible-paint"] = ["status": "unavailable", "detail": "Requested snapshot did not complete all capture and identity checks; inspect retained diagnostics"]
                record(["paint_diagnostics": paintDiagnostics, "checks": checks])
            }
        }
        var readiness: [String: Any] = ["kind": "diagnostic-only"]
        var initialReadiness: [String: Any] = [:]
        let started = Date()
        var ready = target == nil
        if let target {
            let deadline = Date().addingTimeInterval(20)
            repeat {
                readiness = try await captureReadiness(target)
                if initialReadiness.isEmpty { initialReadiness = readiness }
                ready = readiness["ready"] as? Bool == true
                if ready || app.failure != nil { break }
                try await Task.sleep(nanoseconds: 50_000_000)
            } while Date() < deadline
        }
        // Observe a real frame without an unbounded promise: an occluded view
        // can suspend rAF. After semantic readiness, two frames allow its last
        // React/style commit to paint. Never alter styles or reactivate the app.
        let marker = "__wkFrame" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        _ = try await js("window[\(quote(marker))]=false;requestAnimationFrame(()=>requestAnimationFrame(()=>window[\(quote(marker))]=true));return true;")
        let end = Date().addingTimeInterval(1)
        var frame = false
        repeat {
            frame = (try await js("return window[\(quote(marker))];")) as? Bool == true
            if frame { break }
            try await Task.sleep(nanoseconds: 50_000_000)
        } while Date() < end
        if let target {
            readiness = try await captureReadiness(target)
            ready = ready && readiness["ready"] as? Bool == true
        }
        let diagnostic = try await js("""
        return {visibility:document.visibilityState, timeline:document.timeline.currentTime,
          loadingConversation:!!document.querySelector('[aria-label="Loading conversation"]'),
          animations:document.getAnimations().map(a=>({time:a.currentTime,state:a.playState})),
          table:[...document.querySelectorAll('table')].map(e=>({width:e.getBoundingClientRect().width,
            ancestors:[e,e.parentElement,e.parentElement.parentElement].map(n=>({opacity:getComputedStyle(n).opacity,visibility:getComputedStyle(n).visibility}))}))};
        """) as! [String: Any]
        paintDiagnostics[name] = ["animation_frame_observed": frame, "document": diagnostic,
            "readiness": readiness, "semantic_ready": ready,
            "initial_readiness": initialReadiness, "readiness_elapsed_ms": Date().timeIntervalSince(started) * 1000,
            "window_visible": app.window.isVisible,
            "window_occlusion_visible": app.window.occlusionState.contains(.visible)]
        let painting = ready && frame && diagnostic["loadingConversation"] as? Bool == false &&
            diagnostic["visibility"] as? String == "visible" && app.window.isVisible &&
            app.window.occlusionState.contains(.visible)
        if target != nil && !painting {
            checks["visible-paint"] = ["status": "unavailable", "detail": "Requested content is not ready/visible or lacks a fresh frame; inspect capture readiness and retained PNG"]
        }
        record(["paint_diagnostics": paintDiagnostics, "checks": checks])
        let configuration = WKSnapshotConfiguration()
        configuration.afterScreenUpdates = true
        let image = try await app.webView.takeSnapshot(configuration: configuration)
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else {
            throw PreviewError.message("Unable to encode WKWebView snapshot")
        }
        try png.write(to: output.appendingPathComponent("\(scenario)-\(name)"))
        var capture = paintDiagnostics[name] as! [String: Any]
        capture["png_sha256"] = SHA256.hash(data: png).map { String(format: "%02x", $0) }.joined()
        if let target {
            let after = try await captureReadiness(target)
            capture["after_snapshot_readiness"] = after
            ready = ready && after["ready"] as? Bool == true
        }
        if let target, case let .rich(_, markdown) = target {
            let before = readiness["message_identity"] as? NSDictionary
            let after = (capture["after_snapshot_readiness"] as? [String: Any])?["message_identity"] as? NSDictionary
            ready = ready && before != nil && after != nil && before!.isEqual(after!)
            let file = Bundle.main.resourceURL!.appendingPathComponent("workspace-build.json")
            guard let source = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any],
                  source["source_status"] as? String == "" else {
                throw PreviewError.message("Missing clean exact-source rich fixture identity")
            }
            capture["source_identity"] = ["source_head": source["source_head"]!,
                "engine_sha256": source["engine_sha256"]!, "native_sha256": source["native_sha256"]!]
            capture["expected_answer_sha256"] = SHA256.hash(data: Data(markdown.utf8)).map { String(format: "%02x", $0) }.joined()
            for (key, observation) in [("before", readiness), ("after", capture["after_snapshot_readiness"] as? [String: Any] ?? [:])] {
                guard let answer = observation["full_answer"] as? String, answer == markdown else {
                    throw PreviewError.message("Owned settled answer changed around rich capture")
                }
                capture["settled_answer_sha256_" + key] = SHA256.hash(data: Data(answer.utf8)).map { String(format: "%02x", $0) }.joined()
            }
            capture["png_width"] = bitmap.pixelsWide
            capture["png_height"] = bitmap.pixelsHigh
        }
        capture["semantic_ready"] = ready
        let afterSurface = app.window.isVisible && app.window.occlusionState.contains(.visible)
        capture["window_visible_after_snapshot"] = afterSurface
        paintDiagnostics[name] = capture
        if target != nil && (!ready || !afterSurface) {
            checks["visible-paint"] = ["status": "unavailable", "detail": "Semantic capture readiness did not hold; original diagnostic PNG retained"]
        }
        record(["paint_diagnostics": paintDiagnostics, "checks": checks])
        if target != nil && (!ready || !painting || !afterSurface) {
            throw PreviewError.message("Capture \(name) did not reach and retain requested visible content")
        }
        if target != nil {
            if checks["visible-paint"] == nil {
                checks["visible-paint"] = ["status": "pass", "detail": "Fresh frame, retained PNG and requested content/identity checks completed; inspect retained PNGs"]
            }
            targetedCaptureCompleted = true
            record(["paint_diagnostics": paintDiagnostics, "checks": checks])
        }
    }
}
#endif
