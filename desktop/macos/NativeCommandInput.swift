#if PREVIEW_SMOKE
import AppKit
import CoreGraphics
import IOKit
import WebKit

/// Fixture-only OS input. Never prompts for, changes or bypasses input privacy.
@MainActor
final class NativeCommandInput {
    private unowned let app: PreviewApp
    private let commands: NativeCommands
    private let window: NSWindow
    private let view: WKWebView
    private let windowNumber: Int
    init(app: PreviewApp, commands: NativeCommands) {
        self.app = app; self.commands = commands
        window = app.window; view = app.webView; windowNumber = app.window.windowNumber
    }

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
        try await key(0, flags: .maskCommand) // Select All, through the real responder.
        try await type(text)
        try await value(text)
        let beforeCopy = board.changeCount
        try await key(0, flags: .maskCommand)
        try await key(8, flags: .maskCommand) // Copy
        try await wait("fixture-owned native copy") { board.changeCount != beforeCopy }
        guard board.string(forType: .string) == text else { throw PreviewError.message("Native Copy did not copy fixture text") }
        ownedChange = board.changeCount
        try await key(7, flags: .maskCommand) // Cut
        try await value("")
        guard board.string(forType: .string) == text else { throw PreviewError.message("Native Cut did not retain fixture text") }
        ownedChange = board.changeCount
        try await key(9, flags: .maskCommand) // Paste
        try await value(text)
        try await key(6, flags: .maskCommand) // Undo paste
        try await value("")
        try await key(6, flags: [.maskCommand, .maskShift]) // Redo
        try await value(text)
        let beforeSettings = commands.smokeSnapshot["dispatches"] as! Int
        try await key(43, flags: .maskCommand) // Settings
        try await dialog("Configurations", visible: true)
        try await key(53, composer: false)
        try await dialog("Configurations", visible: false)
        try await composerFocus()
        guard commands.smokeSnapshot["dispatches"] as? Int == beforeSettings + 1 else {
            throw PreviewError.message("Quartz Settings was not dispatched once")
        }
        let beforeNew = commands.smokeSnapshot["dispatches"] as! Int
        try await key(45, flags: .maskCommand) // New Session
        try await dialog("New Chat", visible: true)
        try await key(53, composer: false)
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
        return ["source": "CGEvent-privateState-postToPid-self", "target_pid": getpid(), "target_window": windowNumber, "post_event_access": true,
                "trusted_events": events, "copy_cut_paste_select_undo_redo": true,
                "keyboard_settings_once": true, "keyboard_new_session_once": true,
                "keyboard_focus_restored": true]
    }

    private func requireFocus() throws {
        guard app.window === window, app.webView === view, view.window === window,
              window.windowNumber == windowNumber, window.isVisible, window.isKeyWindow,
              NSApp.isActive, NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid(),
              let focused = window.firstResponder as? NSView,
              focused === view || focused.isDescendant(of: view),
              let session = CGSessionCopyCurrentDictionary() as? [String: Any],
              session[kCGSessionOnConsoleKey as String] as? Bool == true,
              session[kCGSessionLoginDoneKey as String] as? Bool == true,
              session["CGSSessionScreenIsLocked"] as? Bool != true else {
            throw PreviewError.message("Trusted input fixture lost its foreground window/console; refusing input")
        }
        let root = IORegistryGetRootEntry(kIOMainPortDefault)
        guard root != 0 else { throw PreviewError.message("Console lock observation unavailable") }
        defer { IOObjectRelease(root) }
        let locked = IORegistryEntryCreateCFProperty(root, "IOConsoleLocked" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? Bool
        let rows = IORegistryEntryCreateCFProperty(root, "IOConsoleUsers" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? [[String: Any]] ?? []
        guard locked == false, !rows.contains(where: { $0["CGSSessionScreenIsLocked"] as? Bool == true }),
              let own = rows.first(where: { ($0["kCGSSessionUserIDKey"] as? NSNumber)?.uint32Value == getuid()
                  && $0["kCGSSessionOnConsoleKey"] as? Bool == true }),
              own["kCGSessionLoginDoneKey"] as? Bool == true else {
            throw PreviewError.message("Console locked or ownership unknown; fixture input stopped")
        }
    }
    private func key(_ code: CGKeyCode, flags: CGEventFlags = [], composer: Bool = true) async throws {
        let target = composer
            ? "return document.hasFocus() && document.activeElement?.getAttribute('aria-label') === 'Message'"
            : "return document.hasFocus() && !!document.activeElement?.closest('[role=dialog]')"
        guard try await js(target) as? Bool == true else { throw PreviewError.message("Fixture DOM input target lost focus") }
        try pair(code, flags: flags)
    }
    private func pair(_ code: CGKeyCode, flags: CGEventFlags = [], text: String? = nil) throws {
        try requireFocus()
        guard CGPreflightPostEventAccess(), let source = CGEventSource(stateID: .privateState),
              let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else {
            throw PreviewError.message("Fixture event-post access unavailable; no prompt requested")
        }
        down.flags = flags; up.flags = []
        if let text {
            let units = Array(text.utf16)
            units.withUnsafeBufferPointer {
                down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: $0.baseAddress!)
                up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: $0.baseAddress!)
            }
        }
        // Release only this fixture's key to its own PID even after focus loss.
        // No modifier key-down and no global HID event is ever posted.
        defer { up.postToPid(getpid()) }
        down.postToPid(getpid())
    }
    private func type(_ value: String) async throws {
        guard value.utf8.count <= 128 else { throw PreviewError.message("Fixture text exceeded input bound") }
        for character in value {
            guard try await js("return document.hasFocus() && document.activeElement?.getAttribute('aria-label') === 'Message'") as? Bool == true else {
                throw PreviewError.message("Fixture composer lost focus; typing stopped")
            }
            try pair(0, text: String(character))
            try await Task.sleep(nanoseconds: 20_000_000)
        }
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
            try await self.js("return [...document.querySelectorAll('[role=dialog]')].some(d => d.textContent.includes(title)) === visible && (!visible || !!document.activeElement?.closest('[role=dialog]'))", arguments: ["title": title, "visible": visible]) as? Bool == true
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
