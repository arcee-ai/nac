import AppKit
import CryptoKit

/// One selected profile, app lifetime and metadata consumer. Rust owns all work
/// and decisions; this owner accounts only native presentation and UI routing.
@MainActor
final class NativeAttentionCoordinator {
    private final class PageJob {
        let binding: NativeAttentionObserver.Binding
        let transport: UInt64
        let page: AttentionWire.CompletionPage
        private var completion: ((Bool) -> Void)?
        init(_ binding: NativeAttentionObserver.Binding, _ transport: UInt64,
             _ page: AttentionWire.CompletionPage, _ completion: @escaping (Bool) -> Void) {
            self.binding = binding; self.transport = transport; self.page = page; self.completion = completion
        }
        func finish(_ accepted: Bool) { let callback = completion; completion = nil; callback?(accepted) }
    }
    private final class NoticeJob {
        let notice: NativeAttentionObserver.Notice
        private var completion: ((Bool) -> Void)?
        init(_ notice: NativeAttentionObserver.Notice, _ completion: @escaping (Bool) -> Void) {
            self.notice = notice; self.completion = completion
        }
        func finish(_ accepted: Bool) { let callback = completion; completion = nil; callback?(accepted) }
    }
    private let storage: WorkspaceStorage
    private let receipt: () -> EngineReceipt?
    private let delivery: NativeAttentionDelivery
    private let activate: () -> Void
    private let navigate: (NativeAttentionDestination, @escaping (NativeSessionTarget.Outcome) -> Void) -> Bool
    private var observer: NativeAttentionObserver!
    private var binding: NativeAttentionObserver.Binding?
    private var token: WorkspaceNotificationToken?
    private var generation: UInt64 = 0
    private var revision: UInt64 = 0
    private var saved = WorkspaceNotificationState()
    private var admitted: WorkspaceNotificationState?
    private var loaded = false
    private var suspended = false
    private var retired = false
    private var enabling = false
    private var deliveryHeld = true
    private var intentOff = false
    private var focused = false
    private var authorized = false
    private var mayRequest = false
    private var message = "Loading saved settings…"
    private var preferenceTask: Task<Void, Never>?
    private var workTask: Task<Void, Never>?
    private var retirementTask: Task<Void, Never>?
    private var workID: UUID?
    private var finishCurrent: (() -> Void)?
    private var page: PageJob?
    private var notices: [NoticeJob] = []
    private var pendingTarget: NativeAttentionDestination?
    private var latestStatus: NativeAttentionObserver.Status?
    #if ATTENTION_SMOKE
    private var observationPaused = false
    private var acceptedItems: [[String: Any]] = []
    private var auditOverflow = false
    /// Transport-only fixture retirement. Never writes preferences or ACKs.
    func smokeObservation(paused: Bool) throws {
        guard operational, preferenceTask == nil, workTask == nil, page == nil,
              notices.isEmpty, saved.receipts.isEmpty, !enabling,
              paused != observationPaused else {
            throw DesktopStartupError.message("Attention observation is not quiescent")
        }
        if !paused {
            let status = observer.status()
            guard status.tasks == 0, status.drainingSessions == 0 else {
                throw DesktopStartupError.message("Prior attention observation still draining")
            }
        }
        observationPaused = paused
        if paused { observer.setPolicy(.init(optedIn: false)) }
        else { startObserver() }
    }
    private func audit(_ item: AttentionWire.CompletionPage.Item, page: PageJob, native: UInt64) {
        guard acceptedItems.count < 16 else { auditOverflow = true; return }
        acceptedItems.append(["store": page.page.store_id.uuidString.lowercased(), "sequence": item.sequence,
            "session": item.session_id, "run": item.run_id, "behavior": item.behavior,
            "kind": item.kind.rawValue, "goal": item.goal_id.map { $0 as Any } ?? NSNull(),
            "mark_version": item.mark_version.map { $0 as Any } ?? NSNull(),
            "native_generation": native, "transport_generation": page.transport,
            "accepted_frontier": saved.frontier ?? "", "unread": saved.unreadCompletions])
    }
    #endif
    private lazy var menu = NativeAttentionMenu(actions: .init(
        enable: { [weak self] in self?.toggleEnabled() }, mute: { [weak self] in self?.toggleMuted() },
        permission: { [weak self] in self?.requestPermission() }, clear: { [weak self] in self?.clearIndicator() },
        reset: { [weak self] in self?.reset() }))

