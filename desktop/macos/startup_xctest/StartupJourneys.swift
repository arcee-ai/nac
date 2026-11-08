import AppKit
import ApplicationServices
import CoreGraphics
import CryptoKit
import CoreFoundation
import Darwin
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

// BEGIN PATH POLICY (compiled verbatim against owned empty filesystem fixtures)
struct StartupPaths {
    struct Resource: Equatable {
        let path: String
        let device: dev_t
        let inode: ino_t
        let kind: mode_t
    }
    let root, app, native: Resource
    var url: URL { URL(fileURLWithPath: app.path) }
    var emittedPath: String { app.path }

    static func lexical(_ path: String) -> Bool {
        path.hasPrefix("/") && path.utf8.count <= 4096
            && !path.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
            && path.split(separator: "/", omittingEmptySubsequences: false).dropFirst()
                .allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }

    static func child(_ path: String, of parent: String) -> Bool {
        lexical(path) && lexical(parent) && path.hasPrefix(parent + "/")
    }

    static func physical(_ path: String) -> String? {
        guard lexical(path), let pointer = realpath(path, nil) else { return nil }
        defer { free(pointer) }
        return String(cString: pointer)
    }

    static func need(_ condition: Bool, _ reason: String) throws {
        if !condition { throw NSError(domain: "NAC342Path", code: 1,
            userInfo: [NSLocalizedDescriptionKey: reason]) }
    }

    static func declared(_ path: String, kind: mode_t) throws -> Resource {
        try need(lexical(path) && physical(path) == path, "Declaration is not an existing physical canonical path")
        var info = stat()
        try need(lstat(path, &info) == 0 && info.st_mode & mode_t(S_IFMT) == kind,
                 "Declared resource has the wrong type or is unavailable")
        return Resource(path: path, device: info.st_dev, inode: info.st_ino, kind: kind)
    }

    init(root: String, app: String) throws {
        try Self.need(Self.lexical(root) && root.split(separator: "/").last?.hasPrefix("nac342-xctest-") == true
            && app == root + "/Moved app folder with spaces/NAC.app", "Unexpected owned ordinary app layout")
        self.root = try Self.declared(root, kind: mode_t(S_IFDIR))
        self.app = try Self.declared(app, kind: mode_t(S_IFDIR))
        native = try Self.declared(app + "/Contents/MacOS/NACPreview", kind: mode_t(S_IFREG))
    }

    static func observes(_ url: URL?, resource: Resource) -> Bool {
        guard let url, url.isFileURL, let path = physical(url.path), path == resource.path,
              let current = try? declared(path, kind: resource.kind) else { return false }
        return current == resource
    }

    func matches(bundle: URL?, executable: URL?) -> Bool {
        Self.observes(URL(fileURLWithPath: root.path), resource: root)
            && Self.observes(bundle, resource: app) && Self.observes(executable, resource: native)
    }

    // Declarations only: no filesystem operation on profile/store paths.
    func profiles(home: String, nac: String, workspace: String, store: String) -> Bool {
        Self.child(home, of: root.path) && Self.child(nac, of: home)
            && Self.child(workspace, of: root.path) && Self.child(store, of: nac)
    }
}
// END PATH POLICY



// BEGIN ONBOARDING TITLE (compiled verbatim; no AX access in this decision)
private enum StartupOnboardingTitle {
    static let text = "No projects yet"

    struct Candidate {
        let elementType: Int
        let exists, enabled, hittable: Bool
        let value: Any?
        let frame: CGRect
    }

