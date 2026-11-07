import Foundation
import WebKit
import CryptoKit
import CoreFoundation

struct WorkspaceStorageProfile {
    let identifier: UUID
    let digest: String
    let track: String
    let home: URL
    var binding: [String: String] {
        ["owner": "desktop-\(digest)", "profile": digest, "organization": "local",
         "host": "local", "store": digest, "track": track]
    }
    var draftKey: String {
        let fields = ["owner", "profile", "organization", "host", "store", "track"]
        let data = try! JSONSerialization.data(withJSONObject: fields.map { binding[$0]! }, options: [.withoutEscapingSlashes])
        return "nac:prompt-drafts:v2:" + String(decoding: data, as: UTF8.self)
    }

    init?(receipt: EngineReceipt, configuration: EngineLaunchConfiguration) {
        guard let identity = receipt.identity, let store = receipt.store,
              store.hasPrefix("/"), ["dev", "beta", "stable"].contains(identity.track),
              (configuration.environment["HOME"] ?? NSHomeDirectory()).hasPrefix("/") else { return nil }
        let home = configuration.environment["HOME"] ?? NSHomeDirectory()
        self.home = URL(fileURLWithPath: home).resolvingSymlinksInPath()
        track = identity.track
        // Rust supplied and verified the physical selected-store identity. Paths
        // never cross the page boundary and the serving nonce is deliberately absent.
        let raw = Data("nac-presentation-v1\u{0}\(self.home.path)\u{0}\(track)\u{0}\(store)".utf8)
        var hash = Array(SHA256.hash(data: raw))
        digest = hash.map { String(format: "%02x", $0) }.joined()
        hash[6] = (hash[6] & 0x0f) | 0x50
        hash[8] = (hash[8] & 0x3f) | 0x80
        identifier = UUID(uuid: (hash[0], hash[1], hash[2], hash[3], hash[4], hash[5], hash[6], hash[7],
                                 hash[8], hash[9], hash[10], hash[11], hash[12], hash[13], hash[14], hash[15]))
    }
}

/// One desktop-selected profile owns presentation bytes and its website store.
/// React's existing owners still interpret preferences/drafts. No query, command
/// or submission state is represented here.
@MainActor
final class WorkspaceStorage {
    let profile: WorkspaceStorageProfile
    private(set) var websiteDataStore = WKWebsiteDataStore.nonPersistent()
    private let checkpoint: WorkspaceCheckpoint
    private(set) var values: [String: [String: String]] = ["preferences": [:], "drafts": [:]]
    private(set) var available = true
    private var pending = 0
    private var waiters: [UUID: (Bool) -> Void] = [:]

