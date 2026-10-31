import AppKit
import WebKit

/// External navigation is a presentation operation, never API or tool authority.
/// No URL crosses the script-message bridge or appears in diagnostics.
@MainActor
final class ExternalNavigation {
    private weak var webView: WKWebView?
    private let receipt: () -> EngineReceipt?
    private let policy: ExternalNavigationPolicy
    #if PREVIEW_SMOKE
    private var recordedActions: [[String: Any]] = []
    private var recordingOnly: Bool {
        let args = CommandLine.arguments
        guard let index = args.firstIndex(of: "--smoke-scenario"), index + 1 < args.count else { return false }
        return args[index + 1] == "external-navigation-recording"
    }
    var smokeSnapshot: [String: Any] {
        ["recording_only": recordingOnly, "actions": recordedActions,
         "system_browser_qualified": false]
    }
    #endif

    init?(webView: WKWebView, receipt: @escaping () -> EngineReceipt?) {
        guard let current = receipt(), let policy = ExternalNavigationPolicy(receipt: current) else { return nil }
        self.webView = webView
        self.receipt = receipt
        self.policy = policy
    }

    /// Called only for navigation which the existing internal bridge refused.
    /// NativeCommands explicitly enables WebKit's user-interaction popup gate
    /// before the first load; macOS otherwise allows automatic script popups.
    func allows(_ action: WKNavigationAction, in candidate: WKWebView, popup: Bool) -> Bool {
        let source = action.sourceFrame.securityOrigin
        var components = URLComponents()
        components.scheme = source.protocol
        components.host = source.host
        components.port = source.port
        return candidate === webView &&
              policy.allows(destination: action.request.url, source: components.url,
                            document: candidate.url, receipt: receipt(),
                            mainFrame: action.sourceFrame.isMainFrame,
                            mainTarget: action.targetFrame?.isMainFrame == true,
                            popup: popup && action.targetFrame == nil,
                            activatedLink: action.navigationType == .linkActivated,
                            otherNavigation: action.navigationType == .other,
                            download: action.shouldPerformDownload)
    }

    @discardableResult
    func open(_ action: WKNavigationAction, in candidate: WKWebView, popup: Bool) -> Bool {
        guard allows(action, in: candidate, popup: popup), let destination = action.request.url else { return false }
        #if PREVIEW_SMOKE
        if recordedActions.count < 128 {
            recordedActions.append(["popup": popup, "navigation_type": action.navigationType.rawValue,
                                    "system_opener_invoked": !recordingOnly])
        }
        // Explicit non-acceptance fixture. Normal production builds omit both
        // this branch and its observations; actual auth uses NSWorkspace below.
        if recordingOnly { return true }
        #endif
        if !NSWorkspace.shared.open(destination) {
            let alert = NSAlert()
            alert.messageText = "Could not open your browser"
            alert.informativeText = "Return to NAC and use the sign-in link to try again. You can cancel a pending sign-in in NAC."
            if let window = candidate.window { alert.beginSheetModal(for: window) }
        }
        return true
    }

    func retire() { policy.retire() }
}

/// Pure decisions use the same verified receipt/origin contract as UI commands.
/// `popup` means WebKit delivered a new-window action after its popup checks;
/// it is not a caller-supplied permission or JavaScript message field.
final class ExternalNavigationPolicy {
    private let launch: NativeCommandState

    init?(receipt: EngineReceipt) {
        guard let launch = NativeCommandState(receipt: receipt) else { return nil }
        self.launch = launch
    }

    func allows(destination: URL?, source: URL?, document: URL?, receipt: EngineReceipt?,
                mainFrame: Bool, mainTarget: Bool, popup: Bool, activatedLink: Bool,
                otherNavigation: Bool, download: Bool) -> Bool {
        guard launch.matches(receipt), launch.allows(source), launch.allows(document),
              mainFrame, !download, let destination,
              (popup && (activatedLink || otherNavigation)) || (mainTarget && activatedLink),
              ["http", "https"].contains(destination.scheme),
              let host = destination.host, !host.isEmpty,
              destination.user == nil, destination.password == nil,
              !launch.allows(destination) else { return false }
        return true
    }

    func retire() { launch.retire() }
}