    init(storage: WorkspaceStorage, receipt: @escaping () -> EngineReceipt?, delivery: NativeAttentionDelivery,
         activate: @escaping () -> Void,
         navigate: @escaping (NativeAttentionDestination, @escaping (NativeSessionTarget.Outcome) -> Void) -> Bool) {
        self.storage = storage; self.receipt = receipt; self.delivery = delivery
        self.activate = activate; self.navigate = navigate
        var sinks = NativeAttentionObserver.Sinks()
        sinks.completions = { [weak self] binding, transport, page, complete in
            DispatchQueue.main.async {
                guard let self else { complete(false); return }
                self.enqueue(PageJob(binding, transport, page, complete))
            }
        }
        sinks.notice = { [weak self] notice, complete in
            DispatchQueue.main.async {
                guard let self else { complete(false); return }
                self.enqueue(NoticeJob(notice, complete))
            }
        }
        sinks.resolved = { [weak self] binding, transport, keys in
            DispatchQueue.main.async {
                guard let self, !self.retired, self.binding == binding, self.observer.status().generation == transport else { return }
                self.delivery.withdraw(keys.map { key in
                    NativeAttentionDestination(profile: self.storage.profile.digest, session: key.session,
                        occurrence: "decision:\(self.decisionHash(key))").identifier
                })
            }
        }
        sinks.state = { [weak self] status in
            DispatchQueue.main.async {
                guard let self, !self.retired, status.generation == self.observer.status().generation else { return }
                self.latestStatus = status
                self.render()
            }
        }
        observer = NativeAttentionObserver(sinks: sinks)
        binding = currentBinding()
        delivery.shouldPresent = { [weak self] target in
            guard let self else { return false }
            return self.operational && self.authorized && !self.saved.muted && !self.focused &&
                target.profile == self.storage.profile.digest
        }
        delivery.response = { [weak self] target in self?.respond(target) }
        preferenceTask = Task { [weak self] in await self?.load() }
    }

    private func currentBinding() -> NativeAttentionObserver.Binding? {
        guard let value = receipt(), value.kind == "ready", let id = UUID(uuidString: value.incarnation),
              let endpoint = value.endpoint.flatMap(URL.init(string:)) else { return nil }
        let binding = NativeAttentionObserver.Binding(profile: storage.profile.identifier, engine: id, endpoint: endpoint)
        return binding.valid ? binding : nil
    }
    private func current(_ expected: UInt64) -> Bool {
        !retired && generation == expected && !Task.isCancelled && binding != nil && binding == currentBinding()
    }
    private var operational: Bool {
        loaded && !retired && !suspended && !deliveryHeld && !intentOff && binding != nil && binding == currentBinding() && (saved.enabled || enabling)
    }
    func installMenu(in parent: NSMenu?) { menu.install(in: parent); render() }
    func presentation(focused: Bool) {
        self.focused = focused
        policy()
        tryNavigate()
    }
    func documentRetiring() { pendingTarget = nil }
    func navigationReady() { tryNavigate() }
    #if PREVIEW_SMOKE
    var smokeSnapshot: [String: Any] {
        let status = observer.status()
        let value: [String: Any] = ["loaded": loaded, "enabled": saved.enabled && !intentOff, "muted": saved.muted,
            "saving": preferenceTask != nil || enabling, "suspended": suspended, "unread": saved.unreadCompletions,
            "frontier": saved.frontier ?? "", "cutoff": saved.cutoff ?? "", "receipts": saved.receipts.count,
            "generation": generation, "revision": revision, "retired": retired,
            "observer_connections": status.tasks, "observer_phase": status.phase, "observer_draining": status.drainingSessions,
            "projection_available": status.projectionAvailable, "pending_decisions": status.pending, "message": message]
        #if ATTENTION_SMOKE
        return value.merging(["observation_paused": observationPaused, "accepted_items": acceptedItems,
            "audit_overflow": auditOverflow, "work_pending": workTask != nil || page != nil || !notices.isEmpty]) { _, next in next }
        #else
        return value
        #endif
    }
    #endif

