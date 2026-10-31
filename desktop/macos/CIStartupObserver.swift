// External, read-only ownership witness. Never linked into the product/test app.
import AppKit
import CryptoKit
import Darwin
import Foundation

enum OwnershipError: Error { case invalid }

@main
enum StartupObserver {
    static func need(_ condition: Bool) throws {
        if !condition { throw OwnershipError.invalid }
    }

    static func bsd(_ pid: Int32) throws -> proc_bsdinfo {
        var value = proc_bsdinfo()
        let expected = Int32(MemoryLayout<proc_bsdinfo>.size)
        try need(proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &value, expected) == expected)
        try need(value.pbi_pid == UInt32(pid) && value.pbi_uid == getuid())
        return value
    }

    static func executable(_ pid: Int32) -> String? {
        // C's PROC_PIDPATHINFO_MAXSIZE expression is not imported by Swift.
        var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
        return String(cString: buffer)
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
        let count = proc_listchildpids(pid, &buffer, Int32(buffer.count * MemoryLayout<Int32>.size))
        try need(count >= 0 && count < buffer.count)
        return Array(buffer.prefix(Int(count))).filter { $0 > 0 }
    }

    static func snapshot(_ config: [String: Any], known: inout [Int32: String]) throws -> [String: Any] {
        let path = config["app_path"] as! String
        let identifier = config["bundle_id"] as! String
        let expectedEnvironment = config["environment"] as! [String: String]
        let candidates = NSRunningApplication.runningApplications(withBundleIdentifier: identifier).filter { !$0.isTerminated }
        try need(candidates.count <= 1 && candidates.allSatisfy { $0.bundleURL?.resolvingSymlinksInPath().path == path })
        let app = candidates.first
        let nativePath = path + "/Contents/MacOS/NACPreview"
        let enginePath = path + "/Contents/Resources/nac-web"
        var nodes: [[String: Any]] = []
        // Only paths matching this unique owned bundle pass the filter. No
        // other process arguments/environment/identity are inspected/exported.
        var paths: [Int32: String] = [:]
        for pid in try allPIDs() {
            guard let actual = executable(pid), actual == nativePath || actual == enginePath || known[pid] != nil else { continue }
            paths[pid] = actual
        }
        var pending = Array(paths.keys)
        var cursor = 0
        while cursor < pending.count {
            try need(pending.count <= 128)
            let parent = pending[cursor]
            cursor += 1
            for child in try children(parent) where paths[child] == nil {
                guard let actual = executable(child) else { continue }
                paths[child] = actual
                pending.append(child)
            }
        }
        for (pid, actual) in paths {
            let before = try bsd(pid)
            let signature = "\(before.pbi_start_tvsec):\(before.pbi_start_tvusec):\(actual)"
            if let previous = known[pid] { try need(previous == signature) }
            let (argv, environment) = try arguments(pid)
            if actual == nativePath || actual == enginePath { try need(argv.first == actual) }
            try need(!environment.keys.contains { $0.hasSuffix("_TOKEN") || $0.hasSuffix("_API_KEY") || $0 == "NAC_MANAGED_CONFIG" })
            try need(expectedEnvironment.allSatisfy { environment[$0.key] == $0.value })
            let after = try bsd(pid)
            try need(before.pbi_start_tvsec == after.pbi_start_tvsec
                && before.pbi_start_tvusec == after.pbi_start_tvusec && executable(pid) == actual)
            var node: [String: Any] = ["pid": Int(pid), "parent": Int(before.pbi_ppid),
                "start_seconds": before.pbi_start_tvsec, "start_microseconds": before.pbi_start_tvusec,
                "uid": Int(before.pbi_uid), "executable": actual,
                "kind": actual == nativePath ? "app" : (actual == enginePath ? "engine" : "descendant"),
                "environment": expectedEnvironment,
                "arguments_sha256": SHA256.hash(data: try JSONSerialization.data(withJSONObject: argv)).map { String(format: "%02x", $0) }.joined(),
                "configuration_helper": argv.contains("__desktop-configuration"),
                "serving": argv.contains("--bind")]
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
        if let app { try need(current[Int(app.processIdentifier)]?["kind"] as? String == "app") }
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
        for node in nodes {
            known[Int32(node["pid"] as! Int)] = "\(node["start_seconds"]!):\(node["start_microseconds"]!):\(node["executable"]!)"
        }
        return ["schema": "nac342-owner-v1", "nodes": nodes.sorted { ($0["pid"] as! Int) < ($1["pid"] as! Int) }]
    }

    static func emit(_ value: [String: Any]) throws {
        var record = value
        record["observed_uptime_ns"] = String(DispatchTime.now().uptimeNanoseconds)
        let bytes = try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
        try need(bytes.count < 64 * 1024)
        FileHandle.standardOutput.write(bytes + Data([10]))
    }

    @MainActor
    static func main() {
        do {
            try need(CommandLine.arguments.count == 2)
            let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
            try need(data.count <= 32 * 1024)
            let config = try JSONSerialization.jsonObject(with: data) as! [String: Any]
            try need(config["schema"] as? String == "nac342-startup-xctest-v1")
            try need(config["app_path"] is String && config["bundle_id"] as? String == "ai.arcee.nac.dev"
                && config["environment"] is [String: String])
            var known: [Int32: String] = [:]
            let initial = try snapshot(config, known: &known)
            try need((initial["nodes"] as! [[String: Any]]).isEmpty)
            try emit(["schema": "nac342-owner-v1", "event": "ready", "nodes": [],
                      "configuration_sha256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()])
            let owner = getppid()
            while getppid() == owner {
                try emit(snapshot(config, known: &known))
                RunLoop.current.run(until: Date().addingTimeInterval(0.05))
            }
        } catch {
            // Never stringify OS errors or process/credential-bearing values.
            try? emit(["schema": "nac342-owner-v1", "event": "failed", "reason": "ownership_observation_unavailable"])
            exit(1)
        }
    }
}
