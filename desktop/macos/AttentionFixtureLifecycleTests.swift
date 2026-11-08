import Foundation

/// Real lifecycle assertions, no AppKit adapter. This repair only typechecks
/// this program; neither it nor a native app may execute without admission.
@main
enum AttentionFixtureLifecycleTests {
    @MainActor
    static func main() {
        cleanupPinsExactLaunchAndStopsOnce()
        existingConfirmationCannotCancelCleanup()
        timeoutRetainsOriginalStopAndReapFence()
        existingStopIsNotReplaced()
    }

    @MainActor
    private static func cleanupPinsExactLaunchAndStopsOnce() {
        let lifecycle = AppLifecycle()
        let launch = lifecycle.beginLaunch()!
        let wait = lifecycle.beginAttentionFixtureCleanup()!
        precondition(wait.stop.launch == launch && lifecycle.phase == .stopping(wait))
        precondition(lifecycle.beginAttentionFixtureCleanup() == nil)
        precondition(lifecycle.beginLaunch() == nil)
        precondition(lifecycle.stopped(wait.stop, ownedChildHasExited: false) == .ignored)
        lifecycle.childExited(UUID())
        precondition(lifecycle.launch == launch)
        precondition(lifecycle.stopped(AppLifecycle.Stop(launch: UUID()), ownedChildHasExited: true) == .ignored)
        lifecycle.childExited(launch)
        precondition(lifecycle.stopped(wait.stop, ownedChildHasExited: true) == .terminate)
        precondition(lifecycle.stopped(wait.stop, ownedChildHasExited: true) == .ignored)
        precondition(lifecycle.beginAttentionFixtureCleanup() == nil && lifecycle.beginLaunch() == nil)
    }

    @MainActor
    private static func existingConfirmationCannotCancelCleanup() {
        let lifecycle = AppLifecycle()
        let launch = lifecycle.beginLaunch()!
        guard case .confirm(let confirmation) = lifecycle.requestQuit(activity: .init()) else { preconditionFailure() }
        let wait = lifecycle.beginAttentionFixtureCleanup()!
        precondition(wait.stop.launch == launch)
        precondition(lifecycle.answer(confirmation, stop: false) == .ignored)
        precondition(lifecycle.answer(confirmation, stop: true) == .ignored)
        precondition(lifecycle.phase == .stopping(wait))
        // AppQuit preserves any attached sheet without answering/dismissing it;
        // its queued presentation is fenced separately in source controls.
    }

    @MainActor
    private static func timeoutRetainsOriginalStopAndReapFence() {
        let lifecycle = AppLifecycle()
        _ = lifecycle.beginLaunch()
        let wait = lifecycle.beginAttentionFixtureCleanup()!
        precondition(lifecycle.shutdownTimedOut(wait))
        precondition(lifecycle.phase == .shutdownFailed(wait.stop))
        precondition(!lifecycle.shutdownTimedOut(wait))
        precondition(lifecycle.beginAttentionFixtureCleanup() == nil)
        precondition(lifecycle.phase == .shutdownFailed(wait.stop))
        precondition(lifecycle.stopped(wait.stop, ownedChildHasExited: false) == .ignored)
        precondition(lifecycle.stopped(AppLifecycle.Stop(launch: wait.stop.launch), ownedChildHasExited: true) == .ignored)
        precondition(lifecycle.stopped(wait.stop, ownedChildHasExited: true) == .settledAfterTimeout)
        precondition(lifecycle.phase == .finished(wait.stop))
        precondition(lifecycle.stopped(wait.stop, ownedChildHasExited: true) == .ignored)
    }

    @MainActor
    private static func existingStopIsNotReplaced() {
        let lifecycle = AppLifecycle()
        _ = lifecycle.beginLaunch()
        guard case .confirm(let confirmation) = lifecycle.requestQuit(activity: .init()),
              case .stop(let wait) = lifecycle.answer(confirmation, stop: true) else { preconditionFailure() }
        precondition(lifecycle.beginAttentionFixtureCleanup() == nil)
        precondition(lifecycle.phase == .stopping(wait))
        precondition(lifecycle.shutdownTimedOut(wait))
        precondition(lifecycle.beginAttentionFixtureCleanup() == nil)
        precondition(lifecycle.phase == .shutdownFailed(wait.stop))
    }
}
