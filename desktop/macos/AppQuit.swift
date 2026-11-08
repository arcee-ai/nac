import AppKit

/// OS-origin Quit can enter the delegate without entering this public method.
/// Fence duplicates using the delegate's transaction, and retain the public-call
/// fence through AppKit's Cancel unwind for a native-origin request.
@objc(NACApplication)
final class NACApplication: NSApplication {
    private var handlingTerminationCall = false

    override func terminate(_ sender: Any?) {
        guard !handlingTerminationCall,
              (delegate as? PreviewApp)?.quit.terminationPending != true else { return }
        handlingTerminationCall = true
        defer { handlingTerminationCall = false }
        super.terminate(sender)
    }
}

/// One originating AppKit termination transaction owns choice and cleanup.
/// The app retires its own document; PreviewEngine alone controls and reaps the child.
@MainActor
final class AppQuit {
    private unowned let app: PreviewApp
    let lifecycle = AppLifecycle()
    private var confirmation: NSAlert?
    private var scheduledWait: AppLifecycle.Wait?
    private(set) var terminationPending = false
    private var terminationReplyScheduled = false
    #if PREVIEW_SMOKE
    private var fixtureStopTimer: Timer?
    private(set) var smokeQuitRequests = 0
    private(set) var smokeConfirmationDecisions = 0
    private(set) var smokeSheetPresentations = 0
    private(set) var smokeCancelChoices = 0
    private(set) var smokeStopCompletions = 0

    /// Legacy startup/instance fixtures explicitly finish by choosing the real
    /// owned Quit sheet. This never ships or answers an agent permission ask.
    func stopFixture() {
        #if ATTENTION_SMOKE
        guard !attentionFixtureCleanup else { return }
        #endif
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
        RunLoop.main.add(timer, forMode: .modalPanel)
        NSApp.terminate(nil)
    }
    #endif

    #if ATTENTION_SMOKE
    private(set) var attentionFixtureCleanup = false
    private(set) var attentionFixtureCleanupTimeouts = 0

    /// Called only by AttentionSmoke's nonce/PID-bound cleanup verb. It takes
    /// over the same stop/reap owner without requesting interactive Quit.
    func cleanupAttentionFixture() {
        guard !attentionFixtureCleanup else { return }
        attentionFixtureCleanup = true
        fixtureStopTimer?.invalidate()
        fixtureStopTimer = nil
        // Preserve an already-attached sheet in place. Do not dismiss/answer
        // it, rekey its window or restore focus. The lifecycle transition makes
        // any old sheet completion inert; queued present callbacks are fenced.
        if let wait = lifecycle.beginAttentionFixtureCleanup() {
            beginStop(wait)
        } else if case .finished = lifecycle.phase {
            finishTermination()
        }
    }
    #endif

    init(app: PreviewApp) { self.app = app }

    var launch: UUID? { lifecycle.launch }
    var canCloseWindow: Bool { lifecycle.canHideWorkspace }
    func beginLaunch() -> UUID? { lifecycle.beginLaunch() }
    func childExited(_ launch: UUID) { lifecycle.childExited(launch) }

    func shouldTerminate() -> NSApplication.TerminateReply {
        #if ATTENTION_SMOKE
        if attentionFixtureCleanup {
            // Cleanup must neither create a transaction nor abandon one that
            // was already pending when its explicit cleanup intent took over.
            if terminationPending { return .terminateLater }
            if case .finished = lifecycle.phase { return .terminateNow }
            return .terminateCancel
        }
        #endif
        #if PREVIEW_SMOKE
        smokeQuitRequests += 1
        #endif
        // Preserve the originating request, including OS session teardown.
        // Native duplicates are fenced before AppKit; any delegate duplicate
        // shares this one outstanding choice/cleanup transaction.
        guard !terminationPending else { return .terminateLater }
        let decision = lifecycle.requestQuit(activity: AppLifecycle.Activity())
        if decision == .terminateNow { return .terminateNow }
        terminationPending = true
        switch decision {
        case .confirm(let episode):
            #if PREVIEW_SMOKE
            smokeConfirmationDecisions += 1
            #endif
            // Let AppKit receive Later before presentation or a matching reply.
            RunLoop.main.perform(inModes: [.common, .modalPanel]) { [weak self] in
                MainActor.assumeIsolated { self?.present(episode) }
            }
        case .stop(let wait): beginStop(wait)
        case .wait(let wait): waitForStop(wait)
        case .pendingConfirmation: break
        case .terminateNow: return .terminateNow
        }
        return .terminateLater
    }