    private func load() async {
        guard !Task.isCancelled else { return }
        let expected = generation
        guard let token = token ?? storage.beginNotifications(generation: expected) else { pause("Notification settings are unavailable."); return }
        self.token = token
        let result = await storage.readNotifications(token)
        guard current(expected) else { return }
        loaded = true
        guard case .available(let revision, let state, _) = result else {
            pause("Notifications paused: saved settings are unavailable."); preferenceTask = nil; return
        }
        self.revision = revision; saved = state; admitted = state
        if state.enabled {
            await refreshAuthorization(expected, request: false)
            guard current(expected) else { return }
            await reconcileDecisions(expected)
            guard current(expected) else { return }
            deliveryHeld = false
            startObserver()
        }
        preferenceTask = nil
        message = state.enabled ? "Saved" : "Off"
        render(); tryNavigate(); drain()
    }

    /// Only this exact native write ACK can establish saved state. A successful
    /// later flush/read/page preference write is never substituted for it.
    private func persist(_ next: WorkspaceNotificationState?, _ expected: UInt64) async -> Bool {
        guard current(expected), let token else { return false }
        let expectedRevision = revision
        let durable = await awaitNativeAttention(fallback: false) { complete in
            let admittedRevision = storage.updateNotifications(token, expectedRevision: expectedRevision, next: next) { result in
                guard self.current(expected) else { complete(false); return }
                if case .durable(let revision) = result { complete(revision == expectedRevision + 1) }
                else { complete(false) }
            }
            if let admittedRevision { self.revision = admittedRevision; self.admitted = next ?? WorkspaceNotificationState() }
            else { complete(false); return }
            // A failed/timed-out barrier ends delivery. Success is ignored here;
            // the original exact-revision callback above remains authoritative.
            storage.flushNotifications(token) { result in
                if case .unavailable = result { complete(false) }
                if case .stale = result { complete(false) }
            }
        }
        guard current(expected) else { return false }
        guard durable else {
            pause("Notifications are off for this launch. This change could not be saved; the previous saved setting may return next launch.")
            return false
        }
        saved = next ?? WorkspaceNotificationState()
        message = "Saved"
        render()
        return true
    }

    private func refreshAuthorization(_ expected: UInt64, request: Bool) async {
        var status = await awaitNativeAttention(fallback: NativeNotificationAuthorization(allowed: false, mayRequest: false)) { delivery.settings($0) }
        guard current(expected) else { return }
        if request && status.mayRequest {
            _ = await awaitNativeAttention(fallback: false) { delivery.authorize($0) }
            guard current(expected) else { return }
            status = await awaitNativeAttention(fallback: NativeNotificationAuthorization(allowed: false, mayRequest: false)) { delivery.settings($0) }
        }
        guard current(expected) else { return }
        authorized = status.allowed; mayRequest = status.mayRequest
        policy(); render()
    }
    private func policy() {
        #if ATTENTION_SMOKE
        if observationPaused { observer.setPolicy(.init(optedIn: false)); return }
        #endif
        observer.setPolicy(.init(optedIn: operational, authorized: authorized, muted: saved.muted,
                                 focused: focused, privateContent: true))
    }
    private func startObserver() {
        #if ATTENTION_SMOKE
        guard !observationPaused else { return }
        #endif
        guard operational, let binding, binding == currentBinding() else { return }
        observer.configureCompletions(cursor: saved.frontier)
        observer.bind(binding)
        policy()
    }
    private func pause(_ reason: String) {
        suspended = true; enabling = false; message = reason
        observer.setPolicy(.init())
        page?.finish(false); page = nil
        notices.forEach { $0.finish(false) }; notices.removeAll()
        render()
    }

    private func enqueue(_ next: PageJob) {
        guard operational, next.binding == binding, next.transport == observer.status().generation else { next.finish(false); return }
        page?.finish(false) // a successor transport replaces only an unstarted page
        page = next
        drain()
    }
    private func enqueue(_ next: NoticeJob) {
        guard operational, next.notice.binding == binding, next.notice.generation == observer.status().generation,
              notices.count < AttentionWire.identities else { next.finish(false); return }
        notices.append(next); drain()
    }
    private func drain() {
        guard operational, workTask == nil, preferenceTask == nil else { return }
        let expected = generation, id = UUID()
        if let job = page {
            page = nil; workID = id; finishCurrent = { job.finish(false) }
            workTask = Task { [weak self] in
                guard let self else { job.finish(false); return }
                job.finish(await self.process(job, expected))
                self.finished(id)
            }
        } else if !notices.isEmpty {
            let job = notices.removeFirst(); workID = id; finishCurrent = { job.finish(false) }
            workTask = Task { [weak self] in
                guard let self else { job.finish(false); return }
                job.finish(await self.process(job, expected))
                self.finished(id)
            }
        }
    }
    private func finished(_ id: UUID) {
        guard workID == id else { return }
        workID = nil; workTask = nil; finishCurrent = nil
        drain()
    }

