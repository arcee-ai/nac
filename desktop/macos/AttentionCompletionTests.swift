import Foundation

/// Foundation contract only. System WK and OS display are separate evidence.
@main
enum AttentionCompletionTests {
    static func page(_ sequence: Int, baseline: Bool = false) -> [String: Any] {
        ["kind": "completions", "page": ["store_id": "10000000-0000-0000-0000-000000000001",
            "cursor": sequence, "high_water": sequence, "baseline": baseline, "more": false,
            "items": baseline ? [] : [["sequence": sequence, "session_id": "session", "run_id": "run",
                "behavior": "direct", "kind": "request", "goal_id": NSNull(), "mark_version": NSNull()]]]]
    }
    static func decode(_ object: [String: Any]) throws -> AttentionWire.Frame {
        let frame = try JSONDecoder().decode(AttentionWire.Frame.self, from: JSONSerialization.data(withJSONObject: object))
        try AttentionWire.validate(frame)
        return frame
    }
    static func rejects(_ object: [String: Any]) {
        do { _ = try decode(object); preconditionFailure("Malformed completion accepted") } catch { }
    }
    static func main() throws {
        _ = try decode(page(0, baseline: true))
        _ = try decode(page(300))
        for field in ["cursor", "high_water"] {
            var bad = page(1); var value = bad["page"] as! [String: Any]; value[field] = -1; bad["page"] = value; rejects(bad)
        }
        var bad = page(1); var value = bad["page"] as! [String: Any]; value["command"] = "resume"; bad["page"] = value; rejects(bad)
        bad = page(1); value = bad["page"] as! [String: Any]; value["baseline"] = true; bad["page"] = value; rejects(bad)
        var parser = AttentionSSEParser()
        func bytes(_ n: Int) throws -> Data {
            var data = Data("event: attention\r\ndata: ".utf8)
            data.append(try JSONSerialization.data(withJSONObject: page(n)))
            data.append(Data("\r\n\r\n".utf8)); return data
        }
        let first = try bytes(1), second = try bytes(2)
        var joined = first; joined.append(second)
        var sequences: [Int64] = []
        let tail = try parser.consume(joined) { frame in
            if case .completions(let page) = frame { sequences.append(page.cursor) }
            return false // native durable accounting owns this one page
        }
        precondition(sequences == [1] && !tail.isEmpty)
        let empty = try parser.consume(tail) { frame in
            if case .completions(let page) = frame { sequences.append(page.cursor) }
            return true
        }
        precondition(sequences == [1, 2] && empty.isEmpty)
        print("Completion parser validates historical pages and preserves backpressure tails; no OS/WK claim.")
    }
}
