import Foundation

/// Shell-owned explanation for a validated serving-lease conflict. Never infer
/// an owner PID, endpoint or authority from a diagnostic or a discovery file.
struct StoreConflict: Equatable {
    let canonicalStore: String
    let track: String

    var message: String {
        """
        Another NAC process owns this store.

        Track: \(track)
        Store: \(canonicalStore)

        The owner may be a CLI you started in Terminal or another NAC app. Stop it deliberately using its own Quit or Terminal controls. Wait for its shutdown to finish, then choose Retry. Retry asks the bundled engine to acquire the ordinary store lease again; it can still report a conflict while the owner is stopping.

        To use a separate profile, quit this app and relaunch with an explicit --store-path pointing to a different database. Selecting a separate profile shows that database's projects.
        """
    }
}

/// One conflict episode fences completion from an older failed app child.
/// Retirement makes retry available; only an explicit user action consumes it.
final class StoreConflictRetry {
    struct Episode: Equatable {
        let id = UUID()
        let conflict: StoreConflict
    }
    private(set) var episode: Episode?
    private(set) var canRetry = false

    @discardableResult
    func present(_ conflict: StoreConflict) -> Episode {
        let next = Episode(conflict: conflict)
        episode = next
        canRetry = false
        return next
    }

    func retired(_ completed: Episode, ownedChildHasExited: Bool) {
        guard completed == episode, ownedChildHasExited else { return }
        canRetry = true
    }

    func beginRetry(ownedChildHasExited: Bool, appIsStopping: Bool) -> StoreConflict? {
        guard canRetry, ownedChildHasExited, !appIsStopping, let current = episode else { return nil }
        clear()
        return current.conflict
    }

    func clear() {
        episode = nil
        canRetry = false
    }
}
