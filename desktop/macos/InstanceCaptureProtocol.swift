import Foundation

/// Fixed ALL343 capture points. Ordinals are identities, never notification counts.
struct InstanceCaptureFrame: Codable, Equatable {
    let ordinal: Int
    let key: String
    static let keys = ["simultaneous/workspace", "simultaneous/reopened", "cli/conflict", "cli/retry-workspace",
        "symlink/conflict", "symlink/retry-workspace", "directory-symlink/conflict", "directory-symlink/retry-workspace",
        "crash/conflict", "crash/retry-workspace", "shutdown/conflict", "shutdown/retry-workspace",
        "app-crash/initial/workspace", "app-crash/replacement/workspace", "app-crash/replacement/reopened",
        "coexist/dev/workspace", "coexist/stable/workspace", "coexist/stable/reopened", "coexist/dev/reopened"]
}

struct InstanceCaptureConfiguration: Decodable {
    let schema: String
    let run_nonce: String
    let manifest_sha256: String
    let target_sha: String
    let harness_sha: String
    let context: [String: String]
    let frames: [InstanceCaptureFrame]

    func validate() throws {
        let fields: Set<String> = ["root", "bundle", "store", "track", "native_sha256", "engine_sha256", "journey"]
        guard schema == "nac343-capture-config-v1", captureHex(run_nonce, 32),
              captureHex(manifest_sha256, 64), captureHex(target_sha, 40), captureHex(harness_sha, 40),
              Set(context.keys) == fields, ["dev", "stable"].contains(context["track"]),
              captureHex(context["native_sha256"] ?? "", 64), captureHex(context["engine_sha256"] ?? "", 64),
              !frames.isEmpty, frames.count <= 2 else { throw InstanceCaptureError.invalid("configuration binding") }
        for field in ["root", "bundle", "store"] {
            guard let value = context[field], value.hasPrefix("/"), value.utf8.count <= 4096,
                  !value.contains("\0"), !value.split(separator: "/").contains("..") else {
                throw InstanceCaptureError.invalid("configuration resource path")
            }
        }
        let expectedFrames = InstanceCaptureFrame.keys.enumerated().compactMap { index, key in
            key.hasPrefix(context["journey"]! + "/") ? InstanceCaptureFrame(ordinal: index + 1, key: key) : nil
        }
        guard context["store"]!.hasPrefix(context["root"]! + "/"), frames == expectedFrames,
              frames.map(\.ordinal) == frames.map(\.ordinal).sorted(),
              Set(frames.map(\.ordinal)).count == frames.count else { throw InstanceCaptureError.invalid("frame order") }
        for frame in frames {
            guard (1...19).contains(frame.ordinal), InstanceCaptureFrame.keys[frame.ordinal - 1] == frame.key,
                  frame.key.hasPrefix(context["journey"]! + "/"),
                  (frame.key.hasPrefix("coexist/stable/") ? "stable" : "dev") == context["track"] else {
                throw InstanceCaptureError.invalid("frame key or track")
            }
        }
    }
}

func captureHex(_ text: String, _ count: Int) -> Bool {
    text.count == count && text.allSatisfy { "0123456789abcdef".contains($0) }
}

func captureObject(_ data: Data, keys: Set<String>) throws -> [String: Any] {
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any], Set(object.keys) == keys else {
        throw InstanceCaptureError.invalid("record fields")
    }
    return object
}

/// Private T request state. Completion only means a provisional scheduling release;
/// nothing here authenticates an actor or proves that any image exists.
final class InstanceCaptureProtocol {
    static let stateFields: Set<String> = ["root", "store", "bundle", "track", "app_pid", "app_incarnation",
        "app_launch_epoch", "window_number", "engine_pid", "window_frame", "content_bounds", "receipt_incarnation",
        "receipt_store", "receipt_schema", "origin", "receipt_kind", "receipt_version", "engine_build", "engine_source",
        "engine_version", "endpoint", "document_url", "conflict_episode", "reopen_count", "loading"]
    let configuration: InstanceCaptureConfiguration
    let configurationDigest: String
    private(set) var index = 0
    private(set) var pending: [String: Any]?
    private(set) var requestDigest: String?
    private(set) var retired = false
    private var before: [String: String]?
    private var releaseReady = false

    init(configuration data: Data, expectedDigest: String) throws {
        let object = try captureObject(data, keys: ["schema", "run_nonce", "manifest_sha256", "target_sha", "harness_sha", "context", "frames"])
        guard let frames = object["frames"] as? [[String: Any]],
              frames.allSatisfy({ Set($0.keys) == ["ordinal", "key"] }) else {
            throw InstanceCaptureError.invalid("configuration frame fields")
        }
        guard captureHex(expectedDigest, 64), captureDigest(data) == expectedDigest else {
            throw InstanceCaptureError.invalid("configuration digest")
        }
        configuration = try JSONDecoder().decode(InstanceCaptureConfiguration.self, from: data)
        try configuration.validate()
        configurationDigest = expectedDigest
    }

