import Foundation
import WebKit
import Darwin

/// Dedicated test process after the exact fixture app/engine have exited.
/// Recompute the normal profile owner; never accept an arbitrary WebKit UUID.
@main
enum AttentionFixtureCleanup {
    struct Input: Decodable { let receipt: EngineReceipt; let home: String }
    @MainActor
    static func main() async throws {
        guard CommandLine.arguments.count == 2 else { throw failed() }
        let root = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
        var status = stat()
        guard root.lastPathComponent.hasPrefix("nac-attention-app-"),
              root.resolvingSymlinksInPath() == root, lstat(root.path, &status) == 0,
              status.st_uid == getuid(), status.st_mode & S_IFMT == S_IFDIR,
              status.st_mode & 0o077 == 0 else { throw failed() }
        let input = try JSONDecoder().decode(Input.self, from: Data(contentsOf: root.appendingPathComponent("cleanup-input.json")))
        let home = root.appendingPathComponent("profile")
        let store = home.appendingPathComponent("selected store.db")
        guard input.home == home.path, input.receipt.store == store.path,
              lstat(home.path, &status) == 0, status.st_uid == getuid(), status.st_mode & S_IFMT == S_IFDIR,
              status.st_mode & 0o077 == 0 else { throw failed() }
        let configuration = EngineLaunchConfiguration(cwd: home, store: store, environment: ["HOME": home.path])
        guard let profile = WorkspaceStorageProfile(receipt: input.receipt, configuration: configuration) else { throw failed() }
        let initialization = WKWebsiteDataStore.nonPersistent()
        try await WKWebsiteDataStore.remove(forIdentifier: profile.identifier)
        let output: [String: Any] = ["website_store_removed": profile.identifier.uuidString,
            "profile": profile.digest, "root": root.path, "initialization_ephemeral": !initialization.isPersistent]
        try JSONSerialization.data(withJSONObject: output).write(to: root.appendingPathComponent("cleanup-result.json"), options: .atomic)
    }
    private static func failed() -> Error { NSError(domain: "NACAttentionFixtureCleanup", code: 1) }
}
