// Disposable diagnostic-only window. No network, user data, or external input.
import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 360),
                      styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "NAC diagnostic fixture"
if CommandLine.arguments.contains("--positive-control") {
    let caption = NSTextField(labelWithString: "Synthetic OCR control")
    caption.frame = NSRect(x: 30, y: 240, width: 500, height: 30)
    let title = NSTextField(labelWithString: "CONTROL Allow “Python” to find devices on local networks?")
    title.frame = NSRect(x: 30, y: 180, width: 500, height: 40)
    title.font = NSFont.systemFont(ofSize: 16, weight: .bold)
    window.contentView?.addSubview(caption)
    window.contentView?.addSubview(title)
}
window.center()
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
// Even if the test runner disappears, this owned disposable app exits itself.
Timer.scheduledTimer(withTimeInterval: 90, repeats: false) { _ in app.terminate(nil) }
app.run()