    private func present(_ episode: AppLifecycle.Confirmation) {
        #if ATTENTION_SMOKE
        guard !attentionFixtureCleanup else { return }
        #endif
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
        #if PREVIEW_SMOKE
        smokeSheetPresentations += 1
        #endif
        if window.isMiniaturized { window.deminiaturize(nil) }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        alert.beginSheetModal(for: window) { [weak self, weak alert] response in
            guard let self, self.confirmation === alert else { return }
            self.confirmation = nil
            switch self.lifecycle.answer(episode, stop: response == .alertSecondButtonReturn) {
            case .cancel:
                #if PREVIEW_SMOKE
                self.smokeCancelChoices += 1
                #endif
                self.reply(false)
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
                #if PREVIEW_SMOKE
                self.smokeStopCompletions += 1
                #endif
                // Wait for the complete app callback, including any upper-layer
                // storage barrier. Child exit alone cannot finish this request.
                self.finishTermination()
            case .settledAfterTimeout:
                self.scheduledWait = nil
                #if ATTENTION_SMOKE
                if self.attentionFixtureCleanup {
                    // The original callback has now established real reap;
                    // cleanup intent was never cancelled by a UI wait timeout.
                    self.finishTermination()
                    return
                }
                #endif
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
        let timer = Timer(timeInterval: 26, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.lifecycle.shutdownTimedOut(wait) else { return }
                #if ATTENTION_SMOKE
                if self.attentionFixtureCleanup {
                    self.attentionFixtureCleanupTimeouts += 1
                    fputs("Attention fixture cleanup is still waiting for its original engine owner.\n", stderr)
                    return
                }
                #endif
                self.app.showShutdownStatus("NAC could not finish stopping within the shutdown wait. The workspace has been closed and cannot accept commands. The original engine shutdown is still pending. Quit again to continue waiting.")
                if self.app.window.isMiniaturized { self.app.window.deminiaturize(nil) }
                self.app.window.makeKeyAndOrderFront(nil)
                self.reply(false)
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        RunLoop.main.add(timer, forMode: .modalPanel)
    }

    private func finishTermination() {
        if terminationPending {
            reply(true)
            return
        }
        #if ATTENTION_SMOKE
        if attentionFixtureCleanup {
            // No original interactive transaction exists on this path. Only
            // explicit fixture cleanup after owned reap may request local exit.
            RunLoop.main.perform(inModes: [.common, .modalPanel]) {
                MainActor.assumeIsolated { NSApp.terminate(nil) }
            }
        }
        #endif
    }

    private func reply(_ terminate: Bool) {
        guard terminationPending, !terminationReplyScheduled else { return }
        terminationReplyScheduled = true
        RunLoop.main.perform(inModes: [.common, .modalPanel]) { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.terminationPending else { return }
                // Keep the native-entry fence until AppKit has consumed the
                // reply, including its internal unwind/reentrant callbacks.
                NSApp.reply(toApplicationShouldTerminate: terminate)
                self.terminationPending = false
                self.terminationReplyScheduled = false
                #if ATTENTION_SMOKE
                if !terminate, self.attentionFixtureCleanup,
                   case .finished = self.lifecycle.phase {
                    // Cleanup may finish reentrantly while a previously chosen
                    // false reply is consumed. Preserve that reply, then leave
                    // its modal unwind before requesting the fixture's exit.
                    RunLoop.main.perform(inModes: [.default]) {
                        MainActor.assumeIsolated { NSApp.terminate(nil) }
                    }
                }
                #endif
            }
        }
    }
}
