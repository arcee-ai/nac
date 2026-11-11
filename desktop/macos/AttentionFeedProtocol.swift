import Foundation

enum AttentionFeedError: Error { case invalid, capacity, rebaseline }

/// Exact HTTP metadata shapes from delivery/attention_contracts.rs. These are
/// observation receipts, never commands or permission capabilities.
enum AttentionWire {
    static let sources = 1024
    static let identities = 1024
    static let metadataBytes = 1024 * 1024
    static let identifierBytes = 512
    // JSON can escape one identifier byte as six bytes. 640 fixed bytes for
    // EACH source and identity also cover keys, enums, UUID text and scalars:
    // 6*1MiB + 2*1024*640 + 4096 = 7,606,272 < 8MiB. Tests bind this envelope
    // to the actual writer/OpenAPI and exercise a maximally escaped baseline.
    static let eventBytes = 8 * 1024 * 1024

    struct Cursor: Decodable, Equatable {
        let engine: UUID
        let epoch: UUID
        let sequence: UInt64
        var id: String { "\(engine.uuidString.lowercased()):\(epoch.uuidString.lowercased()):\(sequence)" }
    }
    struct Source: Decodable, Equatable {
        let session_id: String
        let epoch: UUID
    }
    enum Facet: String, Decodable { case available, unknown, unsupported }
    struct Availability: Decodable, Equatable {
        let work: Facet
        let questions: Facet
        let permissions: Facet
        let reviews: Facet
        let topology: Facet
        func facet(for decision: Decision) -> Facet {
            switch decision {
            case .permission: return permissions
            case .review: return reviews
            case .question: return questions
            }
        }
    }
    struct Goal: Decodable, Equatable { let id: String; let version: UInt64 }
    enum Disposition: String, Decodable { case completed, continuing, waiting_for_decision }
    struct Work: Decodable, Equatable {
        let run_id: String
        let goal: Goal?
        let disposition: Disposition
        enum CodingKeys: String, CodingKey { case run_id, goal, disposition }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            guard c.contains(.goal) else { throw AttentionFeedError.invalid }
            run_id = try c.decode(String.self, forKey: .run_id)
            goal = try c.decodeIfPresent(Goal.self, forKey: .goal)
            disposition = try c.decode(Disposition.self, forKey: .disposition)
        }
        var bytes: Int { run_id.utf8.count + 16 + (goal.map { $0.id.utf8.count + 8 } ?? 0) }
    }
    enum Decision: Decodable, Equatable {
        case permission(String)
        case review(String)
        case question(request: String, run: String, generation: String, revision: UInt64)
        enum CodingKeys: String, CodingKey { case kind, request_id, review_id, run_id, generation, revision }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            switch try c.decode(String.self, forKey: .kind) {
            case "permission": self = .permission(try c.decode(String.self, forKey: .request_id))
            case "review": self = .review(try c.decode(String.self, forKey: .review_id))
            case "question": self = .question(request: try c.decode(String.self, forKey: .request_id),
                                               run: try c.decode(String.self, forKey: .run_id),
                                               generation: try c.decode(String.self, forKey: .generation),
                                               revision: try c.decode(UInt64.self, forKey: .revision))
            default: throw AttentionFeedError.invalid
            }
        }
        // Length-prefixed components avoid aliases even for opaque IDs containing
        // separators. Question revision changes membership, not notice identity.
        var key: String {
            switch self {
            case .permission(let id): return "p" + Self.part(id)
            case .review(let id): return "r" + Self.part(id)
            case .question(let id, let run, let generation, _):
                return "q" + Self.part(id) + Self.part(run) + Self.part(generation)
            }
        }
        static func part(_ value: String) -> String { "\(value.utf8.count):\(value)" }
        var bytes: Int {
            switch self {
            case .permission(let id), .review(let id): return id.utf8.count + 16
            case .question(let id, let run, let generation, _):
                return id.utf8.count + run.utf8.count + generation.utf8.count + 24
            }
        }
        var valid: Bool {
            switch self {
            case .permission(let id), .review(let id): return AttentionWire.validID(id)
            case .question(let id, let run, let generation, let revision):
                return [id, run, generation].allSatisfy(AttentionWire.validID) && revision > 0
            }
        }
        var questionRevision: UInt64? {
            if case .question(_, _, _, let revision) = self { return revision }
            return nil
        }
    }
    struct Snapshot: Decodable, Equatable {
        let source: Source
        var revision: UInt64
        var work: Work?
        var pending: [Decision]
        var availability: Availability
        enum CodingKeys: String, CodingKey { case source, revision, work, pending, availability }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            guard c.contains(.work) else { throw AttentionFeedError.invalid }
            source = try c.decode(Source.self, forKey: .source)
            revision = try c.decode(UInt64.self, forKey: .revision)
            work = try c.decodeIfPresent(Work.self, forKey: .work)
            pending = try c.decode([Decision].self, forKey: .pending)
            availability = try c.decode(Availability.self, forKey: .availability)
        }
        var bytes: Int {
            2 * source.session_id.utf8.count + 32 + (work?.bytes ?? 0)
                + pending.reduce(0) { $0 + $1.bytes + 1 }
        }
    }
    enum Change: Decodable, Equatable {
        case sourceReplaced(Snapshot), workSettled(Work), workCleared
        case decisionPending(Decision), decisionResolved(Decision)
        case sessionDeleted, availability(Availability), checkpoint
        enum CodingKeys: String, CodingKey { case kind, snapshot, work, decision, availability }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            switch try c.decode(String.self, forKey: .kind) {
            case "source_replaced": self = .sourceReplaced(try c.decode(Snapshot.self, forKey: .snapshot))
            case "work_settled": self = .workSettled(try c.decode(Work.self, forKey: .work))
            case "work_cleared": self = .workCleared
            case "decision_pending": self = .decisionPending(try c.decode(Decision.self, forKey: .decision))
            case "decision_resolved": self = .decisionResolved(try c.decode(Decision.self, forKey: .decision))
            case "session_deleted": self = .sessionDeleted
            case "availability": self = .availability(try c.decode(Availability.self, forKey: .availability))
            case "checkpoint": self = .checkpoint
            default: throw AttentionFeedError.invalid
            }
        }
    }
    enum Reset: String, Decodable { case incarnation, replay_gap, invalid_cursor }
    enum Frame: Decodable, Equatable {
        case completions(CompletionPage)
        case baseline(Cursor, [Snapshot], Reset?)
        case record(Cursor, Source, UInt64, Change, Bool)
        case reset(Reset)
        enum CodingKeys: String, CodingKey { case kind, boundary, sources, reset, source, source_revision, change, new_attention, reason, page }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            switch try c.decode(String.self, forKey: .kind) {
            case "completions": self = .completions(try c.decode(CompletionPage.self, forKey: .page))
            case "baseline":
                guard c.contains(.reset) else { throw AttentionFeedError.invalid }
                self = .baseline(try c.decode(Cursor.self, forKey: .boundary),
                                 try c.decode([Snapshot].self, forKey: .sources),
                                 try c.decodeIfPresent(Reset.self, forKey: .reset))
            case "record": self = .record(try c.decode(Cursor.self, forKey: .boundary),
                                            try c.decode(Source.self, forKey: .source),
                                            try c.decode(UInt64.self, forKey: .source_revision),
                                            try c.decode(Change.self, forKey: .change),
                                            try c.decode(Bool.self, forKey: .new_attention))
            case "reset": self = .reset(try c.decode(Reset.self, forKey: .reason))
            default: throw AttentionFeedError.invalid
            }
        }
        var boundary: Cursor? {
            switch self { case .baseline(let b, _, _), .record(let b, _, _, _, _): return b; case .reset, .completions: return nil }
        }
    }
    static func validID(_ id: String) -> Bool {
        !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && id.utf8.count <= identifierBytes
    }
    static func validUUID(_ id: UUID) -> Bool { id != UUID(uuid: (0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)) }
    static func validate(_ source: Source) throws {
        guard validID(source.session_id), validUUID(source.epoch) else { throw AttentionFeedError.invalid }
    }
    static func validate(_ work: Work) throws {
        guard validID(work.run_id), work.goal.map({ validID($0.id) && $0.version > 0 }) ?? true else {
            throw AttentionFeedError.invalid
        }
    }
    static func validate(_ snapshot: Snapshot) throws {
        try validate(snapshot.source)
        if let work = snapshot.work { try validate(work) }
        guard snapshot.pending.count <= identities, snapshot.bytes <= metadataBytes else { throw AttentionFeedError.capacity }
        guard snapshot.pending.allSatisfy({ $0.valid }), Set(snapshot.pending.map { $0.key }).count == snapshot.pending.count else {
            throw AttentionFeedError.invalid
        }
    }
    static func validate(_ frame: Frame) throws {
        if let b = frame.boundary, !validUUID(b.engine) || !validUUID(b.epoch) { throw AttentionFeedError.invalid }
        switch frame {
        case .completions(let page): try page.validate()
        case .baseline(_, let snapshots, _):
            guard snapshots.count <= sources, snapshots.reduce(0, { $0 + $1.bytes }) <= metadataBytes,
                  snapshots.reduce(0, { $0 + $1.pending.count + ($1.work == nil ? 0 : 1) }) <= identities else {
                throw AttentionFeedError.capacity
            }
            guard Set(snapshots.map { $0.source.session_id }).count == snapshots.count else { throw AttentionFeedError.invalid }
            for snapshot in snapshots { try validate(snapshot) }
        case .record(_, let source, _, let change, _):
            try validate(source)
            switch change {
            case .sourceReplaced(let snapshot):
                try validate(snapshot)
                guard snapshot.source == source else { throw AttentionFeedError.invalid }
            case .workSettled(let work): try validate(work)
            case .decisionPending(let decision), .decisionResolved(let decision):
                guard decision.valid else { throw AttentionFeedError.invalid }
            default: break
            }
        case .reset: break
        }
    }
}

