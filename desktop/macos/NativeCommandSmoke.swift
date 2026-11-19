#if PREVIEW_SMOKE
import AppKit
import WebKit

/// Actual app fixture. Programmatic NSMenu dispatch is recorded explicitly;
/// it does not qualify OS keyboard or trusted Edit provenance.
@MainActor
final class NativeCommandSmoke {
    private unowned let app: PreviewApp
    private let commands: NativeCommands
    init(app: PreviewApp, commands: NativeCommands) { self.app = app; self.commands = commands }

    func run(trustedInput: Bool = false, captures: URL? = nil) async throws -> [String: Any] {
        // Home's composer is the one new-session flow; Start session sends the
        // typed prompt as the session's first run, then opens the session.
        try await wait("production Home composer") {
            try await self.js("const f = document.getElementById('home-composer'); return !!f && !f.disabled && [...f.labels].some(l => l.textContent.trim() === 'What should we work on?')") as? Bool == true
        }
        try await wait("model selection control") {
            try await self.js("const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Choose a model');if(!b)return false;b.click();return true") as? Bool == true
        }
        try await wait("model search") {
            try await self.js("""
            if (document.querySelector('input[aria-label="Search models"]')) return true;
            const b=document.querySelector('[role=dialog] [role=group] button[aria-expanded]');
            if (b && !b.disabled && b.getAttribute('aria-expanded') === 'false') b.click();
            return false;
            """) as? Bool == true
        }
        _ = try await js("""
        const f=document.querySelector('input[aria-label="Search models"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(f,'gpt-5.6-sol');
        f.dispatchEvent(new Event('input',{bubbles:true})); return true;
        """)
        try await wait("fixture OpenAI model") {
            try await self.js("""
            const b=[...document.querySelectorAll('[aria-label="Model results"] button[data-row]')]
                .find(b=>b.parentElement?.textContent.includes('OpenAI') && b.textContent.toLowerCase().includes('gpt-5.6'));
            if (!b) return false; b.click(); return true;
            """) as? Bool == true
        }
        try await wait("available session model") {
            try await self.js("const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Use this model'&&!b.disabled);if(!b)return false;b.click();return true") as? Bool == true
        }
        _ = try await js("const f = document.getElementById('home-composer'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(f, 'Native command fixture session'); f.dispatchEvent(new Event('input', {bubbles: true})); return true")
        try await wait("production Start session") {
            try await self.js("const b = document.querySelector('button[aria-label=\"Start session\"]'); if (!b || b.disabled) return false; b.click(); return true") as? Bool == true
        }
        try await wait("session composer") { try await self.js("return /^#\\/session\\//.test(location.hash) && !!document.querySelector('[role=combobox][aria-label=Message]')") as? Bool == true }
        _ = try await js("document.querySelector('[role=combobox][aria-label=Message]').focus(); return true")
        try await wait("current document UI command owner") { self.commands.smokeSnapshot["ready"] as? Bool == true }
        try await retirementBoundary(captures: captures)
        let boundary = try await receiptBoundary(captures: captures)
        let beforeBad = boundary.before
        let base = boundary.record
        try await wait("current menu focus owner") { self.commands.smokeSnapshot["available"] as? Bool == true }
        var inputEvidence: [String: Any]?
        if trustedInput {
            let external = CommandLine.arguments.contains("--commands-external")
            guard !external || captures != nil else { throw PreviewError.message("External driver requires a fixture output directory") }
            inputEvidence = try await NativeCommandInput(app: app, commands: commands).run(externalDirectory: external ? captures : nil)
        }
        let first = commands.smokeSnapshot
        let sessionHash = try await js("return location.hash") as! String
        let originalSize = app.webView.bounds.size
        var settingsDisplays: [[String: Any]] = []
        do {
            defer { app.window.setContentSize(originalSize) }
            // Keep the initial size and also exercise the compact route without
            // enlarging the owned window beyond the host's existing bounds.
            for (index, width) in [originalSize.width, min(920, originalSize.width)].enumerated() {
                app.window.setContentSize(NSSize(width: width, height: originalSize.height))
                try await wait("current menu focus owner") { self.commands.smokeSnapshot["available"] as? Bool == true }
                let beforeSettings = commands.smokeSnapshot
                try perform(menu: "NAC", title: "Settings…")
                try await settingsPage()
                let display = try await js("return {inner_width: innerWidth, inner_height: innerHeight, dpr: devicePixelRatio, narrow: matchMedia('(max-width: 1023.98px)').matches}") as! [String: Any]
                settingsDisplays.append(display.merging(["webview_width": app.webView.bounds.width, "window_content_width": app.window.contentLayoutRect.width]) { _, new in new })
                try await capture(index == 0 ? "settings" : "settings-compact", trustedInput: trustedInput, directory: captures)
                guard delta("dispatches", beforeSettings) == 1 else { throw PreviewError.message("Settings was not dispatched once") }
                try await leaveSettings()
                try await sessionRoute(sessionHash)
                try await wait("composer focus restoration") { try await self.js("return document.activeElement?.getAttribute('aria-label') === 'Message'") as? Bool == true }
            }
        }
        guard settingsDisplays.last?["narrow"] as? Bool == true else {
            throw PreviewError.message("Settings fixture did not exercise compact navigation")
        }
        let beforeNew = commands.smokeSnapshot
        try perform(menu: "File", title: "New Session")
        try await homeComposer()
        try await capture("new-chat", trustedInput: trustedInput, directory: captures)
        guard delta("dispatches", beforeNew) == 1 else { throw PreviewError.message("New Session was not dispatched once") }
        // New Session opens Home's composer, not a layer: go back to the
        // session and give its composer the focus again.
        _ = try await js("history.back(); return true")
        try await sessionRoute(sessionHash)
        _ = try await js("document.querySelector('[role=combobox][aria-label=Message]').focus(); return true")
        try await wait("second composer focus restoration") { try await self.js("return document.activeElement?.getAttribute('aria-label') === 'Message'") as? Bool == true }
        let beforeProjects = commands.smokeSnapshot
        try perform(menu: "View", title: "Projects")
        try await wait("shared Projects navigation") { try await self.js("return location.hash === '#/'") as? Bool == true }
        guard delta("dispatches", beforeProjects) == 1, commands.smokeSnapshot["ready"] as? Bool == true else {
            throw PreviewError.message("Projects navigation duplicated dispatch or retired a same-document bridge")
        }
        _ = try await js("history.back(); return true")
        try await sessionRoute(sessionHash)
        guard NSApp.isActive, app.window.isKeyWindow else { throw PreviewError.message("Fixture lost its foreground window") }
        let otherWindow = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 240, height: 120), styleMask: [.titled], backing: .buffered, defer: false)
        otherWindow.isReleasedWhenClosed = false
        otherWindow.makeKeyAndOrderFront(nil)
        let beforeForeignWindow = commands.smokeSnapshot
        try perform(menu: "NAC", title: "Settings…")
        guard delta("dispatches", beforeForeignWindow) == 0 else { throw PreviewError.message("A foreign key window dispatched a workspace command") }
        let stillOwnsFocus = NSApp.isActive && otherWindow.isKeyWindow && NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid()
        otherWindow.close()
        guard stillOwnsFocus else { throw PreviewError.message("User changed focus; refusing fixture focus restoration") }
        // Closing our own key window restores AppKit's previous responder.
        try await wait("owned main window restored") { self.app.window.isKeyWindow }
        _ = try await js("document.querySelector('[role=combobox][aria-label=Message]').focus(); return true")
        let old = commands.smokeSnapshot["binding"] as! [String: Any]
        app.webView.reload()
        try await wait("new document bridge") {
            guard let next = self.commands.smokeSnapshot["binding"] as? [String: Any] else { return false }
            return next["document"] as? String != old["document"] as? String && self.commands.smokeSnapshot["ready"] as? Bool == true
        }
        let beforeOld = commands.smokeSnapshot
        _ = try await js("webkit.messageHandlers.nacUIReceipt.postMessage(JSON.stringify(record)); return true", arguments: ["record": base])
        try await wait("stale document rejected") { self.delta("rejected", beforeOld) == 1 }
        let final = commands.smokeSnapshot
        let rejected = delta("rejected", beforeBad)
        commands.retire()
        guard commands.smokeSnapshot["installed"] as? Bool == false else { throw PreviewError.message("Retired bridge remained installed") }
        return ["menu_dispatch": "programmatic-NSMenu", "settings_once": true, "settings_displays": settingsDisplays, "new_session_once": true,
                "shared_focus_restored": true, "projects_once_same_document": true, "foreign_window_rejected": true, "negative_WK_receipts": rejected, "initial_bridge": first, "final_bridge": final,
                "navigation_popup_restricted": true, "document_replaced": true, "retired": true,
                "trusted_keyboard_edit_qualified": trustedInput, "input": inputEvidence ?? [:]]
    }

    /// A separate owned document runs the exact production user script. Removing
    /// its handler cannot affect the workspace's controller or command owner.
    private func retirementBoundary(captures: URL?) async throws {
        let probe = NativeCommandReceiptProbe()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let controller = configuration.userContentController
        controller.add(probe, contentWorld: .page, name: NativeCommandScript.handler)
        controller.addUserScript(NativeCommandScript.userScript)
        let view = WKWebView(frame: .zero, configuration: configuration)
        defer {
            controller.removeScriptMessageHandler(forName: NativeCommandScript.handler, contentWorld: .page)
            controller.removeAllUserScripts()
            view.stopLoading()
        }
        view.loadHTMLString("<!doctype html><title>Owned command retirement fixture</title>", baseURL: app.baseURL)
        try await wait("owned WK retirement document") {
            (try? await view.callAsyncJavaScript("return !!window.__nacDesktop", arguments: [:], in: nil, contentWorld: .page)) as? Bool == true
        }
        let control = try await view.callAsyncJavaScript(#"""
        const port = window.__nacDesktop;
        const f = window.__nativeRetirementFixture = {
          binding: {launch:'fixture-launch',view:'fixture-view',document:'fixture-document'}, calls:0
        };
        const check = (value, label) => { if (!value) throw new Error(label); };
        f.callback = () => { f.calls++; return true; };
        f.oldCleanup = port.connect(f.callback);
        check(port.activate(f.binding), 'activate');
        f.oldCleanup(); f.oldCleanup();
        check(!port.dispatch(f.binding,{request:1}), 'unregistered dispatch');
        f.cleanup = port.connect(f.callback);
        f.oldCleanup();
        check(port.dispatch(f.binding,{request:2}) && f.calls === 1, 'same callback stale cleanup');
        f.calls = 0;
        return {same_callback_reconnect:true,positive_control_calls:1};
        """#, arguments: [:], in: nil, contentWorld: .page) as! [String: Any]
        try await wait("actual WK unregister receipt") { probe.kinds == ["ready", "retired", "ready", "settled"] }
        controller.removeScriptMessageHandler(forName: NativeCommandScript.handler, contentWorld: .page)
        let unregister = try await view.callAsyncJavaScript(#"""
        const f = window.__nativeRetirementFixture, port = window.__nacDesktop;
        let threw = false;
        try { f.cleanup(); } catch { threw = true; }
        f.cleanup();
        const delivered = port.dispatch(f.binding,{request:3});
        if (!threw || delivered || f.calls !== 0) throw new Error('removed-handler cleanup retained owner');
        return {unregister_threw:threw,late_dispatch:delivered,owner_calls:f.calls};
        """#, arguments: [:], in: nil, contentWorld: .page) as! [String: Any]
        controller.add(probe, contentWorld: .page, name: NativeCommandScript.handler)
        _ = try await view.callAsyncJavaScript("const f = window.__nativeRetirementFixture; f.cleanup = window.__nacDesktop.connect(f.callback); f.oldCleanup(); return true", arguments: [:], in: nil, contentWorld: .page)
        try await wait("actual WK replacement ready receipt") { probe.kinds == ["ready", "retired", "ready", "settled", "ready"] }
        controller.removeScriptMessageHandler(forName: NativeCommandScript.handler, contentWorld: .page)
        let retirement = try await view.callAsyncJavaScript(#"""
        const f = window.__nativeRetirementFixture, port = window.__nacDesktop;
        port.retire({...f.binding,document:'stale'});
        let settlementThrew = false;
        try { port.dispatch(f.binding,{request:4}); } catch { settlementThrew = true; }
        const stillOwned = f.calls === 1 && settlementThrew;
        if (!stillOwned) throw new Error('stale retirement removed owner');
        f.calls = 0;
        port.retire(f.binding); port.retire(f.binding); f.cleanup(); f.oldCleanup();
        const delivered = port.dispatch(f.binding,{request:5});
        let terminal = false;
        try { port.connect(f.callback); } catch { terminal = true; }
        if (delivered || f.calls !== 0 || !terminal || port.activate(f.binding))
          throw new Error('matching retirement retained owner');
        return {stale_retire_preserved_owner:stillOwned,repeat_cleanup_safe:true,
                late_dispatch:delivered,owner_calls:f.calls,terminal};
        """#, arguments: [:], in: nil, contentWorld: .page) as! [String: Any]
        if let captures {
            let receiptURL = Bundle.main.resourceURL!.appendingPathComponent("build-receipt.json")
            let receipt = try JSONSerialization.jsonObject(with: Data(contentsOf: receiptURL)) as! [String: Any]
            let hashes = receipt["native_source_files"] as! [String: String]
            let evidence: [String: Any] = ["scope": "actual-WK-page-retirement-only", "control": control,
                "removed_handler_unregister": unregister, "removed_handler_retirement": retirement,
                "receipt_kinds": probe.kinds, "source_head": receipt["source_head"]!,
                "source_dirty": receipt["source_dirty"]!, "script_file_sha256": hashes["desktop/macos/NativeCommandScript.swift"]!,
                "native_sha256": receipt["native_sha256"]!, "native_menu_qualified": false, "OS_input_qualified": false]
            let data = try JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: captures.appendingPathComponent("commands-WK-retirement.json"), options: .atomic)
        }
    }

    /// Runs on the real system WebView before any foreground-only operation.
    /// These receipts cannot select commands; locked runs still test the boundary.
    private func receiptBoundary(captures: URL?) async throws -> (before: [String: Any], record: [String: Any]) {
        let beforeBad = commands.smokeSnapshot
        let binding = beforeBad["binding"] as! [String: Any]
        let request = beforeBad["request"] as! Int
        let base: [String: Any] = ["version": 1, "kind": "ready", "launch": binding["launch"]!, "view": binding["view"]!, "document": binding["document"]!]
        // Matching main-frame retirement is a positive control for the exact
        // payload later sent from a child frame and a foreign WebView.
        _ = try await js("webkit.messageHandlers.nacUIReceipt.postMessage(JSON.stringify({...record,kind:'retired'})); return true", arguments: ["record": base])
        try await wait("main-frame retirement receipt accepted") { self.commands.smokeSnapshot["ready"] as? Bool == false }
        _ = try await js("webkit.messageHandlers.nacUIReceipt.postMessage(JSON.stringify(record)); return true", arguments: ["record": base])
        try await wait("main-frame owner readiness restored") { self.commands.smokeSnapshot["ready"] as? Bool == true }
        // These traverse the actual WKScriptMessage boundary, not a parser mock.
        let origins = try await js(#"""
        const post = x => webkit.messageHandlers.nacUIReceipt.postMessage(x);
        post('{bad'); post('x'.repeat(2049)); post({version:1});
        for (const key of ['launch','view','document','version','kind'])
          post(JSON.stringify({...record,[key]:'wrong'}));
        post(JSON.stringify({...record,extra:true}));
        post(JSON.stringify(record));
        post(JSON.stringify({...record,kind:'settled',request,accepted:true}));
        const frame = document.createElement('iframe');
        document.body.append(frame);
        frame.contentWindow.eval('webkit.messageHandlers.nacUIReceipt.postMessage('+JSON.stringify(JSON.stringify({...record,kind:'retired'}))+')');
        return {main:window.origin,frame:frame.contentWindow.origin};
        """#, arguments: ["record": base, "request": request]) as! [String: String]
        guard origins["main"] == origins["frame"] else { throw PreviewError.message("Child frame did not retain the verified origin") }
        try await wait("rejected actual WK messages") { self.delta("rejected", beforeBad) >= 12 }
        guard delta("dispatches", beforeBad) == 0 else { throw PreviewError.message("Web receipt dispatched a native command") }
        let beforeForeign = commands.smokeSnapshot
        let other = WKWebView(frame: .zero, configuration: app.webView.configuration)
        other.load(URLRequest(url: app.baseURL!.appendingPathComponent("health")))
        try await wait("secondary fixture WebView") {
            (try? await other.callAsyncJavaScript("return location.pathname === '/health' && document.readyState === 'complete'", arguments: [:], in: nil, contentWorld: .page)) as? Bool == true
        }
        let foreignOrigin = try await other.callAsyncJavaScript("return window.origin", arguments: [:], in: nil, contentWorld: .page) as? String
        guard foreignOrigin == origins["main"] else { throw PreviewError.message("Foreign WebView did not retain the verified origin") }
        _ = try await other.callAsyncJavaScript("webkit.messageHandlers.nacUIReceipt.postMessage(JSON.stringify({...record,kind:'retired'})); return true", arguments: ["record": base], in: nil, contentWorld: .page)
        try await wait("actual foreign WebView rejected") { self.delta("rejected", beforeForeign) == 1 }
        other.stopLoading()
        let address = app.webView.url!
        // No popup can become a shell-owned WebView.
        let popup = try await js("return window.open('https://example.invalid/') === null") as? Bool
        guard popup == true, app.webView.url == address else { throw PreviewError.message("Popup escaped navigation policy") }
        _ = try await js("const f = document.createElement('iframe'); f.src = 'https://example.invalid/'; document.body.append(f); return true")
        app.webView.load(URLRequest(url: URL(string: "https://example.invalid/")!))
        try await Task.sleep(nanoseconds: 200_000_000)
        guard app.webView.url == address else { throw PreviewError.message("Untrusted navigation replaced the workspace") }
        guard commands.smokeSnapshot["ready"] as? Bool == true else { throw PreviewError.message("Rejected frame/view/navigation retired the current owner") }
        if let captures {
            let evidence: [String: Any] = ["scope": "actual-WK-message-boundary-only", "before": beforeBad,
                "after": commands.smokeSnapshot, "wrong_frame_and_view_rejected": true, "matching_main_frame_control_accepted": true, "origins": origins, "foreign_view_origin": foreignOrigin ?? "", "untrusted_navigation_rejected": true,
                "native_menu_qualified": false, "OS_input_qualified": false]
            let data = try JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: captures.appendingPathComponent("commands-message-boundary.json"), options: .atomic)
        }
        return (beforeBad, base)
    }

    private func capture(_ name: String, trustedInput: Bool, directory: URL?) async throws {
        guard let directory else { return }
        let image = try await app.webView.takeSnapshot(configuration: nil)
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else {
            throw PreviewError.message("Command fixture snapshot encoding failed")
        }
        let prefix = trustedInput ? "commands-input" : "commands"
        try png.write(to: directory.appendingPathComponent("\(prefix)-\(name).png"))
    }

    private func delta(_ key: String, _ before: [String: Any]) -> Int {
        (commands.smokeSnapshot[key] as? Int ?? 0) - (before[key] as? Int ?? 0)
    }
    private func perform(menu title: String, title itemTitle: String) throws {
        let selected = title == "NAC" ? NSApp.mainMenu?.items.first : NSApp.mainMenu?.items.first(where: { $0.title == title })
        guard let menu = selected?.submenu,
              let index = menu.items.firstIndex(where: { $0.title == itemTitle }) else {
            throw PreviewError.message("Native command menu is missing")
        }
        menu.performActionForItem(at: index)
    }
    /// The shared Settings command opens the Settings page on Models & providers.
    private func settingsPage() async throws {
        try await wait("Settings Models & providers page") {
            try await self.js("const label = matchMedia('(max-width: 1023.98px)').matches ? 'Settings' : 'Back'; return location.hash === '#/settings/models' && !document.querySelector('[role=dialog]') && [...document.querySelectorAll('main[aria-label=\"Models & providers\"]')].some(m => m.getClientRects().length) && [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === label && !b.disabled && b.getClientRects().length).length === 1") as? Bool == true
        }
    }
    private static let settingsBackScript = #"""
    const targets = [...document.querySelectorAll('button')].filter(b =>
      b.textContent.trim() === label && !b.disabled && b.getClientRects().length);
    if (targets.length !== 1) return false;
    targets[0].click(); return true;
    """#

    /// Compact Settings pushes a section over its list; desktop leaves directly.
    private func leaveSettings() async throws {
        if try await js(Self.settingsBackScript, arguments: ["label": "Settings"]) as? Bool == true {
            try await wait("Settings section list") {
                try await self.js("return location.hash === '#/settings' && !!document.querySelector('nav[aria-label=\"Settings sections\"]')") as? Bool == true
            }
        }
        guard try await js(Self.settingsBackScript, arguments: ["label": "Back"]) as? Bool == true else {
            throw PreviewError.message("Settings Back control was not uniquely available")
        }
    }

    /// The shared New Session command opens Home's composer for the session's project.
    private func homeComposer() async throws {
        try await wait("Home composer for the session's project") {
            try await self.js("const f = document.getElementById('home-composer'); return location.hash.startsWith('#/?project=') && !!f && document.activeElement === f && !document.querySelector('[role=dialog]')") as? Bool == true
        }
    }
    private func sessionRoute(_ expected: String) async throws {
        try await wait("session route \(expected)") {
            try await self.js("return location.hash === expected && !!document.querySelector('[role=combobox][aria-label=Message]')", arguments: ["expected": expected]) as? Bool == true
        }
    }
    private func js(_ source: String, arguments: [String: Any] = [:]) async throws -> Any {
        try await app.webView.callAsyncJavaScript(source, arguments: arguments, in: nil, contentWorld: .page) ?? NSNull()
    }
    private func wait(_ label: String, condition: () async throws -> Bool) async throws {
        let end = Date().addingTimeInterval(20)
        while Date() < end {
            if let failure = app.failure { throw PreviewError.message(failure) }
            if try await condition() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw PreviewError.message("Timed out waiting for \(label); bridge snapshot: \(commands.smokeSnapshot)")
    }
}

@MainActor
private final class NativeCommandReceiptProbe: NSObject, WKScriptMessageHandler {
    var kinds: [String] = []
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? String, let data = body.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let kind = object["kind"] as? String else { return }
        kinds.append(kind)
    }
}
#endif
