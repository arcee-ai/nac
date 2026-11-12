// Actual clipboard helpers, Copy caller and wait with inert doubles; no AppKit.
private enum PreviewError: Error { case message(String) }
private enum FixtureError: Error { case focusLost, cancelled }
private typealias TimeInterval = Double

private enum Clock {
    static var now = 0.0
    static var cancelOnSleep = false
    static func reset() { now = 0; cancelOnSleep = false }
}
private struct Date: Comparable {
    let value: Double
    init() { value = Clock.now }
    init(value: Double) { self.value = value }
    func addingTimeInterval(_ interval: Double) -> Date { Date(value: value + interval) }
    static func < (lhs: Date, rhs: Date) -> Bool { lhs.value < rhs.value }
}
private enum Task {
    static func sleep(nanoseconds: UInt64) async throws {
        if Clock.cancelOnSleep { throw FixtureError.cancelled }
        Clock.now += Double(nanoseconds) / 1_000_000_000
    }
}

private final class NSPasteboard {
    enum PasteboardType { case string }
    private let counts: [Int]
    private let values: [String?]
    private let repeatLast: Bool
    private let advertised: Bool
    private var countIndex = 0
    private var valueIndex = 0
    private(set) var reads: [String] = []
    init(counts: [Int], values: [String?], repeatLast: Bool = false, advertised: Bool = true) {
        self.counts = counts; self.values = values
        self.repeatLast = repeatLast; self.advertised = advertised
    }
    var changeCount: Int {
        reads.append("count")
        precondition(!counts.isEmpty && (countIndex < counts.count || repeatLast), "Unexpected generation read")
        defer { countIndex += 1 }
        return counts[min(countIndex, counts.count - 1)]
    }
    func availableType(from types: [PasteboardType]) -> PasteboardType? {
        precondition(types == [.string])
        reads.append("type")
        return advertised ? .string : nil
    }
    func string(forType type: PasteboardType) -> String? {
        precondition(type == .string)
        reads.append("string")
        precondition(!values.isEmpty && (valueIndex < values.count || repeatLast), "Unexpected string read")
        defer { valueIndex += 1 }
        return values[min(valueIndex, values.count - 1)]
    }
}
private enum KeyFlags { case maskCommand }
private final class ExternalCommandFixture {
    func verified(_ phase: String) throws { preconditionFailure("External fixture is nil in this inert caller") }
}

@main
private final class ClipboardOwnershipFixture {
    private static let text = "NAC_NATIVE_EDIT_FIXTURE"
    private static let foreign = "PRIVATE_OUTSIDE_VALUE"
    private static let prefix = "Clipboard changed outside the fixture copy; restoration is not owned"
    private(set) var owned: Int?
    private(set) var drives = 0
    private(set) var keys = 0
    private var focusChecks = 0
    private var failFocusAt: Int?

    // OWNERSHIP_HELPER
    // COPY_READY_HELPER
    // WAIT_OWNER

    private func requireFocus() throws {
        focusChecks += 1
        if focusChecks == failFocusAt { throw FixtureError.focusLost }
    }
    private func drive(_ phase: String, external: ExternalCommandFixture?,
                       operation: () async throws -> Void) async throws {
        precondition(phase == "copy" && external == nil)
        drives += 1
        try requireFocus()
        try await operation()
    }
    private func key(_ code: Int, flags: KeyFlags) async throws {
        precondition(code == 8 && flags == .maskCommand)
        keys += 1
    }
    private func runCopy(_ board: NSPasteboard) async throws {
        let text = Self.text
        let external: ExternalCommandFixture? = nil
        var ownedChange: Int?
        defer { owned = ownedChange }
        // COPY_CALLER
    }
    private static func reason(_ error: Error, is expected: String) {
        guard case PreviewError.message(let message) = error else { preconditionFailure("Unexpected error") }
        precondition(message == "\(prefix) (\(expected))")
        precondition(!message.contains(text) && !message.contains(foreign), "Clipboard data in diagnostic")
    }
    private static func rejects(_ expected: String, _ operation: () throws -> Void) {
        do { try operation(); preconditionFailure("Unowned state accepted") }
        catch { reason(error, is: expected) }
    }

