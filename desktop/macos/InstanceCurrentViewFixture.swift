// Inert platform ports around the complete maintained InstanceSmoke owner.
// No AppKit/WebKit, app, engine, OS input, or native pixel implementation is linked.
import Foundation
import CoreGraphics
import Darwin

@MainActor enum I1Clock {
    static var now = 0.0
    static var date: Date { Date(timeIntervalSince1970: now) }
    static func sleep(nanoseconds: UInt64) async throws {
        try Task.checkCancellation()
        now += Double(max(nanoseconds, 1)) / 1_000_000_000
        await Task.yield()
    }
}
@MainActor enum I1Dispatch {
    static var main: Self.Type { Self.self }
    static var timers: [DispatchWorkItem] = []
    static func asyncAfter(deadline: DispatchTime, execute item: DispatchWorkItem) { timers.append(item) }
    static func asyncAfter(deadline: DispatchTime, execute block: @escaping () -> Void) { timers.append(DispatchWorkItem(block: block)) }
    static func expire() { let pending = timers; timers = []; pending.forEach { $0.perform() } }
}
@MainActor enum I1RunLoop {
    static var main: Self.Type { Self.self }
    static var callbacks: [() -> Void] = []
    static func perform(inModes: [RunLoop.Mode], block: @escaping () -> Void) { callbacks.append(block) }
    static func flush() { let pending = callbacks; callbacks = []; pending.forEach { $0() } }
}
struct ViewMask: OptionSet {
    let rawValue: Int
    static let width = Self(rawValue: 1), height = Self(rawValue: 2)
}
struct WindowMask: OptionSet {
    let rawValue: Int
    static let titled = Self(rawValue: 1)
}
@MainActor class NSView {
    var frame = NSRect(x: 0, y: 0, width: 1200, height: 800)
    var bounds: NSRect { frame }
    var autoresizingMask: ViewMask = []
    var subviews: [NSView] = []
    weak var parent: NSView?
    weak var window: NSWindow?
    enum Position { case below }
    func addSubview(_ view: NSView) { view.parent = self; view.window = window; subviews.append(view) }
    func addSubview(_ view: NSView, positioned: Position, relativeTo: NSView?) { addSubview(view) }
    func removeFromSuperview() { parent?.subviews.removeAll { $0 === self }; parent = nil; window = nil }
    func bitmapImageRepForCachingDisplay(in: NSRect) -> NSBitmapImageRep? { NSBitmapImageRep(data: Data([1])) }
    func cacheDisplay(in: NSRect, to: NSBitmapImageRep) {}
}
@MainActor class NSWindow {
    var contentView: NSView? = NSView()
    let windowNumber = 17
    var isVisible = true, isMiniaturized = false, isKeyWindow = true
    var frame = NSRect(x: 0, y: 0, width: 1200, height: 800)
    let styleMask: WindowMask = [.titled]
    init() { contentView?.window = self }
    func miniaturize(_ sender: Any?) { isMiniaturized = true }
    func makeFirstResponder(_ responder: Any?) {}
}
@MainActor final class NSPanel: NSWindow {}
@MainActor final class NSTextField: NSView { var stringValue = "" }
@MainActor final class NSButton {
    var isEnabled = true
    var click: () -> Void = {}
    func performClick(_ sender: Any?) { click() }
}
@MainActor enum NSApp {
    static var isActive = true
    static var windows: [NSWindow] = []
    static func terminate(_ sender: Any?) {}
}
struct NSRunningApplication {
    static let current = Self()
    let launchDate: Date? = Date(timeIntervalSince1970: 1)
}
final class NSImage {
    let tiffRepresentation: Data? = Data([1, 2, 3])
    init(size: NSSize) {}
    func addRepresentation(_ bitmap: NSBitmapImageRep) {}
}
final class NSBitmapImageRep {
    enum FileType { case png }
    init?(data: Data) {}
    func representation(using: FileType, properties: [String: String]) -> Data? { Data([4, 5, 6]) }
}
func NSStringFromRect(_ rect: NSRect) -> String { "{{0,0},{1200,800}}" }
final class WKWebsiteDataStore { static func nonPersistent() -> WKWebsiteDataStore { Self() } }
final class WKUserScript {
    enum InjectionTime { case atDocumentStart }
    let source: String
    init(source: String, injectionTime: InjectionTime, forMainFrameOnly: Bool) { self.source = source }
}
final class WKUserContentController {
    var userScripts: [WKUserScript] = []
    func addUserScript(_ script: WKUserScript) { userScripts.append(script) }
}
final class WKWebViewConfiguration {
    var websiteDataStore = WKWebsiteDataStore()
    let userContentController = WKUserContentController()
}
enum WKContentWorld { case page }
@MainActor final class WKWebView: NSView {
    let configuration: WKWebViewConfiguration
    var customUserAgent: String?
    weak var navigationDelegate: AnyObject?
    weak var uiDelegate: AnyObject?
    var isHidden = true, isLoading = false
    var url: URL? = URL(string: "http://127.0.0.1:45678/")
    init(frame: NSRect, configuration: WKWebViewConfiguration) { self.configuration = configuration; super.init(); self.frame = frame }
    func stopLoading() { isLoading = false }
    func loadPort() { I1Transport.loads.append((customUserAgent, configuration.userContentController.userScripts.count)) }
    func callAsyncJavaScript(_ script: String, arguments: [String: Any], in frame: Any?, in world: WKContentWorld,
                             completionHandler: @escaping (Result<Any, Error>) -> Void) {
        I1Transport.lastEvaluationView = self
        if I1Transport.holdEvaluation { I1Transport.evaluations.append(.init(owner: self, callback: completionHandler)) }
        else { completionHandler(.success(I1Transport.observation)) }
    }
    func takeSnapshot(with configuration: Any?, completionHandler: @escaping (NSImage?, Error?) -> Void) {
        if I1Transport.holdSnapshot { I1Transport.snapshots.append(.init(owner: self, callback: completionHandler)) }
        else if I1Transport.snapshotFailure { completionHandler(nil, PreviewError.message("inert current snapshot error")) }
        else { completionHandler(NSImage(size: frame.size), nil) }
    }
}
@MainActor enum I1Transport {
    // The port deliberately retains an in-flight platform receiver. The fixture
    // may not retain that receiver after this callback capability is released.
    struct Evaluation { var owner: WKWebView?; let callback: (Result<Any, Error>) -> Void }
    struct Snapshot { var owner: WKWebView?; let callback: (NSImage?, Error?) -> Void }
    static var loads: [(String?, Int)] = []
    static var observationOverride: [String: Any]?
    static var snapshotFailure = false
    static var holdEvaluation = false, holdSnapshot = false
    static var evaluations: [Evaluation] = [], snapshots: [Snapshot] = []
    static weak var lastEvaluationView: WKWebView?
    static var observation: [String: Any] {
        if let observationOverride { return observationOverride }
        return ["ready": true, "url": "http://127.0.0.1:45678/#/", "ready_state": "complete",
         "semantic": "empty-onboarding", "body_length": 120, "body_text": String(repeating: "x", count: 120),
         "root_html": "<main>owned</main>", "diagnostics_installed": true, "errors": []]
    }
    static func finishEvaluation(_ result: Result<Any, Error>? = nil) {
        var pending = evaluations.removeFirst(); pending.callback(result ?? .success(observation)); pending.owner = nil
    }
    static func finishSnapshot() { var pending = snapshots.removeFirst(); pending.callback(NSImage(size: .zero), nil); pending.owner = nil }
    static func reset() { observationOverride = nil; snapshotFailure = false; loads = []; holdEvaluation = false; holdSnapshot = false; evaluations = []; snapshots = []; lastEvaluationView = nil; I1Dispatch.timers = []; I1RunLoop.callbacks = []; I1Clock.now = 0 }
}
@MainActor final class PreviewEngine {
    var pid: pid_t = 42
    var receipt: EngineReceipt? = I1App.receipt()
    var log = "inert process port; no engine launched"
}
@MainActor final class NativeCommands {
    func retire(completion: (Bool) -> Void = { _ in }) { completion(true) }
}
// INSTANCE_OWNER
// RETIREMENT_OWNER

