import AppKit
import CoreGraphics
import Darwin
import notify
import XCTest
import XCUIAutomation

// Runner stays sandboxed. Raw AX and CFEqual live in the external witness ONLY.
@MainActor
final class LifecycleCaptureJourneys: XCTestCase {
    func testCaptureRun() throws { try captureCase("run") }
    func testCaptureApproval() throws { try captureCase("approval") }
    func testCaptureTerminal() throws { try captureCase("terminal") }

    private func captureCase(_ scenario: String) throws {
        continueAfterFailure = false; executionTimeAllowance = 350
        let path = try XCTUnwrap(ProcessInfo.processInfo.environment["NAC_UI_FIXTURE"])
        let configData = try CapturePort.read(URL(fileURLWithPath: path))
        let session = try CapturePort.object(configData), configHash = CapturePort.hash(configData)
        let cases = try XCTUnwrap(session["cases"] as? [String: [String: Any]])
        let config = try XCTUnwrap(cases[scenario])
        let port = URL(fileURLWithPath: try XCTUnwrap(config["port"] as? String))
        let nonce = try XCTUnwrap(config["nonce"] as? String)
        let bundle = try XCTUnwrap(config["bundle_id"] as? String)
        let deadline = try XCTUnwrap(UInt64(try XCTUnwrap(config["deadline_ns"] as? String)))
        let runner = try CapturePort.processRecord()
        var rootToken: String?, helperToken: String?
        var previousSequence: UInt64 = 0
        var total = 0
        var admitted = Set<Int>()
        for ordinal in 1...2 {
            let guardBegin = CapturePort.nanos()
            func proof(after began: UInt64) throws -> [String: Any] {
                let end = min(deadline, CapturePort.nanos() + 30_000_000_000)
                while CapturePort.nanos() < end {
                    try CapturePort.need(!FileManager.default.fileExists(atPath: port.appendingPathComponent("failure.json").path), "Sticky external refusal")
                    try CapturePort.need(CapturePort.hash(CapturePort.read(URL(fileURLWithPath: path))) == configHash, "Configuration changed")
                    let file = port.appendingPathComponent("proof-\(ordinal).json")
                    if !FileManager.default.fileExists(atPath: file.path) {
                        try CapturePort.need(!admitted.contains(ordinal), "Admitted witness port disappeared")
                        Thread.sleep(forTimeInterval: 0.02); continue
                    }
                    let value = try CapturePort.object(CapturePort.read(file))
                    admitted.insert(ordinal)
                    try CapturePort.need(value["status"] as? String == "ready", "Witness refused/retired")
                    try CapturePort.need(value["nonce"] as? String == nonce
                        && value["configuration_sha256"] as? String == configHash
                        && value["ordinal"] as? Int == ordinal, "Witness scope")
                    let start = try XCTUnwrap(UInt64(try XCTUnwrap(value["began_ns"] as? String)))
                    let finish = try XCTUnwrap(UInt64(try XCTUnwrap(value["ended_ns"] as? String)))
                    let sequence = try XCTUnwrap(UInt64(try XCTUnwrap(value["sequence"] as? String)))
                    let now = CapturePort.nanos()
                    try CapturePort.need(finish >= start && finish - start <= 1_000_000_000
                        && now >= finish && now - finish <= 1_000_000_000, "Witness freshness")
                    if start < began || sequence <= previousSequence { Thread.sleep(forTimeInterval: 0.02); continue }
                    let root = try XCTUnwrap(value["root_token"] as? String)
                    let helper = try XCTUnwrap(value["helper_token"] as? String)
                    try CapturePort.need(rootToken == nil || rootToken == root, "Root identity rebound")
                    try CapturePort.need(helperToken == nil || helperToken == helper, "Witness identity rebound")
                    rootToken = root; helperToken = helper; previousSequence = sequence
                    return value
                }
                throw NSError(domain: "LifecycleCapture", code: 4,
                              userInfo: [NSLocalizedDescriptionKey: "Original proof deadline"])
            }
            let before = try proof(after: guardBegin)
            let owner = try XCTUnwrap(before["owner"] as? [String: Any])
            let pid = try XCTUnwrap(owner["app_pid"] as? Int)
            let running = try XCTUnwrap(NSRunningApplication(processIdentifier: pid_t(pid)))
            let launch = try XCTUnwrap(running.launchDate)
            let appPath = try XCTUnwrap(before["app_path"] as? String)
            let rootFrame = try CapturePort.frame(before["root_frame"])
            let sheetFrame = try CapturePort.frame(before["sheet_frame"])
            let ui = XCUIApplication(bundleIdentifier: bundle)
            func guardPublic() throws {
                try CapturePort.need(!running.isTerminated && running.launchDate == launch
                    && running.bundleURL?.path == appPath && running.bundleIdentifier == bundle
                    && NSWorkspace.shared.frontmostApplication?.processIdentifier == pid_t(pid), "App incarnation/front")
                try CapturePort.need(NSScreen.screens.count == 1, "Exactly one admitted display")
                let roots = ui.windows.allElementsBoundByAccessibilityElement.filter { $0.exists && $0.frame == rootFrame }
                try CapturePort.need(roots.count == 1, "Unique exact workspace query")
                let sheets = roots[0].children(matching: .sheet).allElementsBoundByAccessibilityElement
                try CapturePort.need(sheets.count == 1 && sheets[0].exists && sheets[0].frame == sheetFrame, "Exact attached sheet")
                for title in ["Cancel", "Stop and Quit"] {
                    let buttons = sheets[0].buttons.matching(NSPredicate(format: "label == %@", title)).allElementsBoundByAccessibilityElement
                    try CapturePort.need(buttons.count == 1 && buttons[0].isEnabled && buttons[0].isHittable,
                                         "Unique public sheet control")
                }
            }
            try guardPublic()
            let captureBegan = CapturePort.nanos()
            let image = XCUIScreen.main.screenshot().pngRepresentation
            try CapturePort.need(!image.isEmpty && image.count <= 2 * 1024 * 1024
                && total + image.count <= 4 * 1024 * 1024, "Original screenshot limits")
            total += image.count
            try guardPublic()
            let captureEnded = CapturePort.nanos()
            try CapturePort.need(captureEnded > captureBegan && captureEnded - captureBegan <= 10_000_000_000, "Capture duration")
            let after = try proof(after: captureEnded)
            for key in ["request_sha256", "root_token", "sheet_token", "cancel_token", "stop_token", "owner", "root_frame", "sheet_frame", "cancel_frame", "stop_frame"] {
                let left = try JSONSerialization.data(withJSONObject: [before[key] ?? NSNull()], options: [.sortedKeys])
                let right = try JSONSerialization.data(withJSONObject: [after[key] ?? NSNull()], options: [.sortedKeys])
                try CapturePort.need(left == right, "Owner/phase changed across screen capture")
            }
            let png = XCTAttachment(data: image, uniformTypeIdentifier: "public.png")
            png.name = "lifecycle-screen-\(ordinal)"; png.lifetime = .keepAlways; add(png)
            let metadata: [String: Any] = ["schema": "lifecycle-screen-v1", "ordinal": ordinal,
                "configuration_sha256": configHash, "nonce": nonce,
                "request_sha256": before["request_sha256"]!, "before": before, "after": after,
                "png_sha256": CapturePort.hash(image), "png_bytes": image.count,
                "capture_method": "public-XCTest-main-screen", "new_input_actions": 0,
                "manual_visual_acceptance": false, "runner": runner,
                "capture_began_ns": String(captureBegan), "capture_ended_ns": String(captureEnded)]
            let data = try JSONSerialization.data(withJSONObject: metadata, options: [.sortedKeys])
            try CapturePort.need(data.count <= 64 * 1024, "Metadata limit")
            let record = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
            record.name = "lifecycle-caption-\(ordinal)"; record.lifetime = .keepAlways; add(record)
            // A hint permits only provisional scheduling, never PNG acceptance.
            try CapturePort.need(("nac.lifecycle." + nonce + ".done.\(ordinal)").withCString { notify_post($0) } == 0,
                                 "Notification unavailable")
        }
    }
}
