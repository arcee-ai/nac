import Foundation

/// A slow engine deliberately does not call completion until the test releases
/// it. It can also fail to settle, exit during a sheet, or deliver a late reply.
@MainActor
private final class LifecycleFixture {
    let lifecycle = AppLifecycle()
    var activity = AppLifecycle.Activity()
    var engineAlive = true
    var windowVisible = true
    var streamRetained = true
    var bridgeRetained = true
    var trace: [String] = []
    var stopRequests: [AppLifecycle.Wait] = []
    var confirmation: AppLifecycle.Confirmation?
    var replies: [Bool] = []
    let launch: UUID

    init() { launch = lifecycle.beginLaunch()! }

    func closeAndReopen() {
        if lifecycle.canHideWorkspace { windowVisible = false }
        precondition(!windowVisible)
        precondition(engineAlive && streamRetained && bridgeRetained)
        windowVisible = true // AppInstance owns actual Dock presentation.
    }

    func quit() -> AppLifecycle.QuitDecision {
        let decision = lifecycle.requestQuit(activity: activity)
        switch decision {
        case .confirm(let episode): confirmation = episode
        case .stop(let wait): stop(wait)
        case .terminateNow: replies.append(true)
        case .pendingConfirmation, .wait: break
        }
        return decision
    }

    func answer(stop shouldStop: Bool) {
        guard let confirmation else { preconditionFailure("No confirmation") }
        switch lifecycle.answer(confirmation, stop: shouldStop) {
        case .cancel: replies.append(false)
        case .stop(let wait): stop(wait)
        case .ignored: break
        }
    }

    private func stop(_ wait: AppLifecycle.Wait) {
        trace.append("retire")
        streamRetained = false
        bridgeRetained = false
        trace.append("stop")
        stopRequests.append(wait)
    }

    func complete(_ stop: AppLifecycle.Stop) -> AppLifecycle.Completion {
        let result = lifecycle.stopped(stop, ownedChildHasExited: !engineAlive)
        if result == .terminate { replies.append(true) }
        return result
    }

    func timeout(_ wait: AppLifecycle.Wait) {
        if lifecycle.shutdownTimedOut(wait) { replies.append(false) }
    }
}

@main
enum AppLifecycleTests {
    @MainActor
    static func main() {
        closeAndCancelPreserveOwners()
        onlyCompleteIdleEvidenceSkipsConfirmation()
        slowShutdownIsOnceAndWaitsForExit()
        childExitWhileConfirmingAndLateAnswer()
        timeoutDoesNotClaimCleanupOrResendStop()
        generationFences()
        print("App lifecycle: close/reopen, activity, cancel/stop, reentrancy, exit, timeout and stale callbacks passed.")
    }

    @MainActor
    private static func closeAndCancelPreserveOwners() {
        let fixture = LifecycleFixture()
        for key in [\AppLifecycle.Activity.runs, \.approvals, \.terminals, \.commands] {
            fixture.activity = AppLifecycle.Activity()
            fixture.activity[keyPath: key] = .active
            fixture.closeAndReopen()
            guard case .confirm(let episode) = fixture.quit() else { preconditionFailure() }
            precondition(episode.activity == .active)
            precondition(!fixture.lifecycle.canHideWorkspace, "Quit sheet lost its owning window")
            precondition(fixture.quit() == .pendingConfirmation)
            fixture.answer(stop: false)
            precondition(fixture.lifecycle.phase == .running)
            precondition(fixture.lifecycle.launch == fixture.launch)
            precondition(fixture.engineAlive && fixture.streamRetained && fixture.bridgeRetained)
            precondition(fixture.trace.isEmpty && fixture.stopRequests.isEmpty)
        }
        fixture.activity = AppLifecycle.Activity()
        guard case .confirm(let episode) = fixture.quit() else { preconditionFailure() }
        precondition(episode.activity == .unknown)
        fixture.answer(stop: false)
        precondition(fixture.replies == [false, false, false, false, false])
    }

    @MainActor
    private static func onlyCompleteIdleEvidenceSkipsConfirmation() {
        let idle = AppLifecycle.Activity(runs: .idle, approvals: .idle, terminals: .idle, commands: .idle)
        for key in [\AppLifecycle.Activity.runs, \.approvals, \.terminals, \.commands] {
            for value in [AppLifecycle.Observation.active, .unknown] {
                let fixture = LifecycleFixture()
                fixture.activity = idle
                fixture.activity[keyPath: key] = value
                guard case .confirm = fixture.quit() else {
                    preconditionFailure("Incomplete evidence skipped confirmation")
                }
                precondition(fixture.stopRequests.isEmpty)
            }
        }
        let fixture = LifecycleFixture()
        fixture.activity = idle
        guard case .stop = fixture.quit() else { preconditionFailure() }
        precondition(fixture.trace == ["retire", "stop"])
        precondition(fixture.replies.isEmpty, "Idle still needs real engine cleanup")
    }

