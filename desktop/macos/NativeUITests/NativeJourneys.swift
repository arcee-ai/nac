import AppKit
import CoreGraphics
import CryptoKit
import IOKit
import XCTest
import XCUIAutomation

/// External, OS-generated ASCII input only. No physical keyboard/IME claim.
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
