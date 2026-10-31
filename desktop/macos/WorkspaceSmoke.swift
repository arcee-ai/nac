#if PREVIEW_SMOKE
import AppKit
import WebKit

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

    func button(_ name: String) async throws {
        let predicate = "b => (b.getAttribute('aria-label') || b.textContent.trim()) === \(quote(name)) && !b.disabled && b.getClientRects().length && !b.closest('[inert]')"
        try await waitJS("button \(name)", "return [...document.querySelectorAll('button')].some(\(predicate));")
        _ = try await js("const b=[...document.querySelectorAll('button')].find(\(predicate)); b.focus(); b.click(); return true;")
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

    func snapshot(_ name: String) async throws {
        // Observe a real frame without an unbounded promise: an occluded view
        // can suspend rAF. Never bring it in front of the user's focused app.
        let marker = "__wkFrame" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        _ = try await js("window[\(quote(marker))]=false;requestAnimationFrame(()=>window[\(quote(marker))]=true);return true;")
        let end = Date().addingTimeInterval(1)
        var frame = false
        repeat {
            frame = (try await js("return window[\(quote(marker))];")) as? Bool == true
            if frame { break }
            try await Task.sleep(nanoseconds: 50_000_000)
        } while Date() < end
        let diagnostic = try await js("""
        return {visibility:document.visibilityState, timeline:document.timeline.currentTime,
          loadingConversation:!!document.querySelector('[aria-label="Loading conversation"]'),
          animations:document.getAnimations().map(a=>({time:a.currentTime,state:a.playState})),
          table:[...document.querySelectorAll('table')].map(e=>({width:e.getBoundingClientRect().width,
            ancestors:[e,e.parentElement,e.parentElement.parentElement].map(n=>({opacity:getComputedStyle(n).opacity,visibility:getComputedStyle(n).visibility}))}))};
        """) as! [String: Any]
        paintDiagnostics[name] = ["animation_frame_observed": frame, "document": diagnostic,
            "window_visible": app.window.isVisible,
            "window_occlusion_visible": app.window.occlusionState.contains(.visible)]
        if !frame || diagnostic["loadingConversation"] as? Bool == true {
            checks["visible-paint"] = ["status": "unavailable", "detail": "A native snapshot lacks a fresh animation frame or still has a loading transcript; visual acceptance requires a visible, painting fixture"]
        } else if checks["visible-paint"] == nil {
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
    }
}
#endif
