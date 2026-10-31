import AppKit

MainActor.assumeIsolated {
    #if LOCAL_APP
    let app = NACApplication.shared
    precondition(app is NACApplication, "Normal NAC requires its guarded application owner.")
    #else
    let app = NSApplication.shared
    #endif
    let delegate = PreviewApp()
    app.setActivationPolicy(.regular)
    app.delegate = delegate
    withExtendedLifetime(delegate) { app.run() }
}