    private func process(_ job: PageJob, _ expected: UInt64) async -> Bool {
        guard current(expected), operational else { return false }
        if job.page.baseline {
            var next = saved; next.enabled = true; next.cutoff = job.page.cursorID; next.frontier = job.page.cursorID
            guard await persist(next, expected) else { return false }
            await refreshAuthorization(expected, request: enabling)
            guard current(expected) else { return false }
            enabling = false; policy(); render()
        }
        for item in job.page.items {
            guard current(expected), operational, job.transport == observer.status().generation else { return false }
            let cursor = "\(job.page.store_id.uuidString.lowercased()):\(item.sequence)"
            if let frontier = sequence(saved.frontier, store: job.page.store_id), item.sequence <= frontier { continue }
            let target = NativeAttentionDestination(profile: storage.profile.digest, session: item.session_id,
                                                    occurrence: job.page.occurrenceID(item))
            guard await account(target, title: item.kind == .goal ? .goal : .request, cursor: cursor,
                                decisionHash: nil, expected: expected) else { return false }
            #if ATTENTION_SMOKE
            audit(item, page: job, native: expected)
            #endif
        }
        guard current(expected), operational, job.transport == observer.status().generation else { return false }
        if job.page.cursor > (sequence(saved.frontier, store: job.page.store_id) ?? -1) {
            var next = saved; next.frontier = job.page.cursorID
            next.receipts.removeAll { !$0.occurrence.hasPrefix("decision:") &&
                (sequence($0.cursor, store: job.page.store_id).map { $0 <= job.page.cursor } ?? false) }
            guard await persist(next, expected) else { return false }
        }
        return true
    }
    private func sequence(_ cursor: String?, store: UUID) -> Int64? {
        guard let cursor else { return nil }
        let parts = cursor.split(separator: ":")
        guard parts.count == 2, UUID(uuidString: String(parts[0])) == store else { return nil }
        return Int64(parts[1])
    }
    private func process(_ job: NoticeJob, _ expected: UInt64) async -> Bool {
        guard current(expected), operational, job.notice.generation == observer.status().generation else { return false }
        let key = job.notice.key
        let hash = decisionHash(key)
        let target = NativeAttentionDestination(profile: storage.profile.digest, session: key.session, occurrence: "decision:\(hash)")
        if saved.seenDecisions.contains(hash) && !saved.receipts.contains(where: { $0.occurrence == target.occurrence }) { return true }
        guard saved.seenDecisions.contains(hash) || saved.seenDecisions.count < WorkspaceNotificationState.decisionLimit else {
            pause("Notification identity capacity reached. Existing attention remains unread."); return false
        }
        return await account(target, title: .decision, cursor: target.occurrence, decisionHash: hash, expected: expected, decision: job.notice)
    }

    private func decisionHash(_ key: AttentionProjection.Key) -> String {
        let bytes = Data("decision-v1\0\(storage.profile.digest)\0\(key.session)\0\(key.identity)".utf8)
        return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }

