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
        WorkspaceFixture.externalPath = profile.root.appendingPathComponent("approval.txt").path
        try Data("Owned external fixture for approval\n".utf8).write(to: URL(fileURLWithPath: WorkspaceFixture.externalPath))
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

    enum CaptureTarget {
        case project(id: String, title: String)
        case transcript(id: String, message: String, readOnly: Bool = false, identityText: String? = nil)

        var payload: [String: Any] {
            switch self {
            case let .project(id, title): return ["kind": "project", "id": id, "text": title]
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
    const element = expected.kind === 'project' ?
      [...document.querySelectorAll('[data-item-kind="project"]')].find(e =>
        e.dataset.itemId === expected.id && e.textContent.includes(expected.text)) : findText(expected.text);
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
        guard let value = try await app.webView.callAsyncJavaScript(Self.captureReadinessScript,
            arguments: ["expected": target.payload], in: nil, contentWorld: .page) as? [String: Any] else {
            throw PreviewError.message("Capture readiness returned no observation")
        }
        return value
    }

    func snapshot(_ name: String, expecting target: CaptureTarget? = nil) async throws {
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
