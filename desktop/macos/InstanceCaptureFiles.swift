import Foundation
import CryptoKit
import Darwin

enum InstanceCaptureError: LocalizedError {
    case invalid(String)
    var errorDescription: String? {
        if case .invalid(let reason) = self { return "Instance capture fixture: " + reason }
        return nil
    }
}

func captureDigest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

func capturePhysicalPath(_ path: String) throws -> String {
    guard let physical = realpath(path, nil) else { throw InstanceCaptureError.invalid("resource path unavailable") }
    defer { free(physical) }
    return String(cString: physical)
}

func captureJSON(_ value: Any) throws -> Data {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
    guard data.count <= CaptureDirectory.limit else { throw InstanceCaptureError.invalid("record exceeds 32 KiB") }
    return data
}

/// A fixture-owned directory descriptor, never a PID/cleanup or serving capability.
/// Walk every component without following links; all subsequent files are relative
/// to the retained descriptor. No file replacement, FIFO blocking or foreign writes.
final class CaptureDirectory {
    static let limit = 32 * 1024
    private var descriptor: Int32
    private let path: String
    private let inode: ino_t
    private let device: dev_t

    init(_ path: String) throws {
        guard path.hasPrefix("/"), !path.contains("\0"), !path.hasSuffix("/"),
              let physical = realpath(path, nil) else { throw InstanceCaptureError.invalid("directory is not canonical") }
        defer { free(physical) }
        guard String(cString: physical) == path else { throw InstanceCaptureError.invalid("directory follows a link") }
        var fd = Darwin.open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard fd >= 0 else { throw InstanceCaptureError.invalid("directory open failed") }
        do {
            for part in path.split(separator: "/") {
                guard part != ".", part != ".." else { throw InstanceCaptureError.invalid("directory traversal") }
                let next = openat(fd, String(part), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                guard next >= 0 else { throw InstanceCaptureError.invalid("directory component unavailable") }
                close(fd)
                fd = next
            }
            var info = stat()
            guard fstat(fd, &info) == 0, info.st_uid == geteuid(), info.st_mode & 0o077 == 0 else {
                throw InstanceCaptureError.invalid("directory is not private and owned")
            }
            self.descriptor = fd
            self.path = path
            inode = info.st_ino
            device = info.st_dev
        } catch { close(fd); throw error }
    }

    deinit { closeDirectory() }

    func closeDirectory() {
        if descriptor >= 0 { close(descriptor); descriptor = -1 }
    }

    private func requireBinding(_ name: String) throws {
        guard descriptor >= 0, !name.isEmpty, name.count < 100,
              name.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || "-_.".contains($0)) }),
              name != ".", name != ".." else { throw InstanceCaptureError.invalid("invalid record name or closed directory") }
        var held = stat(), current = stat()
        guard let physical = realpath(path, nil) else { throw InstanceCaptureError.invalid("directory retired") }
        defer { free(physical) }
        guard fstat(descriptor, &held) == 0, lstat(path, &current) == 0,
              String(cString: physical) == path,
              held.st_ino == inode, held.st_dev == device,
              current.st_ino == inode, current.st_dev == device,
              current.st_mode & S_IFMT == S_IFDIR, current.st_uid == geteuid(),
              current.st_mode & 0o077 == 0 else { throw InstanceCaptureError.invalid("directory retired or replaced") }
    }

    func read(_ name: String, optional: Bool = false) throws -> Data? {
        try requireBinding(name)
        let fd = openat(descriptor, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        if fd < 0, optional, errno == ENOENT { return nil }
        guard fd >= 0 else { throw InstanceCaptureError.invalid("record cannot be opened") }
        defer { close(fd) }
        var before = stat(), after = stat(), named = stat()
        guard fstat(fd, &before) == 0, before.st_mode & S_IFMT == S_IFREG,
              before.st_uid == geteuid(), before.st_mode & 0o077 == 0,
              before.st_nlink == 1, before.st_size > 0, before.st_size <= Self.limit else {
            throw InstanceCaptureError.invalid("record is not bounded, private, regular and owned")
        }
        var bytes = [UInt8](repeating: 0, count: Self.limit + 1)
        var count = 0
        while count < bytes.count {
            let size = bytes.count
            let result = bytes.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress!.advanced(by: count), size - count) }
            if result < 0, errno == EINTR { continue }
            guard result >= 0 else { throw InstanceCaptureError.invalid("record read failed") }
            if result == 0 { break }
            count += result
        }
        guard count == before.st_size, fstat(fd, &after) == 0,
              fstatat(descriptor, name, &named, AT_SYMLINK_NOFOLLOW) == 0,
              named.st_dev == before.st_dev, named.st_ino == before.st_ino,
              before.st_ino == after.st_ino, before.st_size == after.st_size,
              before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
              before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec else {
            throw InstanceCaptureError.invalid("record changed while reading")
        }
        let data = Data(bytes.prefix(count))
        let object = try JSONSerialization.jsonObject(with: data)
        guard try captureJSON(object) == data else {
            throw InstanceCaptureError.invalid("record is not canonical JSON (or has duplicate keys)")
        }
        return data
    }

    func writeNew(_ name: String, data: Data) throws {
        try requireBinding(name)
        guard !data.isEmpty, data.count <= Self.limit else { throw InstanceCaptureError.invalid("record size") }
        let temporary = "pending-" + UUID().uuidString.lowercased() + ".json"
        let fd = openat(descriptor, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw InstanceCaptureError.invalid("record already exists or cannot be created") }
        defer { close(fd); unlinkat(descriptor, temporary, 0) }
        try data.withUnsafeBytes { buffer in
            var offset = 0
            while offset < data.count {
                let count = Darwin.write(fd, buffer.baseAddress!.advanced(by: offset), data.count - offset)
                if count < 0, errno == EINTR { continue }
                guard count > 0 else { throw InstanceCaptureError.invalid("record write failed") }
                offset += count
            }
        }
        guard fsync(fd) == 0 else { throw InstanceCaptureError.invalid("record flush failed") }
        guard renameatx_np(descriptor, temporary, descriptor, name, UInt32(RENAME_EXCL)) == 0 else {
            throw InstanceCaptureError.invalid("record already exists or cannot be published")
        }
    }
}
