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
    private weak var originalNativeWindow: NSWindow?
    private var pendingMinimization: String?
    private var duplicateDeadline: TimeInterval?

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
        if scenario == "renderer-hidden", seen.contains("renderer-loss") {
            pollRendererFailure()
            return
        }
        if let failure = app.failure, !app.stopping { fail(failure); return }
        // A nested poll cannot dispatch Cancel while the public call is in flight.
        if let deadline = duplicateDeadline {
            if ProcessInfo.processInfo.systemUptime >= deadline {
                duplicateUnknown("Public duplicate did not return before its deadline")
            }
            return
        }
        for name in ["work-ready", "reopened", "confirming", "cancelled"] where take("capture-" + name) {
            Task {
                do { try await capture(name); publish(stage) }
                catch { fail(error.localizedDescription) }
            }
        }
        if stage == "starting", app.baseURL != nil, !app.webView.isHidden, let receipt = app.engine.receipt {
            originalView = app.webView
            originalPID = app.engine.pid
            originalReceipt = receipt
            originalWindow = app.window.windowNumber
            originalNativeWindow = app.window
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
        if scenario == "renderer-hidden", take("renderer-loss") {
            guard stage == "closed", !app.window.isVisible, intact() else {
                fail("Renderer injection requires the intact hidden workspace"); return
            }
            // Deliver the real delegate callback, not a WebKit process crash.
            app.webViewWebContentProcessDidTerminate(app.webView)
            guard app.failure != nil, sameEngine(), !app.stopping,
                  app.commands.smokeSnapshot["installed"] as? Bool == false else {
                fail("Hidden renderer failure stopped the owned engine"); return
            }
            evidence["renderer_callback_injected"] = true
            evidence["renderer_retained_engine"] = true
            evidence["actual_renderer_crash"] = false
            evidence["renderer_failure_status"] = app.lifecycleFailureStatus
            publish("renderer-failed")
            return
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
        pollMinimizedQuit()
        guard stage != "failed" else { return }
        for command in ["quit", "quit-again", "duplicate-quit"] where take(command) {
            if command == "duplicate-quit" {
                invokeDuplicate()
                guard stage != "failed" else { return }
            } else {
                publish(command + "-requested")
                RunLoop.main.perform(inModes: [.common]) { [weak self] in
                    MainActor.assumeIsolated {
                        guard let self else { return }
                        withExtendedLifetime(self) { NSApp.terminate(nil) }
                    }
                }
            }
        }
        if case .confirming = app.quit.lifecycle.phase, let sheet = app.window.attachedSheet {
            if stage.hasSuffix("-requested") || stage == "minimize-quit-ready" || stage == "minimize-quit-again-ready" {
                guard recordRestoredQuit(sheet, command: seen.contains("quit-again") ? "minimize-quit-again" : "minimize-quit") else { return }
                evidence["confirmation_retained_owners"] = true
                publish(seen.contains("quit-again") ? "reconfirming" : "confirming")
            }
            if seen.contains("duplicate-quit"), !seen.contains("cancel"),
               (evidence["native_duplicate_invocation"] as? [String: Any])?["outcome"] as? String == "settled",
               stage != "duplicate-confirming" { publish("duplicate-confirming") }
            if take("cancel") {
                if seen.contains("duplicate-quit") {
                    guard var invocation = evidence["native_duplicate_invocation"] as? [String: Any],
                          invocation["outcome"] as? String == "settled" else {
                        duplicateUnknown("Cancel stopped before an unsettled duplicate"); return
                    }
                    invocation["cancel_dispatched_uptime"] = ProcessInfo.processInfo.systemUptime
                    evidence["native_duplicate_invocation"] = invocation
                    publish(stage)
                }
                app.window.endSheet(sheet, returnCode: .alertFirstButtonReturn)
            }
            if take("stop") { app.window.endSheet(sheet, returnCode: .alertSecondButtonReturn) }
        }
        if seen.contains("cancel"), !seen.contains("quit-again"), app.quit.lifecycle.phase == .running,
           !app.quit.terminationPending, evidence["cancel_retained_owners"] as? Bool != true {
            guard intact(), app.window.attachedSheet == nil else { fail("Cancel changed workspace ownership"); return }
            evidence["cancel_after_minimized_quit"] = quitWindowObservation()
            evidence["cancel_retained_owners"] = true
            publish("cancelled")
        }
    }

    // BEGIN MINIMIZED QUIT JOURNEY (compiled with inert native boundaries)
    private func quitWindowObservation() -> [String: Any] {
        let window = app.window!
        var confirmation = ""
        if case .confirming(let episode) = app.quit.lifecycle.phase { confirmation = episode.id.uuidString }
        return ["window_number": window.windowNumber,
            "document": app.webView.map { String(describing: ObjectIdentifier($0)) } ?? "",
            "engine_pid": app.engine.pid, "launch_incarnation": app.engine.receipt?.incarnation ?? "",
            "miniaturized": window.isMiniaturized, "visible": window.isVisible,
            "front": NSApp.isActive && (window.isKeyWindow || window.attachedSheet?.isKeyWindow == true),
            "sheet_window": window.attachedSheet?.windowNumber ?? 0,
            "confirmation_id": confirmation, "termination_pending": app.quit.terminationPending,
            "owners_intact": intact(), "stop_started": app.stopping,
            "observed_uptime": ProcessInfo.processInfo.systemUptime]
    }

    private func pollMinimizedQuit() {
        for command in ["minimize-quit", "minimize-quit-again"] where take(command) {
            let expected = command == "minimize-quit" ? "reopened" : "cancelled"
            guard stage == expected, intact(), app.window === originalNativeWindow,
                  NSApp.isActive, app.window.isKeyWindow, !app.window.isMiniaturized,
                  app.window.attachedSheet == nil, !app.quit.terminationPending else {
                fail("Minimization lost its owned active workspace"); return
            }
            pendingMinimization = command
            app.window.miniaturize(nil)
        }
        // Poll the actual property; issuing miniaturize is not an observation.
        // No new timeout/RunLoop or cleanup block: the existing driver bounds waits.
        if let command = pendingMinimization, app.window.isMiniaturized {
            guard intact(), app.window === originalNativeWindow else {
                fail("Minimization replaced the owned workspace"); return
            }
            evidence[command] = quitWindowObservation()
            pendingMinimization = nil
            publish(command + "-ready")
        }
    }

    private func recordRestoredQuit(_ sheet: NSWindow, command: String) -> Bool {
        guard let before = evidence[command] as? [String: Any], before["miniaturized"] as? Bool == true,
              intact(), app.window === originalNativeWindow, app.window.attachedSheet === sheet else {
            fail("Quit changed its minimized window or attached sheet ownership"); return false
        }
        // Observe readiness on later existing polls if AppKit is still presenting.
        // Never restore/focus here or extend the driver's original stage deadline.
        guard !app.window.isMiniaturized, app.window.isVisible, sheet.isVisible,
              NSApp.isActive, app.window.isKeyWindow || sheet.isKeyWindow else { return false }
        evidence["restored-" + command] = quitWindowObservation()
        return true
    }
    // END MINIMIZED QUIT JOURNEY

    private func sameEngine() -> Bool {
        app.engine.pid == originalPID && originalPID > 0 && app.engine.receipt != nil &&
            app.engine.receipt?.incarnation == originalReceipt?.incarnation &&
            app.engine.receipt?.endpoint == originalReceipt?.endpoint &&
            app.engine.receipt?.store == originalReceipt?.store
    }

    private func pollRendererFailure() {
        guard !app.stopping else { return }
        guard sameEngine() else { fail("Renderer failure did not retain the same engine"); return }
        if stage == "renderer-failed", app.window.isVisible {
            evidence["renderer_status_reopened"] = true
            publish("renderer-reopened")
        }
        for command in ["quit", "quit-again"] where take(command) {
            publish("renderer-quit-requested")
            RunLoop.main.perform(inModes: [.common]) { MainActor.assumeIsolated { NSApp.terminate(nil) } }
        }
        if case .confirming = app.quit.lifecycle.phase, let sheet = app.window.attachedSheet {
            evidence["renderer_confirmation_retained_engine"] = true
            publish("renderer-confirming")
            if take("stop") { app.window.endSheet(sheet, returnCode: .alertSecondButtonReturn) }
        }
    }

    /// Fixture delivery prefix only. The one public action is synchronous so
    /// consuming both control files cannot dispatch Cancel ahead of the call.
    private func invokeDuplicate() {
        let before = duplicateOwners()
        let began = ProcessInfo.processInfo.systemUptime
        let deadline = began + 5
        var invocation: [String: Any] = ["command": "duplicate-quit", "id": UUID().uuidString,
            "issued": true, "prefix": before, "outcome": "pending", "deadline_uptime": deadline]
        evidence["native_duplicate_invocation"] = invocation
        guard before["owners_intact"] as? Bool == true,
              before["stop_started"] as? Bool == false,
              (before["sheet_window"] as? Int ?? -1) > 0,
              before["confirmation_decisions"] as? Int == 1,
              before["sheet_presentations"] as? Int == 1,
              before["cancel_choices"] as? Int == 0,
              before["stop_completions"] as? Int == 0 else {
            duplicateUnknown("Duplicate has no pending original confirmation"); return
        }
        duplicateDeadline = deadline
        defer { duplicateDeadline = nil }
        invocation["began"] = true
        invocation["began_uptime"] = began
        invocation["before"] = before
        evidence["native_duplicate_invocation"] = invocation
        publish(stage) // Best-effort atomic write attempt, not a durable acknowledgement.
        NSApp.terminate(nil)
        let returned = ProcessInfo.processInfo.systemUptime
        let after = duplicateOwners()
        invocation["returned"] = true
        invocation["returned_uptime"] = returned
        invocation["after"] = after
        evidence["native_duplicate_invocation"] = invocation
        evidence["native_duplicate_delegate_before"] = before["delegate_calls"]
        evidence["native_duplicate_delegate_after"] = after["delegate_calls"]
        evidence["native_duplicate_returned"] = true
        var prefixOwners = before, returnedOwners = after
        prefixOwners.removeValue(forKey: "delegate_calls")
        returnedOwners.removeValue(forKey: "delegate_calls")
        guard stage != "failed", returned < deadline,
              NSDictionary(dictionary: prefixOwners).isEqual(to: returnedOwners) else {
            duplicateUnknown("Duplicate result is late or its confirmation/owners changed"); return
        }
        invocation["outcome"] = "settled"
        evidence["native_duplicate_invocation"] = invocation
        publish(stage)
    }

    private func duplicateUnknown(_ reason: String) {
        if var invocation = evidence["native_duplicate_invocation"] as? [String: Any] {
            invocation["outcome"] = "unknown"
            evidence["native_duplicate_invocation"] = invocation
        }
        fail(reason)
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
            app.window === originalNativeWindow && app.window.windowNumber == originalWindow && !app.stopping &&
            app.commands.smokeSnapshot["installed"] as? Bool == true
    }

    /// Read the actual current episode/owners around the public terminate call.
    /// No engine control, permission, replay, or synthetic callback is issued.
    private func duplicateOwners() -> [String: Any] {
        guard case .confirming(let episode) = app.quit.lifecycle.phase else { return [:] }
        let document = app.webView
        return ["confirmation_id": episode.id.uuidString,
                "sheet_window": app.window.attachedSheet?.windowNumber ?? -1,
                "document": document.map { String(describing: ObjectIdentifier($0)) } ?? "",
                "engine_pid": app.engine.pid,
                "launch_incarnation": app.engine.receipt?.incarnation ?? "",
                "owners_intact": intact(), "stop_started": app.stopping,
                "delegate_calls": app.quit.smokeQuitRequests,
                "confirmation_decisions": app.quit.smokeConfirmationDecisions,
                "sheet_presentations": app.quit.smokeSheetPresentations,
                "cancel_choices": app.quit.smokeCancelChoices,
                "stop_completions": app.quit.smokeStopCompletions]
    }

    private func capture(_ name: String) async throws {
        guard let view = app.webView, intact(), app.window.isVisible else {
            throw DesktopStartupError.message("Lifecycle workspace unavailable for capture")
        }
        let image = try await withCheckedThrowingContinuation { (reply: CheckedContinuation<NSImage, Error>) in
            view.takeSnapshot(with: nil) { image, error in
                if let image { reply.resume(returning: image) }
                else { reply.resume(throwing: error ?? DesktopStartupError.message("Lifecycle WK snapshot unavailable")) }
            }
        }
        func write(_ image: NSImage, _ suffix: String) throws {
            guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                  let png = bitmap.representation(using: .png, properties: [:]) else {
                throw DesktopStartupError.message("Lifecycle snapshot encoding failed")
            }
            try png.write(to: output.deletingLastPathComponent().appendingPathComponent(name + suffix + ".png"))
        }
        try write(image, "-workspace")
        if let sheet = app.window.attachedSheet, let content = sheet.contentView {
            guard let bitmap = content.bitmapImageRepForCachingDisplay(in: content.bounds) else {
                throw DesktopStartupError.message("Native Quit sheet snapshot unavailable")
            }
            content.cacheDisplay(in: content.bounds, to: bitmap)
            let native = NSImage(size: content.bounds.size)
            native.addRepresentation(bitmap)
            try write(native, "-sheet")
        }
        var captures = evidence["render_captures"] as? [String] ?? []
        captures.append(name)
        evidence["render_captures"] = captures
        evidence["render_capture_method"] = "actual WK snapshot and owned AppKit view cacheDisplay; pending image review"
    }

    func didStop() {
        timer?.invalidate()
        evidence["document_released"] = originalView == nil && app.webView == nil
        evidence["commands_retired"] = app.commands.smokeSnapshot["installed"] as? Bool == false
        evidence["stopped"] = app.engine.pid == 0 && app.engine.receipt == nil
        if scenario == "renderer-hidden" {
            evidence["passed"] = evidence["document_released"] as? Bool == true &&
                evidence["commands_retired"] as? Bool == true && evidence["stopped"] as? Bool == true &&
                evidence["close_retained_owners"] as? Bool == true &&
                evidence["renderer_retained_engine"] as? Bool == true &&
                evidence["renderer_status_reopened"] as? Bool == true &&
                evidence["renderer_confirmation_retained_engine"] as? Bool == true
            publish("stopped")
            return
        }
        evidence["passed"] = evidence["document_released"] as? Bool == true &&
            evidence["commands_retired"] as? Bool == true && evidence["stopped"] as? Bool == true &&
            evidence["close_retained_owners"] as? Bool == true &&
            evidence["reopen_retained_usable_workspace"] as? Bool == true && evidence["cancel_retained_owners"] as? Bool == true
        publish("stopped")
    }

    func willTerminate() {
        evidence["application_will_terminate"] = true
        evidence["termination_phase"] = String(describing: app.quit.lifecycle.phase)
        publish(stage)
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
            "workspace_window_number": originalWindow,
            "owned_engine_pid": originalPID, "base_url": app.baseURL?.absoluteString ?? "",
            "quit_delegate_requests": app.quit.smokeQuitRequests,
            "quit_confirmation_decisions": app.quit.smokeConfirmationDecisions,
            "quit_sheet_presentations": app.quit.smokeSheetPresentations,
            "quit_cancel_choices": app.quit.smokeCancelChoices,
            "quit_stop_completions": app.quit.smokeStopCompletions,
            "application_class": NSStringFromClass(type(of: NSApp!)),
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
