// Complete production owners with inert UI boundaries. No real AppKit/OS input.
import Foundation
extension RunLoop.Mode { static let modalPanel = RunLoop.Mode("NSModalPanelRunLoopMode") }
@MainActor class Application: NSObject {
    enum TerminateReply { case terminateNow, terminateCancel, terminateLater }
    weak var delegate: AnyObject?
    var trace: [String] = []
    var terminations = 0
    var replies: [Bool] = []
    var publicAdmissions = 0
    var duringReply: (() -> Void)?
    func activate(ignoringOtherApps: Bool) { trace.append("activate") }
    func terminate(_ sender: Any?) {
        publicAdmissions += 1
        if (delegate as? PreviewApp)?.quit.shouldTerminate() == .terminateNow { terminations += 1 }
    }
    func reply(toApplicationShouldTerminate value: Bool) {
        replies.append(value)
        let callback = duringReply; duringReply = nil; callback?()
    }
}
typealias NSApplication = Application
@MainActor let NSApp = NACApplication()
enum ModalResponse { case alertFirstButtonReturn, alertSecondButtonReturn }
final class Button { var keyEquivalent = "" }
@MainActor final class Window {
    var attachedSheet: Window?
    var isMiniaturized = false
    var presentation: [String] = []
    func deminiaturize(_ sender: Any?) {
        precondition(isMiniaturized, "Non-minimized window was restored")
        presentation.append("restore"); NSApp.trace.append("restore"); isMiniaturized = false
    }
    func makeKeyAndOrderFront(_ sender: Any?) { presentation.append("front"); NSApp.trace.append("front") }
    func endSheet(_ sheet: Window, returnCode: ModalResponse) {
        NSAlert.presented.first { $0.window === sheet }?.answer?(returnCode)
    }
}
@MainActor final class NSAlert {
    static var presented: [NSAlert] = []
    let window = Window()
    var messageText = "", informativeText = ""
    var buttons: [Button] = []
    var answer: ((ModalResponse) -> Void)?
    func addButton(withTitle: String) -> Button {
        let button = Button(); buttons.append(button); return button
    }
    func beginSheetModal(for window: Window, completionHandler: @escaping (ModalResponse) -> Void) {
        NSApp.trace.append("sheet"); window.attachedSheet = self.window
        answer = { response in window.attachedSheet = nil; completionHandler(response) }
        Self.presented.append(self)
    }
}
@MainActor final class Engine { var pid = 42 }
@MainActor final class PreviewApp {
    var window: Window! = Window()
    let engine = Engine()
    lazy var quit = AppQuit(app: self)
    var stops = 0
    var completion: (() -> Void)?
    var statuses: [String] = []
    func beginShutdown(completion: @escaping () -> Void) { stops += 1; self.completion = completion }
    func showShutdownStatus(_ message: String) { statuses.append(message) }
}
// APP_QUIT_OWNER

