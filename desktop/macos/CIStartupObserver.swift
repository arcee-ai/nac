// External, read-only ownership witness. Never linked into the product/test app.
import ApplicationServices
import Security
import AppKit
import CryptoKit
import Darwin
import Foundation

enum OwnershipError: Error { case invalid, argumentsUnavailable }

// BEGIN STARTUP PROCESS PROBES (compiled unchanged by Foundation-only controls)
struct StartupProbeFailure: Error {
    let pid: Int32
    let scope, reason: String
    let bsdRead: [String: Int32]?
    init(pid: Int32, scope: String, reason: String, bsdRead: [String: Int32]? = nil) {
        self.pid = pid; self.scope = scope; self.reason = reason; self.bsdRead = bsdRead
    }
}

struct StartupProcessIdentity {
    let pid, parent, uid: UInt32
    let seconds, microseconds: UInt64
    let executable: String

    func sameLifetime(_ other: Self) -> Bool {
        pid == other.pid && uid == other.uid && seconds == other.seconds
            && microseconds == other.microseconds && executable == other.executable
    }

    var record: [String: Any] {
        ["pid": Int(pid), "parent": Int(parent), "uid": Int(uid), "start_seconds": seconds,
         "start_microseconds": microseconds, "executable": executable]
    }

    var fingerprint: [String: Any] {
        ["pid": Int(pid), "uid": Int(uid), "start_seconds": seconds, "start_microseconds": microseconds,
         "executable_sha256": SHA256.hash(data: Data(executable.utf8)).map { String(format: "%02x", $0) }.joined()]
    }

    var retirement: [String: Any] { ["identity": record, "proof": "kill_zero_ESRCH"] }
}

enum StartupProcessProbe {
    static func checked(_ success: Bool, pid: Int32, stage: String, error: Int32) throws {
        if !success {
            throw StartupProbeFailure(pid: pid, scope: stage,
                reason: stage + ((error == EPERM || error == EACCES) ? "_denied" : "_unavailable"))
        }
    }

    static func bsd(_ pid: Int32) throws -> proc_bsdinfo {
        var value = proc_bsdinfo()
        let expected = Int32(MemoryLayout<proc_bsdinfo>.size)
        errno = 0
        let count = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &value, expected)
        let savedErrno = errno // Immediately after the existing syscall, before any helper call.
        do { try checked(count == expected, pid: pid, stage: "bsd", error: savedErrno) }
        catch let failure as StartupProbeFailure {
            throw StartupProbeFailure(pid: failure.pid, scope: failure.scope, reason: failure.reason,
                bsdRead: ["returned_count": count, "expected_count": expected, "errno": savedErrno])
        }
        return value
    }

    static func path(_ pid: Int32) throws -> String {
        var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        errno = 0
        let count = proc_pidpath(pid, &buffer, UInt32(buffer.count))
        try checked(count > 0, pid: pid, stage: "path", error: errno)
        return String(cString: buffer)
    }

    static func absent(_ pid: Int32) throws -> Bool {
        errno = 0
        let result = kill(pid, 0), error = errno
        if result == -1 && error == ESRCH { return true }
        try checked(result == 0 || (result == -1 && error == EPERM), pid: pid, stage: "existence", error: error)
        return false
    }

    static func observe(_ pid: Int32, previous: StartupProcessIdentity?, scope: String, uid: UInt32,
                        readBSD: (Int32) throws -> proc_bsdinfo = bsd,
                        readPath: (Int32) throws -> String = path,
                        isAbsent: (Int32) throws -> Bool = absent) throws -> StartupProcessIdentity? {
        do {
            let before = try readBSD(pid), path = try readPath(pid)
            let after = try readBSD(pid), finalPath = try readPath(pid)
            let first = StartupProcessIdentity(pid: before.pbi_pid, parent: before.pbi_ppid, uid: before.pbi_uid,
                seconds: before.pbi_start_tvsec, microseconds: before.pbi_start_tvusec, executable: path)
            let last = StartupProcessIdentity(pid: after.pbi_pid, parent: after.pbi_ppid, uid: after.pbi_uid,
                seconds: after.pbi_start_tvsec, microseconds: after.pbi_start_tvusec, executable: finalPath)
            guard first.pid == UInt32(pid), first.uid == uid, first.seconds > 0,
                  first.microseconds < 1_000_000, first.sameLifetime(last),
                  previous.map({ $0.sameLifetime(last) && (last.parent == $0.parent || last.parent == 1) }) ?? true else {
                throw StartupProbeFailure(pid: pid, scope: scope, reason: "identity_changed")
            }
            return last
        } catch let error as StartupProbeFailure {
            // A denied/missing path alone never retires an identity. Only an
            // independent positive PID absence can resolve a failed probe.
            if error.reason != "identity_changed", try isAbsent(pid) { return nil }
            throw StartupProbeFailure(pid: pid, scope: scope, reason: error.reason, bsdRead: error.bsdRead)
        }
    }
}
// END STARTUP PROCESS PROBES

