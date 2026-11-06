import Foundation

// Headless identity/URL/presentation ports only. No AppKit, WK or engine run.
private final class WKNavigation: NSObject {}
private final class WKWebView: NSObject {
    var url: URL? = URL(string: "http://127.0.0.1:1234/#/project/test")
    var isHidden = true
}
private struct Receipt { var incarnation: String }
private final class Engine { var receipt: Receipt? = Receipt(incarnation: "launch") }
private final class Status { var isHidden = false }
private final class Commands {
    var navigation: WKNavigation?
    var starts = 0
    var finishes = 0
    var documentReady = true
    var pendingPanel = true
    var cancellations = 0
    func navigationStarted(in view: WKWebView, navigation: WKNavigation?) {
        self.navigation = navigation
        starts += 1
        documentReady = false
        pendingPanel = false
        cancellations += 1
    }
    func navigationFinished(in view: WKWebView, navigation: WKNavigation?) {
        if let navigation, navigation === self.navigation { finishes += 1; documentReady = true }
    }
}
private final class Recovery {
    var loaded = 0
    var failures: [String] = []
    func documentLoaded() { loaded += 1 }
    func rendererFailed(_ message: String) { failures.append(message) }
}
@MainActor private final class App {
    let engine = Engine(), status = Status(), recovery = Recovery()
    var webView: WKWebView! = WKWebView()
    var commands: Commands! = Commands()
    var nativePaths: Commands? = Commands()
    var stopping = false
    var failure: String?
    var workspaceIncarnation: String? = "launch"
    var baseURL: URL? = URL(string: "http://127.0.0.1:1234")
    var navigationIncarnations: [WKNavigation: String] = [:]
    var activeNavigation: WKNavigation?
    // APP_DELEGATES
    func deadline(replacement: WKWebView, navigation: WKNavigation) -> () -> Void {
        // Scheduling is an explicit port. The exact production ten-second
        // closure body is inserted; no real clock or timeout execution claimed.
        // APP_DEADLINE
    }
    func track(_ navigation: WKNavigation) {
        navigationIncarnations[navigation] = "launch"
        activeNavigation = navigation
    }
}
@main private enum NavigationOwnerTests {
    @MainActor static func main() {
        let app = App(), tracked = WKNavigation()
        app.track(tracked)
        app.webView(app.webView, didStartProvisionalNavigation: tracked)
        precondition(app.activeNavigation === tracked && app.commands.navigation === tracked)
        let deadline = app.deadline(replacement: app.webView, navigation: tracked)
        let scenario = CommandLine.arguments.last!
        let foreign = WKNavigation()
        app.commands.documentReady = true // Model an active predecessor before the next callback.
        // EXPECT_PATHS
        app.nativePaths?.pendingPanel = true
        let priorPathStarts = app.nativePaths?.starts ?? 0
        defer {
            if expectsPaths && ["blank-finish", "blank-timeout", "nil-start", "nil-commands", "off-origin", "stale-engine", "stale-known"].contains(scenario) {
                precondition(app.nativePaths?.navigation === tracked,
                    "unadmitted start stole the path bridge navigation identity")
                precondition(app.nativePaths?.pendingPanel == false,
                    "unadmitted start left its previous pending panel alive")
                precondition(app.nativePaths?.starts == priorPathStarts + 1,
                    "path bridge invalidation was skipped or repeated")
            }
        }
        switch scenario {
        case "tracked-load": break
        case "tracked-url-unset":
            app.webView.url = nil
            app.webView(app.webView, didStartProvisionalNavigation: tracked)
        case "blank-finish", "blank-timeout":
            app.webView.url = URL(string: "about:blank")
            app.webView(app.webView, didStartProvisionalNavigation: foreign)
        case "nil-start": app.webView(app.webView, didStartProvisionalNavigation: nil)
        case "nil-commands":
            app.commands = nil
            app.webView.url = URL(string: "about:blank")
            app.webView(app.webView, didStartProvisionalNavigation: foreign)
            precondition(app.activeNavigation === tracked && app.recovery.failures.isEmpty,
                "unadmitted start with no command owner changed recovery or navigation")
            print("PASS absent command owner on unadmitted navigation"); return
        case "off-origin":
            app.webView.url = URL(string: "https://example.invalid/")
            app.webView(app.webView, didStartProvisionalNavigation: foreign)
        case "foreign-view": app.webView(WKWebView(), didStartProvisionalNavigation: foreign)
        case "stopped":
            app.stopping = true
            app.webView(app.webView, didStartProvisionalNavigation: foreign)
            precondition(app.activeNavigation === tracked && app.commands.navigation === tracked)
            print("PASS stopped callback admission"); return
        case "failed":
            app.failure = "prior failure"
            app.webView(app.webView, didStartProvisionalNavigation: foreign)
            precondition(app.activeNavigation === tracked && app.commands.navigation === tracked)
            print("PASS failed callback admission"); return
        case "stale-engine", "stale-known":
            if scenario == "stale-engine" { app.engine.receipt = Receipt(incarnation: "successor") }
            else { app.navigationIncarnations[foreign] = "old-launch" }
            app.webView(app.webView, didStartProvisionalNavigation: foreign)
            precondition(app.activeNavigation === tracked && app.commands.navigation === tracked,
                "stale launch replaced navigation ownership")
            precondition(!app.commands.documentReady, "rejected start failed to fence the prior document")
            print("PASS stale launch callback admission with document fence"); return
        case "same-origin-reload":
            app.webView(app.webView, didFinish: tracked)
            app.webView(app.webView, didStartProvisionalNavigation: foreign)
            precondition(app.activeNavigation === foreign && app.commands.navigation === foreign)
            app.webView(app.webView, didFinish: foreign)
            deadline()
            precondition(app.recovery.loaded == 2 && app.commands.finishes == 2 && app.recovery.failures.isEmpty)
            print("PASS ordinary same-origin reload"); return
        case "old-failure":
            app.navigationIncarnations[foreign] = "launch"
            app.webView(app.webView, didFailProvisionalNavigation: foreign, withError: TestError())
            precondition(app.recovery.failures.isEmpty)
        case "current-failure":
            app.webView(app.webView, didFail: tracked, withError: TestError())
            precondition(app.recovery.failures == ["The workspace navigation failed."])
            deadline()
            precondition(app.recovery.failures.count == 1)
            print("PASS tracked failure and no duplicate deadline"); return
        case "current-provisional-failure":
            app.webView(app.webView, didFailProvisionalNavigation: tracked, withError: TestError())
            precondition(app.recovery.failures == ["Could not load the bundled workspace."])
            deadline()
            precondition(app.recovery.failures.count == 1)
            print("PASS tracked provisional failure and no duplicate deadline"); return
        default: preconditionFailure("unknown navigation test scenario")
        }
        precondition(app.activeNavigation === tracked && app.commands.navigation === tracked,
            "unadmitted callback stole app or bridge navigation identity")
        if ["blank-finish", "blank-timeout", "nil-start", "off-origin", "old-failure"].contains(scenario) {
            if scenario != "old-failure" {
                precondition(!app.commands.documentReady,
                    "unadmitted navigation activity left the previous document admitted")
            }
        }
        if scenario == "blank-timeout" {
            deadline()
            precondition(app.recovery.failures == ["The workspace did not finish loading within ten seconds."])
            precondition(app.recovery.loaded == 0 && app.webView.isHidden)
        } else {
            app.webView.url = app.baseURL
            app.webView(app.webView, didFinish: tracked)
            deadline()
            precondition(app.recovery.loaded == 1 && app.commands.finishes == 1 && app.recovery.failures.isEmpty)
            precondition(!app.webView.isHidden && app.status.isHidden)
        }
        print("PASS \(scenario): actual delegate identity and deadline guards (headless ports)")
    }
}
private struct TestError: Error {}
