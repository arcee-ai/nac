// Headless launch/failure seam. Engine, UI, readiness and retirement are inert.
import Foundation
private struct EngineLaunchConfiguration: Equatable { let store: URL }
private struct LaunchIdentity { let track = "dev" }
private final class Button { var isHidden = true; var isEnabled = false }
private final class Status { var stringValue = "" }
@MainActor private final class Engine {
    var pid: Int32 = 101
    var receipt: Bool? = true
    var stops = 0
    func stop(completion: @escaping () -> Void) { stops += 1; pid = 0; receipt = nil; completion() }
}
@MainActor private final class Quit {
    let lifecycle = AppLifecycle()
    var launch: UUID? { lifecycle.launch }
    func childExited(_ launch: UUID) { lifecycle.childExited(launch) }
}
@MainActor private final class Retirement { func wait() async throws { try Task.checkCancellation() } }
@MainActor private final class App {
    let engine = Engine(), quit = Quit(), status = Status()
    var stopping = false
    var failure: String?
    var baseURL: URL? = URL(string: "http://127.0.0.1:43123")
    var launchConfiguration: EngineLaunchConfiguration? = .init(store: URL(fileURLWithPath: "/fixture-only/store.db"))
    var launchIdentity: LaunchIdentity? = .init()
    let storeConflictRetry = StoreConflictRetry()
    var storeRetryButton: Button? = Button()
    var recovery: Recovery!
    var starts = 0
    var fatalFailures = 0
    var selectedConfigurations: [EngineLaunchConfiguration] = []
    // APP_ADMISSION
    // APP_RESTART
    // APP_FAILURE
    // start is deliberately an asynchronous launch adapter: readiness/failure
    // arrives after it returns, matching the real launch owner's callback seam.
    func start(retryConfiguration: EngineLaunchConfiguration) async {
        guard quit.lifecycle.beginLaunch() != nil else { fatalError("Overlapping fixture launch") }
        starts += 1
        selectedConfigurations.append(retryConfiguration)
        engine.pid = Int32(101 + starts)
        engine.receipt = nil
    }
    func fail(_ message: String) { fatalFailures += 1; failure = message; recovery.cancelPending() }
    func emitFailure(_ reason: EngineFailure) { engineFailed(reason) }
    func beginWorkspaceRetirement() -> Retirement { Retirement() }
    func showShutdownStatus(_ message: String) { status.stringValue = message }
}
@MainActor private final class Recovery {
    private unowned let app: App
    private var generation = 0
    private var task: Task<Void, Never>?
    private var closed = false
    private var sleeping = false
    private var busy = false
    private var needsRecovery = false
    private var restartAttempts = 0
    private var reloadAttempts = 0
    private(set) var engineStateLost = false
    private var reload: Button? = Button()
    private var restart: Button? = Button()
    init(_ app: App) { self.app = app }
    private func rememberRoute() {}
    private func cancelConfirmation() {}
    // RECOVERY_METHODS
    // ACTUAL_SMOKE_RESTART
    func cancelPending() { generation += 1; task?.cancel(); task = nil; busy = false; hideActions() }
    func settle() async { await task?.value }
    var attempts: Int { restartAttempts }
    var restartEnabled: Bool { restart?.isHidden == false && restart?.isEnabled == true }
}
@main private enum Cases {
    @MainActor static func require(_ value: @autoclosure () -> Bool, _ message: String) {
        guard value() else { fputs("FAIL: " + message + "\n", stderr); exit(1) }
    }
    @MainActor static func fixture() -> (App, Recovery) {
        let app = App(); let owner = Recovery(app); app.recovery = owner
        _ = app.quit.lifecycle.beginLaunch()
        return (app, owner)
    }
    @MainActor static func main() async {
        let scenario = CommandLine.arguments.last!
        let (app, owner) = fixture()
        if scenario == "first-start" || scenario == "first-store-conflict" {
            app.baseURL = nil
            app.emitFailure(scenario == "first-store-conflict" ? .storeOwned : .message("First launch failed"))
            require(app.failure != nil && app.fatalFailures == 1, "Initial failure must preserve startup handling")
            require(owner.attempts == 0, "First start cannot spend recovery attempts")
            if scenario == "first-store-conflict" {
                require(app.storeConflictRetry.canRetry && app.storeRetryButton?.isEnabled == true,
                        "First-start conflict retains genuine-child retirement and explicit Retry")
                require(app.status.stringValue.contains("/fixture-only/store.db"), "Conflict keeps canonical store guidance")
            }
            print("PASS \(scenario): original initial-start behavior retained")
            return
        }
        let pinned = app.launchConfiguration!
        owner.smokeRestart(); await owner.settle()
        require(app.starts == 1 && owner.attempts == 1 && app.baseURL == nil,
                "Actual restart owner must return before replacement readiness")
        require(app.failure == nil && owner.engineStateLost, "Actual performRestart owns established recovery state")
        if scenario == "stop-late-failure" {
            app.stopping = true
            app.emitFailure(.message("Late failure after Stop")); await owner.settle()
            require(app.failure == nil && app.fatalFailures == 0 && owner.attempts == 1,
                    "Late failure cannot override Stop or spend another attempt")
            print("PASS \(scenario): Stop fence retained")
            return
        }
        var confirmation: AppLifecycle.Confirmation?
        if scenario == "quit-cancel" {
            if case .confirm(let value) = app.quit.lifecycle.requestQuit(activity: .init()) { confirmation = value }
            require(confirmation != nil, "Quit confirmation must be owned")
        }
        let reason: EngineFailure = scenario == "restart-store-conflict" ? .storeOwned : .message(scenario)
        app.emitFailure(reason); await owner.settle()
        require(app.failure == nil && app.fatalFailures == 0, "Replacement launch failure must remain recoverable")
        require(owner.restartEnabled && owner.attempts == 1,
                "One failed launch must leave the second explicit restart available")
        if let confirmation {
            owner.smokeRestart(); await owner.settle()
            require(app.starts == 1 && owner.attempts == 1, "Quit confirmation cannot admit a restart")
            _ = app.quit.lifecycle.answer(confirmation, stop: false)
        }
        owner.smokeRestart(); await owner.settle()
        require(app.starts == 2 && owner.attempts == 2, "Remaining explicit restart must be admitted once")
        require(app.selectedConfigurations == [pinned, pinned], "Retries retain exact selected launch configuration")
        if scenario == "ready-then-loss" { app.baseURL = URL(string: "http://127.0.0.1:43124"); app.engine.receipt = true }
        app.emitFailure(.message("Second launch failure")); await owner.settle()
        require(app.failure == nil && !owner.restartEnabled && owner.attempts == 2,
                "Second failure must preserve the original two-attempt bound")
        owner.smokeRestart(); await owner.settle()
        require(app.starts == 2 && owner.attempts == 2, "No automatic or third restart may occur")
        print("PASS \(scenario): async failure recoverable, exact configuration, two-attempt and Quit bounds retained")
    }
}