// BEGIN STARTUP ENVIRONMENT CHECKS (pure Foundation production controls)
struct StartupEnvironmentRejection: Error {
    // Closed diagnostic operands only. Never an identity or cleanup witness.
    let detail: [String: Any]
}

enum StartupEnvironmentCheck {
    static func record(executable: String, nativePath: String, enginePath: String,
                       argv: [String], environment: [String: String],
                       launcher: [String: String], child: [String: String],
                       previouslyKnown: Bool = false) throws -> [String: Any] {
        let executableClass = executable == nativePath ? "native"
            : executable == enginePath ? "bundled_engine" : "descendant"
        func rejection(_ predicate: String, _ operands: [String: Any]) -> StartupEnvironmentRejection {
            var detail: [String: Any] = ["executable_class": executableClass,
                "previously_known": previouslyKnown, "predicate": predicate]
            detail.merge(operands) { _, new in new }
            return StartupEnvironmentRejection(detail: detail)
        }
        guard Set(launcher.keys) == Set(child.keys) else {
            throw rejection("contract", ["contract_check": "key_set"])
        }
        guard !launcher.isEmpty else { throw rejection("contract", ["contract_check": "empty_launcher"]) }
        guard launcher.allSatisfy({ $0.key == "PATH" || child[$0.key] == $0.value }) else {
            throw rejection("contract", ["contract_check": "non_path_value"])
        }
        for (suffix, category) in [("_TOKEN", "token"), ("_API_KEY", "api_key"), ("NAC_MANAGED_CONFIG", "managed_config")] {
            if environment.keys.contains(where: { category == "managed_config" ? $0 == suffix : $0.hasSuffix(suffix) }) {
                throw rejection("prohibited", ["category": category])
            }
        }
        let kind: String, role: String
        let helper = argv.contains("__desktop-configuration"), serving = argv.contains("--bind")
        let flags = ["argv0_matches": argv.first == executable, "helper_present": helper, "serving_present": serving]
        if executable == nativePath {
            guard argv.first == executable, !helper, !serving else { throw rejection("native_argv", flags) }
            kind = "app"; role = "launcher"
        } else if executable == enginePath {
            guard argv.first == executable, helper != serving else { throw rejection("engine_argv", flags) }
            kind = "engine"; role = helper ? "configuration_helper" : "engine"
        } else {
            kind = "descendant"; role = "descendant"
        }
        let expected = kind == "app" ? launcher : child
        let fields: Set<String> = ["HOME", "NAC_HOME", "PATH", "LANG", "NAC_TELEMETRY",
            "NAC_ORCHESTRATION", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL", "BROWSER", "MODELS_DEV_URL"]
        for key in expected.keys.sorted() where environment[key] != expected[key] {
            throw rejection("controlled_value", ["field": fields.contains(key) ? key : "other",
                "difference": environment[key] == nil ? "absent" : "different"])
        }
        // Emit the actual allowlisted projection after comparison, never
        // ambient variables or merely a copy of the declared expectation.
        let observed = environment.filter { expected[$0.key] != nil }
        return ["kind": kind, "environment_role": role, "environment": observed,
                "configuration_helper": kind == "engine" && helper, "serving": kind == "engine" && serving]
    }
}
// END STARTUP ENVIRONMENT CHECKS

// BEGIN STARTUP FOUNDATION URL RESOURCES (owned Foundation/Darwin controls)
struct StartupURLResources {
    private struct Entry: Equatable {
        let path: String
        let kind: mode_t
        let device: dev_t
        let inode: ino_t
    }
    private let entries: [Entry]
    private let appPath, nativePath: String

