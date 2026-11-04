import Foundation

@main
struct NativeAuthIdentityTests {
    static func main() async throws {
        let normal = EngineIdentity(product_version: "test", build_id: "arbitrary-normal-id", source_revision: "source", track: "dev")
        let fixture = EngineIdentity(product_version: "test", build_id: "native-auth-fixture-v1-override", source_revision: "source", track: "dev")
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(fixture)) as! [String: Any]
        precondition(Set(encoded.keys) == Set(["product_version", "build_id", "source_revision", "track"]))
        let rejected: EngineIdentity
        #if NATIVE_AUTH_FIXTURE
        precondition(fixture.matchesShellBuild && !normal.matchesShellBuild)
        rejected = normal
        #else
        precondition(normal.matchesShellBuild && !fixture.matchesShellBuild)
        rejected = fixture
        #endif
        let missing = URL(fileURLWithPath: "/nac-missing-fixture-\(UUID().uuidString)")
        do {
            _ = try EngineProtocol(identity: rejected, store: missing.appendingPathComponent("store.db"))
            preconditionFailure("Wrong engine reached store discovery")
        } catch {
            precondition(error.localizedDescription.contains("does not match this app"))
        }
        let options = try DesktopStartup.Options(arguments: [])
        do {
            _ = try await DesktopStartup.select(executable: missing, identity: rejected, options: options, inherited: [:])
            preconditionFailure("Wrong engine reached HOME/path/config discovery")
        } catch {
            precondition(error.localizedDescription.contains("does not match this app"))
        }
        precondition(!FileManager.default.fileExists(atPath: missing.path))
        print("Normal/auth fixture classification preserves v1 and rejects before discovery")
    }
}
