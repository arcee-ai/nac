import Foundation

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
        // A semantic-page ACK can set observing before the current-state
        // baseline arrives. Only an accepted boundary establishes zero pending.
        var projectionAvailable: Bool {
            sequence != nil && projectionEpoch != nil &&
                (phase == "observing" || phase == "accounting")
        }
    }
    struct Sinks {
        var resolved: (Binding, UInt64, [AttentionProjection.Key]) -> Void = { _, _, _ in }
        var completions: (Binding, UInt64, AttentionWire.CompletionPage, @escaping (Bool) -> Void) -> Void = { _, _, _, complete in complete(false) }
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
    private var completionMode = false
    private var completionCursor: String?
    private var waitingForCompletion: UUID?
    private var heldData = Data()
    private var retirement: (() -> Void)?

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
    /// Configure before enabling/binding. Transport epochs never replace this
    /// stable semantic frontier; only the native owner's durable ACK advances it.
    func configureCompletions(cursor: String?) {
        queue.async { self.completionMode = true; self.completionCursor = cursor }
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
    func isCurrent(_ notice: Notice, completion: @escaping (Bool) -> Void) {
        queue.async {
            completion(!self.retired && self.policy.optedIn && notice.binding == self.binding &&
                notice.generation == self.generation && self.projection.sources[notice.key.session]?.source.epoch == notice.sourceEpoch &&
                self.projection.isCurrent(notice.key, kind: notice.kind))
        }
    }
    func retire(completion: (() -> Void)? = nil) {
        queue.async {
            if let completion {
                let previous = self.retirement
                self.retirement = { previous?(); completion() }
            }
            if !self.retired {
                self.retired = true
                self.cancelConnection()
                self.binding = nil
                self.phase = "retired"
            }
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
               pending: projection.pending, bytes: parser.retainedBytes + projection.metadataBytes + projection.dedupBytes + heldData.count,
               sequence: projection.boundary?.sequence, projectionEpoch: projection.boundary?.epoch,
               deliveryAcknowledgments: deliveryAcknowledgments,
               deliveryFailures: deliveryFailures, unknownDecisionSessions: unknown)
    }
    private func publish() {
        sinks.state(statusOnQueue())
        if retired, task == nil, retry == nil, draining.isEmpty, drainingRetries == 0 {
            let completion = retirement
            retirement = nil
            completion?()
        }
    }
    private func cancelConnection() {
        if generation < UInt64.max { generation += 1 } else { retired = true }
        wantedRetry = nil
        cancelRetry()
        if waitingForCompletion != nil { task?.resume() }
        waitingForCompletion = nil
        heldData = Data()
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
        // Current-state projection opens fresh; semantic completion replay has
        // its own durable store cursor, independent of the in-memory SSE ring.
        if completionMode { request.setValue(completionCursor ?? "new", forHTTPHeaderField: "X-NAC-Completion-Cursor") }
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
        if waitingForCompletion != nil {
            guard heldData.count + data.count <= AttentionWire.eventBytes else { unavailable(retry: false); return }
            heldData.append(data)
            return
        }
        do {
            // Local parser ownership permits processing each frame directly;
            // neither a callback nor an SSE record acquires a payload queue.
            var nextParser = parser
            parser = AttentionSSEParser()
            let tail = try nextParser.consume(data) { frame in
                if case .reset = frame { throw AttentionFeedError.rebaseline }
                if case .completions(let page) = frame {
                    try self.receiveCompletions(page, binding: binding, dataTask: dataTask)
                    return false
                }
                let effects = try self.projection.accept(frame, engine: binding.engine,
                    noticeWork: !self.completionMode, resumeDecisions: self.completionMode)
                if case .record(_, let source, _, .decisionResolved(let decision), _) = frame {
                    self.sinks.resolved(binding, self.generation, [.init(session: source.session_id, identity: decision.key)])
                }
                self.phase = "observing"; self.retryAttempt = 0
                let obsolete = self.delivered.filter {
                    self.projection.sources[$0.key.session]?.source.epoch != $0.value.sourceEpoch ||
                    !self.projection.isCurrent($0.key, kind: $0.value.kind)
                }.map { $0.key }
                for key in obsolete { self.delivered.removeValue(forKey: key) }
                if !obsolete.isEmpty { self.sinks.withdraw(obsolete) }
                if self.policy.delivers || self.completionMode {
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
                return true
            }
            parser = nextParser
            guard tail.count <= AttentionWire.eventBytes else { throw AttentionFeedError.capacity }
            heldData = tail
        } catch AttentionFeedError.rebaseline { unavailable(retry: true) }
        catch { unavailable(retry: false) }
    }

    private func receiveCompletions(_ page: AttentionWire.CompletionPage, binding: Binding,
                                    dataTask: URLSessionDataTask) throws {
        guard completionMode, waitingForCompletion == nil else { throw AttentionFeedError.invalid }
        if let cursor = completionCursor {
            let parts = cursor.split(separator: ":", omittingEmptySubsequences: false)
            guard parts.count == 2, let store = UUID(uuidString: String(parts[0])), let sequence = Int64(parts[1]),
                  store == page.store_id, !page.baseline, page.cursor >= sequence,
                  page.items.allSatisfy({ $0.sequence > sequence }) else { throw AttentionFeedError.invalid }
        } else if !page.baseline { throw AttentionFeedError.invalid }
        let token = UUID(), expected = generation
        waitingForCompletion = token
        dataTask.suspend()
        phase = "accounting"
        sinks.completions(binding, expected, page) { [weak self, weak dataTask] accepted in
            self?.queue.async { [weak self, weak dataTask] in
                guard let self, let dataTask, !self.retired, self.task === dataTask,
                      self.binding == binding, self.generation == expected, self.waitingForCompletion == token else { return }
                self.waitingForCompletion = nil
                if !accepted {
                    dataTask.resume()
                    self.unavailable(retry: false)
                    return
                }
                self.completionCursor = page.cursorID
                let tail = self.heldData
                self.heldData = Data()
                self.phase = "observing"
                dataTask.resume()
                if !tail.isEmpty, let session = self.session { self.urlSession(session, dataTask: dataTask, didReceive: tail) }
                self.publish()
            }
        }
        publish()
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
