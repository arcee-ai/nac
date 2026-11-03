import Foundation
import Darwin

@main
enum InstanceCaptureProtocolTests {
    static func rejected(_ label: String, _ work: () throws -> Void) {
        do { try work(); fatalError("Accepted " + label) } catch {}
    }

    static func configuration() throws -> Data {
        try captureJSON(["schema": "nac343-capture-config-v1", "run_nonce": String(repeating: "a", count: 32),
            "manifest_sha256": String(repeating: "b", count: 64), "target_sha": String(repeating: "c", count: 40),
            "harness_sha": String(repeating: "d", count: 40),
            "context": ["root": "/owned", "store": "/owned/store.db", "bundle": "/owned/app.app", "track": "dev",
                "native_sha256": String(repeating: "e", count: 64), "engine_sha256": String(repeating: "f", count: 64),
                "journey": "simultaneous"],
            "frames": [["ordinal": 1, "key": "simultaneous/workspace"], ["ordinal": 2, "key": "simultaneous/reopened"]]])
    }

    static func privateState() -> [String: String] {
        var value = Dictionary(uniqueKeysWithValues: InstanceCaptureProtocol.stateFields.map { ($0, "") })
        value.merge(["root": "/owned", "store": "/owned/store.db", "bundle": "/owned/app.app", "track": "dev",
         "app_pid": "123", "window_number": "456", "app_incarnation": UUID().uuidString,
         "app_launch_epoch": "1.0",
         "engine_pid": "789", "receipt_incarnation": "exact-generation", "origin": "http://127.0.0.1:12345",
         "receipt_store": "/owned/store.db", "receipt_schema": "1", "conflict_episode": "",
         "loading": "false", "document_url": "http://127.0.0.1:12345/#/", "reopen_count": "0"], uniquingKeysWith: { _, new in new })
        return value
    }

    static func release(_ request: [String: Any], digest: String) -> [String: Any] {
        ["schema": "nac343-provisional-release-v1", "run_nonce": request["run_nonce"]!,
         "request_nonce": request["request_nonce"]!, "ordinal": request["ordinal"]!, "key": request["key"]!,
         "configuration_sha256": request["configuration_sha256"]!, "request_sha256": digest]
    }

    static func main() async throws {
        if CommandLine.arguments.count == 4, CommandLine.arguments[1] == "child" {
            do { try await child(directory: CommandLine.arguments[2], digest: CommandLine.arguments[3]) }
            catch { fputs(error.localizedDescription + "\n", stderr); exit(2) }
            return
        }
        let config = try configuration()
        let fixture = try InstanceCaptureProtocol(configuration: config, expectedDigest: captureDigest(config))
        let state = privateState()
        rejected("unvalidated advancement") { try fixture.finishRelease() }
        rejected("out-of-order capture") { _ = try fixture.begin(name: "reopened", state: state) }
        let bytes = try fixture.begin(name: "workspace", state: state)
        let request = fixture.pending!
        let firstNonce = request["request_nonce"] as! String
        rejected("duplicate begin") { _ = try fixture.begin(name: "workspace", state: state) }
        let phase = try JSONSerialization.jsonObject(with: Data(fixture.publicPhase().utf8)) as! [String: Any]
        precondition(phase["request_sha256"] as! String == captureDigest(bytes))
        precondition(phase["store"] == nil && phase["origin"] == nil && phase["engine_pid"] == nil)
        let good = release(request, digest: captureDigest(bytes))
        for (key, value) in [("schema", "captured"), ("run_nonce", "wrong-run"), ("request_nonce", "stale"),
                             ("ordinal", 2), ("ordinal", true), ("key", "cli/conflict"),
                             ("configuration_sha256", "foreign"), ("request_sha256", "wrong")] as [(String, Any)] {
            var bad = good
            bad[key] = value
            rejected("mismatched release " + key) { _ = try fixture.release(captureJSON(bad), state: state) }
            precondition(fixture.index == 0 && fixture.pending != nil)
        }
        var extra = good
        extra["captured"] = true
        rejected("unknown completion field") { _ = try fixture.release(captureJSON(extra), state: state) }
        for key in state.keys {
            var changed = state
            changed[key] = "changed"
            rejected("changed private field " + key) { _ = try fixture.release(captureJSON(good), state: changed) }
        }
        // Deliberately early: no actor, image or attachment exists. The receipt
        // must say provisional/false and cannot turn this into capture acceptance.
        let fence = try JSONSerialization.jsonObject(with: fixture.release(captureJSON(good), state: state)) as! [String: Any]
        precondition(fence["release"] as! String == "provisional" && fence["capture_verified"] as! Bool == false)
        rejected("duplicate release") { _ = try fixture.release(captureJSON(good), state: state) }
        try fixture.finishRelease()
        rejected("late public phase") { _ = try fixture.publicPhase() }
        _ = try fixture.begin(name: "reopened", state: state)
        precondition(fixture.pending!["request_nonce"] as! String != firstNonce)
        rejected("prior frame release") { _ = try fixture.release(captureJSON(good), state: state) }
        fixture.retire()
        rejected("retired public phase") { _ = try fixture.publicPhase() }
        rejected("retired release") { _ = try fixture.release(captureJSON(good), state: state) }
        rejected("retired begin") { _ = try fixture.begin(name: "reopened", state: state) }
        rejected("bad config digest") { _ = try InstanceCaptureProtocol(configuration: config, expectedDigest: String(repeating: "0", count: 64)) }
        for mutate in 0..<4 {
            var value = try JSONSerialization.jsonObject(with: config) as! [String: Any]
            if mutate == 0 { value["frames"] = [["ordinal": 1, "key": "simultaneous/workspace"]] }
            if mutate == 1 { value["frames"] = [["ordinal": 1, "key": "simultaneous/workspace", "extra": true]] }
            if mutate == 2 { value["run_nonce"] = "malformed" }
            if mutate == 3 { value["schema"] = "foreign" }
            let data = try captureJSON(value)
            rejected("malformed/subset configuration") { _ = try InstanceCaptureProtocol(configuration: data, expectedDigest: captureDigest(data)) }
        }
        try fileControls()
        print("Capture protocol controls passed: provisional-only, state fences, identity, replay, subset and safe files")
    }

