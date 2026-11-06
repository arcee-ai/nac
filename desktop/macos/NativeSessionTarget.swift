import Foundation
import CoreFoundation

struct NativeSessionTargetRequest: Encodable {
    struct Target: Encodable {
        let session_id: String
        let occurrence_id: String
    }
    let version = 1
    let source = "notification-response"
    let request: Int
    let profile: String
    let launch: String
    let view: String
    let document: String
    let target: Target
}

/// Separate UI-only delivery state. Menu actions and their focus checks do not
/// change. An outcome reports navigation, never execution or approval success.
final class NativeSessionTarget {
    enum Outcome: String { case opened, deferred, unavailable, stale }
    private(set) var ready = false
    private var binding: NativeDocumentBinding?
    private var profile: String?
    private var sequence = 0
    private var pending: (Int, (Outcome) -> Void)?

    func begin(_ binding: NativeDocumentBinding, profile: String) {
        end()
        self.binding = binding
        self.profile = profile
    }

    func end() {
        let completion = pending?.1
        pending = nil
        ready = false
        binding = nil
        profile = nil
        completion?(.stale)
    }

    static func validID(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 512 &&
            !value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }

    func issue(session: String, occurrence: String, completion: @escaping (Outcome) -> Void) -> NativeSessionTargetRequest? {
        guard ready, let binding, let profile,
              sequence < Int(Int32.max), Self.validID(session), Self.validID(occurrence) else { return nil }
        sequence += 1
        let request = NativeSessionTargetRequest(request: sequence, profile: profile,
            launch: binding.launch, view: binding.view, document: binding.document,
            target: .init(session_id: session, occurrence_id: occurrence))
        guard let data = try? JSONEncoder().encode(request), data.count <= 8192 else { return nil }
        let previous = pending?.1
        pending = (sequence, completion)
        previous?(.stale)
        guard self.binding == binding, ready, pending?.0 == request.request else { return nil }
        return request
    }

    @discardableResult
    func receive(_ body: String, expected: NativeDocumentBinding) -> Bool {
        guard binding == expected, body.utf8.count <= 2048, let data = body.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let version = value["version"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(), version == 1,
              value["profile"] as? String == profile,
              value["launch"] as? String == expected.launch,
              value["view"] as? String == expected.view,
              value["document"] as? String == expected.document,
              let kind = value["kind"] as? String else { return false }
        let common: Set<String> = ["version", "kind", "profile", "launch", "view", "document"]
        switch kind {
        case "session_target_ready":
            guard Set(value.keys) == common, !ready else { return false }
            ready = true
        case "session_target_retired":
            guard Set(value.keys) == common else { return false }
            let completion = pending?.1
            pending = nil
            ready = false
            completion?(.stale)
        case "session_target_settled":
            guard Set(value.keys) == common.union(["request", "outcome"]), ready, let pending,
                  let number = value["request"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                  number.doubleValue == Double(pending.0), let raw = value["outcome"] as? String,
                  let outcome = Outcome(rawValue: raw) else { return false }
            self.pending = nil // consume before caller reentrancy
            pending.1(outcome)
        default: return false
        }
        return true
    }
}
