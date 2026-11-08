// Appended to the actual Foundation-only witness and original switch arm by the bounded driver.
import Foundation
import CoreFoundation

@MainActor
final class LegacyAuthPort {
    var canceled = false
    var results: [String: Any] = [:]
    func oauthStatus(_ value: String) async throws {}
    func clickButton(_ title: String) async throws { if title == "Cancel authorization" { canceled = true } }
    // Frozen original6a7f switch arm, compiled with inert UI ports.
    func runOriginal() async throws { let mode = "wrong-state";
                try await oauthStatus("Waiting for authorization")
                try await clickButton("Cancel authorization")
                try await oauthStatus("Ready to connect")
                results[mode == "wrong-state" ? "wrong_state_rejected_then_canceled" : "pending_authorization_canceled"] = true

    }
}

@main
struct CallbackWitnessControls {
    static let source = String(repeating: "a", count: 40)
    static let build = "inert-dev"
    static let recorder = "00000000-0000-0000-0000-000000000001"
    static var runtime: [String: Any] { ["source_revision": source, "build_id": build,
        "schema_version": 50, "scenario": "native-external-auth", "store_engine": "sqlite", "journal_mode": "wal"] }
    static func event(_ name: String, owner: Int = 7) -> [String: Any] {
        ["timestamp_unix_ms": 1, "export_recorder_id": recorder, "name": "nac.mcp.oauth.callback." + name,
         "kind": "diagnostic", "outcome": name == "listening" ? "started" : "error",
         "correlation": ["generation": owner], "runtime": runtime]
    }
    static func receipt() -> [String: Any] { ["timestamp_unix_ms": 2, "recorder_id": recorder,
        "process_id": 101, "final_receipt": false, "capacity": 1024, "receipt_failures": 0,
        "stats": ["accepted": 2, "exported": 2, "dropped": 0, "failures": 0], "runtime": runtime] }
    static func line(_ row: [String: Any], accounting: Bool = false) throws -> String {
        (accounting ? "nac-telemetry-export " : "nac-telemetry ") + String(decoding:
            try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]), as: UTF8.self) + "\n"
    }
    static func witness() -> ExternalAuthCallbackWitness {
        ExternalAuthCallbackWitness(source: source, build: build, schema: 50, pid: 101)
    }
    static func check(_ condition: Bool, _ message: String = "control failed") { precondition(condition, message) }
    static func refuses(_ operation: () throws -> Void) {
        do { try operation(); fatalError("negative accepted") } catch {}
    }

    @MainActor static func main() async throws {
        let legacy = LegacyAuthPort()
        try await legacy.runOriginal()
        check(legacy.canceled, "original arm no longer reproduces premature Cancel")
        print("RED witnessed: actual original arm cancels with page/Waiting and no callback")
        let start = try line(event("listening"))
        let reject = try line(event("state_rejected"))
        let live = try line(receipt(), accounting: true)
        var observed = witness()
        try observed.ingest(start + live)
        check(try observed.newOwner(after: []) == 7)
        check(try !observed.rejection(owner: 7, baseline: []))
        var release: CheckedContinuation<Void, Never>?
        var entered = false, canceled = false, waiting = false
        let task = Task { @MainActor in
            try await ExternalAuthCallbackWitness.rejectThenCancel(rejection: {
                await withCheckedContinuation { release = $0; entered = true }
                check(try observed.rejection(owner: 7, baseline: []))
            }, waiting: { waiting = true }, cancel: { canceled = true }, settled: {})
        }
        while !entered { await Task.yield() }
        check(!waiting && !canceled, "Cancel raced the withheld callback")
        try observed.ingest(start + reject + live)
        release!.resume()
        try await task.value
        check(waiting && canceled)
        let proof = try observed.proof(owner: 7)
        check((proof["observations"] as? [Any])?.count == 2)
        // Positive rows survive tail eviction and repeated reads, without inventing a new row.
        try observed.ingest(live)
        check(try observed.rejection(owner: 7, baseline: []))
        for key in ["source_revision", "build_id", "scenario"] {
            var bad = event("state_rejected"); var r = runtime; r[key] = "wrong"; bad["runtime"] = r
            refuses { var w = witness(); try w.ingest(start + line(bad) + live) }
        }
        for key in ["code", "state", "token", "server", "store"] {
            var bad = event("state_rejected"); bad[key] = "secret-canary"
            refuses { var w = witness(); try w.ingest(start + line(bad) + live) }
        }
        refuses { var w = witness(); try w.ingest(reject + live) }
        refuses { var w = witness(); try w.ingest(start + reject + reject + live) }
        refuses { var w = witness(); try w.ingest(start + live); try w.ingest(line(event("listening", owner: 8)) + live); _ = try w.rejection(owner: 7, baseline: []) }
        refuses { var w = witness(); var r = receipt(); r["process_id"] = 102; try w.ingest(start + line(r, accounting: true)) }
        refuses { var w = witness(); var r = receipt(); r["final_receipt"] = 0; try w.ingest(start + line(r, accounting: true)) }
        refuses { var w = witness(); var r = receipt(); r["recorder_id"] = "00000000-0000-0000-0000-000000000002"; try w.ingest(start + line(r, accounting: true)) }
        refuses { var w = witness(); try w.ingest(start + "nac-telemetry malformed\n" + live) }
        var partial = witness(); try partial.ingest(start + live + String(reject.dropLast()))
        check(try !partial.rejection(owner: 7, baseline: []))
        var unavailable = witness(); try unavailable.ingest("")
        check(try unavailable.newOwner(after: []) == nil)
        var cancelCount = 0
        do {
            try await ExternalAuthCallbackWitness.rejectThenCancel(rejection: { throw ExternalAuthCallbackWitness.Refusal.invalid },
                waiting: {}, cancel: { cancelCount += 1 }, settled: {})
        } catch {}
        check(cancelCount == 0)
        print("GREEN actual condition/parser: barrier ordering, no-arrival, identity, replay, partial, malformed, privacy and eviction controls")
    }
}
