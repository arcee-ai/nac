// Headless launch/failure seam. Engine, UI, readiness and retirement are inert.
import Foundation
private struct EngineLaunchConfiguration: Equatable { let store: URL }
private struct LaunchIdentity { let track = "dev" }
private final class Button { var isHidden = true; var isEnabled = false }
private final class Status { var stringValue = "" }
// Inert UI/timer adapters. No AppKit/WK object, wall-clock timeout or process.
private struct NSRect {
    let width: CGFloat
    init(x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) { self.width = width }
    static let zero = Self(x: 0, y: 0, width: 0, height: 0)
}
private struct FixtureAutoresizing: OptionSet {
    let rawValue: Int
    static let width = Self(rawValue: 1), maxYMargin = Self(rawValue: 2)
}
private final class NSTextField {
    let stringValue: String
    var frame = NSRect.zero
    var autoresizingMask: FixtureAutoresizing = []
    init(wrappingLabelWithString value: String) { stringValue = value }
}
private final class ContentView {
    let bounds = NSRect(x: 0, y: 0, width: 800, height: 600)
    var labels: [String] = []
    func addSubview(_ label: NSTextField) { labels.append(label.stringValue) }
}
private final class Window { let contentView: ContentView? = ContentView() }
private struct FixtureDeadline {
    static func now() -> Self { Self() }
    static func + (lhs: Self, rhs: Int) -> Self { lhs }
}
@MainActor private final class FixtureQueue {
    var callbacks: [() -> Void] = []
    func asyncAfter(deadline: FixtureDeadline, execute: @escaping () -> Void) { callbacks.append(execute) }
    func expire() { let pending = callbacks; callbacks = []; pending.forEach { $0() } }
}
@MainActor private enum DispatchQueue { static let main = FixtureQueue() }
@MainActor private final class Engine {
    var pid: Int32 = 101
    var receipt: Bool? = true
    var stops = 0
    var stopCalls = 0
    var holdStop = false
    var onStop: (() -> Void)?
    private var completion: (() -> Void)?
    func stop(completion: @escaping () -> Void) {
        stopCalls += 1
        guard pid > 0 else { completion(); return }
        stops += 1
        receipt = nil // Real EngineRun.stop invalidates its receipt at dispatch.
        onStop?()
        if holdStop { self.completion = completion }
        else { pid = 0; completion() }
    }
    func completeStop() { pid = 0; let done = completion; completion = nil; done?() }
}
@MainActor private final class Quit {
    let lifecycle = AppLifecycle()
    var launch: UUID? { lifecycle.launch }
    func childExited(_ launch: UUID) { lifecycle.childExited(launch) }
}
@MainActor private final class Retirement {
    var held = false
    var fails = false
    private(set) var waiting = false
    private var completion: CheckedContinuation<Void, Never>?
    func wait() async throws {
        try Task.checkCancellation()
        if fails { throw PreviewError.message("The previous workspace is still retiring.") }
        if held { await withCheckedContinuation { completion = $0; waiting = true } }
        try Task.checkCancellation()
    }
    func release() { waiting = false; let done = completion; completion = nil; done?.resume() }
}
@MainActor private final class App {
    let engine = Engine(), quit = Quit(), status = Status(), window = Window()
    let retirement = Retirement()
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
    func beginWorkspaceRetirement() -> Retirement { retirement }
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
    private var notice: NSTextField?
    // LOSS_PRESENTATION
    // LOSS_RECORDING
    private var reload: Button? = Button()
    private var restart: Button? = Button()
    init(_ app: App) { self.app = app }
    private func rememberRoute() {}
    private func cancelConfirmation() {}
    // RECOVERY_METHODS
    // ACTUAL_SMOKE_RESTART
    func cancelPending() { generation += 1; task?.cancel(); task = nil; busy = false; hideActions() }
    func settle() async { await task?.value }
    func supersede() { generation += 1 }
    func work() -> Task<Void, Never>? { task }
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
    @MainActor static func waitUntil(_ condition: () -> Bool) async {
        for _ in 0..<1000 { if condition() { return }; await Task.yield() }
        require(false, "Controlled actual owner never reached its expected suspension")
    }
    @MainActor static func truthfulNotice(_ app: App, _ owner: Recovery, lost: Bool) {
        require(owner.engineStateLost == lost, "Loss must follow actual owned stop/exit, never Restart intent")
        require(owner.noticeHeight == (lost ? 52 : 0), "Loss layout must reflect the real destructive transition")
        owner.showLossNotice()
        require(app.window.contentView!.labels.isEmpty != lost, "Persistent loss notice must match real loss")
    }
    @MainActor static func truth(_ scenario: String, _ app: App, _ owner: Recovery) async {
        if scenario == "truth-real-exit" || scenario == "truth-prior-exit-then-denied" {
            app.engine.pid = 0; app.engine.receipt = nil
            owner.engineExited("Actual owned engine exit"); await owner.settle()
            if scenario == "truth-prior-exit-then-denied" {
                app.retirement.fails = true; owner.smokeRestart(); await owner.settle()
            }
            truthfulNotice(app, owner, lost: true)
        } else if scenario == "truth-retirement-timeout" {
            app.retirement.fails = true
            owner.smokeRestart(); await owner.settle()
            require(app.engine.stops == 0 && app.starts == 0 && app.engine.receipt == true,
                    "Retirement failure cannot stop or replace the old engine")
            truthfulNotice(app, owner, lost: false)
        } else if scenario == "truth-restart-admission" {
            app.launchConfiguration = nil
            do { try await app.restartOwnedEngine(); require(false, "Missing selection must reject") }
            catch {}
            require(app.engine.stops == 0 && app.starts == 0, "Rejected app admission must not dispatch stop")
            truthfulNotice(app, owner, lost: false)
        } else if scenario == "truth-zero-pid" {
            app.engine.pid = 0; app.engine.receipt = nil
            owner.smokeRestart(); await owner.settle()
            require(app.engine.stopCalls == 1 && app.engine.stops == 0 && app.starts == 1,
                    "Zero-PID stop is a no-op, not a destructive transition")
            truthfulNotice(app, owner, lost: false)
        } else if ["truth-quit-before-stop", "truth-cancel-before-stop", "truth-stale-before-stop", "truth-selection-before-stop"].contains(scenario) {
            app.retirement.held = true
            owner.smokeRestart()
            await waitUntil { app.retirement.waiting }
            let work = owner.work()
            var confirmation: AppLifecycle.Confirmation?
            if scenario == "truth-quit-before-stop" {
                if case .confirm(let value) = app.quit.lifecycle.requestQuit(activity: .init()) { confirmation = value }
                require(confirmation != nil, "Quit must own its confirmation")
            } else if scenario == "truth-cancel-before-stop" { owner.cancelPending() }
            else if scenario == "truth-stale-before-stop" { owner.supersede() }
            else { app.launchConfiguration = nil }
            app.retirement.release(); await work?.value
            require(app.engine.stops == 0 && app.starts == 0 && app.engine.receipt == true,
                    "Pre-stop retirement/admission fence must preserve the old engine")
            if let confirmation { _ = app.quit.lifecycle.answer(confirmation, stop: false) }
            truthfulNotice(app, owner, lost: false) // Same-engine reload's actual notice projection.
        } else {
            app.engine.holdStop = true
            var lostAtDispatch = false
            app.engine.onStop = { lostAtDispatch = owner.engineStateLost }
            owner.smokeRestart()
            await waitUntil { app.engine.stops == 1 }
            let work = owner.work()
            require(lostAtDispatch && app.engine.receipt == nil,
                    "Loss must be recorded at owned stop dispatch, before its completion")
            if scenario == "truth-cleanup-timeout" { DispatchQueue.main.expire() }
            else if scenario == "truth-cancel-after-stop" { owner.cancelPending(); app.engine.completeStop() }
            else if scenario == "truth-quit-after-stop" {
                _ = app.quit.lifecycle.requestQuit(activity: .init()); app.engine.completeStop()
            } else if scenario == "truth-stop-after-stop" { app.stopping = true; app.engine.completeStop() }
            else { app.engine.completeStop() }
            await work?.value
            if scenario == "truth-start-failure" { app.emitFailure(.message("Replacement launch failed")); await owner.settle() }
            require(app.engine.stops == 1 && owner.attempts == 1, "One dispatched restart consumes only one attempt")
            if ["truth-cleanup-timeout", "truth-cancel-after-stop", "truth-quit-after-stop", "truth-stop-after-stop"].contains(scenario) {
                require(app.starts == 0, "A retired restart cannot launch a replacement")
            } else { require(app.starts == 1, "Admitted cleanup must start exactly one successor") }
            truthfulNotice(app, owner, lost: true)
            // A late cleanup after timeout/cancel cannot restart or clear loss.
            app.engine.completeStop(); await Task.yield()
            require(owner.engineStateLost, "Late completion cannot undo real loss")
        }
        print("PASS \(scenario): actual stop boundary, truthful persistent notice and existing fences")
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
        if scenario.hasPrefix("truth-") {
            await truth(scenario, app, owner)
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
