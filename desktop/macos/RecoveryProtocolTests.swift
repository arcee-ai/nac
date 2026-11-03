import Foundation

/// Characterization of the existing launch parser, not a recovery state machine
/// or proof of AppKit/WebKit behavior. No app, engine, store or PTY is launched.
@main
struct RecoveryProtocolTests {
    static func main() throws {
        let identity = EngineIdentity(product_version: "fixture", build_id: "fixture-build",
                                      source_revision: "fixture-source", track: "dev")
        func launch() throws -> EngineProtocol {
            try EngineProtocol(identity: identity, store: URL(fileURLWithPath: "/tmp/recovery-fixture.db"))
        }
        func receipt(_ parser: EngineProtocol, port: Int = 1234) throws -> Data {
            let object: [String: Any] = [
                "kind": "ready", "version": 1, "incarnation": parser.incarnation,
                "endpoint": "http://127.0.0.1:\(port)", "store": parser.store, "schema": 1,
                "identity": try JSONSerialization.jsonObject(with: JSONEncoder().encode(identity)),
            ]
            var data = try JSONSerialization.data(withJSONObject: object)
            data.append(10)
            return data
        }
        func rejects(_ parser: EngineProtocol, _ bytes: Data) {
            do { _ = try parser.receive(bytes); preconditionFailure("Retired launch receipt accepted") }
            catch { precondition(error.localizedDescription.contains("invalid launch receipt")) }
        }

        let original = try launch()
        let ready = try receipt(original)
        let endpoint = try original.receive(ready)
        precondition(endpoint?.port == 1234)
        let incarnation = original.incarnation
        // Renderer replacement/wake does not itself create a new engine launch.
        // The parser retains only its validated launch fact; revalidating live
        // process/channel ownership is the caller's separate responsibility.
        precondition(original.ready?.incarnation == incarnation)
        precondition(original.ready?.endpoint == endpoint?.absoluteString)

        let restarted = try launch()
        precondition(restarted.incarnation != incarnation)
        precondition(restarted.ready == nil)
        rejects(restarted, ready) // Same endpoint/build/store cannot revive an old launch.
        precondition(restarted.ready == nil)
        // The real engine owner retires a launch on any parser error. A healthy
        // successor is a new parser, never reuse of the rejected launch above.
        let healthyRestart = try launch()
        let restartedReady = try receipt(healthyRestart)
        let reusedEndpoint = try healthyRestart.receive(restartedReady)
        precondition(reusedEndpoint == endpoint)
        precondition(healthyRestart.ready?.incarnation == healthyRestart.incarnation)

        let moved = try launch()
        let changedEndpoint = try moved.receive(receipt(moved, port: 4321))
        precondition(changedEndpoint?.port == 4321)
        precondition(moved.incarnation != restarted.incarnation)
        // An unsolicited second ready/endpoint is not an in-place rebind.
        rejects(moved, try receipt(moved, port: 9876))
        precondition(moved.ready?.endpoint == changedEndpoint?.absoluteString)

        let fragmented = try launch()
        let next = try launch()
        let pending = try receipt(fragmented)
        let half = pending.count / 2
        let incomplete = try fragmented.receive(pending.prefix(half))
        precondition(incomplete == nil)
        // A replacement has its own framing buffer; the old tail cannot finish it.
        rejects(next, pending.suffix(from: half))
        precondition(next.ready == nil)
        let final = try launch()
        let finalEndpoint = try final.receive(receipt(final))
        precondition(finalEndpoint == endpoint)
        let stop = try JSONSerialization.jsonObject(with: final.stop()) as! [String: Any]
        precondition(Set(stop.keys) == Set(["kind", "version", "incarnation"]))
        precondition(stop["incarnation"] as? String == final.incarnation)
        print("Recovery launch-identity characterization passed (no native app acceptance)")
    }
}
