import Foundation

@main
struct WorkspaceReadinessTests {
    static func main() throws {
        let identity = EngineIdentity(product_version: "test", build_id: "build", source_revision: "source", track: "dev")
        let receipt = EngineReceipt(kind: "ready", version: 1, incarnation: "launch", endpoint: "http://127.0.0.1:1234",
            identity: identity, store: "/fixture/store", schema: 1, stage: nil, code: nil, message: nil)
        let valid: [String: Any] = ["status": "ok", "product_version": "test", "build_id": "build",
                                  "source_revision": "source", "build_track": "dev", "opened_schema_version": 1]
        func bytes(_ value: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: value) }
        let accepted = try bytes(valid)
        precondition(WorkspaceReadiness.matches(accepted, receipt: receipt))
        for field in valid.keys {
            var missing = valid
            missing.removeValue(forKey: field)
            let incomplete = try bytes(missing)
            precondition(!WorkspaceReadiness.matches(incomplete, receipt: receipt))
            var changed = valid
            if field == "opened_schema_version" { changed[field] = 2 }
            else { changed[field] = "wrong" }
            let mismatched = try bytes(changed)
            precondition(!WorkspaceReadiness.matches(mismatched, receipt: receipt))
        }
        var boolean = valid
        boolean["opened_schema_version"] = true
        let wrongType = try bytes(boolean)
        precondition(!WorkspaceReadiness.matches(wrongType, receipt: receipt))
        precondition(!WorkspaceReadiness.matches(Data(repeating: 0, count: EngineProtocol.limit + 1), receipt: receipt))
        precondition(!WorkspaceReadiness.matches(Data("{bad".utf8), receipt: receipt))
        print("Owned-engine readiness binding fixtures passed")
    }
}