    static func visible<Element>(wait: () -> Bool, elements: () -> [Element],
                                 staticTextType: Int, project: (Element) -> Candidate,
                                 window: () -> CGRect, verify: () -> Bool) -> Bool {
        guard wait() else { return false }
        let matches = elements()
        // Reject ambiguity before reading any candidate attributes.
        guard matches.count == 1 else { return false }
        let title = project(matches[0])
        guard title.elementType == staticTextType, title.exists, title.enabled, title.hittable,
              let value = title.value as? String, value == text else { return false }
        let frame = title.frame, bounds = window()
        let finite = [frame.minX, frame.minY, frame.width, frame.height,
                      bounds.minX, bounds.minY, bounds.width, bounds.height].allSatisfy { $0.isFinite }
        // CGRect.infinite uses finite sentinel components on CoreGraphics.
        return finite && !frame.isInfinite && !bounds.isInfinite
            && !frame.isEmpty && !bounds.isEmpty && frame.intersects(bounds) && verify()
    }
}
// END ONBOARDING TITLE

// BEGIN QUERY DIAGNOSTIC (compiled verbatim; no AX access in this projection)
private enum StartupQueryDiagnostic {
    static let queries = ["app_webviews", "window_webviews", "legacy_title", "app_static_title",
        "window_static_title", "window_label_title", "window_value_title", "window_identifier_title",
        "window_button_start", "legacy_button_start", "window_label_subtitle", "window_value_subtitle"]
    static let targets = ["No projects yet", "Create your first and start building!", "Get Started"]
    static let targetIndices = [0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 1, 1]