    static func lexical(_ value: String) -> Bool {
        guard value.hasPrefix("/"), value.utf8.count <= 4096,
              !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return false }
        return value.split(separator: "/", omittingEmptySubsequences: false).dropFirst()
            .allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }

    static func physical(_ value: String) -> String? {
        guard lexical(value), let result = realpath(value, nil) else { return nil }
        defer { free(result) }
        return String(cString: result)
    }

    private static func entry(_ path: String, kind: mode_t) throws -> Entry {
        var info = stat()
        guard physical(path) == path, lstat(path, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == kind else { throw OwnershipError.invalid }
        return Entry(path: path, kind: kind, device: info.st_dev, inode: info.st_ino)
    }

    init(root: String, app: String) throws {
        guard Self.lexical(root), root.split(separator: "/").last?.hasPrefix("nac342-xctest-") == true,
              app == root + "/Moved app folder with spaces/NAC.app" else { throw OwnershipError.invalid }
        appPath = app
        nativePath = app + "/Contents/MacOS/NACPreview"
        entries = try [Self.entry(root, kind: mode_t(S_IFDIR)), Self.entry(app, kind: mode_t(S_IFDIR)),
                       Self.entry(nativePath, kind: mode_t(S_IFREG))]
    }

    func intact() -> Bool {
        entries.allSatisfy { (try? Self.entry($0.path, kind: $0.kind)) == $0 }
    }

    func matches(bundle: URL?, executable: URL?) -> Bool {
        guard let bundle, let executable, bundle.isFileURL, executable.isFileURL,
              Self.physical(bundle.path) == appPath,
              Self.physical(executable.path) == nativePath else { return false }
        // Resource identities were pinned once, before any app launch. Only
        // observed Foundation spellings are mapped; raw proc paths/argv stay exact.
        return intact()
    }
}
// END STARTUP FOUNDATION URL RESOURCES


// Isolated one-shot diagnostic. No owner-stream records, input, or trust prompt.
enum StartupAXPreflight {
    static func hash(_ bytes: Data) -> String {
        SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }

    static func file(_ path: String, limit: Int) throws -> Data {
        let fd = open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        guard fd >= 0 else { throw OwnershipError.invalid }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              info.st_size <= limit else { throw OwnershipError.invalid }
        let data = try handle.read(upToCount: limit + 1) ?? Data()
        guard data.count <= limit else { throw OwnershipError.invalid }
        return data
    }

