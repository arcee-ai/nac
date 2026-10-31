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
            try authorize()
            element.click()
        }
        let project = app.webViews.buttons["New Project"]
        try click(project)
        let folderButton = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Choose Working Folder")).firstMatch
        try require(folderButton.waitForExistence(timeout: 10), "Normal create-project form unavailable")
        let original = folderButton.label
        try click(folderButton)
        let sheet = app.sheets.firstMatch
        try require(sheet.waitForExistence(timeout: 10), "Actual NSOpenPanel did not appear")
        try click(sheet.buttons["Cancel"])
        try require(sheet.waitForNonExistence(timeout: 10), "Cancelled native panel survived")
        try require(folderButton.label == original, "Panel cancellation changed the form's folder")
        try click(folderButton)
        try require(sheet.waitForExistence(timeout: 10), "Second NSOpenPanel did not appear")
        // Navigate to the disposable ASCII parent with Apple's public input
        // API, then select the Unicode/spaces directory by its visible name.
        // This proves Unicode path selection, not physical IME composition.
        try require(initialPath.unicodeScalars.allSatisfy(\.isASCII), "Fixture parent must be ASCII for the qualified driver")
        try require(folder.deletingLastPathComponent().path == initialPath,
                    "Selection must be an immediate child of the owned fixture directory")
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
        let selected = app.webViews.buttons["Choose Working Folder: \(folder.path)"]
        try require(selected.waitForExistence(timeout: 10), "Selected path did not reach the normal create-project form")
        let create = app.webViews.buttons["Create Project"]
        try require(create.waitForExistence(timeout: 10) && create.isEnabled,
                    "Fixture must resolve its existing saved model through the normal shared form")
        try click(create)
        let composer = app.webViews.descendants(matching: .any).matching(identifier: "Message").firstMatch
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