@MainActor final class I1App {
    var window = NSWindow()
    var webView: WKWebView!
    var commands: NativeCommands? = NativeCommands()
    var workspaceDataStore = WKWebsiteDataStore()
    struct Recovery { var documentGeneration = 1; var noticeHeight = 0.0 }
    var recovery = Recovery()
    var engine = PreviewEngine()
    let conflicts = StoreConflictRetry()
    let button = NSButton()
    var error: String?, quits = 0
    let requireTerminalAcknowledgement = false
    static func receipt(incarnation: String = "owned", endpoint: String = "http://127.0.0.1:45678", source: String = "owned-source", build: String = "owned-build", track: String = "dev", store: String = "/owned/fixture.db", schema: Int = 1, kind: String = "ready", version: Int = 1, product: String = "0.1.4", stage: String? = nil, code: String? = nil, message: String? = nil) -> EngineReceipt {
        EngineReceipt(kind: kind, version: version, incarnation: incarnation, endpoint: endpoint,
            identity: EngineIdentity(product_version: product, build_id: build, source_revision: source, track: track),
            store: store, schema: schema, stage: stage, code: code, message: message)
    }
    init() { NSApp.windows = [window]; initial() }
    func initial() {
        // APP_INITIAL_CREATION
    }
    func dropOnly() {
        // APP_PROFILE_DROP
    }
    func replace() {
        // APP_PROFILE_DROP
        // APP_REPLACEMENT_CREATION
        window.contentView!.addSubview(webView)
    }
    func expose() { webView.isHidden = false }
}

