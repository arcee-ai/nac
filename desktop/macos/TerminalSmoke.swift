#if PREVIEW_SMOKE && TERMINAL_SMOKE
import AppKit
import WebKit

enum TerminalEvidenceUnavailable: Error { case display(String) }

/// Actual system WKWebView characterization, explicitly separate from trusted
/// OS-input acceptance. Uses only the existing preview's isolated engine/UI.
@MainActor
final class TerminalSmoke: NSObject {
    let app: PreviewApp
    let scenario: String
    let output: URL
    let record: ([String: Any]) -> Void
    var checks: [String: [String: Any]] = [:]
    var sessionID = ""
    var terminalID = ""
    var lockedPaintUnavailable = false
    var manualFinished = false

    init(app: PreviewApp, scenario: String, output: URL, record: @escaping ([String: Any]) -> Void) {
        self.app = app
        self.scenario = scenario
        self.output = output.deletingLastPathComponent()
        self.record = record
        super.init()
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
        let launch = prior?.launchDate
        defer {
            // PreviewApp activates this owned fixture once. Restore only while
            // it still owns focus; never override a newer user choice.
            if NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid(),
               let prior, !prior.isTerminated, prior.bundleIdentifier == priorBundle,
               prior.launchDate == launch, prior.bundleIdentifier != "com.apple.loginwindow",
               prior.processIdentifier != getpid() {
                record(["prior_focus_restored": prior.activate(options: [])])
            }
        }
        guard ["terminal-output", "terminal-renderer-failure", "terminal-manual"].contains(scenario) else {
            throw PreviewError.message("Unknown terminal scenario")
        }
        record(["interaction_method": "scripted production UI; owned bashrc output in actual system WKWebView",
                "trusted_keyboard": "unavailable", "real_ime": "unavailable", "edit_menu_paste": "unavailable"])
        try await waitJS("production Create chat", "return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Create chat'&&!b.disabled);", timeout: 60)
        guard let profile = app.profile else { throw PreviewError.message("Missing isolated profile") }
        try Data((TerminalFixture.bashrc + "\n").utf8).write(to: profile.root.appendingPathComponent("home/.bashrc"))
        try await button("Create chat")
        try await waitJS("created direct session", "return location.hash.includes('/session/') && !!document.querySelector('[aria-label=Message]');")
        sessionID = try await js("return location.hash.split('/')[2];") as! String
        try await require("Expected direct fixture", "return (await (await fetch('/sessions/'+location.hash.split('/')[2])).json()).metadata.behavior==='direct';")
        _ = try await js(TerminalFixture.observer)
        try await navigate("terminal")
        if try await js("return !!document.querySelector('button[aria-label=\"Show panel\"]');") as? Bool == true {
            try await button("Show panel")
        }
        try await button("New shell")
        try await waitJS("connected shell", "return document.body.innerText.includes('Connected') && !!document.querySelector('.xterm-helper-textarea');")
        let terminals = try await js("return (await (await fetch('/sessions/'+location.hash.split('/')[2]+'/user-terminals')).json()).terminals;") as! [[String: Any]]
        guard terminals.count == 1, let id = terminals[0]["terminal_id"] as? String else {
            throw PreviewError.message("Expected exactly one owned shell")
        }
        terminalID = id
        // A successful production ACK must precede each continuation. Thus the
        // split UTF-8/CSI prefixes crossed real HTTP frames and xterm callbacks,
        // instead of merely separate stdout writes coalesced before attach.
        try await acknowledged("WK-UTF8-SPLIT-READY")
        try trigger("unicode-continue")
        try await acknowledged("WK-CSI-SPLIT-READY")
        try trigger("csi-continue")
        checks["partial-frame-parser-completion"] = ["status": "pass",
            "detail": "Actual WK xterm parser-complete ACKs released fixture-held UTF-8 and CSI continuations; no input API or synthetic authority involved"]
        record(["session_id": sessionID, "terminal_id": terminalID,
                "user_agent": try await js("return navigator.userAgent;"),
                "embedded_assets": try await js(#"""
                const urls=[...new Set(performance.getEntriesByType('resource').map(e=>e.name))]
                  .filter(u=>u.includes('/assets/dist/') && /\.(js|css)$/.test(u));
                return await Promise.all(urls.map(async url=>{
                  const response=await fetch(url); if(!response.ok) throw Error('Asset probe failed');
                  const bytes=await response.arrayBuffer();
                  const digest=await crypto.subtle.digest('SHA-256',bytes);
                  return {path:new URL(url).pathname,sha256:[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')};
                }));
                """#),
                "surface": ["visible": app.window.isVisible, "key": app.window.isKeyWindow,
                            "occlusion_visible": app.window.occlusionState.contains(.visible),
                            "window_frame": NSStringFromRect(app.window.frame),
                            "screen_frame": app.window.screen.map { NSStringFromRect($0.frame) } ?? "unavailable",
                            "backing_scale": app.window.backingScaleFactor]])
        // Measure painting before any assertion that needs a refreshed current
        // screen. A held partial prefix can be the last accessibility update
        // on a locked WebView even while parser callbacks/ACKs keep completing.
        try await snapshot("before-output-assertions")
        if scenario == "terminal-output" { try await outputJourney() }
        else if scenario == "terminal-manual" { try await manualJourney() }
        else { try await rendererFailure() }
        record(["checks": checks])
        if checks.values.contains(where: { $0["status"] as? String == "fail" }) {
            throw PreviewError.message("Terminal characterization failed; see checks")
        }
    }

    @objc func finishManualCapture(_ sender: Any?) { manualFinished = true }

    func check(_ id: String, _ operation: () async throws -> String) async {
        do { checks[id] = ["status": "pass", "detail": try await operation()] }
        catch TerminalEvidenceUnavailable.display(let detail) {
            checks[id] = ["status": "unavailable", "detail": detail]
        } catch {
            checks[id] = ["status": "fail", "detail": String(describing: error)]
            if let dom = try? await js("return document.body.innerText.slice(-8000);") { checks[id]?["dom"] = dom }
        }
        record(["checks": checks])
    }

    func js(_ source: String) async throws -> Any {
        try await app.webView.callAsyncJavaScript(source, arguments: [:], in: nil, contentWorld: .page) ?? NSNull()
    }

    func quote(_ value: String) -> String {
        let data = try! JSONSerialization.data(withJSONObject: [value])
        return String(decoding: data, as: UTF8.self).dropFirst().dropLast().description
    }

    func waitJS(_ label: String, _ source: String, timeout: TimeInterval = 25) async throws {
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

    func button(_ name: String) async throws {
        let predicate = "b=>(b.getAttribute('aria-label')||b.textContent.trim())===\(quote(name))&&!b.disabled&&b.getClientRects().length&&!b.closest('[inert]')"
        try await waitJS("button \(name)", "return [...document.querySelectorAll('button')].some(\(predicate));")
        _ = try await js("const b=[...document.querySelectorAll('button')].find(\(predicate));b.focus();b.click();return true;")
    }

    func navigate(_ panel: String) async throws {
        _ = try await js("location.hash='/session/'+\(quote(sessionID))+'/'+\(quote(panel));return true;")
        try await waitJS("route \(panel)", "return location.hash.endsWith('/'+\(quote(panel))) && !!document.querySelector('[aria-label=Message]');")
    }

    func screen(_ marker: String) async throws {
        // The public current-screen accessibility mirror is parser evidence.
        // xterm's historical live region and snapshots are not screen receipts.
        let predicate = "return document.querySelector('.xterm-accessibility-tree')?.textContent.includes(\(quote(marker)));"
        if try await js(predicate) as? Bool == true { return }
        try requirePainting("Current accessible screen \(marker)")
        try await waitJS("current accessible screen \(marker)", predicate, timeout: 15)
    }

    func acknowledged(_ marker: String) async throws {
        try await waitJS("parser-complete acknowledged marker \(marker)",
                        "return __terminal352.markerReceipts[\(quote(marker))]?.acknowledged===true;", timeout: 25)
    }

    func requirePainting(_ operation: String) throws {
        if lockedPaintUnavailable {
            throw TerminalEvidenceUnavailable.display("\(operation): locked console, occluded owned window and no fresh animation frame; protocol receipt is recorded separately, current display remains unqualified")
        }
    }

    func trigger(_ name: String) throws {
        guard let profile = app.profile else { throw PreviewError.message("Lost fixture profile") }
        try Data().write(to: profile.workspace.appendingPathComponent("wk-\(name)"))
    }

    func snapshot(_ name: String) async throws {
        _ = try await js("window.__terminalFrame352=false;requestAnimationFrame(()=>window.__terminalFrame352=true);return true;")
        let end = Date().addingTimeInterval(1)
        var painted = false
        repeat {
            painted = try await js("return window.__terminalFrame352;") as? Bool == true
            if painted { break }
            try await Task.sleep(nanoseconds: 50_000_000)
        } while Date() < end
        record(["paint_\(name)": ["animation_frame": painted,
                "occlusion_visible": app.window.occlusionState.contains(.visible),
                "visible_acceptance": painted && app.window.occlusionState.contains(.visible)]])
        lockedPaintUnavailable = CommandLine.arguments.contains("--workspace-console-locked") &&
            !painted && !app.window.occlusionState.contains(.visible)
        // Diagnostic snapshots can be blank while locked. Their existence is
        // never promoted to visible-paint or trusted-input acceptance.
        let image = try await app.webView.takeSnapshot(configuration: nil)
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else {
            throw PreviewError.message("WK snapshot encoding failed")
        }
        try png.write(to: output.appendingPathComponent("\(scenario)-\(name).png"))
    }
}
#endif
