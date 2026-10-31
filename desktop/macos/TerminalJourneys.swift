#if PREVIEW_SMOKE && TERMINAL_SMOKE
import AppKit
import CoreGraphics
import Darwin
import IOKit

extension TerminalSmoke {
    func outputJourney() async throws {
        checks["exact-value-masking"] = ["status": "unavailable", "detail": "Unmanaged preview has no injected command-environment redaction snapshot; provider model keys are outside that policy. Core masking tests are supplier evidence, not this WK qualification"]
        await check("osc-response-authority") {
            try await self.acknowledged("WK-OSC-DONE")
            try await self.require("OSC/query output acquired input or clipboard authority", "return __terminal352.clipboardWrites===0 && __terminal352.inputPosts===0;")
            return "Actual WK parser ACKed OSC52 and device-query fixture frame; zero clipboard write attempts and zero input POSTs. Decoded display remains separate"
        }
        await check("unicode-osc") {
            try await self.screen("WK-OSC-DONE")
            try await self.require("Unicode, split text or OSC policy failed", #"""
            const text=document.querySelector('.xterm-accessibility-tree').textContent;
            return text.includes('WK-UNICODE: Ω中🙂') && text.includes('WK-SPLIT:literal-fixture-only') &&
              text.includes('WK-CSI-JOINED') && !text.includes('31mWK-CSI-JOINED') &&
              __terminal352.clipboardWrites===0 && __terminal352.inputPosts===0;
            """#)
            try await self.snapshot("initial-output")
            return "Current xterm accessibility screen decoded UTF-8 and split literal output; OSC52/query replies caused zero clipboard write attempts or input POSTs. Visible paint remains separate"
        }
        await check("synthetic-input-denied") {
            _ = try await self.js(#"""
            const t=document.querySelector('.xterm-helper-textarea'); t.focus();
            t.dispatchEvent(new KeyboardEvent('keydown',{key:'x',code:'KeyX',bubbles:true}));
            t.dispatchEvent(new CompositionEvent('compositionstart',{data:'中',bubbles:true}));
            t.value='中';t.dispatchEvent(new InputEvent('input',{data:'中',inputType:'insertCompositionText',bubbles:true}));
            t.dispatchEvent(new CompositionEvent('compositionend',{data:'中',bubbles:true}));
            const data=new DataTransfer();data.setData('text/plain','MUST-NOT-WRITE');
            t.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
            return true;
            """#)
            // A scheduled task drains composition timers; no trusted event is manufactured.
            try await Task.sleep(nanoseconds: 100_000_000)
            try await self.require("Synthetic input acquired authority", "return __terminal352.inputPosts===0 && __terminal352.events.length>=4 && __terminal352.events.every(e=>!e.trusted);")
            self.record(["input_provenance": try await self.js("return __terminal352.events;")])
            return "Synthetic keyboard/paste/composition caused zero input POSTs; native trust gates unchanged"
        }
        await check("alternate-screen-output") {
            defer { try? self.trigger("normal") }
            try self.trigger("alternate")
            try await self.acknowledged("WK-ALT-SCREEN")
            try self.trigger("normal")
            try await self.acknowledged("WK-NORMAL-SCREEN")
            self.checks["alternate-parser-completion"] = ["status": "pass", "detail": "Actual WK xterm consumed the alternate and restored-screen marker frames before the production client sent their accepted cursor ACKs"]
            try self.requirePainting("Alternate-screen display")
            // Re-enter only after the first parser roundtrip and require the
            // current accessible screen, never its historical live region.
            try self.trigger("alternate")
            try await self.screen("WK-ALT-SCREEN")
            try await self.snapshot("alternate-screen")
            try self.trigger("normal")
            try await self.screen("WK-NORMAL-SCREEN")
            try await self.require("Primary screen lost", "return document.querySelector('.xterm-accessibility-tree').textContent.includes('WK-UNICODE:');")
            return "Owned shell output entered and left alternate screen; this is parser output evidence, not full-screen keyboard qualification"
        }
        await check("view-lifetime-retention") {
            for _ in 0..<4 {
                let previous = try await self.js("return __terminal352.markerReceipts['WK-OSC-DONE']?.observer || '';") as! String
                try await self.button("Hide panel")
                try await self.button("Show panel")
                try await self.navigate("files")
                try await self.waitJS("terminal unmounted", "return !document.querySelector('.xterm-helper-textarea');")
                try await self.navigate("terminal")
                try await self.waitJS("replacement observer's completed replay", "return __terminal352.markerReceipts['WK-OSC-DONE']?.observer!==\(self.quote(previous)) && __terminal352.markerReceipts['WK-OSC-DONE']?.acknowledged===true;")
            }
            try await self.require("View replacement replayed input", "return __terminal352.inputPosts===0;")
            return "Four hide/reopen and full route unmount/remount cycles each replayed retained fixture bytes through a new WK observer/parser ACK, with zero input POSTs; paint remains separate"
        }
        await check("controller-replacement") {
            try await self.button("Terminal options")
            try await self.button("Give Agent Control")
            try await self.waitJS("agent control", "return document.querySelector('[aria-label=\"Input controller\"]')?.textContent==='Input: Agent';")
            try await self.navigate("files")
            try await self.navigate("terminal")
            try await self.waitJS("replacement controller badge", "return document.querySelector('[aria-label=\"Input controller\"]')?.textContent==='Input: Agent';")
            try await self.button("Terminal options")
            try await self.button("Reclaim Input")
            try await self.waitJS("human control", "return document.querySelector('[aria-label=\"Input controller\"]')?.textContent==='Input: Human';")
            try await self.require("Control transition injected bytes", "return __terminal352.controls===2 && __terminal352.inputPosts===0;")
            return "Explicit production Give/Reclaim actions across controller replacement sent no input bytes"
        }
        await check("overflow-gap-reset") {
            try await self.navigate("files")
            try await self.waitJS("observer unmounted", "return !document.querySelector('.xterm-helper-textarea');")
            try self.trigger("overflow")
            let profile = self.app.profile!
            let end = Date().addingTimeInterval(30)
            while !FileManager.default.fileExists(atPath: profile.workspace.appendingPathComponent("wk-overflow.done").path) && Date() < end {
                try await Task.sleep(nanoseconds: 50_000_000)
            }
            guard FileManager.default.fileExists(atPath: profile.workspace.appendingPathComponent("wk-overflow.done").path) else { throw PreviewError.message("Overflow producer did not complete") }
            try await self.navigate("terminal")
            try await self.acknowledged("WK-RETAINED-TAIL")
            try await self.require("Retention gap/reset not observed", "return document.body.innerText.includes('Earlier output was discarded') && __terminal352.gapFrames>0 && __terminal352.resetAcks>0 && __terminal352.maxFrameBytes<=32768;")
            try await self.require("Gap replay injected input", "return __terminal352.inputPosts===0;")
            self.record(["observer_frames": try await self.js("return __terminal352.frames;")])
            self.checks["parser-completion-backpressure"] = ["status": "pass", "detail": "Actual WK parser marker ACK after 12 MiB overflow; explicit gap/reset ACK and max 32768-byte frames; no input replay. This does not measure human input/cancel latency"]
            try self.requirePainting("Retained-tail display")
            try await self.screen("WK-RETAINED-TAIL")
            try await self.snapshot("retained-tail")
            return "12 MiB finite fixture overflow; explicit gap and reset acknowledgement precede retained tail, zero input replay"
        }
        // Always retain bounded content-free counters, including on failed rows.
        record(["transport_observations": try await js("return __terminal352;")])
    }

    func rendererFailure() async throws {
        try await acknowledged("WK-OSC-DONE")
        // There is no public WKWebView crash primitive. Never terminate an
        // arbitrary shared WebContent process or call a private WebKit selector.
        checks["renderer-crash"] = ["status": "unavailable",
            "detail": "Preview has a native failure delegate but no public exact-owned WebContent crash seam; actual crash/recovery awaits owning lifecycle integration"]
        record(["checks": checks])
    }

    func manualJourney() async throws {
        // Real responder-chain actions, owned only by this smoke app. There is
        // no JavaScript paste bridge and no automatic clipboard access/action.
        let item = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.addItem(.separator())
        let finish = NSMenuItem(title: "Finish terminal capture", action: #selector(finishManualCapture(_:)), keyEquivalent: "")
        finish.target = self
        edit.addItem(finish)
        item.submenu = edit
        NSApp.mainMenu?.addItem(item)
        record(["native_edit_menu": ["copy": "copy:", "paste": "paste:",
                "select_all": "selectAll:", "target": "nil: AppKit responder chain",
                "automatic_actions": 0, "automatic_clipboard_access": false]])
        guard !CommandLine.arguments.contains("--workspace-console-locked"), NSApp.isActive,
              app.window.isKeyWindow, app.window.occlusionState.contains(.visible) else {
            checks["manual-operator-capture"] = ["status": "unavailable",
                "detail": "Requires an already unlocked, active, visible owned fixture and a real operator; no input, activation retry, TCC prompt or clipboard operation attempted"]
            return
        }
        record(["manual_stage_ready": true, "manual_seconds_limit": 180,
                "interaction_method": "real operator capture; no synthetic OS or JavaScript terminal input"])
        let end = Date().addingTimeInterval(180)
        while !manualFinished && Date() < end {
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        record(["manual_finished_by_operator": manualFinished,
                "manual_observations": try await js("return __terminal352;")])
        try await snapshot("manual-capture")
        checks["manual-operator-capture"] = ["status": "unavailable",
            "detail": "Event/counter/snapshot capture only; exact written-byte receipts, operator IME/paste observations and source acceptance review are still required. No physical acceptance row is inferred from event counts"]
    }

    /// Readiness is an observation for the separately owned public XCTest
    /// driver. This app never posts keys or consumes external commands/acks.
    func externalInputJourney() async throws {
        guard let window = app.window, let profile = app.profile,
              let running = NSRunningApplication.current.launchDate else {
            throw PreviewError.message("Missing exact external terminal fixture identity")
        }
        let number = window.windowNumber
        let enginePID = app.engine.pid
        let bundle = Bundle.main.bundleURL.resolvingSymlinksInPath()
        let initialFrame = window.frame
        let deadline = Date().addingTimeInterval(240)
        let names = ["unicode", "int", "running", "status", "recovered", "size"]
        for name in names {
            guard try terminalReceipt(profile.workspace, name) == nil else {
                throw PreviewError.message("External terminal receipt already exists")
            }
        }
        // Ordinary initial focus only. Later focus loss is terminal for this
        // episode, including between an operation and its independent proof.
        guard window.isKeyWindow, NSApp.isActive else {
            throw PreviewError.message("External terminal fixture is not already active")
        }
        window.makeFirstResponder(app.webView)
        _ = try await js("document.querySelector('.xterm-helper-textarea').focus(); return true;")
        func focused() async throws -> Bool {
            try await self.js("return document.activeElement===document.querySelector('.xterm-helper-textarea');") as? Bool == true
        }
        func target() async throws {
            guard self.app.window === window, window.windowNumber == number,
                  self.app.webView.window === window, window.isVisible, window.isKeyWindow,
                  window.occlusionState.contains(.visible), NSApp.isActive,
                  NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid(),
                  NSRunningApplication.current.launchDate == running,
                  Bundle.main.bundleURL.resolvingSymlinksInPath() == bundle,
                  self.app.profile === profile, self.app.engine.pid == enginePID, enginePID > 0,
                  self.app.failure == nil, Date() < deadline else {
                throw PreviewError.message("External terminal target identity/focus/deadline changed")
            }
            try self.requireExternalConsole()
            guard try await focused() else { throw PreviewError.message("External terminal textarea lost focus") }
        }
        _ = try await js("document.querySelector('[role=combobox][aria-label=Message]').focus(); return true;")
        do {
            try await target()
            throw PreviewError.message("Unfocused external terminal guard admitted its target")
        } catch {
            guard error.localizedDescription.contains("textarea lost focus") else { throw error }
        }
        try await require("Unfocused guard wrote input", "return __terminal352.inputPosts===0;")
        _ = try await js("document.querySelector('.xterm-helper-textarea').focus(); return true;")
        try await target()
        let initial = try await externalTerminalState()
        let revision = initial["revision"] as! String
        var sequence = 0
        var receipts: [[String: Any]] = []
        record(["interaction_method": "external public XCTest; app observes only, no input dispatch",
                "terminal_xctest_identity": ["schema": 1, "app_pid": getpid(),
                    "app_launch_epoch": running.timeIntervalSince1970, "bundle_path": bundle.path,
                    "target_window_number": number, "engine_pid": enginePID,
                    "session_id": sessionID, "terminal_id": terminalID,
                    "controller_revision": revision, "app_event_post_access": CGPreflightPostEventAccess(),
                    "unfocused_guard_rejected": true, "total_seconds_limit": 240]])
        func phase(_ name: String, _ operation: [String: Any], expectedBytes: Int, seconds: TimeInterval = 60,
                   _ proof: () async throws -> Bool) async throws {
            try await target()
            let before = try await self.js("return __terminal352;") as! [String: Any]
            sequence += 1
            let started = Date()
            let identity: [String: Any] = ["schema": 1, "sequence": sequence, "name": name,
                "state": "ready", "operation": operation, "seconds_limit": seconds,
                "app_pid": getpid(), "target_window_number": number,
                "session_id": self.sessionID, "terminal_id": self.terminalID]
            self.record(["terminal_xctest_phase": identity])
            let end = started.addingTimeInterval(seconds)
            while true {
                guard Date() < end else { throw PreviewError.message("External terminal phase timed out: \(name)") }
                try await target()
                let state = try await self.externalTerminalState()
                guard state["revision"] as? String == revision else {
                    throw PreviewError.message("External terminal controller revision changed")
                }
                let complete = try await proof()
                let settled = try await self.js("return __terminal352.inputSettled===__terminal352.inputPosts;") as? Bool == true
                if complete && settled {
                    guard Date() < end else { throw PreviewError.message("External terminal phase proof exceeded deadline: \(name)") }
                    break
                }
                try await Task.sleep(nanoseconds: 100_000_000)
            }
            // Both the production written receipts and actual DOM provenance
            // must settle. A file/driver ack alone never completes a phase.
            try await target()
            let after = try await self.js("return __terminal352;") as! [String: Any]
            func delta(_ key: String) -> Int { (after[key] as? Int ?? 0) - (before[key] as? Int ?? 0) }
            guard delta("inputBytes") == expectedBytes, delta("syntheticEvents") == 0,
                  delta("syntheticKeys") == 0, delta("inputPosts") == delta("inputWritten"),
                  (expectedBytes == 0 ? delta("trustedKeys") == 0 : delta("trustedKeys") > 0) else {
                throw PreviewError.message("External phase lacked exact bytes/written receipts/trusted provenance: \(name)")
            }
            var verified = identity
            verified["state"] = "verified"
            verified["proof"] = ["input_bytes": delta("inputBytes"), "input_posts": delta("inputPosts"),
                "written_receipts": delta("inputWritten"), "trusted_keydowns": delta("trustedKeys"),
                "synthetic_events": delta("syntheticEvents"), "terminal_alive": true,
                "controller_revision": revision, "elapsed_ms": Int(Date().timeIntervalSince(started) * 1000)]
            receipts.append(verified)
            self.record(["terminal_xctest_phase": verified, "terminal_xctest_phases": receipts])
        }
        func text(_ command: String) -> [String: Any] {
            ["kind": "type-text-and-return", "text": command]
        }
        func marker(_ value: String) async throws -> Bool {
            try await self.js("return __terminal352.markerReceipts[\(self.quote(value))]?.acknowledged===true && document.querySelector('.xterm-accessibility-tree')?.textContent.includes(\(self.quote(value)))===true;") as? Bool == true
        }
        try await phase("unicode", text(TerminalFixture.unicodeCommand),
                        expectedBytes: TerminalFixture.unicodeCommand.utf8.count + 1) {
            guard try self.terminalReceipt(profile.workspace, "unicode") == Data(TerminalFixture.unicode.utf8) else { return false }
            return try await marker("WK-XCTEST-UNICODE: Ω中🙂")
        }
        checks["trusted-mac-keyboard-unicode"] = ["status": "pass",
            "detail": "Public XCTest OS-generated Unicode reached the exact Local terminal; exact UTF-8 file, written input receipts, trusted events and current screen-tree marker agree. No physical keyboard, IME or visible-paint claim"]
        try await snapshot("xctest-unicode")
        try await phase("interrupt-arm", text(TerminalFixture.interruptCommand),
                        expectedBytes: TerminalFixture.interruptCommand.utf8.count + 1) {
            guard try self.terminalReceipt(profile.workspace, "running") == Data("RUNNING".utf8) else { return false }
            return try await marker("WK-XCTEST-RUNNING")
        }
        try await phase("interrupt", ["kind": "key", "key": "c", "modifiers": ["control"]], expectedBytes: 1, seconds: 10) {
            guard try self.terminalReceipt(profile.workspace, "int") == Data("INT".utf8),
                  try self.terminalReceipt(profile.workspace, "status") == Data("130".utf8) else { return false }
            return try await marker("WK-XCTEST-INTERRUPTED")
        }
        try await phase("recovery", text(TerminalFixture.recoveryCommand),
                        expectedBytes: TerminalFixture.recoveryCommand.utf8.count + 1) {
            guard try self.terminalReceipt(profile.workspace, "recovered") == Data("RECOVERED".utf8) else { return false }
            return try await marker("WK-XCTEST-RECOVERED")
        }
        checks["xctest-ctrl-c-recovery"] = ["status": "pass",
            "detail": "Public XCTest Control-C interrupted the foreground fixture sleep and the same live shell executed a fresh recovery command; full job-control acceptance remains separate"]
        try await phase("resize", ["kind": "resize-window", "width_delta": -160, "height_delta": -80], expectedBytes: 0) {
            let state = try await self.externalTerminalState()
            return abs(window.frame.width - (initialFrame.width - 160)) <= 2
                && abs(window.frame.height - (initialFrame.height - 80)) <= 2
                && (state["cols"] as? Int != initial["cols"] as? Int || state["rows"] as? Int != initial["rows"] as? Int)
        }
        try await phase("size-readback", text(TerminalFixture.sizeCommand),
                        expectedBytes: TerminalFixture.sizeCommand.utf8.count + 1) {
            guard let data = try self.terminalReceipt(profile.workspace, "size"),
                  let value = String(data: data, encoding: .utf8) else { return false }
            let sizes = value.split(whereSeparator: { $0.isWhitespace }).compactMap { Int($0) }
            let state = try await self.externalTerminalState()
            guard sizes.count == 2, sizes[0] == state["rows"] as? Int, sizes[1] == state["cols"] as? Int else { return false }
            return try await marker("WK-XCTEST-SIZE")
        }
        checks["resize-pty-readback"] = ["status": "pass",
            "detail": "Public XCTest resized the exact native window; production geometry changed and shell stty readback matched the exact terminal API dimensions"]
        try await snapshot("xctest-completed")
        record(["terminal_xctest_phase": ["schema": 1, "sequence": sequence, "state": "finished"],
                "terminal_xctest_phases": receipts, "checks": checks])
    }

    func externalTerminalState() async throws -> [String: Any] {
        let base = "/sessions/\(sessionID)"
        let state = try await js("""
        const signal=AbortSignal.timeout(2000);
        const [terminal,control]=await Promise.all([
          fetch(\(quote(base + "/user-terminals/" + terminalID)),{signal}),
          fetch(\(quote(base + "/executions/" + terminalID + "/input-control")),{signal})]);
        if(!terminal.ok || !control.ok) throw Error('Exact external terminal readback unavailable');
        return {...await terminal.json(), ...await control.json()};
        """) as! [String: Any]
        guard state["terminal_id"] as? String == terminalID, state["alive"] as? Bool == true,
              state["controller"] as? String == "human", state["frozen"] as? Bool == false,
              state["revision"] is String else {
            throw PreviewError.message("External terminal incarnation/controller is no longer writable")
        }
        return state
    }

    func requireExternalConsole() throws {
        guard !CommandLine.arguments.contains("--workspace-console-locked"),
              let session = CGSessionCopyCurrentDictionary() as? [String: Any],
              session[kCGSessionOnConsoleKey as String] as? Bool == true,
              session[kCGSessionLoginDoneKey as String] as? Bool == true,
              session["CGSSessionScreenIsLocked"] as? Bool != true else {
            throw PreviewError.message("External terminal console is locked or unavailable")
        }
        let root = IORegistryGetRootEntry(kIOMainPortDefault)
        guard root != 0 else { throw PreviewError.message("External console ownership unknown") }
        defer { IOObjectRelease(root) }
        func property(_ name: String) -> Any? {
            IORegistryEntryCreateCFProperty(root, name as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue()
        }
        let users = property("IOConsoleUsers") as? [[String: Any]] ?? []
        guard property("IOConsoleLocked") as? Bool == false,
              let user = users.first(where: { ($0["kCGSSessionUserIDKey"] as? NSNumber)?.uint32Value == getuid()
                  && $0["kCGSSessionOnConsoleKey"] as? Bool == true }),
              user["kCGSessionLoginDoneKey"] as? Bool == true,
              user["CGSSessionScreenIsLocked"] as? Bool != true else {
            throw PreviewError.message("External terminal console lock/ownership changed")
        }
    }

    func terminalReceipt(_ workspace: URL, _ name: String) throws -> Data? {
        let path = workspace.appendingPathComponent("wk-xctest-\(name).txt").path
        let descriptor = open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        if descriptor < 0, errno == ENOENT { return nil }
        guard descriptor >= 0 else { throw PreviewError.message("Cannot open owned terminal receipt without following links") }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              info.st_uid == getuid(), info.st_nlink == 1, info.st_size <= 4096 else {
            throw PreviewError.message("Invalid owned terminal receipt identity/type/size")
        }
        var bytes = [UInt8](repeating: 0, count: 4097)
        let count = read(descriptor, &bytes, bytes.count)
        guard count >= 0, count <= 4096 else { throw PreviewError.message("Terminal receipt read failed or exceeded bound") }
        return Data(bytes.prefix(count))
    }
}
#endif
