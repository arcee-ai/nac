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
    "event_post_access": CGPreflightPostEventAccess(),
    "system_webkit_build": Bundle(path: "/System/Library/Frameworks/WebKit.framework")?.infoDictionary?["CFBundleVersion"] ?? "unavailable",
    "safari_version": Bundle(path: "/Applications/Safari.app")?.infoDictionary?["CFBundleShortVersionString"] ?? "unavailable",
    "safari_build": Bundle(path: "/Applications/Safari.app")?.infoDictionary?["CFBundleVersion"] ?? "unavailable",
    "frontmost_bundle": NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "unavailable"
]
let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))
