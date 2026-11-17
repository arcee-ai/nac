import AppKit
import Darwin

// Metadata only. No accessibility, pixels, input injection or permission prompt.
@main
enum WindowObserver {
    static func birth(_ app: NSRunningApplication) throws -> (UInt64, UInt64) {
        var info = proc_bsdinfo()
        let count = proc_pidinfo(app.processIdentifier, PROC_PIDTBSDINFO, 0, &info,
                                 Int32(MemoryLayout.size(ofValue: info)))
        guard count == MemoryLayout.size(ofValue: info), info.pbi_pid == UInt32(app.processIdentifier),
              info.pbi_start_tvsec > 0, info.pbi_start_tvusec < 1_000_000 else {
            throw NSError(domain: "NACPerformance", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Exact app birth unavailable"])
        }
        return (info.pbi_start_tvsec, info.pbi_start_tvusec)
    }

    static func rectangle(_ frame: CGRect) -> [String: Double] {
        ["x": frame.origin.x, "y": frame.origin.y, "width": frame.width, "height": frame.height]
    }

    static func windowMetadata(_ window: [String: Any]) -> [String: Any] {
        guard let values = window[kCGWindowBounds as String] as? [String: Any],
              let frame = CGRect(dictionaryRepresentation: values as CFDictionary) else {
            return ["display_metadata_available": false]
        }
        var ids = [CGDirectDisplayID](repeating: 0, count: 16)
        var count: UInt32 = 0
        guard CGGetDisplaysWithRect(frame, UInt32(ids.count), &ids, &count) == .success,
              count > 0, count < ids.count else {
            return ["bounds": rectangle(frame), "display_metadata_available": false]
        }
        let displays = ids.prefix(Int(count)).map { id -> [String: Any] in
            let bounds = CGDisplayBounds(id)
            let mode = CGDisplayCopyDisplayMode(id)
            return ["id": id, "bounds": rectangle(bounds),
                    "scale": mode.map { $0.width > 0 ? Double($0.pixelWidth) / Double($0.width) : 0 } ?? 0,
                    "refresh_hz": mode?.refreshRate ?? 0]
        }
        return ["bounds": rectangle(frame), "display_metadata_available": true, "displays": displays]
    }

    @MainActor static func main() throws {
        let args = CommandLine.arguments
        guard args.count >= 3 else { exit(64) }
        let bundle = URL(fileURLWithPath: args[2]).resolvingSymlinksInPath()
        let apps = NSWorkspace.shared.runningApplications.filter {
            !$0.isTerminated && $0.bundleURL?.resolvingSymlinksInPath() == bundle
        }
        var result: [String: Any] = [:]
        let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]]
        result["window_metadata_available"] = windows != nil
        result["apps"] = apps.map { app in
            guard let born = try? birth(app) else {
                return ["pid": app.processIdentifier, "identity_available": false] as [String: Any]
            }
            let owned = windows?.filter { window in
                (window[kCGWindowOwnerPID as String] as? Int32) == app.processIdentifier &&
                (window[kCGWindowLayer as String] as? Int) == 0 &&
                (window[kCGWindowIsOnscreen as String] as? Bool) == true
            } ?? []
            return ["pid": app.processIdentifier, "identity_available": true,
             "birth_sec": born.0, "birth_usec": born.1,
             "active": app.isActive, "hidden": app.isHidden,
             "visible_window": !owned.isEmpty,
             "native_windows": owned.map(windowMetadata)] as [String: Any]
        }
        if args[1] != "state" {
            guard args.count == 6, apps.count == 1,
                  let pid = Int32(args[3]), let seconds = UInt64(args[4]), let micros = UInt64(args[5]),
                  let app = apps.first, app.processIdentifier == pid,
                  try birth(app) == (seconds, micros) else { exit(65) }
            switch args[1] {
            case "hide": result["accepted"] = app.hide()
            case "activate": result["accepted"] = app.activate(options: [])
            case "terminate": result["accepted"] = app.terminate()
            default: exit(64)
            }
        }
        let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    }
}
