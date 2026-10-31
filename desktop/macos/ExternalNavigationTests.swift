import Foundation

@main
struct ExternalNavigationTests {
    static func main() throws {
        let identity = EngineIdentity(product_version: "test", build_id: "build", source_revision: "source", track: "dev")
        let receipt = EngineReceipt(kind: "ready", version: 1, incarnation: "launch", endpoint: "http://127.0.0.1:43219",
                                    identity: identity, store: "/fixture/store", schema: 1, stage: nil, code: nil, message: nil)
        let policy = ExternalNavigationPolicy(receipt: receipt)!
        func allows(_ target: String = "https://provider.example/authorize?state=fixture", source: String = "http://127.0.0.1:43219",
                    document: String = "http://127.0.0.1:43219/settings", current: EngineReceipt? = receipt,
                    main: Bool = true, targetMain: Bool = true, popup: Bool = false,
                    link: Bool = true, other: Bool = false, download: Bool = false) -> Bool {
            policy.allows(destination: URL(string: target), source: URL(string: source), document: URL(string: document),
                          receipt: current, mainFrame: main, mainTarget: targetMain, popup: popup,
                          activatedLink: link, otherNavigation: other, download: download)
        }
        precondition(allows())
        precondition(allows("http://127.0.0.1:43220/authorize")) // Local deterministic auth service.
        precondition(allows(popup: true))
        precondition(allows(targetMain: false, popup: true, link: false, other: true))
        for target in ["file:///tmp/key", "javascript:alert(1)", "data:text/html,hello", "mailto:test@example.test",
                       "nac://callback", "https://user:password@provider.example/", "https://@provider.example/",
                       "http://127.0.0.1:43219/credentials", "about:blank"] {
            precondition(!allows(target))
        }
        for source in ["http://localhost:43219", "http://127.0.0.1:43220", "https://127.0.0.1:43219",
                       "https://provider.example", "http://user@127.0.0.1:43219"] {
            precondition(!allows(source: source))
            precondition(!allows(document: source))
        }
        precondition(!allows(main: false))
        precondition(!allows(targetMain: false))
        precondition(!allows(link: false, other: true)) // Script/redirect in the existing view.
        precondition(!allows(popup: true, link: false)) // Form submission, back/forward, reload.
        precondition(!allows(download: true))
        precondition(!allows(current: nil))
        let replacement = EngineReceipt(kind: "ready", version: 1, incarnation: "replacement", endpoint: receipt.endpoint,
                                        identity: identity, store: receipt.store, schema: 1, stage: nil, code: nil, message: nil)
        precondition(!allows(current: replacement))
        policy.retire()
        precondition(!allows())
        precondition(!allows(targetMain: false, popup: true, link: false, other: true))
        print("External navigation policy contracts passed")
    }
}
