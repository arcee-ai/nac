// Headless fault ports around the verbatim snapshot method; no WK/AppKit claim.
import Foundation
import CryptoKit

enum PreviewError: Error { case message(String) }
final class WKSnapshotConfiguration { var afterScreenUpdates = false }
@MainActor enum Fault { static var value = "" }
@MainActor struct Image {
    var tiffRepresentation: Data? { Fault.value == "tiff" ? nil : Data([1]) }
}
@MainActor struct NSBitmapImageRep {
    init?(data: Data) { if Fault.value == "bitmap" { return nil } }
    enum FileType { case png }
    func representation(using: FileType, properties: [String: String]) -> Data? {
        Fault.value == "png" ? nil : Data([1, 2, 3])
    }
    let pixelsWide = 100
    let pixelsHigh = 100
}
@MainActor final class Window {
    struct Occlusion: OptionSet { let rawValue: Int; static let visible = Self(rawValue: 1) }
    var isVisible = true
    let occlusionState: Occlusion = .visible
}
@MainActor final class WebView {
    let window: Window
    init(_ window: Window) { self.window = window }
    func takeSnapshot(configuration: WKSnapshotConfiguration) async throws -> Image {
        precondition(configuration.afterScreenUpdates)
        if Fault.value == "snapshot" { throw PreviewError.message("snapshot") }
        if Fault.value == "surface-after" { window.isVisible = false }
        return Image()
    }
}
@MainActor final class App {
    let window = Window()
    lazy var webView = WebView(window)
    let failure: String? = nil
}
@MainActor final class WorkspaceSmoke {
    enum CaptureTarget { case transcript; case rich(id: String, markdown: String) }
    let app = App()
    var checks: [String: [String: Any]] = [:]
    var paintDiagnostics: [String: Any] = [:]
    var records: [[String: Any]] = []
    var reads = 0
    let output: URL
    let scenario = "test"
    init(_ output: URL) { self.output = output }
    func quote(_ text: String) -> String { "\"" + text + "\"" }
    func record(_ value: [String: Any]) { records.append(value) }
    func captureReadiness(_ target: CaptureTarget) async throws -> [String: Any] {
        reads += 1
        if Fault.value == "read-before" && reads == 1 || Fault.value == "read-after" && reads == 3 {
            throw PreviewError.message("readiness")
        }
        return ["ready": !(Fault.value == "not-ready-after" && reads == 3),
                "message_identity": ["id": Fault.value == "identity-after" && reads == 3 ? "changed" : "same"],
                "full_answer": Fault.value == "answer-after" && reads == 3 ? "changed" : "answer"]
    }
    func js(_ script: String) async throws -> Any {
        if Fault.value == "js" { throw PreviewError.message("js") }
        if script.contains("return {visibility:") { return ["visibility": "visible", "loadingConversation": false] }
        return true
    }
    // SNAPSHOT_METHOD
}

@main struct SnapshotControls {
    @MainActor static func main() async throws {
        let name = CommandLine.arguments[1]
        Fault.value = name.replacingOccurrences(of: "diagnostic-", with: "")
        let directory = Bundle.main.resourceURL!
        let source = directory.appendingPathComponent("workspace-build.json")
        let metadata: [String: Any] = ["source_status": name == "source-dirty" ? "dirty" : "",
            "source_head": "owned", "engine_sha256": "engine", "native_sha256": "native"]
        if name == "source-missing" { try? FileManager.default.removeItem(at: source) }
        else { try JSONSerialization.data(withJSONObject: metadata).write(to: source) }
        let output = name == "write" || name == "diagnostic-write" ? directory.appendingPathComponent("missing") : directory
        let smoke = WorkspaceSmoke(output)
        let diagnostic = name.hasPrefix("diagnostic-")
        if name == "prior-pass-failure" { Fault.value = "snapshot" }
        if name == "prior-pass-failure" || diagnostic { smoke.checks["visible-paint"] = ["status": "pass", "detail": "prior"] }
        if name == "sticky-unavailable" { smoke.checks["visible-paint"] = ["status": "unavailable"] }
        var failed = false
        do { try await smoke.snapshot("capture.png", expecting: diagnostic ? nil : .rich(id: "owned", markdown: "answer")) }
        catch { failed = true }
        let success = ["success", "sticky-unavailable", "diagnostic-success"].contains(name)
        precondition(failed != success, "unexpected throw outcome \(name)")
        let expected = diagnostic ? "pass" : success && name != "sticky-unavailable" ? "pass" : "unavailable"
        precondition(smoke.checks["visible-paint"]?["status"] as? String == expected, "wrong final paint \(name)")
        if !diagnostic && !success {
            precondition((smoke.records.last?["checks"] as? [String: [String: Any]])?["visible-paint"]?["status"] as? String == "unavailable")
        }
        if !diagnostic && name != "prior-pass-failure" {
            let passing = smoke.records.filter { ($0["checks"] as? [String: [String: Any]])?["visible-paint"]?["status"] as? String == "pass" }
            precondition(passing.count == (name == "success" ? 1 : 0), "premature paint pass \(name)")
        }
        print("PASS verbatim snapshot control: \(name)")
    }
}
