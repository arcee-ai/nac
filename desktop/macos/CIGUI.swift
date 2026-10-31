// Read-only session diagnostics. No activation, unlock, input or TCC changes.
import AppKit
import CoreGraphics

let session = CGSessionCopyCurrentDictionary() as? [String: Any]
let report: [String: Any] = [
    "quartz_session_available": session != nil,
    "on_console": session?[kCGSessionOnConsoleKey as String] ?? NSNull(),
    "login_done": session?[kCGSessionLoginDoneKey as String] ?? NSNull(),
    "screen_is_locked": session?["CGSSessionScreenIsLocked"] ?? NSNull(),
    "screen_count": NSScreen.screens.count,
    "frontmost_bundle": NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "unavailable"
]
let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))