    @MainActor
    static func main(_ configPath: String, _ requestPath: String) {
        var out: [String: Any] = ["schema": "nac342-ax-preflight-v1", "acceptance": false,
            "trusted": false, "windows_read": false, "ax_code": 0, "window_count": 0,
            "root_matches": 0, "bound": false, "identity_rechecked": false,
            "signing_code": -1, "app_sandbox_entitlement": NSNull()]
        do {
            let data = try file(configPath, limit: 32768), request = try file(requestPath, limit: 8192)
            let config = try JSONSerialization.jsonObject(with: data) as! [String: Any]
            let binding = try JSONSerialization.jsonObject(with: request) as! [String: Any]
            try StartupObserver.need(Set(binding.keys) == ["configuration_sha256", "identity", "window_number"]
                && binding["configuration_sha256"] as? String == hash(data)
                && config["schema"] as? String == "nac342-startup-xctest-v1"
                && config["bundle_id"] as? String == "ai.arcee.nac.dev")
            out["configuration_sha256"] = hash(data); out["request_sha256"] = hash(request)
            out["binary_sha256"] = hash(try file(CommandLine.arguments[0], limit: 16 * 1024 * 1024))
            var code: SecCode?, staticCode: SecStaticCode?, information: CFDictionary?
            let selfCode = SecCodeCopySelf([], &code)
            let staticStatus = code.map { SecCodeCopyStaticCode($0, [], &staticCode) }
            let signing = staticCode.map { SecCodeCopySigningInformation($0, SecCSFlags(rawValue: kSecCSSigningInformation), &information) }
            out["signing_code"] = signing ?? staticStatus ?? selfCode
            if let details = information as? [String: Any] {
                let entitlements = details[kSecCodeInfoEntitlementsDict as String] as? [String: Any] ?? [:]
                out["app_sandbox_entitlement"] = entitlements["com.apple.security.app-sandbox"] as? Bool ?? false
                out["signing_flags"] = (details[kSecCodeInfoFlags as String] as? NSNumber)?.uint32Value ?? 0
            }
            let resources = try StartupURLResources(root: config["fixture_root"] as! String, app: config["app_path"] as! String)
            var known: [Int32: StartupProcessIdentity] = [:]
            func owned() throws -> [String: Any] {
                let snapshot = try StartupObserver.snapshot(config, resources: resources, known: &known)
                let apps = (snapshot["nodes"] as! [[String: Any]]).filter { $0["kind"] as? String == "app" }
                try StartupObserver.need(apps.count == 1)
                let app = apps[0], expected = binding["identity"] as! [String: Any]
                let keys = ["pid", "parent", "uid", "start_seconds", "start_microseconds", "executable"]
                try StartupObserver.need(Set(expected.keys) == Set(keys)
                    && NSDictionary(dictionary: app.filter { keys.contains($0.key) }).isEqual(NSDictionary(dictionary: expected))
                    && app["windows"] as? [Int] == [binding["window_number"] as! Int])
                return app
            }
            let app = try owned(), pid = Int32(app["pid"] as! Int)
            defer {
                if (try? owned()) != nil { out["identity_rechecked"] = true }
                else { out["bound"] = false }
            }
            let trusted = AXIsProcessTrusted() // Once, plain API, never options/prompt.
            out["trusted"] = trusted
            if trusted {
                let element = AXUIElementCreateApplication(pid)
                func read(_ element: AXUIElement, _ name: String) throws -> CFTypeRef {
                    let timeout = AXUIElementSetMessagingTimeout(element, 1)
                    out["ax_code"] = timeout.rawValue
                    try StartupObserver.need(timeout == .success)
                    var value: CFTypeRef?
                    if name == kAXWindowsAttribute { out["windows_read"] = true }
                    let status = AXUIElementCopyAttributeValue(element, name as CFString, &value)
                    out["ax_code"] = status.rawValue
                    try StartupObserver.need(status == .success && value != nil)
                    return value!
                }
                let raw = try read(element, kAXWindowsAttribute)
                try StartupObserver.need(CFGetTypeID(raw) == CFArrayGetTypeID())
                let windows = raw as! [AnyObject]
                out["window_count"] = windows.count
                try StartupObserver.need(windows.count <= 128 && windows.allSatisfy { CFGetTypeID($0) == AXUIElementGetTypeID() })
                let cg = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
                let matching = cg.filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid
                    && ($0[kCGWindowNumber as String] as? Int) == binding["window_number"] as? Int
                    && ($0[kCGWindowLayer as String] as? Int) == 0 }
                try StartupObserver.need(matching.count == 1)
                let frame = CGRect(dictionaryRepresentation: matching[0][kCGWindowBounds as String] as! CFDictionary)
                var roots = 0
                for value in windows {
                    let window = value as! AXUIElement
                    var owner: pid_t = 0
                    let timeout = AXUIElementSetMessagingTimeout(window, 1); out["ax_code"] = timeout.rawValue
                    try StartupObserver.need(timeout == .success)
                    let status = AXUIElementGetPid(window, &owner); out["ax_code"] = status.rawValue
                    try StartupObserver.need(status == .success && owner == pid)
                    let role = try read(window, kAXRoleAttribute)
                    let position = try read(window, kAXPositionAttribute), size = try read(window, kAXSizeAttribute)
                    try StartupObserver.need(CFGetTypeID(role) == CFStringGetTypeID()
                        && CFGetTypeID(position) == AXValueGetTypeID() && CFGetTypeID(size) == AXValueGetTypeID())
                    let p = position as! AXValue, s = size as! AXValue
                    var point = CGPoint.zero, dimensions = CGSize.zero
                    try StartupObserver.need(AXValueGetType(p) == .cgPoint && AXValueGetType(s) == .cgSize
                        && AXValueGetValue(p, .cgPoint, &point) && AXValueGetValue(s, .cgSize, &dimensions))
                    if role as? String == "AXWindow" && CGRect(origin: point, size: dimensions) == frame { roots += 1 }
                }
                out["root_matches"] = roots
                try StartupObserver.need(roots == 1)
                out["bound"] = true
            }
        } catch {
            out["bound"] = false // Closed facts only; no OS/path/tree/text exception dump.
        }
        if let bytes = try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]) {
            FileHandle.standardOutput.write(bytes + Data([10]))
        }
        exit(out["bound"] as? Bool == true && out["identity_rechecked"] as? Bool == true ? 0 : 1)
    }
}

