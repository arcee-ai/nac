#if PREVIEW_SMOKE
  import Foundation
  import CryptoKit

  // Platform and storage-I/O doubles only. The controller inserts verbatim owner
  // methods and real profile/receipt/lifecycle types. No AppKit/WebKit is imported.
  // PROFILE_MODEL
  // CONFIG_MODEL

  @MainActor private final class Barrier {
    var waiting = false
    private var continuation: CheckedContinuation<Void, Never>?
    func wait() async {
      await withCheckedContinuation {
        waiting = true
        continuation = $0
      }
    }
    func release() {
      waiting = false
      continuation?.resume()
      continuation = nil
    }
  }
  @MainActor private final class WorkspaceStorage {
    static var barrier = Barrier()
    static var calls = 0
    static var held = true
    static var degraded = false
    let profile: WorkspaceStorageProfile
    let available: Bool
    init(profile: WorkspaceStorageProfile) {
      self.profile = profile
      available = !Self.degraded
    }
    static func open(receipt: EngineReceipt, configuration: EngineLaunchConfiguration) async
      -> WorkspaceStorage?
    {
      calls += 1
      guard let profile = WorkspaceStorageProfile(receipt: receipt, configuration: configuration)
      else { return nil }
      if held { await barrier.wait() }
      return WorkspaceStorage(profile: profile)
    }
    static func reset(degraded: Bool = false) {
      barrier = Barrier()
      calls = 0
      held = true
      Self.degraded = degraded
    }
    static func release() {
      held = false
      barrier.release()
    }
    func flush(completion: @escaping (Bool) -> Void) { completion(available) }
  }
  @MainActor private final class WKNavigation: NSObject {}
  @MainActor private final class WKWebView {
    var navigationDelegate: AnyObject?
    var uiDelegate: AnyObject?
    var isHidden = true
    static var loads = 0
    var url: URL?
    func removeFromSuperview() {}
    func stopLoading() {}
    func load(_ request: URLRequest) -> WKNavigation? {
      Self.loads += 1
      url = request.url
      return WKNavigation()
    }
  }
  @MainActor private final class NativeCommands {
    func retire(completion: @escaping (Bool) -> Void = { _ in }) { completion(false) }
    func bind() {}
  }
  @MainActor private struct WorkspaceRetirement {
    init(view: WKWebView?, commands: NativeCommands?, dropOwner: @escaping () -> Void) {
      dropOwner()
    }
    func wait() async throws { try Task.checkCancellation() }
  }
  @MainActor private enum WorkspaceReadiness {
    static var checks = 0
    static func check(_ receipt: EngineReceipt) async throws {
      checks += 1
      try Task.checkCancellation()
    }
  }
  @MainActor private final class Control {
    var isHidden = true
    var isEnabled = false
    var stringValue = ""
  }
  @MainActor private final class Window { func makeFirstResponder(_ responder: Any?) {} }
  @MainActor private final class Conflict { func clear() {} }
  @MainActor private final class Smoke { func didStop() {} }
  @MainActor private enum NSWorkspace {
    static let shared = Notifications()
    final class Notifications { let notificationCenter = NotificationCenter() }
  }
  @MainActor private final class Engine {
    var pid: Int32 = 42
    var log = ""
    var receipt: EngineReceipt? = Engine.makeReceipt()
    static func makeReceipt(incarnation: String = "launch", store: String = "/fixture/store")
      -> EngineReceipt
    {
      EngineReceipt(
        kind: "ready", version: 1, incarnation: incarnation,
        endpoint: "http://127.0.0.1:41001",
        identity: EngineIdentity(
          product_version: "test", build_id: "build",
          source_revision: "source", track: "dev"), store: store, schema: 1,
        stage: nil, code: nil, message: nil)
    }
    func stop(_ completion: @escaping () -> Void) {
      pid = 0
      receipt = nil
      completion()
    }
  }
  @MainActor private final class Quit {
    let lifecycle = AppLifecycle()
    var launch: UUID? { lifecycle.launch }
    func childExited(_ launch: UUID) { lifecycle.childExited(launch) }
  }
  @MainActor private final class PreviewApp {
    var webView: WKWebView! = WKWebView()
    var commands: NativeCommands! = NativeCommands()
    let engine = Engine(), quit = Quit(), window = Window()
    var baseURL: URL?
    var failure: String?
    var stopping = false
    var launchConfiguration: EngineLaunchConfiguration? = EngineLaunchConfiguration(
      cwd: URL(fileURLWithPath: "/fixture"), store: URL(fileURLWithPath: "/fixture/store"),
      environment: ["HOME": "/fixture/home"])
    var startup: Task<Void, Never>?
    var loading: Task<Void, Never>?
    var workspaceStorage: WorkspaceStorage?
    // SELECTION_FIELD
    var workspaceIncarnation: String?
    var navigationIncarnations: [WKNavigation: String] = [:]
    var activeNavigation: WKNavigation?
    var workspaceRetirement: WorkspaceRetirement?
    let status = Control(), storeConflictRetry = Conflict()
    var storeRetryButton: Control? = Control()
    var startupSmoke: Smoke?
    lazy var recovery = Recovery(app: self)
    var replacements: [[String: Any]] = []
    let startGate = Barrier()
    // APP_METHODS
    func beginLoading(gated: Bool = false) {
      loading = Task {
        if gated { await startGate.wait() }
        guard let receipt = engine.receipt, let endpoint = receipt.endpoint else { return }
        await load(URL(string: endpoint)!, incarnation: receipt.incarnation)
      }
    }
    func failNow() { fail("controlled common failure") }
    func showShutdownStatus(_ message: String) { status.stringValue = message }
    // Product document constructor is a recorder boundary, not a real WK view.
    // This cannot establish WebKit persistence, weak release or bridge execution.
    func replaceWorkspace(
      receipt: EngineReceipt, fragment: String?, initial: Bool = false,
      requireTerminalAcknowledgement: Bool = false
    ) {
      replacements.append([
        "initial": initial, "ack": requireTerminalAcknowledgement,
        "storage": workspaceStorage != nil,
        "available": workspaceStorage?.available ?? false,
        "profile": workspaceStorage?.profile.digest ?? "nil", "launch": receipt.incarnation,
      ])
      webView = WKWebView()
      commands = NativeCommands()
    }
  }
  @MainActor private final class Recovery {
    unowned let app: PreviewApp
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
    private var needsRecovery = false
    private var reload: Control? = Control()
    private var restart: Control? = Control()
    init(app: PreviewApp) { self.app = app }
    private func cancelConfirmation() {}
    // RECOVERY_METHODS
    // GENERATION_PROPERTY
    var isSuspended: Bool { sleeping }
    var restoredFragment: String? { routeFragment }
    func sleep() { willSleep() }
    func wake() { didWake() }
    func settle() async { await task?.value }
    func retry() { reconnect("Explicit retry", automatic: false) }
  }

  @main private enum ProfileInitializationCases {
    @MainActor static func drain() async { for _ in 0..<150 { await Task.yield() } }
    @MainActor static func wait(_ condition: () -> Bool) async -> Bool {
      for _ in 0..<1000 {
        if condition() { return true }
        try? await Task.sleep(nanoseconds: 1_000_000)
      }
      return false
    }
    @MainActor static func main() async throws {
      let names = [
        "after-base-before-release", "release-while-suspended", "before-base-retirement",
        "repeat-wake", "stop-pending", "failure-pending", "stale-launch", "valid-degraded",
        "initial", "foreign-profile", "foreign-home", "initial-cancel-quit",
        "quit-during-recovery", "invalid-normal", "recovery-stop-await",
        "recovery-failure-await", "recovery-stale-generation-await", "new-engine",
      ]
      var rows: [[String: Any]] = []
      for name in names {
        WorkspaceStorage.reset(degraded: name == "valid-degraded")
        let app = PreviewApp()
        WKWebView.loads = 0
        WorkspaceReadiness.checks = 0
        if name == "invalid-normal" {
          app.engine.receipt = Engine.makeReceipt(store: "relative-invalid-store")
          app.beginLoading()
          await app.loading?.value
          let failures =
            app.failure != nil && app.workspaceStorage == nil && app.replacements.isEmpty
              && WKWebView.loads == 0
            ? [String]() : ["invalid normal profile rendered instead of explicit failure"]
          rows.append(["case": name, "failures": failures, "opens": WorkspaceStorage.calls])
          app.recovery.close()
          continue
        }
        app.beginLoading(gated: name == "before-base-retirement")
        if name == "before-base-retirement" {
          _ = await wait { app.startGate.waiting }
          app.recovery.sleep()
          app.startGate.release()
        }
        guard await wait({ WorkspaceStorage.barrier.waiting }) else {
          throw PreviewError.message("fixture did not reach delayed production open")
        }
        var failures: [String] = []
        var quitConfirmation: AppLifecycle.Confirmation?
        func expect(_ value: Bool, _ reason: String) { if !value { failures.append(reason) } }
        if name == "stop-pending" {
          app.beginShutdown {}
        } else if name == "failure-pending" {
          app.failNow()
        } else if name == "stale-launch" {
          app.engine.receipt = Engine.makeReceipt(incarnation: "new-launch")
        } else if name == "foreign-profile" {
          app.engine.receipt = Engine.makeReceipt(store: "/fixture/foreign")
        } else if name == "foreign-home" {
          app.launchConfiguration = EngineLaunchConfiguration(
            cwd: URL(fileURLWithPath: "/fixture"),
            store: URL(fileURLWithPath: "/fixture/store"),
            environment: ["HOME": "/fixture/foreign-home"])
        } else if name != "initial" && name != "initial-cancel-quit" && name != "new-engine" {
          if name != "before-base-retirement" { app.recovery.sleep() }
          if name != "release-while-suspended" {
            app.recovery.wake()
            if name == "repeat-wake" {
              await drain()
              app.recovery.sleep()
              app.recovery.wake()
            }
          }
        }
        await drain()
        if name.hasPrefix("recovery-") || name == "quit-during-recovery" {
          expect(
            WorkspaceReadiness.checks == 1 && app.recovery.busy
              && WorkspaceStorage.barrier.waiting && app.workspaceStorage == nil,
            "recovery did not reach its held storage await after readiness")
        }
        if name == "recovery-stop-await" {
          app.beginShutdown {}
        } else if name == "recovery-failure-await" {
          app.failNow()
        } else if name == "recovery-stale-generation-await" {
          app.recovery.sleep()
        }
        if name == "initial-cancel-quit" || name == "quit-during-recovery" {
          if case .confirm(let confirmation) = app.quit.lifecycle.requestQuit(activity: .init()) {
            quitConfirmation = confirmation
          } else {
            failures.append("Quit did not create confirmation")
          }
        }
        expect(
          app.replacements.isEmpty, "product document constructed before profile open completed")
        WorkspaceStorage.release()
        await app.loading?.value
        if name == "release-while-suspended" { app.recovery.wake() }
        await app.recovery.settle()
        await drain()
        if name == "quit-during-recovery" {
          expect(app.replacements.isEmpty, "recovery bypassed pending Quit after profile await")
          if let confirmation = quitConfirmation {
            _ = app.quit.lifecycle.answer(confirmation, stop: false)
          }
          expect(
            app.replacements.isEmpty,
            "Cancel Quit constructed a recovery document before explicit retry")
          app.recovery.retry()
          await app.recovery.settle()
        } else if name == "initial-cancel-quit", let confirmation = quitConfirmation {
          expect(
            app.replacements.first?["initial"] as? Bool == true,
            "initial document lost Cancel-Quit behavior")
          _ = app.quit.lifecycle.answer(confirmation, stop: false)
        }
        if name == "new-engine" {
          _ = app.beginWorkspaceRetirement()
          app.engine.receipt = Engine.makeReceipt(incarnation: "replacement-launch")
          app.beginLoading()
          await app.loading?.value
          expect(app.replacements.count == 2, "new engine did not construct its own document")
          expect(
            app.replacements.last?["launch"] as? String == "replacement-launch",
            "new engine document used stale launch identity")
        }
        let retired = [
          "stop-pending", "failure-pending", "stale-launch", "foreign-profile", "foreign-home",
          "recovery-stop-await", "recovery-failure-await", "recovery-stale-generation-await",
        ].contains(name)
        if retired {
          expect(app.workspaceStorage == nil, "late storage installed into retired launch")
          expect(app.replacements.isEmpty, "late document installed into retired launch")
        } else {
          expect(app.workspaceStorage != nil, "selected profile was discarded with renderer waiter")
          expect(
            app.replacements.count == (name == "new-engine" ? 2 : 1),
            "unexpected number of current product replacements")
          let expectsAcknowledgement = !["initial", "initial-cancel-quit", "new-engine"].contains(name)
          expect(
            app.replacements.allSatisfy { ($0["ack"] as? Bool) == expectsAcknowledgement },
            "terminal acknowledgement fact did not match current same-engine recovery")
          expect(
            app.replacements.allSatisfy { ($0["storage"] as? Bool) == true },
            "recovery constructed document with nil storage")
          expect(
            app.workspaceStorage?.available == (name != "valid-degraded"),
            "valid degraded profile capability changed")
        }
        expect(WorkspaceStorage.calls == 1, "profile open was not coalesced")
        rows.append([
          "case": name, "failures": failures, "opens": WorkspaceStorage.calls,
          "replacements": app.replacements, "storage": app.workspaceStorage != nil,
        ])
        app.recovery.close()
      }
      let result: [String: Any] = [
        "kind": "headless verbatim owner flow with controlled platform/storage doubles",
        "actualWK": false, "actualDiskLease": false, "cases": rows,
        "failed": rows.filter { !($0["failures"] as! [String]).isEmpty }.count,
      ]
      let data = try JSONSerialization.data(
        withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
      print(String(decoding: data, as: UTF8.self))
      if (result["failed"] as! Int) != 0 { exit(1) }
    }
  }
#endif
