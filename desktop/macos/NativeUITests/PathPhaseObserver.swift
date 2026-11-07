import Foundation
import CryptoKit
import Darwin

/// H-owned known-file reader. The actual T helper is a separate compiler input.
@MainActor
final class PathPhaseObserver {
    static let product = "7013a96f2f2fdf3046c6976e018c9bf988eebfe0"
    let path: URL
    let parent: URL
    let parentIdentity: (UInt64, UInt64)
    let scope: NativePathJourney.Scope
    private(set) var history: [[String: Any]] = []
    private var latest: [String: Any]?
    static let fields: Set<String> = ["version", "name", "sequence", "run", "source", "app_pid", "window", "engine_pid", "operation", "launch", "view", "document"]

    static func need(_ condition: Bool, _ message: String) throws {
        guard condition else { throw NSError(domain: "NAC354Paths", code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]) }
    }
    static func hash(_ url: URL) throws -> String {
        SHA256.hash(data: try Data(contentsOf: url)).map { String(format: "%02x", $0) }.joined()
    }
    static func directory(_ url: URL) throws -> stat {
        var info = stat()
        try need(url.isFileURL && url.path == url.resolvingSymlinksInPath().path
            && lstat(url.path, &info) == 0 && info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR)
            && info.st_uid == getuid() && info.st_mode & 0o077 == 0, "Evidence parent is not canonical private owned directory")
        return info
    }
    static func record(_ url: URL, parent: URL, identity: (UInt64, UInt64)) throws -> [String: Any] {
        let before = try directory(parent)
        try need(url.deletingLastPathComponent() == parent && (UInt64(before.st_dev), before.st_ino) == identity,
                 "Evidence parent/path changed")
        let directoryFD = open(parent.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        try need(directoryFD >= 0, "Cannot open known evidence parent")
        defer { close(directoryFD) }
        var held = stat()
        try need(fstat(directoryFD, &held) == 0 && held.st_dev == before.st_dev && held.st_ino == before.st_ino,
                 "Evidence parent replaced during open")
        let fd = openat(directoryFD, url.lastPathComponent, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        try need(fd >= 0, "Cannot read known app evidence file")
        defer { close(fd) }
        var first = stat(), last = stat()
        try need(fstat(fd, &first) == 0 && first.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG) && first.st_uid == getuid()
                    && first.st_nlink == 1 && first.st_size > 0 && first.st_size <= 256 * 1024,
                 "Evidence file is nonregular/oversized/unowned")
        var bytes = [UInt8](repeating: 0, count: Int(first.st_size) + 1)
        var count = 0
        let capacity = bytes.count
        while count < capacity {
            let readCount = bytes.withUnsafeMutableBytes { buffer in
                Darwin.read(fd, buffer.baseAddress!.advanced(by: count), capacity - count)
            }
            try need(readCount >= 0, "Evidence read failed")
            if readCount == 0 { break }
            count += readCount
        }
        try need(fstat(fd, &last) == 0 && first.st_dev == last.st_dev && first.st_ino == last.st_ino
                    && first.st_size == last.st_size && count == Int(first.st_size)
                    && first.st_mtimespec.tv_sec == last.st_mtimespec.tv_sec
                    && first.st_mtimespec.tv_nsec == last.st_mtimespec.tv_nsec
                    && first.st_ctimespec.tv_sec == last.st_ctimespec.tv_sec
                    && first.st_ctimespec.tv_nsec == last.st_ctimespec.tv_nsec,
                 "Evidence mutated during read")
        let after = try directory(parent)
        try need(after.st_dev == before.st_dev && after.st_ino == before.st_ino, "Evidence parent replaced during read")
        let data = Data(bytes.prefix(count))
        try UniqueJSON.check(data)
        guard let record = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NSError(domain: "NAC354PathsJSON", code: 1)
        }
        return record
    }
    init(path: URL, scope: NativePathJourney.Scope) throws {
        self.path = path
        self.parent = path.deletingLastPathComponent()
        let info = try Self.directory(parent)
        parentIdentity = (UInt64(info.st_dev), info.st_ino)
        self.scope = scope
    }
    func read() throws -> [String: Any] { try Self.record(path, parent: parent, identity: parentIdentity) }
    func observe() throws -> NativePathJourney.Phase {
        let record = try read()
        try Self.need(record["error"] == nil && record["passed"] as? Bool != false, "App rejected path journey")
        guard let phase = record["paths_phase"] as? [String: Any] else {
            throw NSError(domain: "NAC354PathsPhase", code: 1)
        }
        try Self.need(Set(phase.keys) == Self.fields, "Unknown/missing phase fields")
        let data = try JSONSerialization.data(withJSONObject: phase, options: [.sortedKeys])
        let value = try JSONDecoder().decode(NativePathJourney.Phase.self, from: data)
        let order = scope.operation == "select-reload-create-reveal"
            ? ["ready", "document-reloaded", "folder-moved", "folder-restored", "reveal-observed"]
            : ["ready", "failure-panel-observed"]
        try Self.need(["select-reload-create-reveal", "pending-engine-failure"].contains(scope.operation)
            && value.version == 1 && order.indices.contains(value.sequence) && order[value.sequence] == value.name.rawValue
            && value.run == scope.run && value.source == Self.product && value.source == scope.source
            && value.app_pid == scope.app_pid && value.window == scope.window && value.engine_pid == scope.engine_pid
            && value.operation == scope.operation && value.launch == scope.launch && value.view == scope.view,
            "Phase source/process/window/run/launch/view/operation differs")
        if let latest, value.sequence == latest["sequence"] as? Int {
            try Self.need(NSDictionary(dictionary: latest).isEqual(NSDictionary(dictionary: phase)), "Same sequence mutation")
            return value
        }
        try Self.need(value.sequence == (latest?["sequence"] as? Int ?? -1) + 1, "Skipped or backward phase")
        if value.name == .documentReloaded {
            try Self.need(UUID(uuidString: value.document) != nil && value.document != scope.document, "Invalid successor document")
        } else {
            try Self.need(value.document == (latest?["document"] as? String ?? scope.document), "Unexpected document replacement")
        }
        latest = phase
        history.append(phase)
        return value
    }
}

