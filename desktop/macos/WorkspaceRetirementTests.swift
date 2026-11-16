import AppKit
import WebKit

/// Actual WKWebView ownership checks. Requires root-approved native execution;
/// it proves neither trusted input nor actual renderer-process termination.
@main
struct WorkspaceRetirementTests {
    @MainActor
    private final class Holder {
        var view: WKWebView?
        var drops = 0
    }

    @MainActor
    static func main() async throws {
        _ = NSApplication.shared
        let owner = Holder()
        owner.view = WKWebView(frame: .zero)
        weak var original = owner.view
        let retirement = WorkspaceRetirement(view: owner.view, commands: nil) {
            owner.drops += 1
            owner.view = nil
        }
        try await retirement.wait()
        try await retirement.wait()
        precondition(original == nil && owner.view == nil && owner.drops == 1)

        let held = Holder()
        let external = Holder()
        held.view = WKWebView(frame: .zero)
        external.view = held.view
        let pending = WorkspaceRetirement(view: held.view, commands: nil) {
            held.drops += 1
            held.view = nil
        }
        let canceled = Task { try await pending.wait() }
        canceled.cancel()
        do { try await canceled.value; preconditionFailure("Retired waiter ignored cancellation") }
        catch is CancellationError {}
        precondition(external.view != nil && held.view == nil && held.drops == 1)
        external.view = nil
        try await pending.wait()
        precondition(held.drops == 1)
        print("Actual workspace retirement fixtures passed; no input/crash acceptance claim")
    }
}
