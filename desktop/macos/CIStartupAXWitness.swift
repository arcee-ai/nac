// Finite test-only companion. Metadata retirement remains in its original process.
import Foundation
import AppKit
import ApplicationServices
import Darwin

// BEGIN AX LIFETIME
// Positive known-identity retirement is terminal, never new ready authority.
enum StartupAXLifetime {
    static func outcome(_ snapshot: [String: Any], target: StartupAXProcess, window: Int, latched: inout String?) throws -> String {
        try StartupObserver.need(snapshot["complete"] as? Bool == true && target.valid)
        let apps = (snapshot["nodes"] as! [[String: Any]]).filter { $0["kind"] as? String == "app" }
        try StartupObserver.need(apps.count <= 1)
        if let app = apps.first {
            let keys = ["pid", "parent", "uid", "start_seconds", "start_microseconds", "executable"]
            let current = try JSONDecoder().decode(StartupAXProcess.self,
                from: JSONSerialization.data(withJSONObject: app.filter { keys.contains($0.key) }))
            try StartupObserver.need(current == target && latched != "retired")
            guard let windows = app["windows"] as? [Int] else { throw OwnershipError.invalid }
            if windows.isEmpty { latched = "retiring"; return "retiring" }
            try StartupObserver.need(latched == nil && windows == [window])
            return "ready"
        }
        let retired = snapshot["retired"] as? [[String: Any]] ?? []
        let matches = try retired.filter { row in
            guard row["proof"] as? String == "kill_zero_ESRCH", let identity = row["identity"] as? [String: Any] else { return false }
            return try JSONDecoder().decode(StartupAXProcess.self,
                from: JSONSerialization.data(withJSONObject: identity)) == target
        }
        try StartupObserver.need(matches.count == 1)
        latched = "retired"
        return "retired"
    }
}
// END AX LIFETIME

