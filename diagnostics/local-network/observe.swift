// Passive, value-free bounded classification. Never request access or issue input.
import AppKit
import ApplicationServices
import Foundation

func matchesKnownDialog(_ value: String) -> Bool {
    let normalized = value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        .replacingOccurrences(of: "“", with: "\"")
        .replacingOccurrences(of: "”", with: "\"")
    return normalized == "Allow \"Python\" to find devices on local networks?"
}

if CommandLine.arguments == [CommandLine.arguments[0], "--self-test"] {
    precondition(matchesKnownDialog("Allow “Python” to find devices on local networks?"))
    precondition(matchesKnownDialog("Allow \"Python\" to find devices\non local networks?"))
    precondition(!matchesKnownDialog("Prefix Allow “Python” to find devices on local networks?"))
    precondition(!matchesKnownDialog("Allow “Python” to find devices on local networks? Suffix"))
    precondition(!matchesKnownDialog("Allow “Python” to find other devices on local networks?"))
    precondition(!matchesKnownDialog("Allow “Python” to find devices on local networks"))
    print("matcher controls passed")
    exit(0)
}

func knownDialog(_ pid: pid_t) -> Bool {
    let root = AXUIElementCreateApplication(pid)
    var queue = [root]
    var index = 0
    let deadline = ProcessInfo.processInfo.systemUptime + 0.6
    // Only the foreground notification center is examined. Values are used
    // transiently, never logged, and only one exact message can match.
    while index < queue.count && index < 48 && ProcessInfo.processInfo.systemUptime < deadline {
        let element = queue[index]
        index += 1
        AXUIElementSetMessagingTimeout(element, 0.05)
        for attribute in [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute] {
            if ProcessInfo.processInfo.systemUptime >= deadline { return false }
            var raw: CFTypeRef?
            if AXUIElementCopyAttributeValue(element, attribute as CFString, &raw) == .success,
               ProcessInfo.processInfo.systemUptime < deadline,
               let value = raw as? String, value.utf8.count <= 1024, matchesKnownDialog(value) {
                return true
            }
        }
        if ProcessInfo.processInfo.systemUptime >= deadline { return false }
        var raw: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &raw) == .success,
           let children = raw as? [AXUIElement] {
            queue.append(contentsOf: children.prefix(max(0, 48 - queue.count)))
        }
    }
    return false
}

while true {
    let front = NSWorkspace.shared.frontmostApplication
    if front?.bundleIdentifier == "com.apple.UserNotificationCenter" {
        print(knownDialog(front!.processIdentifier) ? "network_dialog_detected" : "notification_center_frontmost")
    } else {
        print(front == nil ? "unknown" : "other_frontmost")
    }
    fflush(stdout)
    Thread.sleep(forTimeInterval: 0.5)
}
