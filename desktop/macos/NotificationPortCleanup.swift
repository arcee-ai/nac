import Foundation
import WebKit

/// Launched only by the controller after its exact port child is reaped.
/// Never accepts a supplied UUID, deletes a directory, or opens a checkpoint.
@main
enum NotificationPortCleanup {
    @MainActor
    static func main() async throws {
        let fixture = try NotificationPortFixture()
        guard let profile = WorkspaceStorageProfile(receipt: fixture.receipt, configuration: fixture.configuration) else {
            throw NotificationPortFixture.failed()
        }
        try fixture.validate()
        let initialization = WKWebsiteDataStore.nonPersistent()
        try await WKWebsiteDataStore.remove(forIdentifier: profile.identifier)
        // A replaced path or late completion never authorizes filesystem removal.
        try fixture.validate()
        let result: [String: Any] = ["root": fixture.root.path, "profile": profile.digest,
            "website_store_removed": profile.identifier.uuidString,
            "initialization_ephemeral": !initialization.isPersistent]
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]))
        FileHandle.standardOutput.write(Data([10]))
    }
}
