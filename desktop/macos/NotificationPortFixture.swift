import Foundation
import Darwin

/// Fixture-only inherited directory capability. No discovery or default HOME.
struct NotificationPortFixture {
    let root: URL
    let descriptor: Int32
    private let device: dev_t
    private let inode: ino_t

    init(arguments: [String] = CommandLine.arguments) throws {
        guard arguments.count == 3, let fd = Int32(arguments[2]), fd >= 3 else { throw Self.failed() }
        root = URL(fileURLWithPath: arguments[1]).standardizedFileURL
        descriptor = fd
        var info = stat()
        guard fstat(fd, &info) == 0 else { throw Self.failed() }
        device = info.st_dev; inode = info.st_ino
        try validate()
    }

    func validate() throws {
        var held = stat(), named = stat()
        let temporary = root.deletingLastPathComponent()
        let owner = temporary.deletingLastPathComponent()
        var parent = stat(), ownerInfo = stat()
        guard root.path.hasPrefix("/"), root.lastPathComponent.hasPrefix("nac-notification-port-"),
              UUID(uuidString: String(root.lastPathComponent.dropFirst("nac-notification-port-".count))) != nil,
              temporary.lastPathComponent == "tmp", owner.lastPathComponent.hasPrefix("nac-notification-port-owner-"),
              root.resolvingSymlinksInPath() == root,
              lstat(temporary.path, &parent) == 0, lstat(owner.path, &ownerInfo) == 0,
              parent.st_uid == getuid(), parent.st_mode & S_IFMT == S_IFDIR, parent.st_mode & 0o777 == 0o700,
              ownerInfo.st_uid == getuid(), ownerInfo.st_mode & S_IFMT == S_IFDIR, ownerInfo.st_mode & 0o777 == 0o700,
              fstat(descriptor, &held) == 0, lstat(root.path, &named) == 0,
              held.st_dev == device, held.st_ino == inode,
              named.st_dev == device, named.st_ino == inode,
              held.st_uid == getuid(), held.st_mode & S_IFMT == S_IFDIR,
              held.st_mode & 0o777 == 0o700 else { throw Self.failed() }
    }

    var configuration: EngineLaunchConfiguration {
        EngineLaunchConfiguration(cwd: root, store: root.appendingPathComponent("fixture.db"), environment: ["HOME": root.path])
    }

    var receipt: EngineReceipt {
        EngineReceipt(kind: "ready", version: 1, incarnation: "fixture",
            endpoint: "http://127.0.0.1:41001", identity: EngineIdentity(product_version: "fixture",
                build_id: "fixture", source_revision: "fixture", track: "dev"),
            store: configuration.store.path, schema: 1, stage: nil, code: nil, message: nil)
    }

    static func failed() -> Error { NSError(domain: "NACNotificationPortFixture", code: 1) }
}
