import AppKit

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = PreviewApp()
    app.setActivationPolicy(.regular)
    app.delegate = delegate
    withExtendedLifetime(delegate) { app.run() }
}
