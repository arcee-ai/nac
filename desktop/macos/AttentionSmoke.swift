import AppKit
import WebKit

/// Actual LOCAL_APP/WK journey with an injected center, never system banners.
/// This source is compiled only by the explicit attention fixture build.
@MainActor
final class AttentionSmokeDelivery: NativeAttentionDelivery {
    var response: ((NativeAttentionDestination) -> Void)?
    var shouldPresent: ((NativeAttentionDestination) -> Bool)?
    private(set) var added: [NativeAttentionDestination] = []
    private(set) var titles: [String] = []
    private(set) var requests = 0
    private(set) var retired = false
    var allowed = false
    var hold = false
    private var waiting: [(Bool) -> Void] = []
    private var presentIDs: Set<String> = []
    func settings(_ completion: @escaping (NativeNotificationAuthorization) -> Void) {
        completion(.init(allowed: allowed, mayRequest: requests == 0))
    }
    func authorize(_ completion: @escaping (Bool) -> Void) { requests += 1; allowed = true; completion(true) }
    func add(_ destination: NativeAttentionDestination, title: NativeAttentionTitle, completion: @escaping (Bool) -> Void) {
        precondition(!retired)
        added.append(destination); titles.append(title.rawValue); presentIDs.insert(destination.identifier)
        if hold { waiting.append(completion) } else { completion(true) }
    }
    func present(_ destination: NativeAttentionDestination, completion: @escaping (Bool) -> Void) { completion(presentIDs.contains(destination.identifier)) }
    func withdraw(_ identifiers: [String]) { presentIDs.subtract(identifiers) }
    func withdrawProfile(_ profile: String) { presentIDs.removeAll() }
    func retire() { retired = true; response = nil; shouldPresent = nil }
    func release() { let pending = waiting; waiting.removeAll(); pending.forEach { $0(true) } }
    func click() { if let target = added.last { response?(target) } }
    var snapshot: [String: Any] {
        ["adds": added.count, "permission_requests": requests, "titles": titles,
         "pending_ack": waiting.count, "present": presentIDs.count, "retired": retired,
         "foreground_delivery_allowed": added.last.map { shouldPresent?($0) ?? false } ?? false]
    }
}

