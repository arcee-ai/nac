import Foundation

/// Content-free characterization of attention transitions, not a transport or
/// authorization client. The eventual single observer owner must serialize calls.
final class AttentionObserver {
    struct Source: Equatable {
        let engineIncarnation: String
        let generation: UInt64
    }

    struct Boundary: Equatable {
        let epoch: String
        let sequence: UInt64
    }

    struct Session {
        let id: String
        let boundary: Boundary
        let activeRunID: String?
        let pendingRequestIDs: Set<String>
    }

    enum Change {
        case runStarted
        case runCompleted
        case runFailedOrCancelled
        case permissionAsked(requestID: String, sessionID: String)
        case permissionResolved(requestID: String)
        case other
    }

    struct Event {
        let source: Source
        let sessionID: String
        let boundary: Boundary
        let runID: String?
        let change: Change
    }

    struct Notice: Equatable {
        enum Kind: Equatable {
            case completed(runID: String)
            case decision(requestID: String)
        }
        let source: Source
        let sessionID: String
        let kind: Kind
    }

    enum Reason: Equatable {
        case initial, sequenceGap, epochChanged, unknownSession, capacity, invalidIdentity
    }

    enum Phase: Equatable {
        case needsBaseline(Reason), observing, retired
    }

    enum Outcome: Equatable {
        case none
        case attention(Notice)
        case resolved(Notice)
        case needsBaseline(Reason)
    }

    struct Retention: Equatable {
        let sessions: Int
        let identities: Int
        let pendingRequests: Int
    }

    private struct State {
        var boundary: Boundary
        var activeRunID: String?
        var runs: Set<String>
        var requests: Set<String>
        var pending: Set<String>
    }

    private(set) var source: Source
    private(set) var phase: Phase = .needsBaseline(.initial)
    private let sessionLimit: Int
    private let identityLimit: Int
    private var sessions: [String: State] = [:]
    // Bounds identifier bytes as well as record counts. No content is retained.
    private static let identifierLimit = 512

    init(source: Source, sessionLimit: Int, identityLimit: Int) {
        precondition(sessionLimit > 0 && identityLimit > 0)
        self.source = source
        self.sessionLimit = sessionLimit
        self.identityLimit = identityLimit
    }

    var retention: Retention {
        Retention(sessions: sessions.count,
                  identities: sessions.values.reduce(0) { $0 + $1.runs.count + $1.requests.count },
                  pendingRequests: sessions.values.reduce(0) { $0 + $1.pending.count })
    }

    /// A replacement source generation fences old callbacks AND baseline reads.
    /// A failed/gapped source cannot resume merely by receiving another event.
    @discardableResult
    func rebind(to replacement: Source) -> Bool {
        guard phase != .retired, replacement.generation > source.generation else { return false }
        source = replacement
        sessions.removeAll()
        phase = .needsBaseline(.initial)
        return true
    }

    /// The caller supplies a current canonical, atomic snapshot/boundary pair.
    /// Current pending requests are remembered without historical notification.
    /// This is not an API schema; current HTTP reads do not supply this pairing.
    @discardableResult
    func baseline(from expected: Source, sessions current: [Session]) -> Bool {
        guard expected == source, phase == .needsBaseline(.initial) else { return false }
        guard Self.valid(source.engineIncarnation), source.generation > 0 else {
            _ = invalidate(.invalidIdentity)
            return false
        }
        guard current.count <= sessionLimit else {
            _ = invalidate(.capacity)
            return false
        }
        var next: [String: State] = [:]
        var identities = 0
        for session in current {
            guard Self.valid(session.id), Self.valid(session.boundary.epoch),
                  session.activeRunID.map(Self.valid) ?? true,
                  session.pendingRequestIDs.allSatisfy(Self.valid), next[session.id] == nil else {
                _ = invalidate(.invalidIdentity)
                return false
            }
            let runs = Set(session.activeRunID.map { [$0] } ?? [])
            identities += runs.count + session.pendingRequestIDs.count
            guard identities <= identityLimit else {
                _ = invalidate(.capacity)
                return false
            }
            next[session.id] = State(boundary: session.boundary, activeRunID: session.activeRunID,
                                     runs: runs, requests: session.pendingRequestIDs,
                                     pending: session.pendingRequestIDs)
        }
        sessions = next
        phase = .observing
        return true
    }

    func receive(_ event: Event) -> Outcome {
        guard event.source == source, phase != .retired else { return .none }
        guard phase == .observing else {
            if case .needsBaseline(let reason) = phase { return .needsBaseline(reason) }
            return .none
        }
        guard var state = sessions[event.sessionID] else { return invalidate(.unknownSession) }
        guard event.boundary.epoch == state.boundary.epoch else { return invalidate(.epochChanged) }
        guard event.boundary.sequence > state.boundary.sequence else { return .none }
        guard state.boundary.sequence < UInt64.max,
              event.boundary.sequence == state.boundary.sequence + 1 else {
            return invalidate(.sequenceGap)
        }
        guard event.runID.map(Self.valid) ?? true else { return invalidate(.invalidIdentity) }
        state.boundary = event.boundary
        var result = Outcome.none
        switch event.change {
        case .runStarted:
            if let run = event.runID, !state.runs.contains(run) {
                state.runs.insert(run)
                state.activeRunID = run
            }
        case .runCompleted, .runFailedOrCancelled:
            if let run = event.runID, run == state.activeRunID {
                state.activeRunID = nil
                if case .runCompleted = event.change {
                    result = .attention(Notice(source: source, sessionID: event.sessionID,
                                               kind: .completed(runID: run)))
                }
            }
        case .permissionAsked(let request, let session):
            guard Self.valid(request) else { return invalidate(.invalidIdentity) }
            // Actual broker events have no run ID. Never invent one from the
            // currently visible run; a human shell request has a distinct owner.
            if session == event.sessionID,
               event.runID == nil || event.runID == state.activeRunID,
               !state.requests.contains(request) {
                state.requests.insert(request)
                state.pending.insert(request)
                result = .attention(Notice(source: source, sessionID: session,
                                           kind: .decision(requestID: request)))
            }
        case .permissionResolved(let request):
            guard Self.valid(request) else { return invalidate(.invalidIdentity) }
            if event.runID == nil || event.runID == state.activeRunID {
                // Remember even a resolve-before-ask so a late semantic repeat
                // cannot resurrect an already resolved decision.
                state.requests.insert(request)
                if state.pending.remove(request) != nil {
                    result = .resolved(Notice(source: source, sessionID: event.sessionID,
                                              kind: .decision(requestID: request)))
                }
            }
        case .other:
            break
        }
        let previous = sessions[event.sessionID]!
        let count = retention.identities - previous.runs.count - previous.requests.count
            + state.runs.count + state.requests.count
        guard count <= identityLimit else { return invalidate(.capacity) }
        sessions[event.sessionID] = state
        return result
    }

    func retire() {
        sessions.removeAll()
        phase = .retired
    }

    private func invalidate(_ reason: Reason) -> Outcome {
        // Release all potentially ambiguous state. Recovery needs a NEW source
        // generation and canonical baseline, never a silent eviction or replay.
        sessions.removeAll()
        phase = .needsBaseline(reason)
        return .needsBaseline(reason)
    }

    private static func valid(_ identity: String) -> Bool {
        !identity.isEmpty && identity.utf8.count <= identifierLimit
    }
}
