import Foundation

@main
struct NativeCommandStateTests {
    static func main() throws {
        let identity = EngineIdentity(product_version: "test", build_id: "build", source_revision: "source", track: "dev")
        let receipt = EngineReceipt(kind: "ready", version: 1, incarnation: "launch", endpoint: "http://127.0.0.1:3211",
                                    identity: identity, store: "/fixture/store", schema: 1, stage: nil, code: nil, message: nil)
        let state = NativeCommandState(receipt: receipt)!
        let binding = state.beginDocument(receipt: receipt)!
        func message(_ kind: String, _ changes: [String: Any] = [:]) throws -> String {
            var object: [String: Any] = ["version": 1, "kind": kind, "launch": binding.launch,
                                        "view": binding.view, "document": binding.document]
            changes.forEach { object[$0] = $1 }
            return String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
        }
        func receive(_ text: String, origin: URL? = URL(string: "http://127.0.0.1:3211"),
                     mainFrame: Bool = true, currentView: Bool = true, live: Bool = true) -> Bool {
            state.receive(text, origin: origin, mainFrame: mainFrame, currentView: currentView, receipt: live ? receipt : nil)
        }
        func reject(_ kind: String, _ changes: [String: Any] = [:]) throws {
            let text = try message(kind, changes)
            precondition(!receive(text))
        }
        precondition(state.issue(.settings, receipt: receipt) == nil)
        let ready = try message("ready")
        precondition(!receive(ready, mainFrame: false))
        precondition(!receive(ready, currentView: false))
        for origin in ["http://127.0.0.1:3212", "http://localhost:3211", "https://127.0.0.1:3211", "http://user@127.0.0.1:3211"] {
            precondition(!receive(ready, origin: URL(string: origin)))
        }
        precondition(!receive(ready, live: false))
        for key in ["launch", "view", "document", "version", "kind"] {
            try reject("ready", [key: "wrong"])
        }
        precondition(!receive("{}"))
        precondition(!receive("{bad"))
        precondition(!receive(String(repeating: "x", count: NativeCommandState.limit + 1)))
        try reject("ready", ["extra": true])
        try reject("shell")
        precondition(receive(ready))
        precondition(!receive(ready))
        let request = state.issue(.newSession, receipt: receipt)!
        precondition(state.issue(.settings, receipt: receipt) == nil)
        let settled = try message("settled", ["request": request.request, "accepted": true])
        try reject("settled", ["request": request.request + 1, "accepted": true])
        precondition(receive(settled))
        precondition(!receive(settled))
        precondition(state.issue(.projects, receipt: receipt) != nil)
        state.endDocument()
        precondition(!receive(settled))
        precondition(state.issue(.settings, receipt: receipt) == nil)
        let successor = state.beginDocument(receipt: receipt)!
        precondition(successor.document != binding.document && successor.view == binding.view)
        precondition(!receive(ready))
        state.retire()
        precondition(state.beginDocument(receipt: receipt) == nil)
        precondition(state.issue(.settings, receipt: receipt) == nil)
        print("Native command boundary fixtures passed")
    }
}