extension InstanceSmoke {
    @MainActor static func fixture(_ app: I1App) -> InstanceSmoke {
        // INITIALIZER_ADAPTER
    }
    @MainActor static func eventually(_ predicate: () -> Bool) async -> Bool {
        for _ in 0..<10000 { if predicate() { return true }; await Task.yield() }
        return false
    }
    @MainActor func evaluationForTest() async throws -> [String: Any] {
        #if I1_POST
        return try await observeWorkspace(pinCurrentView(), origin: "http://127.0.0.1:45678", timeout: 1)
        #else
        return try await observeWorkspace(origin: "http://127.0.0.1:45678", timeout: 1)
        #endif
    }
    @MainActor static func runControls(redOnly: Bool) async throws -> [[String: Any]] {
        #if I1_POST
        if CommandLine.arguments.contains("--failure-red-only") { return try await runFailureControls(redOnly: true) }
        if CommandLine.arguments.contains("--snapshot-only") { return try await runSnapshotCallbackControls() }
        #endif
        var results: [[String: Any]] = []
        @MainActor func check(_ name: String, _ pass: Bool, _ detail: String = "") { results.append(["name": name, "pass": pass, "detail": detail]) }
        @MainActor func reset() { I1Transport.reset();  }
        reset()
        do {
            let app = I1App(); let probe = fixture(app)
            weak var bootstrap = app.webView
            app.replace()
            for _ in 0..<3 { await Task.yield() }
            check("bootstrap-released", bootstrap == nil)
            bootstrap = nil
            withExtendedLifetime(probe) {}
        }
        reset()
        do {
            let app = I1App(); let probe = fixture(app)
            app.webView.isHidden = false
            app.replace(); app.expose()
            do { try await probe.readyWorkspace() } catch {}
            check("retarget-current-view", I1Transport.lastEvaluationView === app.webView)
        }
        reset()
        do {
            let app = I1App(); let probe = fixture(app); app.expose(); I1Transport.holdEvaluation = true
            let task = Task { try await probe.evaluationForTest() }
            let entered = await eventually { !I1Transport.evaluations.isEmpty }
            app.replace(); app.expose(); I1Transport.finishEvaluation()
            if case .failure = await task.result { check("stale-async-result-refuses", entered) }
            else { check("stale-async-result-refuses", false) }
        }
        if redOnly { return results }
        #if I1_POST
        reset()
        do {
            let app = I1App(); let probe = fixture(app)
            let first = app.webView!
            first.loadPort()
            let firstConfigured = first.customUserAgent?.contains("NACInstanceSmoke/ALL-343") == true && first.configuration.userContentController.userScripts.count == 1
            app.replace()
            app.webView.loadPort()
            let secondConfigured = app.webView.customUserAgent == first.customUserAgent && app.webView.configuration.userContentController.userScripts.count == 1
            InstanceSmoke.configure(app.webView)
            check("both-creation-UA-diagnostics-before-load", firstConfigured && secondConfigured && app.webView.configuration.userContentController.userScripts.count == 1)
            check("both-first-load-ports-configured", I1Transport.loads.count == 2 && I1Transport.loads.allSatisfy { $0.0?.contains("NACInstanceSmoke/ALL-343") == true && $0.1 == 1 })
            _ = probe
        }
        reset()
        do {
            var app: I1App? = I1App(); let probe = fixture(app!)
            weak var oldApp = app; weak var oldView = app!.webView
            app!.webView.removeFromSuperview(); app!.webView = nil; app = nil
            check("weak-app-deallocation", oldApp == nil && oldView == nil)
            oldApp = nil; oldView = nil
            do { _ = try probe.pinCurrentView(); check("nil-current-refuses", false) }
            catch { check("nil-current-refuses", true) }
        }
        reset()
        do {
            let app = I1App(); let probe = fixture(app); app.expose()
            weak var oldView = app.webView
            let retirement = WorkspaceRetirement(view: app.webView, commands: app.commands) { app.dropOnly() }
            do { try await retirement.wait(); check("actual-retirement-weak-release", oldView == nil) }
            catch { check("actual-retirement-weak-release", false, String(describing: error)) }
            oldView = nil
            withExtendedLifetime(probe) {}
        }
        reset()
        do {
            let app = I1App(); let probe = fixture(app); app.dropOnly()
            do { try await probe.readyWorkspace(); check("nil-current-cannot-ready", false) }
            catch { check("nil-current-cannot-ready", probe.evidence["workspace_activated"] == nil) }
        }
        for mode in ["positive", "error", "malformed", "timeout"] {
            reset(); let app = I1App(); let probe = fixture(app); app.expose(); I1Transport.holdEvaluation = true
            let task = Task { try await probe.evaluationForTest() }
            let entered = await eventually { !I1Transport.evaluations.isEmpty }
            weak var platformView = app.webView
            app.replace(); app.expose()
            check("platform-retains-until-callback-" + mode, entered && platformView != nil)
            if mode == "timeout" { I1Dispatch.expire() }
            if mode == "error" { I1Transport.finishEvaluation(.failure(PreviewError.message("inert port error"))) }
            else if mode == "malformed" { I1Transport.finishEvaluation(.success("not a record")) }
            else { I1Transport.finishEvaluation() }
            let result = await task.result
            if case .failure = result { check("old-view-" + mode + "-refuses", true) }
            else { check("old-view-" + mode + "-refuses", false) }
            for _ in 0..<3 { await Task.yield() }
            check("no-controller-retain-after-callback-" + mode, platformView == nil)
            platformView = nil
        }
        reset()
        do {
            let app = I1App(); let probe = fixture(app); app.expose(); I1Transport.holdEvaluation = true
            let task = Task { try await probe.evaluationForTest() }
            _ = await eventually { !I1Transport.evaluations.isEmpty }
            app.recovery.documentGeneration += 1
            I1Transport.finishEvaluation()
            if case .failure = await task.result { check("same-view-new-document-refuses", true) }
            else { check("same-view-new-document-refuses", false) }
        }
        reset()
        do {
            let app = I1App(); let first = fixture(app); let second = fixture(app)
            let binding = try first.pinCurrentView()
            do { _ = try second.requireCurrentView(binding); check("run-incarnation-fence", false) }
            catch { check("run-incarnation-fence", true) }
        }
        reset()
        do {
            let app = I1App(); let probe = fixture(app); app.expose(); I1Transport.holdEvaluation = true
            let task = Task { try await probe.readyWorkspace() }
            _ = await eventually { !I1Transport.evaluations.isEmpty }; task.cancel(); I1Transport.finishEvaluation()
            if case .failure = await task.result { check("cancelled-readiness-refuses", probe.evidence["workspace_activated"] == nil) }
            else { check("cancelled-readiness-refuses", false) }
        }
        let mismatches: [(String, (I1App) -> Void)] = [
            ("pid", { $0.engine.pid = 43 }), ("incarnation", { $0.engine.receipt = I1App.receipt(incarnation: "new") }),
            ("endpoint", { $0.engine.receipt = I1App.receipt(endpoint: "http://127.0.0.1:45679") }),
            ("product-version", { $0.engine.receipt = I1App.receipt(product: "0.1.5") }),
            ("receipt-removed", { $0.engine.receipt = nil }),
            ("source", { $0.engine.receipt = I1App.receipt(source: "new") }), ("build", { $0.engine.receipt = I1App.receipt(build: "new") }),
            ("track", { $0.engine.receipt = I1App.receipt(track: "stable") }), ("store", { $0.engine.receipt = I1App.receipt(store: "/foreign") }),
            ("schema", { $0.engine.receipt = I1App.receipt(schema: 2) }), ("kind", { $0.engine.receipt = I1App.receipt(kind: "failed") }),
            ("version", { $0.engine.receipt = I1App.receipt(version: 2) }), ("stage", { $0.engine.receipt = I1App.receipt(stage: "new") }),
            ("code", { $0.engine.receipt = I1App.receipt(code: "new") }), ("message", { $0.engine.receipt = I1App.receipt(message: "new") })]
        for (name, mutate) in mismatches {
            reset(); let app = I1App(); let probe = fixture(app); app.expose(); I1Transport.holdEvaluation = true
            let task = Task { try await probe.evaluationForTest() }
            _ = await eventually { !I1Transport.evaluations.isEmpty }; mutate(app); I1Transport.finishEvaluation()
            if case .failure = await task.result { check("receipt-fence-" + name, true) }
            else { check("receipt-fence-" + name, false) }
        }
        for diagnostic in [false, true] {
            reset(); let app = I1App(); let probe = fixture(app); app.expose(); I1Transport.holdSnapshot = true
            let before = Set((try? FileManager.default.contentsOfDirectory(atPath: probe.output.deletingLastPathComponent().path)) ?? [])
            let task = Task { () -> Bool in
                if diagnostic { return await probe.recordWorkspaceFailure() }
                do { try await probe.capture("old-view"); return true } catch { return false }
            }
            _ = await eventually { !I1Transport.snapshots.isEmpty }
            app.replace(); app.expose(); I1Transport.finishSnapshot()
            let accepted = await task.value
            let after = Set((try? FileManager.default.contentsOfDirectory(atPath: probe.output.deletingLastPathComponent().path)) ?? [])
            check(diagnostic ? "failure-snapshot-no-stale-export" : "snapshot-no-stale-export", !accepted && before == after)
        }
        reset()
        do {
            let app = I1App(); let probe = fixture(app); app.expose()
            do { try await probe.readyWorkspace(); try await probe.capture("current-view"); check("current-positive-ready-and-snapshot", probe.evidence["workspace_activated"] as? Bool == true) }
            catch { check("current-positive-ready-and-snapshot", false, String(describing: error)) }
        }
        reset()
        do {
            let app = I1App(); let probe = fixture(app)
            app.engine.pid = 0; app.engine.receipt = nil
            let episode = app.conflicts.present(StoreConflict(canonicalStore: "/owned/fixture.db", track: "dev"))
            app.conflicts.retired(episode, ownedChildHasExited: true)
            let label = NSTextField(); label.stringValue = episode.conflict.message; app.window.contentView!.addSubview(label)
            do {
                try await probe.readyConflict()
                app.button.click = {
                    guard app.conflicts.beginRetry(ownedChildHasExited: true, appIsStopping: false) != nil else { return }
                    app.engine.pid = 42; app.engine.receipt = I1App.receipt(); app.replace(); app.expose()
                }
                try probe.clickRetry(); try await probe.readyWorkspace()
                check("actual-retry-new-profile-view", probe.evidence["workspace_activated"] as? Bool == true && I1Transport.lastEvaluationView === app.webView)
            } catch { check("actual-retry-new-profile-view", false, String(describing: error)) }
        }
        reset()
        do {
            let app = I1App(); let probe = fixture(app); app.expose(); probe.activeView = try probe.pinCurrentView()
            probe.publish("before")
            let binding = try probe.pinCurrentView()
            // Exact queued owner callback body is inserted by the extractor.
            // QUEUED_QUIT_CALLBACK
            app.replace(); app.expose(); I1RunLoop.flush(); probe.publish("after-old")
            check("queued-quit-and-stage-fenced", app.quits == 0 && probe.evidence["stage"] as? String == "before")
            probe.prepareForStop(); probe.publish("resurrect")
            app.engine.pid = 0; app.engine.receipt = nil; probe.didStop()
            let disk = try JSONSerialization.jsonObject(with: Data(contentsOf: probe.output)) as? [String: Any]
            check("terminal-cleanup-without-stage-resurrection", disk?["stopped"] as? Bool == true && disk?["stage"] as? String == "before")
        }
        reset()
        do {
            let app = I1App(); let probe = fixture(app); app.expose(); probe.activeView = try probe.pinCurrentView()
            let binding = try probe.pinCurrentView()
            // QUEUED_QUIT_CALLBACK
            I1RunLoop.flush(); I1RunLoop.flush()
            check("current-queued-quit-exactly-once", app.quits == 1)
        }
        reset()
        do {
            let app = I1App(); let probe = fixture(app); app.expose(); I1Transport.holdEvaluation = true
            let task = Task { try await probe.evaluationForTest() }
            _ = await eventually { !I1Transport.evaluations.isEmpty }; probe.prepareForStop(); I1Transport.finishEvaluation()
            if case .failure = await task.result { check("retired-callback-refuses", true) }
            else { check("retired-callback-refuses", false) }
        }
        #endif
        #if I1_POST
        results += try await runFailureControls(redOnly: false)
        results += try await runSnapshotCallbackControls()
        #endif
        return results
    }
}


