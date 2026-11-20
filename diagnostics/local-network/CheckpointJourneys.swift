// Diagnostic Q-prime. No UI input, TCC request or qualification authority.
import Foundation
import Vision
import XCTest
import XCUIAutomation

final class CheckpointJourneys: XCTestCase {
    func testSnapshot() throws { try snapshot(positive: false) }
    func testPositiveControl() throws { try snapshot(positive: true) }

    private func snapshot(positive: Bool) throws {
        guard let path = ProcessInfo.processInfo.environment["NAC_UI_FIXTURE"],
              path.hasPrefix("/") else { throw NSError(domain: "fixture", code: 1) }
        let app = XCUIApplication(url: URL(fileURLWithPath: path))
        if positive { app.launchArguments = ["--positive-control"] }
        app.launch()
        defer { app.terminate() }
        guard app.windows.firstMatch.waitForExistence(timeout: 15) else {
            throw NSError(domain: "fixture", code: 2)
        }
        let data = app.windows.firstMatch.screenshot().pngRepresentation
        guard data.count > 0 && data.count <= 8 * 1024 * 1024 else {
            throw NSError(domain: "image", code: 1)
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["en-US"]
        try VNImageRequestHandler(data: data).perform([request])
        let rows = (request.results ?? []).prefix(512).compactMap { $0.topCandidates(1).first?.string }
        var matched = false
        for i in rows.indices {
            for j in i..<min(i + 3, rows.count) {
                let value = rows[i...j].joined(separator: " ")
                    .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
                    .replacingOccurrences(of: "“", with: "\"")
                    .replacingOccurrences(of: "”", with: "\"")
                let title = "Allow \"Python\" to find devices on local networks?"
                if value == (positive ? "CONTROL " + title : title) { matched = true }
            }
        }
        // The image and OCR strings remain private inside the disposable host.
        let result = matched ? "ocr_title_match" : "unknown"
        let attachment = XCTAttachment(data: Data(result.utf8), uniformTypeIdentifier: "public.plain-text")
        attachment.name = "nac-local-network-checkpoint-v1"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
