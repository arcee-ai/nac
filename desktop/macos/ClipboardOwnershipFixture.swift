// Verbatim ownership helper with an in-memory pasteboard double; no AppKit.
private enum PreviewError: Error { case message(String) }

private final class NSPasteboard {
    enum PasteboardType { case string }
    private var counts: [Int]
    private let value: String?
    private(set) var reads: [String] = []

    init(counts: [Int], value: String?) {
        self.counts = counts
        self.value = value
    }
    var changeCount: Int {
        reads.append("count")
        precondition(!counts.isEmpty, "Unexpected extra generation read")
        return counts.removeFirst()
    }
    func string(forType type: PasteboardType) -> String? {
        precondition(type == .string)
        reads.append("string")
        return value
    }
}

@main
private struct ClipboardOwnershipFixture {
    // OWNERSHIP_HELPER

    static func main() throws {
        let fixture = ClipboardOwnershipFixture()
        let expected = "NAC_NATIVE_EDIT_FIXTURE"
        let prefix = "Clipboard changed outside the fixture copy; restoration is not owned"
        let failures: [(String?, [Int], String, [String])] = [
            (nil, [7], "value-unavailable", ["count", "string"]),
            ("PRIVATE_OUTSIDE_VALUE", [7], "fixture-value-mismatch", ["count", "string"]),
            (expected, [7, 8], "change-count-moved-during-read", ["count", "string", "count"]),
        ]
        for (value, counts, reason, reads) in failures {
            let board = NSPasteboard(counts: counts, value: value)
            do {
                _ = try fixture.ownedClipboardChange(board, expected: expected)
                preconditionFailure("Unowned clipboard state accepted")
            } catch PreviewError.message(let message) {
                precondition(message == "\(prefix) (\(reason))", "Unexpected diagnostic")
                precondition(!message.contains(expected) && !message.contains("PRIVATE_OUTSIDE_VALUE"),
                             "Clipboard contents leaked into diagnostic")
            }
            precondition(board.reads == reads, "Short-circuit read ordering changed")
        }
        let stable = NSPasteboard(counts: [7, 7], value: expected)
        let owned = try fixture.ownedClipboardChange(stable, expected: expected)
        precondition(owned == 7)
        precondition(stable.reads == ["count", "string", "count"])
        print("Clipboard ownership branches and read ordering passed; no system clipboard accessed")
    }
}