@main struct QuitPresentationControls {
    @MainActor static func drain() { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
    @MainActor static func reset() {
        NSApp.trace = []; NSApp.terminations = 0; NSApp.replies = []
        NSApp.publicAdmissions = 0; NSApp.duringReply = nil; NSApp.delegate = nil; NSAlert.presented = []
    }
    @MainActor static func originalBoundariesAndOSFirstFence() {
        reset()
        let app = PreviewApp(); NSApp.delegate = app
        withExtendedLifetime(app) {
            let owner = app.quit
            _ = owner.beginLaunch()
            // Direct delegate entry is the retained OS-first failure origin.
            precondition(owner.shouldTerminate() == .terminateLater)
            precondition(NSApp.trace.isEmpty && NSApp.replies.isEmpty)
            drain()
            precondition(NSApp.trace == ["front", "activate", "sheet"])
            let sheet = NSAlert.presented[0]
            precondition(sheet.buttons.map(\.keyEquivalent) == ["\r", ""])
            NSApp.terminate(nil)
            precondition(NSApp.publicAdmissions == 0, "OS-first/native duplicate reached AppKit")
            precondition(owner.shouldTerminate() == .terminateLater)
            drain()
            precondition(NSAlert.presented.count == 1 && NSApp.trace.count == 3)
            sheet.answer?(.alertFirstButtonReturn)
            precondition(owner.lifecycle.phase == .running && app.stops == 0)
            precondition(NSApp.replies.isEmpty, "Reply must follow delegate return")
            NSApp.terminate(nil)
            precondition(NSApp.publicAdmissions == 0, "Fence ended before reply unwind")
            drain()
            precondition(NSApp.replies == [false] && !owner.terminationPending)
            sheet.answer?(.alertSecondButtonReturn)
            precondition(app.stops == 0, "Stale sheet callback must not Stop")
        }
        reset()
        let staleApp = PreviewApp(), stale = staleApp.quit
        _ = stale.shouldTerminate()
        guard case .confirming(let episode) = stale.lifecycle.phase else { preconditionFailure() }
        precondition(stale.lifecycle.answer(episode, stop: false) == .cancel)
        drain()
        precondition(NSApp.trace.isEmpty && NSAlert.presented.isEmpty, "Stale queued present ran")
        reset()
        let absentApp = PreviewApp(); absentApp.window = nil
        let absent = absentApp.quit
        _ = absent.shouldTerminate(); drain(); drain()
        precondition(absent.lifecycle.phase == .running && NSApp.trace.isEmpty)
        precondition(NSApp.replies == [false] && !absent.terminationPending)
        reset()
        let stopApp = PreviewApp(), stop = stopApp.quit; NSApp.delegate = stopApp
        _ = stop.beginLaunch(); _ = stop.shouldTerminate(); drain()
        NSAlert.presented[0].answer?(.alertSecondButtonReturn)
        precondition(stopApp.stops == 1)
        _ = stop.shouldTerminate(); NSApp.terminate(nil); drain()
        precondition(stopApp.stops == 1 && NSAlert.presented.count == 1 && NSApp.publicAdmissions == 0)
        stopApp.completion?(); drain()
        precondition(NSApp.replies.isEmpty, "Unreaped child was accepted as cleanup")
        stopApp.engine.pid = 0; stopApp.completion?(); drain()
        precondition(NSApp.replies == [true] && stop.shouldTerminate() == .terminateNow)
        stopApp.completion?(); drain()
        precondition(NSApp.replies == [true] && stopApp.stops == 1)
    }
    @MainActor static func minimizedConfirmationPreservesDecisionOwner() {
        for stop in [false, true] {
            reset()
            let app = PreviewApp(); NSApp.delegate = app
            let launch = app.quit.beginLaunch()
            app.window.isMiniaturized = true
            precondition(app.quit.shouldTerminate() == .terminateLater)
            precondition(NSApp.trace.isEmpty && NSApp.replies.isEmpty)
            drain()
            precondition(NSApp.trace == ["restore", "front", "activate", "sheet"], "Minimized confirmation presentation order")
            precondition(!app.window.isMiniaturized && app.stops == 0, "Restored a foreign confirmation window")
            NSApp.terminate(nil); drain()
            precondition(NSAlert.presented.count == 1 && NSApp.publicAdmissions == 0)
            NSAlert.presented[0].answer?(stop ? .alertSecondButtonReturn : .alertFirstButtonReturn)
            drain()
            if stop {
                precondition(app.stops == 1 && NSApp.replies.isEmpty)
                app.engine.pid = 0; app.completion?(); drain()
                precondition(NSApp.replies == [true] && app.stops == 1)
            } else {
                precondition(NSApp.replies == [false] && app.stops == 0)
                precondition(app.quit.launch == launch && app.engine.pid == 42)
            }
        }
    }
    @MainActor static func ordinaryTimeoutAndLateCompletion() {
        reset()
        let idleApp = PreviewApp(), waitingApp = PreviewApp()
        for app in [idleApp, waitingApp] {
            _ = app.quit.beginLaunch(); _ = app.quit.shouldTerminate(); drain()
            NSAlert.presented.last!.answer?(.alertSecondButtonReturn)
            // Keep one visible neighbor while the other waits minimized.
            app.window.isMiniaturized = app === idleApp
            app.window.presentation = []
        }
        // Real owner Timer, bounded once for both branches; no deadline seam.
        RunLoop.main.run(until: Date().addingTimeInterval(26.1)); drain()
        precondition(NSApp.replies == [false, false])
        for app in [idleApp, waitingApp] {
            guard case .shutdownFailed = app.quit.lifecycle.phase else { preconditionFailure() }
            precondition(app.stops == 1 && !app.quit.terminationPending && !app.statuses.isEmpty)
            precondition(!app.window.isMiniaturized, "Timed-out owned status remained minimized")
            precondition(app.window.presentation == (app === idleApp ? ["restore", "front"] : ["front"]),
                         "Timed-out status presentation order")
        }
        idleApp.engine.pid = 0; idleApp.completion?(); drain()
        precondition(NSApp.replies == [false, false] && NSApp.terminations == 0)
        precondition(idleApp.quit.shouldTerminate() == .terminateNow)
        precondition(waitingApp.quit.shouldTerminate() == .terminateLater)
        waitingApp.engine.pid = 0; waitingApp.completion?(); drain()
        precondition(NSApp.replies == [false, false, true] && waitingApp.stops == 1)
    }
    #if ATTENTION_SMOKE
    @MainActor static func attentionCleanupJoins() {
        reset()
        let app = PreviewApp(); NSApp.delegate = app
        app.window.isMiniaturized = true
        _ = app.quit.beginLaunch(); app.quit.cleanupAttentionFixture(); app.quit.cleanupAttentionFixture()
        precondition(NSApp.trace.isEmpty && app.window.isMiniaturized, "Minimized attention cleanup presented UI")
        precondition(app.stops == 1 && NSAlert.presented.isEmpty && !app.quit.terminationPending)
        app.engine.pid = 0; app.completion?(); drain()
        precondition(NSApp.replies.isEmpty && NSApp.terminations == 1)
        reset()
        let pending = PreviewApp(); NSApp.delegate = pending
        _ = pending.quit.beginLaunch(); _ = pending.quit.shouldTerminate(); drain()
        let sheet = NSAlert.presented[0]; let trace = NSApp.trace
        pending.quit.cleanupAttentionFixture()
        precondition(NSApp.trace == trace && pending.stops == 1)
        sheet.answer?(.alertFirstButtonReturn) // Retired old answer cannot cancel cleanup.
        precondition(pending.quit.terminationPending && NSApp.replies.isEmpty)
        pending.engine.pid = 0; pending.completion?(); drain()
        precondition(NSApp.replies == [true] && NSApp.terminations == 0)
        reset()
        let replyRace = PreviewApp(); NSApp.delegate = replyRace
        _ = replyRace.quit.beginLaunch(); _ = replyRace.quit.shouldTerminate(); drain()
        NSApp.duringReply = {
            replyRace.quit.cleanupAttentionFixture()
            replyRace.engine.pid = 0; replyRace.completion?()
        }
        NSAlert.presented[0].answer?(.alertFirstButtonReturn); drain(); drain()
        precondition(NSApp.replies == [false] && NSApp.terminations == 1 && replyRace.stops == 1)
        reset()
        let late = PreviewApp(), latePending = PreviewApp()
        _ = late.quit.beginLaunch(); late.quit.cleanupAttentionFixture()
        _ = latePending.quit.beginLaunch(); _ = latePending.quit.shouldTerminate(); drain()
        late.window.isMiniaturized = true; latePending.window.isMiniaturized = true
        latePending.quit.cleanupAttentionFixture()
        let timeoutTrace = NSApp.trace
        RunLoop.main.run(until: Date().addingTimeInterval(26.1)); drain()
        for app in [late, latePending] {
            precondition(app.quit.attentionFixtureCleanupTimeouts == 1 && app.stops == 1)
        }
        precondition(NSApp.replies.isEmpty && NSApp.trace == timeoutTrace && NSApp.terminations == 0)
        precondition(latePending.quit.terminationPending)
        precondition(late.window.isMiniaturized && latePending.window.isMiniaturized,
                     "Minimized attention timeout restored a window")
        NSApp.delegate = late; late.engine.pid = 0; late.completion?(); drain()
        precondition(NSApp.terminations == 1 && NSApp.replies.isEmpty)
        NSApp.delegate = latePending; latePending.engine.pid = 0; latePending.completion?(); drain()
        precondition(NSApp.terminations == 1 && NSApp.replies == [true])
        precondition(!latePending.quit.terminationPending)
    }
    #endif
    @MainActor static func main() {
        originalBoundariesAndOSFirstFence()
        minimizedConfirmationPreservesDecisionOwner()
        #if ATTENTION_SMOKE
        attentionCleanupJoins()
        #else
        ordinaryTimeoutAndLateCompletion()
        #endif
        print("Complete owner: original boundaries, OS-first fence, replies and timeout/cleanup joins; inert boundaries only.")
    }
}
