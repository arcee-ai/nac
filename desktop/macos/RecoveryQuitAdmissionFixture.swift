import Foundation

// Headless adapters. Real recovery methods, load(), and the complete replacement
// admission prefix are inserted verbatim; no AppKit/WK/process work is performed.
@MainActor final class RecoveryButton { var isHidden = true; var isEnabled = false }
final class Navigation: NSObject {}
@MainActor final class View {
    var navigationDelegate: AnyObject?, uiDelegate: AnyObject?
    func removeFromSuperview() {}
    func load(_ request: URLRequest) -> Navigation? { Navigation() }
}
struct NativeDocumentBinding {}
@MainActor final class Commands {
    func bind() {}; func retire() {}
    func currentDocument(in view: View) -> NativeDocumentBinding? { nil }
}
// Inert construction adapter required by the verbatim folder-joined load().
// It never displays a panel or invokes a source callback.
@MainActor final class NativePathBridge {
    init(webView: View, receipt: @escaping () -> EngineReceipt?,
         source: @escaping () -> NativeDocumentBinding?) {}
    func retire() {}
}
struct Profile { let digest = "owned-profile" }
@MainActor final class Storage { let profile = Profile() }
@MainActor final class Barrier {
    var waiting = false
    private var continuation: CheckedContinuation<Void, Never>?
    func wait() async { await withCheckedContinuation { continuation = $0; waiting = true } }
    func release() { precondition(waiting); waiting = false; continuation?.resume(); continuation = nil }
}
@MainActor final class Retirement {
    var barrier: Barrier?
    func wait() async throws {
        if let barrier { await barrier.wait() }
        try Task.checkCancellation()
    }
}
@MainActor enum WorkspaceReadiness { static func check(_ receipt: EngineReceipt) async throws {} }
@MainActor final class Engine {
    var pid: Int32 = 42
    var receipt: EngineReceipt? = EngineReceipt(kind: "ready", version: 1, incarnation: "owned-launch",
        endpoint: "http://127.0.0.1:1234", identity: EngineIdentity(product_version: "test", build_id: "build",
        source_revision: "source", track: "dev"), store: "/fixture/store", schema: 1,
        stage: nil, code: nil, message: nil)
}
@MainActor final class Quit { let lifecycle = AppLifecycle() }
@MainActor final class App {
    let quit = Quit(), engine = Engine(), retirement = Retirement()
    lazy var recovery = Recovery(self)
    var webView: View! = View()
    var commands: Commands! = Commands()
    var nativePaths: NativePathBridge?
    var stopping = false
    var failure: String?
    var baseURL: URL? = URL(string: "http://127.0.0.1:1234")
    var launchConfiguration: Bool? = true
    var workspaceStorage: Storage? = Storage()
    var workspaceRetirement: Retirement?
    var workspaceIncarnation: String?
    var navigationIncarnations: [Navigation: String] = [:]
    var activeNavigation: Navigation?
    var replacements = 0, restarts = 0
    var lastInitial = false
    var status = ""
    // APP_ADMISSION
    // APP_LOAD
    // APP_REPLACEMENT_ADMISSION
    func currentWorkspaceStorageProfile(receipt: EngineReceipt) -> Profile? { workspaceStorage?.profile }
    func prepareWorkspaceStorage(receipt: EngineReceipt) async throws {
        if workspaceStorage == nil { workspaceStorage = Storage() }
    }
    func beginWorkspaceRetirement() -> Retirement { webView = nil; return retirement }
    func showShutdownStatus(_ message: String) { status = message }
    func fail(_ message: String) { failure = message }
    func restartOwnedEngine() async throws { restarts += 1 }
    func loadCurrent() async { await load(URL(string: engine.receipt!.endpoint!)!, incarnation: engine.receipt!.incarnation) }
    func blockedReplacement() { replaceWorkspace(receipt: engine.receipt!, fragment: "/") }
}
@MainActor final class Recovery {
    private unowned let app: App
    private var generation = 0
    private var task: Task<Void, Never>?
    private var launch: String?
    private var routeFragment: String?
    private var reloadAttempts = 0, restartAttempts = 0
    private var sleeping = false, closed = false
    private(set) var busy = false
    private(set) var needsRecovery = false
    private var engineStateLost = false
    private var reload: RecoveryButton? = RecoveryButton()
    private var restart: RecoveryButton? = RecoveryButton()
    var isSuspended: Bool { sleeping }
    var documentGeneration: Int { generation }
    var restoredFragment: String? { routeFragment }
    init(_ app: App) { self.app = app }
    private func rememberRoute() {}
    private func cancelConfirmation() {} // No Restart sheet is outstanding in these races.
    // RECOVERY_METHODS
    func startRestart() { performRestart() }
    func retry() { reconnect("Explicit retry", automatic: false) }
    func settle() async { await task?.value }
    func supersede() { generation += 1 }
    var retryVisible: Bool { reload?.isHidden == false && restart?.isHidden == false }
    var attempts: Int { restartAttempts }
}
@main enum RecoveryQuitAdmissionControls {
    @MainActor static func confirming(_ app: App) -> AppLifecycle.Confirmation {
        guard case .confirm(let episode) = app.quit.lifecycle.requestQuit(activity: .init()) else { preconditionFailure() }
        return episode
    }
    @MainActor static func heldRestart(_ transition: String) async throws {
        let app = App(), barrier = Barrier()
        app.retirement.barrier = barrier
        app.recovery.startRestart()
        for _ in 0..<1000 {
            if barrier.waiting { break }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        precondition(barrier.waiting)
        let episode = confirming(app)
        if transition == "stale" { app.recovery.supersede() }
        if transition == "stop" {
            guard case .stop = app.quit.lifecycle.answer(episode, stop: true) else { preconditionFailure() }
            app.stopping = true
        }
        barrier.release(); await app.recovery.settle()
        precondition(app.restarts == 0 && app.recovery.attempts == 0 && app.replacements == 0)
        if transition == "cancel" {
            precondition(app.recovery.retryVisible && app.recovery.needsRecovery && !app.recovery.busy,
                "Quit during retirement must leave truthful explicit recovery")
            precondition(app.status.contains("Workspace unavailable"))
            precondition(app.quit.lifecycle.answer(episode, stop: false) == .cancel)
            precondition(app.restarts == 0 && app.replacements == 0, "Cancel must not auto-replay recovery")
            app.retirement.barrier = nil
            app.recovery.startRestart(); await app.recovery.settle()
            precondition(app.restarts == 1 && app.recovery.attempts == 1)
        } else {
            precondition(!app.recovery.retryVisible && !app.status.contains("Workspace unavailable"),
                "Stale or stopped work must not present a successor recovery result")
        }
    }
    @MainActor static func lateReadiness() async {
        let app = App()
        app.recovery.startRestart(); await app.recovery.settle()
        precondition(app.restarts == 1 && app.recovery.needsRecovery && app.webView == nil)
        let episode = confirming(app)
        app.blockedReplacement()
        precondition(app.replacements == 0, "The actual noninitial replacement admission must reject pending Quit")
        await app.loadCurrent()
        precondition(app.replacements == 0 && app.recovery.needsRecovery && app.recovery.retryVisible,
            "Actual load/engineReady must not erase recovery before Quit admission")
        precondition(app.quit.lifecycle.answer(episode, stop: false) == .cancel)
        precondition(app.replacements == 0 && app.restarts == 1)
        app.recovery.retry(); await app.recovery.settle()
        precondition(app.replacements == 1 && app.restarts == 1, "Explicit retry after Cancel must remain available")
    }
    @MainActor static func initialDocument() async {
        let app = App(); app.webView = nil; app.workspaceStorage = nil
        let profileException = CommandLine.arguments.contains("profile-initial")
        let episode = profileException ? confirming(app) : nil
        await app.loadCurrent()
        precondition(app.replacements == 1 && !app.recovery.needsRecovery)
        if let episode {
            precondition(app.lastInitial, "Initial-profile Cancel-Quit exception must remain admitted")
            precondition(app.quit.lifecycle.answer(episode, stop: false) == .cancel)
        }
    }
    @MainActor static func main() async throws {
        switch CommandLine.arguments[1] {
        case "retirement-cancel": try await heldRestart("cancel")
        case "retirement-stale": try await heldRestart("stale")
        case "retirement-stop": try await heldRestart("stop")
        case "late-readiness": await lateReadiness()
        default: await initialDocument()
        }
        print("Verbatim recovery/load/replacement admission \(CommandLine.arguments[1]) passed; headless adapters only.")
    }
}
