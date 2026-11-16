import Foundation
import Darwin

/// Private mock-callback unit only. No WebKit import, app, provider or OS store.
@main
@MainActor
enum AttentionFixtureRootTests {
    static func main() async throws {
        guard CommandLine.arguments.count == 2 else { throw AttentionFixtureRoot.failed() }
        let parent = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
        var info = stat()
        guard parent.resolvingSymlinksInPath() == parent, lstat(parent.path, &info) == 0,
              info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFDIR,
              info.st_mode & 0o777 == 0o700 else { throw AttentionFixtureRoot.failed() }
        var passed = 0
        for mode in ["normal", "replace-before", "replace-during", "parent-during", "cancel",
                     "callback-error", "receipt-collision", "bad-mode", "input-link", "bad-input-mode"] {
            let base = parent.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: base, withIntermediateDirectories: false,
                                                    attributes: [.posixPermissions: 0o700])
            let root = base.appendingPathComponent("nac-attention-app-unit")
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                                    attributes: [.posixPermissions: 0o700])
            let fd = open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            let pfd = open(base.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard fd >= 3, pfd >= 3 else { throw AttentionFixtureRoot.failed() }
            do {
                let fixture = try AttentionFixtureRoot(arguments: ["unit", root.path, String(fd), String(pfd)])
                let input = openat(fd, "cleanup-input.json", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
                guard input >= 0 else { throw AttentionFixtureRoot.failed() }
                let bytes = Array("{\"private\":true}".utf8)
                guard bytes.withUnsafeBytes({ Darwin.write(input, $0.baseAddress!, $0.count) }) == bytes.count else {
                    close(input); throw AttentionFixtureRoot.failed()
                }
                close(input)
                let original = root.appendingPathExtension("retained")
                func replace() throws {
                    try FileManager.default.moveItem(at: root, to: original)
                    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                                            attributes: [.posixPermissions: 0o700])
                    try Data("preserve-successor".utf8).write(to: root.appendingPathComponent("sentinel"))
                }
                if mode == "replace-before" { try replace() }
                if mode == "bad-mode" { chmod(root.path, 0o755) }
                if mode == "input-link" {
                    unlinkat(fd, "cleanup-input.json", 0)
                    symlinkat("absent", fd, "cleanup-input.json")
                }
                if mode == "bad-input-mode" { fchmodat(fd, "cleanup-input.json", 0o644, 0) }
                if mode == "receipt-collision" {
                    let existing = openat(fd, "cleanup-result.json", O_WRONLY | O_CREAT | O_EXCL, 0o600)
                    guard existing >= 0 else { throw AttentionFixtureRoot.failed() }
                    _ = Darwin.write(existing, "preserve", 8); close(existing)
                }
                var callback = false, succeeded = false
                do {
                    _ = try fixture.readInput()
                    try await fixture.complete {
                        callback = true
                        await Task.yield()
                        if mode == "replace-during" { try replace() }
                        if mode == "parent-during" {
                            try FileManager.default.moveItem(at: base, to: base.appendingPathExtension("retained"))
                            try FileManager.default.createDirectory(at: base, withIntermediateDirectories: false,
                                                                    attributes: [.posixPermissions: 0o700])
                            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                                                    attributes: [.posixPermissions: 0o700])
                            try Data("preserve-successor".utf8).write(to: root.appendingPathComponent("sentinel"))
                        }
                        if mode == "cancel" { throw CancellationError() }
                        if mode == "callback-error" { throw AttentionFixtureRoot.failed() }
                        return ["root": root.path, "profile": "unit metadata, not a hash oracle"]
                    }
                    succeeded = true
                } catch {}
                guard succeeded == (mode == "normal") else { throw AttentionFixtureRoot.failed() }
                if mode == "normal" {
                    let output = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("cleanup-result.json"))) as! [String: Any]
                    var held = stat(), named = stat()
                    guard fstat(fd, &held) == 0, lstat(root.appendingPathComponent("cleanup-result.json").path, &named) == 0,
                          named.st_mode & 0o777 == 0o600, named.st_nlink == 1,
                          (output["root_inode"] as? NSNumber)?.uint64Value == held.st_ino else { throw AttentionFixtureRoot.failed() }
                }
                if mode.hasPrefix("replace-") || mode == "parent-during" {
                    guard FileManager.default.fileExists(atPath: root.appendingPathComponent("sentinel").path),
                          !FileManager.default.fileExists(atPath: root.appendingPathComponent("cleanup-result.json").path)
                    else { throw AttentionFixtureRoot.failed() }
                }
                if ["replace-before", "bad-mode", "input-link", "bad-input-mode"].contains(mode) {
                    guard !callback else { throw AttentionFixtureRoot.failed() }
                }
                if mode == "receipt-collision" {
                    guard try String(contentsOf: root.appendingPathComponent("cleanup-result.json"), encoding: .utf8) == "preserve" else {
                        throw AttentionFixtureRoot.failed()
                    }
                }
                passed += 1
                close(fd); close(pfd)
                guard fcntl(fd, F_GETFD) == -1, fcntl(pfd, F_GETFD) == -1 else { throw AttentionFixtureRoot.failed() }
            } catch { close(fd); close(pfd); throw error }
        }
        print("PASS \(passed) actual fixture generation mock-callback controls; no WebKit")
    }
}
