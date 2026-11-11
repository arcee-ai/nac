import Foundation

// Headless doubles only. test_workspace_recovery.py inserts the exact recovery
// methods and app admission property, and compiles the real AppLifecycle.
// This file is never included in an app source list or native acceptance lane.
@MainActor
private final class Button {
    var isHidden = true
    var isEnabled = false
}

@MainActor
private final class ReadinessBarrier {
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var waiting = false

    func wait() async {
        await withCheckedContinuation { continuation = $0; waiting = true }
    }

    func release() {
        precondition(waiting)
        waiting = false
        continuation?.resume()
        continuation = nil
    }
}

@MainActor
private enum WorkspaceReadiness {
    static var barrier = ReadinessBarrier()
    static func check(_ receipt: EngineReceipt) async throws { await barrier.wait() }
}

@MainActor
private struct Retirement {
    func wait() async throws { try Task.checkCancellation() }
}

@MainActor
private final class Engine {
    var pid: Int32 = 42
    var receipt: EngineReceipt? = EngineReceipt(kind: "ready", version: 1, incarnation: "launch",
        endpoint: "http://127.0.0.1:1234", identity: EngineIdentity(product_version: "test", build_id: "build",
        source_revision: "source", track: "dev"), store: "/fixture/store", schema: 1,
        stage: nil, code: nil, message: nil)
}

@MainActor
private final class Quit {
    let lifecycle = AppLifecycle()
}

@MainActor
private final class App {
    let quit = Quit()
    let engine = Engine()
    var stopping = false
    var failure: String?
    var baseURL: URL? = URL(string: "http://127.0.0.1:1234")
    var launchConfiguration: Bool? = true
    var retired = false
    var status = ""
    var replacements = 0
    // APP_ADMISSION

    func beginWorkspaceRetirement() -> Retirement { retired = true; return Retirement() }
    func showShutdownStatus(_ message: String) { status = message }
    func replaceWorkspace(receipt: EngineReceipt, fragment: String?, initial: Bool = false,
                          requireTerminalAcknowledgement: Bool = false) {
        precondition(requireTerminalAcknowledgement && !initial,
            "Only same-engine recovery reaches this replacement fixture, and must require acknowledgement")
        // Record every owner request, even if it would violate app admission.
        replacements += 1
    }
}

@MainActor
private final class Recovery {
    let app: App
    private var generation = 0
    private var task: Task<Void, Never>?
    private var routeFragment: String?
    private var reloadAttempts = 0
    private var restartAttempts = 0
    private var sleeping = false
    private var closed = false
    private var busy = false
    private var needsRecovery = false
    private var reload: Button? = Button()
    private var restart: Button? = Button()

    init(_ app: App) { self.app = app }
    private func rememberRoute() {}
    private func cancelConfirmation() {}
    // RECOVERY_METHODS

    func begin() { reconnect("Revalidating workspace", automatic: true) }
    func explicitReload() {
        precondition(!busy && app.canRecoverWorkspace && reload?.isHidden == false && reload?.isEnabled == true)
        reconnect("Reading workspace", automatic: false)
    }
    func settle() async { await task?.value }
    var reloadAvailable: Bool { reload?.isHidden == false && reload?.isEnabled == true }
    var isBusy: Bool { busy }
    func supersede() { generation += 1 }
    func cancel() { task?.cancel() }
}

@main
private enum RecoveryOwnerTests {
    @MainActor
    static func main() async throws {
        try await cancelLeavesExplicitReload()
        try await stopCannotInstallReplacement(afterReadiness: false)
        try await stopCannotInstallReplacement(afterReadiness: true)
        for fence in ["generation", "engine", "cancellation"] { try await staleCompletion(fence) }
        print("Verbatim recovery owner: Quit/readiness/Cancel/Reload, Stop and stale completions passed (headless doubles).")
    }

    @MainActor
    private static func pending() async throws -> (App, Recovery, ReadinessBarrier, AppLifecycle.Confirmation) {
        let app = App(), barrier = ReadinessBarrier()
        WorkspaceReadiness.barrier = barrier
        let recovery = Recovery(app)
        recovery.begin()
        for _ in 0..<1000 {
            if barrier.waiting { break }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        precondition(barrier.waiting && app.retired && recovery.isBusy && !recovery.reloadAvailable)
        guard case .confirm(let confirmation) = app.quit.lifecycle.requestQuit(activity: .init()) else {
            preconditionFailure("Unknown activity must enter confirmation")
        }
        precondition(!app.canRecoverWorkspace)
        return (app, recovery, barrier, confirmation)
    }

    @MainActor
    private static func cancelLeavesExplicitReload() async throws {
        let (app, recovery, barrier, confirmation) = try await pending()
        barrier.release()
        await recovery.settle()
        precondition(app.replacements == 0 && !recovery.isBusy && app.retired)
        precondition(app.status.contains("Workspace unavailable"), "Quit must not strand the in-progress status")
        precondition(app.status.contains("Finish the Quit confirmation, then choose Reload Workspace."))
        precondition(recovery.reloadAvailable, "The retired workspace must expose Reload")
        precondition(app.quit.lifecycle.answer(confirmation, stop: false) == .cancel)
        precondition(app.canRecoverWorkspace && recovery.reloadAvailable && app.replacements == 0)

        let retry = ReadinessBarrier()
        WorkspaceReadiness.barrier = retry
        recovery.explicitReload()
        for _ in 0..<1000 {
            if retry.waiting { break }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        precondition(retry.waiting && app.replacements == 0)
        retry.release()
        await recovery.settle()
        precondition(app.replacements == 1 && !recovery.isBusy, "Explicit Reload must remain usable after Cancel")
    }

    @MainActor
    private static func stopCannotInstallReplacement(afterReadiness: Bool) async throws {
        let (app, recovery, barrier, confirmation) = try await pending()
        if afterReadiness { barrier.release(); await recovery.settle() }
        guard case .stop = app.quit.lifecycle.answer(confirmation, stop: true) else { preconditionFailure() }
        app.stopping = true
        if !afterReadiness { barrier.release(); await recovery.settle() }
        precondition(!app.canRecoverWorkspace && app.replacements == 0 && !recovery.isBusy)
    }

    @MainActor
    private static func staleCompletion(_ fence: String) async throws {
        let (app, recovery, barrier, confirmation) = try await pending()
        precondition(app.quit.lifecycle.answer(confirmation, stop: false) == .cancel)
        switch fence {
        case "generation": recovery.supersede()
        case "engine": app.engine.receipt = nil
        default: recovery.cancel()
        }
        barrier.release()
        await recovery.settle()
        precondition(app.replacements == 0 && !recovery.reloadAvailable)
        precondition(!app.status.contains("Workspace unavailable"), "A stale completion changed recovery presentation")
    }
}
