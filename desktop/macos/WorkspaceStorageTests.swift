import Foundation
import Darwin

/// Checked-in native owner cases for the next explicitly allocated Swift lane.
/// This source is not evidence that they ran, nor does it exercise actual WK UI.
@main
enum WorkspaceStorageTests {
    @MainActor
    static func main() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nac-storage-unit-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: root) }
        let configuration = EngineLaunchConfiguration(cwd: root, store: root.appendingPathComponent("store.db"),
            environment: ["HOME": root.path])
        func receipt(port: Int = 41001, track: String = "dev", store: String? = nil) -> EngineReceipt {
            EngineReceipt(kind: "ready", version: 1, incarnation: UUID().uuidString,
                endpoint: "http://127.0.0.1:\(port)", identity: EngineIdentity(product_version: "test",
                    build_id: UUID().uuidString, source_revision: "test", track: track),
                store: store ?? configuration.store.path, schema: 1, stage: nil, code: nil, message: nil)
        }
        let first = WorkspaceStorageProfile(receipt: receipt(), configuration: configuration)!
        let newPort = WorkspaceStorageProfile(receipt: receipt(port: 41002), configuration: configuration)!
        precondition(first.identifier == newPort.identifier)
        precondition(first.binding == newPort.binding)
        precondition(first.identifier != WorkspaceStorageProfile(receipt: receipt(track: "stable"), configuration: configuration)!.identifier)
        precondition(first.identifier != WorkspaceStorageProfile(receipt: receipt(store: root.appendingPathComponent("other.db").path), configuration: configuration)!.identifier)

        let owner = WorkspaceCheckpoint(home: root, profile: first.digest, track: first.track)
        let empty = await load(owner)
        guard case .success(nil) = empty else { fatalError("Fresh checkpoint was not empty") }
        // Another process-equivalent descriptor must not hydrate over our lease.
        let competing = WorkspaceCheckpoint(home: root, profile: first.digest, track: first.track)
        guard case .failure = await load(competing) else { fatalError("Presentation lease did not fence another owner") }
        let latest = Data("latest checkpoint".utf8)
        let wrote = await write(owner, Data("older checkpoint".utf8))
        precondition(wrote)
        let cleared = await write(owner, Data())
        precondition(cleared)
        let replaced = await write(owner, latest)
        precondition(replaced)
        guard case .success(let retained?) = await load(owner), retained == latest else {
            fatalError("Atomic replacement/clear ordering failed")
        }

        let escape = root.appendingPathComponent("outside")
        try FileManager.default.createDirectory(at: escape, withIntermediateDirectories: false)
        let hostile = root.appendingPathComponent("hostile")
        try FileManager.default.createDirectory(at: hostile, withIntermediateDirectories: false)
        try FileManager.default.createSymbolicLink(at: hostile.appendingPathComponent("Library"), withDestinationURL: escape)
        let rejected = WorkspaceCheckpoint(home: hostile, profile: first.digest, track: first.track)
        guard case .failure = await load(rejected) else { fatalError("Symlink directory was followed") }
        let outsideFiles = try FileManager.default.contentsOfDirectory(atPath: escape.path)
        precondition(outsideFiles.isEmpty)
        print("WorkspaceStorage profile/checkpoint owner cases passed; actual WK/OS qualification remains separate.")
    }

    private static func load(_ owner: WorkspaceCheckpoint) async -> Result<Data?, Error> {
        await withCheckedContinuation { continuation in owner.load { continuation.resume(returning: $0) } }
    }
    private static func write(_ owner: WorkspaceCheckpoint, _ data: Data) async -> Bool {
        await withCheckedContinuation { continuation in owner.write(data) { continuation.resume(returning: $0) } }
    }
}
