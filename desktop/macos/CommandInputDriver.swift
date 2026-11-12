import AppKit
import CoreGraphics
import CryptoKit
import Darwin
import Foundation
import IOKit

// Test-only OS event owner. It never requests privacy access or changes TCC.
// The app publishes a bounded phase; this process checks the exact app and
// posts to that PID. The app independently verifies the resulting WK events.
#if !COMMAND_DRIVER_TEST
@main
#endif
struct CommandInputDriver {
    static let phases = ["type-fixture", "copy", "cut", "paste", "undo", "redo",
                         "settings", "close-settings", "new-session", "close-new-session"]
    static let limit = 4096

    static func main() throws {
        guard CommandLine.arguments.count == 4 else {
            throw Failure("usage: CommandInputDriver <owned evidence directory> <relocated app> <source sha>")
        }
        let root = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
        let app = URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL
        let source = CommandLine.arguments[3]
        guard source.count == 40, source.allSatisfy({ $0.isHexDigit }) else { throw Failure("Invalid source identity") }
        let descriptor = open(root.path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
        guard descriptor >= 0 else { throw Failure("Owned evidence directory unavailable") }
        defer { close(descriptor) }
        var directoryInfo = stat()
        guard fstat(descriptor, &directoryInfo) == 0, directoryInfo.st_uid == getuid() else {
            throw Failure("Evidence directory is not owned by this runner")
        }
        let expected = try buildIdentity(app: app, source: source)
        guard CGPreflightPostEventAccess() else { throw Failure("Existing OS event-post access unavailable") }
        let deadline = Date().addingTimeInterval(110)
        var binding: Binding?
        for (index, phase) in phases.enumerated() {
            let row = try awaitPhase(descriptor, sequence: index + 1, phase: phase, deadline: deadline)
            let next = try validate(row, index: index, expected: expected)
            if let binding {
                guard binding == next else { throw Failure("Command phase changed the app owner") }
            } else {
                binding = next
            }
            try requireLiveOwner(next, app: app)
            try post(phase, pid: next.pid, app: app, owner: next)
            try requireLiveOwner(next, app: app)
            var acknowledgement = row
            acknowledgement["kind"] = "attempted"
            try write(descriptor, name: "commands-input-ack.json", value: acknowledgement)
        }
        guard let binding else { throw Failure("No command phases") }
        try awaitFinish(descriptor, binding: binding, expected: expected, deadline: deadline)
        print("Exact-app external OS command input completed; the app verified trusted WK events")
    }

    struct Failure: Error, CustomStringConvertible {
        let description: String
        init(_ description: String) { self.description = description }
    }
    struct Identity {
        let source: String
        let native: String
        let engine: String
    }
    struct Binding: Equatable {
        let episode: String
        let pid: pid_t
        let window: Int
        let launch: String
        let view: String
        let document: String
    }

    static func fileDigest(_ url: URL) throws -> String {
        var info = stat()
        guard lstat(url.path, &info) == 0,
              (info.st_mode & 0o170000) == 0o100000 else {
            throw Failure("App input is not a regular nonlinked file")
        }
        let bytes = try Data(contentsOf: url)
        return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }

    static func buildIdentity(app: URL, source: String) throws -> Identity {
        let receipt = app.appendingPathComponent("Contents/Resources/build-receipt.json")
        let data = try Data(contentsOf: receipt)
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              value["source_head"] as? String == source,
              value["mode"] as? String == "smoke",
              value["smoke_instrumentation"] as? Bool == true,
              value["source_dirty"] as? Bool == false,
              let native = value["native_sha256"] as? String,
              let engine = value["engine_sha256"] as? String,
              native == (try fileDigest(app.appendingPathComponent("Contents/MacOS/NACPreview"))),
              engine == (try fileDigest(app.appendingPathComponent("Contents/Resources/nac-web"))) else {
            throw Failure("Relocated app does not match its exact clean smoke build")
        }
        return Identity(source: source, native: native, engine: engine)
    }

    static func read(_ directory: Int32, name: String) throws -> [String: Any]? {
        let fd = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        if fd < 0 && errno == ENOENT { return nil }
        guard fd >= 0 else { throw Failure("Command phase cannot be safely opened") }
        defer { close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, (info.st_mode & 0o170000) == 0o100000,
              info.st_uid == getuid(), info.st_size > 0, info.st_size <= limit else {
            throw Failure("Command phase is not an owned bounded regular file")
        }
        var bytes = [UInt8](repeating: 0, count: limit + 1)
        let count = Darwin.read(fd, &bytes, bytes.count)
        guard count > 0, count <= limit,
              let value = try JSONSerialization.jsonObject(with: Data(bytes.prefix(count))) as? [String: Any] else {
            throw Failure("Command phase is malformed")
        }
        return value
    }

    static func strictInt(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let integer = number.intValue
        return number.stringValue == String(integer) ? integer : nil
    }

    static func validate(_ row: [String: Any], index: Int, expected: Identity) throws -> Binding {
        let keys: Set<String> = ["version", "episode", "pid", "window", "launch", "view", "document",
                                 "source", "native_sha256", "engine_sha256", "sequence", "phase",
                                 "verified_phases", "kind"]
        guard Set(row.keys) == keys, strictInt(row["version"]) == 1,
              strictInt(row["sequence"]) == index + 1,
              row["phase"] as? String == phases[index], row["kind"] as? String == "ready",
              row["verified_phases"] as? [String] == Array(phases.prefix(index)),
              row["source"] as? String == expected.source,
              row["native_sha256"] as? String == expected.native,
              row["engine_sha256"] as? String == expected.engine,
              let episode = row["episode"] as? String, UUID(uuidString: episode) != nil,
              let pid = strictInt(row["pid"]), pid > 0, pid <= Int(Int32.max),
              let window = strictInt(row["window"]), window > 0,
              let launch = row["launch"] as? String, !launch.isEmpty,
              let view = row["view"] as? String, !view.isEmpty,
              let document = row["document"] as? String, !document.isEmpty else {
            throw Failure("Command phase identity or order mismatch")
        }
        return Binding(episode: episode, pid: pid_t(pid), window: window,
                       launch: launch, view: view, document: document)
    }

    static func awaitPhase(_ directory: Int32, sequence: Int, phase: String, deadline: Date) throws -> [String: Any] {
        while Date() < deadline {
            if let row = try read(directory, name: "commands-input-phase.json") {
                if strictInt(row["sequence"]) == sequence && row["phase"] as? String == phase
                    && row["kind"] as? String == "ready" { return row }
                if sequence > 1, let previous = strictInt(row["sequence"]), previous == sequence - 1,
                   row["phase"] as? String == phases[previous - 1],
                   ["ready", "settled"].contains(row["kind"] as? String ?? "") {
                    Thread.sleep(forTimeInterval: 0.02)
                    continue
                }
                throw Failure("Unexpected or stale command phase")
            }
            Thread.sleep(forTimeInterval: 0.02)
        }
        throw Failure("Timed out waiting for exact command phase")
    }

    static func requireLiveOwner(_ owner: Binding, app: URL) throws {
        guard CGPreflightPostEventAccess(),
              let running = NSRunningApplication(processIdentifier: owner.pid),
              running.bundleURL?.resolvingSymlinksInPath() == app.resolvingSymlinksInPath(),
              NSWorkspace.shared.frontmostApplication?.processIdentifier == owner.pid,
              let session = CGSessionCopyCurrentDictionary() as? [String: Any],
              session[kCGSessionOnConsoleKey as String] as? Bool == true,
              session[kCGSessionLoginDoneKey as String] as? Bool == true,
              session["CGSSessionScreenIsLocked"] as? Bool != true else {
            throw Failure("External driver lost exact frontmost app or OS event access")
        }
        let root = IORegistryGetRootEntry(kIOMainPortDefault)
        guard root != 0 else { throw Failure("Console lock observation unavailable") }
        defer { IOObjectRelease(root) }
        let locked = IORegistryEntryCreateCFProperty(root, "IOConsoleLocked" as CFString,
                                                     kCFAllocatorDefault, 0)?.takeRetainedValue() as? Bool
        let rows = IORegistryEntryCreateCFProperty(root, "IOConsoleUsers" as CFString,
                                                   kCFAllocatorDefault, 0)?.takeRetainedValue() as? [[String: Any]] ?? []
        guard locked == false, !rows.contains(where: { $0["CGSSessionScreenIsLocked"] as? Bool == true }),
              rows.contains(where: { ($0["kCGSSessionUserIDKey"] as? NSNumber)?.uint32Value == getuid()
                  && $0["kCGSSessionOnConsoleKey"] as? Bool == true
                  && $0["kCGSessionLoginDoneKey"] as? Bool == true }) else {
            throw Failure("External driver lost owned unlocked console")
        }
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] ?? []
        guard windows.contains(where: { $0[kCGWindowNumber as String] as? Int == owner.window
            && $0[kCGWindowOwnerPID as String] as? Int == Int(owner.pid) }) else {
            throw Failure("Exact app window is not on screen")
        }
    }

    static func pair(_ code: CGKeyCode, flags: CGEventFlags, pid: pid_t, text: String? = nil) throws {
        guard CGPreflightPostEventAccess(), let source = CGEventSource(stateID: .privateState),
              let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else {
            throw Failure("OS event-post access unavailable; no event sent")
        }
        down.flags = flags
        up.flags = []
        if let text {
            let units = Array(text.utf16)
            units.withUnsafeBufferPointer {
                down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: $0.baseAddress!)
                up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: $0.baseAddress!)
            }
        }
        // Keep the matching key-up bound to the same PID even if focus changes.
        defer { up.postToPid(pid) }
        down.postToPid(pid)
    }

    static func post(_ phase: String, pid: pid_t, app: URL, owner: Binding) throws {
        func key(_ code: CGKeyCode, _ flags: CGEventFlags = [], text: String? = nil) throws {
            try requireLiveOwner(owner, app: app)
            try pair(code, flags: flags, pid: pid, text: text)
        }
        switch phase {
        case "type-fixture":
            try key(0, .maskCommand)
            for character in "NAC_NATIVE_EDIT_FIXTURE" {
                try key(0, text: String(character))
                Thread.sleep(forTimeInterval: 0.02)
            }
        case "copy": try key(0, .maskCommand); try key(8, .maskCommand)
        case "cut": try key(7, .maskCommand)
        case "paste": try key(9, .maskCommand)
        case "undo": try key(6, .maskCommand)
        case "redo": try key(6, [.maskCommand, .maskShift])
        case "settings": try key(43, .maskCommand)
        case "close-settings", "close-new-session": try key(53)
        case "new-session": try key(45, .maskCommand)
        default: throw Failure("Unknown input phase")
        }
    }

    static func write(_ directory: Int32, name: String, value: [String: Any]) throws {
        let bytes = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        guard bytes.count <= limit else { throw Failure("Command acknowledgement exceeds bounds") }
        let temporary = ".commands-ack-" + UUID().uuidString
        let fd = openat(directory, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw Failure("Command acknowledgement cannot be created") }
        defer { close(fd); unlinkat(directory, temporary, 0) }
        let count = bytes.withUnsafeBytes { Darwin.write(fd, $0.baseAddress, $0.count) }
        guard count == bytes.count, renameat(directory, temporary, directory, name) == 0 else {
            throw Failure("Command acknowledgement could not be published")
        }
    }

    static func awaitFinish(_ directory: Int32, binding: Binding, expected: Identity, deadline: Date) throws {
        while Date() < deadline {
            if let row = try read(directory, name: "commands-input-phase.json"),
               strictInt(row["sequence"]) == phases.count,
               row["phase"] as? String == phases.last,
               row["kind"] as? String == "finished" {
                let keys: Set<String> = ["version", "episode", "pid", "window", "launch", "view", "document",
                                         "source", "native_sha256", "engine_sha256", "sequence", "phase",
                                         "verified_phases", "kind", "accepted"]
                guard Set(row.keys) == keys, strictInt(row["version"]) == 1,
                      row["accepted"] as? Bool == true,
                      row["verified_phases"] as? [String] == phases,
                      row["episode"] as? String == binding.episode,
                      strictInt(row["pid"]) == Int(binding.pid),
                      strictInt(row["window"]) == binding.window,
                      row["launch"] as? String == binding.launch,
                      row["view"] as? String == binding.view,
                      row["document"] as? String == binding.document,
                      row["source"] as? String == expected.source,
                      row["native_sha256"] as? String == expected.native,
                      row["engine_sha256"] as? String == expected.engine else {
                    throw Failure("App did not accept exact trusted OS input")
                }
                return
            }
            Thread.sleep(forTimeInterval: 0.02)
        }
        throw Failure("App did not publish accepted input result")
    }
}
