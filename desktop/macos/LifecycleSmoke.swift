import AppKit
import WebKit

/// Test-only controls of actual LOCAL_APP lifecycle delegates and NSAlert sheet
/// completion. No OS input events; visible paint and trusted input stay separate.
@MainActor
final class LifecycleSmoke {
    private unowned let app: PreviewApp
    private weak var originalView: WKWebView?
    private let output: URL
    private let control: URL
    private let scenario: String
    private var timer: Timer?
    private var seen: Set<String> = []
    private var stage = "starting"
    private var evidence: [String: Any] = [:]
    private var originalPID: Int32 = 0
    private var originalReceipt: EngineReceipt?
    private var originalWindow = 0

    init(app: PreviewApp) {
        self.app = app
        let args = CommandLine.arguments
        func value(_ name: String) -> String { args[args.firstIndex(of: name)! + 1] }
        output = URL(fileURLWithPath: value("--instance-output"))
        control = URL(fileURLWithPath: value("--instance-control"))
        scenario = value("--instance-scenario")
    }

    static func launchArguments(_ args: [String]) -> [String] {
        var result: [String] = [], index = 0
        while index < args.count {
            if args[index].hasPrefix("--instance-") { index += 2 }
            else { result.append(args[index]); index += 1 }
        }
        return result
    }

    func start() {
        publish("starting")
        timer = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
        RunLoop.main.add(timer!, forMode: .common)
    }

    private func poll() {
        if stage == "failed" {
            // Failure diagnostics must not disable exact-owned cleanup.
            if take("quit-again") {
                RunLoop.main.perform(inModes: [.common]) { MainActor.assumeIsolated { NSApp.terminate(nil) } }
            }
            if let sheet = app.window.attachedSheet, take("stop") {
                app.window.endSheet(sheet, returnCode: .alertSecondButtonReturn)
            }
            return
        }
        if let failure = app.failure, !app.stopping { fail(failure); return }
        if stage == "starting", app.baseURL != nil, !app.webView.isHidden, let receipt = app.engine.receipt {
            originalView = app.webView
            originalPID = app.engine.pid
            originalReceipt = receipt
            originalWindow = app.window.windowNumber
            publish("ready")
        }
        if take("prepare") {
            Task {
                do { try await prepare(); publish("work-ready") }
                catch { fail(error.localizedDescription) }
            }
        }
        if take("close") {
            app.window.performClose(nil)
            guard !app.window.isVisible, intact() else { fail("Close retired the workspace"); return }
            evidence["close_retained_owners"] = true
            publish("closed")
        }
        if stage == "closed", app.window.isVisible {
            guard intact() else { fail("Reopen replaced the workspace"); return }
            Task {
                do {
                    let usable = try await js("return !!document.querySelector('[role=combobox][aria-label=Message]');")
                    guard usable as? Bool == true else { throw DesktopStartupError.message("Reopened workspace is unusable") }
                    evidence["reopen_retained_usable_workspace"] = true
                    publish("reopened")
                } catch { fail(error.localizedDescription) }
            }
            stage = "checking-reopen"
        }
        for command in ["quit", "quit-again", "duplicate-quit"] where take(command) {
            if command != "duplicate-quit" { publish(command + "-requested") }
            RunLoop.main.perform(inModes: [.common]) { MainActor.assumeIsolated { NSApp.terminate(nil) } }
        }
        if case .confirming = app.quit.lifecycle.phase, let sheet = app.window.attachedSheet {
            if stage.hasSuffix("-requested") {
                guard intact() else { fail("Confirmation changed workspace ownership"); return }
                evidence["confirmation_retained_owners"] = true
                publish(seen.contains("quit-again") ? "reconfirming" : "confirming")
            }
            if take("cancel") { app.window.endSheet(sheet, returnCode: .alertFirstButtonReturn) }
            if take("stop") { app.window.endSheet(sheet, returnCode: .alertSecondButtonReturn) }
        }
        if seen.contains("cancel"), !seen.contains("quit-again"), app.quit.lifecycle.phase == .running,
           stage != "cancelled" {
            guard intact() else { fail("Cancel changed workspace ownership"); return }
            evidence["cancel_retained_owners"] = true
            publish("cancelled")
        }
    }

