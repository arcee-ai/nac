import AppKit
import CoreGraphics
import CryptoKit
import IOKit
import XCTest
import XCUIAutomation

private enum OwnedLaunchFailure: Error { case identityUnknown, cleanupOrReceiptFailed }

/// Installs failure cleanup before launch, not after fallible provenance/logging.
/// An unknown owner is recorded as failed cleanup and never broadly terminated.
@MainActor
private func withOwnedAppLaunch<Owner>(launch: () throws -> Void, capture: () -> Owner?,
    operation: (Owner) throws -> Void, cleanup: (Owner) -> Bool,
    retain: (Bool, String) -> Bool) throws {
    var owner: Owner?
    var finalized = false
    func finish() -> Bool {
        let stopped = owner.map(cleanup) ?? false
        let retained = retain(stopped, owner == nil ? "launch_identity_unknown" : stopped ? "owned_app_stopped" : "cleanup_failed")
        return stopped && retained
    }
    defer { if !finalized { _ = finish() } }
    try launch()
    owner = capture() // Nonthrowing; unknown/ambiguous identity is not authority.
    guard let owner else { throw OwnedLaunchFailure.identityUnknown }
    try operation(owner)
    let completed = finish()
    finalized = true
    guard completed else { throw OwnedLaunchFailure.cleanupOrReceiptFailed }
}

/// External calibration of ordinary release apps. Never an input-latency probe.
/// ALL-354 integrates this allocated source into its real Xcode UI-test target.
final class PerformanceJourneys: XCTestCase {
    struct Arm: Decodable {
        let name: String
        let app_path: String
        let native_sha256: String
        let arguments: [String]
        let environment: [String: String]
        let project_label: String
        let url: String?
    }
    struct Configuration: Decodable {
        let schema: String
        let output: String
        let deadline_uptime_ns: UInt64
        let requested_input_characters: Int
        let input_batch_characters: Int
        let arms: [Arm]
        let trial: Trial?
    }
    struct Trial: Decodable {
        let trial: Int
        let action: String
        let cell: String
        let observer: String
        let window_state: String
        let session_count: Int
        let session_titles: [String]
        let preopened_ptys: Bool
        let settle_seconds: Int
        let duration_seconds: Double
        let input: Bool
        let terminal_command: String
    }
    private var records: [[String: Any]] = []
    private var config: Configuration!
    private var output: URL!