    static func requireOnboarding(wait: () -> Bool, diagnose: () -> Void) throws {
        let exists = wait()
        if !exists { diagnose() }
        if !exists { throw NSError(domain: "NAC342", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Shared onboarding absent"]) }
    }

    struct Candidate {
        let fields: [String: Any]
        let bounded: Bool
    }

    static func candidate(_ input: [String: Any], target: Int) -> Candidate? {
        let names: Set<String> = ["element_type", "exists", "hittable", "enabled", "window_intersection",
                                  "label", "value", "identifier"]
        guard Set(input.keys) == names, targets.indices.contains(target),
              let type = StartupConsolePolicy.integer(input["element_type"]), (0...1000).contains(type),
              let label = input["label"] as? String, let identifier = input["identifier"] as? String else { return nil }
        var fields: [String: Any] = ["element_type": type]
        for key in ["exists", "hittable", "enabled", "window_intersection"] {
            guard let value = StartupConsolePolicy.boolean(input[key]) else { return nil }
            fields[key] = value
        }
        let value = input["value"] as? String
        fields["value_is_string"] = value != nil
        var bounded = true
        for (key, text) in [("label", Optional(label)), ("value", value), ("identifier", Optional(identifier))] {
            let within = text.map { $0.utf8.count <= 256 } ?? true
            bounded = bounded && within
            fields[key + "_exact"] = within && text == targets[target]
            fields[key + "_contains"] = within && (text?.contains(targets[target]) ?? false)
            fields[key + "_trim_exact"] = within && text?.trimmingCharacters(in: .whitespacesAndNewlines) == targets[target]
        }
        return Candidate(fields: fields, bounded: bounded)
    }

    struct Census {
        let start: Double
        private(set) var rows: [[String: Any]] = []
        private(set) var reads = 0
        private var elapsed = 0
        private var elapsedOverflow = false
        private var reason = "none"
        private var last: Double
        private var projected = 0

        init(start: Double) { self.start = start; last = start }

        mutating func stop(_ next: String) {
            let priority = ["none", "candidate_limit", "count_limit", "time_budget", "clock_invalid"]
            if priority.firstIndex(of: next)! > priority.firstIndex(of: reason)! { reason = next }
        }

        mutating func available(now: Double) -> Bool {
            if reason == "clock_invalid" { return false }
            let delta = now - start
            guard start.isFinite, start >= 0, now.isFinite, now >= last, delta.isFinite else {
                elapsed = 0; elapsedOverflow = false; stop("clock_invalid"); return false
            }
            last = now
            elapsedOverflow = delta > 600
            elapsed = elapsedOverflow ? 600000 : Int(delta * 1000)
            if delta >= 5 { stop("time_budget"); return false }
            return reason != "count_limit" && reason != "clock_invalid"
        }

        mutating func readCandidate() -> Bool {
            guard reads < 8 else { stop("candidate_limit"); return false }
            reads += 1 // Count attempts, including rejected/overlength projections.
            return true
        }

        mutating func append(count raw: Any, candidates: [Candidate], truncated: Bool) -> Bool {
            guard rows.count < 12, let count = StartupConsolePolicy.integer(raw), count >= 0,
                  candidates.count <= 4, projected + candidates.count <= reads,
                  candidates.count <= count,
                  rows.count >= 4 || (candidates.isEmpty && !truncated) else { return false }
            let overflow = count > 4096
            guard !overflow || candidates.isEmpty else { return false }
            let cut = truncated || candidates.contains { !$0.bounded }
            guard rows.count < 4 || overflow || cut || candidates.count == count else { return false }
            if cut { stop("candidate_limit") }
            if overflow { stop("count_limit") }
            rows.append(["query": queries[rows.count], "count": min(count, 4096), "overflow": overflow,
                         "candidate_truncated": cut, "candidates": candidates.map(\.fields)])
            projected += candidates.count
            return true
        }

        func record(binding: [String: Any], scenario: String,
                    guardBefore: Bool, guardAfter: Bool) -> [String: Any]? {
            let hex40 = ["source_sha", "test_source_sha", "harness_sha"]
            let hex64 = ["startup_source_sha256", "configuration_sha256", "native_sha256"]
            let names = Set(hex40 + hex64 + ["app_path", "app_pid", "app_launch_epoch", "window_number"])
            guard guardBefore, guardAfter, Set(binding.keys) == names,
                  ["onboarding", "configuredLocal"].contains(scenario),
                  rows.count == 12 || reason != "none",
                  let path = binding["app_path"] as? String, StartupPaths.lexical(path),
                  path.hasSuffix("/Moved app folder with spaces/NAC.app"),
                  let pid = StartupConsolePolicy.integer(binding["app_pid"]), pid > 0,
                  let window = StartupConsolePolicy.integer(binding["window_number"]), window > 0,
                  let epoch = binding["app_launch_epoch"] as? NSNumber,
                  CFGetTypeID(epoch) != CFBooleanGetTypeID(), epoch.doubleValue.isFinite, epoch.doubleValue > 0 else { return nil }
            for (keys, width) in [(hex40, 40), (hex64, 64)] {
                for key in keys {
                    guard let text = binding[key] as? String,
                          text.range(of: "^[0-9a-f]{\(width)}$", options: .regularExpression) != nil else { return nil }
                }
            }
            return binding.merging(["schema": "nac342-query-diagnostic-v1", "version": 1,
                "phase": "onboarding", "scenario": scenario, "legacy_exists": false,
                "guard_before": guardBefore, "guard_after": guardAfter, "status": reason == "none" ? "complete" : "partial",
                "stop_reason": reason, "elapsed_ms": elapsed, "elapsed_overflow": elapsedOverflow,
                "queries": rows]) { _, new in new }
        }
    }
    static func read<T>(_ census: inout Census, now: Double, body: () -> T) -> T? {
        guard census.available(now: now) else { return nil }
        return body()
    }

    static func encode(_ record: [String: Any]) -> Data? {
        guard let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]),
              data.count <= 8192 else { return nil }
        return data
    }
}
// END QUERY DIAGNOSTIC

