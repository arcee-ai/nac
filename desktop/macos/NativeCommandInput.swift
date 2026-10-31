#if PREVIEW_SMOKE
import AppKit
import CoreGraphics
import Darwin
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
    private let binding: [String: String]
    init(app: PreviewApp, commands: NativeCommands) {
        self.app = app; self.commands = commands
        window = app.window; view = app.webView; windowNumber = app.window.windowNumber
        binding = commands.smokeSnapshot["binding"] as? [String: String] ?? [:]
    }

    func run(externalDirectory: URL? = nil) async throws -> [String: Any] {
        if externalDirectory == nil && !CGPreflightPostEventAccess() {
            throw PreviewError.message("Trusted Edit fixture requires existing Quartz PostEventAccess")
        }
        try requireFocus()
        let external = try externalDirectory.map { try ExternalCommandFixture(directory: $0, binding: binding, window: windowNumber, receipt: app.engine.receipt) }
        var completed = false
        defer { if !completed { try? external?.finish(accepted: false) } }
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
        try await drive("type-fixture", external: external) {
            try await self.key(0, flags: .maskCommand)
            try await self.type(text)
        }
        try await value(text)
        try external?.verified("type-fixture")
        let beforeCopy = board.changeCount
        try await drive("copy", external: external) {
            try await self.key(0, flags: .maskCommand)
            try await self.key(8, flags: .maskCommand)
        }
        try await wait("fixture-owned native copy") { board.changeCount != beforeCopy }
        ownedChange = try ownedClipboardChange(board, expected: text)
        try external?.verified("copy")
        try await drive("cut", external: external) { try await self.key(7, flags: .maskCommand) }
        try await value("")
        ownedChange = try ownedClipboardChange(board, expected: text)
        try external?.verified("cut")
        try await drive("paste", external: external) { try await self.key(9, flags: .maskCommand) }
        try await value(text)
        try external?.verified("paste")
        try await drive("undo", external: external) { try await self.key(6, flags: .maskCommand) }
        try await value("")
        try external?.verified("undo")
        try await drive("redo", external: external) { try await self.key(6, flags: [.maskCommand, .maskShift]) }
        try await value(text)
        try external?.verified("redo")
        let beforeSettings = commands.smokeSnapshot["dispatches"] as! Int
        try await drive("settings", external: external) { try await self.key(43, flags: .maskCommand) }
        try await dialog("Configurations", visible: true)
        guard commands.smokeSnapshot["dispatches"] as? Int == beforeSettings + 1 else {
            throw PreviewError.message("Native Settings was not dispatched once")
        }
        try external?.verified("settings")
        try await drive("close-settings", composer: false, external: external) { try await self.key(53, composer: false) }
        try await dialog("Configurations", visible: false)
        try await composerFocus()
        try external?.verified("close-settings")
        let beforeNew = commands.smokeSnapshot["dispatches"] as! Int
        try await drive("new-session", external: external) { try await self.key(45, flags: .maskCommand) }
        try await dialog("New Chat", visible: true)
        guard commands.smokeSnapshot["dispatches"] as? Int == beforeNew + 1 else {
            throw PreviewError.message("Native New Session was not dispatched once")
        }
        try external?.verified("new-session")
        try await drive("close-new-session", composer: false, external: external) { try await self.key(53, composer: false) }
        try await dialog("New Chat", visible: false)
        try await composerFocus()
        try external?.verified("close-new-session")
        let events = try await js("return __commandInputEvidence") as? [[String: Any]] ?? []
        guard !events.isEmpty, events.allSatisfy({ $0["trusted"] as? Bool == true }),
              events.contains(where: { $0["type"] as? String == "paste" }),
              events.contains(where: { $0["type"] as? String == "input" }) else {
            throw PreviewError.message("OS input did not have trusted WK event provenance")
        }
        try external?.finish(accepted: true)
        completed = true
        return ["source": external == nil ? "CGEvent-privateState-postToPid-self" : "external-public-OS-driver", "target_pid": getpid(), "target_window": windowNumber, "app_event_post_access_required": external == nil,
                "trusted_events": events, "copy_cut_paste_select_undo_redo": true,
                "keyboard_settings_once": true, "keyboard_new_session_once": true,
                "keyboard_focus_restored": true]
    }

    private func ownedClipboardChange(_ board: NSPasteboard, expected: String) throws -> Int {
        let count = board.changeCount
        guard board.string(forType: .string) == expected, board.changeCount == count else {
            throw PreviewError.message("Clipboard changed outside the fixture copy; restoration is not owned")
        }
        return count
    }

    private func requireFocus() throws {
        guard Set(binding.keys) == Set(["launch", "view", "document"]),
              app.engine.receipt?.incarnation == binding["launch"],
              commands.smokeSnapshot["binding"] as? [String: String] == binding,
              commands.smokeSnapshot["ready"] as? Bool == true,
              app.window === window, app.webView === view, view.window === window,
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
    private func drive(_ phase: String, composer: Bool = true, external: ExternalCommandFixture?,
                       operation: () async throws -> Void) async throws {
        try requireFocus()
        let target = composer
            ? "return document.hasFocus() && document.activeElement?.getAttribute('aria-label') === 'Message'"
            : "return document.hasFocus() && !!document.activeElement?.closest('[role=dialog]')"
        guard try await js(target) as? Bool == true else { throw PreviewError.message("Fixture DOM input target lost focus") }
        if let external {
            try external.ready(phase)
            try await wait("external OS driver: \(phase)", timeout: 30) { try external.acknowledged() }
        } else {
            try await operation()
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
    private func wait(_ label: String, timeout: TimeInterval = 10, condition: () async throws -> Bool) async throws {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            try requireFocus()
            if try await condition() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw PreviewError.message("Timed out waiting for \(label)")
    }
}

/// `commands-input` plus `--commands-external` publishes commands-input-phase.json
/// beside the existing smoke output. A public OS driver atomically echoes each
/// ready payload as commands-input-ack.json with only kind changed to attempted.
/// Correlation is not acceptance: the app verifies each real UI result afterward.
/// No driver receipt invokes actions, posts input, or grants event-post access.
/// Files are bounded to 4 KiB and anchored to the owned output directory.
@MainActor
final class ExternalCommandFixture {
    private let directory: Int32
    private var current: [String: Any]
    private var phases: [String] = []
    private var sequence = 0
    private var acknowledgedSequence = 0
    private static let limit = 4096

    init(directory: URL, binding: [String: String], window: Int, receipt: EngineReceipt?, buildMetadata: [String: Any]? = nil) throws {
        let metadata: [String: Any]?
        if let buildMetadata { metadata = buildMetadata }
        else { metadata = try JSONSerialization.jsonObject(with: Data(contentsOf: Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/build-receipt.json"))) as? [String: Any] }
        guard let source = metadata?["source_head"] as? String,
              source == receipt?.identity?.source_revision,
              let native = metadata?["native_sha256"] as? String,
              let engine = metadata?["engine_sha256"] as? String else {
            throw PreviewError.message("External command fixture lacks exact build provenance")
        }
        current = ["version": 1, "episode": UUID().uuidString, "pid": getpid(), "window": window,
                   "launch": binding["launch"] ?? "", "view": binding["view"] ?? "", "document": binding["document"] ?? "",
                   "source": source, "native_sha256": native, "engine_sha256": engine]
        let descriptor = open(directory.path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
        guard descriptor >= 0 else { throw PreviewError.message("External command fixture directory unavailable") }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_uid == getuid() else {
            close(descriptor)
            throw PreviewError.message("External command fixture directory is not owned")
        }
        self.directory = descriptor
    }
    deinit { close(directory) }

    func ready(_ phase: String) throws {
        let expected = ["type-fixture", "copy", "cut", "paste", "undo", "redo", "settings", "close-settings", "new-session", "close-new-session"]
        guard sequence < expected.count, expected[sequence] == phase else {
            throw PreviewError.message("External command fixture phase out of order")
        }
        sequence += 1
        current["sequence"] = sequence
        current["phase"] = phase
        current["verified_phases"] = phases
        try write(kind: "ready")
    }

    func acknowledged() throws -> Bool {
        guard acknowledgedSequence != sequence else { return false }
        let fd = openat(directory, "commands-input-ack.json", O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        if fd < 0 && errno == ENOENT { return false }
        guard fd >= 0 else { throw PreviewError.message("External command receipt cannot be safely opened") }
        defer { close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, (info.st_mode & 0o170000) == 0o100000,
              info.st_size <= Self.limit else { throw PreviewError.message("External command receipt exceeds bounds") }
        var bytes = [UInt8](repeating: 0, count: Self.limit + 1)
        let count = read(fd, &bytes, bytes.count)
        guard count >= 0, count <= Self.limit,
              let value = try JSONSerialization.jsonObject(with: Data(bytes.prefix(count))) as? [String: Any] else {
            throw PreviewError.message("External command receipt is malformed")
        }
        var expected = current
        expected["kind"] = "attempted"
        guard NSDictionary(dictionary: value).isEqual(to: expected) else { return false }
        acknowledgedSequence = sequence
        return true
    }

    func verified(_ phase: String) throws {
        guard current["phase"] as? String == phase, acknowledgedSequence == sequence, phases.count + 1 == sequence else { throw PreviewError.message("External command settlement is stale") }
        phases.append(phase)
        try write(kind: "settled", accepted: true)
    }
    func finish(accepted: Bool) throws { try write(kind: "finished", accepted: accepted) }

    private func write(kind: String, accepted: Bool? = nil) throws {
        var value = current
        value["kind"] = kind
        value["verified_phases"] = phases
        if let accepted { value["accepted"] = accepted }
        let bytes = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        guard bytes.count <= Self.limit else { throw PreviewError.message("External command phase exceeds bounds") }
        let name = ".commands-phase-" + UUID().uuidString
        let fd = openat(directory, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw PreviewError.message("External command phase cannot be safely created") }
        defer { close(fd); unlinkat(directory, name, 0) }
        let written = bytes.withUnsafeBytes { Darwin.write(fd, $0.baseAddress, $0.count) }
        guard written == bytes.count, renameat(directory, name, directory, "commands-input-phase.json") == 0 else {
            throw PreviewError.message("External command phase publication failed")
        }
    }
}
#endif
