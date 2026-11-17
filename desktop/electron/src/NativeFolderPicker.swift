import AppKit
import Foundation

// This helper owns one panel and no NAC resources. Closing its dedicated stdin
// channel, including actual parent death, cancels the panel and exits.
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let panel = NSOpenPanel()
panel.title = "Choose a local project folder"
panel.canChooseDirectories = true
panel.canChooseFiles = false
panel.canCreateDirectories = false
panel.allowsMultipleSelection = false
panel.resolvesAliases = false
if CommandLine.arguments.count == 2 {
    let initial = CommandLine.arguments[1]
    if initial.hasPrefix("/"), initial.utf8.count <= 16_384, !initial.contains("\0") {
        panel.directoryURL = URL(fileURLWithPath: initial, isDirectory: true)
    }
}
var finished = false
func finish(_ path: String?) {
    guard !finished else { return }
    finished = true
    let result: [String: Any] = ["path": path as Any? ?? NSNull()]
    if let data = try? JSONSerialization.data(withJSONObject: result), data.count <= 20_480 {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    }
    application.stop(nil)
}
DispatchQueue.global().async {
    _ = try? FileHandle.standardInput.read(upToCount: 1)
    DispatchQueue.main.async {
        panel.cancel(nil)
        finish(nil)
    }
}
DispatchQueue.main.async {
    application.activate(ignoringOtherApps: true)
    panel.begin { response in
        finish(response == .OK ? panel.url?.path : nil)
    }
}
application.run()