#if I1_POST
extension InstanceSmoke {
    // The driver inserts the ACTUAL start catch and finish/queued-Quit owner.
    // Only bare guard returns adapt to this Bool test receiver; no copied policy.
    @MainActor func reportFailureForTest(_ error: Error) async -> Bool {
        #if I1_FAILURE_POST
        var failureBinding: ViewBinding?
        #endif
        // FAILURE_CATCH_BODY
        // FAILURE_FINISH_OWNER
        return true
    }

    @MainActor static func runFailureControls(redOnly: Bool) async throws -> [[String: Any]] {
        var rows: [[String: Any]] = []
        @MainActor func check(_ name: String, _ pass: Bool) { rows.append(["name": name, "pass": pass, "detail": ""]) }
        @MainActor func disk(_ probe: InstanceSmoke) -> [String: Any] {
            (try? JSONSerialization.jsonObject(with: Data(contentsOf: probe.output))) as? [String: Any] ?? [:]
        }
        @MainActor func setup(retry: Bool) async throws -> (I1App, InstanceSmoke) {
            I1Transport.reset()
            let app = I1App(), probe = fixture(app)
            // Each control owns a clean export target, so a stale overwrite
            // cannot hide behind a previous control's synthetic snapshot.
            try? FileManager.default.removeItem(at: probe.output.deletingLastPathComponent().appendingPathComponent("workspace-failure.png"))
            if retry {
                app.engine.pid = 0; app.engine.receipt = nil
                let episode = app.conflicts.present(StoreConflict(canonicalStore: "/owned/fixture.db", track: "dev"))
                app.conflicts.retired(episode, ownedChildHasExited: true)
                let label = NSTextField(); label.stringValue = episode.conflict.message; app.window.contentView!.addSubview(label)
                try await probe.readyConflict()
                probe.publish("live-retry-conflict")
                app.button.click = { [weak app] in
                    guard let app, app.conflicts.beginRetry(ownedChildHasExited: true, appIsStopping: false) != nil else { return }
                    app.engine.pid = 42; app.engine.receipt = I1App.receipt(); app.replace(); app.expose()
                }
                try probe.clickRetry()
            } else { app.expose(); probe.publish("starting") }
            return (app, probe)
        }
        @MainActor func failReadiness(_ probe: InstanceSmoke) async -> Bool {
            do { try await probe.readyWorkspace(); return false }
            catch { return await probe.reportFailureForTest(error) }
        }
        @MainActor func badObservation(_ kind: String) {
            var value = I1Transport.observation
            value["errors"] = [["kind": kind, "message": "owned current readiness error", "url": ""]]
            I1Transport.observationOverride = value
        }
        let positives = redOnly ? ["retry-javascript"] : ["retry-javascript", "retry-resource", "retry-timeout", "initial-javascript", "retry-snapshot-error", "initial-wait-timeout", "retry-wait-timeout"]
        for name in positives {
            let (app, probe) = try await setup(retry: !name.hasPrefix("initial"))
            let previous = probe.activeView
            if name.hasSuffix("wait-timeout") {
                app.webView.isHidden = true
            } else if name == "retry-timeout" {
                var value = I1Transport.observation; value["ready"] = false
                I1Transport.observationOverride = value
            } else { badObservation(name == "retry-resource" ? "resource-error" : "javascript-error") }
            I1Transport.snapshotFailure = name == "retry-snapshot-error"
            let reported = await failReadiness(probe)
            I1RunLoop.flush(); I1RunLoop.flush()
            let record = disk(probe)
            check("current-failure-" + name, reported && record["stage"] as? String == "failed" &&
                record["error"] as? String != nil && record["passed"] as? Bool != true &&
                probe.activeView === previous && app.quits == 1 &&
                (name != "retry-snapshot-error" || record["workspace_failure_snapshot_error"] as? String != nil))
        }
        if redOnly { return rows }
        for transition in ["view", "document"] {
            let (app, probe) = try await setup(retry: true)
            I1Transport.holdEvaluation = true
            let task = Task { await failReadiness(probe) }
            let entered = await eventually { !I1Transport.evaluations.isEmpty }
            if transition == "view" { app.replace(); app.expose() }
            else { app.recovery.documentGeneration += 1 }
            I1Transport.finishEvaluation(.failure(PreviewError.message("old callback error")))
            let reported = await task.value; I1RunLoop.flush()
            check("stale-retry-failure-" + transition, entered && !reported &&
                disk(probe)["stage"] as? String == "live-retry-conflict" && app.quits == 0)
        }
        for transition in ["receipt", "stop"] {
            let (app, probe) = try await setup(retry: true)
            badObservation("javascript-error"); I1Transport.holdSnapshot = true
            let before = Set((try? FileManager.default.contentsOfDirectory(atPath: probe.output.deletingLastPathComponent().path)) ?? [])
            let task = Task { await failReadiness(probe) }
            let entered = await eventually { !I1Transport.snapshots.isEmpty }
            if transition == "receipt" { app.engine.receipt = I1App.receipt(source: "successor") }
            else { probe.prepareForStop() }
            I1Transport.finishSnapshot()
            let reported = await task.value; I1RunLoop.flush()
            let after = Set((try? FileManager.default.contentsOfDirectory(atPath: probe.output.deletingLastPathComponent().path)) ?? [])
            var pass = entered && !reported && before == after && app.quits == 0 && disk(probe)["stage"] as? String == "live-retry-conflict"
            if transition == "stop" {
                app.engine.pid = 0; app.engine.receipt = nil; probe.didStop(); probe.publish("resurrect")
                pass = pass && disk(probe)["stopped"] as? Bool == true && disk(probe)["stage"] as? String == "live-retry-conflict"
            }
            check("failure-diagnostics-fence-" + transition, pass)
        }
        do {
            let (app, probe) = try await setup(retry: true); badObservation("javascript-error")
            let reported = await failReadiness(probe)
            app.replace(); app.expose(); I1RunLoop.flush()
            check("failed-operation-queued-quit-stale-refuses", reported && disk(probe)["stage"] as? String == "failed" && app.quits == 0)
        }
        return rows
    }
}

