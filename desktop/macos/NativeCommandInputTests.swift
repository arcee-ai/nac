#if PREVIEW_SMOKE
import Foundation
import Darwin

@main
struct NativeCommandInputTests {
    @MainActor
    static func main() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nac-command-driver-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: root) }
        let identity = EngineIdentity(product_version: "fixture", build_id: "fixture", source_revision: "fixture-source", track: "dev")
        let receipt = EngineReceipt(kind: "ready", version: 1, incarnation: "launch", endpoint: "http://127.0.0.1:1234", identity: identity,
                                    store: "/fixture/store", schema: 1, stage: nil, code: nil, message: nil)
        let driver = try ExternalCommandFixture(directory: root, binding: ["launch": "launch", "view": "view", "document": "document"], window: 123,
            receipt: receipt, buildMetadata: ["source_head": "fixture-source", "native_sha256": "fixture-native", "engine_sha256": "fixture-engine"])
        func rejects(_ operation: () throws -> Void) {
            do { try operation(); preconditionFailure("Unsafe driver receipt accepted") } catch {}
        }
        let ack = root.appendingPathComponent("commands-input-ack.json")
        let phase = root.appendingPathComponent("commands-input-phase.json")
        func published() throws -> [String: Any] { try JSONSerialization.jsonObject(with: Data(contentsOf: phase)) as! [String: Any] }
        func acknowledge(_ object: [String: Any]) throws { try JSONSerialization.data(withJSONObject: object).write(to: ack, options: .atomic) }
        rejects { try driver.ready("copy") }
        try driver.ready("type-fixture")
        let first = try published()
        precondition(first["kind"] as? String == "ready")
        precondition(first["launch"] as? String == "launch" && first["view"] as? String == "view" && first["document"] as? String == "document")
        let absent = try driver.acknowledged(); precondition(!absent)
        rejects { try driver.verified("type-fixture") }
        var valid = first; valid["kind"] = "attempted"
        for field in ["episode", "sequence", "phase", "pid", "window", "launch", "view", "document", "source", "native_sha256", "engine_sha256"] {
            var stale = valid; stale[field] = "wrong"
            try acknowledge(stale)
            let accepted = try driver.acknowledged(); precondition(!accepted)
        }
        var unknown = valid; unknown["operation"] = "shell"
        try acknowledge(unknown)
        let unknownAccepted = try driver.acknowledged(); precondition(!unknownAccepted)
        try acknowledge(valid)
        let accepted = try driver.acknowledged(); precondition(accepted)
        let duplicate = try driver.acknowledged(); precondition(!duplicate)
        try driver.verified("type-fixture")
        rejects { try driver.verified("type-fixture") }
        try driver.ready("copy")
        let old = try driver.acknowledged(); precondition(!old)
        try Data(repeating: 120, count: 4097).write(to: ack)
        rejects { _ = try driver.acknowledged() }
        try FileManager.default.removeItem(at: ack)
        let untouched = root.appendingPathComponent("untouched")
        try Data("untouched".utf8).write(to: untouched)
        try FileManager.default.createSymbolicLink(at: ack, withDestinationURL: untouched)
        rejects { _ = try driver.acknowledged() }
        let preserved = try Data(contentsOf: untouched); precondition(preserved == Data("untouched".utf8))
        try FileManager.default.removeItem(at: ack)
        precondition(mkfifo(ack.path, 0o600) == 0)
        rejects { _ = try driver.acknowledged() } // Nonblocking open: a FIFO cannot hang this fixture.
        try FileManager.default.removeItem(at: ack)
        var second = try published(); second["kind"] = "attempted"
        try acknowledge(second)
        let copy = try driver.acknowledged(); precondition(copy)
        try driver.verified("copy")
        try driver.finish(accepted: false)
        let final = try published()
        precondition(final["kind"] as? String == "finished" && final["accepted"] as? Bool == false)
        precondition(final["verified_phases"] as? [String] == ["type-fixture", "copy"])
        print("External command driver correlation/bounds/no-follow fixtures passed; no GUI/input qualification")
    }
}
#endif
