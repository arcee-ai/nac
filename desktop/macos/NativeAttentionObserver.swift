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

    mutating func accept(_ frame: AttentionWire.Frame, engine: UUID) throws -> [Candidate] {
        try AttentionWire.validate(frame)
        guard frame.boundary?.engine == engine else { throw AttentionFeedError.invalid }
        switch frame {
        case .baseline(let cursor, let snapshots, _):
            guard boundary == nil else { throw AttentionFeedError.invalid }
            boundary = cursor
            for snapshot in snapshots { install(snapshot) }
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
                install(snapshot)
            } else {
                guard var current = sources[source.session_id], current.source == source,
                      current.revision < UInt64.max, revision == current.revision + 1 else { throw AttentionFeedError.invalid }
                current.revision = revision
                switch change {
                case .workSettled(let work):
                    candidates = candidates.filter { $0.key.session != source.session_id || $0.value.kind != "completed" }
                    current.work = work
                    if work.disposition == .completed, fresh {
                        guard current.pending.isEmpty else { throw AttentionFeedError.invalid }
                        let key = workKey(source.session_id, work)
                        if !seen.contains(key) { candidates[key] = Candidate(key: key, kind: "completed", decision: nil) }
                    } else if fresh { throw AttentionFeedError.invalid }
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
        case .reset: throw AttentionFeedError.invalid
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
    private mutating func install(_ snapshot: AttentionWire.Snapshot) {
        sources[snapshot.source.session_id] = snapshot
        for decision in snapshot.pending { seen.insert(Key(session: snapshot.source.session_id, identity: decision.key)) }
        if let work = snapshot.work, work.disposition == .completed { seen.insert(workKey(snapshot.source.session_id, work)) }
    }
    private func checkLimits() throws {
        guard sources.count <= AttentionWire.sources, identities <= AttentionWire.identities,
              metadataBytes <= AttentionWire.metadataBytes, dedupBytes <= 2 * AttentionWire.metadataBytes else {
            throw AttentionFeedError.capacity
        }
    }
}

/// One app-owned profile/engine binding, one GET and one cancellable retry. The
/// caller supplies a verified private readiness binding; this owns no engine,
/// session attachment, renderer, authorization, credentials or system center.
final class NativeAttentionObserver: NSObject, URLSessionDataDelegate {
    struct Binding: Equatable {
        let profile: UUID
        let engine: UUID
        let endpoint: URL
        var valid: Bool {
            AttentionWire.validUUID(profile) && AttentionWire.validUUID(engine) && endpoint.scheme == "http"
                && endpoint.host == "127.0.0.1" && (endpoint.port.map { (1...65535).contains($0) } ?? false)
                && endpoint.user == nil && endpoint.password == nil && endpoint.query == nil && endpoint.fragment == nil
                && ["", "/"].contains(endpoint.path)
        }
    }
    struct Policy {
        var optedIn = false
        var authorized = false
        var muted = false
        var focused = false
        var privateContent = true
        var delivers: Bool { optedIn && authorized && !muted && !focused && privateContent }
    }
    struct Notice: Equatable {
        let binding: Binding
        let generation: UInt64
        let sourceEpoch: UUID
        let key: AttentionProjection.Key
        let kind: String
        var title: String { kind == "completed" ? "Work completed" : "Decision needed" }
        var body: String { "Open NAC to view current state." }
    }
    struct Status {
        let phase: String
        let generation: UInt64
        let tasks: Int
        let retries: Int
        let drainingSessions: Int
        let sources: Int
        let identities: Int
        let pending: Int
        let bytes: Int
        let sequence: UInt64?
        let projectionEpoch: UUID?
        let deliveryAcknowledgments: Int
        let deliveryFailures: Int
        let unknownDecisionSessions: [String]
    }
    struct Sinks {
        var notice: (Notice, @escaping (Bool) -> Void) -> Void = { _, complete in complete(true) }
        var withdraw: ([AttentionProjection.Key]) -> Void = { _ in }
        var navigate: (Notice) -> Void = { _ in }
        var state: (Status) -> Void = { _ in }
        var request: (String) -> Void = { _ in }
    }
    private let queue = DispatchQueue(label: "nac.native.attention")
    private let queueKey = DispatchSpecificKey<UInt8>()
    private let delegateQueue = OperationQueue()
    private let sinks: Sinks
    private var binding: Binding?
    private var policy = Policy()
    private var generation: UInt64 = 0
    private var phase = "disabled"
    private var retired = false
    private var task: URLSessionDataTask?
    private var session: URLSession?
    private var draining: Set<ObjectIdentifier> = []
    private var retry: DispatchSourceTimer?
    private var retryToken: UUID?
    private var drainingRetries = 0
    private var wantedRetry: (delay: TimeInterval, generation: UInt64)?
    private var retryAttempt = 0
    private var parser = AttentionSSEParser()
    private var projection = AttentionProjection()
    private var delivered: [AttentionProjection.Key: Notice] = [:]
    private var deliveryAcknowledgments = 0
    private var deliveryFailures = 0

    init(sinks: Sinks = Sinks()) {
        self.sinks = sinks
        super.init()
        queue.setSpecific(key: queueKey, value: 1)
        delegateQueue.maxConcurrentOperationCount = 1
        delegateQueue.underlyingQueue = queue
    }
    func bind(_ next: Binding) {
        queue.async {
            guard !self.retired else { return }
            self.cancelConnection()
            self.binding = next.valid ? next : nil
            self.retryAttempt = 0
            self.phase = next.valid ? "disabled" : "unavailable"
            if self.policy.optedIn && next.valid { self.schedule(delay: 0) }
            self.publish()
        }
    }
    func setPolicy(_ next: Policy) {
        queue.async {
            guard !self.retired else { return }
            let previouslyEnabled = self.policy.optedIn
            self.policy = next
            if !next.optedIn {
                self.cancelConnection()
                self.phase = "disabled"
            } else if !previouslyEnabled, self.binding != nil {
                self.schedule(delay: 0)
            }
            if !next.delivers { self.withdrawAll() }
            self.publish()
        }
    }
    func click(_ notice: Notice) {
        queue.async {
            guard !self.retired, self.policy.optedIn, notice.binding == self.binding,
                  notice.generation == self.generation,
                  self.projection.sources[notice.key.session]?.source.epoch == notice.sourceEpoch else { return }
            // Current canonical navigation is delegated. Resolution does not
            // turn this receipt into an answer, command, or remembered grant.
            // Keep the binding in the request so a later main-thread adapter
            // can revalidate it again before navigating the existing app.
            self.sinks.navigate(notice)
        }
    }
    func retire() {
        queue.async {
            guard !self.retired else { return }
            self.retired = true
            self.cancelConnection()
            self.binding = nil
            self.phase = "retired"
            self.publish()
        }
    }
    func status() -> Status {
        if DispatchQueue.getSpecific(key: queueKey) != nil { return statusOnQueue() }
        return queue.sync { statusOnQueue() }
    }
    private func statusOnQueue() -> Status {
        let unknown = projection.sources.values.filter {
            $0.availability.permissions == .unknown || $0.availability.reviews == .unknown
        }.map { $0.source.session_id }.sorted()
        return Status(phase: phase, generation: generation, tasks: task == nil ? 0 : 1, retries: (retry == nil ? 0 : 1) + drainingRetries,
               drainingSessions: draining.count, sources: projection.sources.count, identities: projection.identities,
               pending: projection.pending, bytes: parser.retainedBytes + projection.metadataBytes + projection.dedupBytes,
               sequence: projection.boundary?.sequence, projectionEpoch: projection.boundary?.epoch,
               deliveryAcknowledgments: deliveryAcknowledgments,
               deliveryFailures: deliveryFailures, unknownDecisionSessions: unknown)
    }
    private func publish() { sinks.state(statusOnQueue()) }
    private func cancelConnection() {
        if generation < UInt64.max { generation += 1 } else { retired = true }
        wantedRetry = nil
        cancelRetry()
        task?.cancel(); task = nil
        if let current = session {
            draining.insert(ObjectIdentifier(current))
            current.invalidateAndCancel()
            session = nil
        }
        parser = AttentionSSEParser()
        projection = AttentionProjection()
        withdrawAll() // Unknown/retired, never a semantic decision resolution.
    }
    private func withdrawAll() {
        let keys = Array(delivered.keys)
        delivered.removeAll()
        if !keys.isEmpty { sinks.withdraw(keys) }
    }
    private func schedule(delay: TimeInterval) {
        guard !retired, policy.optedIn, binding != nil, retry == nil, task == nil else { return }
        if drainingRetries != 0 { wantedRetry = (delay, generation); return }
        let expected = generation
        let token = UUID()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + delay)
        timer.setEventHandler { [weak self] in
            guard let self, !self.retired, self.generation == expected, self.retryToken == token else { return }
            self.cancelRetry()
            if !self.draining.isEmpty { self.schedule(delay: 1); self.publish(); return }
            self.connect()
        }
        timer.setCancelHandler { [weak self] in
            guard let self else { return }
            self.drainingRetries -= 1
            if let wanted = self.wantedRetry {
                self.wantedRetry = nil
                if wanted.generation == self.generation { self.schedule(delay: wanted.delay) }
            }
            self.publish()
        }
        retryToken = token
        retry = timer
        timer.resume()
    }
    private func cancelRetry() {
        guard let current = retry else { return }
        retry = nil
        retryToken = nil
        drainingRetries += 1
        current.setEventHandler {}
        current.cancel()
    }
    private func connect() {
        guard !retired, policy.optedIn, let binding, binding.valid, task == nil else { return }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.httpMaximumConnectionsPerHost = 1
        // Absence of events is not a broken connection. The real quiet-stream
        // fixture validates this setting; no heartbeat or idle polling is added.
        configuration.timeoutIntervalForRequest = 24 * 60 * 60
        configuration.timeoutIntervalForResource = 24 * 60 * 60
        let next = URLSession(configuration: configuration, delegate: self, delegateQueue: delegateQueue)
        var request = URLRequest(url: binding.endpoint.appendingPathComponent("attention/events"))
        request.timeoutInterval = 24 * 60 * 60
        request.httpMethod = "GET"
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        // Each HTTP open is a fresh producer lifetime. Do not claim retained
        // hub replay or reconstruct missed notifications via Last-Event-ID.
        let nextTask = next.dataTask(with: request)
        session = next; task = nextTask
        phase = "connecting"
        sinks.request("GET /attention/events")
        nextTask.resume()
        publish()
    }
    private func unavailable(retry shouldRetry: Bool) {
        cancelConnection()
        phase = "unavailable"
        if shouldRetry {
            let delay = min(30, pow(2, Double(min(retryAttempt, 5))))
            retryAttempt = min(retryAttempt + 1, 5)
            schedule(delay: delay)
        }
        publish()
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard dataTask === task, session === self.session, let response = response as? HTTPURLResponse else {
            completionHandler(.cancel); return
        }
        guard response.statusCode == 200, response.mimeType == "text/event-stream" else {
            completionHandler(.cancel)
            unavailable(retry: response.statusCode == 409 || response.statusCode == 503)
            return
        }
        completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard dataTask === task, session === self.session, let binding else { return }
        do {
            // Local parser ownership permits processing each frame directly;
            // neither a callback nor an SSE record acquires a payload queue.
            var nextParser = parser
            parser = AttentionSSEParser()
            try nextParser.append(data) { frame in
                if case .reset = frame { throw AttentionFeedError.rebaseline }
                let effects = try self.projection.accept(frame, engine: binding.engine)
                self.phase = "observing"; self.retryAttempt = 0
                let obsolete = self.delivered.filter { !self.projection.isCurrent($0.key, kind: $0.value.kind) }.map { $0.key }
                for key in obsolete { self.delivered.removeValue(forKey: key) }
                if !obsolete.isEmpty { self.sinks.withdraw(obsolete) }
                if self.policy.delivers {
                    for candidate in effects {
                        guard let epoch = self.projection.sources[candidate.key.session]?.source.epoch else { throw AttentionFeedError.invalid }
                        let notice = Notice(binding: binding, generation: self.generation, sourceEpoch: epoch,
                                            key: candidate.key, kind: candidate.kind)
                        self.delivered[candidate.key] = notice
                        self.sinks.notice(notice) { [weak self] accepted in
                            self?.queue.async { [weak self] in
                                guard let self, !self.retired, self.binding == notice.binding,
                                      self.generation == notice.generation, self.delivered[notice.key] == notice,
                                      self.projection.sources[notice.key.session]?.source.epoch == notice.sourceEpoch else { return }
                                self.deliveryAcknowledgments += 1
                                if !accepted {
                                    self.deliveryFailures += 1
                                    self.delivered.removeValue(forKey: notice.key)
                                    self.sinks.withdraw([notice.key])
                                }
                                // A failed or ambiguous delivery is never an
                                // instruction to replay the semantic fact.
                                self.publish()
                            }
                        }
                    }
                }
                self.publish()
            }
            parser = nextParser
        } catch AttentionFeedError.rebaseline { unavailable(retry: true) }
        catch { unavailable(retry: false) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard task === self.task, session === self.session else { return }
        unavailable(retry: true)
    }
    func urlSession(_ session: URLSession, didBecomeInvalidWithError error: Error?) {
        draining.remove(ObjectIdentifier(session))
        publish()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        completionHandler(.cancelAuthenticationChallenge, nil)
    }
}