#endif

#if I1_POST
extension InstanceSmoke {
    @MainActor static func runSnapshotCallbackControls() async throws -> [[String: Any]] {
        var rows: [[String: Any]] = []
        @MainActor func check(_ name: String, _ pass: Bool, _ detail: String = "") {
            rows.append(["name": name, "pass": pass, "detail": detail])
        }
        I1Transport.reset()
        do {
            let app = I1App(), probe = fixture(app)
            app.expose(); probe.publish("before-missing-snapshot")
            let target = probe.output.deletingLastPathComponent().appendingPathComponent("missing-callback.png")
            try? FileManager.default.removeItem(at: target)
            I1Transport.holdSnapshot = true
            var completions = 0, successes = 0
            var failure = ""
            let task = Task {
                do { try await probe.capture("missing-callback"); successes += 1; probe.publish("snapshot-success") }
                catch { failure = error.localizedDescription }
                completions += 1
            }
            let entered = await eventually { !I1Transport.snapshots.isEmpty }
            I1Dispatch.expire()
            let bounded = await eventually { completions == 1 }
            check("normal-snapshot-missing-callback-bounded-failure", entered && bounded && successes == 0 &&
                failure == "Timed out: workspace snapshot" && !FileManager.default.fileExists(atPath: target.path) &&
                probe.evidence["stage"] as? String == "before-missing-snapshot", failure)
            // Release the old source's unbounded await after recording RED. Do
            // not double-resume that baseline continuation. The fixed owner
            // must ignore both late success and duplicate error callbacks.
            let callback = I1Transport.snapshots.first?.callback
            I1Transport.finishSnapshot()
            if bounded {
                callback?(nil, PreviewError.message("duplicate late snapshot error"))
                callback?(NSImage(size: .zero), nil)
            }
            await task.value
            check("normal-snapshot-late-duplicate-after-timeout-no-export", bounded && completions == 1 &&
                successes == 0 && !FileManager.default.fileExists(atPath: target.path) &&
                probe.evidence["stage"] as? String == "before-missing-snapshot")
        }
        for mode in ["success", "error", "view", "generation", "stop", "duplicate"] {
            I1Transport.reset()
            let app = I1App(), probe = fixture(app)
            app.expose(); probe.publish("before-snapshot")
            let name = "callback-" + mode
            let target = probe.output.deletingLastPathComponent().appendingPathComponent(name + ".png")
            try? FileManager.default.removeItem(at: target)
            I1Transport.holdSnapshot = true
            var completions = 0, successes = 0
            let task = Task {
                do { try await probe.capture(name); successes += 1; probe.publish("snapshot-success") }
                catch {}
                completions += 1
            }
            let entered = await eventually { !I1Transport.snapshots.isEmpty }
            let callback = I1Transport.snapshots.first?.callback
            let armed = !I1Dispatch.timers.isEmpty
            if mode == "view" { app.replace(); app.expose() }
            if mode == "generation" { app.recovery.documentGeneration += 1 }
            if mode == "stop" { probe.prepareForStop() }
            if mode == "error" {
                var pending = I1Transport.snapshots.removeFirst()
                pending.callback(nil, PreviewError.message("current snapshot error")); pending.owner = nil
            } else { I1Transport.finishSnapshot() }
            if mode == "duplicate" && armed {
                callback?(NSImage(size: .zero), nil)
                callback?(nil, PreviewError.message("duplicate error"))
            }
            await task.value
            I1Dispatch.expire()
            let shouldSucceed = mode == "success" || mode == "duplicate"
            check("normal-snapshot-callback-" + mode, entered && completions == 1 &&
                successes == (shouldSucceed ? 1 : 0) && (mode != "duplicate" || armed) &&
                FileManager.default.fileExists(atPath: target.path) == shouldSucceed &&
                (shouldSucceed ? probe.evidence["stage"] as? String == "snapshot-success" :
                    probe.evidence["stage"] as? String == "before-snapshot"))
        }
        I1Transport.reset()
        return rows
    }
}
#endif

@main enum InstanceCurrentViewFixture {
    @MainActor static func main() async throws {
        let red = CommandLine.arguments.contains("--red-only")
        let results = try await InstanceSmoke.runControls(redOnly: red)
        let failed = results.filter { $0["pass"] as? Bool != true }
        let summary: [String: Any] = ["kind": "I1-maintained-owner-controls", "results": results,
                                     "total": results.count, "failed": failed.count, "red_only": red,
                                     "native_acceptance": false]
        print(String(data: try JSONSerialization.data(withJSONObject: summary, options: [.sortedKeys]), encoding: .utf8)!)
        if !failed.isEmpty { exit(3) }
    }
}
