import Foundation

/// Test-only console driver. This executable imports no AppKit/UserNotifications,
/// launches no engine and makes no product mutations. Its parent owns fixtures.
private final class MockAttentionCenter {
    private let lock = NSLock()
    private var notices: [NativeAttentionObserver.Notice] = []
    private var active: [AttentionProjection.Key: NativeAttentionObserver.Notice] = [:]
    private var navigations: [String] = []
    private var requests: [String] = []
    private var mode = "normal"
    private var delayed: [(NativeAttentionObserver.Notice, (Bool) -> Void)] = []
    private var pendingDelivery: Set<AttentionProjection.Key> = []
    private var pageMode = "normal"
    private var pageCount = 0
    private var acceptedItems = 0
    private var completionCursor: String?
    private var pendingPage: (UInt64, String, Int, (Bool) -> Void)?
    func emit(_ object: [String: Any]) {
        lock.lock(); defer { lock.unlock() }
        let bytes = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        FileHandle.standardOutput.write(bytes + Data([10]))
    }
    func notice(_ notice: NativeAttentionObserver.Notice, complete: @escaping (Bool) -> Void) {
        lock.lock()
        precondition(notices.count < 1024)
        notices.append(notice)
        if mode == "delayed" {
            delayed.append((notice, complete))
            pendingDelivery.insert(notice.key)
            lock.unlock()
            return
        }
        let accepted = mode != "fail"
        if accepted { active[notice.key] = notice }
        lock.unlock()
        complete(accepted)
    }
    func setMode(_ next: String) {
        precondition(["normal", "delayed", "fail"].contains(next))
        lock.lock(); defer { lock.unlock() }
        mode = next
    }
    func completeDelayed() {
        lock.lock()
        let callbacks = delayed
        delayed.removeAll()
        for (notice, _) in callbacks where pendingDelivery.contains(notice.key) { active[notice.key] = notice }
        pendingDelivery.removeAll()
        lock.unlock()
        for (_, callback) in callbacks { callback(true) } // Even stale acknowledgments are exercised.
    }
    func configurePages(_ mode: String) {
        precondition(["normal", "delayed", "fail"].contains(mode))
        lock.lock(); defer { lock.unlock() }
        pageMode = mode
    }
    func page(_ binding: NativeAttentionObserver.Binding, _ generation: UInt64,
              _ page: AttentionWire.CompletionPage, _ complete: @escaping (Bool) -> Void) {
        lock.lock()
        precondition(pendingPage == nil)
        pageCount += 1
        let delayed = pageMode == "delayed", accepted = pageMode == "normal"
        if delayed { pendingPage = (generation, page.cursorID, page.items.count, complete) }
        else if accepted { completionCursor = page.cursorID; acceptedItems += page.items.count }
        lock.unlock()
        // One immutable page event is logged, not retained as an in-memory
        // history. This ACK is an explicit mock, never a durable checkpoint.
        emit(["type": "completion_page", "generation": generation, "engine": binding.engine.uuidString,
              "cursor": page.cursorID, "baseline": page.baseline, "more": page.more,
              "mock_ack": delayed ? "pending" : accepted ? "accepted" : "rejected",
              "items": page.items.map { ["sequence": $0.sequence, "session_id": $0.session_id,
                "run_id": $0.run_id, "kind": $0.kind.rawValue] as [String: Any] }])
        if !delayed { complete(accepted) }
    }
    func completePage(_ accepted: Bool, generation: UInt64) {
        lock.lock()
        let page = pendingPage; pendingPage = nil
        if let page, accepted, page.0 == generation {
            completionCursor = page.1; acceptedItems += page.2
        }
        lock.unlock()
        page?.3(accepted) // Late callback still reaches the observer's generation fence.
    }
    func withdraw(_ keys: [AttentionProjection.Key]) {
        lock.lock(); defer { lock.unlock() }
        for key in keys { active.removeValue(forKey: key); pendingDelivery.remove(key) }
    }
    func navigate(_ notice: NativeAttentionObserver.Notice) {
        lock.lock(); defer { lock.unlock() }
        precondition(navigations.count < 1024)
        navigations.append(notice.key.session)
    }
    func request(_ request: String) {
        lock.lock(); defer { lock.unlock() }
        precondition(requests.count < 1024)
        requests.append(request)
    }
    func captured(_ index: Int) -> NativeAttentionObserver.Notice? {
        lock.lock(); defer { lock.unlock() }
        return notices.indices.contains(index) ? notices[index] : nil
    }
    func snapshot(_ token: String, _ status: NativeAttentionObserver.Status) {
        lock.lock()
        let object: [String: Any] = ["type": "snapshot", "token": token, "status": Self.state(status),
                                     "notices": notices.map { notice in
                                        ["session": notice.key.session, "identity": notice.key.identity,
                                         "kind": notice.kind, "generation": notice.generation,
                                         "engine": notice.binding.engine.uuidString,
                                         "source_epoch": notice.sourceEpoch.uuidString,
                                         "title": notice.title, "body": notice.body] as [String: Any]
                                     }, "active": active.count, "navigations": navigations, "requests": requests,
                                     "pending_delivery_callbacks": delayed.count, "pending_delivery_keys": pendingDelivery.count,
                                     "completion_pages": pageCount, "accepted_completion_items": acceptedItems,
                                     "completion_cursor": completionCursor.map { $0 as Any } ?? NSNull(),
                                     "pending_completion_callbacks": pendingPage == nil ? 0 : 1]
        lock.unlock()
        emit(object)
    }
    static func state(_ status: NativeAttentionObserver.Status) -> [String: Any] {
        ["phase": status.phase, "generation": status.generation, "tasks": status.tasks,
         "retries": status.retries, "draining_sessions": status.drainingSessions,
         "sources": status.sources, "identities": status.identities, "pending": status.pending,
         "bytes": status.bytes, "sequence": status.sequence.map { $0 as Any } ?? NSNull(),
         "projection_epoch": status.projectionEpoch.map { $0.uuidString as Any } ?? NSNull(),
         "delivery_acknowledgments": status.deliveryAcknowledgments, "delivery_failures": status.deliveryFailures,
         "unknown_decision_sessions": status.unknownDecisionSessions, "projection_available": status.projectionAvailable]
    }
}

