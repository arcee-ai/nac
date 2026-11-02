import AppKit
import WebKit

/// Dedicated lifetime probe, never compiled into NAC. The external fixture
/// owns the engine/provider/store. This process creates one real system
/// WKWebView observer and releases it on an owner-only filesystem barrier.
@MainActor
private final class QuitWebViewFixture: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView?
    private weak var retiredView: WKWebView?
    private var timer: Timer?
    private var observerOpened = false
    private var retained = false
    private var released = false
    private let endpoint: URL
    private let session: String
    private let controls: URL
    private let output: URL
    private let deadline = Date().addingTimeInterval(60)

    init(arguments: [String]) {
        endpoint = URL(string: arguments[1])!
        session = arguments[2]
        controls = URL(fileURLWithPath: arguments[3])
        output = URL(fileURLWithPath: arguments[4])
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // No activation, input events or visible-paint claim. This characterizes
        // WK document/network lifetime, not the normal app's close/Quit UI.
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
                          styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: window.contentView!.bounds, configuration: configuration)
        view.navigationDelegate = self
        window.contentView!.addSubview(view)
        webView = view
        view.load(URLRequest(url: endpoint))
        timer = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
        RunLoop.main.add(timer!, forMode: .common)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !observerOpened else { return }
        let script = #"""
        return await new Promise((resolve, reject) => {
          const stream = new EventSource('/sessions/' + encodeURIComponent(session) + '/events/stream');
          window.__quitLifetimeObserver = stream;
          const timer = setTimeout(() => reject(new Error('Observer open timed out')), 10000);
          stream.onopen = () => { clearTimeout(timer); resolve(true); };
          stream.onerror = () => { clearTimeout(timer); reject(new Error('Observer failed')); };
        });
        """#
        webView.callAsyncJavaScript(script, arguments: ["session": session], in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            if case .success(let value) = result, (value as? Bool) == true {
                self.observerOpened = true
                self.write(stage: "observer-open")
            } else { self.fail("Real WK EventSource did not open: \(result)") }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = action.request.url
        decisionHandler(url?.scheme == endpoint.scheme && url?.host == endpoint.host &&
                        url?.port == endpoint.port ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail(error.localizedDescription)
    }

    private func poll() {
        if Date() > deadline { fail("External lifetime fixture deadline exceeded"); return }
        guard observerOpened else { return }
        let files = FileManager.default
        if !retained, !released, files.fileExists(atPath: controls.appendingPathComponent("retain").path) {
            retained = true
            if files.fileExists(atPath: controls.appendingPathComponent("stop-loading").path) { webView?.stopLoading() }
            webView?.isHidden = true
            write(stage: "retained")
        }
        if !released, files.fileExists(atPath: controls.appendingPathComponent("release").path) {
            released = true
            retireDocument()
            // Observe weak lifetime after the releasing stack has returned.
            RunLoop.main.perform(inModes: [.common]) { [weak self] in
                MainActor.assumeIsolated { self?.write(stage: "released") }
            }
        }
        if files.fileExists(atPath: controls.appendingPathComponent("finish").path) {
            timer?.invalidate()
            retireDocument()
            write(stage: "done")
            NSApp.terminate(nil)
        }
    }

    private func retireDocument() {
        guard let view = webView else { return }
        retiredView = view
        window.makeFirstResponder(nil)
        view.navigationDelegate = nil
        view.uiDelegate = nil
        view.stopLoading()
        view.removeFromSuperview()
        webView = nil
    }

    private func write(stage: String, error: String? = nil) {
        var value: [String: Any] = ["stage": stage, "app_pid": getpid(),
            "observer_opened": observerOpened, "view_retained": webView != nil,
            "retired_view_retained": retiredView != nil,
            "visible_paint_acceptance": false, "normal_app_acceptance": false]
        value["error"] = error
        do { try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]).write(to: output, options: .atomic) }
        catch { fputs("Lifetime fixture evidence failed: \(error)\n", stderr); NSApp.terminate(nil) }
    }

    private func fail(_ message: String) {
        timer?.invalidate()
        retireDocument()
        write(stage: "failed", error: message)
        NSApp.terminate(nil)
    }
}

@main
enum QuitWebViewFixtureMain {
    @MainActor
    static func main() {
        precondition(CommandLine.arguments.count == 5)
        let application = NSApplication.shared
        application.setActivationPolicy(.prohibited)
        let fixture = QuitWebViewFixture(arguments: CommandLine.arguments)
        application.delegate = fixture
        withExtendedLifetime(fixture) { application.run() }
    }
}