    private func require(_ valid: @autoclosure () -> Bool, _ message: String) throws {
        guard valid() else { throw NSError(domain: "NACPerformanceCalibration", code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]) }
    }

    private func record(_ event: String, _ fields: [String: Any] = [:]) throws {
        try require(records.count < 4096, "Calibration observation buffer full")
        records.append(fields.merging(["event": event,
            "uptime_ns": String(DispatchTime.now().uptimeNanoseconds)]) { _, new in new })
        let data = try JSONSerialization.data(withJSONObject: [
            "schema": "nac-mac-ui-calibration-v1", "observations": records,
            "nac_performance_distributions": NSNull(), "input_latency": NSNull(),
            "frame_samples": NSNull(), "trusted_event_count": NSNull(),
            "scope": "Public driver calibration; API scheduling and AX observations are not key-to-paint latency"
        ], options: [.prettyPrinted, .sortedKeys])
        try require(data.count <= 4 * 1024 * 1024, "Driver receipt byte limit exceeded; evidence incomplete")
        try data.write(to: output, options: .atomic)
    }

    private func deadline() throws {
        try require(DispatchTime.now().uptimeNanoseconds < config.deadline_uptime_ns,
                    "Calibration phase deadline exceeded")
    }

    private func console() throws {
        let session = try XCTUnwrap(CGSessionCopyCurrentDictionary() as? [String: Any])
        try require(session[kCGSessionOnConsoleKey as String] as? Bool == true
                    && session[kCGSessionLoginDoneKey as String] as? Bool == true
                    && session["CGSSessionScreenIsLocked"] as? Bool != true,
                    "Caller is not an unlocked active console session")
        let root = IORegistryGetRootEntry(kIOMainPortDefault)
        try require(root != 0, "Console observation unavailable")
        defer { IOObjectRelease(root) }
        let lock = IORegistryEntryCreateCFProperty(root, "IOConsoleLocked" as CFString,
            kCFAllocatorDefault, 0)?.takeRetainedValue() as? Bool
        try require(lock == false, "Console lock is true or unknown; no input permitted")
        let users = IORegistryEntryCreateCFProperty(root, "IOConsoleUsers" as CFString,
            kCFAllocatorDefault, 0)?.takeRetainedValue() as? [[String: Any]] ?? []
        let user = try XCTUnwrap(users.first {
            ($0["kCGSSessionUserIDKey"] as? NSNumber)?.uint32Value == getuid()
                && $0["kCGSSessionOnConsoleKey"] as? Bool == true
        })
        try require(user["kCGSessionLoginDoneKey"] as? Bool == true
            && user["CGSSessionScreenIsLocked"] as? Bool != true, "Console user/login changed")
    }

    @MainActor
    private func bind(_ app: XCUIApplication, url: URL) throws -> (NSRunningApplication, Date, Int) {
        let identifier = try XCTUnwrap(Bundle(url: url)?.bundleIdentifier)
        let matches = NSRunningApplication.runningApplications(withBundleIdentifier: identifier).filter {
            !$0.isTerminated && $0.bundleURL?.resolvingSymlinksInPath() == url
        }
        try require(matches.count == 1, "Exact newly launched app process is ambiguous")
        let running = matches[0]
        try require(running.bundleURL?.resolvingSymlinksInPath() == url, "Wrong app URL")
        let launch = try XCTUnwrap(running.launchDate)
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID) as? [[String: Any]] ?? []
        let owned = windows.filter {
            ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == running.processIdentifier
                && ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0
        }
        try require(app.windows.count == 1 && owned.count == 1, "Owned window is ambiguous")
        let window = try XCTUnwrap((owned[0][kCGWindowNumber as String] as? NSNumber)?.intValue)
        return (running, launch, window)
    }

    @MainActor
    private func guardInput(_ binding: (NSRunningApplication, Date, Int), url: URL) throws {
        try deadline()
        try console()
        let (running, launch, window) = binding
        try require(!running.isTerminated && running.launchDate == launch
                    && running.bundleURL?.resolvingSymlinksInPath() == url,
                    "App incarnation or executable binding changed")
        try require(NSWorkspace.shared.frontmostApplication?.processIdentifier == running.processIdentifier,
                    "Focus changed; refusing input or focus restoration")
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID) as? [[String: Any]] ?? []
        try require(windows.filter {
            ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == running.processIdentifier
                && ($0[kCGWindowNumber as String] as? NSNumber)?.intValue == window
        }.count == 1, "Exact fixture window no longer visible")
    }

    @MainActor
    private func element(_ query: XCUIElementQuery, label: String) throws -> XCUIElement {
        let found = query.matching(NSPredicate(format: "label == %@ OR identifier == %@", label, label))
        let first = found.firstMatch
        try require(first.waitForExistence(timeout: 10) && found.count == 1 && first.isHittable,
                    "Required unique accessible element unavailable: \(label)")
        return first
    }

    @MainActor
    private func type100(_ element: XCUIElement, binding: (NSRunningApplication, Date, Int),
                         url: URL, arm: String, surface: String) throws {
        try guardInput(binding, url: url)
        element.click()
        for index in 0..<config.requested_input_characters {
            try guardInput(binding, url: url)
            let before = DispatchTime.now().uptimeNanoseconds
            // Per-character baseline only. Batching needs a separately measured
            // and approved revision with actual trusted-event receipts.
            element.typeText("x")
            try record("typing_api_call", ["arm": arm, "surface": surface, "index": index,
                "started_uptime_ns": String(before),
                "returned_uptime_ns": String(DispatchTime.now().uptimeNanoseconds),
                "requested_characters": 1, "event_to_paint_ns": NSNull()])
        }
        try record("typing_sequence_completed", ["arm": arm, "surface": surface,
            "requested_characters": config.requested_input_characters,
            "actual_trusted_keydowns": NSNull(), "actual_synthetic_keydowns": NSNull(),
            "receipt_status": "ordinary release target has no approved key/paint observation hook"])
    }

    @MainActor
    private func calibrate(_ arm: Arm) throws {
        try deadline()
        try console()
        let url = URL(fileURLWithPath: arm.app_path).resolvingSymlinksInPath()
        let bundle = try XCTUnwrap(Bundle(url: url))
        let executable = try XCTUnwrap(bundle.executableURL)
        let hash = SHA256.hash(data: try Data(contentsOf: executable)).map { String(format: "%02x", $0) }.joined()
        try require(hash == arm.native_sha256, "Calibration binary hash changed")
        let identifier = try XCTUnwrap(bundle.bundleIdentifier)
        try require(NSRunningApplication.runningApplications(withBundleIdentifier: identifier)
            .allSatisfy { $0.isTerminated }, "Refusing to affect an existing app instance")
        let app = XCUIApplication(url: url)
        app.launchArguments = arm.arguments
        app.launchEnvironment = arm.environment
        let start = DispatchTime.now().uptimeNanoseconds
        let invoked = Date()
        var unknown = "launch_did_not_return"
        var ownedPID: pid_t?
        try withOwnedAppLaunch(launch: { app.launch() }, capture: { () -> (NSRunningApplication, Date)? in
            let processes = NSRunningApplication.runningApplications(withBundleIdentifier: identifier).filter {
                !$0.isTerminated && $0.bundleURL?.resolvingSymlinksInPath() == url
            }
            guard processes.count == 1 else { unknown = "process_count_not_one"; return nil }
            let running = processes[0]
            guard let date = running.launchDate, date >= invoked else { unknown = "launch_date_unknown_or_older"; return nil }
            guard running.executableURL?.resolvingSymlinksInPath() == executable.resolvingSymlinksInPath()
                && (app.state == .runningForeground || app.state == .runningBackground) else {
                unknown = "owned_launch_handle_or_executable_unknown"; return nil
            }
            ownedPID = running.processIdentifier
            return (running, date)
        }, operation: { owner in
            let (running, launch) = owner
            try record("app_launched", ["arm": arm.name, "pid": running.processIdentifier,
                "launch_date": launch.timeIntervalSince1970,
                "launch_unix_us": String(Int64((launch.timeIntervalSince1970 * 1_000_000).rounded())),
                "executable": executable.resolvingSymlinksInPath().path,
                "native_sha256": hash, "invoked_uptime_ns": String(start)])
            do {
                var binding = try bind(app, url: url)
                try guardInput(binding, url: url)
                if arm.name == "browser" {
                    try require(identifier == "com.apple.Safari", "Browser arm must be ordinary Safari")
                    // Close only this newly launched fixture's initial window.
                    // Never change a browser preference to obtain private mode.
                    app.typeKey("w", modifierFlags: .command)
                    try require(app.windows.count == 0 && !binding.0.isTerminated
                        && binding.0.launchDate == binding.1
                        && NSWorkspace.shared.frontmostApplication?.processIdentifier == binding.0.processIdentifier,
                        "Safari initial window did not close under retained ownership")
                    try console()
                    app.typeKey("n", modifierFlags: [.command, .shift])
                    try require(app.windows.count == 1, "Safari needs one isolated private fixture window")
                    binding = try bind(app, url: url)
                    let address = try XCTUnwrap(arm.url)
                    let parsed = try XCTUnwrap(URL(string: address))
                    try require(parsed.scheme == "http" && parsed.host == "127.0.0.1"
                        && parsed.port != nil && parsed.user == nil && parsed.password == nil,
                        "Fixture URL is not an explicit owned loopback endpoint")
                    try guardInput(binding, url: url)
                    app.typeKey("l", modifierFlags: .command)
                    app.typeText(address)
                    app.typeKey(.return, modifierFlags: [])
                }
                let project = try element(app.webViews.staticTexts, label: arm.project_label)
                try guardInput(binding, url: url)
                project.click()
                let composer = try element(app.webViews.firstMatch.descendants(matching: .any), label: "Message")
                try record("workspace_ax_ready", ["arm": arm.name,
                    "paint_time_ns": NSNull(), "actual_css_viewport": NSNull(),
                    "ax_webview_width_points": app.webViews.firstMatch.frame.width,
                    "ax_webview_height_points": app.webViews.firstMatch.frame.height])
                if let trial = config.trial {
                    if trial.action == "warmup" {
                        try record("warmup_workspace_ready", ["trial": trial.trial])
                        return
                    }
                    try performTrial(trial, app: app, arm: arm, binding: binding, url: url)
                    return
                }
                try type100(composer, binding: binding, url: url, arm: arm.name, surface: "composer")
                try guardInput(binding, url: url)
                composer.typeKey("a", modifierFlags: .command)
                composer.typeKey(.delete, modifierFlags: [])
                let panel = app.webViews.buttons.matching(identifier: "Show panel").firstMatch
                if panel.exists {
                    try guardInput(binding, url: url)
                    panel.click()
                }
                let terminalTab = app.webViews.buttons.matching(identifier: "Terminal").firstMatch
                if terminalTab.exists {
                    try guardInput(binding, url: url)
                    terminalTab.click()
                }
                let newShell = try element(app.webViews.buttons, label: "New shell")
                try guardInput(binding, url: url)
                newShell.click()
                let terminal = try element(app.webViews.textViews, label: "Terminal input")
                try type100(terminal, binding: binding, url: url, arm: arm.name, surface: "terminal")
                try record("arm_calibration_completed", ["arm": arm.name,
                    "actual_input_latency_distribution": NSNull(), "frame_distribution": NSNull()])
            } catch {
                try? record("arm_calibration_failed", ["arm": arm.name, "reason": "UI calibration or ownership gate failed"])
                throw error
            }
        }, cleanup: { owner in
            let (running, launch) = owner
            guard running.launchDate == launch && running.bundleURL?.resolvingSymlinksInPath() == url
                && running.executableURL?.resolvingSymlinksInPath() == executable.resolvingSymlinksInPath() else { return false }
            if running.isTerminated { return true }
            app.terminate() // The exact XCUIApplication launch handle, never a bundle-name sweep.
            return app.wait(for: .notRunning, timeout: 30) && running.isTerminated
        }, retain: { stopped, reason in
            do {
                try record("app_cleanup", ["arm": arm.name, "owned_pid": ownedPID.map { Int($0) as Any } ?? NSNull(),
                    "app_stopped": stopped, "cleanup_status": stopped ? "confirmed" : "failed_or_unknown",
                    "reason": reason == "launch_identity_unknown" ? unknown : reason,
                    "engine_pty_cleanup": "external exact-identity collector must confirm"])
                return true
            } catch { return false }
        })
    }

    @MainActor
    private func pause(_ seconds: Double, binding: (NSRunningApplication, Date, Int),
                       url: URL, hidden: Bool = false) throws {
        let until = DispatchTime.now().uptimeNanoseconds + UInt64(seconds * 1_000_000_000)
        while DispatchTime.now().uptimeNanoseconds < until {
            try deadline()
            try console()
            try require(!binding.0.isTerminated && binding.0.launchDate == binding.1,
                        "Owned process changed during workload interval")
            if hidden {
                try require(binding.0.isHidden && NSWorkspace.shared.frontmostApplication?.processIdentifier
                    != binding.0.processIdentifier, "Hidden workload became active")
            } else { try guardInput(binding, url: url) }
            Thread.sleep(forTimeInterval: 0.05)
        }
    }

    @MainActor
    private func performTrial(_ trial: Trial, app: XCUIApplication, arm: Arm,
        binding: (NSRunningApplication, Date, Int), url: URL) throws {
        try require([1, 8].contains(trial.session_count) && trial.session_titles.count == trial.session_count,
                    "Closed fixture session cardinality changed")
        try require(["active", "hidden"].contains(trial.window_state)
            && ["on", "off"].contains(trial.observer), "Unsupported finite workload state")
        try record("finite_workload_setup", ["trial": trial.trial, "cell": trial.cell,
            "session_count": trial.session_count, "requested_pty_columns": 120, "requested_pty_rows": 36,
            "actual_pty_dimensions": NSNull(), "requested_css_viewport": [900, 600],
            "actual_css_viewport": NSNull(), "observer": trial.observer,
            "clock_mapping_uncertainty_ns": NSNull()])
        for title in trial.session_titles {
            let session = try element(app.webViews.buttons, label: title)
            try guardInput(binding, url: url)
            session.click()
            let panel = app.webViews.buttons.matching(identifier: "Show panel").firstMatch
            if panel.exists { try guardInput(binding, url: url); panel.click() }
            let tab = app.webViews.buttons.matching(identifier: "Terminal").firstMatch
            if tab.exists { try guardInput(binding, url: url); tab.click() }
            if !trial.preopened_ptys {
                let shell = try element(app.webViews.buttons, label: "New shell")
                try guardInput(binding, url: url)
                shell.click()
            }
            _ = try element(app.webViews.textViews, label: "Terminal input")
            try record("session_shell_ui_opened", ["trial": trial.trial, "session_title": title,
                "pty_incarnation": NSNull(), "live_session_pty_count_verified": false])
        }
        // Keep all previously opened session shells alive through normal UI
        // ownership. The missing native runtime receipt/API binding must prove
        // their identities, cardinality and120x36 dimensions before admission.
        try pause(Double(trial.settle_seconds), binding: binding, url: url)
        let began = DispatchTime.now().uptimeNanoseconds
        try record("finite_workload_started", ["trial": trial.trial, "action": trial.action])
        if trial.window_state == "hidden" || trial.action == "hide_reshow" {
            try guardInput(binding, url: url)
            try require(binding.0.hide(), "Owned application did not hide")
            try pause(trial.duration_seconds, binding: binding, url: url, hidden: true)
            try require(binding.0.launchDate == binding.1 && !binding.0.isTerminated,
                        "Owned app changed before explicit reshow")
            try require(binding.0.unhide() && binding.0.activate(options: []), "Owned app reshow failed")
            try guardInput(binding, url: url)
            try record("owned_window_reshown", ["trial": trial.trial,
                "first_frame_ns": NSNull(), "same_engine_incarnation": NSNull()])
        } else {
            let composer = try element(app.webViews.firstMatch.descendants(matching: .any), label: "Message")
            let terminal = try element(app.webViews.textViews, label: "Terminal input")
            if trial.action == "stream" {
                try guardInput(binding, url: url)
                composer.click()
                composer.typeText("MAC_PERF_V1_STREAM")
                try guardInput(binding, url: url)
                composer.typeKey(.return, modifierFlags: [])
            } else if trial.action == "terminal" {
                try guardInput(binding, url: url)
                terminal.click()
                terminal.typeText(trial.terminal_command)
                try guardInput(binding, url: url)
                terminal.typeKey(.return, modifierFlags: [])
            }
            if trial.input {
                try type100(composer, binding: binding, url: url, arm: arm.name, surface: "composer")
                try type100(terminal, binding: binding, url: url, arm: arm.name, surface: "terminal")
            }
            let elapsed = Double(DispatchTime.now().uptimeNanoseconds - began) / 1_000_000_000
            if trial.duration_seconds > elapsed {
                try pause(trial.duration_seconds - elapsed, binding: binding, url: url)
            }
            if trial.action == "stream" {
                try require(app.webViews.staticTexts.containing(NSPredicate(format: "label CONTAINS %@",
                    "MAC_PERF_V1_DONE")).firstMatch.waitForExistence(timeout: 5), "Final streamed tail missing")
            }
        }
        try record("finite_trial_completed", ["trial": trial.trial, "cell": trial.cell,
            "elapsed_uptime_ns": String(DispatchTime.now().uptimeNanoseconds - began),
            "raw_frame_samples": NSNull(), "trusted_input_samples": NSNull(),
            "all100_events_overlap_load": NSNull(), "raw_signal_loss": NSNull(), "qualified": false])
    }

    @MainActor
    func testFiniteTrial() throws {
        continueAfterFailure = false
        executionTimeAllowance = 240
        let path = try XCTUnwrap(ProcessInfo.processInfo.environment["NAC_UI_FIXTURE"])
        config = try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        try require(config.schema == "nac-mac-finite-driver-v1" && config.arms.count == 1
            && config.requested_input_characters == 100 && config.input_batch_characters == 1,
                    "Unsupported finite driver contract")
        let trial = try XCTUnwrap(config.trial)
        try require(["fresh_launch", "warm_launch", "idle", "transcript", "stream", "terminal", "hide_reshow"]
            .contains(trial.action), "Unimplemented workload cannot be passed")
        output = URL(fileURLWithPath: config.output)
        try require(!FileManager.default.fileExists(atPath: output.path), "Refusing to overwrite trial evidence")
        try record("finite_trial_dispatch", ["trial": trial.trial])
        if trial.action == "warm_launch" {
            // Prime the same isolated profile/store, then measure its relaunch.
            // The first launch is retained as warmup, never a paired sample.
            try record("warmup_started", ["trial": trial.trial])
            let saved = config!
            // A launch-only warmup never types or creates an extra shell.
            config = Configuration(schema: saved.schema, output: saved.output,
                deadline_uptime_ns: saved.deadline_uptime_ns, requested_input_characters: saved.requested_input_characters,
                input_batch_characters: saved.input_batch_characters, arms: saved.arms,
                trial: Trial(trial: trial.trial, action: "warmup", cell: "warmup", observer: trial.observer,
                    window_state: "active", session_count: trial.session_count, session_titles: trial.session_titles,
                    preopened_ptys: trial.preopened_ptys,
                    settle_seconds: 0, duration_seconds: 0, input: false, terminal_command: ""))
            try calibrate(config.arms[0])
            config = saved
            try record("warmup_completed", ["trial": trial.trial])
        }
        try calibrate(config.arms[0])
    }

    @MainActor
    func testLaunchFailureCleanupContract() throws {
        enum Fault: Error { case injected }
        for stage in ["launch", "process_count", "launch_date", "record", "cleanup", "receipt"] {
            var cleanups = 0
            var retained: [Bool] = []
            XCTAssertThrowsError(try withOwnedAppLaunch(launch: {
                if stage == "launch" { throw Fault.injected }
            }, capture: { () -> Int? in
                stage == "process_count" || stage == "launch_date" ? nil : 7
            }, operation: { owner in
                XCTAssertEqual(owner, 7)
                if stage == "record" { throw Fault.injected }
            }, cleanup: { owner in
                XCTAssertEqual(owner, 7); cleanups += 1
                return stage != "cleanup"
            }, retain: { stopped, _ in
                retained.append(stopped)
                return stage != "receipt"
            }))
            XCTAssertEqual(cleanups, ["launch", "process_count", "launch_date"].contains(stage) ? 0 : 1)
            XCTAssertEqual(retained.count, 1)
            if cleanups == 0 || stage == "cleanup" { XCTAssertEqual(retained, [false]) }
        }
        var cleanups = 0
        var retained: [Bool] = []
        try withOwnedAppLaunch(launch: {}, capture: { 7 }, operation: { XCTAssertEqual($0, 7) },
            cleanup: { XCTAssertEqual($0, 7); cleanups += 1; return true },
            retain: { stopped, _ in retained.append(stopped); return true })
        XCTAssertEqual(cleanups, 1)
        XCTAssertEqual(retained, [true])
    }

    @MainActor
    func testCalibration() throws {
        continueAfterFailure = false
        executionTimeAllowance = 240
        let path = try XCTUnwrap(ProcessInfo.processInfo.environment["NAC_UI_FIXTURE"])
        config = try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        try require(config.schema == "nac-mac-performance-driver-v1"
            && config.requested_input_characters == 100 && config.input_batch_characters == 1
            && config.arms.map(\.name) == ["native", "browser"], "Unsupported calibration contract")
        output = URL(fileURLWithPath: config.output)
        try require(!FileManager.default.fileExists(atPath: output.path), "Refusing to overwrite evidence")
        try record("calibration_started")
        for arm in config.arms { try calibrate(arm) }
        try record("public_driver_calibration_completed", ["full_measurement_ready": false,
            "missing": ["trusted-event receipts", "raw key-to-paint", "raw frame", "queue export",
                        "equal CSS viewport proof", "whole helper attribution", "remaining workload trials"]])
    }
}
