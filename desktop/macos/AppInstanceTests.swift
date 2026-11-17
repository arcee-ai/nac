import AppKit

@MainActor
private final class WindowDouble: AppWorkspaceWindow {
    var isMiniaturized = false
    var actions: [String] = []
    func deminiaturize(_ sender: Any?) {
        precondition(isMiniaturized)
        actions.append("restore")
        isMiniaturized = false
    }
    func makeKeyAndOrderFront(_ sender: Any?) { actions.append("focus") }
}

@main
enum AppInstanceTests {
    @MainActor
    static func main() {
        let instance = AppInstance()
        // Finder can deliver reopen before the workspace window is installed.
        precondition(!instance.reopen())
        precondition(!instance.reopen())
        let window = WindowDouble()
        instance.install(window: window)
        precondition(window.actions == ["focus"])
        precondition(!instance.reopen())
        precondition(window.actions == ["focus", "focus"])
        window.isMiniaturized = true
        precondition(!instance.reopen())
        precondition(window.actions == ["focus", "focus", "restore", "focus"])
        // Presentation is app-local; a second build/profile has its own window.
        let other = AppInstance()
        let otherWindow = WindowDouble()
        other.install(window: otherWindow)
        precondition(otherWindow.actions.isEmpty)
        precondition(!other.reopen())
        precondition(otherWindow.actions == ["focus"])
        precondition(window.actions.count == 4)
        // A dead presentation target cannot be revived by stale discovery.
        do {
            let temporary = WindowDouble()
            other.install(window: temporary)
        }
        precondition(!other.reopen())
        precondition(otherWindow.actions == ["focus"])
        print("App reopen presentation doubles passed; LaunchServices/AppKit acceptance is separate.")
    }
}
