import AppKit
import CoreGraphics
import CryptoKit
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
    private let marker = "NAC354_TRUSTED_OK"

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
        let config = try evidence(configPath)
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
        let driverOutput = URL(fileURLWithPath: try XCTUnwrap(config["driver_evidence"] as? String))
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
            try JSONSerialization.data(withJSONObject: dispatched, options: [.prettyPrinted, .sortedKeys])
                .write(to: driverOutput, options: .atomic)
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
            try JSONSerialization.data(withJSONObject: dispatched, options: [.prettyPrinted, .sortedKeys])
                .write(to: driverOutput, options: .atomic)
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