    private func account(_ target: NativeAttentionDestination, title: NativeAttentionTitle, cursor: String,
                         decisionHash: String?, expected: UInt64, decision: NativeAttentionObserver.Notice? = nil) async -> Bool {
        let existing = saved.receipts.first { $0.occurrence == target.occurrence }
        if existing == nil {
            await refreshAuthorization(expected, request: false)
            guard current(expected), operational else { return false }
            var next = saved
            if let decisionHash { next.seenDecisions.append(decisionHash) }
            else {
                let (count, overflow) = next.unreadCompletions.addingReportingOverflow(1)
                guard !overflow else { pause("Completion indicator capacity reached."); return false }
                next.unreadCompletions = count
            }
            if !authorized || saved.muted || focused {
                if decisionHash == nil { next.frontier = cursor }
                return await persist(next, expected) // one durable logical badge transition
            }
            guard next.receipts.count < WorkspaceNotificationState.receiptLimit else { pause("Notification delivery is waiting for reconciliation."); return false }
            next.receipts.append(.init(occurrence: target.occurrence, session: target.session, cursor: cursor, phase: .reserved))
            guard await persist(next, expected), current(expected), operational else { return false }
            let currentDecision: Bool
            if let decision {
                currentDecision = await awaitNativeAttention(fallback: false) { complete in
                    observer.isCurrent(decision) { valid in DispatchQueue.main.async { complete(valid) } }
                }
            } else { currentDecision = true }
            guard current(expected), operational else { return false }
            if focused || saved.muted || !authorized || !currentDecision {
                var withheld = saved
                withheld.receipts.removeAll { $0.occurrence == target.occurrence }
                if decisionHash == nil { withheld.frontier = cursor }
                return await persist(withheld, expected)
            }
            let accepted = await awaitNativeAttention(fallback: false) { delivery.add(target, title: title, completion: $0) }
            guard current(expected) else { return false }
            next = saved
            if accepted {
                if let index = next.receipts.firstIndex(where: { $0.occurrence == target.occurrence }) { next.receipts[index].phase = .scheduled }
                guard await persist(next, expected) else { return false }
            } else { next.deliveryUncertain = true; guard await persist(next, expected) else { return false } }
        } else {
            let present = await awaitNativeAttention(fallback: false) { delivery.present(target, completion: $0) }
            guard current(expected) else { return false }
            if !present { var next = saved; next.deliveryUncertain = true; guard await persist(next, expected) else { return false } }
        }
        guard current(expected), operational else { return false }
        var next = saved
        next.receipts.removeAll { $0.occurrence == target.occurrence }
        if decisionHash == nil { next.frontier = cursor }
        return await persist(next, expected)
    }

    private func reconcileDecisions(_ expected: UInt64) async {
        for record in saved.receipts where record.occurrence.hasPrefix("decision:") {
            let target = NativeAttentionDestination(profile: storage.profile.digest, session: record.session, occurrence: record.occurrence)
            let present = await awaitNativeAttention(fallback: false) { delivery.present(target, completion: $0) }
            guard current(expected) else { return }
            var next = saved; next.deliveryUncertain = next.deliveryUncertain || !present
            let hash = String(record.occurrence.dropFirst("decision:".count))
            if !next.seenDecisions.contains(hash) { next.seenDecisions.append(hash) }
            next.receipts.removeAll { $0.occurrence == record.occurrence }
            guard await persist(next, expected) else { return }
        }
    }

    private func invalidate() -> UInt64? {
        guard generation < UInt64.max else { pause("Notification lifetime is unavailable."); return nil }
        generation += 1
        enabling = false
        deliveryHeld = true // synchronous intent fence, before async URL cancellation
        let pending = admitted?.receipts ?? saved.receipts
        delivery.withdraw(pending.map {
            NativeAttentionDestination(profile: storage.profile.digest, session: $0.session, occurrence: $0.occurrence).identifier
        })
        observer.setPolicy(.init())
        preferenceTask?.cancel(); preferenceTask = nil
        workTask?.cancel(); workTask = nil; workID = nil
        finishCurrent?(); finishCurrent = nil
        page?.finish(false); page = nil
        notices.forEach { $0.finish(false) }; notices.removeAll()
        pendingTarget = nil
        return generation
    }
    private func rotateToken(_ expected: UInt64) async -> Bool {
        if let token {
            _ = await awaitNativeAttention(fallback: false) { complete in storage.retireNotifications(token) { _, durable in complete(durable) } }
            self.token = nil
        }
        guard current(expected), let token = storage.beginNotifications(generation: expected) else { return false }
        self.token = token
        return true
    }
    private func preference(_ next: WorkspaceNotificationState?, enable: Bool = false) {
        guard loaded, !retired, preferenceTask == nil, let expected = invalidate() else { return }
        intentOff = !enable && next?.enabled != true
        enabling = false
        delivery.withdrawProfile(storage.profile.digest)
        preferenceTask = Task { [weak self] in
            guard let self else { return }
            defer { if self.generation == expected { self.preferenceTask = nil; self.render(); self.drain() } }
            guard await self.rotateToken(expected) else { self.pause("Notification settings are unavailable."); return }
            if enable {
                self.enabling = true; self.suspended = false
                self.saved = next ?? WorkspaceNotificationState()
                self.saved.enabled = false; self.saved.frontier = nil; self.saved.cutoff = nil
                self.deliveryHeld = false
                self.preferenceTask = nil
                self.startObserver() // capture H before requesting OS permission
            } else {
                let durable = await self.persist(next, expected)
                if durable { self.deliveryHeld = false }
                self.preferenceTask = nil
                self.policy(); self.render(); self.drain()
            }
        }
        render()
    }
    private func toggleEnabled() {
        var next = admitted ?? saved
        if (!intentOff && saved.enabled) || enabling {
            next.enabled = false; next.unreadCompletions = 0
            preference(next)
        } else { next.enabled = false; preference(next, enable: true) }
    }
    private func toggleMuted() { var next = admitted ?? saved; next.muted.toggle(); preference(next) }
    private func reset() { preference(nil) }
    private func clearIndicator() { var next = admitted ?? saved; next.unreadCompletions = 0; next.deliveryUncertain = false; preference(next) }
    private func requestPermission() {
        guard operational, preferenceTask == nil else { return }
        let expected = generation
        preferenceTask = Task { [weak self] in
            guard let self else { return }
            await self.refreshAuthorization(expected, request: true)
            self.preferenceTask = nil; self.drain()
        }
    }

