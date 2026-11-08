import Foundation
import CryptoKit
import Darwin

// Finite H-only port. No AX, input, process launch, network or product bridge.
enum CapturePort {
    static func need(_ value: Bool, _ message: String) throws {
        if !value { throw NSError(domain: "LifecycleCapture", code: 1,
                                  userInfo: [NSLocalizedDescriptionKey: message]) }
    }
    static func hash(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    static func read(_ url: URL) throws -> Data {
        try need(url.isFileURL && url.path == url.resolvingSymlinksInPath().path, "Port path alias")
        var parent = stat()
        try need(lstat(url.deletingLastPathComponent().path, &parent) == 0
            && parent.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR)
            && parent.st_uid == getuid() && parent.st_mode & 0o077 == 0, "Private port parent")
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        try need(fd >= 0, "Known port file absent")
        defer { close(fd) }
        var first = stat(), last = stat()
        try need(fstat(fd, &first) == 0 && first.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG)
            && first.st_uid == getuid() && first.st_nlink == 1 && first.st_size > 0
            && first.st_size <= 256 * 1024, "Owned regular bounded port file")
        var bytes = [UInt8](repeating: 0, count: Int(first.st_size) + 1)
        var count = 0
        while count < bytes.count {
            let capacity = bytes.count
            let result = bytes.withUnsafeMutableBytes {
                Darwin.read(fd, $0.baseAddress!.advanced(by: count), capacity - count)
            }
            try need(result >= 0, "Port read failed")
            if result == 0 { break }; count += result
        }
        try need(fstat(fd, &last) == 0 && count == Int(first.st_size)
            && first.st_dev == last.st_dev && first.st_ino == last.st_ino
            && first.st_size == last.st_size && first.st_mtimespec.tv_sec == last.st_mtimespec.tv_sec
            && first.st_mtimespec.tv_nsec == last.st_mtimespec.tv_nsec
            && first.st_ctimespec.tv_sec == last.st_ctimespec.tv_sec
            && first.st_ctimespec.tv_nsec == last.st_ctimespec.tv_nsec, "Port changed during read")
        return Data(bytes.prefix(count))
    }
    static func object(_ data: Data) throws -> [String: Any] {
        try need(data.count <= 256 * 1024, "JSON size")
        // All producer records use one canonical JSON encoding; reject duplicate keys
        // rather than accepting JSONSerialization's last-wins behavior.
        var levels: [Set<String>] = [], keys: [Set<String>] = []
        var quoted = false, escaped = false, token = "", closedString: String?
        for byte in data {
            let c = Character(UnicodeScalar(byte))
            if quoted {
                if escaped { token.append(c); escaped = false }
                else if c == "\\" { token.append(c); escaped = true }
                else if c == "\"" { quoted = false; closedString = token }
                else { token.append(c) }
            } else if c == "\"" { quoted = true; token = ""; closedString = nil }
            else if c == "{" { levels.append([]); keys.append([]); closedString = nil }
            else if c == "}" { _ = levels.popLast(); _ = keys.popLast(); closedString = nil }
            else if c == ":", let key = closedString, !keys.isEmpty {
                try need(!key.contains("\\") && key.utf8.allSatisfy { $0 < 128 }
                    && !keys[keys.count - 1].contains(key), "Duplicate/escaped/noncanonical JSON key")
                keys[keys.count - 1].insert(key); closedString = nil
            } else if c != " " && c != "\n" && c != "\r" && c != "\t" { closedString = nil }
        }
        try need(!quoted && levels.isEmpty, "JSON framing")
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NSError(domain: "LifecycleCapture", code: 2)
        }
        return value
    }
    static func processRecord() throws -> [String: Any] {
        var row = proc_bsdinfo(), path = [CChar](repeating: 0, count: 4096)
        let size = Int32(MemoryLayout<proc_bsdinfo>.size), pathCapacity = UInt32(path.count)
        try need(proc_pidinfo(getpid(), PROC_PIDTBSDINFO, 0, &row, size) == size
            && row.pbi_pid == UInt32(getpid()) && row.pbi_uid == getuid()
            && row.pbi_start_tvsec > 0 && row.pbi_start_tvusec < 1_000_000
            && proc_pidpath(getpid(), &path, pathCapacity) > 0, "Self kernel identity")
        return ["pid": Int(row.pbi_pid), "parent": Int(row.pbi_ppid), "uid": Int(row.pbi_uid),
            "start_seconds": row.pbi_start_tvsec, "start_microseconds": row.pbi_start_tvusec,
            "executable": String(cString: path)]
    }
    static func binary(_ url: URL, expected: String? = nil) throws -> String {
        try need(url.path == url.resolvingSymlinksInPath().path, "Binary path alias")
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        try need(fd >= 0, "Binary absent"); defer { close(fd) }
        var first = stat(), last = stat()
        try need(fstat(fd, &first) == 0 && first.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG)
            && first.st_uid == getuid() && first.st_nlink == 1 && first.st_size > 0
            && first.st_size <= 512 * 1024 * 1024, "Owned original binary")
        func stamp(_ row: stat) -> String {
            "\(row.st_dev):\(row.st_ino):\(row.st_size):\(row.st_mode):\(row.st_mtimespec.tv_sec):\(row.st_mtimespec.tv_nsec):\(row.st_ctimespec.tv_sec):\(row.st_ctimespec.tv_nsec)"
        }
        if let expected {
            var hash = SHA256(), bytes = [UInt8](repeating: 0, count: 1024 * 1024), total = 0
            while true {
                let capacity = bytes.count
                let count = bytes.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, capacity) }
                try need(count >= 0, "Binary read failed")
                if count == 0 { break }
                total += count; try need(total <= Int(first.st_size), "Binary grew")
                hash.update(data: Data(bytes.prefix(count)))
            }
            try need(total == Int(first.st_size) && hash.finalize().map { String(format: "%02x", $0) }.joined() == expected,
                     "Original binary digest")
        }
        try need(fstat(fd, &last) == 0 && stamp(first) == stamp(last), "Binary generation changed")
        return stamp(first)
    }
    static func frame(_ value: Any?) throws -> CGRect {
        guard let a = value as? [Double], a.count == 4,
              a.allSatisfy({ $0.isFinite }), a[2] > 0, a[3] > 0 else {
            throw NSError(domain: "LifecycleCapture", code: 3)
        }
        return CGRect(x: a[0], y: a[1], width: a[2], height: a[3])
    }
    static func nanos() -> UInt64 { DispatchTime.now().uptimeNanoseconds }
}
