// External, read-only ownership witness. Never linked into the product/test app.
import AppKit
import CryptoKit
import Darwin
import Foundation

enum OwnershipError: Error { case invalid }

// BEGIN STARTUP PROCESS PROBES (compiled unchanged by Foundation-only controls)
struct StartupProbeFailure: Error {
    let pid: Int32
    let scope, reason: String
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
        try checked(count == expected, pid: pid, stage: "bsd", error: errno)
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
            throw StartupProbeFailure(pid: pid, scope: scope, reason: error.reason)
        }
    }
}
// END STARTUP PROCESS PROBES

@main
enum StartupObserver {
    static func need(_ condition: Bool) throws {
        if !condition { throw OwnershipError.invalid }
    }

    static func arguments(_ pid: Int32) throws -> ([String], [String: String]) {
        var mib = [CTL_KERN, KERN_PROCARGS2, pid]
        var size = 256 * 1024
        var bytes = [UInt8](repeating: 0, count: size)
        try need(sysctl(&mib, 3, &bytes, &size, nil, 0) == 0 && size > 4 && size <= bytes.count)
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

    static func snapshot(_ config: [String: Any], known: inout [Int32: StartupProcessIdentity]) throws -> [String: Any] {
        let path = config["app_path"] as! String
        let identifier = config["bundle_id"] as! String
        let expectedEnvironment = config["environment"] as! [String: String]
        let candidates = NSRunningApplication.runningApplications(withBundleIdentifier: identifier).filter { !$0.isTerminated }
        try need(candidates.count <= 1 && candidates.allSatisfy { $0.bundleURL?.resolvingSymlinksInPath().path == path })
        let app = candidates.first
        let nativePath = path + "/Contents/MacOS/NACPreview"
        let enginePath = path + "/Contents/Resources/nac-web"
        var nodes: [[String: Any]] = []
        var identities: [Int32: StartupProcessIdentity] = [:]
        var retired: [[String: Any]] = [], enumeratedExits: [[String: Any]] = []
        var pending: [Int32] = [], examined: Set<Int32> = []
        func include(_ pid: Int32, scope: String, parent: Int32? = nil) throws {
            guard examined.insert(pid).inserted else { return }
            guard let identity = try StartupProcessProbe.observe(pid, previous: known[pid], scope: scope, uid: getuid()) else {
                if let old = known[pid] { retired.append(old.retirement) }
                else if let parent { enumeratedExits.append(["pid": Int(pid), "parent": Int(parent), "proof": "kill_zero_ESRCH"]) }
                return
            }
            try need(known[pid] != nil || identity.executable == nativePath || identity.executable == enginePath
                     || scope == "enumerated_child")
            identities[pid] = identity
            pending.append(pid)
        }
        // Required identities are probed even when the global list/path lookup
        // omitted them. Unknown foreign paths grant no ownership or signals.
        for pid in known.keys.sorted() { try include(pid, scope: "known") }
        if let app { try include(app.processIdentifier, scope: "app") }
        for pid in try allPIDs() where !examined.contains(pid) {
            if let path = try? StartupProcessProbe.path(pid), path == nativePath || path == enginePath {
                try include(pid, scope: "candidate")
            }
        }
        var cursor = 0
        while cursor < pending.count {
            try need(pending.count <= 128)
            let parent = pending[cursor]
            cursor += 1
            for child in try children(parent) {
                try include(child, scope: "enumerated_child", parent: parent)
            }
        }
        var observed: [Int32: StartupProcessIdentity] = [:]
        for (pid, identity) in identities {
            let actual = identity.executable
            let (argv, environment) = try arguments(pid)
            if actual == nativePath || actual == enginePath { try need(argv.first == actual) }
            try need(!environment.keys.contains { $0.hasSuffix("_TOKEN") || $0.hasSuffix("_API_KEY") || $0 == "NAC_MANAGED_CONFIG" })
            try need(expectedEnvironment.allSatisfy { environment[$0.key] == $0.value })
            guard let after = try StartupProcessProbe.observe(pid, previous: identity, scope: "detail", uid: getuid()) else {
                if let old = known[pid] { retired.append(old.retirement) }
                else { enumeratedExits.append(["pid": Int(pid), "parent": Int(identity.parent), "proof": "kill_zero_ESRCH"]) }
                continue
            }
            observed[pid] = after
            var node = after.record
            node.merge(["kind": actual == nativePath ? "app" : (actual == enginePath ? "engine" : "descendant"),
                "environment": expectedEnvironment,
                "arguments_sha256": SHA256.hash(data: try JSONSerialization.data(withJSONObject: argv)).map { String(format: "%02x", $0) }.joined(),
                "configuration_helper": argv.contains("__desktop-configuration"), "serving": argv.contains("--bind")]) { _, new in new }
            if actual == nativePath {
                try need(app?.processIdentifier == pid)
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
            try need(owned || known[pid] != nil)
        }
        try need(Set(known.keys).isSubset(of: Set(observed.keys).union(retiredPIDs)))
        try need(Set(known.keys).union(observed.keys).count <= 128)
        known.merge(observed) { _, new in new }
        return try record(nodes: nodes, retired: retired, enumeratedExits: enumeratedExits)
    }

    // BEGIN STARTUP OBSERVER RECORDS (same producer/emitter in fixture controls)
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

    static func failureRecord(_ error: Error, known: [Int32: StartupProcessIdentity]) -> [String: Any] {
        let failure = error as? StartupProbeFailure
        return ["schema": "nac342-owner-v1", "event": "failed", "complete": false,
                "reason": "ownership_observation_unavailable",
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
        var known: [Int32: StartupProcessIdentity] = [:]
        do {
            try need(CommandLine.arguments.count == 2)
            let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
            try need(data.count <= 32 * 1024)
            let config = try JSONSerialization.jsonObject(with: data) as! [String: Any]
            try need(config["schema"] as? String == "nac342-startup-xctest-v1")
            try need(config["app_path"] is String && config["bundle_id"] as? String == "ai.arcee.nac.dev"
                && config["environment"] is [String: String])
            let initial = try snapshot(config, known: &known)
            try need((initial["nodes"] as! [[String: Any]]).isEmpty)
            try emit(readyRecord(SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()))
            let owner = getppid()
            while getppid() == owner {
                try emit(snapshot(config, known: &known))
                RunLoop.current.run(until: Date().addingTimeInterval(0.05))
            }
        } catch {
            // Never stringify OS errors or process/credential-bearing values.
            try? emit(failureRecord(error, known: known))
            exit(1)
        }
    }
}
