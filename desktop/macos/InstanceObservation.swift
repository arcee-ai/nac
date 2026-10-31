import AppKit

/// Read only this fixture's app identities and the permitted prior frontmost
/// identity. No accessibility, screen capture or input events. Quit/crash
/// controls require an exact live app incarnation and bundle URL.
@main
enum InstanceObservation {
    @MainActor
    static func console() -> [String: Any] {
        let session = CGSessionCopyCurrentDictionary() as? [String: Any]
        let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]]
        var result: [String: Any] = [
            "session_available": session != nil, "window_list_available": windows != nil,
            "screen_count": NSScreen.screens.count,
            "session": [
                "uid": session?[kCGSessionUserIDKey as String] ?? NSNull(),
                "on_console": session?[kCGSessionOnConsoleKey as String] ?? NSNull(),
                "login_done": session?[kCGSessionLoginDoneKey as String] ?? NSNull(),
                "screen_is_locked": session?["CGSSessionScreenIsLocked"] ?? NSNull()
            ],
            // Window metadata only; never read titles, pixels or input permissions.
            "windows": windows?.map { window in [
                "owner": window[kCGWindowOwnerName as String] ?? NSNull(),
                "pid": window[kCGWindowOwnerPID as String] ?? NSNull(),
                "on_screen": window[kCGWindowIsOnscreen as String] ?? NSNull(),
                "layer": window[kCGWindowLayer as String] ?? NSNull()
            ] } as Any? ?? NSNull()
        ]
        if let front = NSWorkspace.shared.frontmostApplication {
            result["frontmost"] = identity(front).merging(["name": front.localizedName ?? ""]) { _, new in new }
        } else { result["frontmost"] = NSNull() }
        return result
    }

    static func identity(_ app: NSRunningApplication) -> [String: Any] {
        ["pid": app.processIdentifier, "bundle": app.bundleIdentifier ?? "",
         "launch_time": app.launchDate?.timeIntervalSince1970 ?? -1]
    }

    static func matches(_ app: NSRunningApplication, _ value: [String: Any]) -> Bool {
        !app.isTerminated && app.processIdentifier == (value["pid"] as? Int32) &&
        app.bundleIdentifier == (value["bundle"] as? String) &&
        app.launchDate?.timeIntervalSince1970 == (value["launch_time"] as? Double)
    }

    @MainActor
    static func main() throws {
        let arguments = CommandLine.arguments
        var result: [String: Any] = [:]
        switch arguments[1] {
        case "console":
            result = console()
        case "state":
            let bundle = URL(fileURLWithPath: arguments[2]).resolvingSymlinksInPath()
            result["apps"] = NSWorkspace.shared.runningApplications.filter {
                !$0.isTerminated && $0.bundleURL?.resolvingSymlinksInPath() == bundle
            }.map(identity)
            if let front = NSWorkspace.shared.frontmostApplication { result["frontmost"] = identity(front) }
        case "restore":
            let original = try JSONSerialization.jsonObject(with: Data(arguments[2].utf8)) as! [String: Any]
            let fixture = try JSONSerialization.jsonObject(with: Data(arguments[3].utf8)) as! [String: Any]
            if let front = NSWorkspace.shared.frontmostApplication, matches(front, fixture),
               let pid = original["pid"] as? Int32,
               let target = NSRunningApplication(processIdentifier: pid), matches(target, original) {
                result["restored"] = target.activate(options: [])
            } else { result["restored"] = false }
        case "terminate", "crash":
            let bundle = URL(fileURLWithPath: arguments[2]).resolvingSymlinksInPath()
            let fixture = try JSONSerialization.jsonObject(with: Data(arguments[3].utf8)) as! [String: Any]
            if let pid = fixture["pid"] as? Int32, let target = NSRunningApplication(processIdentifier: pid),
               matches(target, fixture), target.bundleURL?.resolvingSymlinksInPath() == bundle {
                result["termination_requested"] = arguments[1] == "crash" ? target.forceTerminate() : target.terminate()
            } else { result["termination_requested"] = false }
        default:
            throw NSError(domain: "InstanceObservation", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Unsupported fixture observation"])
        }
        let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    }
}