@MainActor
final class AttentionSmoke {
    private unowned let app: PreviewApp
    let delivery: AttentionSmokeDelivery
    private let output: URL
    private let control: URL
    private var timer: Timer?
    private var seen: Set<String> = []
    private var stage = "starting"
    private var error: String?
    private var commandBusy = false
    private var controlRetired = false
    private let controlNonce = UUID().uuidString
    private weak var originalView: WKWebView?
    private var originalPID: Int32 = 0
    private var passed = false
    private var draft: String?
    init(app: PreviewApp, delivery: AttentionSmokeDelivery) {
        self.app = app; self.delivery = delivery
        let args = CommandLine.arguments
        func value(_ key: String) -> String { args[args.firstIndex(of: key)! + 1] }
        output = URL(fileURLWithPath: value("--instance-output"))
        control = URL(fileURLWithPath: value("--instance-control"))
    }
    static func launchArguments(_ args: [String]) -> [String] {
        var result: [String] = [], index = 0
        while index < args.count {
            if args[index].hasPrefix("--instance-") { index += 2 }
            else { result.append(args[index]); index += 1 }
        }
        return result
    }
    func start() {
        timer = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
        RunLoop.main.add(timer!, forMode: .common)
        publish()
    }
    private func poll() {
        if let failure = app.failure { error = failure; stage = "failed" }
        if stage == "starting", !app.webView.isHidden, app.attentionSmokeSnapshot["loaded"] as? Bool == true {
            originalView = app.webView; originalPID = app.engine.pid; stage = "ready"
        }
        if !commandBusy, let files = try? FileManager.default.contentsOfDirectory(at: control, includingPropertiesForKeys: nil),
           let file = files.filter({ $0.lastPathComponent.hasPrefix("attention-") && !seen.contains($0.lastPathComponent) }).sorted(by: { $0.lastPathComponent < $1.lastPathComponent }).first {
            seen.insert(file.lastPathComponent); commandBusy = true
            Task {
                defer { self.commandBusy = false; self.publish() }
                do {
                    let command = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: String]
                    try await self.perform(command)
                    self.stage = file.deletingPathExtension().lastPathComponent
                } catch { self.error = String(describing: error); self.stage = "failed" }
            }
        }
        publish()
    }
    private func perform(_ command: [String: String]) async throws {
        do {
            guard !controlRetired || command["action"] == "cleanup" else { throw DesktopStartupError.message("Fixture controls retired") }
            try AttentionFixtureGuard.validate(command, nonce: controlNonce, window: app.window)
        } catch { controlRetired = true; throw error }
        switch command["action"] {
        case "enable", "mute", "reset", "clear":
            let label = ["enable": "Enable notifications", "mute": "Mute notifications",
                         "reset": "Reset notification settings", "clear": "Clear completion indicator"][command["action"]!]!
            let root = NSApp.mainMenu?.items.first?.submenu?.items.first { $0.title == "Notifications" }
            guard let item = root?.submenu?.items.first(where: { $0.title == label }), item.isEnabled,
                  let action = item.action, NSApp.sendAction(action, to: item.target, from: item) else {
                throw DesktopStartupError.message("Native notification action unavailable")
            }
        case "close": app.window.performClose(nil)
        case "click": delivery.click()
        case "hold": delivery.hold = true
        case "release": delivery.release(); delivery.hold = false
        case "draft":
            draft = command["text"]!
            let encoded = String(decoding: try JSONSerialization.data(withJSONObject: draft!, options: [.fragmentsAllowed]), as: UTF8.self)
            _ = try await js("const e=document.querySelector('[role=combobox][aria-label=Message]'); if(!e)throw Error('No shared composer'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,\(encoded)); e.dispatchEvent(new Event('input',{bubbles:true})); return true;")
        case "assert-draft":
            let value = try await js("return document.querySelector('[role=combobox][aria-label=Message]')?.value;") as? String
            guard value == command["text"] else { throw DesktopStartupError.message("Close/reopen lost the retained shared draft") }
        case "reload": app.webView.reload()
        case "quit": NSApp.terminate(nil)
        case "cancel":
            guard let sheet = app.window.attachedSheet else { throw DesktopStartupError.message("No owned Quit sheet") }
            app.window.endSheet(sheet, returnCode: .alertFirstButtonReturn)
        case "finish": passed = true; app.quit.stopFixture()
        case "cleanup": controlRetired = true; passed = false; app.quit.stopFixture()
        default: throw DesktopStartupError.message("Unknown attention fixture action")
        }
    }
    private func js(_ source: String) async throws -> Any? {
        try await app.webView.callAsyncJavaScript(source, arguments: [:], in: nil, contentWorld: .page)
    }
    func didStop() { timer?.invalidate(); timer = nil; stage = "stopped"; publish(stopped: true) }
    private func publish(stopped: Bool = false) {
        var value: [String: Any] = ["app_pid": getpid(), "stage": stage, "passed": passed && error == nil,
            "control_nonce": controlNonce, "window_number": app.window.windowNumber, "app_active": NSApp.isActive,
            "stopped": stopped, "workspace_window_count": 1, "engine_pid": app.engine.pid,
            "window_visible": app.window.isVisible, "same_view": originalView === app.webView,
            "route": app.webView?.url?.fragment ?? "",
            "same_engine": originalPID == app.engine.pid, "center": delivery.snapshot,
            "attention": app.attentionSmokeSnapshot, "quit_confirming": app.window.attachedSheet != nil,
            "dock": NSApp.dockTile.badgeLabel ?? "", "native_os_delivery": false, "trusted_ime": false]
        if let receipt = app.engine.receipt {
            value["ready_source"] = receipt.identity?.source_revision; value["ready_store"] = receipt.store
            if let identity = receipt.identity, let store = receipt.store, let endpoint = receipt.endpoint {
                value["ready_receipt"] = ["kind": receipt.kind, "version": receipt.version, "incarnation": receipt.incarnation,
                    "endpoint": endpoint, "store": store, "schema": receipt.schema ?? 0,
                    "identity": ["product_version": identity.product_version, "build_id": identity.build_id,
                                 "source_revision": identity.source_revision, "track": identity.track]]
            }
        }
        value["base_url"] = app.baseURL?.absoluteString
        value["failure"] = error
        if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) { try? data.write(to: output, options: .atomic) }
    }
}
