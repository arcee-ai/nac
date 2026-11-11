import AppKit

/// Reopen owns presentation only. LaunchServices selects the running app;
/// Rust's serving lease independently admits the canonical store owner.
@MainActor
protocol AppWorkspaceWindow: AnyObject {
    var isMiniaturized: Bool { get }
    func deminiaturize(_ sender: Any?)
    func makeKeyAndOrderFront(_ sender: Any?)
}

extension NSWindow: AppWorkspaceWindow {}

@MainActor
final class AppInstance {
    private weak var window: AppWorkspaceWindow?
    private var pendingReopen = false

    func install(window: AppWorkspaceWindow) {
        self.window = window
        if pendingReopen { _ = reopen() }
    }

    /// Return false to suppress AppKit's default untitled-window behavior.
    /// Reopening while starting, failed, or stopping focuses this same window;
    /// it never launches an engine, retries a command, or creates a workspace.
    func reopen() -> Bool {
        guard let window else {
            pendingReopen = true
            return false
        }
        pendingReopen = false
        if window.isMiniaturized { window.deminiaturize(nil) }
        window.makeKeyAndOrderFront(nil)
        return false
    }
}
