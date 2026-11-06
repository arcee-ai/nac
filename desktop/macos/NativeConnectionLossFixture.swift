import Foundation

// The handler and retirement methods are inserted verbatim. The real native
// receipt state owns admission. WK and later storage/target owners are inert
// ports here; this fixture qualifies only connection-loss callback ordering.
private enum World { case page }
private enum NativeCommandScript { static let handler = "nacUIReceipt" }
private enum WorkspaceStorageScript { static let handler = "nacPresentationStorage" }
private final class Storage {
    func retire() {}
    func flush(completion: (Bool) -> Void) { completion(true) }
    func receive(_ body: String, expected: NativeDocumentBinding) -> Bool { false }
}
private final class Target {
    let ready = false
    func end() {}
    func receive(_ body: String, expected: NativeDocumentBinding) -> Bool { false }
}
private final class WKUserContentController {
    var inCallback = false
    var removed = 0
    var removedInsideCallback = false
    func removeScriptMessageHandler(forName: String, contentWorld: World) {
        removedInsideCallback = removedInsideCallback || inCallback
        removed += 1
    }
}
private final class Configuration { let userContentController = WKUserContentController() }
@MainActor private final class View {
    let configuration = Configuration()
    func callAsyncJavaScript(_ source: String, arguments: [String: Any], in frame: Int?, in world: World,
                             completionHandler: @escaping (Result<Any, Error>) -> Void) {
        completionHandler(.success(true))
    }
}
private struct Origin { let `protocol` = "http"; let host = "127.0.0.1"; let port = 1234 }
private struct Frame { let securityOrigin = Origin(); let isMainFrame = true }
@MainActor private struct WKScriptMessage {
    let webView: View?
    let name = NativeCommandScript.handler
    let body: Any
    let frameInfo = Frame()
}
@MainActor private final class Bridge {
    weak var webView: View?
    let state: NativeCommandState
    let target = Target()
    var targetReady: (() -> Void)?
    var storage: Storage?
    var installed = true
    var navigation: Int? = 1
    var current: EngineReceipt?
    var connectionLost: (() -> Void)?
    init(_ view: View, _ receipt: EngineReceipt) {
        webView = view
        current = receipt
        state = NativeCommandState(receipt: receipt)!
    }
    private func receipt() -> EngineReceipt? { current }
    // RETIRE_OWNER
    // MESSAGE_OWNER
}

@main private enum ConnectionLossTests {
    static func receipt(_ incarnation: String = "engine") throws -> EngineReceipt {
        let object: [String: Any] = ["kind":"ready", "version":1, "incarnation":incarnation,
            "endpoint":"http://127.0.0.1:1234", "store":"/tmp/fixture.db", "schema":1,
            "identity":["product_version":"test", "build_id":"fixture", "source_revision":"fixture", "track":"dev"]]
        return try JSONDecoder().decode(EngineReceipt.self, from: JSONSerialization.data(withJSONObject: object))
    }
    static func body(_ kind: String, _ binding: NativeDocumentBinding) throws -> String {
        let object: [String: Any] = ["kind":kind,"version":1,"launch":binding.launch,
                                     "view":binding.view,"document":binding.document]
        return String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
    }
    @MainActor static func main() throws {
        for change in ["none", "retire", "document", "view", "engine", "not-loss"] {
            let view = View(), replacement = View()
            let bridge = Bridge(view, try receipt())
            let binding = bridge.state.beginDocument(receipt: bridge.current)!
            let ready = try body("ready", binding)
            precondition(bridge.state.receive(ready, origin: bridge.state.origin,
                mainFrame: true, currentView: true, receipt: bridge.current))
            var calls = 0
            bridge.connectionLost = { [weak bridge] in
                calls += 1
                bridge?.retire()
            }
            let controller = view.configuration.userContentController
            controller.inCallback = true
            let kind = change == "not-loss" ? "retired" : "connection_lost"
            bridge.userContentController(controller, didReceive: WKScriptMessage(webView: view, body: try body(kind, binding)))
            controller.inCallback = false
            if calls != 0 {
                print("Connection-loss notification ran before message callback returned")
                exit(42)
            }
            precondition(!bridge.state.ready && bridge.state.issue(.settings, receipt: bridge.current) == nil,
                         "Command admission must be fenced before deferring recovery")
            switch change {
            case "retire": bridge.retire()
            case "document": _ = bridge.state.beginDocument(receipt: bridge.current)
            case "view": bridge.webView = replacement
            case "engine": bridge.current = try receipt("successor")
            default: break
            }
            RunLoop.main.run(until: Date().addingTimeInterval(0.02))
            precondition(calls == (change == "none" ? 1 : 0), "Queued loss escaped its original binding")
            if change == "none" {
                precondition(controller.removed > 0 && !bridge.installed && !controller.removedInsideCallback)
            }
        }
        print("Verbatim connection-loss handler: deferred retirement, immediate admission fence, retired/document/view/engine fences and non-loss receipt passed (headless).")
    }
}
