import Foundation

// test_native_command_bridge.py inserts the verbatim retire method. These
// explicit WebKit/receipt ports prove native disposal dispatch, not WK behavior.
private enum World { case page }
private enum NativeCommandScript { static let handler = "nacUIReceipt" }
private enum Failure: Error { case unavailable }
private final class Controller {
    var removed: [String] = []
    func removeScriptMessageHandler(forName name: String, contentWorld: World) { removed.append(name) }
}
private final class Configuration { let userContentController = Controller() }
@MainActor private final class View {
    let configuration = Configuration()
    var scripts: [String] = []
    var completion: ((Result<Any, Error>) -> Void)?
    var onCall: (() -> Void)?
    func callAsyncJavaScript(_ source: String, arguments: [String: Any], in frame: Int?, in world: World,
                             completionHandler: @escaping (Result<Any, Error>) -> Void) {
        precondition(arguments.isEmpty, "View disposal must not require an activated binding")
        scripts.append(source)
        onCall?()
        completion = completionHandler
    }
}
private final class State {
    var binding: String?
    var retired = false
    func retire() { binding = nil; retired = true }
}
@MainActor private final class Bridge {
    weak var webView: View?
    let state = State()
    var installed = true
    var navigation: Int? = 1
    init(_ view: View?) { webView = view }
    private func object<T: Encodable>(_ value: T) -> [String: Any] { ["value": value] }
    // RETIRE_OWNER
}
@main private enum BridgeDisposalTests {
    @MainActor static func main() {
        for activated in [false, true] {
            for result: Result<Any, Error> in [.success(true), .success(false), .failure(Failure.unavailable)] {
                let view = View(), bridge = Bridge(nil)
                bridge.webView = view
                bridge.state.binding = activated ? "old-document" : nil
                var answers: [Bool] = []
                view.onCall = {
                    precondition(!bridge.installed && bridge.state.retired && bridge.navigation == nil)
                    precondition(view.configuration.userContentController.removed == [NativeCommandScript.handler])
                }
                bridge.retire { answers.append($0) }
                precondition(view.scripts == ["return window.__nacDesktop?.retireView() === true"],
                    "Unactivated or provisionally navigating view skipped lifetime disposal")
                precondition(answers.isEmpty, "Retirement acknowledged before the page callback")
                bridge.retire { answers.append($0) }
                precondition(answers == [false] && view.scripts.count == 1)
                view.completion?(result)
                let expected: Bool
                if case .success(let value) = result { expected = (value as? Bool) == true }
                else { expected = false }
                precondition(answers == [false, expected], "Missing/dead page must not claim disposal acknowledgement")
            }
        }
        let absent = Bridge(nil)
        var answer: Bool?
        absent.retire { answer = $0 }
        precondition(answer == false && absent.state.retired && !absent.installed)
        print("Verbatim native disposal: unactivated/bound view, retired admission, delayed success/failure, repeated/nil view passed (headless).")
    }
}
