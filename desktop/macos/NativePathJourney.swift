#if NATIVE_UI_TESTS
import Foundation
import XCTest
import XCUIAutomation

/// Owned ALL-347 journey, composed by ALL-354's public hosted XCTest runner.
/// The caller owns exact-bundle launch/hash/console checks and engine/profile
/// cleanup. Each input requires its existing exact-target authorization check;
/// there is deliberately no default check or standalone dispatch entrypoint.
/// All coordination reads use the mandatory H-owned observer of its known app
/// evidence file. This helper writes no sidecars and never reads/moves profiles.
@MainActor
enum NativePathJourney {
    /// H must build this from its exact source/app/launch and known evidence-file
    /// binding, not trust a newly discovered path or merely echo an unverified record.
    struct Scope: Decodable {
        let run: String
        let source: String
        let app_pid: Int
        let window: Int
        let engine_pid: Int
        let operation: String
        let launch: String
        let view: String
        let document: String
    }
    enum PhaseName: String, Decodable {
        case ready
        case documentReloaded = "document-reloaded"
        case folderMoved = "folder-moved"
        case folderRestored = "folder-restored"
        case revealObserved = "reveal-observed"
        case failurePanelObserved = "failure-panel-observed"
    }
    struct Phase: Decodable, Equatable {
        let version: Int
        let name: PhaseName
        let sequence: Int
        let run: String
        let source: String
        let app_pid: Int
        let window: Int
        let engine_pid: Int
        let operation: String
        let launch: String
        let view: String
        let document: String
    }
    private final class PhaseCursor {
        let scope: Scope
        private var latest: Phase?
        init(_ scope: Scope) { self.scope = scope }
        func accept(_ phase: Phase) throws -> PhaseName {
            let order: [PhaseName]
            switch scope.operation {
            case "pending-engine-failure": order = [.ready, .failurePanelObserved]
            case "select-reload-create-reveal": order = [.ready, .documentReloaded, .folderMoved, .folderRestored, .revealObserved]
            default: throw error("Unknown fixture operation")
            }
            guard phase.version == 1, phase.run == scope.run, phase.source == scope.source,
                  phase.app_pid == scope.app_pid, phase.window == scope.window, phase.engine_pid == scope.engine_pid,
                  phase.operation == scope.operation, phase.launch == scope.launch, phase.view == scope.view,
                  order.indices.contains(phase.sequence), order[phase.sequence] == phase.name else {
                throw error("Fixture phase source/app/launch binding or finite order mismatch")
            }
            if let latest, phase.sequence == latest.sequence {
                guard phase == latest else { throw error("Fixture phase changed without advancing") }
                return phase.name // Re-reading one atomic record is not another transition.
            }
            guard phase.sequence == (latest?.sequence ?? -1) + 1 else {
                throw error("Stale or skipped fixture phase")
            }
            if phase.name == .documentReloaded {
                guard UUID(uuidString: phase.document) != nil, phase.document != scope.document else {
                    throw error("Reload did not replace the exact initial document")
                }
            } else {
                guard phase.document == (latest?.document ?? scope.document) else {
                    throw error("Fixture phase belongs to another document")
                }
            }
            latest = phase
            return phase.name
        }
        func wait(_ expected: PhaseName, observe: @escaping () throws -> Phase) throws {
            var failure: Error?
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                do { return try self.accept(observe()) == expected }
                catch { failure = error; return true }
            }, object: nil)
            let result = XCTWaiter.wait(for: [ready], timeout: 30)
            if let failure { throw failure }
            guard result == .completed else { throw error("Missing app-owned phase: \(expected.rawValue)") }
        }
        private func error(_ text: String) -> Error {
            NSError(domain: "NAC347Phase", code: 1, userInfo: [NSLocalizedDescriptionKey: text])
        }
    }
    private static func validate(_ scope: Scope, initialPath: String, folder: URL, operation: String) throws {
        guard scope.operation == operation, scope.source.count == 40,
              scope.source.allSatisfy({ "0123456789abcdef".contains($0) }),
              scope.app_pid > 0, scope.window > 0, scope.engine_pid > 0,
              [scope.run, scope.launch, scope.view, scope.document].allSatisfy({ UUID(uuidString: $0) != nil }),
              scope.run == scope.run.lowercased(), initialPath.unicodeScalars.allSatisfy(\.isASCII),
              folder.deletingLastPathComponent().path == initialPath,
              folder.lastPathComponent == "Folder with spaces 日本語 \(scope.run)" else {
            throw NSError(domain: "NAC347Scope", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unverified fixture scope/path contract"])
        }
    }
    private static func navigatePanel(app: XCUIApplication, sheet: XCUIElement, initialPath: String, folder: URL,
                                      authorize: () throws -> Void) throws {
        try authorize()
        sheet.typeKey("g", modifierFlags: [.command, .shift])
        let goTo = app.textFields.matching(NSPredicate(format: "label == %@", "Go to the folder:")).firstMatch
        guard goTo.waitForExistence(timeout: 10) else { throw NSError(domain: "NAC347UI", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "System Go to Folder field unavailable"]) }
        try authorize()
        goTo.typeText(initialPath)
        try authorize()
        goTo.typeKey(.return, modifierFlags: [])
        let unicodeFolder = sheet.descendants(matching: .staticText)
            .matching(NSPredicate(format: "label == %@", folder.lastPathComponent)).firstMatch
        guard unicodeFolder.waitForExistence(timeout: 10) else { throw NSError(domain: "NAC347UI", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Unique Unicode fixture folder unavailable in NSOpenPanel"]) }
        try authorize()
        unicodeFolder.doubleClick()
    }
    static func folderSelection(app: XCUIApplication, initialPath: String, folder: URL,
                                scope: Scope, revealLeaf: String,
                                observePhase: @escaping () throws -> Phase, authorize: () throws -> Void) throws {
        func require(_ condition: Bool, _ message: String) throws {
            guard condition else { throw NSError(domain: "NAC347UI", code: 1,
                userInfo: [NSLocalizedDescriptionKey: message]) }
        }
        func click(_ element: XCUIElement) throws {
            try require(element.waitForExistence(timeout: 10), "Expected native/UI control unavailable")
            let enabled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in element.isEnabled }, object: nil)
            try require(XCTWaiter.wait(for: [enabled], timeout: 10) == .completed, "Expected UI control stayed disabled")
            try authorize()
            element.click()
        }
        try validate(scope, initialPath: initialPath, folder: folder, operation: "select-reload-create-reveal")
        let runID = scope.run
        try require(revealLeaf == "reveal me 日本語 \(runID)", "Reveal leaf does not belong to this run")
        let phases = PhaseCursor(scope)
        try phases.wait(.ready, observe: observePhase)
        let folderButton = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Choose Working Folder")).firstMatch
        let sheet = app.sheets.firstMatch
        let selected = app.webViews.buttons["Choose Working Folder: \(folder.path)"]
        func chooseFolder() throws {
            try click(folderButton)
            try require(sheet.waitForExistence(timeout: 10), "Actual NSOpenPanel did not appear")
            // ASCII navigation followed by visible Unicode selection does not
            // qualify physical IME composition or paste.
            try navigatePanel(app: app, sheet: sheet, initialPath: initialPath, folder: folder, authorize: authorize)
            try click(sheet.buttons["Select"])
            try require(sheet.waitForNonExistence(timeout: 10), "Selected native panel survived")
            try require(selected.waitForExistence(timeout: 10), "Selected path did not reach the normal create-project form")
        }
        // The disposable preview starts in its seeded project's normal first-
        // chat form. Finish that UI before opening another project.
        try click(app.webViews.buttons["Create chat"])
        let composer = app.webViews.descendants(matching: .any).matching(identifier: "Message").firstMatch
        try require(composer.waitForExistence(timeout: 30), "Initial fixture chat did not open")
        let project = app.webViews.buttons["New Project"]
        try click(project)
        try require(folderButton.waitForExistence(timeout: 10), "Normal create-project form unavailable")
        let original = folderButton.label
        try click(app.webViews.buttons["SSH"])
        try require(!folderButton.exists && app.sheets.count == 0,
                    "Unconnected SSH exposed a native Local folder picker")
        try click(app.webViews.buttons["Sandbox"])
        try click(folderButton)
        let parentDirectory = app.webViews.buttons["Parent directory"]
        try require(parentDirectory.waitForExistence(timeout: 10) && app.sheets.count == 0,
                    "Podman browsing did not retain the shared API picker")
        try click(app.webViews.buttons["Cancel"])
        try require(parentDirectory.waitForNonExistence(timeout: 10), "Shared API picker did not close")
        try click(app.webViews.buttons["Local"])
        try click(folderButton)
        try require(sheet.waitForExistence(timeout: 10), "Actual NSOpenPanel did not appear")
        try click(sheet.buttons["Cancel"])
        try require(sheet.waitForNonExistence(timeout: 10), "Cancelled native panel survived")
        try require(folderButton.label == original, "Panel cancellation changed the form's folder")
        try click(folderButton)
        try require(sheet.waitForExistence(timeout: 10), "Second NSOpenPanel did not appear")
        try navigatePanel(app: app, sheet: sheet, initialPath: initialPath, folder: folder, authorize: authorize)
        try require(sheet.waitForNonExistence(timeout: 15), "Document replacement retained the old native panel")
        try phases.wait(.documentReloaded, observe: observePhase)
        try click(project)
        try require(folderButton.waitForExistence(timeout: 10) && folderButton.label == original,
                    "A retired native panel filled the replacement form")
        try chooseFolder()
        let create = app.webViews.buttons["Create Project"]
        try require(create.waitForExistence(timeout: 10) && create.isEnabled,
                    "Fixture must resolve its existing saved model through the normal shared form")
        try phases.wait(.folderMoved, observe: observePhase)
        try click(create)
        let missing = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", folder.lastPathComponent, "does not exist")).firstMatch
        try require(missing.waitForExistence(timeout: 15), "Moved folder was not rejected by normal server admission")
        try phases.wait(.folderRestored, observe: observePhase)
        try chooseFolder()
        try click(create)
        try require(composer.waitForExistence(timeout: 30), "Normal project/first-chat creation did not finish")
        try click(app.webViews.buttons["Files"])
        let file = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", revealLeaf)).firstMatch
        try click(file)
        let finder = XCUIApplication(bundleIdentifier: "com.apple.finder")
        let baseline = finderWindows(finder, folder: folder.lastPathComponent, leaf: revealLeaf)
        attachFinder("Finder before explicit reveal", runID: runID, folder: folder.path, leaf: revealLeaf, windows: baseline)
        try require(baseline.allSatisfy { !$0.ownedTitle && $0.leafCount == 0 },
                    "Fresh Finder target already existed before this action")
        try click(app.webViews.buttons["Reveal in Finder"])
        try phases.wait(.revealObserved, observe: observePhase) // Read-only; never restores NAC focus.
        // Read-only public XCTest observation. The fresh nonce was absent from
        // every baseline window; exactly one newly titled window must now
        // expose this action's exact unique selected leaf. No later NAC input
        // is sent after Finder can take focus.
        let selection = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let observed = finderWindows(finder, folder: folder.lastPathComponent, leaf: revealLeaf)
            return observed.filter { $0.ownedTitle }.count == 1 &&
                observed.filter { $0.ownedTitle && $0.selectedLeafCount > 0 }.count == 1 &&
                observed.filter { $0.leafCount > 0 }.count == 1
        }, object: nil)
        let result = XCTWaiter.wait(for: [selection], timeout: 15)
        let after = finderWindows(finder, folder: folder.lastPathComponent, leaf: revealLeaf)
        attachFinder("Finder after explicit reveal", runID: runID, folder: folder.path, leaf: revealLeaf, windows: after)
        try require(result == .completed, "Finder did not expose this action's unique selected workspace file")
        // These public attributes bind the newly observed content to this
        // action, but do not establish a stable OS window identity or closing
        // authority. Preserve the residual instead of closing personal windows
        // or claiming complete desktop cleanup.
        XCTContext.runActivity(named: "Finder cleanup residual") { activity in
            let evidence = XCTAttachment(string: "Unique revealed Finder window left open; exact OS window identity and guarded close authority are unqualified. Engine/profile cleanup is separate. No Finder activation, input or preference changes performed.")
            evidence.lifetime = .keepAlways
            activity.add(evidence)
        }
    }

    private struct FinderWindow: Codable {
        let index: Int
        let identifier: String
        let ownedTitle: Bool
        let leafCount: Int
        let selectedLeafCount: Int
        let x: Double
        let y: Double
        let width: Double
        let height: Double
    }

    private struct FinderObservation: Codable {
        let runID: String
        let folder: String
        let leaf: String
        let windows: [FinderWindow]
    }

    private static func finderWindows(_ finder: XCUIApplication, folder: String, leaf: String) -> [FinderWindow] {
        finder.windows.allElementsBoundByIndex.enumerated().map { index, window in
            let leaves = window.descendants(matching: .any)
                .matching(NSPredicate(format: "label == %@", leaf)).allElementsBoundByIndex
            let frame = window.frame
            return FinderWindow(index: index, identifier: window.identifier,
                                ownedTitle: window.label == folder,
                                leafCount: leaves.count, selectedLeafCount: leaves.filter(\.isSelected).count,
                                x: Double(frame.origin.x), y: Double(frame.origin.y),
                                width: Double(frame.width), height: Double(frame.height))
        }
    }

    private static func attachFinder(_ name: String, runID: String, folder: String, leaf: String, windows: [FinderWindow]) {
        XCTContext.runActivity(named: name) { activity in
            do {
                let data = try JSONEncoder().encode(FinderObservation(runID: runID, folder: folder, leaf: leaf, windows: windows))
                let evidence = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                evidence.lifetime = .keepAlways
                activity.add(evidence)
            } catch {
                XCTFail("Could not encode Finder ownership observation: \(error)")
            }
        }
    }

    static func pendingEngineFailure(app: XCUIApplication, initialPath: String, folder: URL, scope: Scope,
                                     observePhase: @escaping () throws -> Phase, authorize: () throws -> Void) throws {
        func require(_ condition: Bool, _ message: String) throws {
            guard condition else { throw NSError(domain: "NAC347UI", code: 1,
                userInfo: [NSLocalizedDescriptionKey: message]) }
        }
        func click(_ element: XCUIElement) throws {
            try require(element.waitForExistence(timeout: 10), "Expected failure-journey control unavailable")
            let enabled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in element.isEnabled }, object: nil)
            try require(XCTWaiter.wait(for: [enabled], timeout: 10) == .completed, "Failure-journey control stayed disabled")
            try authorize()
            element.click()
        }
        try validate(scope, initialPath: initialPath, folder: folder, operation: "pending-engine-failure")
        let phases = PhaseCursor(scope)
        try phases.wait(.ready, observe: observePhase)
        try click(app.webViews.buttons["Create chat"])
        let composer = app.webViews.descendants(matching: .any).matching(identifier: "Message").firstMatch
        try require(composer.waitForExistence(timeout: 30), "Initial failure fixture chat did not open")
        try click(app.webViews.buttons["New Project"])
        try click(app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Choose Working Folder")).firstMatch)
        let sheet = app.sheets.firstMatch
        try require(sheet.waitForExistence(timeout: 10), "Failure test did not open an actual NSOpenPanel")
        try navigatePanel(app: app, sheet: sheet, initialPath: initialPath, folder: folder, authorize: authorize)
        try phases.wait(.failurePanelObserved, observe: observePhase)
        try require(sheet.waitForNonExistence(timeout: 15), "Engine failure retained its native sheet")
        // The caller waits for the app's standard shutdown and verifies the
        // real failure/retirement/engine-reaped/profile-removed evidence.
    }
}
#endif
