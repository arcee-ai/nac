import Foundation

@main
struct ProtocolTests {
    static func main() throws {
        let identity = EngineIdentity(product_version: "1.2.3", build_id: "test-build",
                                      source_revision: "test-source", track: "dev")
        func parser() -> EngineProtocol {
            EngineProtocol(identity: identity, store: URL(fileURLWithPath: "/tmp/store.db"))
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
        let state = parser()
        let valid = try line(ready(state))
        for byte in valid.dropLast() {
            let result = try state.receive(Data([byte]))
            precondition(result == nil)
        }
        let endpoint = try state.receive(Data([10]))
        precondition(endpoint?.port == 1234)
        rejected(state, valid) // duplicate across callbacks
        let duplicate = parser()
        let record = try line(ready(duplicate))
        rejected(duplicate, record + record) // duplicate within one dispatch
        rejected(parser(), Data(repeating: 120, count: EngineProtocol.limit + 1))
        rejected(parser(), Data("{bad}\n".utf8))
        for key in ["kind", "version", "incarnation", "endpoint", "identity", "store", "schema"] {
            let state = parser()
            var value = try ready(state)
            value.removeValue(forKey: key)
            rejected(state, try line(value))
        }
        let control = try JSONSerialization.jsonObject(with: parser().stop()) as! [String: Any]
        precondition(Set(control.keys) == Set(["kind", "version", "incarnation"]))
        print("Private engine protocol fixtures passed")
    }
}