    func begin(name: String, state: [String: String]) throws -> Data {
        guard !retired, pending == nil, index < configuration.frames.count else {
            throw InstanceCaptureError.invalid("retired, duplicate or extra capture")
        }
        let frame = configuration.frames[index]
        guard frame.key == configuration.context["journey"]! + "/" + name,
              state["store"] == configuration.context["store"],
              state["track"] == configuration.context["track"],
              state["bundle"] == configuration.context["bundle"], state["root"] == configuration.context["root"] else {
            throw InstanceCaptureError.invalid("capture resource or frame changed")
        }
        guard Set(state.keys) == Self.stateFields, let pid = Int(state["app_pid"] ?? ""), pid > 0,
              let window = Int(state["window_number"] ?? ""), window > 0,
              let epoch = Double(state["app_launch_epoch"] ?? ""), epoch.isFinite, epoch > 0,
              let engine = Int(state["engine_pid"] ?? ""), engine >= 0,
              let reopens = Int(state["reopen_count"] ?? ""), reopens >= 0,
              ["true", "false"].contains(state["loading"]),
              UUID(uuidString: state["app_incarnation"] ?? "") != nil else {
            throw InstanceCaptureError.invalid("capture app/window identity")
        }
        let request: [String: Any] = ["schema": "nac343-capture-request-v1", "run_nonce": configuration.run_nonce,
            "request_nonce": UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased(),
            "ordinal": frame.ordinal, "key": frame.key, "configuration_sha256": configurationDigest,
            "manifest_sha256": configuration.manifest_sha256, "before": state]
        let data = try captureJSON(request)
        pending = request
        requestDigest = captureDigest(data)
        before = state
        return data
    }

    func publicPhase() throws -> String {
        guard let pending, let requestDigest, let before else { throw InstanceCaptureError.invalid("no pending phase") }
        let value: [String: Any] = ["schema": "nac343-public-phase-v1", "run_nonce": configuration.run_nonce,
            "request_nonce": pending["request_nonce"]!, "ordinal": pending["ordinal"]!, "key": pending["key"]!,
            "configuration_sha256": configurationDigest, "manifest_sha256": configuration.manifest_sha256,
            "request_sha256": requestDigest, "track": configuration.context["track"]!,
            "app_pid": before["app_pid"] ?? "", "app_incarnation": before["app_incarnation"] ?? "",
            "app_launch_epoch": before["app_launch_epoch"] ?? "",
            "window_number": before["window_number"] ?? ""]
        let data = try captureJSON(value)
        guard data.count <= 2048, let text = String(data: data, encoding: .utf8) else {
            throw InstanceCaptureError.invalid("public phase bound")
        }
        return text
    }

    func requireState(_ state: [String: String]) throws {
        guard !retired, let before, before == state else { throw InstanceCaptureError.invalid("private capture state changed or retired") }
    }

    func release(_ data: Data, state: [String: String]) throws -> Data {
        try requireState(state)
        guard !releaseReady else { throw InstanceCaptureError.invalid("duplicate provisional release") }
        guard let pending, let requestDigest, let before else { throw InstanceCaptureError.invalid("no pending request") }
        let release = try captureObject(data, keys: ["schema", "run_nonce", "request_nonce", "ordinal", "key",
            "configuration_sha256", "request_sha256"])
        guard release["schema"] as? String == "nac343-provisional-release-v1",
              release["request_sha256"] as? String == requestDigest else { throw InstanceCaptureError.invalid("release kind or digest") }
        for field in ["run_nonce", "request_nonce", "ordinal", "key", "configuration_sha256"] {
            guard let left = release[field], let right = pending[field],
                  try captureJSON(["value": left]) == captureJSON(["value": right]) else {
                throw InstanceCaptureError.invalid("release does not match the pending request")
            }
        }
        let result = try captureJSON(["schema": "nac343-private-fence-v1", "run_nonce": configuration.run_nonce,
            "request_nonce": pending["request_nonce"]!, "ordinal": pending["ordinal"]!, "key": pending["key"]!,
            "configuration_sha256": configurationDigest, "request_sha256": requestDigest,
            "release": "provisional", "capture_verified": false, "before": before, "after": state])
        releaseReady = true
        return result
    }

    func finishRelease() throws {
        guard releaseReady, pending != nil, !retired else { throw InstanceCaptureError.invalid("release not validated") }
        pending = nil; requestDigest = nil; before = nil; index += 1
        releaseReady = false
    }

    func retire() { retired = true; pending = nil; requestDigest = nil; before = nil; releaseReady = false }
}
