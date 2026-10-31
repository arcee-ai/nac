import Foundation

@main
struct NativePathRequestTests {
    static func main() throws {
        let binding = NativeDocumentBinding(launch: "launch", view: "view", document: "document")
        let common: [String: Any] = ["version": 1, "kind": "choose", "request": 1,
                                     "launch": "launch", "view": "view", "document": "document",
                                     "initialPath": "/tmp/日本語 space"]
        func decode(_ changes: [String: Any] = [:], removing: String? = nil) throws -> NativePathRequest? {
            var value = common
            changes.forEach { value[$0] = $1 }
            if let removing { value.removeValue(forKey: removing) }
            let body = String(decoding: try JSONSerialization.data(withJSONObject: value), as: UTF8.self)
            return NativePathRequest.decode(body, binding: binding)
        }
        guard case .choose(let id, let path) = try decode() else { fatalError("valid choice rejected") }
        precondition(id == 1 && path == "/tmp/日本語 space")
        guard case .cancel(let id) = try decode(["kind": "cancel"], removing: "initialPath") else { fatalError("valid cancellation rejected") }
        precondition(id == 1)
        for key in ["version", "kind", "request", "launch", "view", "document", "initialPath"] {
            let result = try decode(removing: key)
            precondition(result == nil)
        }
        for changes in [
            ["kind": "shell"], ["extra": true], ["version": true], ["version": 2],
            ["launch": "old"], ["view": "old"], ["document": "old"],
            ["request": true], ["request": 0], ["request": -1], ["request": 1.5],
            ["request": 2_147_483_648], ["initialPath": true], ["initialPath": "/bad\0path"],
            ["initialPath": String(repeating: "a", count: 16_385)],
            ["kind": "cancel"]
        ] as [[String: Any]] {
            let result = try decode(changes)
            precondition(result == nil)
        }
        precondition(NativePathRequest.decode(String(repeating: "x", count: 20_481), binding: binding) == nil)
        precondition(NativePathRequest.decode("{bad", binding: binding) == nil)
        print("Native folder request boundary fixtures passed")
    }
}
