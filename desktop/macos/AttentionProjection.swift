import Foundation

/// Current state and semantic deduplication, independent of transport/OS UI.
struct AttentionProjection {
    struct Key: Hashable { let session: String; let identity: String }
    struct Candidate { let key: Key; let kind: String; let decision: AttentionWire.Decision? }
    private(set) var boundary: AttentionWire.Cursor?
    private(set) var sources: [String: AttentionWire.Snapshot] = [:]
    private var seen: Set<Key> = []
    private var candidates: [Key: Candidate] = [:]
    var identities: Int {
        seen.union(candidates.keys).union(sources.values.compactMap { snapshot in
            snapshot.work.map { workKey(snapshot.source.session_id, $0) }
        }).union(sources.values.flatMap { snapshot in
            snapshot.pending.map { Key(session: snapshot.source.session_id, identity: $0.key) }
        }).count
    }
    var metadataBytes: Int { sources.values.reduce(0) { $0 + $1.bytes } }
    var dedupBytes: Int { seen.reduce(0) { $0 + $1.identity.utf8.count + 24 } }
    var pending: Int { sources.values.reduce(0) { $0 + $1.pending.count } }

    func isCurrent(_ key: Key, kind: String) -> Bool {
        guard let source = sources[key.session], source.availability.topology == .available else { return false }
        if kind == "completed" {
            return source.availability.work == .available && source.pending.isEmpty && source.work.map {
                $0.disposition == .completed && workKey(key.session, $0) == key
            } == true
        }
        return source.pending.contains { $0.key == key.identity && source.availability.facet(for: $0) == .available }
    }

    mutating func accept(_ frame: AttentionWire.Frame, engine: UUID, noticeWork: Bool = true,
                         resumeDecisions: Bool = false) throws -> [Candidate] {
        try AttentionWire.validate(frame)
        guard frame.boundary?.engine == engine else { throw AttentionFeedError.invalid }
        switch frame {
        case .baseline(let cursor, let snapshots, _):
            guard boundary == nil else { throw AttentionFeedError.invalid }
            boundary = cursor
            for snapshot in snapshots { install(snapshot, noticeWork: noticeWork, resumeDecisions: resumeDecisions) }
        case .record(let cursor, let source, let revision, let change, let fresh):
            guard let previous = boundary, cursor.engine == previous.engine, cursor.epoch == previous.epoch else {
                throw AttentionFeedError.invalid
            }
            if cursor.sequence <= previous.sequence { return [] } // Baseline-first history/replay stays silent.
            guard previous.sequence < UInt64.max, cursor.sequence == previous.sequence + 1 else { throw AttentionFeedError.invalid }
            if case .sourceReplaced(let snapshot) = change {
                guard !fresh, revision == snapshot.revision,
                      sources[source.session_id]?.source.epoch != source.epoch else { throw AttentionFeedError.invalid }
                candidates = candidates.filter { $0.key.session != source.session_id }
                install(snapshot, noticeWork: noticeWork, resumeDecisions: resumeDecisions)
            } else {
                guard var current = sources[source.session_id], current.source == source,
                      current.revision < UInt64.max, revision == current.revision + 1 else { throw AttentionFeedError.invalid }
                current.revision = revision
                switch change {
                case .workSettled(let work):
                    candidates = candidates.filter { $0.key.session != source.session_id || $0.value.kind != "completed" }
                    current.work = work
                    if work.disposition == .completed, fresh, noticeWork {
                        guard current.pending.isEmpty else { throw AttentionFeedError.invalid }
                        let key = workKey(source.session_id, work)
                        if !seen.contains(key) { candidates[key] = Candidate(key: key, kind: "completed", decision: nil) }
                    } else if fresh && work.disposition != .completed { throw AttentionFeedError.invalid }
                case .workCleared:
                    guard !fresh else { throw AttentionFeedError.invalid }
                    current.work = nil
                    candidates = candidates.filter { $0.key.session != source.session_id || $0.value.kind != "completed" }
                case .decisionPending(let decision):
                    if let previous = current.pending.first(where: { $0.key == decision.key })?.questionRevision,
                       let next = decision.questionRevision, next < previous { throw AttentionFeedError.invalid }
                    current.pending.removeAll { $0.key == decision.key }
                    current.pending.append(decision)
                    let key = Key(session: source.session_id, identity: decision.key)
                    if fresh, !seen.contains(key) {
                        let kind: String
                        switch decision { case .permission: kind = "permission"; case .review: kind = "review"; case .question: kind = "question" }
                        candidates[key] = Candidate(key: key, kind: kind, decision: decision)
                    }
                case .decisionResolved(let decision):
                    guard !fresh else { throw AttentionFeedError.invalid }
                    if let previous = current.pending.first(where: { $0.key == decision.key })?.questionRevision,
                       let next = decision.questionRevision, next < previous { throw AttentionFeedError.invalid }
                    current.pending.removeAll { $0.key == decision.key }
                    let key = Key(session: source.session_id, identity: decision.key)
                    candidates.removeValue(forKey: key)
                    seen.insert(key)
                case .sessionDeleted:
                    guard !fresh else { throw AttentionFeedError.invalid }
                    sources.removeValue(forKey: source.session_id)
                    candidates = candidates.filter { $0.key.session != source.session_id }
                    boundary = cursor
                    try checkLimits()
                    return []
                case .availability(let availability):
                    guard !fresh else { throw AttentionFeedError.invalid }
                    current.availability = availability
                case .checkpoint:
                    guard !fresh else { throw AttentionFeedError.invalid }
                case .sourceReplaced: break
                }
                sources[source.session_id] = current
            }
            boundary = cursor
        case .reset, .completions: throw AttentionFeedError.invalid
        }
        // The writer emits WorkSettled BEFORE its Availability update. Keep a
        // typed new-attention candidate until that exact current facet becomes
        // available; never infer availability from an old snapshot or lose it.
        var effects: [Candidate] = []
        for (key, candidate) in candidates {
            guard let current = sources[key.session] else { continue }
            let facet = candidate.decision.map { current.availability.facet(for: $0) } ?? current.availability.work
            if facet == .available, current.availability.topology == .available {
                seen.insert(key)
                effects.append(candidate)
                candidates.removeValue(forKey: key)
            } else if facet == .unsupported || current.availability.topology == .unsupported {
                candidates.removeValue(forKey: key)
            }
        }
        try checkLimits()
        return effects
    }
    private func workKey(_ session: String, _ work: AttentionWire.Work) -> Key {
        Key(session: session, identity: "w" + AttentionWire.Decision.part(work.run_id))
    }
    private mutating func install(_ snapshot: AttentionWire.Snapshot, noticeWork: Bool, resumeDecisions: Bool) {
        sources[snapshot.source.session_id] = snapshot
        for decision in snapshot.pending {
            let key = Key(session: snapshot.source.session_id, identity: decision.key)
            if resumeDecisions, !seen.contains(key) {
                let kind: String
                switch decision { case .permission: kind = "permission"; case .review: kind = "review"; case .question: kind = "question" }
                candidates[key] = Candidate(key: key, kind: kind, decision: decision)
            } else { seen.insert(key) }
        }
        if noticeWork, let work = snapshot.work, work.disposition == .completed { seen.insert(workKey(snapshot.source.session_id, work)) }
    }
    private func checkLimits() throws {
        guard sources.count <= AttentionWire.sources, identities <= AttentionWire.identities,
              metadataBytes <= AttentionWire.metadataBytes, dedupBytes <= 2 * AttentionWire.metadataBytes else {
            throw AttentionFeedError.capacity
        }
    }
}
