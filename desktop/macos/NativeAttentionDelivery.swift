import Foundation
import CryptoKit

struct NativeAttentionDestination: Equatable, Sendable {
    let profile: String
    let session: String
    let occurrence: String

    var identifier: String {
        let bytes = Data("nac-attention-v1\0\(profile)\0\(session)\0\(occurrence)".utf8)
        return "nac-attention-" + SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }
    var userInfo: [String: String] { ["profile": profile, "session": session, "occurrence": occurrence] }
    init(profile: String, session: String, occurrence: String) {
        self.profile = profile; self.session = session; self.occurrence = occurrence
    }
    init?(userInfo: [AnyHashable: Any], identifier: String) {
        guard Set(userInfo.keys.compactMap { $0 as? String }) == ["profile", "session", "occurrence"], userInfo.count == 3,
              let profile = userInfo["profile"] as? String, profile.utf8.count == 64,
              profile.unicodeScalars.allSatisfy({ (48...57).contains($0.value) || (97...102).contains($0.value) }),
              let session = userInfo["session"] as? String, let occurrence = userInfo["occurrence"] as? String,
              NativeSessionTarget.validID(session), NativeSessionTarget.validID(occurrence) else { return nil }
        self.init(profile: profile, session: session, occurrence: occurrence)
        guard self.identifier == identifier else { return nil }
    }
}

enum NativeAttentionTitle: String { case request = "Request completed", goal = "Goal completed", decision = "Decision needed" }
struct NativeNotificationAuthorization: Sendable { let allowed: Bool; let mayRequest: Bool }

/// The app owns one concrete OS adapter. Fixtures may inject this narrow seam;
/// an add acknowledgement never claims that the system displayed a banner.
@MainActor
protocol NativeAttentionDelivery: AnyObject {
    var response: ((NativeAttentionDestination) -> Void)? { get set }
    var shouldPresent: ((NativeAttentionDestination) -> Bool)? { get set }
    func settings(_ completion: @escaping (NativeNotificationAuthorization) -> Void)
    func authorize(_ completion: @escaping (Bool) -> Void)
    func add(_ destination: NativeAttentionDestination, title: NativeAttentionTitle, completion: @escaping (Bool) -> Void)
    func present(_ destination: NativeAttentionDestination, completion: @escaping (Bool) -> Void)
    func withdraw(_ identifiers: [String])
    func withdrawProfile(_ profile: String)
    func retire()
}

/// Cancellation releases the app's continuation, not an already issued OS or
/// checkpoint operation. Its original callback stays owned and late calls are
/// consumed without authorizing a successor generation.
@MainActor
private final class AttentionCallback<Value: Sendable> {
    var continuation: CheckedContinuation<Value, Never>?
    var finished = false
    func complete(_ value: Value) {
        guard !finished else { return }
        finished = true
        continuation?.resume(returning: value)
        continuation = nil
    }
}

@MainActor
func awaitNativeAttention<Value: Sendable>(fallback: Value,
    _ start: (@escaping (Value) -> Void) -> Void) async -> Value {
    let gate = AttentionCallback<Value>()
    return await withTaskCancellationHandler(operation: {
        await withCheckedContinuation { continuation in
            gate.continuation = continuation
            if Task.isCancelled || gate.finished { gate.finished = false; gate.complete(fallback); return }
            start { value in gate.complete(value) }
        }
    }, onCancel: {
        Task { @MainActor in gate.complete(fallback) }
    })
}