    static func fileControls() throws {
        let physical = try capturePhysicalPath(NSTemporaryDirectory())
        let root = URL(fileURLWithPath: physical).appendingPathComponent("nac-capture-component-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: root) }
        let files = try CaptureDirectory(root.path)
        defer { files.closeDirectory() }
        let data = try captureJSON(["record": "owned"])
        try files.writeNew("record.json", data: data)
        let stored = try files.read("record.json")
        let missing = try files.read("missing.json", optional: true)
        precondition(stored == data && missing == nil)
        rejected("record overwrite") { try files.writeNew("record.json", data: data) }
        try FileManager.default.createSymbolicLink(atPath: root.appendingPathComponent("link.json").path,
                                                  withDestinationPath: root.appendingPathComponent("record.json").path)
        rejected("symlink record") { _ = try files.read("link.json") }
        let hard = root.appendingPathComponent("hard.json").path
        precondition(link(root.appendingPathComponent("record.json").path, hard) == 0)
        rejected("hard link") { _ = try files.read("record.json") }
        precondition(unlink(hard) == 0)
        let fifo = root.appendingPathComponent("fifo.json").path
        precondition(mkfifo(fifo, 0o600) == 0)
        rejected("FIFO") { _ = try files.read("fifo.json") }
        try Data("{\"x\":1,\"x\":2}".utf8).write(to: root.appendingPathComponent("duplicate.json"))
        chmod(root.appendingPathComponent("duplicate.json").path, 0o600)
        rejected("duplicate JSON") { _ = try files.read("duplicate.json") }
        rejected("oversized writer") { try files.writeNew("large.json", data: Data(repeating: 1, count: CaptureDirectory.limit + 1)) }
        rejected("path traversal") { _ = try files.read("../foreign.json") }
        files.closeDirectory()
        rejected("closed directory") { _ = try files.read("record.json") }
    }

    /// An owned Foundation-only process, never NSApplication/engine/AX. Python
    /// exercises the exact Swift file/parser/state implementation across a process.
    static func child(directory: String, digest: String) async throws {
        let files = try CaptureDirectory(directory)
        defer { files.closeDirectory() }
        let config = try files.read("configuration.json")!
        let fixture = try InstanceCaptureProtocol(configuration: config, expectedDigest: digest)
        var state = privateState()
        for key in ["root", "bundle", "store", "track"] { state[key] = fixture.configuration.context[key] }
        let request = try fixture.begin(name: "workspace", state: state)
        try files.writeNew("request-01.json", data: request)
        let deadline = ProcessInfo.processInfo.systemUptime + 2
        while ProcessInfo.processInfo.systemUptime < deadline {
            if try files.read("retirement.json", optional: true) != nil { fixture.retire(); return }
            if let data = try files.read("provisional-release-01.json", optional: true) {
                let fence = try fixture.release(data, state: state)
                try files.writeNew("fence-01.json", data: fence)
                try fixture.finishRelease()
                return
            }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        fixture.retire()
        throw InstanceCaptureError.invalid("owned component request omitted release")
    }
}