@main
enum StartupObserver {
    static func need(_ condition: Bool) throws {
        if !condition { throw OwnershipError.invalid }
    }

    static func arguments(_ pid: Int32) throws -> ([String], [String: String]) {
        var mib = [CTL_KERN, KERN_PROCARGS2, pid]
        var size = 256 * 1024
        var bytes = [UInt8](repeating: 0, count: size)
        errno = 0
        let result = sysctl(&mib, 3, &bytes, &size, nil, 0), error = errno
        if result != 0 {
            // A denied read is not an exit and must retain failure even if
            // the process disappears before another observation.
            try need(error != EPERM && error != EACCES)
            throw OwnershipError.argumentsUnavailable
        }
        try need(size > 4 && size <= bytes.count)
        let count = bytes.withUnsafeBytes { $0.loadUnaligned(as: Int32.self) }
        try need(count > 0 && count <= 128)
        var offset = 4
        func word() throws -> String {
            let start = offset
            while offset < size && bytes[offset] != 0 { offset += 1 }
            try need(offset < size && offset - start <= 16384)
            let value = String(bytes: bytes[start..<offset], encoding: .utf8)
            offset += 1
            return try value ?? { throw OwnershipError.invalid }()
        }
        _ = try word() // Kernel's executable path, followed by padding.
        while offset < size && bytes[offset] == 0 { offset += 1 }
        var argv: [String] = []
        for _ in 0..<count { argv.append(try word()) }
        var environment: [String: String] = [:]
        while offset < size && bytes[offset] != 0 {
            let row = try word().split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            try need(row.count == 2 && environment[String(row[0])] == nil)
            environment[String(row[0])] = String(row[1])
        }
        return (argv, environment)
    }

    static func allPIDs() throws -> [Int32] {
        let count = proc_listallpids(nil, 0)
        try need(count > 0 && count < 65536)
        var buffer = [Int32](repeating: 0, count: Int(count) + 512)
        let written = proc_listallpids(&buffer, Int32(buffer.count * MemoryLayout<Int32>.size))
        try need(written > 0 && written < buffer.count)
        return Array(buffer.prefix(Int(written))).filter { $0 > 0 }
    }

    static func children(_ pid: Int32) throws -> [Int32] {
        var buffer = [Int32](repeating: 0, count: 128)
        errno = 0
        let count = proc_listchildpids(pid, &buffer, Int32(buffer.count * MemoryLayout<Int32>.size))
        try StartupProcessProbe.checked(count >= 0 && count < buffer.count && (count > 0 || errno == 0),
                                        pid: pid, stage: "children", error: errno)
        return Array(buffer.prefix(Int(count))).filter { $0 > 0 }
    }

