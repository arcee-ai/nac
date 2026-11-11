import AppKit
import CoreGraphics
import CryptoKit
import Dispatch
import Darwin
import IOKit
import XCTest
import XCUIAutomation

/// External public XCTest input. No physical keyboard or IME claim.
final class NativeJourneys: XCTestCase {
    struct Fixture: Decodable {
        let app_path: String
        let evidence: String
        let native_sha256: String
    }
    private let marker = "NAC354_TRUSTED_XY"

    private func require(_ valid: @autoclosure () -> Bool, _ message: String) throws {
        guard valid() else { throw NSError(domain: "NACUI", code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]) }
    }

    private func evidence(_ path: String) throws -> [String: Any] {
        guard let record = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as? [String: Any] else {
            throw NSError(domain: "NACUI", code: 1)
        }
        return record
    }


    private struct CommandPhase: Decodable {
        let version, sequence, pid, window: Int
        let episode, launch, view, document, source, native_sha256, engine_sha256, phase, kind: String
        let verified_phases: [String]
        let accepted: Bool?
    }

    /// The existing app fixture owns readiness and independent UI settlement.
    /// This actor supplies only the ten fixed public keyboard operations.
    @MainActor
    func testTrustedCommands() throws {
        continueAfterFailure = false
        executionTimeAllowance = 180
        let configPath = try XCTUnwrap(ProcessInfo.processInfo.environment["NAC_UI_FIXTURE"])
        let configBytes = try Data(contentsOf: URL(fileURLWithPath: configPath))
        let config = try XCTUnwrap(JSONSerialization.jsonObject(with: configBytes) as? [String: Any])
        let binding = try XCTUnwrap(config["command_binding"] as? [String: String])
        try require(Set(binding.keys) == Set(["source", "native_sha256", "engine_sha256"])
            && config["scenario"] as? String == "commands-input", "Unexpected command fixture contract")
        let appURL = URL(fileURLWithPath: try XCTUnwrap(config["app_path"] as? String)).resolvingSymlinksInPath()
        try require(appURL.lastPathComponent == "NAC Development Preview Smoke.app"
            && appURL.path.contains("/nac-mac-relocation-"), "Unexpected command bundle")
        let digest = SHA256.hash(data: try Data(contentsOf: appURL.appendingPathComponent("Contents/MacOS/NACPreview")))
            .map { String(format: "%02x", $0) }.joined()
        let engine = SHA256.hash(data: try Data(contentsOf: appURL.appendingPathComponent("Contents/Resources/nac-web")))
            .map { String(format: "%02x", $0) }.joined()
        try require(digest == binding["native_sha256"] && engine == binding["engine_sha256"]
            && digest == config["native_sha256"] as? String, "Command executable identity changed")
        let output = try XCTUnwrap(config["evidence"] as? String)
        let parent = URL(fileURLWithPath: output).deletingLastPathComponent().resolvingSymlinksInPath()
        let directory = open(parent.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        try require(directory >= 0, "Command evidence directory unavailable")
        defer { close(directory) }
        var held = stat()
        try require(fstat(directory, &held) == 0 && held.st_uid == getuid() && held.st_mode & 0o077 == 0,
                    "Command evidence is not a private owned directory")
        try require(NSRunningApplication.runningApplications(withBundleIdentifier: "ai.arcee.nac.development-preview")
            .allSatisfy { $0.isTerminated }, "Refusing an existing preview instance")
        try requireUnlockedConsole()
        let app = XCUIApplication(url: appURL)
        app.launchArguments = ["--smoke-output", output, "--smoke-scenario", "commands-input", "--commands-external"]
        app.launchEnvironment = ["NAC_HOME": "/DO-NOT-USE-PERSONAL-NAC", "NAC_MANAGED_CONFIG": "/DO-NOT-INHERIT",
                                 "OPENAI_API_KEY": "must-not-reach-engine"]
        app.launch()
        let names = ["type-fixture", "copy", "cut", "paste", "undo", "redo", "settings",
                     "close-settings", "new-session", "close-new-session"]
        let keys: Set<String> = ["version", "episode", "pid", "window", "launch", "view", "document",
            "source", "native_sha256", "engine_sha256", "sequence", "phase", "verified_phases", "kind"]
        var first: [String: Any]?
        var owner: NSRunningApplication?
        var birth: Date?
        var attempts: [[String: Any]] = []
        for (index, name) in names.enumerated() {
            let deadline = Date().addingTimeInterval(index == 0 ? 50 : 30)
            var ready: [String: Any]?
            while Date() < deadline {
                if let record = try? evidence(output) {
                    try require(record["error"] == nil && record["passed"] as? Bool != false,
                                "Command app rejected the episode")
                }
                if let row = try commandRecord(directory, parent: parent, held: held) {
                    let data = try JSONSerialization.data(withJSONObject: row)
                    let phase = try JSONDecoder().decode(CommandPhase.self, from: data)
                    try require(Set(row.keys) == keys && phase.version == 1 && phase.accepted == nil
                        && phase.sequence > 0 && phase.sequence <= index + 1 && phase.sequence >= max(1, index)
                        && names[phase.sequence - 1] == phase.phase, "Command phase skipped, replayed or malformed")
                    try require([phase.episode, phase.launch, phase.view, phase.document].allSatisfy {
                        UUID(uuidString: $0) != nil && $0 != "00000000-0000-0000-0000-000000000000"
                    } && phase.pid > 0 && phase.window > 0
                        && phase.source == binding["source"] && phase.native_sha256 == digest
                        && phase.engine_sha256 == engine, "Command phase source/incarnation changed")
                    if let initial = first {
                        for key in ["episode", "pid", "window", "launch", "view", "document", "source", "native_sha256", "engine_sha256"] {
                            try require(NSDictionary(dictionary: [key: row[key]!]).isEqual(to: [key: initial[key]!]),
                                        "Command phase identity changed")
                        }
                    } else {
                        try require(phase.sequence == 1, "Command episode did not start at phase one")
                        let running = try XCTUnwrap(NSRunningApplication(processIdentifier: pid_t(phase.pid)))
                        try require(running.bundleURL?.resolvingSymlinksInPath() == appURL, "Command process URL differs")
                        first = row; owner = running; birth = try XCTUnwrap(running.launchDate)
                    }
                    if phase.sequence == index + 1 {
                        try require(phase.kind == "ready" && phase.verified_phases == Array(names.prefix(index)),
                                    "Command phase lacks prior independent settlement")
                        ready = row; break
                    }
                    try require(["ready", "settled"].contains(phase.kind)
                        && phase.verified_phases == Array(names.prefix(index - (phase.kind == "ready" ? 1 : 0))),
                                "Previous command phase changed")
                }
                RunLoop.current.run(until: Date().addingTimeInterval(0.025))
            }
            let row = try XCTUnwrap(ready, "Command phase readiness deadline exceeded: " + name)
            func guardOperation() throws {
                try requireTarget(try XCTUnwrap(owner), url: appURL, launch: try XCTUnwrap(birth),
                                  window: try XCTUnwrap(row["window"] as? Int))
                try require(app.windows.count == 1, "Command window became ambiguous")
                let current = try XCTUnwrap(commandRecord(directory, parent: parent, held: held))
                try require(NSDictionary(dictionary: current).isEqual(to: row), "Command phase changed before input/ack")
            }
            try guardOperation()
            var ack = row; ack["kind"] = "attempted"
            attempts.append(ack) // One attempt only, before any public operation; no retry path.
            try commandWrite(["version": 1, "configuration_sha256": SHA256.hash(data: configBytes)
                .map { String(format: "%02x", $0) }.joined(), "attempts": attempts],
                name: "commands-xctest-driver.json", directory: directory, limit: 32 * 1024)
            try guardOperation()
            switch name {
            case "type-fixture":
                let composers = app.webViews.descendants(matching: .any).matching(identifier: "Message")
                try require(composers.count == 1, "Expected one Message accessibility element")
                app.typeKey("a", modifierFlags: .command)
                try guardOperation()
                for character in "NAC_NATIVE_EDIT_FIXTURE" {
                    try guardOperation()
                    try require(composers.count == 1, "Command composer became ambiguous")
                    composers.firstMatch.typeText(String(character))
                }
            case "copy":
                app.typeKey("a", modifierFlags: .command)
                try guardOperation(); app.typeKey("c", modifierFlags: .command)
            case "cut": app.typeKey("x", modifierFlags: .command)
            case "paste": app.typeKey("v", modifierFlags: .command)
            case "undo": app.typeKey("z", modifierFlags: .command)
            case "redo": app.typeKey("z", modifierFlags: [.command, .shift])
            case "settings": app.typeKey(",", modifierFlags: .command)
            case "new-session": app.typeKey("n", modifierFlags: .command)
            case "close-settings", "close-new-session": app.typeKey(.escape, modifierFlags: [])
            default: throw NSError(domain: "NACCommands", code: 1)
            }
            try guardOperation()
            try commandWrite(ack, name: "commands-input-ack.json", directory: directory, limit: 4096)
        }
        XCTAssertTrue(app.wait(for: .notRunning, timeout: 60), "Command app did not settle and close")
        let final = try XCTUnwrap(commandRecord(directory, parent: parent, held: held))
        try require(final["kind"] as? String == "finished" && final["accepted"] as? Bool == true
            && final["verified_phases"] as? [String] == names, "Command app did not verify all ten attempts")
        let result = try evidence(output)
        XCTAssertEqual(result["passed"] as? Bool, true)
        XCTAssertEqual(result["engine_reaped"] as? Bool, true)
        XCTAssertEqual(result["profile_removed"] as? Bool, true)
    }

    private func commandRecord(_ directory: Int32, parent: URL, held: stat) throws -> [String: Any]? {
        var current = stat()
        try require(lstat(parent.path, &current) == 0 && current.st_dev == held.st_dev
            && current.st_ino == held.st_ino && current.st_uid == getuid() && current.st_mode & 0o077 == 0,
                    "Command directory replaced or privacy changed")
        let fd = openat(directory, "commands-input-phase.json", O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        if fd < 0 && errno == ENOENT { return nil }
        try require(fd >= 0, "Cannot open known command phase")
        defer { close(fd) }
        var before = stat(), after = stat()
        try require(fstat(fd, &before) == 0 && before.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG)
            && before.st_uid == getuid() && before.st_nlink == 1 && before.st_size > 0 && before.st_size <= 4096,
                    "Command phase is nonregular, unowned or oversized")
        var bytes = [UInt8](repeating: 0, count: 4097)
        let count = bytes.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
        try require(fstat(fd, &after) == 0 && count == Int(before.st_size) && before.st_size == after.st_size
            && before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec
            && before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec
            && before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec
            && before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec, "Command phase changed during read")
        try require(lstat(parent.path, &current) == 0 && current.st_dev == held.st_dev
            && current.st_ino == held.st_ino && current.st_mode & 0o077 == 0, "Command directory changed during read")
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(bytes.prefix(count))) as? [String: Any])
    }

    private func commandWrite(_ value: [String: Any], name: String, directory: Int32, limit: Int) throws {
        try require(["commands-input-ack.json", "commands-xctest-driver.json"].contains(name), "Unknown command receipt")
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        try require(data.count <= limit, "Command receipt exceeds its bound")
        let temporary = ".commands-xctest-" + UUID().uuidString
        let fd = openat(directory, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        try require(fd >= 0, "Cannot create command receipt")
        defer { close(fd); unlinkat(directory, temporary, 0) }
        let count = data.withUnsafeBytes { Darwin.write(fd, $0.baseAddress, $0.count) }
        try require(count == data.count && renameat(directory, temporary, directory, name) == 0,
                    "Command receipt publication failed")
    }

    @MainActor
    func testTrustedLocalTerminal() throws {
        continueAfterFailure = false
        executionTimeAllowance = 180
        let configPath = try XCTUnwrap(ProcessInfo.processInfo.environment["NAC_UI_FIXTURE"])
        let config = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: URL(fileURLWithPath: configPath)))
        let appURL = URL(fileURLWithPath: config.app_path).resolvingSymlinksInPath()
        try require(appURL.lastPathComponent == "NAC Development Preview Smoke.app", "Unexpected fixture bundle")
        try require(appURL.path.contains("/nac-mac-relocation-"), "Fixture was not relocated")
        let executable = appURL.appendingPathComponent("Contents/MacOS/NACPreview")
        let digest = SHA256.hash(data: try Data(contentsOf: executable)).map { String(format: "%02x", $0) }.joined()
        try require(digest == config.native_sha256, "Fixture executable hash changed")
        try require(NSRunningApplication.runningApplications(withBundleIdentifier: "ai.arcee.nac.development-preview")
            .allSatisfy { $0.isTerminated }, "Refusing to affect an existing preview instance")
        try requireUnlockedConsole()
        // This initializer targets the exact verified relocated URL, never a
        // mutable LaunchServices bundle-ID registration or another checkout.
        let app = XCUIApplication(url: appURL)
        app.launchArguments = ["--smoke-output", config.evidence, "--smoke-scenario", "ci-terminal-xctest"]
        app.launchEnvironment = ["NAC_HOME": "/DO-NOT-USE-PERSONAL-NAC",
                                 "NAC_MANAGED_CONFIG": "/DO-NOT-INHERIT",
                                 "OPENAI_API_KEY": "must-not-reach-engine"]
        app.launch()
        var ready: [String: Any] = [:]
        let deadline = Date().addingTimeInterval(50)
        while Date() < deadline {
            if let record = try? evidence(config.evidence) {
                if record["ci_terminal_xctest_ready"] as? Bool == true { ready = record; break }
                try require(record["error"] == nil, "Native fixture failed before OS input")
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        try require(!ready.isEmpty, "Native fixture never became ready")
        let pid = try XCTUnwrap((ready["app_pid"] as? NSNumber)?.int32Value)
        let windowNumber = try XCTUnwrap((ready["target_window_number"] as? NSNumber)?.intValue)
        let running = try XCTUnwrap(NSRunningApplication(processIdentifier: pid))
        let launchDate = try XCTUnwrap(running.launchDate)
        try require(running.bundleURL?.resolvingSymlinksInPath() == appURL, "Fixture bundle identity changed")
        let command = "printf '" + marker.utf8.map { String(format: "\\%03o", Int($0)) }.joined()
            + "' > ci-native-input.txt; cat ci-native-input.txt"
        try require(ready["expected_operation"] as? String == command, "Fixture operation changed")
        try require(app.windows.count == 1, "Fixture window identity is ambiguous")
        let terminal = app.webViews.textViews.matching(identifier: "Terminal input").firstMatch
        try require(terminal.waitForExistence(timeout: 10), "Focused terminal accessibility element unavailable")
        // The owned fixture focuses the xterm textarea. Apple's typeText API
        // requires this element/descendant to have keyboard focus and errors
        // otherwise. Never click, refocus, or fall back to another element.
        for character in command {
            try requireTarget(running, url: appURL, launch: launchDate, window: windowNumber)
            terminal.typeText(String(character))
        }
        try requireTarget(running, url: appURL, launch: launchDate, window: windowNumber)
        terminal.typeKey(.return, modifierFlags: [])
        XCTAssertTrue(app.wait(for: .notRunning, timeout: 60), "Native fixture did not settle and close")
        let result = try evidence(config.evidence)
        XCTAssertEqual(result["passed"] as? Bool, true)
        XCTAssertEqual(result["engine_reaped"] as? Bool, true)
        XCTAssertEqual(result["profile_removed"] as? Bool, true)
        let input = try XCTUnwrap(result["trusted_terminal"] as? [String: Any])
        XCTAssertEqual(input["native_terminal_settled"] as? Bool, true)
        XCTAssertEqual(input["exact_receipt"] as? Bool, true)
        XCTAssertEqual(input["synthetic_keydowns"] as? Int, 0)
        XCTAssertGreaterThanOrEqual(input["trusted_keydowns"] as? Int ?? 0, command.count + 1)
    }

    @MainActor
    func testTerminalUnicodeControlResize() throws {
        continueAfterFailure = false
        executionTimeAllowance = 380
        let configPath = try XCTUnwrap(ProcessInfo.processInfo.environment["NAC_UI_FIXTURE"])
        let configBytes = try Data(contentsOf: URL(fileURLWithPath: configPath))
        let config = try XCTUnwrap(JSONSerialization.jsonObject(with: configBytes) as? [String: Any])
        let appURL = URL(fileURLWithPath: try XCTUnwrap(config["app_path"] as? String)).resolvingSymlinksInPath()
        let output = try XCTUnwrap(config["evidence"] as? String)
        let operations = try XCTUnwrap(config["operations"] as? [[String: Any]])
        let names = ["unicode", "interrupt-arm", "interrupt", "recovery", "resize", "size-readback"]
        try require(config["scenario"] as? String == "terminal-xctest" && operations.count == 6,
                    "Unexpected terminal fixture contract")
        try require(appURL.lastPathComponent == "NAC Development Preview.app"
                    && appURL.path.contains("/nac-mac-relocation-"), "Unexpected terminal bundle URL")
        let executable = appURL.appendingPathComponent("Contents/MacOS/NACPreview")
        let digest = SHA256.hash(data: try Data(contentsOf: executable)).map { String(format: "%02x", $0) }.joined()
        try require(digest == config["native_sha256"] as? String, "Terminal executable hash changed")
        try require(NSRunningApplication.runningApplications(withBundleIdentifier: "ai.arcee.nac.development-preview")
            .allSatisfy { $0.isTerminated }, "Refusing to affect an existing preview instance")
        try requireUnlockedConsole()
        let app = XCUIApplication(url: appURL)
        app.launchArguments = ["--smoke-output", output, "--smoke-scenario", "terminal-xctest"]
        app.launchEnvironment = ["NAC_HOME": "/DO-NOT-USE-PERSONAL-NAC", "NAC_MANAGED_CONFIG": "/DO-NOT-INHERIT",
                                 "OPENAI_API_KEY": "must-not-reach-engine"]
        app.launch()
        let first = try waitTerminalPhase(output, sequence: 1, timeout: 90)
        let identity = try XCTUnwrap(first["terminal_xctest_identity"] as? [String: Any])
        let pid = try XCTUnwrap((identity["app_pid"] as? NSNumber)?.int32Value)
        let number = try XCTUnwrap(identity["target_window_number"] as? Int)
        let running = try XCTUnwrap(NSRunningApplication(processIdentifier: pid))
        let launch = try XCTUnwrap(running.launchDate)
        let epoch = try XCTUnwrap(identity["app_launch_epoch"] as? Double)
        try require(identity["schema"] as? Int == 1 && identity["bundle_path"] as? String == appURL.path
                    && abs(epoch - launch.timeIntervalSince1970) < 0.01
                    && identity["unfocused_guard_rejected"] as? Bool == true
                    && !(identity["session_id"] as? String ?? "").isEmpty
                    && !(identity["terminal_id"] as? String ?? "").isEmpty
                    && !(identity["controller_revision"] as? String ?? "").isEmpty,
                    "Terminal initial incarnation/negative guard differs")
        try require(app.windows.count == 1, "Ambiguous terminal fixture window")
        let window = app.windows.firstMatch
        let initialFrame = window.frame
        let terminals = app.webViews.textViews.matching(identifier: "Terminal input")
        try require(terminals.count == 1, "Expected one terminal accessibility element")
        let terminal = terminals.firstMatch
        var dispatched: [[String: Any]] = []
        var observerBinding = try XCTUnwrap(config["observer_binding"] as? [String: Any])
        try require(observerBinding["test_identifier_url"] as? String ==
            "test://com.apple.xcode/NACNativeUITests/NACNativeUITests/NativeJourneys/testTerminalUnicodeControlResize",
            "Unexpected observer test identity")
        observerBinding["configuration_sha256"] = SHA256.hash(data: configBytes)
            .map { String(format: "%02x", $0) }.joined()
        observerBinding["native_sha256"] = digest
        observerBinding["app"] = identity
        func retainDispatch(_ event: Int, _ stage: String) throws {
            let snapshot: [String: Any] = ["schema": "nac352-dispatch-v1", "event_index": event,
                "stage": stage, "uptime_ns": String(DispatchTime.now().uptimeNanoseconds),
                "binding": observerBinding, "rows": dispatched]
            let data = try JSONSerialization.data(withJSONObject: snapshot, options: [.prettyPrinted, .sortedKeys])
            try require(data.count <= 64 * 1024, "Observer snapshot exceeds its fixed bound")
            let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
            attachment.name = String(format: "nac352-dispatch-v1-%02d-%@", event, stage)
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        for (index, expected) in operations.enumerated() {
            let sequence = index + 1
            try require(expected["sequence"] as? Int == sequence && expected["name"] as? String == names[index],
                        "Nominated terminal phase order differs")
            _ = try waitTerminalPhase(output, sequence: sequence, timeout: 65)
            let operation = try XCTUnwrap(expected["operation"] as? [String: Any])
            func guardOperation() throws {
                try requireTarget(running, url: appURL, launch: launch, window: number)
                try require(app.windows.count == 1 && terminals.count == 1, "Terminal window/element became ambiguous")
                let current = try evidence(output)
                try require(current["error"] == nil, "Terminal app rejected input episode")
                let currentIdentity = try XCTUnwrap(current["terminal_xctest_identity"] as? [String: Any])
                try require(NSDictionary(dictionary: currentIdentity).isEqual(NSDictionary(dictionary: identity)),
                            "Terminal controller/process identity changed")
                let phase = try XCTUnwrap(current["terminal_xctest_phase"] as? [String: Any])
                let actual = try XCTUnwrap(phase["operation"] as? [String: Any])
                try require(phase["schema"] as? Int == 1 && phase["sequence"] as? Int == sequence
                            && phase["name"] as? String == names[index] && phase["state"] as? String == "ready"
                            && phase["seconds_limit"] as? Int == expected["seconds_limit"] as? Int
                            && NSDictionary(dictionary: actual).isEqual(NSDictionary(dictionary: operation)),
                            "Terminal phase/literal changed; refusing dispatch")
                try require(phase["app_pid"] as? Int == Int(pid) && phase["target_window_number"] as? Int == number
                            && phase["session_id"] as? String == identity["session_id"] as? String
                            && phase["terminal_id"] as? String == identity["terminal_id"] as? String,
                            "Terminal phase target changed")
            }
            try guardOperation()
            let started = Date()
            var dispatch = expected
            dispatch["state"] = "dispatching-once"
            dispatched.append(dispatch)
            try retainDispatch(index * 2 + 1, "before")
            switch operation["kind"] as? String {
            case "type-text-and-return":
                let text = try XCTUnwrap(operation["text"] as? String)
                // Each public operation uses the nominated config literal;
                // live readiness can only match or reject it, never supply it.
                for character in text {
                    try guardOperation()
                    terminal.typeText(String(character))
                }
                try guardOperation()
                terminal.typeKey(.return, modifierFlags: [])
            case "key":
                try require(sequence == 3 && operation["key"] as? String == "c"
                            && operation["modifiers"] as? [String] == ["control"], "Unexpected terminal control key")
                terminal.typeKey("c", modifierFlags: .control)
            case "resize-window":
                try require(sequence == 5 && operation["width_delta"] as? Int == -160
                            && operation["height_delta"] as? Int == -80, "Unexpected native resize")
                try require(abs(window.frame.width - initialFrame.width) <= 2
                            && abs(window.frame.height - initialFrame.height) <= 2, "Window frame changed before resize")
                // One declared public mouse drag on this exact owned window.
                // No terminal click/refocus, private AX setter or app bridge.
                let corner = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1))
                    .withOffset(CGVector(dx: -5, dy: -5))
                try guardOperation()
                corner.click(forDuration: 0.1, thenDragTo: corner.withOffset(CGVector(dx: -160, dy: -80)))
            default:
                throw NSError(domain: "NACUI", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unknown terminal operation"])
            }
            dispatched[index]["state"] = "dispatched-once"
            dispatched[index]["elapsed_ms"] = Int(Date().timeIntervalSince(started) * 1000)
            try retainDispatch(index * 2 + 2, "after")
        }
        XCTAssertTrue(app.wait(for: .notRunning, timeout: 70), "Terminal app did not settle and close")
        let result = try evidence(output)
        XCTAssertEqual(result["passed"] as? Bool, true)
        XCTAssertEqual(result["engine_reaped"] as? Bool, true)
        XCTAssertEqual(result["profile_removed"] as? Bool, true)
        XCTAssertEqual((result["terminal_xctest_phases"] as? [[String: Any]])?.count, 6)
        XCTAssertEqual((result["terminal_xctest_phase"] as? [String: Any])?["state"] as? String, "finished")
    }

    private func waitTerminalPhase(_ path: String, sequence: Int, timeout: TimeInterval) throws -> [String: Any] {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let record = try? evidence(path) {
                try require(record["error"] == nil && record["passed"] as? Bool != false,
                            "Terminal fixture failed before next phase")
                if let phase = record["terminal_xctest_phase"] as? [String: Any], let current = phase["sequence"] as? Int {
                    try require(current <= sequence, "Terminal phase advanced without its one dispatch")
                    if current == sequence && phase["state"] as? String == "ready" { return record }
                }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.025))
        }
        throw NSError(domain: "NACUI", code: 3, userInfo: [NSLocalizedDescriptionKey: "Terminal phase readiness deadline exceeded"])
    }

    @MainActor
    private func requireTarget(_ app: NSRunningApplication, url: URL, launch: Date, window: Int) throws {
        try require(!app.isTerminated && app.launchDate == launch, "Fixture process incarnation changed")
        try require(app.bundleURL?.resolvingSymlinksInPath() == url, "Fixture bundle changed")
        try require(NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier,
                    "Fixture lost frontmost ownership; stopping input")
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        try require(windows.filter {
            ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == app.processIdentifier
                && ($0[kCGWindowNumber as String] as? NSNumber)?.intValue == window
        }.count == 1, "Exact owned fixture window is no longer on screen")
        try requireUnlockedConsole()
    }

    private func requireUnlockedConsole() throws {
        let session = try XCTUnwrap(CGSessionCopyCurrentDictionary() as? [String: Any])
        try require(session[kCGSessionOnConsoleKey as String] as? Bool == true
                    && session[kCGSessionLoginDoneKey as String] as? Bool == true
                    && session["CGSSessionScreenIsLocked"] as? Bool != true,
                    "Caller session unavailable or locked")
        let root = IORegistryGetRootEntry(kIOMainPortDefault)
        try require(root != 0, "Root console observation unavailable")
        defer { IOObjectRelease(root) }
        func property(_ name: String) -> Any? {
            IORegistryEntryCreateCFProperty(root, name as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue()
        }
        try require(property("IOConsoleLocked") as? Bool == false, "Console is locked or unknown")
        let users = property("IOConsoleUsers") as? [[String: Any]] ?? []
        let user = try XCTUnwrap(users.first {
            ($0["kCGSSessionUserIDKey"] as? NSNumber)?.uint32Value == getuid()
                && $0["kCGSSessionOnConsoleKey"] as? Bool == true
        })
        try require(user["kCGSessionLoginDoneKey"] as? Bool == true
                    && user["CGSSessionScreenIsLocked"] as? Bool != true, "Console login/lock changed")
    }
}
