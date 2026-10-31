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
        try await wait("production create-chat UI") {
            try await self.js("return [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Create chat' && !b.disabled)") as? Bool == true
        }
        _ = try await js("document.querySelectorAll('button').forEach(b => { if (b.textContent.trim() === 'Create chat') b.click() }); return true")
        try await wait("session composer") { try await self.js("return !!document.querySelector('[role=combobox][aria-label=Message]')") as? Bool == true }
        _ = try await js("document.querySelector('[role=combobox][aria-label=Message]').focus(); return true")
        try await wait("current document UI command owner") { self.commands.smokeSnapshot["ready"] as? Bool == true }
        try await wait("current menu focus owner") { self.commands.smokeSnapshot["available"] as? Bool == true }
        var inputEvidence: [String: Any]?
        if trustedInput {
            let external = CommandLine.arguments.contains("--commands-external")
            guard !external || captures != nil else { throw PreviewError.message("External driver requires a fixture output directory") }
            inputEvidence = try await NativeCommandInput(app: app, commands: commands).run(externalDirectory: external ? captures : nil)
        }
        let first = commands.smokeSnapshot
        try perform(menu: "NAC", title: "Settings…")
        try await dialog("Configurations", visible: true)
        try await capture("settings", trustedInput: trustedInput, directory: captures)
        guard delta("dispatches", first) == 1 else { throw PreviewError.message("Settings was not dispatched once") }
        try await closeDialog()
        try await wait("composer focus restoration") { try await self.js("return document.activeElement?.getAttribute('aria-label') === 'Message'") as? Bool == true }
        let beforeNew = commands.smokeSnapshot
        try perform(menu: "File", title: "New Session")
        try await dialog("New Chat", visible: true)
        try await capture("new-chat", trustedInput: trustedInput, directory: captures)
        guard delta("dispatches", beforeNew) == 1 else { throw PreviewError.message("New Session was not dispatched once") }
        try await closeDialog()
        try await wait("second composer focus restoration") { try await self.js("return document.activeElement?.getAttribute('aria-label') === 'Message'") as? Bool == true }
        let sessionHash = try await js("return location.hash") as! String
        let beforeProjects = commands.smokeSnapshot
        try perform(menu: "View", title: "Projects")
        try await wait("shared Projects navigation") { try await self.js("return location.hash === '#/'") as? Bool == true }
        guard delta("dispatches", beforeProjects) == 1, commands.smokeSnapshot["ready"] as? Bool == true else {
            throw PreviewError.message("Projects navigation duplicated dispatch or retired a same-document bridge")
        }
        _ = try await js("history.back(); return true")
        try await wait("session route restored") {
            try await self.js("return location.hash === expected && !!document.querySelector('[role=combobox][aria-label=Message]')", arguments: ["expected": sessionHash]) as? Bool == true
        }
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
        let beforeBad = commands.smokeSnapshot
        let binding = beforeBad["binding"] as! [String: Any]
        let request = beforeBad["request"] as! Int
        let base: [String: Any] = ["version": 1, "kind": "ready", "launch": binding["launch"]!, "view": binding["view"]!, "document": binding["document"]!]
        // These traverse the actual WKScriptMessage boundary, not a parser mock.
        _ = try await js(#"""
        const post = x => webkit.messageHandlers.nacUIReceipt.postMessage(x);
        post('{bad'); post('x'.repeat(2049)); post({version:1});
        for (const key of ['launch','view','document','version','kind'])
          post(JSON.stringify({...record,[key]:'wrong'}));
        post(JSON.stringify({...record,extra:true}));
        post(JSON.stringify(record));
        post(JSON.stringify({...record,kind:'settled',request,accepted:true}));
        const frame = document.createElement('iframe');
        frame.srcdoc = '<script>webkit.messageHandlers.nacUIReceipt.postMessage('+JSON.stringify(JSON.stringify(record))+')<'+'/script>';
        document.body.append(frame);
        return true;
        """#, arguments: ["record": base, "request": request])
        try await wait("rejected actual WK messages") { self.delta("rejected", beforeBad) >= 12 }
        guard delta("dispatches", beforeBad) == 0 else { throw PreviewError.message("Web receipt dispatched a native command") }
        let beforeForeign = commands.smokeSnapshot
        let other = WKWebView(frame: .zero, configuration: app.webView.configuration)
        other.loadHTMLString("<body id='foreign-view'></body>", baseURL: app.baseURL)
        try await wait("secondary fixture WebView") {
            (try? await other.callAsyncJavaScript("return document.body?.id === 'foreign-view'", arguments: [:], in: nil, contentWorld: .page)) as? Bool == true
        }
        _ = try await other.callAsyncJavaScript("webkit.messageHandlers.nacUIReceipt.postMessage(JSON.stringify(record)); return true", arguments: ["record": base], in: nil, contentWorld: .page)
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
        return ["menu_dispatch": "programmatic-NSMenu", "settings_once": true, "new_session_once": true,
                "shared_focus_restored": true, "projects_once_same_document": true, "foreign_window_rejected": true, "negative_WK_receipts": rejected, "initial_bridge": first, "final_bridge": final,
                "navigation_popup_restricted": true, "document_replaced": true, "retired": true,
                "trusted_keyboard_edit_qualified": trustedInput, "input": inputEvidence ?? [:]]
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
    private func dialog(_ title: String, visible: Bool) async throws {
        try await wait("dialog \(title)") {
            try await self.js("return [...document.querySelectorAll('[role=dialog]')].some(d => d.textContent.includes(title)) === visible",
                              arguments: ["title": title, "visible": visible]) as? Bool == true
        }
    }
    private func closeDialog() async throws {
        _ = try await js("document.querySelector('[role=dialog] button[aria-label=Close]')?.click(); return true")
        try await wait("dialog closed") { try await self.js("return !document.querySelector('[role=dialog]')") as? Bool == true }
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
#endif
