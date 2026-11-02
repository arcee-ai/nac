import AppKit
import CoreGraphics
import CryptoKit
import Darwin
import IOKit
import XCTest
import XCUIAutomation

/// Two finite wrappers around the actual ALL-347 helper. No product mutations.
@MainActor
final class PathJourneys: XCTestCase {
    private var observer: PathPhaseObserver?
    private var config: [String: Any] = [:]
    private var configHash = ""
    private var configurationURL = URL(fileURLWithPath: "/missing")
    private var captures = Set<String>()
    private var captureBytes = 0
    private var inputs = 0
    private var finderBaselineRetained = false
    private var owner: NSRunningApplication?
    private var launch: Date?
    private var windowNumber = 0
    private var engine: [UInt64] = []
    private var appURL = URL(fileURLWithPath: "/missing")
    private var output = URL(fileURLWithPath: "/missing")
    private var policy: [String: Any] = [:]

    func testFolderSelection() throws { try journey(failure: false) }
    func testPendingEngineFailure() throws { try journey(failure: true) }

    private func need(_ value: Bool, _ message: String) throws { try PathPhaseObserver.need(value, message) }
    private func attach(_ name: String, _ value: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        try need(data.count <= 256 * 1024, "Essential XCTest receipt bound")
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func command(_ path: String, _ arguments: [String]) throws -> String {
        let process = Process(), pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = arguments
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        try process.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        try need(process.terminationStatus == 0 && data.count < 256 * 1024, "Read-only authorization observation unavailable")
        return String(decoding: data, as: UTF8.self)
    }
    private func currentPolicy() throws -> [String: Any] {
        let rowsText = try command("/usr/bin/sudo", ["-n", "/usr/bin/sqlite3", "-json", "-readonly",
            "/Library/Application Support/com.apple.TCC/TCC.db",
            "SELECT service,client,client_type,auth_value,auth_reason,auth_version,hex(csreq) AS csreq_hex,policy_id,indirect_object_identifier_type,indirect_object_identifier,hex(indirect_object_code_identity) AS indirect_identity_hex,flags,last_modified FROM access WHERE service='kTCCServiceAccessibility' AND client='com.apple.dt.Xcode-Helper' AND client_type=0;"])
        let rows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(rowsText.utf8)) as? [[String: Any]])
        try need(rows.count == 1 && rows[0]["auth_value"] as? Int == 2, "Existing Xcode Helper authorization missing")
        var helper = rows[0]; helper.removeValue(forKey: "last_modified")
        let developer = try command("/usr/sbin/DevToolsSecurity", ["-status"]).lowercased()
        // Resolve the same existing tool as H; no provisioning or mode change.
        let automation = try command("/usr/bin/env", ["automationmodetool"])
        try need(developer.contains("enabled") && !developer.contains("disabled") && automation.contains("DOES NOT REQUIRE"),
                 "Existing developer/automation policy unavailable")
        return ["helper": helper, "developer_mode_enabled": true, "automation_authentication_required": false]
    }
    private func console() throws {
        let session = try XCTUnwrap(CGSessionCopyCurrentDictionary() as? [String: Any])
        try need(session[kCGSessionOnConsoleKey as String] as? Bool == true
            && session[kCGSessionLoginDoneKey as String] as? Bool == true
            && session["CGSSessionScreenIsLocked"] as? Bool != true && !NSScreen.screens.isEmpty,
                 "Caller Aqua console locked/unavailable")
        let root = IORegistryGetRootEntry(kIOMainPortDefault)
        try need(root != 0, "IORegistry console unavailable")
        defer { IOObjectRelease(root) }
        func property(_ name: String) -> Any? {
            IORegistryEntryCreateCFProperty(root, name as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue()
        }
        try need(property("IOConsoleLocked") as? Bool == false, "Console lock unknown")
        let users = property("IOConsoleUsers") as? [[String: Any]] ?? []
        try need(users.contains { row in
            (row["kCGSSessionUserIDKey"] as? NSNumber)?.uint32Value == getuid()
                && row["kCGSSessionOnConsoleKey"] as? Bool == true
                && row["kCGSessionLoginDoneKey"] as? Bool == true
                && row["CGSSessionScreenIsLocked"] as? Bool != true
        }, "Same-user unlocked console unavailable")
        try need(NSWorkspace.shared.frontmostApplication?.bundleIdentifier != "com.apple.loginwindow"
                    && NSWorkspace.shared.frontmostApplication != nil, "Unknown frontmost owner")
    }
    private func process(_ pid: Int32, path: String, parent: Int32) throws -> [UInt64] {
        func sample() throws -> [UInt64] {
            var bsd = proc_bsdinfo()
            let size = Int32(MemoryLayout<proc_bsdinfo>.size)
            try need(proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &bsd, size) == size && bsd.pbi_uid == getuid()
                        && bsd.pbi_ppid == UInt32(parent) && bsd.pbi_start_tvsec > 0, "Engine owner/start unavailable")
            var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
            try need(proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 && String(cString: buffer) == path,
                     "Engine executable differs")
            return [UInt64(bsd.pbi_pid), bsd.pbi_start_tvsec, bsd.pbi_start_tvusec]
        }
        let first = try sample()
        try need(first == sample(), "Engine changed during observation")
        return first
    }
    private func windows(_ pid: Int32) -> [[String: Any]] {
        let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        return rows.filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid
            && $0[kCGWindowLayer as String] as? Int == 0 }
    }
    private func guardOwner(frontmost: Bool = true) throws {
        let running = try XCTUnwrap(owner), date = try XCTUnwrap(launch), phaseReader = try XCTUnwrap(observer)
        try console()
        try need(try PathPhaseObserver.hash(configurationURL) == configHash, "Nominated configuration changed")
        let sourceFiles = try XCTUnwrap(config["compiler_sources"] as? [String: String])
        try need(sourceFiles.count == 4, "Actual compiler source roster changed")
        for (path, expected) in sourceFiles {
            let url = URL(fileURLWithPath: path)
            try need(url.path == url.resolvingSymlinksInPath().path && PathPhaseObserver.hash(url) == expected,
                     "Actual H/T/helper compiler input changed")
        }
        try need(!running.isTerminated && running.launchDate == date && running.bundleURL == appURL
            && running.executableURL?.path == appURL.appendingPathComponent("Contents/MacOS/NACPreview").path,
                 "App launch/bundle changed")
        if frontmost {
            try need(NSWorkspace.shared.frontmostApplication?.processIdentifier == running.processIdentifier,
                     "App lost frontmost ownership")
        }
        try need(windows(running.processIdentifier).filter {
            $0[kCGWindowNumber as String] as? Int == windowNumber
        }.count == 1, "Exact visible app window missing")
        try need(try PathPhaseObserver.hash(appURL.appendingPathComponent("Contents/MacOS/NACPreview")) == config["native_sha256"] as? String
            && PathPhaseObserver.hash(appURL.appendingPathComponent("Contents/Resources/nac-web")) == config["engine_sha256"] as? String,
                 "App/engine bytes changed")
        try need(try process(Int32(phaseReader.scope.engine_pid), path: appURL.appendingPathComponent("Contents/Resources/nac-web").path,
                             parent: running.processIdentifier) == engine, "Engine generation changed")
        try need(NSDictionary(dictionary: try currentPolicy()).isEqual(NSDictionary(dictionary: policy)), "Persistent authorization policy changed")
    }
    private func capture(_ name: String, window: XCUIElement, phase: NativePathJourney.Phase, finder: Bool = false) throws {
        if captures.contains(name) { return }
        try need(window.exists && window.frame.width > 0 && window.frame.height > 0, "Empty capture surface")
        try guardOwner(frontmost: !finder)
        let image = window.screenshot().pngRepresentation
        try need(image.count <= 2 * 1024 * 1024 && captureBytes + image.count <= 10 * 1024 * 1024, "Original PNG evidence bound")
        let hash = SHA256.hash(data: image).map { String(format: "%02x", $0) }.joined()
        let attachment = XCTAttachment(data: image, uniformTypeIdentifier: "public.png")
        attachment.name = "nac347-" + name; attachment.lifetime = .keepAlways; add(attachment)
        try attach("nac347-caption-" + name, ["schema": "nac347-capture-v1", "name": name,
            "configuration_sha256": configHash, "H": config["harness_sha"]!, "T": PathPhaseObserver.product,
            "native_sha256": config["native_sha256"]!, "engine_sha256": config["engine_sha256"]!,
            "helper_sha256": config["helper_sha256"]!, "png_sha256": hash, "app_pid": phase.app_pid,
            "window": phase.window, "run": phase.run, "launch": phase.launch, "view": phase.view,
            "document": phase.document, "sequence": phase.sequence, "phase": phase.name.rawValue,
            "surface": finder ? "Finder unique selected leaf; no stable OS close identity" :
                (["chooser-unicode", "failure-panel"].contains(name) ? "NAC owned attached NSOpenPanel" : "NAC owned window"),
            "actual_readable_nonoccluded_image_review": "required; not established by AX or PNG receipt"])
        captureBytes += image.count; captures.insert(name)
    }
    private func finderObservation(_ stage: String, folder: String, leaf: String) throws {
        let reader = try XCTUnwrap(observer)
        let finder = XCUIApplication(bundleIdentifier: "com.apple.finder")
        let windows = finder.windows.allElementsBoundByIndex
        try need(windows.count <= 64, "Finder observation bound")
        let rows: [[String: Any]] = windows.enumerated().map { index, window in
            let leaves = window.descendants(matching: .any).matching(NSPredicate(format: "label == %@", leaf)).allElementsBoundByIndex
            return ["index": index, "owned_title": window.label == folder, "leaf_count": leaves.count,
                    "selected_leaf_count": leaves.filter(\.isSelected).count,
                    "identifier": window.identifier, "x": Double(window.frame.minX), "y": Double(window.frame.minY),
                    "width": Double(window.frame.width), "height": Double(window.frame.height)]
        }
        try attach("nac347-finder-" + stage, ["schema": "nac347-finder-v1", "stage": stage,
            "configuration_sha256": configHash, "H": config["harness_sha"]!, "T": PathPhaseObserver.product,
            "phase": try XCTUnwrap(reader.history.last), "folder": folder, "leaf": leaf, "windows": rows,
            "close_authority": false])
    }

    private func journey(failure: Bool) throws {
        continueAfterFailure = false
        executionTimeAllowance = 480
        let configPath = URL(fileURLWithPath: try XCTUnwrap(ProcessInfo.processInfo.environment["NAC_UI_FIXTURE"]))
        configurationURL = configPath
        let info = try PathPhaseObserver.directory(configPath.deletingLastPathComponent())
        config = try PathPhaseObserver.record(configPath, parent: configPath.deletingLastPathComponent(), identity: (UInt64(info.st_dev), info.st_ino))
        configHash = try PathPhaseObserver.hash(configPath)
        try need(configHash == ProcessInfo.processInfo.environment["NAC_PATH_CONFIGURATION_SHA256"]
            && config["harness_sha"] as? String == ProcessInfo.processInfo.environment["NAC_PATH_HARNESS_SHA"],
                 "Actual generated runner H/configuration binding changed")
        let scenario = failure ? "paths-failure-xctest" : "paths-xctest"
        try need(config["scenario"] as? String == scenario && config["product_sha"] as? String == PathPhaseObserver.product
            && config["helper_sha256"] as? String == "c72c1178ba99ca82f23e264c46fb21b809934782f77060781454c42f78920e21",
                 "Frozen path source/case differs")
        let sourcePath = try XCTUnwrap(ProcessInfo.processInfo.environment["NAC_PATH_SOURCE_PATH"])
        try need(try PathPhaseObserver.hash(URL(fileURLWithPath: sourcePath)) == ProcessInfo.processInfo.environment["NAC_PATH_SOURCE_SHA256"],
                 "Actual wrapper source changed")
        appURL = URL(fileURLWithPath: try XCTUnwrap(config["app_path"] as? String))
        output = URL(fileURLWithPath: try XCTUnwrap(config["evidence"] as? String))
        try need(appURL.path == appURL.resolvingSymlinksInPath().path && appURL.lastPathComponent == "NAC Development Preview Smoke.app"
            && appURL.path.contains("/nac-mac-relocation-"), "Unqualified relocated app URL")
        try need(try PathPhaseObserver.hash(appURL.appendingPathComponent("Contents/MacOS/NACPreview")) == config["native_sha256"] as? String,
                 "App executable changed before launch")
        try need(NSRunningApplication.runningApplications(withBundleIdentifier: "ai.arcee.nac.development-preview").allSatisfy(\.isTerminated),
                 "Existing preview instance; refusing launch")
        try console()
        policy = try currentPolicy()
        try need(NSDictionary(dictionary: policy).isEqual(NSDictionary(dictionary: try XCTUnwrap(config["authorization_policy"] as? [String: Any]))),
                 "Policy changed since H admission")
        let app = XCUIApplication(url: appURL)
        app.launchArguments = ["--smoke-output", output.path, "--smoke-scenario", scenario]
        app.launchEnvironment = ["NAC_HOME": "/DO-NOT-USE-PERSONAL-NAC", "NAC_MANAGED_CONFIG": "/DO-NOT-INHERIT",
                                 "OPENAI_API_KEY": "must-not-reach-engine"]
        app.launch()
        defer {
            try? attach("nac347-controller", ["schema": "nac347-controller-v1", "configuration_sha256": configHash,
                "scenario": scenario, "inputs": inputs, "history": observer?.history ?? [],
                "captures": captures.sorted(), "capture_bytes": captureBytes,
                "cleanup": "requires external exact-owner settlement; missing proof retains roots",
                "Finder_residual": "left open; no Finder input or close authority"])
        }
        let parent = output.deletingLastPathComponent(), parentInfo = try PathPhaseObserver.directory(parent)
        var ready: [String: Any] = [:]
        let deadline = Date().addingTimeInterval(65)
        while Date() < deadline {
            if FileManager.default.fileExists(atPath: output.path) {
                let row = try PathPhaseObserver.record(output, parent: parent, identity: (UInt64(parentInfo.st_dev), parentInfo.st_ino))
                try need(row["error"] == nil && row["passed"] as? Bool != false, "App failed before path bridge readiness")
                if row["paths_xctest_ready"] as? Bool == true { ready = row; break }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        let candidates = NSRunningApplication.runningApplications(withBundleIdentifier: "ai.arcee.nac.development-preview")
            .filter { !$0.isTerminated && $0.bundleURL == appURL
                && $0.executableURL?.path == appURL.appendingPathComponent("Contents/MacOS/NACPreview").path }
        try need(candidates.count == 1, "Exact launched app process is missing or ambiguous")
        let running = candidates[0]
        let pid = running.processIdentifier
        owner = running; launch = try XCTUnwrap(running.launchDate)
        try need(running.bundleURL == appURL && app.windows.count == 1, "App target mismatch")
        let visible = windows(pid)
        try need(visible.count == 1, "Ambiguous visible app window")
        windowNumber = try XCTUnwrap(visible[0][kCGWindowNumber as String] as? Int)
        let phase = try XCTUnwrap(ready["paths_phase"] as? [String: Any])
        var scopeRecord = phase
        for key in ["version", "name", "sequence"] { scopeRecord.removeValue(forKey: key) }
        let scope = try JSONDecoder().decode(NativePathJourney.Scope.self, from: JSONSerialization.data(withJSONObject: scopeRecord))
        try need(scope.app_pid == Int(pid) && scope.window == windowNumber && scope.source == PathPhaseObserver.product
            && scope.engine_pid > 0 && scope.engine_pid <= Int(Int32.max)
            && scope.operation == (failure ? "pending-engine-failure" : "select-reload-create-reveal")
            && [scope.run, scope.launch, scope.view, scope.document].allSatisfy { UUID(uuidString: $0) != nil }, "Initial source scope mismatch")
        engine = try process(Int32(scope.engine_pid), path: appURL.appendingPathComponent("Contents/Resources/nac-web").path, parent: pid)
        observer = try PathPhaseObserver(path: output, scope: scope)
        let reader = try XCTUnwrap(observer)
        let folder = URL(fileURLWithPath: try XCTUnwrap(ready["selection_path"] as? String))
        let initial = try XCTUnwrap(ready["initial_parent"] as? String)
        let leaf = try XCTUnwrap(ready["reveal_leaf"] as? String)
        func observe() throws -> NativePathJourney.Phase {
            let value = try reader.observe()
            if value.name == .folderRestored && !captures.contains("moved-folder-error") {
                let error = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", folder.lastPathComponent, "does not exist")).firstMatch
                try need(error.exists, "Missing readable moved-folder error")
                try capture("moved-folder-error", window: app.windows.firstMatch, phase: value)
            }
            return value
        }
        func authorize() throws {
            try guardOwner()
            let value = try observe()
            let sheet = app.sheets.firstMatch
            if sheet.exists && sheet.descendants(matching: .staticText).matching(NSPredicate(format: "label == %@", folder.lastPathComponent)).firstMatch.exists {
                try capture(failure ? "failure-panel" : "chooser-unicode", window: sheet, phase: value)
            }
            if value.name == .documentReloaded && !sheet.exists && app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Choose Working Folder")).firstMatch.exists {
                try capture("reloaded-form", window: app.windows.firstMatch, phase: value)
            }
            if value.name == .folderRestored && app.webViews.buttons["Reveal in Finder"].exists {
                try capture("session-files", window: app.windows.firstMatch, phase: value)
                if !finderBaselineRetained {
                    try finderObservation("before", folder: folder.lastPathComponent, leaf: leaf)
                    finderBaselineRetained = true
                }
            }
            inputs += 1
            try need(inputs <= 160, "Finite path input count bound")
            try attach(String(format: "nac347-input-%03d", inputs), ["schema": "nac347-input-v1", "index": inputs,
                "configuration_sha256": configHash, "phase": value.name.rawValue, "sequence": value.sequence,
                "app_pid": scope.app_pid, "window": scope.window, "engine_start": engine,
                "console": "same-user unlocked", "authorization_policy_unchanged": true,
                "app_launch_epoch": launch!.timeIntervalSince1970, "run": scope.run, "document": value.document])
        }
        if failure {
            try NativePathJourney.pendingEngineFailure(app: app, initialPath: initial, folder: folder, scope: scope,
                                                       observePhase: observe, authorize: authorize)
        } else {
            try NativePathJourney.folderSelection(app: app, initialPath: initial, folder: folder, scope: scope,
                revealLeaf: leaf, observePhase: observe, authorize: authorize)
            let finder = XCUIApplication(bundleIdentifier: "com.apple.finder")
            let matches = finder.windows.allElementsBoundByIndex.filter { window in
                window.label == folder.lastPathComponent && window.descendants(matching: .any)
                    .matching(NSPredicate(format: "label == %@", leaf)).allElementsBoundByIndex.contains { $0.isSelected }
            }
            try need(matches.count == 1 && finderBaselineRetained, "Finder selected target/baseline ambiguous")
            try finderObservation("after", folder: folder.lastPathComponent, leaf: leaf)
            try capture("finder-selected", window: matches[0], phase: reader.observe(), finder: true)
        }
        let expected = failure ? Set(["failure-panel"]) : Set(["chooser-unicode", "reloaded-form", "moved-folder-error", "session-files", "finder-selected"])
        try need(captures == expected, "Missing original named path captures")
        try need(reader.history.count == (failure ? 2 : 5), "Incomplete phase history")
        try need(app.wait(for: .notRunning, timeout: 90), "App did not perform bounded ordinary shutdown")
        _ = try reader.observe() // Final atomic publication must retain the exact last phase.
        let final = try reader.read()
        try need(final["passed"] as? Bool == true && final["engine_reaped"] as? Bool == true
            && final["profile_removed"] as? Bool == true, "Product/cleanup failed")
        try console()
        try need(NSDictionary(dictionary: try currentPolicy()).isEqual(NSDictionary(dictionary: policy)), "End authorization policy changed")
    }
}