    func rebind() {
        guard !retired, let expected = invalidate() else { return }
        binding = currentBinding()
        preferenceTask = Task { [weak self] in
            guard let self else { return }
            defer { if self.generation == expected { self.preferenceTask = nil; self.render(); self.drain() } }
            guard await self.rotateToken(expected) else { return }
            if !self.loaded { await self.load(); return }
            guard !self.suspended else { return }
            await self.refreshAuthorization(expected, request: false)
            guard self.current(expected) else { return }
            self.deliveryHeld = false
            self.preferenceTask = nil
            self.startObserver(); self.drain()
        }
    }
    func suspend() { _ = invalidate(); binding = nil; latestStatus = nil; message = "Workspace unavailable"; render() }
    func retire(completion: @escaping (Bool) -> Void) {
        guard !retired else { completion(false); return }
        let oldWork = workTask, oldPreference = preferenceTask
        _ = invalidate(); retired = true
        delivery.retire()
        NSApp.dockTile.badgeLabel = nil
        let oldToken = token
        token = nil
        retirementTask = Task { [weak self] in
            guard let self else { completion(false); return }
            await oldWork?.value
            await oldPreference?.value
            await withCheckedContinuation { continuation in
                self.observer.retire { DispatchQueue.main.async { continuation.resume() } }
            }
            let durable: Bool
            if let oldToken {
                durable = await withCheckedContinuation { continuation in
                    self.storage.retireNotifications(oldToken) { _, durable in continuation.resume(returning: durable) }
                }
            } else { durable = true }
            self.retirementTask = nil
            completion(durable)
        }
    }

    private func respond(_ target: NativeAttentionDestination) {
        guard !retired, target.profile == storage.profile.digest, binding != nil, binding == currentBinding() else { return }
        pendingTarget = target
        activate(); tryNavigate()
    }
    private func tryNavigate() {
        guard !retired, loaded, let target = pendingTarget, binding != nil, binding == currentBinding() else { return }
        if navigate(target, { _ in }) { pendingTarget = nil }
    }
    private func render() {
        let saving = preferenceTask != nil || enabling
        let status = suspended ? message : saving ? "Saving…" : !saved.enabled ? "Off" : saved.muted ? "Muted" : !authorized ? "Saved • system notifications are not enabled" : saved.deliveryUncertain ? "Saved • some deliveries could not be confirmed" : message
        var visual = saved
        if intentOff { visual.enabled = false }
        menu.render(saved: visual, loaded: loaded, saving: saving, paused: suspended, mayRequest: mayRequest, message: status)
        let current = !suspended && binding != nil && latestStatus?.projectionAvailable == true &&
            latestStatus?.unknownDecisionSessions.isEmpty == true
        NSApp.dockTile.badgeLabel = NativeAttentionIndicator.badge(
            enabled: saved.enabled && !retired && !intentOff, unread: saved.unreadCompletions,
            pending: current ? latestStatus?.pending : nil)
    }
}
