import Foundation

@main
struct AttentionObserverTests {
    typealias Observer = AttentionObserver
    static let source = Observer.Source(engineIncarnation: "engine-a", generation: 1)

    static func snapshot(_ id: String = "session-a", epoch: String = "epoch-a",
                         sequence: UInt64 = 10, run: String? = "run-a",
                         requests: Set<String> = []) -> Observer.Session {
        Observer.Session(id: id, boundary: .init(epoch: epoch, sequence: sequence),
                         activeRunID: run, pendingRequestIDs: requests)
    }

    static func fixture(_ snapshots: [Observer.Session]? = nil,
                        identities: Int = 32, sessions: Int = 4) -> Observer {
        let observer = Observer(source: source, sessionLimit: sessions, identityLimit: identities)
        precondition(observer.baseline(from: source, sessions: snapshots ?? [snapshot()]))
        return observer
    }

    static func event(_ sequence: UInt64, _ change: Observer.Change,
                      source: Observer.Source = source, session: String = "session-a",
                      epoch: String = "epoch-a", run: String? = "run-a") -> Observer.Event {
        Observer.Event(source: source, sessionID: session,
                       boundary: .init(epoch: epoch, sequence: sequence), runID: run, change: change)
    }

    static func notice(_ kind: Observer.Notice.Kind, session: String = "session-a",
                       source: Observer.Source = source) -> Observer.Notice {
        Observer.Notice(source: source, sessionID: session, kind: kind)
    }

    static func main() {
        baselineAndReplay()
        exactRunCompletion()
        pendingDecisions()
        independentSessions()
        sourceReplacementAndRetirement()
        gapsAndRecovery()
        capacityAndMalformedIdentities()
        print("{\"suite\":\"attention-observer\",\"scenarios\":7,\"result\":\"passed\",\"native_delivery_tested\":false}")
    }

    static func baselineAndReplay() {
        let observer = fixture([snapshot(requests: ["already-waiting"])])
        precondition(observer.phase == .observing)
        precondition(observer.retention == .init(sessions: 1, identities: 2, pendingRequests: 1))
        // Initial live pending state is silent, even if the replay contains asks.
        precondition(observer.receive(event(9, .permissionAsked(requestID: "already-waiting",
                                                               sessionID: "session-a"), run: nil)) == .none)
        precondition(observer.receive(event(10, .runCompleted)) == .none)
        precondition(observer.receive(event(11, .other)) == .none) // agent RunFinished is not session completion
        let completion = event(12, .runCompleted)
        precondition(observer.receive(completion) == .attention(notice(.completed(runID: "run-a"))))
        for _ in 0..<100 {
            precondition(observer.receive(completion) == .none) // reconnect replay at same boundary
        }
        precondition(observer.receive(event(13, .runCompleted)) == .none)
        precondition(!observer.baseline(from: source, sessions: [snapshot()])) // late seed cannot roll back
    }

    static func exactRunCompletion() {
        let observer = fixture()
        precondition(observer.receive(event(11, .runCompleted, run: "stale-run")) == .none)
        precondition(observer.receive(event(12, .runCompleted, run: nil)) == .none)
        precondition(observer.receive(event(13, .runStarted, run: "run-b")) == .none)
        precondition(observer.receive(event(14, .runCompleted)) == .none) // old run, newer sequence
        precondition(observer.receive(event(15, .runCompleted, run: "run-b")) ==
                     .attention(notice(.completed(runID: "run-b"))))
        precondition(observer.receive(event(16, .runStarted, run: "run-b")) == .none)
        precondition(observer.receive(event(17, .runCompleted, run: "run-b")) == .none)
        for (offset, run) in ["failed", "cancelled"].enumerated() {
            let sequence = UInt64(18 + offset * 3)
            precondition(observer.receive(event(sequence, .runStarted, run: run)) == .none)
            precondition(observer.receive(event(sequence + 1, .runFailedOrCancelled, run: run)) == .none)
            precondition(observer.receive(event(sequence + 2, .runCompleted, run: run)) == .none)
        }
    }

    static func pendingDecisions() {
        let observer = fixture()
        let ask = Observer.Change.permissionAsked(requestID: "request-a", sessionID: "session-a")
        // Broker publication uses run_id=None; this is not bound to the visible run.
        precondition(observer.receive(event(11, ask, run: nil)) ==
                     .attention(notice(.decision(requestID: "request-a"))))
        precondition(observer.receive(event(11, ask, run: nil)) == .none)
        precondition(observer.receive(event(12, ask, run: nil)) == .none)
        precondition(observer.retention.pendingRequests == 1)
        // Completion cannot resolve a possibly independent human-shell approval.
        precondition(observer.receive(event(13, .runCompleted)) ==
                     .attention(notice(.completed(runID: "run-a"))))
        precondition(observer.retention.pendingRequests == 1)
        precondition(observer.receive(event(14, .permissionResolved(requestID: "request-a"), run: nil)) ==
                     .resolved(notice(.decision(requestID: "request-a"))))
        precondition(observer.retention.pendingRequests == 0)
        precondition(observer.receive(event(15, ask, run: nil)) == .none)
        precondition(observer.receive(event(16, .permissionResolved(requestID: "resolved-first"), run: nil)) == .none)
        precondition(observer.receive(event(17, .permissionAsked(requestID: "resolved-first",
                                                                sessionID: "session-a"), run: nil)) == .none)
        precondition(observer.receive(event(18, .permissionAsked(requestID: "wrong-session",
                                                                sessionID: "session-b"), run: nil)) == .none)
        precondition(observer.receive(event(19, .permissionAsked(requestID: "wrong-run",
                                                                sessionID: "session-a"), run: "stale")) == .none)
        precondition(observer.retention.pendingRequests == 0)
        // No live run is required for a broker-owned pending request.
        precondition(observer.receive(event(20, .permissionAsked(requestID: "shell-request",
                                                                sessionID: "session-a"), run: nil)) ==
                     .attention(notice(.decision(requestID: "shell-request"))))
    }

