import Foundation
import WebKit
import Darwin

/// Uses the actual selected profile/checkpoint owner, never a second file store.
/// Execute only in an admitted native fixture lane; typecheck is not evidence.
@main
enum WorkspaceNotificationPortTests {
    @MainActor
    static func main() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nac-notification-port-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let configuration = EngineLaunchConfiguration(cwd: root, store: root.appendingPathComponent("fixture.db"), environment: ["HOME": root.path])
        let receipt = EngineReceipt(kind: "ready", version: 1, incarnation: UUID().uuidString,
            endpoint: "http://127.0.0.1:41001", identity: EngineIdentity(product_version: "fixture", build_id: "fixture", source_revision: "fixture", track: "dev"),
            store: configuration.store.path, schema: 1, stage: nil, code: nil, message: nil)
        let storage = await WorkspaceStorage.open(receipt: receipt, configuration: configuration)!
        let profile = storage.profile
        let token = storage.beginNotifications(generation: 1)!
        guard case .available(let initial, let state, _) = await storage.readNotifications(token) else { fatalError("Fresh native state unavailable") }
        precondition(initial == 0 && !state.enabled)
        let native = WorkspaceNotificationState(enabled: true, cutoff: "store:12", frontier: "store:12")
        let acknowledged: WorkspaceNotificationWrite = await withCheckedContinuation { continuation in
            precondition(storage.updateNotifications(token, expectedRevision: 0, next: native) { continuation.resume(returning: $0) } == 1)
        }
        guard case .durable(let revision) = acknowledged else { fatalError("Exact native ACK missing") }
        precondition(revision == 1)
        precondition(storage.updateNotifications(token, expectedRevision: 0, next: nil, completion: { _ in fatalError("Unadmitted stale revision callback") }) == nil)
        let pageWrite: Bool = await withCheckedContinuation { continuation in
            precondition(storage.write(namespace: "preferences", key: "nac.sidebar.open", value: "true") { continuation.resume(returning: $0) })
        }
        precondition(pageWrite)
        let snapshot = await storage.snapshot()
        precondition(Set(snapshot.keys) == ["available", "values"])
        let checkpoint = profile.home.appendingPathComponent("Library/Application Support/NAC/Presentation/dev/\(profile.digest)/checkpoint.json")
        let object = try JSONSerialization.jsonObject(with: Data(contentsOf: checkpoint)) as! [String: Any]
        precondition(object["version"] as? Int == 2 && (object["native"] as? [String: Any])?["notifications"] != nil)
        let retired: Bool = await withCheckedContinuation { continuation in
            storage.retireNotifications(token) { generation, durable in precondition(generation == 1); continuation.resume(returning: durable) }
        }
        precondition(retired && storage.beginNotifications(generation: 1) == nil)
        guard case .stale = await storage.readNotifications(token) else { fatalError("Retired capability hydrated") }
        let successor = storage.beginNotifications(generation: 2)!
        precondition(storage.updateNotifications(token, expectedRevision: 1, next: nil, completion: { _ in fatalError("Old token wrote successor") }) == nil)
        let reset: WorkspaceNotificationWrite = await withCheckedContinuation { continuation in
            precondition(storage.updateNotifications(successor, expectedRevision: 1, next: nil) { continuation.resume(returning: $0) } == 2)
        }
        guard case .durable(let revision) = reset, revision == 2 else { fatalError("Reset lacked exact ACK") }
        let after = try JSONSerialization.jsonObject(with: Data(contentsOf: checkpoint)) as! [String: Any]
        precondition(after["version"] as? Int == 1 && after["native"] == nil)
        precondition((after["values"] as? [String: [String: String]])?["preferences"]?["nac.sidebar.open"] == "true")
        _ = await withCheckedContinuation { continuation in storage.retireNotifications(successor) { _, durable in continuation.resume(returning: durable) } }
        try await WKWebsiteDataStore.remove(forIdentifier: profile.identifier)
        try FileManager.default.removeItem(at: root)
        print("Exact native ACK, same checkpoint preservation, revision/generation fencing and native-only reset passed.")
    }
}