/// Proposed external public-XCTest actor. ALL-354 must include this source in
/// an actual generated runner. H owns the read-only AX receipt; no product bridge.
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
        let ax_witness: StartupAXDeclaration?
    }
    struct Identity: Decodable, Equatable {
        let product_version, source_revision, track, build_id: String
    }
    private var observations: [[String: Any]] = []
    // Root-nominated356 contract. The actor observes the unique UI message;
    // actual typed receipt/source inclusion is independently bound by354.
    private let futureRecovery = "The selected store uses a newer database schema. Quit NAC and reopen this store with a compatible version of NAC. Keep your configuration and data; do not delete or downgrade the store. No alternative store was selected."

    private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        if !condition() { throw NSError(domain: "NAC342", code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]) }
    }

    private func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
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

    private func admit(_ fixture: Fixture, paths: StartupPaths) throws {
        let app = paths.url
        try require(fixture.schema == "nac342-startup-xctest-v1"
            && fixture.contract_baseline == "ec4f3a9a8ab2e80d98ff76ca8c536e1e41b413c8"
            && ["onboarding", "configuredLocal", "invalidConfig", "futureStore"].contains(fixture.scenario),
            "Unexpected four-state acceptance contract")
        // Validate declarations only; access to NAC_UI_FIXTURE grants no
        // permission to inspect or modify the normal profile/store.
        try require(paths.profiles(home: fixture.home, nac: fixture.nac_home,
            workspace: fixture.workspace, store: fixture.expected_store), "Disposable profile declaration escaped")
        for (member, expected) in [
            ("Contents/MacOS/NACPreview", fixture.native_sha256),
            ("Contents/Resources/nac-web", fixture.engine_sha256),
            ("Contents/Info.plist", fixture.info_plist_sha256),
            ("Contents/Resources/build-receipt.json", fixture.build_receipt_sha256),
            ("Contents/Resources/PackageIdentity.json", fixture.package_identity_sha256),
            ("Contents/Resources/engine-identity.json", fixture.engine_identity_sha256)
        ] {
            let memberPath = paths.emittedPath + "/" + member
            _ = try StartupPaths.declared(memberPath, kind: mode_t(S_IFREG))
            let bytes = try Data(contentsOf: URL(fileURLWithPath: memberPath))
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
    private func incarnation(_ running: NSRunningApplication, paths: StartupPaths, launch: Date) throws {
        try require(!running.isTerminated && running.launchDate == launch
            && paths.matches(bundle: running.bundleURL, executable: running.executableURL),
            "Ordinary app process incarnation changed")
    }

    @MainActor
    private func guardWindow(_ ui: XCUIApplication, running: NSRunningApplication,
                             paths: StartupPaths, launch: Date, number: Int) throws {
        try incarnation(running, paths: paths, launch: launch)
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
    private func queryDiagnostic(_ ui: XCUIApplication, guardTarget: () throws -> Void,
                                 binding: [String: Any], scenario: String) throws {
        try guardTarget()
        let window = ui.windows.firstMatch
        let title = StartupQueryDiagnostic.targets[0], subtitle = StartupQueryDiagnostic.targets[1]
        let start = StartupQueryDiagnostic.targets[2]
        func match(_ query: XCUIElementQuery, _ attribute: String, _ text: String) -> XCUIElementQuery {
            query.matching(NSPredicate(format: attribute + " == %@", text))
        }
        let any = window.descendants(matching: .any)
        let queries = [ui.webViews, window.webViews,
            ui.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", title)),
            match(ui.staticTexts, "label", title), match(window.staticTexts, "label", title),
            match(any, "label", title), match(any, "value", title), match(any, "identifier", title),
            match(window.buttons, "label", start), match(ui.webViews.buttons, "label", start),
            match(any, "label", subtitle), match(any, "value", subtitle)]
        var census = StartupQueryDiagnostic.Census(start: ProcessInfo.processInfo.systemUptime)
        for (index, query) in queries.enumerated() {
            guard census.available(now: ProcessInfo.processInfo.systemUptime) else { break }
            // One explicit query materialization. SDK-internal work/latency is
            // not bounded by our result/attribute caps or between-call budget.
            let elements = query.allElementsBoundByAccessibilityElement
            var candidates: [StartupQueryDiagnostic.Candidate] = []
            var truncated = false
            if index >= 4 && elements.count <= 4096 {
                for element in elements.prefix(4) {
                    guard census.available(now: ProcessInfo.processInfo.systemUptime),
                          census.readCandidate() else { truncated = true; break }
                    // Each public attribute getter is independently admitted;
                    // a slow prior getter cannot authorize the next one.
                    func read<T>(_ body: () -> T) -> T? {
                        StartupQueryDiagnostic.read(&census, now: ProcessInfo.processInfo.systemUptime, body: body)
                    }
                    guard let frame = read({ element.frame }), let owned = read({ window.frame }),
                          let type = read({ Int(element.elementType.rawValue) }),
                          let exists = read({ element.exists }), let hittable = read({ element.isHittable }),
                          let enabled = read({ element.isEnabled }), let label = read({ element.label }),
                          let value = read({ element.value ?? NSNull() }),
                          let identifier = read({ element.identifier }) else { truncated = true; break }
                    let finite = [frame.minX, frame.minY, frame.width, frame.height,
                                  owned.minX, owned.minY, owned.width, owned.height].allSatisfy { $0.isFinite }
                    let input: [String: Any] = ["element_type": type, "exists": exists,
                        "hittable": hittable, "enabled": enabled,
                        "window_intersection": finite && !frame.isEmpty && frame.intersects(owned),
                        "label": label, "value": value, "identifier": identifier]
                    guard let candidate = StartupQueryDiagnostic.candidate(input,
                        target: StartupQueryDiagnostic.targetIndices[index]) else { truncated = true; break }
                    candidates.append(candidate)
                }
                truncated = truncated || elements.count > candidates.count
            }
            guard census.append(count: elements.count, candidates: candidates, truncated: truncated) else { return }
        }
        _ = census.available(now: ProcessInfo.processInfo.systemUptime)
        try guardTarget()
        guard let record = census.record(binding: binding, scenario: scenario, guardBefore: true, guardAfter: true),
              StartupQueryDiagnostic.encode(record) != nil else { return }
        try attachment(record, name: "nac342-query-diagnostic-v1-onboarding")
    }

    @MainActor
    func testOrdinaryStartup() throws {
        continueAfterFailure = false
        executionTimeAllowance = 210
        let path = try XCTUnwrap(ProcessInfo.processInfo.environment["NAC_UI_FIXTURE"])
        let bytes = try Data(contentsOf: URL(fileURLWithPath: path))
        try require(bytes.count <= 32 * 1024, "Fixture configuration exceeds bound")
        let fixture = try JSONDecoder().decode(Fixture.self, from: bytes)
        let paths: StartupPaths
        do { paths = try StartupPaths(root: fixture.fixture_root, app: fixture.app_path) }
        catch {
            try attachment(["schema": "nac342-path-admission-v1", "configuration_sha256": digest(bytes),
                "declared_root": fixture.fixture_root, "declared_app": fixture.app_path,
                "physical_root": StartupPaths.physical(fixture.fixture_root) as Any? ?? NSNull(),
                "physical_app": StartupPaths.physical(fixture.app_path) as Any? ?? NSNull(),
                "error": error.localizedDescription], name: "nac342-path-admission-failure")
            throw error
        }
        let appURL = paths.url
        try admit(fixture, paths: paths)
        try require(NSRunningApplication.runningApplications(withBundleIdentifier: fixture.bundle_id)
            .allSatisfy { $0.isTerminated }, "Existing bundle-ID owner blocks qualification")
        observations.append(try console())
        try require(paths.matches(bundle: appURL, executable: URL(fileURLWithPath: paths.native.path)),
                    "Ordinary app resource changed before launch")
        let ui = XCUIApplication(url: appURL)
        ui.launchArguments = ["--directory", fixture.home]
        ui.launchEnvironment = fixture.environment
        ui.launch()
        let running = try XCTUnwrap(NSRunningApplication.runningApplications(withBundleIdentifier: fixture.bundle_id)
            .filter { paths.matches(bundle: $0.bundleURL, executable: $0.executableURL) && !$0.isTerminated }.only)
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
                        if (try? guardWindow(ui, running: running, paths: paths, launch: launch, number: number)) != nil {
                            let image = XCTAttachment(screenshot: ui.windows.firstMatch.screenshot())
                            image.name = "nac342-failure-" + fixture.scenario
                            image.lifetime = .keepAlways
                            add(image)
                        }
                    }
                    try incarnation(running, paths: paths, launch: launch)
                    ui.terminate()
                }
                let stopped = ui.wait(for: .notRunning, timeout: 30)
                try attachment(["schema": "nac342-cleanup-v1", "scenario": fixture.scenario,
                    "configuration_sha256": digest(bytes), "app_pid": Int(running.processIdentifier),
                    "app_path": paths.emittedPath, "app_termination_observed": stopped,
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
        let rootWindow = ui.windows.element(boundBy: 0)
        var folderSurface: StartupNativeFolderPolicy.Surface = .form
        let axClient: StartupAXClient?
        if fixture.scenario == "configuredLocal" {
            let declaration = try XCTUnwrap(fixture.ax_witness, "External AX declaration missing")
            try require(declaration.path == fixture.fixture_root + "/ax-witness/receipt.json"
                && declaration.nonce.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil
                && Set(declaration.support_sha256.keys) == ["StartupAXGuard.swift", "StartupAXReceipt.swift"],
                "External AX declaration differs")
            axClient = StartupAXClient(declaration, configurationSHA: digest(bytes),
                pid: running.processIdentifier, launch: launch.timeIntervalSince1970,
                window: number, executable: paths.native.path)
        } else { axClient = nil }
        var axRefusalEmitted = false
        func panel() throws -> XCUIElement {
            let sheets = rootWindow.children(matching: .sheet).allElementsBoundByAccessibilityElement
            try require(sheets.count == 1, "Owned root has no unique attached folder panel")
            return sheets[0]
        }
        func goToField() throws -> XCUIElement {
            let sheets = try panel().children(matching: .sheet).allElementsBoundByAccessibilityElement
            try require(sheets.count == 1, "Folder panel has no unique attached Go to Folder sheet")
            let fields = sheets[0].textFields.matching(NSPredicate(format: "label == %@", "Go to the folder:"))
                .allElementsBoundByAccessibilityElement
            try require(fields.count == 1, "Owned Go to Folder field absent or ambiguous")
            let field = fields[0]
            try require(StartupNativeFolderPolicy.usable(exists: field.exists, enabled: field.isEnabled,
                hittable: field.isHittable, frame: field.frame, owner: sheets[0].frame),
                "Owned Go to Folder field is not actionable")
            return field
        }
        func validateFolderSurface(_ ticket: StartupAXClient.Ticket) throws {
            let roots = rootWindow.children(matching: .sheet).allElementsBoundByAccessibilityElement
            let nested = roots.count == 1 ? roots[0].children(matching: .sheet).count : 0
            try require(StartupNativeFolderPolicy.surface(folderSurface, windows: ui.windows.count,
                rootSheets: roots.count, nestedSheets: nested, allSheets: ui.descendants(matching: .sheet).count),
                "Foreign, ambiguous or stale native folder surface")
            if folderSurface != .form {
                let sheet = try panel()
                try require(StartupNativeFolderPolicy.attached(exists: sheet.exists,
                    frame: sheet.frame, owner: rootWindow.frame),
                    "Folder panel is not attached to the owned root")
                if folderSurface == .panel {
                    try require(StartupNativeFolderPolicy.usable(exists: sheet.exists, enabled: sheet.isEnabled,
                        hittable: sheet.isHittable, frame: sheet.frame, owner: rootWindow.frame),
                        "Owned folder panel is not actionable")
                }
            }
            let field: (CGRect, String)?
            if folderSurface == .goTo {
                let target = try goToField()
                field = (target.frame, try XCTUnwrap(target.value as? String))
            } else { field = nil }
            _ = try XCTUnwrap(axClient).consume(ticket, surface: folderSurface, rootFrame: rootWindow.frame, field: field)
        }
        func guardTarget() throws {
            do {
                let ticket = try axClient?.begin()
                try guardWindow(ui, running: running, paths: paths, launch: launch, number: number)
                try require((try? Data(contentsOf: URL(fileURLWithPath: path))) == bytes,
                    "Frozen fixture configuration changed")
                if let ticket { try validateFolderSurface(ticket) }
            } catch {
                if !axRefusalEmitted, let data = axClient?.failureData,
                   var record = try? json(data) {
                    axRefusalEmitted = true
                    record.merge(["scenario": fixture.scenario, "surface": folderSurface.rawValue,
                        "source_sha": fixture.source_sha, "test_source_sha": fixture.test_source_sha,
                        "harness_sha": fixture.harness_sha, "startup_source_sha256": fixture.startup_source_sha256,
                        "configuration_sha256": digest(bytes), "app_pid": Int(running.processIdentifier),
                        "app_launch_epoch": launch.timeIntervalSince1970, "window_number": number]) { _, new in new }
                    try? attachment(record, name: "nac342-ax-refusal-v1-" + fixture.scenario)
                }
                throw error
            }
        }
        func dispatch(_ name: String, after: StartupNativeFolderPolicy.Surface? = nil,
                      action: () throws -> Void) throws {
            try guardTarget()
            let index = operations.count + 1
            func retain(_ stage: String) throws {
                try attachment(["schema": "nac342-dispatch-v1", "scenario": fixture.scenario,
                    "configuration_sha256": digest(bytes), "operation_index": index,
                    "operation": name, "stage": stage, "app_pid": Int(running.processIdentifier),
                    "app_launch_epoch": launch.timeIntervalSince1970, "window_number": number,
                    "app_path": paths.emittedPath, "native_sha256": fixture.native_sha256],
                    name: String(format: "nac342-dispatch-v1-%02d-%@", index, stage))
            }
            try retain("before")
            try action()
            operations.append(name)
            if let after { folderSurface = after }
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
            let window = ui.windows.firstMatch
            let onboarding = window.descendants(matching: .staticText)
                .matching(NSPredicate(format: "value == %@", StartupOnboardingTitle.text))
            try StartupQueryDiagnostic.requireOnboarding(wait: {
                StartupOnboardingTitle.visible(wait: {
                    onboarding.firstMatch.waitForExistence(timeout: 45)
                }, elements: { onboarding.allElementsBoundByAccessibilityElement },
                staticTextType: Int(XCUIElement.ElementType.staticText.rawValue), project: { title in
                    StartupOnboardingTitle.Candidate(elementType: Int(title.elementType.rawValue),
                        exists: title.exists, enabled: title.isEnabled, hittable: title.isHittable,
                        value: title.value, frame: title.frame)
                }, window: { window.frame }, verify: {
                    (try? guardTarget()) != nil
                        && (try? Data(contentsOf: URL(fileURLWithPath: path))) == bytes
                })
            }, diagnose: {
                // Historical v1 certifies the original label wait failed.
                // A value-assertion failure cannot emit that unchanged record.
            })
            if fixture.scenario == "configuredLocal" {
                try click(ui.webViews.buttons, "Get Started")
                func folderControl(_ path: String) throws -> XCUIElement {
                    let controls = rootWindow.webViews.buttons.matching(
                        NSPredicate(format: "label == %@", "Choose Working Folder: " + path))
                    try require(controls.firstMatch.waitForExistence(timeout: 10), "Working Folder control missing")
                    let matches = controls.allElementsBoundByAccessibilityElement
                    try require(matches.count == 1, "Working Folder control ambiguous")
                    let control = matches[0]
                    try require(StartupNativeFolderPolicy.usable(exists: control.exists, enabled: control.isEnabled,
                        hittable: control.isHittable, frame: control.frame, owner: rootWindow.frame),
                        "Working Folder control is not actionable")
                    return control
                }
                let initial = try folderControl(fixture.home)
                try dispatch("click:Choose Working Folder: " + fixture.home, after: .panel) {
                    initial.click()
                    try require(rootWindow.children(matching: .sheet).firstMatch.waitForExistence(timeout: 10),
                        "Owned native folder panel did not appear")
                }
                try dispatch("key:command-shift-g-native-folder", after: .goTo) {
                    try panel().typeKey("g", modifierFlags: [.command, .shift])
                    let nested = try panel().children(matching: .sheet)
                    try require(nested.firstMatch.waitForExistence(timeout: 10), "Owned Go to Folder sheet did not appear")
                }
                try dispatch("key:command-a-native-go-to-folder") {
                    try goToField().typeKey("a", modifierFlags: .command)
                }
                try dispatch("type:owned-workspace") {
                    let field = try goToField()
                    field.typeText(fixture.workspace)
                    try require(field.value as? String == fixture.workspace, "Go to Folder value differs from declared workspace")
                }
                let goTo = try panel().children(matching: .sheet).element(boundBy: 0)
                try dispatch("key:return-native-go-to-folder", after: .panel) {
                    try goToField().typeKey(.return, modifierFlags: [])
                    try require(goTo.waitForNonExistence(timeout: 10), "Owned Go to Folder sheet survived submission")
                }
                let selectedPanel = try panel()
                let select = selectedPanel.buttons.matching(NSPredicate(format: "label == %@", "Select"))
                try require(select.firstMatch.waitForExistence(timeout: 10) && select.count == 1
                    && select.firstMatch.isEnabled && select.firstMatch.isHittable,
                    "Owned native Select absent or ambiguous")
                try dispatch("click:native-folder-Select", after: .form) {
                    select.element(boundBy: 0).click()
                    try require(selectedPanel.waitForNonExistence(timeout: 10), "Owned native folder panel survived selection")
                }
                let filled = try folderControl(fixture.workspace)
                try require(StartupNativeFolderPolicy.selected(filled.label, workspace: fixture.workspace),
                    "Exact declared workspace did not reach the normal project form")
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
        if let axClient {
            try require(axClient.evidence.count == 26, "External AX guard trace incomplete")
            let rows = try JSONSerialization.jsonObject(with: JSONEncoder().encode(axClient.evidence))
            try attachment(["schema": "nac342-ax-guards-v1", "configuration_sha256": digest(bytes),
                "source_sha": fixture.source_sha, "test_source_sha": fixture.test_source_sha,
                "harness_sha": fixture.harness_sha, "app_pid": Int(running.processIdentifier),
                "app_launch_epoch": launch.timeIntervalSince1970, "window_number": number,
                "helper_sha256": axClient.declaration.helper_sha256,
                "support_sha256": axClient.declaration.support_sha256, "rows": rows],
                name: "nac342-ax-guards-v1-configuredLocal")
        }
        let expectedPrivateFailure: [String: Any] = fixture.scenario == "futureStore"
            ? ["kind": "failed", "version": 1, "code": "store_schema_incompatible", "stage": "startup"] : [:]
        try attachment(["schema": fixture.schema, "scenario": fixture.scenario,
            "configuration_sha256": digest(bytes), "source_sha": fixture.source_sha,
            "test_source_sha": fixture.test_source_sha, "harness_sha": fixture.harness_sha,
            "manifest_sha256": fixture.manifest_sha256, "package_identity_sha256": fixture.package_identity_sha256,
            "engine_identity_sha256": fixture.engine_identity_sha256, "build_receipt_sha256": fixture.build_receipt_sha256,
            "startup_source_sha256": fixture.startup_source_sha256,
            "native_sha256": fixture.native_sha256, "engine_sha256": fixture.engine_sha256,
            "app_path": paths.emittedPath, "bundle_id": fixture.bundle_id,
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