@MainActor
enum StartupAXWitnessMode {
    static func main(_ configPath: String, _ caseDeadline: String) {
        do {
            let bytes = try StartupAXPreflight.file(configPath, limit: 32768)
            let config = try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
            let declaration = try JSONDecoder().decode(StartupAXDeclaration.self,
                from: JSONSerialization.data(withJSONObject: config["ax_witness"] as Any))
            let digest = StartupAXPreflight.hash(bytes)
            let binary = CommandLine.arguments[0]
            try StartupObserver.need(StartupURLResources.physical(binary) == binary
                && binary == declaration.helper_path && getppid() == declaration.owner_pid
                && StartupAXPreflight.hash(try StartupAXPreflight.file(binary, limit: 16 * 1024 * 1024)) == declaration.helper_sha256
                && config["scenario"] as? String == "configuredLocal")
            let deadline = try StartupAXFiles.number(caseDeadline)
            let admittedAt = DispatchTime.now().uptimeNanoseconds
            try StartupObserver.need(deadline <= StartupAXFiles.number(declaration.deadline_ns)
                && deadline > admittedAt && deadline - admittedAt <= 300_000_000_000)
            let resources = try StartupURLResources(root: config["fixture_root"] as! String, app: config["app_path"] as! String)
            var known: [Int32: StartupProcessIdentity] = [:]
            let initial = try StartupObserver.snapshot(config, resources: resources, known: &known)
            try StartupObserver.need((initial["nodes"] as! [[String: Any]]).isEmpty)
            let trusted = AXIsProcessTrusted() // Once, plain API. Never prompt or options.
            try StartupObserver.need(trusted)
            let me = try process(getpid())
            let empty = StartupAXProcess(pid: 0, parent: 0, uid: Int32(getuid()), start_seconds: 0,
                start_microseconds: 0, executable: "")
            var target = empty, launch = 0.0, window = 0
            var sequence: UInt64 = 0, refusals: UInt64 = 0
            var retired: String?
            let reader = StartupAXReader()
            func receipt(_ status: String, began: UInt64, ended: UInt64,
                         observed: StartupAXSurface? = nil, stage: String? = nil, failure: Data? = nil) -> StartupAXReceipt {
                StartupAXReceipt(schema: "nac342-ax-witness-v1", nonce: declaration.nonce,
                    configuration_sha256: digest, helper_sha256: declaration.helper_sha256,
                    support_sha256: declaration.support_sha256, trusted: trusted, helper: me, target: target,
                    app_launch_epoch: launch, window_number: window, sequence: String(sequence),
                    refusal_generation: String(refusals), began_ns: String(began), ended_ns: String(ended),
                    status: status, case_deadline_ns: caseDeadline, observation: observed, refusal_stage: stage, refusal: failure)
            }
            func terminal(_ snapshot: [String: Any], began: UInt64) throws -> Bool {
                let state = try StartupAXLifetime.outcome(snapshot, target: target, window: window, latched: &retired)
                guard state != "ready" else { return false }
                try StartupObserver.need(resources.intact() && process(getpid()) == me
                    && StartupAXPreflight.hash(try StartupAXPreflight.file(binary, limit: 16 * 1024 * 1024)) == declaration.helper_sha256
                    && StartupAXPreflight.hash(try StartupAXPreflight.file(configPath, limit: 32768)) == digest)
                let ended = DispatchTime.now().uptimeNanoseconds
                try StartupObserver.need(ended >= began && ended < deadline)
                sequence += 1; refusals += 1
                try StartupAXFiles.publish(receipt(state, began: began, ended: ended,
                    stage: "target_" + state), to: declaration.path)
                RunLoop.current.run(until: Date().addingTimeInterval(0.05))
                return true // Keep bounded custody alive until parent stop, no more AX/ready.
            }
            let start = DispatchTime.now().uptimeNanoseconds
            try StartupAXFiles.publish(receipt("waiting", began: start, ended: start), to: declaration.path)
            while getppid() == declaration.owner_pid {
                if let stop = try? StartupAXFiles.read(declaration.path + ".stop"), stop == Data(declaration.nonce.utf8) { return }
                let began = DispatchTime.now().uptimeNanoseconds
                try StartupObserver.need(began < deadline)
                try StartupObserver.need(resources.intact() && process(getpid()) == me
                    && StartupAXPreflight.hash(try StartupAXPreflight.file(configPath, limit: 32768)) == digest)
                let snapshot = try StartupObserver.snapshot(config, resources: resources, known: &known)
                let apps = (snapshot["nodes"] as! [[String: Any]]).filter { $0["kind"] as? String == "app" }
                try StartupObserver.need(apps.count <= 1)
                if target.pid == 0 && (apps.isEmpty || apps[0]["windows"] as? [Int] == []) {
                    RunLoop.current.run(until: Date().addingTimeInterval(0.05)); continue
                }
                if target.pid != 0 { if try terminal(snapshot, began: began) { continue } }
                try StartupObserver.need(apps.count == 1)
                let app = apps[0], current = try decodedProcess(app)
                let windows = app["windows"] as? [Int] ?? []
                try StartupObserver.need(windows.count == 1)
                if target.pid == 0 {
                    target = current; window = windows[0]
                    launch = (app["app_launch_epoch"] as! NSNumber).doubleValue
                }
                try StartupObserver.need(current == target && windows == [window])
                let frame = try ownedFrame(target.pid, window)
                var observed: StartupAXSurface?, stage: String?, failure: Data?
                do { observed = try reader.observe(pid: target.pid, frame: frame) }
                catch { refusals += 1; stage = "ax_predicate_refused"; failure = reader.failureData }
                let closing = try StartupObserver.snapshot(config, resources: resources, known: &known)
                if try terminal(closing, began: began) { continue }
                let latest = (closing["nodes"] as! [[String: Any]]).filter { $0["kind"] as? String == "app" }
                try StartupObserver.need(latest.count == 1 && decodedProcess(latest[0]) == target
                    && latest[0]["windows"] as? [Int] == [window]
                    && resources.intact() && process(getpid()) == me
                    && StartupAXPreflight.hash(try StartupAXPreflight.file(binary, limit: 16 * 1024 * 1024)) == declaration.helper_sha256
                    && StartupAXPreflight.hash(try StartupAXPreflight.file(configPath, limit: 32768)) == digest)
                sequence += 1
                let ended = DispatchTime.now().uptimeNanoseconds
                try StartupObserver.need(ended >= began && ended < deadline)
                if ended - began > 1_000_000_000 {
                    refusals += 1; observed = nil; stage = "sample_deadline"
                }
                try StartupAXFiles.publish(receipt(observed == nil ? "refused" : "ready", began: began,
                    ended: ended, observed: observed, stage: stage, failure: failure), to: declaration.path)
                RunLoop.current.run(until: Date().addingTimeInterval(0.05))
            }
            throw OwnershipError.invalid
        } catch {
            // Unexpected ownership/deadline/stream failure exits nonzero. The
            // parent invalidates/aborts the test and retains original ownership.
            fputs("AX companion failed; no acceptance\n", stderr)
            exit(1)
        }
    }
    static func decodedProcess(_ node: [String: Any]) throws -> StartupAXProcess {
        let keys = ["pid", "parent", "uid", "start_seconds", "start_microseconds", "executable"]
        return try JSONDecoder().decode(StartupAXProcess.self,
            from: JSONSerialization.data(withJSONObject: node.filter { keys.contains($0.key) }))
    }
    static func process(_ pid: Int32) throws -> StartupAXProcess {
        let info = try StartupProcessProbe.bsd(pid)
        return StartupAXProcess(pid: pid, parent: Int32(info.pbi_ppid), uid: Int32(info.pbi_uid),
            start_seconds: Int64(info.pbi_start_tvsec), start_microseconds: Int64(info.pbi_start_tvusec),
            executable: try StartupProcessProbe.path(pid))
    }
    static func ownedFrame(_ pid: Int32, _ number: Int) throws -> CGRect {
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] ?? []
        let matches = windows.filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid
            && ($0[kCGWindowNumber as String] as? NSNumber)?.intValue == number
            && ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0 }
        try StartupObserver.need(matches.count == 1)
        guard let raw = matches[0][kCGWindowBounds as String] as? [String: Any],
              let frame = CGRect(dictionaryRepresentation: raw as CFDictionary) else { throw OwnershipError.invalid }
        try StartupAXFiles.need(StartupNativeFolderPolicy.attached(exists: true, frame: frame, owner: frame))
        return frame
    }
}
