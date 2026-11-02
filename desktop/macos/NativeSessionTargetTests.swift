import Foundation

@main
enum NativeSessionTargetTests {
    static func main() throws {
        let state = NativeSessionTarget()
        let binding = NativeDocumentBinding(launch: "engine", view: "view", document: "document")
        state.begin(binding, profile: "profile")
        func receipt(_ kind: String, _ extra: [String: Any] = [:]) throws -> String {
            var value: [String: Any] = ["version": 1, "kind": kind, "profile": "profile",
                "launch": binding.launch, "view": binding.view, "document": binding.document]
            extra.forEach { value[$0] = $1 }
            return String(decoding: try JSONSerialization.data(withJSONObject: value), as: UTF8.self)
        }
        precondition(state.issue(session: "S", occurrence: "A", completion: { _ in }) == nil)
        let malformed = try receipt("session_target_ready", ["command": "run"])
        let ready = try receipt("session_target_ready")
        precondition(!state.receive(malformed, expected: binding))
        precondition(state.receive(ready, expected: binding))
        var outcomes: [NativeSessionTarget.Outcome] = []
        let first = state.issue(session: "S", occurrence: "A", completion: { outcomes.append($0) })!
        let second = state.issue(session: "S", occurrence: "B", completion: { outcomes.append($0) })!
        precondition(outcomes == [.stale])
        let stale = try receipt("session_target_settled", ["request": first.request, "outcome": "opened"])
        precondition(!state.receive(stale, expected: binding))
        let deferred = try receipt("session_target_settled", ["request": second.request, "outcome": "deferred"])
        precondition(state.receive(deferred, expected: binding))
        precondition(!state.receive(deferred, expected: binding))
        precondition(outcomes == [.stale, .deferred])
        _ = state.issue(session: "S", occurrence: "C", completion: { _ in state.end() })
        precondition(state.issue(session: "S", occurrence: "D", completion: { outcomes.append($0) }) == nil)
        precondition(outcomes.last == .stale && !state.ready) // reentrant retirement fences dispatch
        print("Typed session target correlation, supersession and reentrant retirement passed; no WK routing claim.")
    }
}
