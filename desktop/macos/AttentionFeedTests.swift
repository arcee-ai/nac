import Foundation

@main
struct AttentionFeedTests {
    static let engine = UUID(uuidString: "10000000-0000-0000-0000-000000000001")!
    static let epoch = "20000000-0000-0000-0000-000000000002"
    static let sourceEpoch = "30000000-0000-0000-0000-000000000003"
    static func availability(_ work: String = "available", _ decision: String = "available") -> [String: Any] {
        ["work": work, "questions": decision, "permissions": decision, "reviews": decision, "topology": "available"]
    }
    static func source(_ id: String = "session", _ epoch: String = sourceEpoch) -> [String: Any] {
        ["session_id": id, "epoch": epoch]
    }
    static func cursor(_ sequence: UInt64) -> [String: Any] {
        ["engine": engine.uuidString.lowercased(), "epoch": epoch, "sequence": sequence]
    }
    static func snapshot(_ id: String = "session", pending: [[String: Any]] = [], work: Any = NSNull(),
                         facets: [String: Any] = availability(), revision: UInt64 = 0) -> [String: Any] {
        ["source": source(id), "revision": revision, "work": work, "pending": pending, "availability": facets]
    }
    static func baseline(_ snapshots: [[String: Any]]? = nil, sequence: UInt64 = 0) -> [String: Any] {
        ["kind": "baseline", "boundary": cursor(sequence), "sources": snapshots ?? [snapshot()], "reset": NSNull()]
    }
    static func record(_ sequence: UInt64, revision: UInt64? = nil, _ change: [String: Any], fresh: Bool = false,
                       from: [String: Any] = source()) -> [String: Any] {
        ["kind": "record", "boundary": cursor(sequence), "source": from,
         "source_revision": revision ?? sequence, "change": change, "new_attention": fresh]
    }
    static func permission(_ id: String = "ask") -> [String: Any] { ["kind": "permission", "request_id": id] }
    static func question(_ revision: UInt64 = 1) -> [String: Any] {
        ["kind": "question", "request_id": "choice", "run_id": "actual-run", "generation": "actual-generation", "revision": revision]
    }
    static func work(_ run: String = "actual-run", _ disposition: String = "completed") -> [String: Any] {
        ["run_id": run, "goal": NSNull(), "disposition": disposition]
    }
    static func decode(_ object: [String: Any]) throws -> AttentionWire.Frame {
        let result = try JSONDecoder().decode(AttentionWire.Frame.self, from: JSONSerialization.data(withJSONObject: object))
        try AttentionWire.validate(result)
        return result
    }
    static func sse(_ object: [String: Any], separator: String = "\n", multiline: Bool = false) throws -> Data {
        var text = String(decoding: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), as: UTF8.self)
        if multiline { text = String(text.prefix(1)) + separator + "data: " + text.dropFirst() }
        let boundary = object["boundary"] as? [String: Any]
        let id = boundary.map { "id: \($0["engine"]!):\($0["epoch"]!):\($0["sequence"]!)" + separator } ?? ""
        return Data((": bounded comment" + separator + "event: attention" + separator + id + "data: " + text + separator + separator).utf8)
    }
    static func check(_ condition: Bool) { precondition(condition) }
    static func rejects(_ operation: () throws -> Void) {
        do { try operation(); preconditionFailure("Invalid input was accepted") } catch { }
    }
    static func main() throws {
        if !(try silentPendingCapacityF1()) { exit(1) }
        try arbitraryByteBoundaries()
        try exactIntegerAndNullableSchema()
        try semanticDecisionsAndReplay()
        try completionPublicationOrder()
        try sourceAndGenerationBoundaries()
        try boundsAndMalformedFrames()
        try maximumWriterEnvelope()
        disabledLifetime()
        print("{\"suite\":\"attention-feed\",\"scenarios\":9,\"result\":\"passed\",\"actual_http\":false,\"native_os_delivery\":false}")
    }
    static func silentPendingCapacityF1() throws -> Bool {
        var projection = AttentionProjection()
        _ = try projection.accept(decode(baseline()), engine: engine)
        for index in 1...AttentionWire.identities {
            let review = ["kind": "review", "review_id": String(format: "r%04d", index)]
            check(try projection.accept(decode(record(UInt64(index),
                ["kind": "decision_pending", "decision": review], fresh: false)), engine: engine).isEmpty)
        }
        let countAtLimit = projection.identities
        let pendingAtLimit = projection.pending
        let metadataAtLimit = projection.metadataBytes
        var rejected = false
        do {
            _ = try projection.accept(decode(record(1025,
                ["kind": "decision_pending", "decision": ["kind": "review", "review_id": "r1025"]],
                fresh: false)), engine: engine)
        } catch AttentionFeedError.capacity { rejected = true }
        // This is defensive projection coverage for faulted/out-of-contract
        // input. The actual Rust producer independently caps these identities.
        guard countAtLimit == 1024, pendingAtLimit == 1024, rejected else {
            let message = "F1: identitiesAtLimit=\(countAtLimit), pendingAtLimit=\(pendingAtLimit), metadataAtLimit=\(metadataAtLimit), rejected1025=\(rejected), pendingAfter=\(projection.pending)\n"
            FileHandle.standardError.write(Data(message.utf8))
            return false
        }
        check(metadataAtLimit < AttentionWire.metadataBytes / 10)

        var same = AttentionProjection()
        _ = try same.accept(decode(baseline()), engine: engine)
        let review = ["kind": "review", "review_id": "r0001"]
        for sequence: UInt64 in 1...2 {
            check(try same.accept(decode(record(sequence, ["kind": "decision_pending", "decision": review])), engine: engine).isEmpty)
            check(same.identities == 1 && same.pending == 1)
        }
        check(try same.accept(decode(record(3, ["kind": "decision_resolved", "decision": review])), engine: engine).isEmpty)
        check(same.identities == 1 && same.pending == 0)
        check(try same.accept(decode(record(4, ["kind": "decision_pending", "decision": review])), engine: engine).isEmpty)
        check(same.identities == 1 && same.pending == 1)
        for revision: UInt64 in 1...2 {
            check(try same.accept(decode(record(revision + 4,
                ["kind": "decision_pending", "decision": question(revision)])), engine: engine).isEmpty)
            check(same.identities == 2 && same.pending == 2)
        }
        let nextEpoch = "40000000-0000-0000-0000-000000000004"
        var replacement = snapshot(pending: [review, question(2)], facets: availability("unknown", "unknown"))
        replacement["source"] = source("session", nextEpoch)
        check(try same.accept(decode(record(7, revision: 0, ["kind": "source_replaced", "snapshot": replacement],
            from: source("session", nextEpoch))), engine: engine).isEmpty)
        check(same.identities == 2 && same.pending == 2)
        check(try same.accept(decode(record(8, revision: 1, ["kind": "decision_pending", "decision": review],
            from: source("session", nextEpoch))), engine: engine).isEmpty)
        check(same.identities == 2 && same.pending == 2)
        return true
    }
    static func arbitraryByteBoundaries() throws {
        let first = baseline([snapshot("session-🌳")])
        let second = record(1, ["kind": "decision_pending", "decision": permission("opaque:问")], fresh: true,
                            from: source("session-🌳"))
        for separator in ["\n", "\r", "\r\n"] {
            let bytes = try sse(first, separator: separator, multiline: true) + sse(second, separator: separator)
            for split in 0...bytes.count {
                var parser = AttentionSSEParser()
                var result: [AttentionWire.Frame] = []
                try parser.append(bytes.prefix(split)) { result.append($0) }
                try parser.append(bytes.dropFirst(split)) { result.append($0) }
                check(result == [try decode(first), try decode(second)])
                check(parser.retainedBytes == 0)
            }
        }
    }
    static func exactIntegerAndNullableSchema() throws {
        let large: UInt64 = 9_007_199_254_740_993
        let frame = try decode(baseline(sequence: large))
        check(frame.boundary?.sequence == large)
        var projection = AttentionProjection()
        check(try projection.accept(frame, engine: engine).isEmpty)
        let next = try decode(record(large + 1, revision: 1, ["kind": "checkpoint"]))
        check(try projection.accept(next, engine: engine).isEmpty)
        var missing = baseline()
        missing.removeValue(forKey: "reset")
        rejects { _ = try decode(missing) }
        var negative = baseline()
        negative["boundary"] = ["engine": engine.uuidString, "epoch": epoch, "sequence": -1]
        rejects { _ = try decode(negative) }
        var absentGoal = work()
        absentGoal.removeValue(forKey: "goal")
        rejects { _ = try decode(record(1, ["kind": "work_settled", "work": absentGoal])) }
        var absentWork = snapshot()
        absentWork.removeValue(forKey: "work")
        rejects { _ = try decode(baseline([absentWork])) }
        let ids = [permission(), ["kind": "review", "review_id": "review"], question()]
        if case .baseline(_, let values, _) = try decode(baseline([snapshot(pending: ids)])) {
            check(values[0].pending.count == 3)
            check(values[0].pending[0].key != values[0].pending[1].key)
        } else { preconditionFailure() }
    }
    static func semanticDecisionsAndReplay() throws {
        var projection = AttentionProjection()
        check(try projection.accept(decode(baseline([snapshot(pending: [permission("old")])])), engine: engine).isEmpty)
        let ask = try decode(record(1, ["kind": "decision_pending", "decision": permission()], fresh: true))
        let effect = try projection.accept(ask, engine: engine)
        check(effect.count == 1 && effect[0].kind == "permission")
        check(try projection.accept(ask, engine: engine).isEmpty)
        check(try projection.accept(decode(record(2, ["kind": "decision_resolved", "decision": permission()])), engine: engine).isEmpty)
        check(!projection.isCurrent(effect[0].key, kind: "permission"))
        check(try projection.accept(decode(record(3, ["kind": "decision_pending", "decision": permission()], fresh: false)), engine: engine).isEmpty)
        check(projection.isCurrent(effect[0].key, kind: "permission"))
        let q = try projection.accept(decode(record(4, ["kind": "decision_pending", "decision": question()], fresh: true)), engine: engine)
        check(q.count == 1 && q[0].kind == "question")
        check(try projection.accept(decode(record(5, ["kind": "decision_pending", "decision": question(2)])), engine: engine).isEmpty)
        check(projection.pending == 3)
        check(projection.identities == 3)
        rejects { _ = try projection.accept(decode(record(6, ["kind": "decision_pending", "decision": question(1)])), engine: engine) }
        rejects { _ = try projection.accept(decode(record(7, ["kind": "checkpoint"])), engine: engine) }
    }
    static func completionPublicationOrder() throws {
        var projection = AttentionProjection()
        _ = try projection.accept(decode(baseline([snapshot(facets: availability("unknown"))])), engine: engine)
        check(try projection.accept(decode(record(1, ["kind": "work_settled", "work": work("A", "continuing")])), engine: engine).isEmpty)
        check(try projection.accept(decode(record(2, ["kind": "work_settled", "work": work("B", "continuing")])), engine: engine).isEmpty)
        let completed = try decode(record(3, ["kind": "work_settled", "work": work("C")], fresh: true))
        check(try projection.accept(completed, engine: engine).isEmpty)
        let result = try projection.accept(decode(record(4, ["kind": "availability", "availability": availability()])), engine: engine)
        check(result.count == 1 && result[0].kind == "completed")
        check(try projection.accept(decode(record(5, ["kind": "work_settled", "work": work("C")], fresh: true)), engine: engine).isEmpty)
        check(try projection.accept(decode(record(6, ["kind": "work_cleared"])), engine: engine).isEmpty)
        check(!projection.isCurrent(result[0].key, kind: "completed"))
        var unknown = AttentionProjection()
        _ = try unknown.accept(decode(baseline([snapshot(facets: availability("unknown", "unknown"))])), engine: engine)
        check(try unknown.accept(completedWithSequence(1), engine: engine).isEmpty)
        check(try unknown.accept(decode(record(2, ["kind": "work_cleared"])), engine: engine).isEmpty)
        check(try unknown.accept(decode(record(3, ["kind": "availability", "availability": availability()])), engine: engine).isEmpty)
        var unsupported = AttentionProjection()
        _ = try unsupported.accept(decode(baseline([snapshot(facets: availability("unsupported"))])), engine: engine)
        check(try unsupported.accept(completedWithSequence(1), engine: engine).isEmpty)
        var pending = AttentionProjection()
        _ = try pending.accept(decode(baseline([snapshot(pending: [permission()])])), engine: engine)
        rejects { _ = try pending.accept(completedWithSequence(1), engine: engine) }
    }
    static func completedWithSequence(_ sequence: UInt64) throws -> AttentionWire.Frame {
        try decode(record(sequence, ["kind": "work_settled", "work": work()], fresh: true))
    }
    static func sourceAndGenerationBoundaries() throws {
        var projection = AttentionProjection()
        _ = try projection.accept(decode(baseline()), engine: engine)
        let changedEpoch = "40000000-0000-0000-0000-000000000004"
        var replacement = snapshot(pending: [permission()], facets: availability("unknown", "unknown"))
        replacement["source"] = source("session", changedEpoch)
        check(try projection.accept(decode(record(1, revision: 0, ["kind": "source_replaced", "snapshot": replacement], from: source("session", changedEpoch))), engine: engine).isEmpty)
        check(projection.pending == 1) // Unknown membership is not resolution.
        rejects { _ = try projection.accept(decode(record(2, revision: 1, ["kind": "checkpoint"])), engine: engine) }
        var foreign = baseline()
        foreign["boundary"] = ["engine": UUID().uuidString, "epoch": epoch, "sequence": 0]
        var other = AttentionProjection()
        rejects { _ = try other.accept(decode(foreign), engine: engine) }
        let reset = try decode(["kind": "reset", "reason": "replay_gap"])
        rejects { _ = try other.accept(reset, engine: engine) }
        // A NEW HTTP generation receives a NEW silent baseline. Historical
        // completion/pending state is not reconstructed into missed notices.
        var fresh = AttentionProjection()
        check(try fresh.accept(decode(baseline([snapshot(pending: [permission()], work: work())], sequence: 10)), engine: engine).isEmpty)
        check(try fresh.accept(completedWithSequence(1), engine: engine).isEmpty)
        check(try fresh.accept(decode(record(11, revision: 1, ["kind": "checkpoint"])), engine: engine).isEmpty)
    }
    static func boundsAndMalformedFrames() throws {
        var invalid = permission()
        invalid["request_id"] = String(repeating: "x", count: 513)
        rejects { _ = try decode(record(1, ["kind": "decision_pending", "decision": invalid], fresh: true)) }
        rejects { _ = try decode(baseline([snapshot(), snapshot()])) }
        rejects { _ = try decode(baseline([snapshot(pending: [permission(), permission()])])) }
        rejects { _ = try decode(baseline((0...AttentionWire.sources).map { snapshot("s\($0)") })) }
        for bytes in [Data([0xFF, 10]), Data("event: attention_unavailable\ndata: serialization\n\n".utf8),
                      Data("event: attention\nid: wrong\ndata: {}\n\n".utf8)] {
            rejects { var parser = AttentionSSEParser(); try parser.append(bytes) { _ in } }
        }
        rejects {
            var parser = AttentionSSEParser()
            try parser.append(Data(repeating: 120, count: AttentionWire.eventBytes + 1)) { _ in }
        }
        let good = try sse(baseline())
        let duplicate = Data("event: attention\nid: duplicate\n".utf8) + good
        rejects { var parser = AttentionSSEParser(); try parser.append(duplicate) { _ in } }
    }
    static func maximumWriterEnvelope() throws {
        // 1024 distinct sources and decisions, opaque IDs with worst JSON
        // control-character escaping, within actual SourceState metrics.
        let values = (0..<1024).map { index -> [String: Any] in
            let suffix = String(index)
            let id = "s" + String(repeating: "\u{01}", count: 127 - suffix.utf8.count) + suffix
            let request = "r" + String(repeating: "\u{01}", count: 511)
            return snapshot(id, pending: [permission(request)])
        }
        let object = baseline(values)
        let bytes = try sse(object)
        check(bytes.count > 4 * 1024 * 1024 && bytes.count < AttentionWire.eventBytes)
        var parser = AttentionSSEParser()
        var projection = AttentionProjection()
        var count = 0
        try parser.append(bytes) { frame in
            check(try projection.accept(frame, engine: engine).isEmpty)
            count += 1
        }
        check(count == 1 && parser.retainedBytes == 0)
        check(projection.sources.count == 1024 && projection.pending == 1024 && projection.identities == 1024)
        check(projection.metadataBytes == 836_608)
    }
    static func disabledLifetime() {
        let observer = NativeAttentionObserver()
        observer.bind(.init(profile: UUID(), engine: engine, endpoint: URL(string: "http://127.0.0.1:9")!))
        check(observer.status().phase == "disabled" && observer.status().tasks == 0)
        observer.retire()
        observer.retire()
        let status = observer.status()
        check(status.phase == "retired" && status.sources == 0 && status.identities == 0
                     && status.tasks == 0 && status.retries == 0 && status.drainingSessions == 0 && status.bytes == 0)
    }
}
