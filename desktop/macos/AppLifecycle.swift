import Foundation

/// Application termination policy only. PreviewEngine retains the private
/// control channel, process identity, shutdown deadline and reaping authority.
/// All calls come from AppKit's main thread, including engine completions.
@MainActor
final class AppLifecycle {
    enum Observation: Equatable { case idle, active, unknown }

    struct Activity: Equatable {
        var runs: Observation = .unknown
        var approvals: Observation = .unknown
        var terminals: Observation = .unknown
        var commands: Observation = .unknown

        var summary: Observation {
            let observations = [runs, approvals, terminals, commands]
            if observations.contains(.active) { return .active }
            if observations.contains(.unknown) { return .unknown }
            return .idle
        }
    }

    struct Confirmation: Equatable {
        let id = UUID()
        let activity: Observation
    }

    struct Stop: Equatable {
        let id = UUID()
        /// Pinned before UI retirement. Never replace this with a successor.
        let launch: UUID?
    }

    struct Wait: Equatable {
        let id = UUID()
        let stop: Stop
    }

    enum Phase: Equatable {
        case running
        case confirming(Confirmation)
        case stopping(Wait)
        /// The AppKit termination request has been cancelled, but the original
        /// engine stop is still owned and may complete. Never send another stop.
        case shutdownFailed(Stop)
        case finished(Stop)
    }

    enum QuitDecision: Equatable {
        case confirm(Confirmation)
        case stop(Wait)
        case wait(Wait)
        case pendingConfirmation
        case terminateNow
    }

    enum Answer: Equatable { case cancel, stop(Wait), ignored }
    enum Completion: Equatable { case terminate, settledAfterTimeout, ignored }

    private(set) var phase: Phase = .running
    private(set) var launch: UUID?

    /// Startup/retry records a launch before asynchronous preparation begins.
    /// Once stopping starts, no successor may take over a late stop callback.
    func beginLaunch() -> UUID? {
        guard launch == nil else { return nil }
        switch phase {
        case .running, .confirming: break
        case .stopping, .shutdownFailed, .finished: return nil
        }
        let next = UUID()
        launch = next
        return next
    }

    func childExited(_ expected: UUID) {
        guard launch == expected else { return }
        launch = nil
        // Keep an outstanding confirmation intact. Cancel still leaves the
        // workspace alone; Stop still retires it even if its child just exited.
    }

    /// Hiding a window never retires its WebView, bridge, streams or engine.
    var canHideWorkspace: Bool {
        switch phase {
        case .running: return true
        // Keep a pending native Quit sheet reachable on its owning window.
        case .confirming, .stopping, .shutdownFailed, .finished: return false
        }
    }

    func requestQuit(activity: Activity) -> QuitDecision {
        switch phase {
        case .running:
            if activity.summary == .idle { return .stop(beginStop()) }
            let confirmation = Confirmation(activity: activity.summary)
            phase = .confirming(confirmation)
            return .confirm(confirmation)
        case .confirming:
            return .pendingConfirmation
        case .stopping(let wait):
            return .wait(wait)
        case .shutdownFailed(let stop):
            // A new explicit Quit may wait again, without a second retirement
            // or a second control request to the engine.
            let wait = Wait(stop: stop)
            phase = .stopping(wait)
            return .wait(wait)
        case .finished:
            return .terminateNow
        }
    }

    func answer(_ confirmation: Confirmation, stop: Bool) -> Answer {
        guard phase == .confirming(confirmation) else { return .ignored }
        if stop { return .stop(beginStop()) }
        phase = .running
        return .cancel
    }

    /// A UI deadline does not establish process exit or persistence drain and
    /// must not signal anything. Cancel the pending AppKit request and retain
    /// the original stop callback until the existing engine owner settles it.
    @discardableResult
    func shutdownTimedOut(_ wait: Wait) -> Bool {
        guard phase == .stopping(wait) else { return false }
        phase = .shutdownFailed(wait.stop)
        return true
    }

    func stopped(_ stop: Stop, ownedChildHasExited: Bool) -> Completion {
        guard ownedChildHasExited, launch == nil || launch == stop.launch else { return .ignored }
        switch phase {
        case .stopping(let wait) where wait.stop == stop:
            launch = nil
            phase = .finished(stop)
            return .terminate
        case .shutdownFailed(let expected) where expected == stop:
            launch = nil
            phase = .finished(stop)
            return .settledAfterTimeout
        default:
            return .ignored
        }
    }

    private func beginStop() -> Wait {
        let stop = Stop(launch: launch)
        let wait = Wait(stop: stop)
        phase = .stopping(wait)
        return wait
    }
}
