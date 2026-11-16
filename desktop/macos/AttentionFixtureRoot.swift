import Foundation
import Darwin

/// Inherited fixture-only directory capabilities, retained across the callback.
/// The controller captured both descriptors when it created this private root.
struct AttentionFixtureRoot {
    let root: URL
    let descriptor: Int32
    let parentDescriptor: Int32
    private let device: dev_t
    private let inode: ino_t
    private let parentDevice: dev_t
    private let parentInode: ino_t

    init(arguments: [String] = CommandLine.arguments) throws {
        guard arguments.count == 4, let fd = Int32(arguments[2]), fd >= 3,
              let parent = Int32(arguments[3]), parent >= 3, fd != parent else { throw Self.failed() }
        root = URL(fileURLWithPath: arguments[1]).standardizedFileURL
        descriptor = fd; parentDescriptor = parent
        var held = stat(), parentInfo = stat()
        guard fstat(fd, &held) == 0, fstat(parent, &parentInfo) == 0 else { throw Self.failed() }
        device = held.st_dev; inode = held.st_ino
        parentDevice = parentInfo.st_dev; parentInode = parentInfo.st_ino
        try validate()
    }

    func validate() throws {
        var held = stat(), named = stat(), parent = stat(), parentNamed = stat(), relative = stat()
        guard root.path.hasPrefix("/"), root.lastPathComponent.hasPrefix("nac-attention-app-"),
              root.resolvingSymlinksInPath() == root,
              fstat(descriptor, &held) == 0, lstat(root.path, &named) == 0,
              fstat(parentDescriptor, &parent) == 0,
              lstat(root.deletingLastPathComponent().path, &parentNamed) == 0,
              fstatat(parentDescriptor, root.lastPathComponent, &relative, AT_SYMLINK_NOFOLLOW) == 0,
              held.st_dev == device, held.st_ino == inode,
              named.st_dev == device, named.st_ino == inode,
              relative.st_dev == device, relative.st_ino == inode,
              parent.st_dev == parentDevice, parent.st_ino == parentInode,
              parentNamed.st_dev == parentDevice, parentNamed.st_ino == parentInode,
              held.st_uid == getuid(), held.st_mode & S_IFMT == S_IFDIR, held.st_mode & 0o777 == 0o700,
              parent.st_uid == getuid(), parent.st_mode & S_IFMT == S_IFDIR,
              parent.st_mode & 0o777 == 0o700 else { throw Self.failed() }
    }

    func readInput() throws -> Data {
        try validate()
        let fd = openat(descriptor, "cleanup-input.json", O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK)
        guard fd >= 0 else { throw Self.failed() }
        defer { close(fd) }
        var first = stat(), last = stat(), named = stat()
        guard fstat(fd, &first) == 0, first.st_uid == getuid(), first.st_mode & S_IFMT == S_IFREG,
              first.st_mode & 0o077 == 0, first.st_nlink == 1,
              first.st_size >= 0, first.st_size <= 65536 else { throw Self.failed() }
        var data = Data(), bytes = [UInt8](repeating: 0, count: 8192)
        while true {
            let count = Darwin.read(fd, &bytes, bytes.count)
            if count < 0 && errno == EINTR { continue }
            guard count >= 0, data.count + count <= 65536 else { throw Self.failed() }
            if count == 0 { break }
            data.append(contentsOf: bytes.prefix(count))
        }
        guard fstat(fd, &last) == 0, first.st_dev == last.st_dev, first.st_ino == last.st_ino,
              first.st_size == last.st_size,
              first.st_mtimespec.tv_sec == last.st_mtimespec.tv_sec,
              first.st_mtimespec.tv_nsec == last.st_mtimespec.tv_nsec,
              first.st_ctimespec.tv_sec == last.st_ctimespec.tv_sec,
              first.st_ctimespec.tv_nsec == last.st_ctimespec.tv_nsec,
              fstatat(descriptor, "cleanup-input.json", &named, AT_SYMLINK_NOFOLLOW) == 0,
              first.st_dev == named.st_dev, first.st_ino == named.st_ino else { throw Self.failed() }
        try validate()
        return data
    }

    @MainActor
    func complete(removal: () async throws -> [String: Any]) async throws {
        try validate()
        let result = try await removal()
        try validate() // A late callback grants no successor write authority.
        var output = result
        output["root_device"] = UInt64(device); output["root_inode"] = UInt64(inode)
        output["parent_device"] = UInt64(parentDevice); output["parent_inode"] = UInt64(parentInode)
        let data = try JSONSerialization.data(withJSONObject: output)
        let temporary = ".cleanup-\(UUID().uuidString)"
        let fd = openat(descriptor, temporary, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw Self.failed() }
        defer { close(fd); unlinkat(descriptor, temporary, 0) }
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = Darwin.write(fd, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw Self.failed() }
                offset += count
            }
        }
        try validate()
        guard fsync(fd) == 0,
              linkat(descriptor, temporary, descriptor, "cleanup-result.json", 0) == 0,
              unlinkat(descriptor, temporary, 0) == 0, fsync(descriptor) == 0 else { throw Self.failed() }
        try validate()
    }

    static func failed() -> Error { NSError(domain: "NACAttentionFixtureRoot", code: 1) }
}
