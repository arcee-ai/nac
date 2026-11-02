// Frozen source comparator for diagnostics-only controls; no native qualification.
// Origin: 24d757734480a56eeeb772d33de8f23a8549719a. Do not update expectations to accept a new shape.
export const originalScriptSHA256 = "056032572114f10b080023c278269c282ca58f6eed1c686a750d09f7a5917913";
export const originalScript = String.raw`    const hash = location.hash;
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
        loadingConversation:loading, permission_request_id:request?.id || null, surfaces};
    }
    if (expected.kind === 'rich') {
      // One freshly created owned fixture, one WK_RICH prompt and one settled
      // exact answer. The public snapshot has ordinals, not durable message IDs.
      const messages = sessionState?.messages || [];
      const index = messages.findIndex(m => m.role === 'assistant' && m.content === expected.markdown);
      const fullAnswer = index >= 0 ? messages[index].content : null;
      const settled = sessionState?.metadata?.session_id === expected.id && !sessionState.active_run &&
        !sessionState.active_compaction && !sessionState.run_failure && !sessionState.transcript_recovery_warning &&
        messages.length === 2 && index === 1 && messages[0].role === 'user' && messages[0].content === 'WK_RICH' &&
        (!sessionState.message_page || sessionState.message_page.start === 0 && sessionState.message_page.total === 2);
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
        viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},fonts_ready:!!fonts,surfaces,
        sentinel_observation:richInspect(sentinel)};
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
      composer, parent, visibility:document.visibilityState, ...observed, identity};`;
export const originalGoalBlock = String.raw`        await check("goals") {
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
`;
export const originalCapturePrefix = String.raw`    func captureReadiness(_ target: CaptureTarget) async throws -> [String: Any] {
        var arguments: [String: Any] = ["expected": target.payload, "permissionState": NSNull(), "sessionState": NSNull()]
        if case let .rich(id, _) = target {
            arguments["sessionState"] = try await js("const r=await fetch('/sessions/' + \(quote(id)),{cache:'no-store'}); if(!r.ok)throw Error('Owned snapshot unavailable'); return await r.json();")
        }
        if case let .approval(id, _, _) = target {
            arguments["permissionState"] = try await js("const r=await fetch('/sessions/' + \(quote(id)) + '/permissions',{cache:'no-store'}); if(!r.ok)throw Error('Permission state unavailable'); return await r.json();")
        }
`;
export const originalSnapshotBlock = String.raw`    func snapshot(_ name: String, expecting target: CaptureTarget? = nil) async throws {
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
        if !painting {
            checks["visible-paint"] = ["status": "unavailable", "detail": "Requested content is not ready/visible or lacks a fresh frame; inspect capture readiness and retained PNG"]
        } else if target != nil && checks["visible-paint"] == nil {
            checks["visible-paint"] = ["status": "pass", "detail": "Fresh animation frame and revealed transcript before native snapshot; inspect retained PNGs"]
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
        if !ready || !afterSurface {
            checks["visible-paint"] = ["status": "unavailable", "detail": "Semantic capture readiness did not hold; original diagnostic PNG retained"]
        }
        record(["paint_diagnostics": paintDiagnostics, "checks": checks])
        if target != nil && (!ready || !painting || !afterSurface) {
            throw PreviewError.message("Capture \(name) did not reach and retain requested visible content")
        }
    }
}
#endif
`;
