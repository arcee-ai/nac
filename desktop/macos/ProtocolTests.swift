import Foundation
import Darwin

@main
struct ProtocolTests {
    static func main() throws {
        let identity = EngineIdentity(product_version: "1.2.3", build_id: "test-build",
                                      source_revision: "test-source", track: "dev")
        func parser() throws -> EngineProtocol {
            try EngineProtocol(identity: identity, store: URL(fileURLWithPath: "/tmp/store.db"))
        }
        func ready(_ state: EngineProtocol) throws -> [String: Any] {
            ["kind": "ready", "version": 1, "incarnation": state.incarnation,
             "endpoint": "http://127.0.0.1:1234", "identity": try JSONSerialization.jsonObject(with: JSONEncoder().encode(identity)),
             "store": state.store, "schema": 1]
        }
        func line(_ value: [String: Any]) throws -> Data {
            var data = try JSONSerialization.data(withJSONObject: value)
            data.append(10)
            return data
        }
        func rejected(_ state: EngineProtocol, _ bytes: Data) {
            do { _ = try state.receive(bytes); preconditionFailure("Invalid receipt accepted") }
            catch { precondition(error.localizedDescription.contains("launch receipt") || error.localizedDescription.contains("initialize")) }
        }
        let state = try parser()
        let physical = realpath("/tmp", nil)!
        defer { free(physical) }
        precondition(state.store == String(cString: physical) + "/store.db")
        let valid = try line(ready(state))
        for byte in valid.dropLast() {
            let result = try state.receive(Data([byte]))
            precondition(result == nil)
        }
        let endpoint = try state.receive(Data([10]))
        precondition(endpoint?.port == 1234)
        rejected(state, valid) // duplicate across callbacks
        let duplicate = try parser()
        let record = try line(ready(duplicate))
        rejected(duplicate, record + record) // duplicate within one dispatch
        rejected(try parser(), Data(repeating: 120, count: EngineProtocol.limit + 1))
        rejected(try parser(), Data("{bad}\n".utf8))
        let busy = try parser()
        var failure: [String: Any] = ["kind": "failed", "version": 1, "incarnation": busy.incarnation,
                                    "stage": "startup", "code": "store_owned", "message": "private-peer-canary"]
        do { _ = try busy.receive(line(failure)); preconditionFailure("Busy was accepted as readiness") }
        catch { precondition(error as? EngineFailure == .storeOwned) }
        // A stale launch or wrong protocol cannot create a recognized conflict.
        for key in ["version", "incarnation"] {
            let state = try parser()
            failure["incarnation"] = state.incarnation
            failure["version"] = 1
            if key == "version" { failure[key] = 2 }
            else { failure[key] = "stale-launch" }
            rejected(state, try line(failure))
        }
        let unknown = try parser()
        failure["incarnation"] = unknown.incarnation
        failure["version"] = 1
        failure["code"] = "private-peer-canary"
        do { _ = try unknown.receive(line(failure)); preconditionFailure("Failure accepted") }
        catch {
            precondition(error as? EngineFailure != .storeOwned)
            precondition(!error.localizedDescription.contains("private-peer-canary"))
        }
        failure["incarnation"] = state.incarnation
        failure["code"] = "store_owned"
        rejected(state, try line(failure)) // no startup conflict after readiness
        for key in ["kind", "version", "incarnation", "endpoint", "identity", "store", "schema"] {
            let state = try parser()
            var value = try ready(state)
            value.removeValue(forKey: key)
            rejected(state, try line(value))
        }
        let control = try JSONSerialization.jsonObject(with: parser().stop()) as! [String: Any]
        precondition(Set(control.keys) == Set(["kind", "version", "incarnation"]))
        print("Private engine protocol fixtures passed")
    }
}
