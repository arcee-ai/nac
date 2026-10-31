import AppKit
import CoreGraphics
import CryptoKit
import CoreFoundation
import IOKit
import XCTest
import XCUIAutomation

// BEGIN CONSOLE POLICY (also compiled as a Foundation-only fixture proof)
enum StartupConsolePolicy {
    static func boolean(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }

    static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              "cCsSiIlLqQ".contains(String(cString: number.objCType)) else { return nil }
        return number.intValue
    }

    static func optionalUnlocked(_ value: Any?) -> Bool {
        if value == nil || value is NSNull { return true }
        return boolean(value) == false
    }

    static func evaluate(root: [String: Any], uid: Int, quartz: [String: Any]) throws -> [String: Any] {
        let users = root["IOConsoleUsers"] as? [[String: Any]] ?? []
        let matches = users.filter {
            integer($0["kCGSSessionUserIDKey"]) == uid && boolean($0["kCGSSessionOnConsoleKey"]) == true
        }
        guard matches.count == 1, boolean(matches[0]["kCGSessionLoginDoneKey"]) == true,
              boolean(root["IOConsoleLocked"]) == false,
              boolean(quartz["quartz_session_available"]) == true,
              boolean(quartz["on_console"]) == true, boolean(quartz["login_done"]) == true,
              let screens = integer(quartz["screen_count"]), screens >= 1,
              let frontmost = quartz["frontmost_bundle"] as? String,
              !["", "unavailable", "com.apple.loginwindow"].contains(frontmost),
              optionalUnlocked(matches[0]["CGSSessionScreenIsLocked"]),
              optionalUnlocked(quartz["screen_is_locked"]) else {
            throw NSError(domain: "NAC342Console", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Positive console observations missing, locked or malformed"])
        }
        // Preserve absent/null lock observations; never fabricate false.
        return ["on_console": true, "login_done": true, "root_locked": false,
                "session_lock_flag": matches[0]["CGSSessionScreenIsLocked"] ?? NSNull(),
                "quartz_lock_flag": quartz["screen_is_locked"] ?? NSNull(),
                "rendered_app_qualification_required": true]
    }
}
// END CONSOLE POLICY

/// Proposed external public-XCTest actor. ALL-354 must include this source in
/// an actual generated runner before it is runnable. No app bridge or file IPC.
final class StartupJourneys: XCTestCase {
    struct Fixture: Decodable {
        let schema, scenario, contract_baseline, source_sha, bundle_id: String
        let fixture_root, app_path, home, nac_home, workspace, expected_store: String
        let native_sha256, engine_sha256, info_plist_sha256, build_receipt_sha256: String
        let startup_source_sha256: String
        let test_source_sha, harness_sha: String
        let manifest_sha256, package_identity_sha256, engine_identity_sha256: String
        let engine_identity: Identity
        let environment: [String: String]
    }
    struct Identity: Decodable, Equatable {
        let product_version, source_revision, track, build_id: String
    }
    private var observations: [[String: Any]] = []
    // Root-nominated356 contract. The actor observes the unique UI message;
    // actual typed receipt/source inclusion is independently bound by354.
    private let futureRecovery = "The selected store uses a newer database schema. Quit NAC and reopen this store with a compatible newer NAC app. Keep your configuration and data; do not delete or downgrade the store. No alternative store was selected."