/// Duplicate-key rejection before Foundation decoding, with fixed JSON depth.
/// The system parser still owns JSON syntax, number and escape validation.
@MainActor
private enum UniqueJSON {
    static func check(_ data: Data) throws {
        let bytes = Array(data)
        var i = 0
        func skip() { while i < bytes.count && [9, 10, 13, 32].contains(bytes[i]) { i += 1 } }
        func string() throws -> String {
            let start = i
            try PathPhaseObserver.need(i < bytes.count && bytes[i] == 34, "Expected JSON string")
            i += 1
            while i < bytes.count {
                if bytes[i] == 92 { i += 2; continue }
                if bytes[i] == 34 {
                    i += 1
                    return try JSONDecoder().decode(String.self, from: Data(bytes[start..<i]))
                }
                i += 1
            }
            throw NSError(domain: "NAC354PathsJSON", code: 2)
        }
        func value(_ depth: Int) throws {
            try PathPhaseObserver.need(depth < 32, "JSON depth bound")
            skip()
            try PathPhaseObserver.need(i < bytes.count, "Incomplete JSON")
            if bytes[i] == 123 {
                i += 1; skip()
                var keys = Set<String>()
                if i < bytes.count && bytes[i] == 125 { i += 1; return }
                while true {
                    skip()
                    let key = try string()
                    try PathPhaseObserver.need(keys.insert(key).inserted, "Duplicate JSON key")
                    skip(); try PathPhaseObserver.need(i < bytes.count && bytes[i] == 58, "JSON colon")
                    i += 1; try value(depth + 1); skip()
                    try PathPhaseObserver.need(i < bytes.count, "Incomplete object")
                    if bytes[i] == 125 { i += 1; return }
                    try PathPhaseObserver.need(bytes[i] == 44, "JSON object separator"); i += 1
                }
            } else if bytes[i] == 91 {
                i += 1; skip()
                if i < bytes.count && bytes[i] == 93 { i += 1; return }
                while true {
                    try value(depth + 1); skip()
                    try PathPhaseObserver.need(i < bytes.count, "Incomplete array")
                    if bytes[i] == 93 { i += 1; return }
                    try PathPhaseObserver.need(bytes[i] == 44, "JSON array separator"); i += 1
                }
            } else if bytes[i] == 34 { _ = try string() }
            else {
                let start = i
                while i < bytes.count && ![9, 10, 13, 32, 44, 93, 125].contains(bytes[i]) { i += 1 }
                try PathPhaseObserver.need(i > start, "Empty JSON value")
            }
        }
        try value(0); skip()
        try PathPhaseObserver.need(i == bytes.count, "Trailing JSON data")
    }
}