    #if PREVIEW_SMOKE && LOCAL_APP
    // Observation only; every actual enqueue has one sequence, including native writes.
    static var smokeQ1Event: (([String: Any], String?) -> Void)?
    private let smokeQ1Owner = UUID().uuidString
    private var smokeQ1Sequence = 0
    private func smokeQ1Report(_ kind: String, sequence: Int,
                               ordinary: (namespace: String, key: String, value: String?)? = nil,
                               checkpoint: Data? = nil, durable: Bool? = nil,
                               observer: (([String: Any], String?) -> Void)?) {
        var event: [String: Any] = ["kind": kind, "owner": smokeQ1Owner,
            "profile": profile.digest, "sequence": sequence]
        if kind != "flush" {
            event["writeClass"] = ordinary == nil ? "native-notifications" : "ordinary"
        }
        if let ordinary {
            event["namespace"] = ordinary.namespace
            event["keySHA256"] = Self.smokeQ1Hash(Data(ordinary.key.utf8))
            event["valueSHA256"] = Self.smokeQ1Hash(Data((ordinary.value ?? "").utf8))
            event["clear"] = ordinary.value == nil
        }
        if let checkpoint { event["checkpointSHA256"] = Self.smokeQ1Hash(checkpoint) }
        if let durable { event["durable"] = durable }
        observer?(event, ordinary?.value)
    }
    private static func smokeQ1Hash(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    #endif

    private init(profile: WorkspaceStorageProfile) {
        self.profile = profile
        checkpoint = WorkspaceCheckpoint(home: profile.home, profile: profile.digest, track: profile.track)
    }

    #if PREVIEW_SMOKE
    // Actual-app fixture completion barrier only; absent from ordinary binaries.
    static var smokeBeforeOpen: ((WorkspaceStorageProfile) async -> Void)?
    static var smokeDidOpen: ((WorkspaceStorageProfile) -> Void)?
    #endif

    static func open(receipt: EngineReceipt, configuration: EngineLaunchConfiguration) async -> WorkspaceStorage? {
        guard let profile = WorkspaceStorageProfile(receipt: receipt, configuration: configuration) else { return nil }
        let storage = WorkspaceStorage(profile: profile)
        #if PREVIEW_SMOKE
        await smokeBeforeOpen?(profile)
        #endif
        await withCheckedContinuation { continuation in
            var finished = false
            let finish: (Result<Data?, Error>?) -> Void = { result in
                guard !finished else { return }
                finished = true
                switch result {
                case .success(nil)?: break
                case .success(let data?)?:
                    if !storage.restore(data) { storage.available = false }
                default: storage.available = false
                }
                if storage.available {
                    storage.websiteDataStore = WKWebsiteDataStore(forIdentifier: profile.identifier)
                }
                continuation.resume()
            }
            storage.checkpoint.load { finish($0) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { finish(nil) }
        }
        #if PREVIEW_SMOKE
        smokeDidOpen?(profile)
        #endif
        return storage
    }

    private func restore(_ data: Data) -> Bool {
        guard data.count <= WorkspaceCheckpoint.limit,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == ["version", "profile", "values"],
              let version = object["version"] as? NSNumber,
              CFGetTypeID(version) != CFBooleanGetTypeID(), version == 1,
              object["profile"] as? String == profile.digest,
              let saved = object["values"] as? [String: [String: String]],
              Set(saved.keys) == ["preferences", "drafts"],
              saved.allSatisfy({ namespace, entries in
                  entries.count <= 256 && entries.allSatisfy { validKey(namespace, $0.key) }
              }) else { return false }
        values = saved
        return true
    }

    func validKey(_ namespace: String, _ key: String) -> Bool {
        if namespace == "drafts" { return key == profile.draftKey }
        guard namespace == "preferences", key.utf8.count <= 512 else { return false }
        return ["nac-panel-list-width", "nac-thread-log-height-ratio", "nac.last-light-model",
                "nac.chatTabs", "nac.sessionNavigation", "nac.sidebar.open"].contains(key) ||
            key.hasPrefix("nac.rightSidebar.collapsed.")
    }

    @discardableResult
    func write(namespace: String, key: String, value: String?, completion: @escaping (Bool) -> Void) -> Bool {
        guard validKey(namespace, key), (value?.utf8.count ?? 0) <= WorkspaceCheckpoint.limit else { return false }
        var next = values
        next[namespace, default: [:]][key] = value
        guard (next[namespace]?.count ?? 0) <= 256,
              let data = try? JSONSerialization.data(withJSONObject: ["version": 1, "profile": profile.digest, "values": next]),
              data.count <= WorkspaceCheckpoint.limit else { return false }
        values = next
        guard available else {
            #if PREVIEW_SMOKE && LOCAL_APP
            smokeQ1Report("not-enqueued", sequence: smokeQ1Sequence,
                          ordinary: (namespace, key, value), checkpoint: data, durable: false,
                          observer: Self.smokeQ1Event)
            #endif
            completion(false); return true
        }
        #if PREVIEW_SMOKE && LOCAL_APP
        smokeQ1Sequence += 1
        // Bind observation at acceptance; a later hook must never receive an
        // unpaired completion for an earlier write. The disk queue is unchanged.
        let q1Observer = Self.smokeQ1Event
        let q1Sequence = smokeQ1Sequence
        let q1Ordinary = (namespace: namespace, key: key, value: value)
        smokeQ1Report("accepted", sequence: q1Sequence, ordinary: q1Ordinary,
                      checkpoint: data, observer: q1Observer)
        #endif
        pending += 1
        // DispatchQueue order is the accepted-write order, including empty tombstones.
        checkpoint.write(data) { [self] durable in
            pending -= 1
            if !durable { available = false }
            #if PREVIEW_SMOKE && LOCAL_APP
            smokeQ1Report("completed", sequence: q1Sequence, ordinary: q1Ordinary,
                          checkpoint: data, durable: durable && available, observer: q1Observer)
            #endif
            completion(durable && available)
            if pending == 0 {
                let callbacks = waiters.values
                waiters.removeAll()
                callbacks.forEach { $0(available) }
            }
        }
        return true
    }

    /// A bound prevents disk failure from lengthening the existing stop policy.
    /// Timeout is not success and does not reissue/cancel the owned disk write.
    func flush(timeout: TimeInterval = 0.5, completion: @escaping (Bool) -> Void) {
        #if PREVIEW_SMOKE && LOCAL_APP
        let originalCompletion = completion, q1Sequence = smokeQ1Sequence
        let q1Observer = Self.smokeQ1Event
        let completion: (Bool) -> Void = { [self] durable in
            smokeQ1Report("flush", sequence: q1Sequence, durable: durable, observer: q1Observer)
            originalCompletion(durable)
        }
        #endif
        guard pending > 0 else { completion(available); return }
        let token = UUID()
        waiters[token] = completion
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in
            self?.waiters.removeValue(forKey: token)?(false)
        }
    }

    func snapshot() async -> [String: Any] {
        let durable: Bool = await withCheckedContinuation { continuation in
            flush { continuation.resume(returning: $0) }
        }
        // After a failed barrier, never hydrate a successor from an uncertain old snapshot.
        return ["available": durable, "values": durable ? values : ["preferences": [:], "drafts": [:]]]
    }
}