    static func main() async throws {
        let fixture = ClipboardOwnershipFixture()
        // Existing helper diagnostics, stable acceptance and short-circuit reads.
        let failures: [(String?, [Int], String, [String])] = [
            (nil, [7], "value-unavailable", ["count", "string"]),
            (foreign, [7], "fixture-value-mismatch", ["count", "string"]),
            (text, [7, 8], "change-count-moved-during-read", ["count", "string", "count"]),
        ]
        for (value, counts, code, reads) in failures {
            let board = NSPasteboard(counts: counts, values: [value])
            rejects(code) { _ = try fixture.ownedClipboardChange(board, expected: text) }
            precondition(board.reads == reads)
        }
        let stable = NSPasteboard(counts: [7, 7], values: [text])
        let oldOwned = try fixture.ownedClipboardChange(stable, expected: text)
        precondition(oldOwned == 7 && stable.reads == ["count", "string", "count"])

        var pin: Int?
        let unchanged = NSPasteboard(counts: [6], values: [])
        let unchangedReady = try fixture.copyClipboardReady(unchanged, beforeCopy: 6, generation: &pin, expected: text)
        precondition(!unchangedReady && pin == nil && unchanged.reads == ["count"])
        let delayed = NSPasteboard(counts: [7, 7, 7, 7], values: [nil, text])
        let first = try fixture.copyClipboardReady(delayed, beforeCopy: 6, generation: &pin, expected: text)
        precondition(!first && pin == 7)
        let second = try fixture.copyClipboardReady(delayed, beforeCopy: 6, generation: &pin, expected: text)
        precondition(second && pin == 7)
        precondition(delayed.reads == ["count", "type", "string", "count", "count", "type", "string", "count"])
        let moved = NSPasteboard(counts: [8], values: [])
        rejects("copy-generation-changed") {
            _ = try fixture.copyClipboardReady(moved, beforeCopy: 6, generation: &pin, expected: text)
        }
        precondition(pin == 7 && moved.reads == ["count"])
        let noType = NSPasteboard(counts: [7, 7], values: [nil], advertised: false)
        let noTypeReady = try fixture.copyClipboardReady(noType, beforeCopy: 6, generation: &pin, expected: text)
        precondition(!noTypeReady && pin == 7 && noType.reads == ["count", "type", "string", "count"])
        let noTypeWrong = NSPasteboard(counts: [7, 7], values: [foreign], advertised: false)
        rejects("fixture-value-mismatch") {
            _ = try fixture.copyClipboardReady(noTypeWrong, beforeCopy: 6, generation: &pin, expected: text)
        }
        precondition(noTypeWrong.reads == ["count", "type", "string", "count"])

        // Actual Copy caller + actual wait: one input, pinned nil settlement, final ownership.
        let cases: [([Int], [String?], String?)] = [
            ([6, 7, 7, 7, 7], [text, text], nil),
            ([6, 6, 7, 7, 7, 7], [text, text], nil),
            ([6, 7, 7, 7, 7, 7, 7], [nil, text, text], nil),
            ([6, 7, 7], [foreign, text], "fixture-value-mismatch"),
            ([6, 7, 7, 7, 7], [nil, foreign, text], "fixture-value-mismatch"),
            ([6, 7, 8], [nil], "copy-generation-changed"),
            ([6, 7, 8], [text], "copy-generation-changed"),
            ([6, 7, 8], [foreign], "copy-generation-changed"),
            ([6, 7, 7, 8], [nil, text], "copy-generation-changed"),
            ([6, 7, 7, 8, 8], [text, text], "copy-generation-changed"),
            ([6, 7, 7, 7], [text, nil], "value-unavailable"),
            ([6, 7, 7, 7], [text, foreign], "fixture-value-mismatch"),
            ([6, 7, 7, 7, 8], [text, text], "change-count-moved-during-read"),
        ]
        for (counts, values, failure) in cases {
            Clock.reset()
            let caller = ClipboardOwnershipFixture()
            let board = NSPasteboard(counts: counts, values: values)
            do {
                try await caller.runCopy(board)
                precondition(failure == nil && caller.owned == 7)
            } catch {
                guard let failure else { throw error }
                reason(error, is: failure)
                precondition(caller.owned == nil, "Failed episode acquired restoration authority")
            }
            precondition(caller.drives == 1 && caller.keys == 1, "Copy was replayed")
        }

        // The actual unchanged wait owns timeout, focus and cancellation; fake sleep only advances time.
        Clock.reset()
        let timeout = ClipboardOwnershipFixture()
        let nilForever = NSPasteboard(counts: [6, 7], values: [nil], repeatLast: true)
        do { try await timeout.runCopy(nilForever); preconditionFailure("Missing deadline") }
        catch PreviewError.message(let message) {
            precondition(message == "Timed out waiting for fixture-owned native copy")
        }
        precondition(Clock.now >= 10 && Clock.now < 10.1 && timeout.owned == nil)
        precondition(timeout.drives == 1 && timeout.keys == 1)
        Clock.reset()
        let focus = ClipboardOwnershipFixture(); focus.failFocusAt = 3
        let focusBoard = NSPasteboard(counts: [6, 7, 7], values: [nil])
        do { try await focus.runCopy(focusBoard); preconditionFailure("Focus refusal lost") }
        catch FixtureError.focusLost {}
        precondition(focus.owned == nil && focus.drives == 1 && focus.keys == 1)
        precondition(focusBoard.reads == ["count", "count", "type", "string", "count"])
        Clock.reset(); Clock.cancelOnSleep = true
        let cancelled = ClipboardOwnershipFixture()
        do {
            try await cancelled.runCopy(NSPasteboard(counts: [6, 7, 7], values: [nil]))
            preconditionFailure("Cancellation lost")
        } catch FixtureError.cancelled {}
        precondition(cancelled.owned == nil && cancelled.drives == 1 && cancelled.keys == 1)
        print("Clipboard ownership, pinned settlement and caller/wait controls passed; no system clipboard accessed")
    }
}
