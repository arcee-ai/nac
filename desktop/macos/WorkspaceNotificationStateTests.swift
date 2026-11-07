import Foundation

/// Non-GUI metadata codec characterization. Actual shared checkpoint faults,
/// cross-Quit persistence and OS delivery remain separate app-owned journeys.
@main
enum WorkspaceNotificationStateTests {
    static func main() throws {
        let absent = WorkspaceNotificationState()
        precondition(!absent.enabled && absent.cutoff == nil && absent.frontier == nil)
        precondition(WorkspaceNotificationState.decode(absent.encodedObject()!) == absent)
        let receipt = WorkspaceNotificationState.Receipt(occurrence: "work-A", session: "session-A",
            cursor: "store:1", phase: .reserved)
        var saved = WorkspaceNotificationState(enabled: true, cutoff: "store:0", frontier: "store:0", receipts: [receipt])
        precondition(WorkspaceNotificationState.decode(saved.encodedObject()!) == saved)
        var raw = saved.encodedObject()!
        raw["command"] = "not a capability"
        precondition(WorkspaceNotificationState.decode(raw) == nil)
        raw = saved.encodedObject()!
        raw["enabled"] = 1
        precondition(WorkspaceNotificationState.decode(raw) == nil)
        raw = saved.encodedObject()!
        raw["receipts"] = [["occurrence": "A", "session": "B", "cursor": "C", "phase": "displayed"]]
        precondition(WorkspaceNotificationState.decode(raw) == nil) // OS ACK never means displayed
        saved.receipts.append(receipt)
        precondition(saved.encodedObject() == nil)
        saved.receipts = (0..<WorkspaceNotificationState.receiptLimit).map {
            .init(occurrence: "work-\($0)", session: "session", cursor: "store:\($0)", phase: .scheduled)
        }
        precondition(saved.encodedObject() != nil)
        saved.receipts.append(.init(occurrence: "overflow", session: "session", cursor: "store:65", phase: .reserved))
        precondition(saved.encodedObject() == nil)
        saved.receipts = []
        saved.frontier = "\nforeign"
        precondition(saved.encodedObject() == nil)
        saved.frontier = String(repeating: "x", count: 2049)
        precondition(saved.encodedObject() == nil)
        print("Native notification metadata codec cases passed; no WK/OS delivery qualification.")
    }
}