    static func snapshot(_ config: [String: Any], resources: StartupURLResources,
                         known: inout [Int32: StartupProcessIdentity],
                         note: (FailureStage) -> Void = { _ in }) throws -> [String: Any] {
        let path = config["app_path"] as! String
        let identifier = config["bundle_id"] as! String
        let launcherEnvironment = config["environment"] as! [String: String]
        let childEnvironment = config["child_environment"] as! [String: String]
        let candidates = NSRunningApplication.runningApplications(withBundleIdentifier: identifier).filter { !$0.isTerminated }
        note(.resources_candidates)
        // Same short-circuit predicates/observations; only the passive stage distinguishes refusal.
        note(.resources_pinned)
        try need(resources.intact())
        note(.resources_count)
        try need(candidates.count <= 1)
        note(.resources_urls)
        try need(candidates.allSatisfy {
            resources.matches(bundle: $0.bundleURL, executable: $0.executableURL)
        })
        var app = candidates.first
        let nativePath = path + "/Contents/MacOS/NACPreview"
        let enginePath = path + "/Contents/Resources/nac-web"
        var nodes: [[String: Any]] = []
        var identities: [Int32: StartupProcessIdentity] = [:]
        var retired: [[String: Any]] = [], enumeratedExits: [[String: Any]] = []
        var pending: [Int32] = [], examined: Set<Int32> = []
        func include(_ pid: Int32, scope: String, parent: Int32? = nil) throws {
            guard examined.insert(pid).inserted else { return }
            note(.include_probe)
            guard let identity = try StartupProcessProbe.observe(pid, previous: known[pid], scope: scope, uid: getuid()) else {
                if let old = known[pid] { retired.append(old.retirement) }
                else if let parent { enumeratedExits.append(["pid": Int(pid), "parent": Int(parent), "proof": "kill_zero_ESRCH"]) }
                return
            }
            note(.include_admission)
            try need(known[pid] != nil || identity.executable == nativePath || identity.executable == enginePath
                     || scope == "enumerated_child")
            identities[pid] = identity
            pending.append(pid)
        }
        // Required identities are probed even when the global list/path lookup
        // omitted them. Unknown foreign paths grant no ownership or signals.
        for pid in known.keys.sorted() { try include(pid, scope: "known") }
        if let app { try include(app.processIdentifier, scope: "app") }
        note(.process_list)
        for pid in try allPIDs() where !examined.contains(pid) {
            if let path = try? StartupProcessProbe.path(pid), path == nativePath || path == enginePath {
                try include(pid, scope: "candidate")
            }
        }
        var cursor = 0
        while cursor < pending.count {
            note(.pending_limit)
            try need(pending.count <= 128)
            let parent = pending[cursor]
            cursor += 1
            note(.children)
            for child in try children(parent) {
                try include(child, scope: "enumerated_child", parent: parent)
            }
        }
        var observed: [Int32: StartupProcessIdentity] = [:]
        for (pid, originalIdentity) in identities {
            var identity = originalIdentity
            var actual = identity.executable
            let details: ([String], [String: String])
            do {
                note(.arguments)
                details = try arguments(pid)
            } catch OwnershipError.argumentsUnavailable {
                // Only independent positive absence can recover a failed
                // lookup. Parsing/environment validation is never caught.
                note(.arguments_absence)
                guard try StartupProcessProbe.absent(pid) else { throw OwnershipError.argumentsUnavailable }
                if let old = known[pid] { retired.append(old.retirement) }
                else { enumeratedExits.append(["pid": Int(pid), "parent": Int(identity.parent), "proof": "kill_zero_ESRCH"]) }
                continue
            }
            var (argv, environment) = details
            var recoveredCandidate = false
            let environmentRecord: [String: Any]
            note(.environment)
            do {
                environmentRecord = try StartupEnvironmentCheck.record(executable: actual,
                    nativePath: nativePath, enginePath: enginePath, argv: argv, environment: environment,
                    launcher: launcherEnvironment, child: childEnvironment, previouslyKnown: known[pid] != nil)
            } catch let rejection as StartupEnvironmentRejection {
                // An unadmitted spawn may change image between the independent
                // census and argument read. Never reinterpret a committed identity
                // or use argv markers as proof of an engine/parent relationship.
                guard known[pid] == nil, actual == nativePath,
                      rejection.detail["predicate"] as? String == "native_argv",
                      let parentPID = Int32(exactly: identity.parent), let parent = known[parentPID],
                      parent.executable == nativePath, app?.processIdentifier == parentPID else { throw rejection }
                let transitioned: StartupProcessIdentity
                do {
                    note(.detail_probe)
                    guard let checkedParent = try StartupProcessProbe.observe(parentPID, previous: parent,
                              scope: "detail", uid: getuid()), checkedParent.parent == parent.parent,
                          let candidate = try StartupProcessProbe.observe(pid, previous: nil, scope: "detail", uid: getuid()),
                          candidate.pid == identity.pid, candidate.uid == identity.uid,
                          candidate.seconds == identity.seconds, candidate.microseconds == identity.microseconds,
                          candidate.parent == identity.parent, candidate.executable == enginePath else { throw rejection }
                    transitioned = candidate
                } catch {
                    note(.environment)
                    throw rejection // No absence, denial or ambiguity authorizes recovery/retirement.
                }
                identity = transitioned
                actual = identity.executable
                note(.arguments)
                (argv, environment) = try arguments(pid) // One fresh FULL tuple; never reuse rejected bytes.
                note(.environment)
                environmentRecord = try StartupEnvironmentCheck.record(executable: actual,
                    nativePath: nativePath, enginePath: enginePath, argv: argv, environment: environment,
                    launcher: launcherEnvironment, child: childEnvironment, previouslyKnown: false)
                recoveredCandidate = true
            }
            note(.detail_probe)
            guard let after = try StartupProcessProbe.observe(pid, previous: identity, scope: "detail", uid: getuid()) else {
                try need(!recoveredCandidate) // A recovered tuple must have positive coherent bookends.
                if let old = known[pid] { retired.append(old.retirement) }
                else { enumeratedExits.append(["pid": Int(pid), "parent": Int(identity.parent), "proof": "kill_zero_ESRCH"]) }
                continue
            }
            try need(!recoveredCandidate || after.parent == originalIdentity.parent)
            observed[pid] = after
            var node = after.record
            node.merge(environmentRecord) { _, new in new }
            note(.arguments_hash)
            node["arguments_sha256"] = SHA256.hash(data: try JSONSerialization.data(withJSONObject: argv))
                .map { String(format: "%02x", $0) }.joined()
            if actual == nativePath {
                note(.app_binding)
                if app == nil {
                    // Launch may fall between independent app and kernel censuses.
                    // Refresh an absent selection once, retaining existing bindings.
                    let refreshed = NSRunningApplication.runningApplications(withBundleIdentifier: identifier)
                        .filter { !$0.isTerminated }
                    try need(refreshed.count == 1 && refreshed.allSatisfy {
                        $0.processIdentifier == pid
                            && resources.matches(bundle: $0.bundleURL, executable: $0.executableURL)
                    })
                    guard let candidate = refreshed.first,
                          try StartupProcessProbe.observe(pid, previous: after, scope: "app", uid: getuid()) != nil,
                          !candidate.isTerminated,
                          resources.matches(bundle: candidate.bundleURL, executable: candidate.executableURL) else {
                        throw OwnershipError.invalid
                    }
                    app = candidate
                }
                try need(app?.processIdentifier == pid)
                note(.app_launch)
                node["app_launch_epoch"] = try app?.launchDate?.timeIntervalSince1970 ?? { throw OwnershipError.invalid }()
                let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
                    as? [[String: Any]] ?? []
                node["windows"] = windows.filter {
                    ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid
                        && ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0
                }.compactMap { ($0[kCGWindowNumber as String] as? NSNumber)?.intValue }
            }
            nodes.append(node)
        }
        let current = Dictionary(uniqueKeysWithValues: nodes.map { ($0["pid"] as! Int, $0) })
        let retiredPIDs = Set(retired.map { Int32(($0["identity"] as! [String: Any])["pid"] as! Int) })
        if let app {
            note(.current_app)
            try need(current[Int(app.processIdentifier)]?["kind"] as? String == "app"
                     || retiredPIDs.contains(app.processIdentifier))
        }
        for node in nodes where node["kind"] as? String != "app" {
            let pid = Int32(node["pid"] as! Int)
            var parent = node["parent"] as! Int
            var visited: Set<Int> = []
            var owned = false
            while let ancestor = current[parent], visited.insert(parent).inserted {
                if ancestor["kind"] as? String == "app" { owned = true; break }
                parent = ancestor["parent"] as! Int
            }
            // Reparented survivors remain owned only through a prior positive
            // path/parent/start witness; a newly found orphan fails closed.
            note(.ancestry)
            try need(owned || known[pid] != nil)
        }
        note(.known_coverage)
        try need(Set(known.keys).isSubset(of: Set(observed.keys).union(retiredPIDs)))
        note(.known_limit)
        try need(Set(known.keys).union(observed.keys).count <= 128)
        known.merge(observed) { _, new in new }
        note(.snapshot_record)
        return try record(nodes: nodes, retired: retired, enumeratedExits: enumeratedExits)
    }

