import Foundation

/// Pure projection-to-indicator characterization. No app/OS execution evidence.
@main
enum NativeAttentionIndicatorTests {
    static let engine = UUID(uuidString: "10000000-0000-0000-0000-000000000001")!
    static func frame(resolved: Bool = false) throws -> AttentionWire.Frame {
        let source: [String: Any] = ["session_id": "session", "epoch": "30000000-0000-0000-0000-000000000003"]
        let boundary: [String: Any] = ["engine": engine.uuidString, "epoch": "20000000-0000-0000-0000-000000000002", "sequence": resolved ? 1 : 0]
        let decision = ["kind": "permission", "request_id": "same-unresolved-decision"]
        let value: [String: Any]
        if resolved {
            value = ["kind": "record", "boundary": boundary, "source": source, "source_revision": 1,
                "change": ["kind": "decision_resolved", "decision": decision], "new_attention": false]
        } else {
            value = ["kind": "baseline", "boundary": boundary, "reset": NSNull(), "sources": [
                ["source": source, "revision": 0, "work": NSNull(), "pending": [decision],
                 "availability": ["work": "available", "questions": "available", "permissions": "available",
                                  "reviews": "available", "topology": "available"]]]]
        }
        return try JSONDecoder().decode(AttentionWire.Frame.self, from: JSONSerialization.data(withJSONObject: value))
    }
    static func status(_ phase: String, _ projection: AttentionProjection) -> NativeAttentionObserver.Status {
        .init(phase: phase, generation: 1, tasks: 1, retries: 0, drainingSessions: 0,
              sources: projection.sources.count, identities: projection.identities, pending: projection.pending, bytes: 0,
              sequence: projection.boundary?.sequence, projectionEpoch: projection.boundary?.epoch,
              deliveryAcknowledgments: 0, deliveryFailures: 0, unknownDecisionSessions: [])
    }
    static func main() throws {
        for mode in ["allowed", "muted", "denied"] {
            var policy = NativeAttentionObserver.Policy()
            policy.optedIn = true; policy.authorized = mode != "denied"; policy.muted = mode == "muted"
            var projection = AttentionProjection()
            _ = try projection.accept(frame(), engine: engine)
            var transitions = [status("observing", projection)]
            projection = AttentionProjection() // same reset as transport cancellation, never a resolution
            transitions += [status("unavailable", projection), status("connecting", projection),
                status("observing", projection)] // semantic-page ACK without current-state baseline
            _ = try projection.accept(frame(), engine: engine)
            transitions += [status("accounting", projection), status("observing", projection)]
            _ = try projection.accept(frame(resolved: true), engine: engine)
            transitions.append(status("observing", projection))
            let labels = transitions.map {
                NativeAttentionIndicator.badge(enabled: policy.optedIn, unread: 0,
                    pending: $0.projectionAvailable ? $0.pending : nil)
            }
            precondition(labels == ["1", "?", "?", "?", "1", "1", nil])
            precondition(NativeAttentionIndicator.badge(enabled: true, unread: 4, pending: nil) == "4+?")
            precondition(NativeAttentionIndicator.badge(enabled: true, unread: 4, pending: 0) == "4")
        }
        precondition(NativeAttentionIndicator.badge(enabled: false, unread: 4, pending: nil) == nil)
        precondition(NativeAttentionIndicator.badge(enabled: true, unread: 0, pending: -1) == "?")
        precondition(NativeAttentionIndicator.badge(enabled: true, unread: UInt64.max, pending: 1) == "99+")
        print("{\"suite\":\"attention-indicator\",\"result\":\"passed\",\"native_os_delivery\":false}")
    }
}
