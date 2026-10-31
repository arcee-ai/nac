#if PREVIEW_SMOKE
import AppKit
import CoreGraphics
import WebKit

/// Fixture-only OS input. Never prompts for, changes or bypasses input privacy.
@MainActor
final class NativeCommandInput {
    private unowned let app: PreviewApp
    private let commands: NativeCommands
    init(app: PreviewApp, commands: NativeCommands) { self.app = app; self.commands = commands }

    func run() async throws -> [String: Any] {
        guard CGPreflightPostEventAccess() else {
            throw PreviewError.message("Trusted Edit fixture requires existing Quartz PostEventAccess")
        }
        try requireFocus()
        let board = NSPasteboard.general
        // Keep every prior representation in memory only. Never log contents.
        let prior = board.pasteboardItems?.map { item in
            item.types.compactMap { type -> (NSPasteboard.PasteboardType, Data)? in
                item.data(forType: type).map { (type, $0) }
            }
        } ?? []
        var ownedChange: Int?
        defer {
            if let ownedChange, board.changeCount == ownedChange {
                let items = prior.map { representations in
                    let item = NSPasteboardItem()
                    for (type, data) in representations { item.setData(data, forType: type) }
                    return item
                }
                board.clearContents()
                if !items.isEmpty { board.writeObjects(items) }
            }
        }
        _ = try await js(#"""
        window.__commandInputEvidence = [];
        for (const type of ['keydown','beforeinput','input','paste'])
          document.addEventListener(type, e => __commandInputEvidence.push({type, trusted:e.isTrusted}), true);
        return true;
        """#)
        let text = "NAC_NATIVE_EDIT_FIXTURE"
        try key(0, flags: .maskCommand) // Select All, through the real responder.
        try type(text)
        try await value(text)
        let beforeCopy = board.changeCount
        try key(0, flags: .maskCommand)
        try key(8, flags: .maskCommand) // Copy
        try await wait("fixture-owned native copy") { board.changeCount != beforeCopy }
        guard board.string(forType: .string) == text else { throw PreviewError.message("Native Copy did not copy fixture text") }
        ownedChange = board.changeCount
        try key(7, flags: .maskCommand) // Cut
        try await value("")
        guard board.string(forType: .string) == text else { throw PreviewError.message("Native Cut did not retain fixture text") }
        ownedChange = board.changeCount
        try key(9, flags: .maskCommand) // Paste
        try await value(text)
        try key(6, flags: .maskCommand) // Undo paste
        try await value("")
        try key(6, flags: [.maskCommand, .maskShift]) // Redo
        try await value(text)
        let beforeSettings = commands.smokeSnapshot["dispatches"] as! Int
        try key(43, flags: .maskCommand) // Settings
        try await dialog("Configurations", visible: true)
        try key(53)
        try await dialog("Configurations", visible: false)
        try await composerFocus()
        guard commands.smokeSnapshot["dispatches"] as? Int == beforeSettings + 1 else {
            throw PreviewError.message("Quartz Settings was not dispatched once")
        }
        let beforeNew = commands.smokeSnapshot["dispatches"] as! Int
        try key(45, flags: .maskCommand) // New Session
        try await dialog("New Chat", visible: true)
        try key(53)
        try await dialog("New Chat", visible: false)
        try await composerFocus()
        guard commands.smokeSnapshot["dispatches"] as? Int == beforeNew + 1 else {
            throw PreviewError.message("Quartz New Session was not dispatched once")
        }
        let events = try await js("return __commandInputEvidence") as? [[String: Any]] ?? []
        guard !events.isEmpty, events.allSatisfy({ $0["trusted"] as? Bool == true }),
              events.contains(where: { $0["type"] as? String == "paste" }),
              events.contains(where: { $0["type"] as? String == "input" }) else {
            throw PreviewError.message("OS input did not have trusted WK event provenance")
        }
        return ["source": "CGEvent-hidSystemState-cghidEventTap", "post_event_access": true,
                "trusted_events": events, "copy_cut_paste_select_undo_redo": true,
                "keyboard_settings_once": true, "keyboard_new_session_once": true,
                "keyboard_focus_restored": true]
    }

    private func requireFocus() throws {
        guard NSApp.isActive, app.window.isKeyWindow,
              let focused = app.window.firstResponder as? NSView,
              focused === app.webView || focused.isDescendant(of: app.webView) else {
            throw PreviewError.message("Trusted input fixture lost its foreground WebView; refusing input")
        }
    }
    private func key(_ code: CGKeyCode, flags: CGEventFlags = []) throws {
        try requireFocus()
        guard let source = CGEventSource(stateID: .hidSystemState),
              let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else {
            throw PreviewError.message("Could not create fixture Quartz keyboard input")
        }
        down.flags = flags; up.flags = flags
        down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
    }
    private func type(_ value: String) throws {
        try requireFocus()
        guard let source = CGEventSource(stateID: .hidSystemState),
              let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else {
            throw PreviewError.message("Could not create fixture Quartz text input")
        }
        let units = Array(value.utf16)
        units.withUnsafeBufferPointer { buffer in
            down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
            up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
        }
        down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
    }
    private func value(_ value: String) async throws {
        try await wait("native Edit value") {
            try await self.js("return document.querySelector('[role=combobox][aria-label=Message]')?.value === value", arguments: ["value": value]) as? Bool == true
        }
    }
    private func composerFocus() async throws {
        try await wait("native keyboard focus return") { try await self.js("return document.activeElement?.getAttribute('aria-label') === 'Message'") as? Bool == true }
    }
    private func dialog(_ title: String, visible: Bool) async throws {
        try await wait("native keyboard dialog") {
            try await self.js("return [...document.querySelectorAll('[role=dialog]')].some(d => d.textContent.includes(title)) === visible", arguments: ["title": title, "visible": visible]) as? Bool == true
        }
    }
    private func js(_ source: String, arguments: [String: Any] = [:]) async throws -> Any {
        try await app.webView.callAsyncJavaScript(source, arguments: arguments, in: nil, contentWorld: .page) ?? NSNull()
    }
    private func wait(_ label: String, condition: () async throws -> Bool) async throws {
        let end = Date().addingTimeInterval(10)
        while Date() < end {
            try requireFocus()
            if try await condition() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw PreviewError.message("Timed out waiting for \(label)")
    }
}
#endif
