import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import IOKit

// Separate unsandboxed read-only witness. No AX setters/actions or input.
@main
struct LifecycleCaptureWitness {
    @MainActor static func main() throws {
        let configURL = URL(fileURLWithPath: CommandLine.arguments[1])
        let configBytes = try CapturePort.read(configURL)
        let session = try CapturePort.object(configBytes), configHash = CapturePort.hash(configBytes)
        let config = (session["cases"] as! [String: [String: Any]])[CommandLine.arguments[2]]!
        let port = URL(fileURLWithPath: config["port"] as! String)
        let nonce = config["nonce"] as! String
        let deadline = min(UInt64(config["deadline_ns"] as! String)!, CapturePort.nanos() + 350_000_000_000)
        let helperToken = UUID().uuidString
        var rootIdentity: AXUIElement?, rootToken = ""
        var sheets: [Int: AXUIElement] = [:], buttons: [Int: [AXUIElement]] = [:]
        var sheetTokens: [Int: String] = [:], buttonTokens: [Int: [String]] = [:]
        var appBirth: Date?, engineBirth: [UInt64]?, sequence: UInt64 = 0
        var lastOrdinal = 0
        var binaryStamps: [String: String] = [:]
        var appKernel: [UInt64]?
        func write(_ value: [String: Any], _ name: String) throws {
            let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
            try CapturePort.need(data.count <= 256 * 1024, "Witness size")
            let target = port.appendingPathComponent(name)
            let temp = port.appendingPathComponent(UUID().uuidString + ".tmp")
            let fd = open(temp.path, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0o400)
            try CapturePort.need(fd >= 0, "Witness exclusive publication")
            let written = data.withUnsafeBytes { Darwin.write(fd, $0.baseAddress, data.count) }
            let sync = fsync(fd); let closed = close(fd)
            try CapturePort.need(written == data.count && sync == 0 && closed == 0, "Witness publication incomplete")
            try CapturePort.need(rename(temp.path, target.path) == 0, "Witness atomic rename")
        }
        func attr(_ e: AXUIElement, _ name: String) throws -> CFTypeRef {
            var value: CFTypeRef?
            let code = AXUIElementCopyAttributeValue(e, name as CFString, &value)
            try CapturePort.need(code == .success && value != nil, "AX read refused: \(code.rawValue)")
            return value!
        }
        func elements(_ e: AXUIElement, _ name: String) throws -> [AXUIElement] {
            guard let values = try attr(e, name) as? [AXUIElement] else {
                throw NSError(domain: "LifecycleCapture", code: 5)
            }
            return values
        }
        func frame(_ e: AXUIElement) throws -> CGRect {
            let p = try attr(e, kAXPositionAttribute), s = try attr(e, kAXSizeAttribute)
            try CapturePort.need(CFGetTypeID(p) == AXValueGetTypeID() && CFGetTypeID(s) == AXValueGetTypeID(), "AX frame types")
            var point = CGPoint.zero, size = CGSize.zero
            let position = unsafeBitCast(p, to: AXValue.self), dimensions = unsafeBitCast(s, to: AXValue.self)
            try CapturePort.need(AXValueGetType(position) == .cgPoint && AXValueGetType(dimensions) == .cgSize
                && AXValueGetValue(position, .cgPoint, &point) && AXValueGetValue(dimensions, .cgSize, &size), "AX frame encoding")
            return CGRect(origin: point, size: size)
        }
        func values(_ r: CGRect) -> [Double] { [r.origin.x, r.origin.y, r.width, r.height] }
        func kernel(_ pid: Int32, path: String, parent: Int32) throws -> [UInt64] {
            var row = proc_bsdinfo(), pathBytes = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
            let size = Int32(MemoryLayout<proc_bsdinfo>.size), pathCapacity = UInt32(pathBytes.count)
            try CapturePort.need(proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &row, size) == size
                && row.pbi_uid == getuid() && row.pbi_ppid == UInt32(parent)
                && proc_pidpath(pid, &pathBytes, pathCapacity) > 0
                && String(cString: pathBytes) == path, "Exact process parent/executable/birth")
            return [UInt64(row.pbi_pid), row.pbi_start_tvsec, row.pbi_start_tvusec]
        }
        func getppidOf(_ pid: Int32) throws -> Int32 {
            var row = proc_bsdinfo(); let size = Int32(MemoryLayout<proc_bsdinfo>.size)
            try CapturePort.need(proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &row, size) == size, "App parent unavailable")
            return Int32(row.pbi_ppid)
        }
        func console() throws {
            let root = IORegistryGetRootEntry(kIOMainPortDefault)
            defer { if root != 0 { IOObjectRelease(root) } }
            try CapturePort.need(root != 0, "Console unavailable")
            let locked = IORegistryEntryCreateCFProperty(root, "IOConsoleLocked" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue()
            try CapturePort.need(locked != nil && CFGetTypeID(locked!) == CFBooleanGetTypeID()
                && CFEqual(locked!, kCFBooleanFalse), "Observed unlocked console required")
            guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else {
                throw NSError(domain: "LifecycleCapture", code: 6)
            }
            try CapturePort.need(session[kCGSessionOnConsoleKey as String] as? Bool == true
                && session[kCGSessionLoginDoneKey as String] as? Bool == true
                && (session[kCGSessionUserIDKey as String] as? NSNumber)?.uint32Value == getuid(), "Same console user")
            if let flag = session["CGSSessionScreenIsLocked"] {
                try CapturePort.need(CFGetTypeID(flag as CFTypeRef) == CFBooleanGetTypeID()
                    && CFEqual(flag as CFTypeRef, kCFBooleanFalse), "Console locked/malformed")
            }
            try CapturePort.need(NSScreen.screens.count == 1 && AXIsProcessTrusted(), "Display/AX trust unavailable; no prompt")
        }
        try console()
        try write(["schema": "lifecycle-witness-ready-v1", "nonce": nonce,
                   "configuration_sha256": configHash, "pid": getpid(), "helper_token": helperToken], "witness-ready.json")
        do {
            while CapturePort.nanos() < deadline {
                if FileManager.default.fileExists(atPath: port.appendingPathComponent("stop").path) {
                    let stop = try CapturePort.object(CapturePort.read(port.appendingPathComponent("stop")))
                    try CapturePort.need(stop["nonce"] as? String == nonce, "Cooperative stop nonce"); return
                }
                let ordinal = FileManager.default.fileExists(atPath: port.appendingPathComponent("request-2.json").path) ? 2 : 1
                if ordinal == 1 && FileManager.default.fileExists(atPath: port.appendingPathComponent("release-1.json").path) {
                    Thread.sleep(forTimeInterval: 0.02); continue // Phase retired; no AX resampling after provisional release.
                }
                let requestURL = port.appendingPathComponent("request-\(ordinal).json")
                if !FileManager.default.fileExists(atPath: requestURL.path) { Thread.sleep(forTimeInterval: 0.02); continue }
                var began = CapturePort.nanos()
                try CapturePort.need(CapturePort.hash(CapturePort.read(configURL)) == configHash, "Configuration changed")
                try console()
                let requestBytes = try CapturePort.read(requestURL), request = try CapturePort.object(requestBytes)
                try CapturePort.need(request["schema"] as? String == "lifecycle-request-v1"
                    && request["nonce"] as? String == nonce && request["configuration_sha256"] as? String == configHash
                    && request["case"] as? String == config["case"] as? String
                    && request["ordinal"] as? Int == ordinal && ordinal >= lastOrdinal && ordinal <= lastOrdinal + 1, "Request scope/order")
                let owner = request["binding"] as! [String: Any]
                let appPath = request["app_path"] as! String, nativePath = request["native_path"] as! String
                let caseRoot = config["case_root"] as! String
                try CapturePort.need(appPath.hasPrefix(caseRoot + "/nac-lifecycle-app-")
                    && appPath.hasSuffix("/Relocated app folder with spaces/NAC Lifecycle Smoke.app")
                    && nativePath == caseRoot + "/" + (config["case"] as! String) + "/native.json", "Known current fixture paths")
                let nativeBytes = try CapturePort.read(URL(fileURLWithPath: nativePath))
                let native = try CapturePort.object(nativeBytes)
                let phase = ordinal == 1 ? "confirming" : "reconfirming"
                let key = ordinal == 1 ? "restored-minimize-quit" : "restored-minimize-quit-again"
                let episode = native[key] as! [String: Any]
                try CapturePort.need(native["stage"] as? String == phase && owner["phase"] as? String == phase
                    && owner["ready_source"] as? String == config["P"] as? String
                    && native["application_class"] as? String == "NACApplication", "Native current phase/source/class")
                for field in ["app_pid", "engine_pid", "workspace_window_number", "launch_incarnation", "ready_source", "ready_store", "quit_confirmation_decisions", "quit_sheet_presentations", "quit_cancel_choices", "quit_stop_completions"] {
                    let a = try JSONSerialization.data(withJSONObject: [owner[field] ?? NSNull()], options: [.sortedKeys])
                    let b = try JSONSerialization.data(withJSONObject: [native[field] ?? NSNull()], options: [.sortedKeys])
                    try CapturePort.need(a == b, "Native owner changed")
                }
                for field in ["confirmation_id", "sheet_window", "document"] {
                    try CapturePort.need(NSDictionary(dictionary: ["v": owner[field]!]).isEqual(to: ["v": episode[field]!]), "Confirmation changed")
                }
                let pid = pid_t(owner["app_pid"] as! Int), engine = pid_t(owner["engine_pid"] as! Int)
                let running = NSRunningApplication(processIdentifier: pid)
                guard let running, let birth = running.launchDate else { throw NSError(domain: "LifecycleCapture", code: 7) }
                try CapturePort.need(!running.isTerminated && running.bundleURL?.path == appPath
                    && running.executableURL?.path == appPath + "/Contents/MacOS/NACPreview"
                    && running.bundleIdentifier == config["bundle_id"] as? String
                    && NSWorkspace.shared.frontmostApplication?.processIdentifier == pid, "App/front incarnation")
                try CapturePort.need(appBirth == nil || appBirth == birth, "App generation replaced"); appBirth = birth
                let firstBinaryAdmission = binaryStamps.isEmpty
                for (name, relative) in [("native_sha256", "Contents/MacOS/NACPreview"), ("engine_sha256", "Contents/Resources/nac-web")] {
                    let url = URL(fileURLWithPath: appPath).appendingPathComponent(relative)
                    let stamp = try CapturePort.binary(url, expected: firstBinaryAdmission ? config[name] as? String : nil)
                    try CapturePort.need(binaryStamps[name] == nil || binaryStamps[name] == stamp, "Original binary generation changed")
                    binaryStamps[name] = stamp
                }
                if firstBinaryAdmission { began = CapturePort.nanos(); try console() }
                let currentApp = try kernel(pid, path: appPath + "/Contents/MacOS/NACPreview", parent: try getppidOf(pid))
                try CapturePort.need(appKernel == nil || appKernel == currentApp, "App kernel generation replaced"); appKernel = currentApp
                let currentEngine = try kernel(engine, path: appPath + "/Contents/Resources/nac-web", parent: pid)
                try CapturePort.need(engineBirth == nil || engineBirth == currentEngine, "Engine generation replaced"); engineBirth = currentEngine
                let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
                let owned = windows.filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid && $0[kCGWindowLayer as String] as? Int == 0 }
                let rootRows = owned.filter { $0[kCGWindowNumber as String] as? Int == owner["workspace_window_number"] as? Int }
                let sheetRows = owned.filter { $0[kCGWindowNumber as String] as? Int == owner["sheet_window"] as? Int }
                try CapturePort.need(owned.count == 2 && rootRows.count == 1 && sheetRows.count == 1, "Exact lifecycle workspace/sheet CG roles")
                func bounds(_ row: [String: Any]) throws -> CGRect {
                    guard let value = row[kCGWindowBounds as String],
                          CFGetTypeID(value as CFTypeRef) == CFDictionaryGetTypeID() else { throw NSError(domain: "LifecycleCapture", code: 8) }
                    let data = unsafeBitCast(value as CFTypeRef, to: CFDictionary.self)
                    guard let rectangle = CGRect(dictionaryRepresentation: data) else { throw NSError(domain: "LifecycleCapture", code: 8) }
                    return rectangle
                }
                let rootFrame = try bounds(rootRows[0]), sheetFrame = try bounds(sheetRows[0]), screen = CGDisplayBounds(CGMainDisplayID())
                try CapturePort.need(screen.contains(rootFrame) && screen.contains(sheetFrame), "Main screen contains both surfaces")
                let sheetIndex = windows.firstIndex { $0[kCGWindowNumber as String] as? Int == owner["workspace_window_number"] as? Int }!
                for row in windows.prefix(sheetIndex) where (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value != pid {
                    let area = try bounds(row)
                    try CapturePort.need(!area.intersects(rootFrame.union(sheetFrame)), "Unexpected higher occluder")
                }
                let axApp = AXUIElementCreateApplication(pid)
                try CapturePort.need(AXUIElementSetMessagingTimeout(axApp, 0.1) == .success, "AX timeout setup")
                let roots = try elements(axApp, kAXWindowsAttribute).filter { try frame($0) == rootFrame }
                try CapturePort.need(roots.count == 1, "Exact AX workspace")
                let root = roots[0]
                if let previous = rootIdentity { try CapturePort.need(CFEqual(previous, root), "CFEqual workspace replaced") }
                else { rootIdentity = root; rootToken = UUID().uuidString }
                let candidates = try elements(root, kAXChildrenAttribute).filter { (try attr($0, kAXRoleAttribute)) as? String == "AXSheet" }
                try CapturePort.need(candidates.count == 1 && (try frame(candidates[0])) == sheetFrame, "Exact attached AX sheet")
                let sheet = candidates[0]
                let children = try elements(sheet, kAXChildrenAttribute)
                let controls = try ["Cancel", "Stop and Quit"].map { title -> AXUIElement in
                    let found = try children.filter {
                        guard (try attr($0, kAXRoleAttribute)) as? String == "AXButton" else { return false }
                        return (try attr($0, kAXTitleAttribute)) as? String == title
                    }
                    try CapturePort.need(found.count == 1, "Exact sheet controls"); return found[0]
                }
                for button in controls {
                    let enabled = try attr(button, kAXEnabledAttribute), buttonFrame = try frame(button)
                    try CapturePort.need(CFGetTypeID(enabled) == CFBooleanGetTypeID() && CFEqual(enabled, kCFBooleanTrue)
                        && sheetFrame.contains(buttonFrame), "Exact enabled contained sheet control")
                }
                if let old = sheets[ordinal] {
                    try CapturePort.need(CFEqual(old, sheet) && zip(buttons[ordinal]!, controls).allSatisfy { CFEqual($0.0, $0.1) }, "CFEqual sheet/control replaced")
                } else {
                    sheets[ordinal] = sheet; buttons[ordinal] = controls; sheetTokens[ordinal] = UUID().uuidString
                    buttonTokens[ordinal] = [UUID().uuidString, UUID().uuidString]
                }
                try CapturePort.need(CapturePort.hash(CapturePort.read(URL(fileURLWithPath: nativePath))) == CapturePort.hash(nativeBytes), "Native phase changed across witness sample")
                try CapturePort.need(NSWorkspace.shared.frontmostApplication?.processIdentifier == pid
                    && running.launchDate == birth && !running.isTerminated
                    && (try kernel(engine, path: appPath + "/Contents/Resources/nac-web", parent: pid)) == currentEngine
                    && (try kernel(pid, path: appPath + "/Contents/MacOS/NACPreview", parent: try getppidOf(pid))) == currentApp,
                    "Closing process/front generation")
                for (name, relative) in [("native_sha256", "Contents/MacOS/NACPreview"), ("engine_sha256", "Contents/Resources/nac-web")] {
                    try CapturePort.need(try CapturePort.binary(URL(fileURLWithPath: appPath).appendingPathComponent(relative)) == binaryStamps[name], "Closing binary generation")
                }
                let ended = CapturePort.nanos(); sequence += 1; lastOrdinal = ordinal
                try CapturePort.need(ended >= began && ended - began <= 1_000_000_000, "Total witness sample cap")
                try write(["schema": "lifecycle-proof-v1", "status": "ready", "nonce": nonce,
                    "configuration_sha256": configHash, "ordinal": ordinal, "sequence": String(sequence),
                    "began_ns": String(began), "ended_ns": String(ended), "helper_token": helperToken,
                    "request_sha256": CapturePort.hash(requestBytes), "owner": owner, "app_path": appPath,
                    "root_token": rootToken, "sheet_token": sheetTokens[ordinal]!,
                    "cancel_token": buttonTokens[ordinal]![0], "stop_token": buttonTokens[ordinal]![1],
                    "root_frame": values(rootFrame), "sheet_frame": values(sheetFrame),
                    "cancel_frame": values(try frame(controls[0])), "stop_frame": values(try frame(controls[1])),
                    "screen_frame": values(screen), "engine_birth": currentEngine,
                    "app_launch_epoch": birth.timeIntervalSince1970], "proof-\(ordinal).json")
                Thread.sleep(forTimeInterval: 0.02)
            }
            throw NSError(domain: "LifecycleCapture", code: 9, userInfo: [NSLocalizedDescriptionKey: "Original witness cutoff"])
        } catch {
            try? write(["status": "refused", "nonce": nonce, "configuration_sha256": configHash,
                        "failure": String(describing: error)], "failure.json")
            throw error // Sticky terminal refusal, never poll AX to obtain a later positive.
        }
    }
}
