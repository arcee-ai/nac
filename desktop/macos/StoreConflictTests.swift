import Foundation

@main
enum StoreConflictTests {
    static func main() {
        let retry = StoreConflictRetry()
        let conflict = StoreConflict(canonicalStore: "/fixture/selected store.db", track: "dev")
        let first = retry.present(conflict)
        precondition(!retry.canRetry)
        precondition(retry.beginRetry(ownedChildHasExited: true, appIsStopping: false) == nil)
        retry.retired(first, ownedChildHasExited: false)
        precondition(!retry.canRetry)
        let second = retry.present(conflict)
        retry.retired(first, ownedChildHasExited: true)
        precondition(!retry.canRetry, "Stale retirement enabled successor retry")
        retry.retired(second, ownedChildHasExited: true)
        precondition(retry.canRetry)
        precondition(retry.beginRetry(ownedChildHasExited: false, appIsStopping: false) == nil)
        precondition(retry.beginRetry(ownedChildHasExited: true, appIsStopping: true) == nil)
        precondition(retry.beginRetry(ownedChildHasExited: true, appIsStopping: false) == conflict)
        precondition(!retry.canRetry && retry.episode == nil)
        precondition(retry.beginRetry(ownedChildHasExited: true, appIsStopping: false) == nil)
        retry.retired(second, ownedChildHasExited: true)
        precondition(!retry.canRetry)
        precondition(conflict.message.contains(conflict.canonicalStore))
        precondition(conflict.message.contains("--store-path"))
        print("Conflict retry episode fencing passed; actual app/CLI retry acceptance is separate.")
    }
}