    private func prepare() async throws {
        let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: control.appendingPathComponent("fixture.json"))) as! [String: Any]
        let session = fixture[scenario == "approval" ? "approval_session_id" : "session_id"] as! String
        let approval = fixture["approval_session_id"] as! String
        _ = try await app.webView.callAsyncJavaScript(#"""
        location.hash = '#/session/' + encodeURIComponent(session) + '/delegated';
        return true;
        """#, arguments: ["session": session], in: nil, contentWorld: .page)
        _ = try await app.webView.callAsyncJavaScript(#"""
        return await new Promise((resolve, reject) => {
          const stream = new EventSource('/sessions/' + encodeURIComponent(session) + '/events/stream');
          window.__quitLifecycleObserver = stream;
          const timer = setTimeout(() => reject(new Error('Lifecycle observer timeout')), 10000);
          stream.onopen = () => { clearTimeout(timer); resolve(true); };
          stream.onerror = () => { clearTimeout(timer); reject(new Error('Lifecycle observer failed')); };
        });
        """#, arguments: ["session": approval], in: nil, contentWorld: .page)
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline {
            if try await js("return !!document.querySelector('[role=combobox][aria-label=Message]');") as? Bool == true { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw DesktopStartupError.message("Shared workspace did not become usable")
    }

    private func intact() -> Bool {
        app.webView === originalView && app.engine.pid == originalPID && app.engine.receipt != nil &&
            app.engine.receipt?.incarnation == originalReceipt?.incarnation &&
            app.engine.receipt?.endpoint == originalReceipt?.endpoint && app.engine.receipt?.store == originalReceipt?.store &&
            app.window.windowNumber == originalWindow && !app.stopping &&
            app.commands.smokeSnapshot["installed"] as? Bool == true
    }

    func didStop() {
        timer?.invalidate()
        evidence["document_released"] = originalView == nil && app.webView == nil
        evidence["commands_retired"] = app.commands.smokeSnapshot["installed"] as? Bool == false
        evidence["stopped"] = app.engine.pid == 0 && app.engine.receipt == nil
        evidence["passed"] = evidence["document_released"] as? Bool == true &&
            evidence["commands_retired"] as? Bool == true && evidence["stopped"] as? Bool == true &&
            evidence["close_retained_owners"] as? Bool == true &&
            evidence["reopen_retained_usable_workspace"] as? Bool == true && evidence["cancel_retained_owners"] as? Bool == true
        publish("stopped")
    }

    private func take(_ command: String) -> Bool {
        !seen.contains(command) && FileManager.default.fileExists(atPath: control.appendingPathComponent(command).path) &&
            seen.insert(command).inserted
    }

    private func js(_ source: String) async throws -> Any {
        try await app.webView.callAsyncJavaScript(source, arguments: [:], in: nil, contentWorld: .page) ?? NSNull()
    }

    private func publish(_ next: String) {
        stage = next
        evidence.merge(["stage": next, "scenario": scenario, "app_pid": getpid(), "engine_pid": app.engine.pid,
            "workspace_window_count": NSApp.windows.filter { $0 === app.window }.count,
            "owned_engine_pid": originalPID, "base_url": app.baseURL?.absoluteString ?? "",
            "visible_paint_acceptance": false, "trusted_input_acceptance": false,
            "instrumentation": "LIFECYCLE_SMOKE", "sheet_completion": "programmatic AppKit, no OS input events"]) { _, new in new }
        if let receipt = app.engine.receipt {
            evidence["launch_incarnation"] = receipt.incarnation
            evidence["ready_store"] = receipt.store
            evidence["ready_source"] = receipt.identity?.source_revision
            evidence["ready_build"] = receipt.identity?.build_id
        }
        if let data = try? JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: output, options: .atomic)
        }
    }

    private func fail(_ message: String) {
        evidence["error"] = message
        publish("failed")
    }
}
