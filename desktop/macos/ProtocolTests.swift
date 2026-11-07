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
        for key in ["kind", "version", "incarnation", "endpoint", "identity", "store", "schema"] {
            let state = try parser()
            var value = try ready(state)
            value.removeValue(forKey: key)
            rejected(state, try line(value))
        }
        let control = try JSONSerialization.jsonObject(with: parser().stop()) as! [String: Any]
        precondition(Set(control.keys) == Set(["kind", "version", "incarnation"]))
        let failed = try parser()
        do {
            _ = try failed.receive(line(["kind": "failed", "version": 1, "incarnation": failed.incarnation,
                                         "message": "private-canary"]))
            preconditionFailure("Failed receipt accepted")
        } catch {
            let text = error.localizedDescription
            if text.contains("newer NAC version") || text.contains("compatible version") || text.contains("private-canary") {
                fputs("Generic failed receipt incorrectly suggests a newer schema or exposes peer text\n", stderr)
                exit(1)
            }
            precondition(text.contains("directory access"))
        }
        // Failed startup/listener/unknown codes do not establish a newer schema.
        for (stage, code) in [("startup", "engine_unavailable"), ("startup", "store_owned"),
                              ("listener", "bind_failed"), ("startup", "unknown")] {
            let state = try parser()
            do {
                _ = try state.receive(line(["kind": "failed", "version": 1, "incarnation": state.incarnation,
                    "stage": stage, "code": code, "message": "private-peer-canary"]))
                preconditionFailure("Failure was accepted as readiness")
            } catch {
                let text = error.localizedDescription
                precondition(text.contains("directory access") && !text.contains("private-peer-canary"))
                precondition(!text.contains("newer NAC version") && !text.contains("compatible version"))
            }
        }
        print("Private engine protocol fixtures passed")
    }
}