    @MainActor
    private static func slowShutdownIsOnceAndWaitsForExit() {
        let fixture = LifecycleFixture()
        guard case .confirm = fixture.quit() else { preconditionFailure() }
        fixture.answer(stop: true)
        let wait = fixture.stopRequests[0]
        precondition(wait.stop.launch == fixture.launch)
        for _ in 0..<10 {
            precondition(fixture.quit() == .wait(wait)) // Cmd-Q / OS termination.
            fixture.answer(stop: true) // Reentrant/duplicated sheet completion.
        }
        precondition(fixture.trace == ["retire", "stop"])
        precondition(!fixture.lifecycle.canHideWorkspace)
        precondition(fixture.complete(wait.stop) == .ignored)
        precondition(fixture.replies.isEmpty, "Stop acknowledgement is not child exit")
        fixture.engineAlive = false
        precondition(fixture.complete(wait.stop) == .terminate)
        precondition(fixture.complete(wait.stop) == .ignored)
        fixture.timeout(wait)
        precondition(fixture.replies == [true])
        precondition(fixture.lifecycle.beginLaunch() == nil)
    }

    @MainActor
    private static func childExitWhileConfirmingAndLateAnswer() {
        let fixture = LifecycleFixture()
        guard case .confirm(let old) = fixture.quit() else { preconditionFailure() }
        fixture.engineAlive = false
        fixture.lifecycle.childExited(fixture.launch)
        precondition(fixture.lifecycle.phase == .confirming(old))
        fixture.answer(stop: false)
        precondition(fixture.streamRetained && fixture.bridgeRetained)
        guard case .confirm(let current) = fixture.quit() else { preconditionFailure() }
        precondition(old != current)
        precondition(fixture.lifecycle.answer(old, stop: true) == .ignored)
        fixture.answer(stop: true)
        let wait = fixture.stopRequests[0]
        precondition(wait.stop.launch == nil)
        precondition(fixture.complete(wait.stop) == .terminate)
        precondition(fixture.trace == ["retire", "stop"])
    }

    @MainActor
    private static func timeoutDoesNotClaimCleanupOrResendStop() {
        let fixture = LifecycleFixture()
        _ = fixture.quit()
        fixture.answer(stop: true)
        let first = fixture.stopRequests[0]
        fixture.timeout(first)
        fixture.timeout(first)
        precondition(fixture.replies == [false])
        precondition(fixture.engineAlive)
        precondition(fixture.lifecycle.phase == .shutdownFailed(first.stop))
        guard case .wait(let second) = fixture.quit() else { preconditionFailure() }
        precondition(first != second && first.stop == second.stop)
        fixture.timeout(first) // A stale timer must not cancel a newer wait.
        precondition(fixture.lifecycle.phase == .stopping(second))
        precondition(fixture.stopRequests.count == 1)
        fixture.timeout(second)
        fixture.engineAlive = false
        precondition(fixture.complete(first.stop) == .settledAfterTimeout)
        precondition(fixture.replies == [false, false], "Late callback quit after cancellation")
        precondition(fixture.quit() == .terminateNow)
        precondition(fixture.stopRequests.count == 1)
    }

    @MainActor
    private static func generationFences() {
        let fixture = LifecycleFixture()
        precondition(fixture.lifecycle.beginLaunch() == nil)
        fixture.lifecycle.childExited(UUID())
        precondition(fixture.lifecycle.launch == fixture.launch)
        fixture.lifecycle.childExited(fixture.launch)
        let successor = fixture.lifecycle.beginLaunch()!
        precondition(successor != fixture.launch)
        fixture.lifecycle.childExited(fixture.launch)
        precondition(fixture.lifecycle.launch == successor)
        _ = fixture.quit()
        fixture.answer(stop: true)
        let wait = fixture.stopRequests[0]
        precondition(wait.stop.launch == successor)
        let stale = AppLifecycle.Stop(launch: fixture.launch)
        precondition(fixture.lifecycle.stopped(stale, ownedChildHasExited: true) == .ignored)
        precondition(fixture.lifecycle.launch == successor)
        precondition(fixture.lifecycle.beginLaunch() == nil)
        fixture.engineAlive = false
        precondition(fixture.complete(wait.stop) == .terminate)
    }
}
