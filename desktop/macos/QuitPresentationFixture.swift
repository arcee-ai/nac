// Headless AppKit boundary doubles; the complete AppQuit owner is inserted.
// Activation calls are recorded, never sent to a real application or OS.
import Foundation

final class Application {
    enum TerminateReply { case terminateNow, terminateCancel, terminateLater }
    var trace: [String] = []
    var terminations = 0
    func activate(ignoringOtherApps: Bool) { trace.append("activate") }
    func terminate(_ sender: Any?) { terminations += 1 }
}
typealias NSApplication = Application
let NSApp = Application()
enum ModalResponse { case alertFirstButtonReturn, alertSecondButtonReturn }
final class Button { var keyEquivalent = "" }
@MainActor final class Window {
    func makeKeyAndOrderFront(_ sender: Any?) { NSApp.trace.append("front") }
}
@MainActor final class NSAlert {
    static var presented: [NSAlert] = []
    var messageText = "", informativeText = ""
    var buttons: [Button] = []
    var answer: ((ModalResponse) -> Void)?
    func addButton(withTitle: String) -> Button {
        let button = Button(); buttons.append(button); return button
    }
    func beginSheetModal(for window: Window, completionHandler: @escaping (ModalResponse) -> Void) {
        NSApp.trace.append("sheet"); answer = completionHandler; Self.presented.append(self)
    }
}
@MainActor final class Engine { var pid = 42 }
@MainActor final class PreviewApp {
    var window: Window! = Window()
    let engine = Engine()
    var stops = 0
    var completion: (() -> Void)?
    func beginShutdown(completion: @escaping () -> Void) { stops += 1; self.completion = completion }
    func showShutdownStatus(_ message: String) {}
}
// APP_QUIT_OWNER

@main struct QuitPresentationControls {
    @MainActor static func drain() { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
    @MainActor static func reset() { NSApp.trace = []; NSApp.terminations = 0; NSAlert.presented = [] }
    @MainActor static func main() {
        reset()
        let app = PreviewApp()
        // Keep each unowned app alive for its complete owner episode.
        withExtendedLifetime(app) {
            let owner = AppQuit(app: app)
            precondition(owner.shouldTerminate() == .terminateCancel)
            precondition(NSApp.trace.isEmpty, "Quit must return before presenting")
            drain()
            precondition(NSApp.trace == ["front", "activate", "sheet"], "Background Quit must request activation before its sheet")
            let sheet = NSAlert.presented[0]
            precondition(sheet.buttons.map(\.keyEquivalent) == ["\r", ""])
            precondition(owner.shouldTerminate() == .terminateCancel)
            drain()
            precondition(NSAlert.presented.count == 1 && NSApp.trace.count == 3)
            sheet.answer?(.alertFirstButtonReturn)
            precondition(owner.lifecycle.phase == .running && app.stops == 0)
            sheet.answer?(.alertSecondButtonReturn)
            precondition(app.stops == 0, "Stale sheet callback must not Stop")
        }
        reset()
        let staleApp = PreviewApp(), stale = AppQuit(app: staleApp)
        _ = stale.shouldTerminate()
        guard case .confirming(let episode) = stale.lifecycle.phase else { preconditionFailure() }
        precondition(stale.lifecycle.answer(episode, stop: false) == .cancel)
        drain()
        precondition(NSApp.trace.isEmpty && NSAlert.presented.isEmpty)
        reset()
        let absentApp = PreviewApp(); absentApp.window = nil
        let absent = AppQuit(app: absentApp)
        _ = absent.shouldTerminate(); drain()
        precondition(absent.lifecycle.phase == .running && NSApp.trace.isEmpty)
        reset()
        let stopApp = PreviewApp(), stop = AppQuit(app: stopApp)
        _ = stop.beginLaunch()
        _ = stop.shouldTerminate(); drain()
        NSAlert.presented[0].answer?(.alertSecondButtonReturn)
        precondition(stopApp.stops == 1)
        _ = stop.shouldTerminate(); drain()
        precondition(stopApp.stops == 1 && NSAlert.presented.count == 1)
        stopApp.engine.pid = 0; stopApp.completion?(); drain()
        precondition(NSApp.terminations == 1 && stop.shouldTerminate() == .terminateNow)
        print("Verbatim AppQuit: activation-before-sheet, immediate Cancel, one sheet, default Cancel, stale/missing window and Stop ownership passed; no AppKit foreground claim.")
    }
}
