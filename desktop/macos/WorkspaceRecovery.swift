import AppKit
import WebKit

/// Native recovery of this app's concrete workspace. PreviewEngine and AppQuit
/// retain all engine supervision, stop, reaping and application-Quit authority.
@MainActor
final class WorkspaceRecovery: NSObject, NSMenuItemValidation {
    private unowned let app: PreviewApp
    private var generation = 0
    private var task: Task<Void, Never>?
    private var observers: [NSObjectProtocol] = []
    private var launch: String?
    private var routeFragment: String?
    private var reloadAttempts = 0
    private var restartAttempts = 0
    private var sleeping = false
    private var closed = false
    private(set) var busy = false
    private(set) var needsRecovery = false
    private var reload: NSButton?
    private var restart: NSButton?
    private var notice: NSTextField?
    private var restartConfirmation: NSAlert?
    private var restartRendererFailure: (() -> Void)?
    private(set) var engineStateLost = false
    var noticeHeight: CGFloat { engineStateLost ? 52 : 0 }
    var restoredFragment: String? { routeFragment }
    var isSuspended: Bool { sleeping }
    var documentGeneration: Int { generation }
    func seedRoute(_ fragment: String) { if routeFragment == nil { routeFragment = fragment } }

    init(app: PreviewApp) { self.app = app }

