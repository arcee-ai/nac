import Foundation
import Darwin

/// Private presentation bytes only. A serial queue owns the directory descriptor
/// and atomic replacements; no caller-controlled path or domain operation enters it.
final class WorkspaceCheckpoint {
    static let limit = 8 * 1024 * 1024
    private let home: URL
    private let components: [String]
    private let queue = DispatchQueue(label: "ai.arcee.nac.presentation-checkpoint", qos: .utility)
    private var directory: Int32 = -1
    private var lease: Int32 = -1

    init(home: URL, profile: String, track: String) {
        self.home = home.resolvingSymlinksInPath()
        components = ["Library", "Application Support", "NAC", "Presentation", track, profile]
    }

    deinit {
        if lease >= 0 { close(lease) }
        if directory >= 0 { close(directory) }
    }

    func load(completion: @escaping (Result<Data?, Error>) -> Void) {
        queue.async { [self] in
            let result = Result { () throws -> Data? in
                let directory = try openDirectory()
                defer { close(directory) }
                let fd = openat(directory, "checkpoint.json", O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
                if fd < 0 && errno == ENOENT { return nil }
                guard fd >= 0 else { throw failure() }
                defer { close(fd) }
                var status = stat()
                guard fstat(fd, &status) == 0, status.st_mode & S_IFMT == S_IFREG,
                      status.st_uid == getuid(), status.st_mode & 0o077 == 0,
                      status.st_size >= 0, status.st_size <= Int64(Self.limit) else { throw failure() }
                var data = Data(), chunk = [UInt8](repeating: 0, count: 16_384)
                while true {
                    let count = Darwin.read(fd, &chunk, chunk.count)
                    if count < 0 && errno == EINTR { continue }
                    guard count >= 0 else { throw failure() }
                    if count == 0 { break }
                    guard data.count + count <= Self.limit else { throw failure() }
                    data.append(contentsOf: chunk.prefix(count))
                }
                return data
            }
            DispatchQueue.main.async { completion(result) }
        }
    }

    func write(_ data: Data, completion: @escaping (Bool) -> Void) {
        queue.async { [self] in
            let success: Bool
            do {
                guard data.count <= Self.limit else { throw failure() }
                let directory = try openDirectory()
                defer { close(directory) }
                let temporary = ".checkpoint-\(UUID().uuidString)"
                let fd = openat(directory, temporary, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0o600)
                guard fd >= 0 else { throw failure() }
                defer { close(fd); unlinkat(directory, temporary, 0) }
                try data.withUnsafeBytes { bytes in
                    var offset = 0
                    while offset < bytes.count {
                        let count = Darwin.write(fd, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                        if count < 0 && errno == EINTR { continue }
                        guard count > 0 else { throw failure() }
                        offset += count
                    }
                }
                guard fsync(fd) == 0,
                      renameat(directory, temporary, directory, "checkpoint.json") == 0,
                      fsync(directory) == 0 else { throw failure() }
                success = true
            } catch {
                // Best effort removes a stale record, never follows its target.
                // Failure remains explicit; it cannot be represented as a durable clear.
                if let directory = try? openDirectory() {
                    unlinkat(directory, "checkpoint.json", 0)
                    _ = fsync(directory)
                    close(directory)
                }
                success = false
            }
            DispatchQueue.main.async { completion(success) }
        }
    }

    private func openDirectory() throws -> Int32 {
        if directory >= 0 {
            let copy = dup(directory)
            guard copy >= 0 else { throw failure() }
            guard fcntl(copy, F_SETFD, FD_CLOEXEC) == 0 else { close(copy); throw failure() }
            return copy
        }
        var current = open(home.path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
        guard current >= 0 else { throw failure() }
        do {
            for (index, component) in components.enumerated() {
                guard component != ".", component != "..", !component.contains("/"), !component.isEmpty else { throw failure() }
                if mkdirat(current, component, 0o700) != 0 && errno != EEXIST { throw failure() }
                let next = openat(current, component, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
                guard next >= 0 else { throw failure() }
                var status = stat()
                guard fstat(next, &status) == 0, status.st_uid == getuid(),
                      status.st_mode & 0o022 == 0,
                      index < 2 || status.st_mode & 0o077 == 0 else {
                    close(next); throw failure()
                }
                close(current)
                current = next
            }
            let lock = openat(current, ".checkpoint.lock", O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0o600)
            guard lock >= 0 else { throw failure() }
            var lockStatus = stat()
            guard fstat(lock, &lockStatus) == 0, lockStatus.st_mode & S_IFMT == S_IFREG,
                  lockStatus.st_uid == getuid(), lockStatus.st_mode & 0o077 == 0,
                  flock(lock, LOCK_EX | LOCK_NB) == 0 else { close(lock); throw failure() }
            let retained = dup(current)
            guard retained >= 0 else { close(lock); throw failure() }
            guard fcntl(retained, F_SETFD, FD_CLOEXEC) == 0 else {
                close(retained); close(lock); throw failure()
            }
            // Keep a private presentation lease through final writes/process exit.
            // Engine-store release alone cannot admit a successor over an old flush.
            directory = retained
            lease = lock
            return current
        } catch { close(current); throw error }
    }

    private func failure() -> Error {
        NSError(domain: "NACPresentationStorage", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Workspace storage is unavailable."])
    }
}
