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
            try StartupObserver.need(latched == nil && windows.filter { $0 == window }.count == 1
                && windows.count <= 128 && Set(windows).count == windows.count && windows.allSatisfy { $0 > 0 })
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

// BEGIN AX FAILURE DIAGNOSTICS (pure Foundation values; never ready authority)
enum StartupAXDiagnosticStage: String, CaseIterable {
    case configuration, admission, initial_snapshot, trust, helper_identity
    case waiting_publication, deadline, configuration_integrity, snapshot, lifetime
    case app_window, owned_frame, ax_observation, closing_snapshot, closing_lifetime
    case closing_integrity, receipt_publication, parent_lost
}

enum StartupAXFailureDiagnostic {
    static func record(stage: StartupAXDiagnosticStage, error: Error, observed: UInt64,
                       sequence: UInt64, refusals: UInt64, binding: [String: String]) -> [String: Any] {
        let code: String
        switch error {
        case OwnershipError.invalid: code = "ownership_invalid"
        case is StartupEnvironmentRejection: code = "ownership_invalid"
        case OwnershipError.argumentsUnavailable: code = "ownership_arguments_unavailable"
        case is StartupProbeFailure: code = "process_probe_unavailable"
        case is DecodingError: code = "decoding_failure"
        case is CocoaError: code = "foundation_failure"
        default: code = "other"
        }
        var safe: [String: String] = [:]
        for (key, length) in [("source_sha", 40), ("test_source_sha", 40), ("harness_sha", 40),
                              ("configuration_sha256", 64), ("helper_sha256", 64)] {
            if let value = binding[key], value.utf8.count == length,
               value.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) {
                safe[key] = value
            }
        }
        return ["schema": "nac342-ax-failure-diagnostic-v1", "acceptance": false,
                "stage": stage.rawValue, "code": code, "clock_basis": "DispatchTime.uptimeNanoseconds",
                "observed_uptime_ns": String(observed), "sequence": String(sequence),
                "refusal_generation": String(refusals), "binding": safe]
    }

    static func emit(_ record: [String: Any], write: (Data) throws -> Void) {
        // Publication is best effort and cannot replace the original refusal.
        let data = (try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]))
            .flatMap { $0.count < 2048 ? $0 + Data([10]) : nil }
            ?? Data("AX companion failed; no acceptance\n".utf8)
        do { try write(data) } catch { /* Exit remains the original refusal. */ }
    }
}
// END AX FAILURE DIAGNOSTICS