    // BEGIN STARTUP OBSERVER RECORDS (same producer/emitter in fixture controls)
    // Static, failure-only annotations. No clock, query, authority or error replacement.
    enum FailureStage: String, CaseIterable {
        case unspecified, configuration, initial_empty, ready_emit
        case resources_candidates, resources_pinned, resources_count, resources_urls
        case include_probe, include_admission, process_list
        case pending_limit, children, arguments, arguments_absence
        case environment, detail_probe, arguments_hash, app_binding
        case app_launch, current_app, ancestry, known_coverage
        case known_limit, snapshot_record, snapshot_emit
    }

    static func failureKind(_ error: Error) -> String {
        if error is StartupProbeFailure { return "process_probe" }
        if error is StartupEnvironmentRejection { return "ownership_invalid" }
        if let value = error as? OwnershipError {
            switch value {
            case .invalid: return "ownership_invalid"
            case .argumentsUnavailable: return "arguments_unavailable"
            }
        }
        return "other" // Never stringify an error, domain, path, argv or environment.
    }

    static func record(nodes: [[String: Any]], retired: [[String: Any]], enumeratedExits: [[String: Any]]) throws -> [String: Any] {
        try need(nodes.count + retired.count + enumeratedExits.count <= 128)
        return ["schema": "nac342-owner-v1", "complete": true,
                "nodes": nodes.sorted { ($0["pid"] as! Int) < ($1["pid"] as! Int) },
                "retired": retired, "enumerated_exits": enumeratedExits]
    }

