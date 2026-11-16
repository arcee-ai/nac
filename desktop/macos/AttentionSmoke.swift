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
         "deliveries": zip(added, titles).prefix(16).map { target, title in
             ["session": target.session, "occurrence": target.occurrence,
              "identifier": target.identifier, "title": title]
         },
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
    private var chatReadiness: [String: Any] = [:]
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
        case "click": chatReadiness = [:]; delivery.click()
        case "inspect-chat": try await inspectChat(command)
        case "pause-observation": try app.attentionSmokeObservation(paused: true)
        case "resume-observation": try app.attentionSmokeObservation(paused: false)
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
        case "cleanup": controlRetired = true; passed = false; app.quit.cleanupAttentionFixture()
        default: throw DesktopStartupError.message("Unknown attention fixture action")
        }
    }
    // Read-only, fixture-local observation. No global registration, requests,
    // events, focus, scrolling or edits. Desktop Q1 layout only; fail closed
    // rather than searching title/sidebar text when that layout changes.
    private static let chatSource = #"""
    const actual = location.hash.slice(1);
    const canonical = '/session/'+encodeURIComponent(expected.session)+'/insights';
    const facts = {ready:false, route:actual, route_ok:actual===canonical && expected.route===canonical,
      scope_ok:false, loading:false, error:false, user_count:0, assistant_count:0, composer_ok:false};
    const visible = element => {
      if (!(element instanceof HTMLElement) || !element.isConnected) return false;
      let rect = element.getBoundingClientRect();
      let left=Math.max(0,rect.left), top=Math.max(0,rect.top);
      let right=Math.min(innerWidth,rect.right), bottom=Math.min(innerHeight,rect.bottom);
      for (let node=element; node; node=node.parentElement) {
        const style=getComputedStyle(node);
        if (node.hidden || node.inert || node.getAttribute('aria-hidden')==='true' ||
            style.display==='none' || style.visibility!=='visible' || Number(style.opacity)<0.99) return false;
        if (node!==element && /(auto|scroll|hidden|clip)/.test(style.overflow+style.overflowX+style.overflowY)) {
          const clip=node.getBoundingClientRect();
          left=Math.max(left,clip.left); top=Math.max(top,clip.top);
          right=Math.min(right,clip.right); bottom=Math.min(bottom,clip.bottom);
        }
      }
      if (!(right>left && bottom>top)) return false;
      const foreground=document.elementFromPoint((left+right)/2,(top+bottom)/2);
      return !!foreground && (element.contains(foreground) || foreground.contains(element));
    };
    const composers=[...document.querySelectorAll('textarea[role="combobox"][aria-label="Message"][data-nac-retained-draft]')];
    if (!facts.route_ok || composers.length!==1) return facts;
    const composer=composers[0], scopes=[];
    // SessionPage's desktop chat column has header, Transcript, composer layer.
    // Transcript always owns a direct status/loader as its first element.
    // Only that middle sibling is searched, never header or side-box content.
    for (let node=composer.parentElement; node; node=node.parentElement) {
      const children=[...node.children];
      if (children.length===3 && children[2].contains(composer) &&
          children[1].firstElementChild?.getAttribute('role')==='status') scopes.push(children[1]);
    }
    if (scopes.length!==1) return facts;
    const transcript=scopes[0]; facts.scope_ok=true;
    facts.loading=!!transcript.querySelector('[role="status"][aria-label="Loading conversation"]');
    facts.error=[...document.querySelectorAll('[role="alert"]')].some(visible);
    facts.user_count=[...transcript.querySelectorAll('div')].filter(node =>
      node.childNodes.length===1 && node.firstChild.nodeType===Node.TEXT_NODE &&
      node.textContent===expected.user && visible(node)).length;
    facts.assistant_count=[...transcript.querySelectorAll('p')].filter(node =>
      node.textContent===expected.assistant && visible(node)).length;
    facts.composer_ok=visible(composer) && !composer.disabled && !composer.readOnly && getComputedStyle(composer).pointerEvents!=='none';
    facts.ready=facts.scope_ok && !facts.loading && !facts.error &&
      facts.user_count===1 && facts.assistant_count===1 && facts.composer_ok;
    return facts;
    """#

    private func chatDocument() -> [String: String]? {
        guard let snapshot = app.commands?.smokeSnapshot,
              snapshot["installed"] as? Bool == true, snapshot["ready"] as? Bool == true,
              let binding = snapshot["binding"] as? [String: String],
              Set(binding.keys) == ["launch", "view", "document"] else { return nil }
        return binding
    }

    private func inspectChat(_ command: [String: String]) async throws {
        guard app.window.isVisible, app.window.isKeyWindow,
              let view = app.webView, let document = chatDocument(),
              let incarnation = app.engine.receipt?.incarnation,
              let generation = app.attentionSmokeSnapshot["generation"] as? UInt64,
              let session = command["session"], let route = command["route"],
              let user = command["user"], let assistant = command["assistant"], let sample = command["sample"],
              NativeSessionTarget.validID(session), sample.utf8.count <= 64,
              user.utf8.count <= 4096, assistant.utf8.count <= 4096, route.utf8.count <= 2048 else {
            throw DesktopStartupError.message("Chat observation owner unavailable")
        }
        let pid = app.engine.pid
        let expected = ["session": session, "route": route, "user": user, "assistant": assistant]
        let json = String(decoding: try JSONSerialization.data(withJSONObject: expected), as: UTF8.self)
        guard let expires = command["expires"].flatMap(TimeInterval.init) else {
            throw DesktopStartupError.message("Chat observation deadline unavailable")
        }
        let budget = min(0.75, expires - Date().timeIntervalSince1970)
        guard budget > 0,
              var result = try await js("const expected = \(json);\n" + Self.chatSource, timeout: budget) as? [String: Any] else {
            throw DesktopStartupError.message("Invalid chat observation")
        }
        // Re-check custody and the exact live document after the await. A late
        // read cannot acknowledge a successor document/engine/generation.
        do {
            try AttentionFixtureGuard.validate(command, nonce: controlNonce, window: app.window)
            guard !controlRetired, app.window.isVisible, app.window.isKeyWindow,
                  app.webView === view, app.engine.pid == pid,
                  app.engine.receipt?.incarnation == incarnation, chatDocument() == document,
                  app.attentionSmokeSnapshot["generation"] as? UInt64 == generation else {
                throw DesktopStartupError.message("Chat observation retired")
            }
        } catch { controlRetired = true; throw error }
        result["sample"] = sample; result["session"] = session
        result["document"] = document; result["generation"] = generation
        chatReadiness = result
    }

    private func js(_ source: String, timeout: TimeInterval? = nil) async throws -> Any? {
        guard let timeout else {
            return try await app.webView.callAsyncJavaScript(source, arguments: [:], in: nil, contentWorld: .page)
        }
        // Existing once/cancellation owner consumes both the bounded fallback
        // and any late callback; the returned JSON contains only fixture facts.
        let deadline = DispatchTime.now() + timeout
        let encoded: String? = await awaitNativeAttention(fallback: nil) { complete in
            app.webView.callAsyncJavaScript(source, arguments: [:], in: nil, in: .page) { result in
                guard DispatchTime.now() < deadline, case .success(let value) = result,
                      let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
                      data.count <= 8192, DispatchTime.now() < deadline else { complete(nil); return }
                complete(String(decoding: data, as: UTF8.self))
            }
            DispatchQueue.main.asyncAfter(deadline: deadline) { complete(nil) }
        }
        guard DispatchTime.now() < deadline, let encoded else { controlRetired = true; throw DesktopStartupError.message("Chat observation timed out") }
        let result = try JSONSerialization.jsonObject(with: Data(encoded.utf8), options: [.fragmentsAllowed])
        guard DispatchTime.now() < deadline else {
            controlRetired = true; throw DesktopStartupError.message("Chat observation timed out")
        }
        return result
    }
    func didStop() { timer?.invalidate(); timer = nil; stage = "stopped"; publish(stopped: true) }
    private func publish(stopped: Bool = false) {
        var value: [String: Any] = ["app_pid": getpid(), "stage": stage, "passed": passed && error == nil,
            "chat_readiness": chatReadiness, "document_binding": chatDocument() ?? [:],
            "control_nonce": controlNonce, "window_number": app.window.windowNumber, "app_active": NSApp.isActive,
            "cleanup_intent": app.quit.attentionFixtureCleanup, "cleanup_timeouts": app.quit.attentionFixtureCleanupTimeouts,
            "quit_sheet_presentations": app.quit.smokeSheetPresentations, "quit_stop_completions": app.quit.smokeStopCompletions,
            "quit_phase": String(describing: app.quit.lifecycle.phase),
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
