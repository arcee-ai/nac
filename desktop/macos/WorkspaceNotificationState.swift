import Foundation
import CoreFoundation

/// Native presentation metadata only. Neither this value nor its opaque IDs
/// supply OS authorization, execution intent or page-world capabilities.
struct WorkspaceNotificationState: Codable, Equatable {
    struct Receipt: Codable, Equatable {
        enum Phase: String, Codable { case reserved, scheduled }
        let occurrence: String
        let session: String
        let cursor: String
        var phase: Phase
    }

    var enabled = false
    var muted = false
    var unreadCompletions: UInt64 = 0
    var deliveryUncertain = false
    var seenDecisions: [String] = []
    var cutoff: String?
    var frontier: String?
    var receipts: [Receipt] = []

    static let receiptLimit = 64
    static let encodedLimit = 256 * 1024
    static let decisionLimit = 1024

    init(enabled: Bool = false, muted: Bool = false, unreadCompletions: UInt64 = 0, deliveryUncertain: Bool = false,
         seenDecisions: [String] = [], cutoff: String? = nil, frontier: String? = nil, receipts: [Receipt] = []) {
        self.enabled = enabled; self.muted = muted; self.unreadCompletions = unreadCompletions
        self.deliveryUncertain = deliveryUncertain
        self.seenDecisions = seenDecisions; self.cutoff = cutoff; self.frontier = frontier; self.receipts = receipts
    }

    enum CodingKeys: String, CodingKey { case enabled, muted, unreadCompletions, deliveryUncertain, seenDecisions, cutoff, frontier, receipts }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try c.decode(Bool.self, forKey: .enabled)
        muted = c.contains(.muted) ? try c.decode(Bool.self, forKey: .muted) : false
        unreadCompletions = c.contains(.unreadCompletions) ? try c.decode(UInt64.self, forKey: .unreadCompletions) : 0
        deliveryUncertain = c.contains(.deliveryUncertain) ? try c.decode(Bool.self, forKey: .deliveryUncertain) : false
        seenDecisions = c.contains(.seenDecisions) ? try c.decode([String].self, forKey: .seenDecisions) : []
        cutoff = try c.decodeIfPresent(String.self, forKey: .cutoff)
        frontier = try c.decodeIfPresent(String.self, forKey: .frontier)
        receipts = try c.decode([Receipt].self, forKey: .receipts)
    }

    private static func identifier(_ value: String, limit: Int) -> Bool {
        !value.isEmpty && value.utf8.count <= limit &&
            !value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }

    func encodedObject() -> [String: Any]? {
        guard receipts.count <= Self.receiptLimit,
              !enabled || (cutoff != nil && frontier != nil),
              seenDecisions.count <= Self.decisionLimit, Set(seenDecisions).count == seenDecisions.count,
              seenDecisions.allSatisfy({ $0.utf8.count == 64 && $0.unicodeScalars.allSatisfy { (48...57).contains($0.value) || (97...102).contains($0.value) } }),
              Set(receipts.map(\.occurrence)).count == receipts.count,
              [cutoff, frontier].compactMap({ $0 }).allSatisfy({ Self.identifier($0, limit: 2048) }),
              receipts.allSatisfy({ Self.identifier($0.occurrence, limit: 512) &&
                  Self.identifier($0.session, limit: 512) && Self.identifier($0.cursor, limit: 2048) }),
              let data = try? JSONEncoder().encode(self), data.count <= Self.encodedLimit,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return object
    }

    static func decode(_ object: Any) -> WorkspaceNotificationState? {
        guard let value = object as? [String: Any],
              Set(value.keys).isSubset(of: ["enabled", "muted", "unreadCompletions", "deliveryUncertain", "seenDecisions", "cutoff", "frontier", "receipts"]),
              let enabled = value["enabled"] as? NSNumber,
              CFGetTypeID(enabled) == CFBooleanGetTypeID(),
              let receipts = value["receipts"] as? [[String: Any]],
              receipts.allSatisfy({ Set($0.keys) == ["occurrence", "session", "cursor", "phase"] }),
              let data = try? JSONSerialization.data(withJSONObject: value), data.count <= encodedLimit,
              let decoded = try? JSONDecoder().decode(Self.self, from: data),
              decoded.encodedObject() != nil else { return nil }
        return decoded
    }
}

struct WorkspaceNotificationToken: Equatable {
    fileprivate let owner: UUID
    fileprivate let profile: UUID
    let generation: UInt64

    init(owner: UUID, profile: UUID, generation: UInt64) {
        self.owner = owner
        self.profile = profile
        self.generation = generation
    }

    func matches(owner: UUID, profile: UUID) -> Bool { self.owner == owner && self.profile == profile }
}

enum WorkspaceNotificationRead {
    case available(revision: UInt64, state: WorkspaceNotificationState, restored: Bool)
    case unavailable
    case stale
}

enum WorkspaceNotificationWrite {
    case durable(revision: UInt64)
    case unavailable(revision: UInt64)
    case stale
}