    static func readyRecord(_ configurationSHA256: String) -> [String: Any] {
        ["schema": "nac342-owner-v1", "event": "ready", "complete": true, "nodes": [], "retired": [],
         "enumerated_exits": [], "configuration_sha256": configurationSHA256]
    }

    static func failureRecord(_ error: Error, known: [Int32: StartupProcessIdentity],
                              stage: FailureStage = .unspecified) -> [String: Any] {
        let failure = error as? StartupProbeFailure
        var annotation: [String: Any] = ["stage": stage.rawValue, "kind": failureKind(error)]
        if let detail = failure?.bsdRead { annotation["bsd_read"] = detail }
        if stage == .environment, let rejection = error as? StartupEnvironmentRejection {
            annotation["environment_rejection"] = rejection.detail
        }
        return ["schema": "nac342-owner-v1", "event": "failed", "complete": false,
                "reason": "ownership_observation_unavailable",
                "producer_failure": annotation,
                "retained_identities": known.keys.sorted().compactMap { known[$0]?.fingerprint },
                "unresolved": failure.map { [["pid": Int($0.pid), "scope": $0.scope, "reason": $0.reason]] } ?? []]
    }

    static func emit(_ value: [String: Any]) throws {
        var record = value
        record["observed_uptime_ns"] = String(DispatchTime.now().uptimeNanoseconds)
        let bytes = try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
        try need(bytes.count < 64 * 1024)
        FileHandle.standardOutput.write(bytes + Data([10]))
    }
    // END STARTUP OBSERVER RECORDS

    @MainActor
    static func main() {
        if CommandLine.arguments.count == 4 && CommandLine.arguments[1] == "--ax-witness" {
            StartupAXWitnessMode.main(CommandLine.arguments[2], CommandLine.arguments[3]); return
        }
        if CommandLine.arguments.count == 4 && CommandLine.arguments[1] == "--ax-preflight" {
            StartupAXPreflight.main(CommandLine.arguments[2], CommandLine.arguments[3])
        }
        var known: [Int32: StartupProcessIdentity] = [:]
        var failureStage: FailureStage = .configuration
        do {
            try need(CommandLine.arguments.count == 2)
            let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
            try need(data.count <= 32 * 1024)
            let config = try JSONSerialization.jsonObject(with: data) as! [String: Any]
            try need(config["schema"] as? String == "nac342-startup-xctest-v1")
            try need(config["app_path"] is String && config["bundle_id"] as? String == "ai.arcee.nac.dev"
                && config["fixture_root"] is String && config["environment"] is [String: String]
                && config["child_environment"] is [String: String])
            let resources = try StartupURLResources(root: config["fixture_root"] as! String, app: config["app_path"] as! String)
            let initial = try snapshot(config, resources: resources, known: &known, note: { failureStage = $0 })
            failureStage = .initial_empty
            try need((initial["nodes"] as! [[String: Any]]).isEmpty)
            failureStage = .ready_emit
            try emit(readyRecord(SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()))
            let owner = getppid()
            while getppid() == owner {
                let value = try snapshot(config, resources: resources, known: &known, note: { failureStage = $0 })
                failureStage = .snapshot_emit
                try emit(value)
                RunLoop.current.run(until: Date().addingTimeInterval(0.05))
            }
        } catch {
            // Never stringify OS errors or process/credential-bearing values.
            try? emit(failureRecord(error, known: known, stage: failureStage))
            exit(1)
        }
    }
}
