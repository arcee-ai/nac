import Foundation

// Headless doubles: no AppKit import, actual sheet, WK view or engine process.
// The Python driver inserts the actual restart callback, loss latch and recovery
// methods, actual app admission/delegate guard, and compiles real AppLifecycle.
@MainActor private final class Button {
    var isHidden = true
    var isEnabled = false
    var keyEquivalent = ""
}
private enum Answer { case alertFirstButtonReturn, alertSecondButtonReturn }
@MainActor private final class Window {
    weak var owner: NSAlert?
    func endSheet(_ window: Window, returnCode: Answer) { window.owner?.answer(returnCode) }
}
@MainActor private final class NSAlert {
    var messageText = ""
    var informativeText = ""
    let window = Window()
    private var completion: ((Answer) -> Void)?
    init() { window.owner = self }
    @discardableResult func addButton(withTitle title: String) -> Button { Button() }
    func beginSheetModal(for window: Window, completionHandler: @escaping (Answer) -> Void) {
        completion = completionHandler
    }
    // Can deliberately deliver a late/duplicate answer to the exact callback.
    func answer(_ value: Answer) { completion?(value) }
}
@MainActor private final class NSWorkspace {
    static let shared = NSWorkspace()
    let notificationCenter = NotificationCenter()
}
@MainActor private final class View {}
private typealias WKWebView = View
@MainActor private final class Barrier {
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var waiting = false
    func wait() async { await withCheckedContinuation { continuation = $0; waiting = true } }
    func release() { precondition(waiting); waiting = false; continuation?.resume(); continuation = nil }
}
@MainActor private enum WorkspaceReadiness {
    static var barrier = Barrier()
    static var calls = 0
    static var fail = false
    static func check(_ receipt: EngineReceipt) async throws {
        calls += 1
        if fail { throw PreviewError.message("Readiness refused") }
        await barrier.wait()
    }
}
@MainActor private final class Retirement {
    var held = false
    func wait() async throws {
        try Task.checkCancellation()
        if held { throw PreviewError.message("The previous workspace is still retiring.") }
    }
}
@MainActor private final class Engine {
    var pid: Int32 = 42
    var receipt: EngineReceipt? = EngineReceipt(kind: "ready", version: 1, incarnation: "launch",
        endpoint: "http://127.0.0.1:1234", identity: EngineIdentity(product_version: "test", build_id: "build",
        source_revision: "source", track: "dev"), store: "/fixture/store", schema: 1,
        stage: nil, code: nil, message: nil)
}
@MainActor private final class Quit { let lifecycle = AppLifecycle() }
@MainActor private final class App {
    let quit = Quit(), engine = Engine(), window = Window()
    var recovery: Recovery!
    var webView: View? = View()
    var stopping = false
    var failure: String?
    var baseURL: URL? = URL(string: "http://127.0.0.1:1234")
    var launchConfiguration: Bool? = true
    var trace: [String] = []
    var status = ""
    var replacements = 0
    var restarts = 0
    var restartFails = false
    let retirement = Retirement()
    // APP_ADMISSION
    // APP_RENDERER_TERMINATION
    func beginWorkspaceRetirement() -> Retirement { trace.append("retire"); webView = nil; return retirement }
    func showShutdownStatus(_ message: String) { status = message }
    func prepareWorkspaceStorage(receipt: EngineReceipt) async throws { try Task.checkCancellation() }
    func replaceWorkspace(receipt: EngineReceipt, fragment: String?, initial: Bool = false,
                          requireTerminalAcknowledgement: Bool = false) {
        precondition(requireTerminalAcknowledgement && !initial,
            "Only same-engine recovery reaches this replacement fixture, and must require acknowledgement")
        replacements += 1
    }
    func restartOwnedEngine() async throws {
        trace.append("restart-owner"); restarts += 1
        if restartFails { throw PreviewError.message("Engine restart refused") }
    }
}
@MainActor private final class Recovery: NSObject {
    private unowned let app: App
    private var generation = 0
    private var task: Task<Void, Never>?
    private var routeFragment: String?
    private var reloadAttempts = 0
    private var restartAttempts = 0
    private var sleeping = false
    private var closed = false
    private var busy = false
    private var needsRecovery = false
    private var engineStateLost = false
    private var observers: [NSObjectProtocol] = []
    private var reload: Button? = Button()
    private var restart: Button? = Button()
    private var restartConfirmation: NSAlert?
    private var restartRendererFailure: (() -> Void)?
    init(_ app: App) { self.app = app }
    private func rememberRoute() {}
    // RECOVERY_METHODS
    func requestRestart() -> NSAlert { restartEngine(nil); return restartConfirmation! }
    func restartAdmitted() -> Bool { restartEngine(nil); return restartConfirmation != nil }
    func settle() async { await task?.value }
    var work: Task<Void, Never>? { task }
    var isBusy: Bool { busy }
    var attempts: Int { restartAttempts }
    var reloadCount: Int { reloadAttempts }
    var reloadAvailable: Bool { reload?.isHidden == false && reload?.isEnabled == true }
    func supersede() { generation += 1 }
    func sleep() { willSleep() }
    func retryReload() { reconnect("Explicit reload", automatic: false) }
}
@main private enum RestartOwnerTests {
    @MainActor static func main() async throws {
        switch CommandLine.arguments.last {
        case "retirement-reload": try await heldRetirementPreservesReload(); return
        case "retirement-restart": try await heldRetirementPreservesRestart(); return
        case "failed-attempt-bounds": await failedAttemptsRemainBounded(); return
        default: break
        }
        for source in ["renderer", "connection"] { try await lossThenCancel(source) }
        healthyCancel()
        try await lossThenConfirm()
        try await staleAndForeignLoss()
        try await ownerTransitions()
        try await quitAfterRestartLoss()
        print("Verbatim Restart owner: renderer/connection Cancel, healthy Cancel, Confirm, stale/foreign/canceled callbacks, engine-exit/sleep/Stop/Quit passed (headless doubles).")
    }
    @MainActor private static func fixture() -> (App, Recovery) {
        let app = App()
        // Constructing the concrete fixture owner keeps app alive for its unowned binding.
        let owner = Recovery(app)
        app.recovery = owner
        WorkspaceReadiness.calls = 0
        WorkspaceReadiness.fail = false
        WorkspaceReadiness.barrier = Barrier()
        return (app, owner)
    }
    @MainActor private static func heldRetirementPreservesReload() async throws {
        let (app, owner) = fixture()
        app.retirement.held = true
        for _ in 0..<4 {
            owner.retryReload(); await owner.settle()
            precondition(owner.reloadCount == 0 && owner.reloadAvailable,
                "Waiting for actual old-view release consumed a reload attempt")
            precondition(app.replacements == 0 && WorkspaceReadiness.calls == 0)
        }
        app.retirement.held = false
        for expected in 1...3 {
            WorkspaceReadiness.barrier = Barrier()
            owner.retryReload()
            try await waitForReadiness()
            WorkspaceReadiness.barrier.release(); await owner.settle()
            precondition(app.replacements == expected && owner.reloadCount == expected)
        }
        owner.retryReload(); await owner.settle()
        precondition(app.replacements == 3 && owner.reloadCount == 3 && !owner.reloadAvailable,
            "Real replacement attempts must retain their bound")
        print("Held retirement: four refused reloads preserve all three actual recovery attempts (headless).")
    }
    @MainActor private static func heldRetirementPreservesRestart() async throws {
        let (app, owner) = fixture()
        app.retirement.held = true
        for _ in 0..<3 {
            owner.requestRestart().answer(.alertSecondButtonReturn); await owner.settle()
            precondition(owner.attempts == 0 && app.restarts == 0,
                "Waiting for actual old-view release consumed a restart attempt")
        }
        app.retirement.held = false
        for expected in 1...2 {
            owner.requestRestart().answer(.alertSecondButtonReturn); await owner.settle()
            precondition(owner.attempts == expected && app.restarts == expected)
        }
        precondition(!owner.restartAdmitted(), "Real engine restart attempts must retain their bound")
        print("Held retirement: three refused restarts preserve both actual engine restart attempts (headless).")
    }
    @MainActor private static func failedAttemptsRemainBounded() async {
        let (app, owner) = fixture()
        WorkspaceReadiness.fail = true
        owner.connectionLost(); await owner.settle()
        precondition(owner.reloadCount == 1 && WorkspaceReadiness.calls == 1)
        owner.connectionLost(); await owner.settle()
        precondition(owner.reloadCount == 1 && WorkspaceReadiness.calls == 1,
            "Automatic readiness failure must retain its one-attempt limit")
        for expected in 2...3 {
            owner.retryReload(); await owner.settle()
            precondition(owner.reloadCount == expected && WorkspaceReadiness.calls == expected)
        }
        owner.retryReload(); await owner.settle()
        precondition(owner.reloadCount == 3 && WorkspaceReadiness.calls == 3 && app.replacements == 0)
        app.restartFails = true
        for expected in 1...2 {
            owner.requestRestart().answer(.alertSecondButtonReturn); await owner.settle()
            precondition(owner.attempts == expected && app.restarts == expected)
        }
        precondition(!owner.restartAdmitted())
        print("Readiness/restart failures still consume the original automatic/explicit attempt bounds (headless).")
    }
    @MainActor private static func waitForReadiness() async throws {
        for _ in 0..<1000 {
            if WorkspaceReadiness.barrier.waiting { return }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        preconditionFailure("Restart Cancel must retain the observed renderer loss")
    }
    @MainActor private static func lossThenCancel(_ source: String) async throws {
        let (app, owner) = fixture(), view = app.webView!
        let sheet = owner.requestRestart()
        if source == "renderer" { app.webViewWebContentProcessDidTerminate(view) }
        else { owner.connectionLost() }
        precondition(owner.isBusy && app.trace.isEmpty && app.restarts == 0 && WorkspaceReadiness.calls == 0)
        sheet.answer(.alertFirstButtonReturn)
        try await waitForReadiness()
        precondition(app.trace == ["retire"] && app.restarts == 0 && app.replacements == 0)
        WorkspaceReadiness.barrier.release()
        await owner.settle()
        precondition(app.replacements == 1 && app.restarts == 0 && owner.attempts == 0 && !owner.isBusy)
        sheet.answer(.alertFirstButtonReturn)
        sheet.answer(.alertSecondButtonReturn)
        precondition(app.replacements == 1 && owner.attempts == 0, "Late sheet answer reused recovery")
    }
    @MainActor private static func healthyCancel() {
        let (app, owner) = fixture(), view = app.webView!
        owner.requestRestart().answer(.alertFirstButtonReturn)
        precondition(app.webView === view && app.trace.isEmpty && app.status.isEmpty && !owner.isBusy)
        precondition(!owner.reloadAvailable && app.restarts == 0 && WorkspaceReadiness.calls == 0)
    }
    @MainActor private static func lossThenConfirm() async throws {
        let (app, owner) = fixture()
        let sheet = owner.requestRestart()
        owner.connectionLost()
        sheet.answer(.alertSecondButtonReturn)
        await owner.settle()
        precondition(app.trace == ["retire", "restart-owner"] && app.restarts == 1 && owner.attempts == 1)
        precondition(WorkspaceReadiness.calls == 0 && app.replacements == 0)
        sheet.answer(.alertSecondButtonReturn)
        precondition(app.restarts == 1 && owner.attempts == 1)
        owner.requestRestart().answer(.alertSecondButtonReturn)
        await owner.settle()
        precondition(app.restarts == 2 && owner.attempts == 2)
        precondition(!owner.restartAdmitted(), "Restart attempt limit was bypassed")
    }
    @MainActor private static func staleAndForeignLoss() async throws {
        do {
            let (app, owner) = fixture()
            let sheet = owner.requestRestart()
            app.webViewWebContentProcessDidTerminate(View())
            sheet.answer(.alertFirstButtonReturn)
            precondition(app.trace.isEmpty && !owner.isBusy, "Foreign WK delegate callback latched loss")
        }
        do {
            let (app, owner) = fixture()
            let sheet = owner.requestRestart()
            let canceled = Task { owner.connectionLost() }
            canceled.cancel(); await canceled.value
            sheet.answer(.alertFirstButtonReturn)
            precondition(app.trace.isEmpty, "Canceled loss callback latched recovery")
        }
        for fence in ["view", "generation", "engine", "document", "cancellation"] {
            let (app, owner) = fixture()
            let old = app.webView! // Keep old view alive to test identity, not merely weak nil.
            let sheet = owner.requestRestart()
            app.webViewWebContentProcessDidTerminate(old)
            switch fence {
            case "view": app.webView = View()
            case "generation": owner.supersede()
            case "engine": app.engine.receipt = nil
            case "document": owner.documentLoaded()
            default: break
            }
            if fence == "cancellation" {
                let canceled = Task { sheet.answer(.alertFirstButtonReturn) }
                canceled.cancel(); await canceled.value
            } else { sheet.answer(.alertFirstButtonReturn) }
            await owner.settle()
            precondition(app.trace.isEmpty && app.replacements == 0 && app.restarts == 0, "Stale loss resumed recovery")
        }
    }
    @MainActor private static func ownerTransitions() async throws {
        for transition in ["exit", "sleep", "stop", "cancel"] {
            let (app, owner) = fixture()
            let sheet = owner.requestRestart()
            owner.connectionLost()
            switch transition {
            case "exit": app.engine.receipt = nil; owner.engineExited("Engine exited")
            case "sleep": owner.sleep()
            case "stop": app.stopping = true; owner.close()
            default: owner.cancelPending()
            }
            await owner.settle()
            let trace = app.trace, status = app.status
            sheet.answer(.alertFirstButtonReturn); sheet.answer(.alertSecondButtonReturn)
            precondition(app.trace == trace && app.status == status && app.restarts == 0 && WorkspaceReadiness.calls == 0)
            precondition(app.replacements == 0)
        }
    }
    @MainActor private static func quitAfterRestartLoss() async throws {
        for stop in [false, true] {
            let (app, owner) = fixture()
            let sheet = owner.requestRestart()
            owner.connectionLost()
            owner.applicationQuitRequested()
            let work = owner.work
            guard case .confirm(let confirmation) = app.quit.lifecycle.requestQuit(activity: .init()) else { preconditionFailure() }
            if stop {
                guard case .stop = app.quit.lifecycle.answer(confirmation, stop: true) else { preconditionFailure() }
                app.stopping = true; owner.close()
            }
            await work?.value
            precondition(app.replacements == 0 && app.restarts == 0)
            if !stop {
                precondition(owner.reloadAvailable && app.status.contains("Finish the Quit confirmation"))
                precondition(app.quit.lifecycle.answer(confirmation, stop: false) == .cancel)
            }
            sheet.answer(.alertSecondButtonReturn)
            precondition(app.restarts == 0 && owner.reloadAvailable == !stop)
        }
    }
}