@main
struct AttentionFeedHTTPFixture {
    private struct Command: Decodable {
        let command: String
        let token: String?
        let profile: UUID?
        let engine: UUID?
        let endpoint: URL?
        let opted_in: Bool?
        let authorized: Bool?
        let muted: Bool?
        let focused: Bool?
        let private_content: Bool?
        let index: Int?
        let delivery_mode: String?
        let completion_cursor: String?
        let page_mode: String?
        let accepted: Bool?
    }
    static func main() throws {
        let center = MockAttentionCenter()
        let observer = NativeAttentionObserver(sinks: .init(completions: center.page, notice: center.notice, withdraw: center.withdraw,
                                                            navigate: center.navigate,
                                                            state: { center.emit(["type": "state", "status": MockAttentionCenter.state($0)]) },
                                                            request: center.request))
        defer { observer.retire() }
        var pending = Data()
        var finished = false
        center.emit(["type": "ready", "app": false, "os_notifications": false])
        while !finished {
            let chunk = FileHandle.standardInput.availableData
            if chunk.isEmpty { break }
            for byte in chunk {
                guard pending.count < 4096 else { throw AttentionFeedError.capacity }
                if byte != 10 { pending.append(byte); continue }
                let command = try JSONDecoder().decode(Command.self, from: pending)
                pending = Data()
                switch command.command {
                case "completions":
                    if let cursor = command.completion_cursor {
                        let parts = cursor.split(separator: ":", omittingEmptySubsequences: false)
                        guard parts.count == 2, UUID(uuidString: String(parts[0])) != nil,
                              let sequence = Int64(parts[1]), sequence >= 0 else { throw AttentionFeedError.invalid }
                    }
                    let mode = command.page_mode ?? "normal"
                    guard ["normal", "delayed", "fail"].contains(mode) else { throw AttentionFeedError.invalid }
                    center.configurePages(mode)
                    observer.configureCompletions(cursor: command.completion_cursor)
                case "complete_page":
                    guard let accepted = command.accepted else { throw AttentionFeedError.invalid }
                    center.completePage(accepted, generation: observer.status().generation)
                case "bind":
                    guard let profile = command.profile, let engine = command.engine, let endpoint = command.endpoint else {
                        throw AttentionFeedError.invalid
                    }
                    observer.bind(.init(profile: profile, engine: engine, endpoint: endpoint))
                case "policy":
                    var policy = NativeAttentionObserver.Policy()
                    policy.optedIn = command.opted_in ?? false
                    policy.authorized = command.authorized ?? false
                    policy.muted = command.muted ?? false
                    policy.focused = command.focused ?? false
                    policy.privateContent = command.private_content ?? true
                    observer.setPolicy(policy)
                case "snapshot": center.snapshot(command.token ?? "", observer.status())
                case "delivery_mode":
                    guard let mode = command.delivery_mode, ["normal", "delayed", "fail"].contains(mode) else { throw AttentionFeedError.invalid }
                    center.setMode(mode)
                case "complete_deliveries": center.completeDelayed()
                case "click":
                    guard let index = command.index, let notice = center.captured(index) else { throw AttentionFeedError.invalid }
                    observer.click(notice)
                case "retire", "quit":
                    observer.retire()
                    center.completePage(false, generation: observer.status().generation)
                    let deadline = Date().addingTimeInterval(5)
                    while (observer.status().drainingSessions != 0 || observer.status().retries != 0) && Date() < deadline {
                        Thread.sleep(forTimeInterval: 0.01)
                    }
                    let status = observer.status()
                    guard status.phase == "retired", status.tasks == 0, status.retries == 0,
                          status.drainingSessions == 0, status.sources == 0, status.identities == 0, status.bytes == 0 else {
                        throw AttentionFeedError.invalid
                    }
                    if command.command == "quit" { center.completeDelayed() }
                    center.snapshot(command.token ?? "retired", status)
                    finished = command.command == "quit"
                default: throw AttentionFeedError.invalid
                }
            }
        }
        observer.retire()
    }
}
