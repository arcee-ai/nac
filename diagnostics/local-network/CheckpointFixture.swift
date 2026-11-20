// Disposable diagnostic-only window. No network, user data, or external input.
import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 360),
                      styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "NAC diagnostic fixture"
window.center()
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
// Even if the test runner disappears, this owned disposable app exits itself.
Timer.scheduledTimer(withTimeInterval: 90, repeats: false) { _ in app.terminate(nil) }
app.run()