    private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        if !condition() { throw NSError(domain: "NAC342", code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]) }
    }

    private func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func canonical(_ path: String) -> URL {
        URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath()
    }

    private func json(_ data: Data) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func attachment(_ record: [String: Any], name: String) throws {
        let data = try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
        try require(data.count <= 64 * 1024, "Bounded startup attachment exceeded")
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func admit(_ fixture: Fixture, app: URL) throws {
        try require(fixture.schema == "nac342-startup-xctest-v1"
            && fixture.contract_baseline == "ec4f3a9a8ab2e80d98ff76ca8c536e1e41b413c8"
            && ["onboarding", "configuredLocal", "invalidConfig", "futureStore"].contains(fixture.scenario),
            "Unexpected four-state acceptance contract")
        let root = canonical(fixture.fixture_root)
        try require(root.path == fixture.fixture_root && root.lastPathComponent.hasPrefix("nac342-xctest-")
            && app.path == fixture.app_path && app.path.hasPrefix(root.path + "/")
            && app.path.hasSuffix("/Moved app folder with spaces/NAC.app"), "Unexpected ordinary app URL")
        // Validate profile path declarations only. No permission to inspect or
        // modify these files is inferred from access to NAC_UI_FIXTURE.
        try require(fixture.home.hasPrefix(root.path + "/")
            && fixture.nac_home.hasPrefix(fixture.home + "/")
            && fixture.expected_store.hasPrefix(fixture.nac_home + "/")
            && fixture.workspace.hasPrefix(root.path + "/"), "Disposable profile declaration escaped")
        for (member, expected) in [
            ("Contents/MacOS/NACPreview", fixture.native_sha256),
            ("Contents/Resources/nac-web", fixture.engine_sha256),
            ("Contents/Info.plist", fixture.info_plist_sha256),
            ("Contents/Resources/build-receipt.json", fixture.build_receipt_sha256),
            ("Contents/Resources/PackageIdentity.json", fixture.package_identity_sha256),
            ("Contents/Resources/engine-identity.json", fixture.engine_identity_sha256)
        ] {
            let bytes = try Data(contentsOf: app.appendingPathComponent(member))
            try require(digest(bytes) == expected,
                        "Exact ordinary bundle bytes differ")
        }
        let receipt = try json(Data(contentsOf: app.appendingPathComponent("Contents/Resources/build-receipt.json")))
        let marker = try json(Data(contentsOf: app.appendingPathComponent("Contents/Resources/PackageIdentity.json")))
        let embedded = try JSONDecoder().decode(Identity.self,
            from: Data(contentsOf: app.appendingPathComponent("Contents/Resources/engine-identity.json")))
        let markerSource = try XCTUnwrap(marker["source"] as? [String: Any])
        let sealedReceipt = try XCTUnwrap(marker["native_build_receipt"] as? [String: Any])
        try require(NSDictionary(dictionary: receipt).isEqual(NSDictionary(dictionary: sealedReceipt))
            && receipt["phase"] as? String == "unsigned-build"
            && marker["schema_version"] as? Int == 1 && marker["purpose"] as? String == "normal-app-preparation"
            && marker["consumer_distribution"] as? Bool == false && markerSource["revision"] as? String == fixture.source_sha,
            "Sealed PackageIdentity or original unsigned receipt differs")
        for value in [fixture.test_source_sha, fixture.harness_sha] {
            try require(value.range(of: "^[0-9a-f]{40}$", options: .regularExpression) != nil, "Invalid Q/H source binding")
        }
        try require(fixture.manifest_sha256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
                    "Missing external owner-admitted manifest hash")
        for value in [receipt["engine_identity"], marker["engine_identity"]] {
            let data = try JSONSerialization.data(withJSONObject: try XCTUnwrap(value))
            let decoded = try JSONDecoder().decode(Identity.self, from: data)
            try require(decoded == embedded, "Full four-field embedded engine identities differ")
        }
        try require(embedded == fixture.engine_identity && embedded.source_revision == fixture.source_sha
            && embedded.track == "dev" && embedded.build_id == "dev-" + fixture.source_sha,
            "Configured product identity differs")
        let identity = try XCTUnwrap(receipt["engine_identity"] as? [String: Any])
        let flags = try XCTUnwrap(receipt["compiler_flags"] as? [String])
        let definitions = flags.indices.filter { flags[$0] == "-D" }.compactMap {
            $0 + 1 < flags.count ? flags[$0 + 1] : nil
        }
        try require(receipt["source_head"] as? String == fixture.source_sha
            && receipt["source_dirty"] as? Bool == false
            && identity["source_revision"] as? String == fixture.source_sha
            && receipt["mode"] as? String == "app-build"
            && receipt["normal_startup"] as? Bool == true
            && receipt["preview_definitions_excluded"] as? Bool == true
            && receipt["smoke_instrumentation"] as? Bool == false
            && (receipt["instance_smoke_instrumentation"] == nil
                || receipt["instance_smoke_instrumentation"] as? Bool == false)
            && definitions == ["LOCAL_APP"] && flags.last != "-D", "Ordinary source/build mode differs")
        let plist = try XCTUnwrap(PropertyListSerialization.propertyList(
            from: Data(contentsOf: app.appendingPathComponent("Contents/Info.plist")), format: nil) as? [String: Any])
        try require(["ai.arcee.nac.local-development", "ai.arcee.nac.dev"].contains(fixture.bundle_id)
            && plist["CFBundleIdentifier"] as? String == fixture.bundle_id, "Ordinary bundle ID differs")
        // launchEnvironment augments the public launcher's environment. The
        // external354 launcher must sanitize inheritance before this test.
        let inherited = ProcessInfo.processInfo.environment
        let forbidden = inherited.keys.filter {
            $0 == "NAC_MANAGED_CONFIG" || $0.hasSuffix("_API_KEY") || $0.hasSuffix("_TOKEN")
        }
        try require(forbidden.isEmpty, "Runner inherited credentials or managed launch configuration")
        try require(fixture.environment["HOME"] == fixture.home
            && fixture.environment["NAC_HOME"] == fixture.nac_home
            && fixture.environment["NAC_ORCHESTRATION"] == "0"
            && fixture.environment["NAC_MANAGED_CONFIG"] == nil,
            "Fixture launch isolation differs")
        let names: Set<String> = ["HOME", "NAC_HOME", "PATH", "LANG", "NAC_TELEMETRY",
            "NAC_ORCHESTRATION", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL", "BROWSER", "MODELS_DEV_URL"]
        try require(Set(fixture.environment.keys) == names
            && fixture.environment["PATH"] == "/usr/bin:/bin:/usr/sbin:/sbin"
            && fixture.environment["LANG"] == "en_US.UTF-8"
            && fixture.environment["NAC_TELEMETRY"] == "disabled"
            && fixture.environment["GIT_CONFIG_NOSYSTEM"] == "1"
            && fixture.environment["GIT_CONFIG_GLOBAL"] == "/dev/null"
            && fixture.environment["BROWSER"] == "none", "Fixture environment allowlist differs")
        let catalog = try XCTUnwrap(URLComponents(string: fixture.environment["MODELS_DEV_URL"] ?? ""))
        try require(catalog.scheme == "http" && catalog.host == "127.0.0.1"
            && (catalog.port ?? 0) > 0 && catalog.user == nil && catalog.password == nil
            && catalog.query == nil && catalog.fragment == nil && catalog.path == "/models-dev",
            "Catalog is not the owned loopback fixture")
    }

    @MainActor
    private func console() throws -> [String: Any] {
        let session = CGSessionCopyCurrentDictionary() as? [String: Any]
        let root = IORegistryGetRootEntry(kIOMainPortDefault)
        try require(root != 0, "Console registry observation missing")
        defer { IOObjectRelease(root) }
        func property(_ name: String) -> Any? {
            IORegistryEntryCreateCFProperty(root, name as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue()
        }
        return try StartupConsolePolicy.evaluate(root: [
            "IOConsoleLocked": property("IOConsoleLocked") ?? NSNull(),
            "IOConsoleUsers": property("IOConsoleUsers") ?? []], uid: Int(getuid()), quartz: [
            "quartz_session_available": session != nil,
            "on_console": session?[kCGSessionOnConsoleKey as String] ?? NSNull(),
            "login_done": session?[kCGSessionLoginDoneKey as String] ?? NSNull(),
            "screen_is_locked": session?["CGSSessionScreenIsLocked"] ?? NSNull(),
            "screen_count": NSScreen.screens.count,
            "frontmost_bundle": NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "unavailable"])
    }

    @MainActor
    private func incarnation(_ running: NSRunningApplication, app: URL, launch: Date) throws {
        try require(!running.isTerminated && running.launchDate == launch
            && running.bundleURL?.resolvingSymlinksInPath() == app
            && running.executableURL?.resolvingSymlinksInPath() == app.appendingPathComponent("Contents/MacOS/NACPreview"),
            "Ordinary app process incarnation changed")
    }

    @MainActor
    private func guardWindow(_ ui: XCUIApplication, running: NSRunningApplication,
                             app: URL, launch: Date, number: Int) throws {
        try incarnation(running, app: app, launch: launch)
        try require(NSWorkspace.shared.frontmostApplication?.processIdentifier == running.processIdentifier
            && ui.windows.count == 1, "Ordinary app lost unique foreground window")
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] ?? []
        try require(windows.filter {
            ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == running.processIdentifier
                && ($0[kCGWindowNumber as String] as? NSNumber)?.intValue == number
                && ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0
        }.count == 1, "Exact owned window is not on screen")
        observations.append(try console())
    }

    @MainActor
    func testOrdinaryStartup() throws {
        continueAfterFailure = false
        executionTimeAllowance = 210
        let path = try XCTUnwrap(ProcessInfo.processInfo.environment["NAC_UI_FIXTURE"])
        let bytes = try Data(contentsOf: URL(fileURLWithPath: path))
        try require(bytes.count <= 32 * 1024, "Fixture configuration exceeds bound")
        let fixture = try JSONDecoder().decode(Fixture.self, from: bytes)
        let appURL = canonical(fixture.app_path)
        try admit(fixture, app: appURL)
        try require(NSRunningApplication.runningApplications(withBundleIdentifier: fixture.bundle_id)
            .allSatisfy { $0.isTerminated }, "Existing bundle-ID owner blocks qualification")
        observations.append(try console())
        let ui = XCUIApplication(url: appURL)
        ui.launchArguments = ["--directory", fixture.home]
        ui.launchEnvironment = fixture.environment
        ui.launch()
        let running = try XCTUnwrap(NSRunningApplication.runningApplications(withBundleIdentifier: fixture.bundle_id)
            .filter { $0.bundleURL?.resolvingSymlinksInPath() == appURL && !$0.isTerminated }.only)
        let launch = try XCTUnwrap(running.launchDate)
        var targetWindow: Int?
        var captured = false
        // Cleanup is exact public application termination. Engine/process-tree
        // settlement and profile deletion remain external owner observations.
        defer {
            do {
                if !running.isTerminated {
                    if !captured, let number = targetWindow {
                        // Failure images still require the same exact window
                        // and console guards. No unguarded desktop capture.
                        if (try? guardWindow(ui, running: running, app: appURL, launch: launch, number: number)) != nil {
                            let image = XCTAttachment(screenshot: ui.windows.firstMatch.screenshot())
                            image.name = "nac342-failure-" + fixture.scenario
                            image.lifetime = .keepAlways
                            add(image)
                        }
                    }
                    try incarnation(running, app: appURL, launch: launch)
                    ui.terminate()
                }
                let stopped = ui.wait(for: .notRunning, timeout: 30)
                try attachment(["schema": "nac342-cleanup-v1", "scenario": fixture.scenario,
                    "configuration_sha256": digest(bytes), "app_pid": Int(running.processIdentifier),
                    "app_path": appURL.path, "app_termination_observed": stopped,
                    "engine_cleanup": "requires_external_exact_owner_audit",
                    "profile_cleanup": "requires_external_exact_owner_audit"],
                    name: "nac342-cleanup-v1-" + fixture.scenario)
                XCTAssertTrue(stopped, "Owned app termination unresolved; retain fixture")
            } catch { XCTFail("Owned app identity/cleanup attachment unavailable; retain fixture for external cleanup") }
        }
        try require(ui.windows.firstMatch.waitForExistence(timeout: 45), "No startup window")
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] ?? []
        let owned = windows.filter {
            ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == running.processIdentifier
                && ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0
        }
        try require(owned.count == 1, "Initial ordinary window is ambiguous")
        let number = try XCTUnwrap((owned[0][kCGWindowNumber as String] as? NSNumber)?.intValue)
        targetWindow = number
        var operations: [String] = []
        func guardTarget() throws {
            try guardWindow(ui, running: running, app: appURL, launch: launch, number: number)
        }
        func dispatch(_ name: String, action: () -> Void) throws {
            try guardTarget()
            let index = operations.count + 1
            func retain(_ stage: String) throws {
                try attachment(["schema": "nac342-dispatch-v1", "scenario": fixture.scenario,
                    "configuration_sha256": digest(bytes), "operation_index": index,
                    "operation": name, "stage": stage, "app_pid": Int(running.processIdentifier),
                    "app_launch_epoch": launch.timeIntervalSince1970, "window_number": number,
                    "app_path": appURL.path, "native_sha256": fixture.native_sha256],
                    name: String(format: "nac342-dispatch-v1-%02d-%@", index, stage))
            }
            try retain("before")
            action()
            operations.append(name)
            try guardTarget()
            try retain("after")
        }
        func text(_ value: String, native: Bool = false) -> XCUIElement {
            (native ? ui.staticTexts : ui.webViews.staticTexts)
                .matching(NSPredicate(format: "label CONTAINS %@", value)).firstMatch
        }
        func click(_ query: XCUIElementQuery, _ label: String) throws {
            let elements = query.matching(identifier: label)
            try require(elements.firstMatch.waitForExistence(timeout: 20) && elements.count == 1
                && elements.firstMatch.isHittable && elements.firstMatch.isEnabled, "Public control absent/ambiguous: " + label)
            try dispatch("click:" + label) { elements.firstMatch.click() }
        }
        try guardTarget()
        if ["invalidConfig", "futureStore"].contains(fixture.scenario) {
            if fixture.scenario == "futureStore" {
                // Match the complete nominated sentence sequence verbatim,
                // even when a native label wraps it in shell presentation.
                // The old generic compatible-version footer must fail here.
                let recovery = ui.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", futureRecovery))
                try require(recovery.firstMatch.waitForExistence(timeout: 35)
                    && recovery.count == 1 && recovery.firstMatch.isHittable,
                    "Unique typed future-schema recovery guidance missing")
            } else {
                for phrase in ["config.toml", "repair", "relaunch"] {
                    try require(text(phrase, native: true).waitForExistence(timeout: 35), "Actionable recovery missing: " + phrase)
                }
            }
            try require(ui.webViews.allElementsBoundByIndex.allSatisfy { !$0.isHittable },
                        "Recovery unexpectedly activated shared workspace")
        } else {
            try require(text("No projects yet").waitForExistence(timeout: 45), "Shared onboarding absent")
            if fixture.scenario == "configuredLocal" {
                try click(ui.webViews.buttons, "Get Started")
                try click(ui.webViews.buttons, fixture.home)
                let fields = ui.webViews.textFields.matching(NSPredicate(format: "placeholderValue == %@", "/path/to/directory"))
                try require(fields.firstMatch.waitForExistence(timeout: 15) && fields.count == 1
                    && fields.firstMatch.isHittable, "Shared folder input absent/ambiguous")
                try dispatch("click:folder-input") { fields.firstMatch.click() }
                try dispatch("key:command-a-folder-input") { fields.firstMatch.typeKey("a", modifierFlags: .command) }
                try dispatch("type:owned-workspace") { fields.firstMatch.typeText(fixture.workspace) }
                try dispatch("key:return-folder-input") { fields.firstMatch.typeKey(.return, modifierFlags: []) }
                try require(text("Selected: " + fixture.workspace).waitForExistence(timeout: 20), "Folder selection unconfirmed")
                try click(ui.webViews.buttons, "Select")
                try click(ui.webViews.buttons, "Create Project")
                let message = ui.webViews.descendants(matching: .any).matching(identifier: "Message")
                try require(message.firstMatch.waitForExistence(timeout: 30) && message.count == 1
                    && message.firstMatch.isHittable, "Shared Message accessibility target absent/ambiguous")
                try dispatch("click:Message") { message.firstMatch.click() }
                try dispatch("type:FINDER_CONFIGURED_LOCAL_startup-home") {
                    message.firstMatch.typeText("FINDER_CONFIGURED_LOCAL_startup-home")
                }
                try click(ui.webViews.buttons, "Send")
                try require(text("Finder configured local response.").waitForExistence(timeout: 55), "Dummy configured response absent")
                // Shared backend/settlement/store assertions are verified by
                // the external354 fixture owner, not guessed from UI text.
            }
        }
        try guardTarget()
        let screenshot = ui.windows.firstMatch.screenshot()
        let image = screenshot.pngRepresentation
        try require(!image.isEmpty, "Public window screenshot is empty")
        let imageAttachment = XCTAttachment(screenshot: screenshot)
        imageAttachment.name = "nac342-ordinary-" + fixture.scenario
        imageAttachment.lifetime = .keepAlways
        add(imageAttachment)
        captured = true
        try guardTarget()
        let expectedPrivateFailure: [String: Any] = fixture.scenario == "futureStore"
            ? ["kind": "failed", "version": 1, "code": "store_schema_incompatible", "stage": "startup"] : [:]
        try attachment(["schema": fixture.schema, "scenario": fixture.scenario,
            "configuration_sha256": digest(bytes), "source_sha": fixture.source_sha,
            "test_source_sha": fixture.test_source_sha, "harness_sha": fixture.harness_sha,
            "manifest_sha256": fixture.manifest_sha256, "package_identity_sha256": fixture.package_identity_sha256,
            "engine_identity_sha256": fixture.engine_identity_sha256, "build_receipt_sha256": fixture.build_receipt_sha256,
            "startup_source_sha256": fixture.startup_source_sha256,
            "native_sha256": fixture.native_sha256, "engine_sha256": fixture.engine_sha256,
            "app_path": appURL.path, "bundle_id": fixture.bundle_id,
            "app_pid": Int(running.processIdentifier), "app_launch_epoch": launch.timeIntervalSince1970,
            "window_number": number, "ordinary_compile_mode": "LOCAL_APP",
            "smoke_instrumentation": false, "operations": operations, "console": observations,
            "capture": "public-XCTest-window-screenshot", "png_sha256": digest(image),
            "visible_paint": "requires_actual_image_review", "input_method": "public-XCTest",
            "physical_keyboard_or_ime_claim": false, "external_cleanup_required": true,
            "future_schema_G2_assertion": fixture.scenario == "futureStore"
                ? "exact_unique_message_observed_producer_binding_required" : "not_applicable",
            "expected_private_failure": expectedPrivateFailure,
            "private_failure_observation": "not_read_by_public_UI_actor",
            "four_case_acceptance": "requires_producer_source_binding_SDK_run_and_external_integrity_audits"],
            name: "nac342-ordinary-v1-" + fixture.scenario)
    }
}

private extension Array {
    var only: Element? { count == 1 ? first : nil }
}
