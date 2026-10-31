#if PREVIEW_SMOKE
import AppKit
import CoreGraphics
import IOKit
import WebKit

/// One predeclared fixture operation through the existing human Local terminal.
/// No production bridge, permission prompt, clipboard, or JS trust override.
@MainActor
enum CITerminal {
    static let marker = "NAC354_TRUSTED_OK"
    // The command echo cannot satisfy the rendered-output marker assertion.
    static let command = "printf '" + marker.utf8.map { String(format: "\\%03o", Int($0)) }.joined()
        + "' > ci-native-input.txt; cat ci-native-input.txt"

    static func run(app: PreviewApp, sessionID: String,
                    snapshot: () async throws -> Void) async throws -> [String: Any] {
        guard CGPreflightPostEventAccess() else {
            throw PreviewError.message("Native input unavailable: event-post access is not already granted; no prompt requested")
        }
        guard let profile = app.profile else { throw PreviewError.message("Missing CI terminal profile") }
        let receipt = profile.workspace.appendingPathComponent("ci-native-input.txt")
        guard !FileManager.default.fileExists(atPath: receipt.path) else {
            throw PreviewError.message("Terminal receipt must not exist before native input")
        }
        func js(_ source: String) async throws -> Any {
            try await app.webView.callAsyncJavaScript(source, arguments: [:], in: nil, contentWorld: .page) ?? NSNull()
        }
        func wait(_ label: String, _ check: () async throws -> Bool) async throws {
            let deadline = Date().addingTimeInterval(25)
            while Date() < deadline {
                if try await check() { return }
                if let failure = app.failure { throw PreviewError.message(failure) }
                try await Task.sleep(nanoseconds: 50_000_000)
            }
            throw PreviewError.message("Timed out waiting for CI terminal \(label)")
        }
        _ = try await js("location.hash = '/session/\(sessionID)/terminal'; return true;")
        try await wait("panel controls") {
            (try await js("return !!document.querySelector('[aria-label=\"Show panel\"]') || !!document.querySelector('[role=region][aria-label=\"Session terminal\"]');")) as? Bool == true
        }
        _ = try await js("document.querySelector('[aria-label=\"Show panel\"]')?.click(); return true;")
        try await wait("New shell") {
            (try await js("return [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'New shell' && !b.disabled);")) as? Bool == true
        }
        _ = try await js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'New shell').click(); return true;")
        try await wait("connected xterm") {
            (try await js("return !!document.querySelector('.xterm-helper-textarea') && document.querySelector('[role=region][aria-label=\"Session terminal\"]')?.innerText.includes('Connected');")) as? Bool == true
        }
        let list = try await js("return await (await fetch('/sessions/\(sessionID)/user-terminals')).json();") as? [String: Any]
        guard let rows = list?["terminals"] as? [[String: Any]], rows.count == 1,
              let terminalID = rows[0]["terminal_id"] as? String else {
            throw PreviewError.message("Expected exactly one fixture human terminal")
        }
        var terminationAttempted = false
        func terminate() async throws {
            terminationAttempted = true
            let path = "/sessions/\(sessionID)/terminals/\(terminalID)"
            guard (try await js("return (await fetch('\(path)', {method:'DELETE'})).ok;")) as? Bool == true else {
                throw PreviewError.message("Production terminal termination failed")
            }
            try await wait("native terminal settlement") {
                (try await js("const r=await fetch('/sessions/\(sessionID)/user-terminals/\(terminalID)'); return r.status===404 || (r.ok && (await r.json()).alive===false);")) as? Bool == true
            }
        }
        do {
            // Initial focus is ordinary owned-fixture setup. Every subsequent
            // native key checks the current target; focus loss never refocuses.
            app.window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            app.window.makeFirstResponder(app.webView)
            _ = try await js("""
            const target=document.querySelector('.xterm-helper-textarea'); target.focus();
            window.__ciNativeKeys={trusted:0, synthetic:0};
            target.addEventListener('keydown', e => { __ciNativeKeys[e.isTrusted?'trusted':'synthetic']++; }, true);
            return true;
            """)
            func focused() async throws -> Bool {
                (try await js("return document.activeElement === document.querySelector('.xterm-helper-textarea');")) as? Bool == true
            }
            // Actual focus loss within this fixture must reject the whole input
            // episode before posting a key. No synthetic keyboard event is used.
            _ = try await js("document.querySelector('[role=combobox][aria-label=Message]').focus(); return true;")
            guard try await focused() == false else {
                throw PreviewError.message("Unable to stage the unfocused terminal negative control")
            }
            do {
                try await type("CI_FOCUS_GUARD", app: app, focused: focused)
                throw PreviewError.message("Unfocused terminal incorrectly accepted native input")
            } catch {
                guard error.localizedDescription.contains("textarea lost focus") else { throw error }
            }
            try requireTarget(app, window: app.window, number: app.window.windowNumber)
            _ = try await js("document.querySelector('.xterm-helper-textarea').focus(); return true;")
            try await type(command, app: app, focused: focused)
            try await wait("exact owned workspace receipt") {
                (try? Data(contentsOf: receipt)) == Data(marker.utf8)
            }
            try await wait("rendered terminal output") {
                (try await js("return document.querySelector('.xterm-rows')?.textContent.includes('\(marker)') === true;")) as? Bool == true
            }
            let keys = try await js("return __ciNativeKeys;") as? [String: Int] ?? [:]
            guard (keys["trusted"] ?? 0) >= command.count + 1, keys["synthetic"] == 0 else {
                throw PreviewError.message("Trusted native keyboard dispatch was not observed: \(keys)")
            }
            try await snapshot()
            try await terminate()
            return ["terminal_id": terminalID, "input_method": "CoreGraphics CGEventPostToPid, owned active fixture only",
                    "target_pid": getpid(), "target_window_number": app.window.windowNumber,
                    "operation": command, "trusted_keydowns": keys["trusted"] ?? 0,
                    "synthetic_keydowns": keys["synthetic"] ?? 0, "exact_receipt": true,
                    "unfocused_input_rejected": true,
                    "native_terminal_settled": true, "scope": "one ASCII typing case; no IME/paste claim"]
        } catch {
            // Rust's normal termination and enclosing app shutdown retain tree
            // cleanup authority. Never signal a guessed terminal PID here.
            if !terminationAttempted { try await terminate() }
            throw error
        }
    }

    /// Public OS event path. Paired events go only to this process, including
    /// key-up if focus changes; no global held key or modifier is introduced.
    static func type(_ text: String, app: PreviewApp,
                     focused: () async throws -> Bool) async throws {
        let window = app.window!
        let number = window.windowNumber
        guard let source = CGEventSource(stateID: .privateState), text.utf8.count <= 256 else {
            throw PreviewError.message("Unavailable/bounded native event source")
        }
        func pair(_ key: CGKeyCode, _ value: String? = nil) throws {
            try requireTarget(app, window: window, number: number)
            guard CGPreflightPostEventAccess(),
                  let down = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: true),
                  let up = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: false) else {
                throw PreviewError.message("Native event-post capability became unavailable")
            }
            down.flags = []; up.flags = []
            if let value {
                let units = Array(value.utf16)
                units.withUnsafeBufferPointer {
                    down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: $0.baseAddress!)
                    up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: $0.baseAddress!)
                }
            }
            down.postToPid(getpid())
            up.postToPid(getpid())
        }
        for character in text {
            guard try await focused() else { throw PreviewError.message("Fixture textarea lost focus; native input stopped") }
            try pair(0, String(character))
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        guard try await focused() else { throw PreviewError.message("Fixture textarea lost focus before Enter") }
        try pair(36)
    }

    private static func requireTarget(_ app: PreviewApp, window: NSWindow, number: Int) throws {
        guard app.window === window, window.windowNumber == number, window.isVisible, window.isKeyWindow,
              app.webView.window === window, NSApp.isActive,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid(),
              let session = CGSessionCopyCurrentDictionary() as? [String: Any],
              session[kCGSessionOnConsoleKey as String] as? Bool == true,
              session[kCGSessionLoginDoneKey as String] as? Bool == true,
              session["CGSSessionScreenIsLocked"] as? Bool != true else {
            throw PreviewError.message("Fixture window/console is no longer the active input target")
        }
        let root = IORegistryGetRootEntry(kIOMainPortDefault)
        guard root != 0 else { throw PreviewError.message("Console lock inspection unavailable") }
        defer { IOObjectRelease(root) }
        func property(_ name: String) -> Any? {
            IORegistryEntryCreateCFProperty(root, name as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue()
        }
        let sessions = property("IOConsoleUsers") as? [[String: Any]] ?? []
        guard property("IOConsoleLocked") as? Bool == false,
              let current = sessions.first(where: { ($0["kCGSSessionUserIDKey"] as? NSNumber)?.uint32Value == getuid()
                  && $0["kCGSSessionOnConsoleKey"] as? Bool == true }),
              current["kCGSessionLoginDoneKey"] as? Bool == true,
              current["CGSSessionScreenIsLocked"] as? Bool != true else {
            throw PreviewError.message("Console locked or ownership unknown; native input stopped")
        }
    }
}
#endif
