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
        let ownerPort = CallbackDiagnosticSubscriptionPort()
        var factoryCalls = 0
        let make: (Bool) -> ((Data) -> Void) = { _ in factoryCalls += 1; return { _ in } }
        check(ownerPort.observeExternalAuthDiagnostics(incarnation: "first", makeConsumer: make) == nil)
        var firstRun: CallbackDiagnosticReadPort? = CallbackDiagnosticReadPort()
        weak var oldRun = firstRun
        ownerPort.run = firstRun
        check(ownerPort.observeExternalAuthDiagnostics(incarnation: "first", makeConsumer: make) == nil)
        firstRun!.receipt = CallbackDiagnosticReady(incarnation: "first")
        check(ownerPort.observeExternalAuthDiagnostics(incarnation: "wrong", makeConsumer: make) == nil)
        check(factoryCalls == 0, "invalid owner invoked factory")
        firstRun!.receive(Data([0xe2]))
        var initialBoundary: Bool?
        let initialDetach = ownerPort.observeExternalAuthDiagnostics(incarnation: "first", makeConsumer: { boundary in
            initialBoundary = boundary; factoryCalls += 1; return { _ in }
        })!
        check(initialBoundary == false && factoryCalls == 1)
        let initialToken = firstRun!.authDiagnosticConsumer!.0
        check(ownerPort.observeExternalAuthDiagnostics(incarnation: "first", makeConsumer: make) == nil)
        check(firstRun!.authDiagnosticConsumer!.0 == initialToken && factoryCalls == 1)
        initialDetach()
        check(firstRun!.authDiagnosticConsumer == nil)
        let replacementDetach = ownerPort.observeExternalAuthDiagnostics(incarnation: "first", makeConsumer: make)!
        let replacementToken = firstRun!.authDiagnosticConsumer!.0
        check(replacementToken != initialToken)
        initialDetach()
        check(firstRun!.authDiagnosticConsumer!.0 == replacementToken, "stale token cleared new subscription")
        let successor = CallbackDiagnosticReadPort()
        successor.receipt = CallbackDiagnosticReady(incarnation: "successor")
        ownerPort.run = successor
        let successorDetach = ownerPort.observeExternalAuthDiagnostics(incarnation: "successor", makeConsumer: make)!
        let successorToken = successor.authDiagnosticConsumer!.0
        replacementDetach()
        check(firstRun!.authDiagnosticConsumer == nil)
        check(successor.authDiagnosticConsumer!.0 == successorToken, "old run detach cleared successor")
        firstRun = nil
        check(oldRun == nil, "detach retained original run")
        replacementDetach(); initialDetach()
        check(successor.authDiagnosticConsumer!.0 == successorToken)
        successorDetach()
        check(successor.authDiagnosticConsumer == nil)
        print("GREEN actual subscription: ready incarnation, exclusive factory, UUID replacement, weak original-run detach")

        // Exact old diagnostic-tail behavior, supplied no subscriber. A burst
        // before the first post-click ingest can evict a valid one-shot positive.
        let noise = Data((String(repeating: "diagnostic noise ", count: 400) + "\n").utf8)
        let oldRead = CallbackDiagnosticReadPort()
        oldRead.receive(Data((start + live).utf8))
        for _ in 0..<40 { oldRead.receive(noise) }
        var lost = witness()
        try lost.ingest(oldRead.log)
        check(try lost.newOwner(after: []) == nil, "old bounded-tail counterexample lost")
        print("RED actual read-tail branch: valid listener/accounting evicted before delayed poll")
        let read = CallbackDiagnosticReadPort()
        let captured = ExternalAuthCallbackCapture(witness: witness(),
            atRecordBoundary: read.authDiagnosticAtRecordBoundary)
        read.authDiagnosticConsumer = (UUID(), { captured.receive($0) })
        let bytes = Data((start + live).utf8)
        read.receive(bytes.prefix(17))
        check(try captured.snapshot().newOwner(after: []) == nil, "partial row qualified")
        read.receive(bytes.dropFirst(17))
        for _ in 0..<40 { read.receive(noise) }
        check(try captured.snapshot().newOwner(after: []) == 7, "positive lost before delayed poll")
        check(try captured.snapshot().liveAccounting != nil, "matching live accounting not retained")
        read.receive(Data(reject.utf8))
        for _ in 0..<40 { read.receive(noise) }
        check(try captured.snapshot().rejection(owner: 7, baseline: []))
        check((try captured.snapshot().proof(owner: 7)["observations"] as? [Any])?.count == 2)
        // Subscribe between chunks of an unrelated EURO SIGN record. The old
        // String(decoding:) log has replacement text and no terminal LF; raw
        // continuation bytes must be discarded, not decoded as a complete row.
        let midRecord = CallbackDiagnosticReadPort()
        midRecord.receive(Data([0xe2]))
        check(!midRecord.authDiagnosticAtRecordBoundary)
        let aligned = ExternalAuthCallbackCapture(witness: witness(),
            atRecordBoundary: midRecord.authDiagnosticAtRecordBoundary)
        midRecord.authDiagnosticConsumer = (UUID(), { aligned.receive($0) })
        midRecord.receive(Data([0x82]))
        check(try aligned.snapshot().newOwner(after: []) == nil)
        midRecord.receive(Data([0xac, 10]) + Data((start + live).utf8))
        check(try aligned.snapshot().newOwner(after: []) == 7,
            "first complete post-fragment Listening was discarded")
        let boundary = CallbackDiagnosticReadPort()
        boundary.receive(Data("unrelated complete record\n".utf8))
        check(boundary.authDiagnosticAtRecordBoundary)
        let first = ExternalAuthCallbackCapture(witness: witness(),
            atRecordBoundary: boundary.authDiagnosticAtRecordBoundary)
        boundary.authDiagnosticConsumer = (UUID(), { first.receive($0) })
        boundary.receive(Data((start + live).utf8))
        check(try first.snapshot().newOwner(after: []) == 7,
            "at-boundary subscription discarded first Listening")
        let duplicate = ExternalAuthCallbackCapture(witness: witness(), atRecordBoundary: true)
        duplicate.receive(Data((start + start + live).utf8))
        refuses { _ = try duplicate.snapshot() }
        let overflow = ExternalAuthCallbackCapture(witness: witness(), atRecordBoundary: true)
        overflow.receive(Data(repeating: 120, count: 65_537))
        overflow.receive(Data((start + live).utf8))
        refuses { _ = try overflow.snapshot() }
        let invalid = ExternalAuthCallbackCapture(witness: witness(), atRecordBoundary: true)
        invalid.receive(Data([0xff, 10]))
        refuses { _ = try invalid.snapshot() }
        let noArrival = ExternalAuthCallbackCapture(witness: witness(), atRecordBoundary: true)
        noArrival.receive(noise)
        check(try noArrival.snapshot().newOwner(after: []) == nil)
        for key in ["source_revision", "build_id", "scenario"] {
            var bad = event("state_rejected"); var r = runtime; r[key] = "wrong"; bad["runtime"] = r
            let stream = ExternalAuthCallbackCapture(witness: witness(), atRecordBoundary: true)
            stream.receive(Data((start + live + (try line(bad))).utf8))
            refuses { _ = try stream.snapshot() }
        }
        for field in ["process_id", "recorder_id", "final_receipt"] {
            var bad = receipt()
            if field == "process_id" { bad[field] = 102 }
            if field == "recorder_id" { bad[field] = "00000000-0000-0000-0000-000000000002" }
            if field == "final_receipt" { bad[field] = true }
            let stream = ExternalAuthCallbackCapture(witness: witness(), atRecordBoundary: true)
            stream.receive(Data((start + (try line(bad, accounting: true)) + live).utf8))
            refuses { _ = try stream.snapshot() }
        }
        let malformed = ExternalAuthCallbackCapture(witness: witness(), atRecordBoundary: true)
        malformed.receive(Data(("nac-telemetry malformed\n" + start + live).utf8))
        refuses { _ = try malformed.snapshot() }
        let tooMany = ExternalAuthCallbackCapture(witness: witness(), atRecordBoundary: true)
        for owner in 1...5 { tooMany.receive(Data(try line(event("listening", owner: owner)).utf8)) }
        refuses { _ = try tooMany.snapshot() }
        print("GREEN draft: exact read seam captures bounded positives before tail trim; chunk/overflow/duplicate/no-arrival fail closed")

        print("GREEN actual condition/parser: barrier ordering, no-arrival, identity, replay, partial, malformed, privacy and eviction controls")
    }
}