    static func independentSessions() {
        let observer = fixture([snapshot(), snapshot("session-b", run: "run-b")])
        precondition(observer.receive(event(11, .runCompleted, session: "session-b")) == .none)
        precondition(observer.receive(event(12, .runCompleted, session: "session-b", run: "run-b")) ==
                     .attention(notice(.completed(runID: "run-b"), session: "session-b")))
        precondition(observer.receive(event(11, .runCompleted)) ==
                     .attention(notice(.completed(runID: "run-a"))))
        precondition(observer.receive(event(12, .other, session: "unknown")) == .needsBaseline(.unknownSession))
        precondition(observer.retention.sessions == 0)
    }

    static func sourceReplacementAndRetirement() {
        let observer = fixture()
        let replacement = Observer.Source(engineIncarnation: "engine-b", generation: 2)
        let staleEngine = Observer.Source(engineIncarnation: "engine-old", generation: source.generation)
        precondition(observer.receive(event(11, .runCompleted, source: staleEngine)) == .none)
        precondition(!observer.rebind(to: source))
        precondition(!observer.rebind(to: staleEngine)) // generation must change too
        precondition(observer.rebind(to: replacement))
        precondition(!observer.rebind(to: source)) // cannot reuse an older source generation
        precondition(!observer.baseline(from: source, sessions: [snapshot()]))
        precondition(observer.receive(event(11, .runCompleted)) == .none)
        precondition(observer.baseline(from: replacement, sessions: [snapshot(sequence: 30)]))
        precondition(observer.receive(event(31, .runCompleted, source: replacement)) ==
                     .attention(notice(.completed(runID: "run-a"), source: replacement)))
        observer.retire()
        observer.retire()
        precondition(observer.phase == .retired)
        precondition(observer.retention == .init(sessions: 0, identities: 0, pendingRequests: 0))
        precondition(observer.receive(event(32, .runStarted, source: replacement)) == .none)
        precondition(!observer.baseline(from: replacement, sessions: [snapshot()]))
        precondition(!observer.rebind(to: source))
    }

    static func gapsAndRecovery() {
        let observer = fixture()
        precondition(observer.receive(event(12, .runCompleted)) == .needsBaseline(.sequenceGap))
        precondition(observer.receive(event(11, .runCompleted)) == .needsBaseline(.sequenceGap))
        precondition(observer.retention == .init(sessions: 0, identities: 0, pendingRequests: 0))
        precondition(!observer.baseline(from: source, sessions: [snapshot(sequence: 12)]))
        let recovery = Observer.Source(engineIncarnation: source.engineIncarnation, generation: 2)
        precondition(observer.rebind(to: recovery))
        // Canonical state says already finished/resolved; recovery emits nothing.
        precondition(observer.baseline(from: recovery, sessions: [snapshot(sequence: 12, run: nil)]))
        precondition(observer.receive(event(12, .runCompleted, source: recovery)) == .none)
        precondition(observer.receive(event(13, .runCompleted)) == .none) // old source callback
        precondition(observer.receive(event(13, .other, source: recovery, epoch: "new-epoch")) ==
                     .needsBaseline(.epochChanged))
        precondition(observer.receive(event(13, .runCompleted, source: recovery)) == .needsBaseline(.epochChanged))
    }

    static func capacityAndMalformedIdentities() {
        let observer = fixture(identities: 2)
        precondition(observer.receive(event(11, .permissionAsked(requestID: "request-a",
                                                                sessionID: "session-a"), run: nil)) ==
                     .attention(notice(.decision(requestID: "request-a"))))
        precondition(observer.retention.identities == 2)
        precondition(observer.receive(event(12, .permissionAsked(requestID: "overflow",
                                                                sessionID: "session-a"), run: nil)) ==
                     .needsBaseline(.capacity))
        precondition(observer.retention.identities == 0)
        precondition(observer.receive(event(13, .runCompleted)) == .needsBaseline(.capacity))
        for input in [[snapshot(), snapshot("extra")],
                      [snapshot(requests: ["a", "b"])],
                      [snapshot(), snapshot()],
                      [snapshot("")], [snapshot(epoch: "")],
                      [snapshot(requests: [String(repeating: "x", count: 513)])]] {
            let bounded = Observer(source: source, sessionLimit: 1, identityLimit: 2)
            precondition(!bounded.baseline(from: source, sessions: input))
            precondition(bounded.retention.sessions == 0)
        }
        let malformed = fixture()
        precondition(malformed.receive(event(11, .permissionAsked(requestID: "", sessionID: "session-a"))) ==
                     .needsBaseline(.invalidIdentity))
        let noWrap = fixture([snapshot(sequence: UInt64.max)])
        precondition(noWrap.receive(event(0, .runCompleted)) == .none)
    }
}