@MainActor
enum StartupAXWitnessMode {
    static func main(_ configPath: String, _ caseDeadline: String) {
        var diagnosticStage = StartupAXDiagnosticStage.configuration
        var diagnosticBinding: [String: String] = [:]
        var sequence: UInt64 = 0, refusals: UInt64 = 0
        do {
            let bytes = try StartupAXPreflight.file(configPath, limit: 32768)
            let config = try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
            let declaration = try JSONDecoder().decode(StartupAXDeclaration.self,
                from: JSONSerialization.data(withJSONObject: config["ax_witness"] as Any))
            let digest = StartupAXPreflight.hash(bytes)
            diagnosticBinding = ["configuration_sha256": digest, "helper_sha256": declaration.helper_sha256]
            for key in ["source_sha", "test_source_sha", "harness_sha"] {
                diagnosticBinding[key] = config[key] as? String
            }
            diagnosticStage = .admission
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
            diagnosticStage = .initial_snapshot
            let initial = try StartupObserver.snapshot(config, resources: resources, known: &known)
            try StartupObserver.need((initial["nodes"] as! [[String: Any]]).isEmpty)
            diagnosticStage = .trust
            let trusted = AXIsProcessTrusted() // Once, plain API. Never prompt or options.
            try StartupObserver.need(trusted)
            diagnosticStage = .helper_identity
            let me = try process(getpid())
            let empty = StartupAXProcess(pid: 0, parent: 0, uid: Int32(getuid()), start_seconds: 0,
                start_microseconds: 0, executable: "")
            var target = empty, launch = 0.0, window = 0
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
                diagnosticStage = .closing_integrity
                try StartupObserver.need(resources.intact() && process(getpid()) == me
                    && StartupAXPreflight.hash(try StartupAXPreflight.file(binary, limit: 16 * 1024 * 1024)) == declaration.helper_sha256
                    && StartupAXPreflight.hash(try StartupAXPreflight.file(configPath, limit: 32768)) == digest)
                let ended = DispatchTime.now().uptimeNanoseconds
                try StartupObserver.need(ended >= began && ended < deadline)
                sequence += 1; refusals += 1
                diagnosticStage = .receipt_publication
                try StartupAXFiles.publish(receipt(state, began: began, ended: ended,
                    stage: "target_" + state), to: declaration.path)
                RunLoop.current.run(until: Date().addingTimeInterval(0.05))
                return true // Keep bounded custody alive until parent stop, no more AX/ready.
            }
            let start = DispatchTime.now().uptimeNanoseconds
            diagnosticStage = .waiting_publication
            try StartupAXFiles.publish(receipt("waiting", began: start, ended: start), to: declaration.path)
            while getppid() == declaration.owner_pid {
                if let stop = try? StartupAXFiles.read(declaration.path + ".stop"), stop == Data(declaration.nonce.utf8) { return }
                let began = DispatchTime.now().uptimeNanoseconds
                diagnosticStage = .deadline
                try StartupObserver.need(began < deadline)
                diagnosticStage = .configuration_integrity
                try StartupObserver.need(resources.intact() && process(getpid()) == me
                    && StartupAXPreflight.hash(try StartupAXPreflight.file(configPath, limit: 32768)) == digest)
                diagnosticStage = .snapshot
                let snapshot = try StartupObserver.snapshot(config, resources: resources, known: &known)
                let apps = (snapshot["nodes"] as! [[String: Any]]).filter { $0["kind"] as? String == "app" }
                try StartupObserver.need(apps.count <= 1)
                if target.pid == 0 && (apps.isEmpty || apps[0]["windows"] as? [Int] == []) {
                    RunLoop.current.run(until: Date().addingTimeInterval(0.05)); continue
                }
                diagnosticStage = .lifetime
                // Additional raw CG surfaces do not establish or defeat interaction
                // ownership. Canonical AX topology and a bound global point proof do.
                if target.pid != 0 { if try terminal(snapshot, began: began) { continue } }
                diagnosticStage = .app_window
                try StartupObserver.need(apps.count == 1)
                let app = apps[0], current = try decodedProcess(app)
                let windows = app["windows"] as? [Int] ?? []
                if target.pid == 0 {
                    try StartupObserver.need(windows.count == 1)
                    target = current; window = windows[0]
                    launch = (app["app_launch_epoch"] as! NSNumber).doubleValue
                }
                try StartupObserver.need(current == target && windows.filter { $0 == window }.count == 1)
                diagnosticStage = .owned_frame
                let frame = try ownedFrame(target.pid, window)
                var observed: StartupAXSurface?, stage: String?, failure: Data?
                var request: StartupAXInteractionRequest?
                do { request = try StartupAXInteractionRequest.read(declaration.path + ".request") }
                catch StartupAXReceiptError.missing { request = nil }
                if let pending = request, try StartupAXFiles.number(pending.entered_ns) >= began { request = nil }
                if let request {
                    try StartupObserver.need(request.nonce == declaration.nonce && request.configuration_sha256 == digest
                        && request.refusal_generation == String(refusals)
                        && StartupAXFiles.number(request.baseline_sequence) <= sequence
                        && StartupAXFiles.number(request.entered_ns) < began
                        && began < StartupAXFiles.number(request.deadline_ns)
                        && StartupAXFiles.number(request.deadline_ns) <= deadline)
                }
                diagnosticStage = .ax_observation
                do {
                    observed = try reader.observe(pid: target.pid, frame: frame)
                    if let request { observed?.interaction = try reader.interaction(request, pid: target.pid) }
                }
                catch { observed = nil; refusals += 1; stage = "ax_predicate_refused"; failure = reader.failureData }
                diagnosticStage = .closing_snapshot
                let closing = try StartupObserver.snapshot(config, resources: resources, known: &known)
                diagnosticStage = .closing_lifetime
                if try terminal(closing, began: began) { continue }
                diagnosticStage = .closing_integrity
                let latest = (closing["nodes"] as! [[String: Any]]).filter { $0["kind"] as? String == "app" }
                try StartupObserver.need(latest.count == 1 && decodedProcess(latest[0]) == target
                    && (latest[0]["windows"] as? [Int])?.filter { $0 == window }.count == 1
                    && (latest[0]["app_launch_epoch"] as? NSNumber)?.doubleValue == launch
                    && ownedFrame(target.pid, window) == frame
                    && resources.intact() && process(getpid()) == me
                    && StartupAXPreflight.hash(try StartupAXPreflight.file(binary, limit: 16 * 1024 * 1024)) == declaration.helper_sha256
                    && StartupAXPreflight.hash(try StartupAXPreflight.file(configPath, limit: 32768)) == digest)
                if let request, observed != nil {
                    // A second global hit must resolve to the SAME retained AX
                    // target after the resource/incarnation/frame bookend.
                    observed?.interaction = try reader.interaction(request, pid: target.pid)
                }
                sequence += 1
                let ended = DispatchTime.now().uptimeNanoseconds
                try StartupObserver.need(ended >= began && ended < deadline)
                if ended - began > 1_000_000_000 {
                    refusals += 1; observed = nil; stage = "sample_deadline"
                }
                diagnosticStage = .receipt_publication
                try StartupAXFiles.publish(receipt(observed == nil ? "refused" : "ready", began: began,
                    ended: ended, observed: observed, stage: stage, failure: failure), to: declaration.path)
                if let request {
                    // Keep the proof publication stable until final consumption.
                    // Metadata custody remains in its independent original owner.
                    try StartupObserver.need(observed?.interaction != nil)
                    while true {
                        if let stop = try? StartupAXFiles.read(declaration.path + ".stop"), stop == Data(declaration.nonce.utf8) { return }
                        let pending: StartupAXInteractionRequest
                        do { pending = try StartupAXInteractionRequest.read(declaration.path + ".request") }
                        catch StartupAXReceiptError.missing { break }
                        try StartupObserver.need(pending == request && getppid() == declaration.owner_pid
                            && DispatchTime.now().uptimeNanoseconds < StartupAXFiles.number(request.deadline_ns)
                            && resources.intact() && process(target.pid) == target && process(getpid()) == me
                            && StartupAXPreflight.hash(try StartupAXPreflight.file(binary, limit: 16 * 1024 * 1024)) == declaration.helper_sha256
                            && ownedFrame(target.pid, window) == frame
                            && StartupAXPreflight.hash(try StartupAXPreflight.file(configPath, limit: 32768)) == digest)
                        RunLoop.current.run(until: Date().addingTimeInterval(0.01))
                    }
                }
                RunLoop.current.run(until: Date().addingTimeInterval(0.05))
            }
            diagnosticStage = .parent_lost
            throw OwnershipError.invalid
        } catch {
            // Unexpected ownership/deadline/stream failure exits nonzero. The
            // parent invalidates/aborts the test and retains original ownership.
            let record = StartupAXFailureDiagnostic.record(stage: diagnosticStage, error: error,
                observed: DispatchTime.now().uptimeNanoseconds, sequence: sequence, refusals: refusals,
                binding: diagnosticBinding)
            StartupAXFailureDiagnostic.emit(record, write: { try FileHandle.standardError.write(contentsOf: $0) })
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
