import Foundation

@main
struct NativeFolderSelectionTests {
    static func main() {
        let selection = NativeFolderSelection()
        let first = selection.begin()!
        let next = selection.begin()!
        selection.cancel(first)
        precondition(!selection.complete(first, current: true))
        precondition(selection.complete(next, current: true))
        precondition(!selection.complete(next, current: true))
        let cancelled = selection.begin()!
        selection.cancel(cancelled)
        precondition(!selection.complete(cancelled, current: true))
        let stale = selection.begin()!
        precondition(!selection.complete(stale, current: false))
        precondition(!selection.complete(stale, current: true))
        let retired = selection.begin()!
        selection.retire()
        precondition(!selection.complete(retired, current: true))
        precondition(selection.begin() == nil)
        for path in ["/tmp/Project with spaces", "/tmp/日本語/🦀", "/tmp/missing or moved"] {
            precondition(NativeFolderSelection.validPath(path))
        }
        for path in ["", "relative", "file:///tmp/a", "ssh://host/tmp/a", "/tmp/\0bad", "/" + String(repeating: "a", count: 16_384)] {
            precondition(!NativeFolderSelection.validPath(path))
        }
        print("Native folder request lifetime fixtures passed")
    }
}
