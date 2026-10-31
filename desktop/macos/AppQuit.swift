import AppKit

/// AppKit's asynchronous Quit request and its native confirmation UI. The app
/// retires its own document; PreviewEngine alone controls and reaps the child.
@MainActor
final class AppQuit {
    private unowned let app: PreviewApp
    let lifecycle = AppLifecycle()
    private var confirmation: NSAlert?
    private var scheduledWait: AppLifecycle.Wait?
    private var terminationPending = false
    #if PREVIEW_SMOKE
    private var fixtureStopTimer: Timer?

    /// Legacy startup/instance fixtures explicitly finish by choosing the real
    /// owned Quit sheet. This never ships or answers an agent permission ask.
    func stopFixture() {
        guard fixtureStopTimer == nil else { return }
        let deadline = Date().addingTimeInterval(5)
        let timer = Timer(timeInterval: 0.05, repeats: true) { [weak self] timer in
            MainActor.assumeIsolated {
                guard let self else { timer.invalidate(); return }
                if let alert = self.confirmation, self.app.window.attachedSheet === alert.window,
                   case .confirming = self.lifecycle.phase {
                    timer.invalidate()
                    self.fixtureStopTimer = nil
                    self.app.window.endSheet(alert.window, returnCode: .alertSecondButtonReturn)
                } else if Date() > deadline {
                    timer.invalidate()
                    self.fixtureStopTimer = nil
                    fputs("Fixture could not reach its owned native Quit confirmation.\n", stderr)
                }
            }
        }
        fixtureStopTimer = timer
        RunLoop.main.add(timer, forMode: .common)
        NSApp.terminate(nil)
    }
    #endif

    init(app: PreviewApp) { self.app = app }

    var launch: UUID? { lifecycle.launch }
    var canCloseWindow: Bool { lifecycle.canHideWorkspace }
    func beginLaunch() -> UUID? { lifecycle.beginLaunch() }
    func childExited(_ launch: UUID) { lifecycle.childExited(launch) }

    func shouldTerminate() -> NSApplication.TerminateReply {
        // No complete cross-owner idle projection exists here. Do not infer
        // idle from a parent run: approvals, terminals and uncertain commands
        // remain possible, including while a native startup task is pending.
        let decision = lifecycle.requestQuit(activity: AppLifecycle.Activity())
        if decision == .terminateNow { return .terminateNow }
        terminationPending = true
        switch decision {
        case .confirm(let episode):
            // AppKit must receive terminateLater before the sheet can settle.
            RunLoop.main.perform(inModes: [.common]) { [weak self] in
                MainActor.assumeIsolated { self?.present(episode) }
            }
        case .stop(let wait): beginStop(wait)
        case .wait(let wait): waitForStop(wait)
        case .pendingConfirmation, .terminateNow: break
        }
        return .terminateLater
    }

    private func present(_ episode: AppLifecycle.Confirmation) {
        guard lifecycle.phase == .confirming(episode), confirmation == nil else { return }
        guard let window = app.window else {
            _ = lifecycle.answer(episode, stop: false)
            reply(false)
            return
        }
        let alert = NSAlert()
        let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "NAC"
        alert.messageText = "Quit \(name)?"
        alert.informativeText = "Work may still be running, waiting for approval, or using an open terminal. Some commands may have an unknown outcome. Stop and Quit stops this app’s engine and waits for cleanup. Closing the workspace window keeps work running."
        alert.addButton(withTitle: "Cancel").keyEquivalent = "\r"
        alert.addButton(withTitle: "Stop and Quit").keyEquivalent = ""
        confirmation = alert
        window.makeKeyAndOrderFront(nil)
        alert.beginSheetModal(for: window) { [weak self, weak alert] response in
            guard let self, self.confirmation === alert else { return }
            self.confirmation = nil
            switch self.lifecycle.answer(episode, stop: response == .alertSecondButtonReturn) {
            case .cancel: self.reply(false)
            case .stop(let wait): self.beginStop(wait)
            case .ignored: break
            }
        }
    }

    private func beginStop(_ wait: AppLifecycle.Wait) {
        waitForStop(wait)
        app.beginShutdown { [weak self] in
            guard let self else { return }
            switch self.lifecycle.stopped(wait.stop, ownedChildHasExited: self.app.engine.pid == 0) {
            case .terminate:
                self.scheduledWait = nil
                self.reply(true)
            case .settledAfterTimeout:
                self.scheduledWait = nil
                self.app.showShutdownStatus("NAC has stopped. Quit again to exit the application.")
            case .ignored: break
            }
        }
    }

    private func waitForStop(_ wait: AppLifecycle.Wait) {
        guard scheduledWait != wait else { return }
        scheduledWait = wait
        // Rust's complete-shutdown watchdog is 20 seconds. PreviewEngine owns
        // its existing 23-second fallback. This later UI deadline never kills
        // or resends control and cannot establish cleanup/store release.
        DispatchQueue.main.asyncAfter(deadline: .now() + 26) { [weak self] in
            guard let self, self.lifecycle.shutdownTimedOut(wait) else { return }
            self.app.showShutdownStatus("NAC could not finish stopping within the shutdown wait. The workspace has been closed and cannot accept commands. The original engine shutdown is still pending. Quit again to continue waiting.")
            self.app.window.makeKeyAndOrderFront(nil)
            self.reply(false)
        }
    }

    private func reply(_ terminate: Bool) {
        guard terminationPending else { return }
        terminationPending = false
        NSApp.reply(toApplicationShouldTerminate: terminate)
    }
}