    func install() {
        let reload = NSButton(title: "Reload Workspace", target: self, action: #selector(reloadWorkspace(_:)))
        reload.frame = NSRect(x: 200, y: 45, width: 180, height: 32)
        let restart = NSButton(title: "Restart Engine…", target: self, action: #selector(restartEngine(_:)))
        restart.frame = NSRect(x: 400, y: 45, width: 180, height: 32)
        for button in [reload, restart] { button.isHidden = true; app.window.contentView!.addSubview(button) }
        self.reload = reload
        self.restart = restart
        let center = NSWorkspace.shared.notificationCenter
        observers.append(center.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.willSleep() }
        })
        observers.append(center.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.didWake() }
        })
        installMenus()
    }

    func installMenus() {
        guard let menu = NSApp.mainMenu?.items.first?.submenu else { return }
        let reload = NSMenuItem(title: "Reload Workspace", action: #selector(reloadWorkspace(_:)), keyEquivalent: "")
        let restart = NSMenuItem(title: "Restart NAC Engine…", action: #selector(restartEngine(_:)), keyEquivalent: "")
        for item in [reload, restart] { item.target = self; menu.insertItem(item, at: max(0, menu.items.count - 1)) }
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        guard !closed, !busy, !sleeping, app.canRecoverWorkspace else { return false }
        return item.action == #selector(reloadWorkspace(_:))
            ? app.baseURL != nil && app.engine.receipt != nil && reloadAttempts < 3
            : app.launchConfiguration != nil && restartAttempts < 2
    }

    func engineReady(_ receipt: EngineReceipt) -> Bool {
        if launch != receipt.incarnation { reloadAttempts = 0; launch = receipt.incarnation }
        if sleeping { return false }
        guard !needsRecovery || app.canRecoverWorkspace else {
            unavailable("Finish the Quit confirmation, then choose Reload Workspace.")
            return false
        }
        needsRecovery = false
        hideActions()
        return true
    }

    private func rememberRoute() {
        if let fragment = app.webView?.url?.fragment { routeFragment = fragment }
    }

    private func next() -> Int {
        cancelConfirmation()
        generation += 1
        task?.cancel()
        task = nil
        busy = true
        needsRecovery = true
        hideActions()
        return generation
    }

    private func current(_ expected: Int) -> Bool {
        !closed && !app.stopping && generation == expected && !Task.isCancelled
    }

    private func sameEngine(_ pinned: EngineReceipt) -> Bool {
        guard let receipt = app.engine.receipt, app.engine.pid > 0 else { return false }
        return receipt.incarnation == pinned.incarnation && receipt.endpoint == pinned.endpoint &&
            receipt.identity == pinned.identity && receipt.store == pinned.store && receipt.schema == pinned.schema
    }

    func rendererFailed(_ message: String) {
        guard !closed, !app.stopping, !sleeping, !Task.isCancelled, app.failure == nil else { return }
        if restartConfirmation != nil {
            // Retain only this observed loss, never an input or operation. The
            // weak view and pinned generation/engine fence its eventual drain.
            let expected = generation, pinned = app.engine.receipt
            restartRendererFailure = { [weak self, weak view = app.webView] in
                guard let self, let view, self.app.webView === view, self.current(expected),
                      let pinned, self.sameEngine(pinned) else { return }
                self.rendererFailed(message)
            }
            return
        }
        guard !busy else { return }
        reconnect(message, automatic: true)
    }

    func connectionLost() { rendererFailed("The workspace connection was lost.") }

    @objc private func reloadWorkspace(_ sender: Any?) {
        guard validateMenuItem(NSMenuItem(title: "", action: #selector(reloadWorkspace(_:)), keyEquivalent: "")) else { return }
        reconnect("Reading the current workspace…", automatic: false)
    }

    private func reconnect(_ message: String, automatic: Bool, wake: Bool = false) {
        guard !closed, !sleeping else { return }
        rememberRoute()
        let pinned = app.engine.receipt
        let permitted = wake || reloadAttempts < (automatic ? 1 : 3)
        let expected = next()
        let retirement = app.beginWorkspaceRetirement()
        app.showShutdownStatus(message + "\n\nWork may still be running. Previous commands and terminal input will not be resent.")
        task = Task { [weak self] in
            guard let self else { return }
            defer { if self.generation == expected { self.busy = false; self.task = nil } }
            do {
                try await retirement.wait()
                guard self.current(expected) else { return }
                guard self.app.canRecoverWorkspace else {
                    throw PreviewError.message("Finish the Quit confirmation, then choose Reload Workspace.")
                }
                guard permitted else { throw PreviewError.message("Automatic reload stopped after one attempt. Choose Reload Workspace explicitly." ) }
                guard let pinned, self.sameEngine(pinned) else {
                    throw PreviewError.message("The original engine is unavailable. Restart it explicitly after its cleanup finishes.")
                }
                guard self.app.baseURL != nil else {
                    throw PreviewError.message("The engine is still starting. Its initial workspace will open after readiness.")
                }
                // Waiting for the old view to release is not an attempt to
                // recover it. Keep failed readiness/replacement work bounded.
                if !wake { self.reloadAttempts += 1 }
                try await WorkspaceReadiness.check(pinned)
                guard self.current(expected), self.sameEngine(pinned) else { return }
                guard self.app.canRecoverWorkspace else {
                    throw PreviewError.message("Finish the Quit confirmation, then choose Reload Workspace.")
                }
                try await self.app.prepareWorkspaceStorage(receipt: pinned)
                guard self.current(expected), self.sameEngine(pinned) else { return }
                guard self.app.canRecoverWorkspace else {
                    throw PreviewError.message("Finish the Quit confirmation, then choose Reload Workspace.")
                }
                self.app.replaceWorkspace(receipt: pinned, fragment: self.routeFragment,
                    requireTerminalAcknowledgement: true)
            } catch {
                if self.current(expected) { self.unavailable(error.localizedDescription) }
            }
        }
    }

    func documentLoaded() {
        restartRendererFailure = nil
        needsRecovery = false
        hideActions()
    }

    /// Called only at the app's stop dispatch for a live owned engine.
    func ownedEngineWillStop() { engineStateLost = true }

    func engineExited(_ message: String) {
        guard !closed, app.failure == nil else { return }
        rememberRoute()
        engineStateLost = true
        let expected = next()
        let retirement = app.beginWorkspaceRetirement()
        app.showShutdownStatus(message + "\n\nPrevious live terminals and their output cannot be restored. Saved chat history remains available.")
        task = Task { [weak self] in
            guard let self else { return }
            defer { if self.generation == expected { self.busy = false; self.task = nil } }
            do { try await retirement.wait() }
            catch { if self.current(expected) { self.app.showShutdownStatus(error.localizedDescription) } }
            if self.current(expected) { self.showActions() }
        }
    }

    @objc private func restartEngine(_ sender: Any?) {
        guard !closed, !busy, !sleeping, app.canRecoverWorkspace,
              restartAttempts < 2, app.launchConfiguration != nil else { return }
        let alert = NSAlert()
        alert.messageText = "Restart NAC's engine?"
        alert.informativeText = "Running work and terminals will stop. Saved chat history will be reloaded. Previous live terminals and their output cannot be restored. Previous commands and input will not be resent."
        alert.addButton(withTitle: "Cancel").keyEquivalent = "\r"
        alert.addButton(withTitle: "Restart Engine").keyEquivalent = ""
        busy = true
        restartConfirmation = alert
        alert.beginSheetModal(for: app.window) { [weak self, weak alert] answer in
            guard let self, self.restartConfirmation === alert else { return }
            self.restartConfirmation = nil
            self.busy = false
            let rendererFailure = self.restartRendererFailure
            self.restartRendererFailure = nil
            if answer == .alertFirstButtonReturn {
                rendererFailure?()
                return
            }
            guard answer == .alertSecondButtonReturn, !self.closed,
                  self.app.canRecoverWorkspace, self.restartAttempts < 2 else { return }
            self.performRestart()
        }
    }

    private func performRestart() {
        rememberRoute()
        let expected = next()
        let retirement = app.beginWorkspaceRetirement()
        app.showShutdownStatus("Restarting the owned NAC engine…\n\nWaiting for its real cleanup. No commands or terminal input will be replayed.")
        task = Task { [weak self] in
            guard let self else { return }
            defer { if self.generation == expected { self.busy = false; self.task = nil } }
            do {
                try await retirement.wait()
                guard self.current(expected) else { return }
                guard self.app.canRecoverWorkspace else {
                    throw PreviewError.message("Finish the Quit confirmation, then choose Reload Workspace.")
                }
                self.restartAttempts += 1
                try await self.app.restartOwnedEngine()
            } catch {
                if self.current(expected) { self.unavailable(error.localizedDescription) }
            }
        }
    }

    private func willSleep() {
        guard !closed, app.failure == nil else { return }
        sleeping = true
        rememberRoute()
        _ = next()
        _ = app.beginWorkspaceRetirement()
        busy = false
        app.showShutdownStatus("The workspace was suspended for sleep. Its engine may continue working. Wake will revalidate the owned engine before reopening controls.")
    }

    private func didWake() {
        guard !closed, app.failure == nil else { return }
        sleeping = false
        reconnect("Revalidating NAC after wake…", automatic: true, wake: true)
    }

    private func unavailable(_ message: String) {
        app.showShutdownStatus("Workspace unavailable\n\n" + message + "\n\nNo prior command or input was resent. Review chat history and command status before taking another action.")
        showActions()
    }

    private func showActions() {
        reload?.isHidden = false
        reload?.isEnabled = !closed && !sleeping && reloadAttempts < 3 && app.engine.receipt != nil
        restart?.isHidden = false
        restart?.isEnabled = !closed && !sleeping && restartAttempts < 2 && app.launchConfiguration != nil
    }

    private func hideActions() { reload?.isHidden = true; restart?.isHidden = true }

    func showLossNotice() {
        guard engineStateLost, notice == nil else { return }
        let label = NSTextField(wrappingLabelWithString: "NAC restarted. Previous live terminals and their output were not restored. Saved chat and command history is available; explicitly create a new terminal if needed.")
        label.frame = NSRect(x: 16, y: 4, width: app.window.contentView!.bounds.width - 32, height: 44)
        label.autoresizingMask = [.width, .maxYMargin]
        app.window.contentView!.addSubview(label)
        notice = label
    }

    func close() {
        guard !closed else { return }
        closed = true
        cancelConfirmation()
        generation += 1
        task?.cancel()
        task = nil
        busy = false
        hideActions()
        for observer in observers { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
        observers.removeAll()
    }

    func cancelPending() {
        cancelConfirmation()
        generation += 1
        task?.cancel()
        task = nil
        busy = false
        hideActions()
    }

    /// Yield only this owner's sheet before AppQuit owns its asynchronous Quit
    /// episode. A late Restart answer cannot race that newer human request.
    func applicationQuitRequested() {
        let rendererFailure = restartRendererFailure
        cancelConfirmation()
        rendererFailure?()
    }

    private func cancelConfirmation() {
        restartRendererFailure = nil
        #if ATTENTION_SMOKE
        if app.quit.attentionFixtureCleanup {
            // close() already fences recovery generation/tasks. Leave an
            // attached recovery sheet in place; its answer cannot restart a
            // closed owner, and dismissing it could change window focus.
            busy = false
            return
        }
        #endif
        guard let alert = restartConfirmation else { return }
        restartConfirmation = nil
        app.window.endSheet(alert.window, returnCode: .alertFirstButtonReturn)
        busy = false
    }

    #if PREVIEW_SMOKE
    var smokeSnapshot: [String: Any] {
        ["generation": generation, "busy": busy, "reload_attempts": reloadAttempts,
         "restart_attempts": restartAttempts, "needs_recovery": needsRecovery,
         "engine_state_lost": engineStateLost, "sleeping": sleeping, "closed": closed]
    }
    func smokeReload() { reloadWorkspace(nil) }
    func smokeRestart() { if !busy && app.canRecoverWorkspace && restartAttempts < 2 { performRestart() } }
    func smokeSleep() { willSleep() }
    func smokeWake() { didWake() }
    func smokeRestartConfirmation() { restartEngine(nil) }
    func smokeAnswerRestart(stop: Bool) {
        guard let alert = restartConfirmation else { return }
        app.window.endSheet(alert.window, returnCode: stop ? .alertSecondButtonReturn : .alertFirstButtonReturn)
    }
    #endif
}