/// Incremental byte parsing bounds BOTH unterminated lines and complete events.
/// UTF8 decoding occurs only at a full line, so split multibyte input is safe.
struct AttentionSSEParser {
    private var line = Data()
    private var data = Data()
    private var event = ""
    private var id: String?
    private var eventBytes = 0
    private var carriageReturn = false
    var retainedBytes: Int { line.count + data.count + event.utf8.count + (id?.utf8.count ?? 0) }

    mutating func append(_ bytes: Data, receive: (AttentionWire.Frame) throws -> Void) throws {
        _ = try consume(bytes) { frame in try receive(frame); return true }
    }

    /// Return the unconsumed tail when the owner suspends one page for durable
    /// native accounting. No unbounded parsed-frame queue is introduced.
    mutating func consume(_ bytes: Data, receive: (AttentionWire.Frame) throws -> Bool) throws -> Data {
        for (offset, byte) in bytes.enumerated() {
            if carriageReturn { carriageReturn = false; if byte == 10 { continue } }
            eventBytes += 1
            guard eventBytes <= AttentionWire.eventBytes else { throw AttentionFeedError.capacity }
            if byte == 10 || byte == 13 {
                let keepReading = try finishLine(receive: receive)
                if byte == 13 { carriageReturn = true }
                if !keepReading { return Data(bytes.dropFirst(offset + 1)) }
            } else {
                guard line.count < AttentionWire.eventBytes else { throw AttentionFeedError.capacity }
                line.append(byte)
            }
        }
        return Data()
    }
    private mutating func finishLine(receive: (AttentionWire.Frame) throws -> Bool) throws -> Bool {
        guard let text = String(data: line, encoding: .utf8) else { throw AttentionFeedError.invalid }
        line.removeAll(keepingCapacity: false)
        if text.isEmpty {
            defer { data = Data(); event = ""; id = nil; eventBytes = 0 }
            guard !data.isEmpty else { return true }
            guard event == "attention" else { throw AttentionFeedError.invalid }
            data.removeLast() // Last data-line newline is not part of SSE data.
            let frame = try JSONDecoder().decode(AttentionWire.Frame.self, from: data)
            if case .completions = frame, data.count > 64 * 1024 + 1024 { throw AttentionFeedError.capacity }
            try AttentionWire.validate(frame)
            if let boundary = frame.boundary {
                guard id == boundary.id else { throw AttentionFeedError.invalid }
            } else if id != nil { throw AttentionFeedError.invalid }
            return try receive(frame)
        }
        if text.hasPrefix(":") { return true }
        let parts = text.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        let value = parts.count == 2 ? String(parts[1].hasPrefix(" ") ? parts[1].dropFirst() : parts[1]) : ""
        switch parts[0] {
        case "event": event = value
        case "id":
            guard id == nil, value.utf8.count <= 100, !value.contains("\0") else { throw AttentionFeedError.invalid }
            id = value
        case "data": data.append(contentsOf: value.utf8); data.append(10)
        default: break // Bounded SSE extension/retry fields confer no authority.
        }
        return true
    }
}
