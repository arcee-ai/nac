#if NATIVE_UI_TESTS
import Foundation
import XCTest
import XCUIAutomation

/// Owned ALL-347 journey, composed by ALL-354's public hosted XCTest runner.
/// The caller owns exact-bundle launch/hash/console checks and engine/profile
/// cleanup. Each input requires its existing exact-target authorization check;
/// there is deliberately no default check or standalone dispatch entrypoint.
@MainActor
enum NativePathJourney {
    static func folderSelection(app: XCUIApplication, initialPath: String, folder: URL,
                                authorize: () throws -> Void) throws {
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
        try require(initialPath.unicodeScalars.allSatisfy(\.isASCII), "Fixture parent must be ASCII for the qualified driver")
        try require(folder.deletingLastPathComponent().path == initialPath,
                    "Selection must be an immediate child of the owned fixture directory")
        let folderButton = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Choose Working Folder")).firstMatch
        let sheet = app.sheets.firstMatch
        let selected = app.webViews.buttons["Choose Working Folder: \(folder.path)"]
        func chooseFolder() throws {
            try click(folderButton)
            try require(sheet.waitForExistence(timeout: 10), "Actual NSOpenPanel did not appear")
            // Public ASCII navigation followed by visible Unicode selection;
            // this does not qualify physical IME composition or paste.
            try authorize()
            sheet.typeKey("g", modifierFlags: [.command, .shift])
            let goTo = app.textFields.matching(NSPredicate(format: "label == %@", "Go to the folder:")).firstMatch
            try require(goTo.waitForExistence(timeout: 10), "System Go to Folder field unavailable")
            try authorize()
            goTo.typeText(initialPath)
            try authorize()
            goTo.typeKey(.return, modifierFlags: [])
            let unicodeFolder = sheet.descendants(matching: .staticText).matching(NSPredicate(format: "label == %@", folder.lastPathComponent)).firstMatch
            try require(unicodeFolder.waitForExistence(timeout: 10), "Unicode fixture folder unavailable in NSOpenPanel")
            try authorize()
            unicodeFolder.doubleClick()
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
        try click(folderButton)
        try require(sheet.waitForExistence(timeout: 10), "Actual NSOpenPanel did not appear")
        try click(sheet.buttons["Cancel"])
        try require(sheet.waitForNonExistence(timeout: 10), "Cancelled native panel survived")
        try require(folderButton.label == original, "Panel cancellation changed the form's folder")
        try click(folderButton)
        try require(sheet.waitForExistence(timeout: 10), "Second NSOpenPanel did not appear")
        try Data("ALL347_RELOAD_REQUEST".utf8).write(to: folder.deletingLastPathComponent()
            .appendingPathComponent("all347-reload-request"), options: .atomic)
        try require(sheet.waitForNonExistence(timeout: 15), "Document replacement retained the old native panel")
        let reloaded = folder.deletingLastPathComponent().appendingPathComponent("all347-reloaded")
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in FileManager.default.fileExists(atPath: reloaded.path) }, object: nil)
        try require(XCTWaiter.wait(for: [ready], timeout: 15) == .completed, "Successor document never activated")
        try require(try String(contentsOf: reloaded, encoding: .utf8) == "ALL347_DOCUMENT_RELOADED", "Unexpected reload receipt")
        try click(project)
        try require(folderButton.waitForExistence(timeout: 10) && folderButton.label == original,
                    "A retired native panel filled the replacement form")
        try chooseFolder()
        let create = app.webViews.buttons["Create Project"]
        try require(create.waitForExistence(timeout: 10) && create.isEnabled,
                    "Fixture must resolve its existing saved model through the normal shared form")
        let moved = folder.deletingLastPathComponent().appendingPathComponent(folder.lastPathComponent + ".moved")
        try FileManager.default.moveItem(at: folder, to: moved)
        var restore = true
        defer { if restore { try? FileManager.default.moveItem(at: moved, to: folder) } }
        try click(create)
        let missing = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", folder.lastPathComponent, "does not exist")).firstMatch
        try require(missing.waitForExistence(timeout: 15), "Moved folder was not rejected by normal server admission")
        try FileManager.default.moveItem(at: moved, to: folder)
        restore = false
        try chooseFolder()
        try click(create)
        try require(composer.waitForExistence(timeout: 30), "Normal project/first-chat creation did not finish")
        try click(app.webViews.buttons["Files"])
        let file = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "reveal me.txt")).firstMatch
        try click(file)
        try click(app.webViews.buttons["Reveal in Finder"])
        // Observe the Finder selection caused by the explicit product action.
        // Never activate or type into another application's windows.
        let finder = XCUIApplication(bundleIdentifier: "com.apple.finder")
        let revealed = finder.windows[folder.lastPathComponent].descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "reveal me.txt"))
        let selection = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            revealed.allElementsBoundByIndex.contains { $0.isSelected }
        }, object: nil)
        try require(XCTWaiter.wait(for: [selection], timeout: 15) == .completed,
                    "Finder did not expose the selected workspace file")
        try Data("ALL347_XCTEST_COMPLETE".utf8).write(to: folder.deletingLastPathComponent()
            .appendingPathComponent("all347-xctest-complete"), options: .atomic)
    }
}
#endif
