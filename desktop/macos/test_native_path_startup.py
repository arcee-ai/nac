"""Compile the actual startup wait against controlled publication; no app/UI launch."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]

class NativePathStartupTests(unittest.TestCase):
    def test_actual_startup_wait(self):
        source = (ROOT / 'desktop/macos/NativePathSmoke.swift').read_text()
        start = source.index('    static func awaitBridge(')
        opening = source.index('async throws -> NativePathBridge {', start) + len('async throws -> NativePathBridge ')
        end, depth = opening + 1, 1
        while depth:
            depth += (source[end] == '{') - (source[end] == '}')
            end += 1
        method = source[start:end]
        dispatch = (ROOT / 'desktop/macos/PreviewSmoke.swift').read_text()
        self.assertIn('let paths = try await NativePathSmoke.awaitBridge(app: app)', dispatch)
        harness = r'''
import Foundation
struct Binding { let launch: String }
struct Receipt { let incarnation: String }
class Engine { var pid = 0; var receipt: Receipt? }
class Commands { var binding: Binding?; func currentDocument(in view: Int) -> Binding? { binding } }
class NativePathBridge { var smokeSnapshot: [String: Any] = [:] }
class PreviewApp {
    var nativePaths: NativePathBridge?; var failure: String?; var stopping = false
    var baseURL: URL?; let engine = Engine(); let commands = Commands(); let webView = 0
}
enum PreviewError: Error { case message(String) }
@MainActor enum NativePathSmoke {
METHOD
}
@main struct Main {
    @MainActor static func main() async throws {
        func require(_ value: Bool, _ message: String = "Native path startup control failed") {
            precondition(value, message)
        }
        func publish(_ app: PreviewApp, _ bridge: NativePathBridge, launch: String = "current") {
            app.nativePaths = bridge; app.baseURL = URL(string: "http://127.0.0.1:1234")
            app.engine.pid = 42; app.engine.receipt = Receipt(incarnation: "current")
            app.commands.binding = Binding(launch: "current")
            bridge.smokeSnapshot = ["installed":true,"ready":true,"launch":launch]
        }
        // start() runs before provider/receipt/bootstrap publishes any bridge.
        let delayed = PreviewApp(), expected = NativePathBridge()
        require(delayed.nativePaths == nil, "publication: initial bridge must be missing")
        var publicationProgress = 0
        let publicationStarted = ProcessInfo.processInfo.systemUptime
        do {
            let acquired = try await NativePathSmoke.awaitBridge(app: delayed, timeout: 5) {
                publicationProgress += 1
                if publicationProgress == 2 { publish(delayed, expected) }
            }
            require(publicationProgress == 2 && ProcessInfo.processInfo.systemUptime - publicationStarted >= 0.05,
                    "publication: must cross the original polling suspension")
            require(acquired === expected, "publication: must acquire the current bridge")
        } catch {
            preconditionFailure("publication: \(error)")
        }
        // An installed stale launch is not sufficient; acquire its current replacement.
        let replacement = PreviewApp(), stale = NativePathBridge(), current = NativePathBridge()
        publish(replacement, stale, launch: "retired")
        require(replacement.nativePaths === stale && stale.smokeSnapshot["launch"] as? String == "retired",
                "replacement: initial bridge must be stale")
        var replacementProgress = 0
        let replacementStarted = ProcessInfo.processInfo.systemUptime
        do {
            let replaced = try await NativePathSmoke.awaitBridge(app: replacement, timeout: 5) {
                replacementProgress += 1
                if replacementProgress == 2 { publish(replacement, current) }
            }
            require(replacementProgress == 2 && ProcessInfo.processInfo.systemUptime - replacementStarted >= 0.05,
                    "replacement: must cross the original polling suspension")
            require(replaced === current, "replacement: must acquire the current bridge")
        } catch {
            preconditionFailure("replacement: \(error)")
        }
        // A published bridge still waits for current-document activation.
        let unpublished = PreviewApp(), pending = NativePathBridge()
        publish(unpublished, pending); pending.smokeSnapshot["ready"] = false
        require(pending.smokeSnapshot["ready"] as? Bool == false, "readiness: initial bridge must not be ready")
        var readinessProgress = 0
        let readinessStarted = ProcessInfo.processInfo.systemUptime
        do {
            let ready = try await NativePathSmoke.awaitBridge(app: unpublished, timeout: 5) {
                readinessProgress += 1
                if readinessProgress == 2 { pending.smokeSnapshot["ready"] = true }
            }
            require(readinessProgress == 2 && ProcessInfo.processInfo.systemUptime - readinessStarted >= 0.05,
                    "readiness: must cross the original polling suspension")
            require(ready === pending, "readiness: must acquire the current bridge")
        } catch {
            preconditionFailure("readiness: \(error)")
        }
        for kind in ["missing", "stale", "retired", "document", "stopping", "failure", "cancel"] {
            let app = PreviewApp(), bridge = NativePathBridge()
            if kind != "missing" { publish(app, bridge) }
            switch kind {
            case "stale": bridge.smokeSnapshot["launch"] = "retired"
            case "retired": bridge.smokeSnapshot["installed"] = false
            case "document": app.commands.binding = Binding(launch: "old")
            case "stopping": app.stopping = true
            case "failure": app.failure = "actual startup failed"
            default: break
            }
            let task = Task { @MainActor in try await NativePathSmoke.awaitBridge(app: app, timeout: 0.04) }
            if kind == "cancel" { task.cancel() }
            do { _ = try await task.value; preconditionFailure("accepted " + kind) }
            catch {
                if kind == "failure" { require(String(describing:error).contains("actual startup failed")) }
                if kind == "cancel" || kind == "stopping" { require(error is CancellationError) }
                if ["missing","stale","retired","document"].contains(kind) {
                    require(String(describing:error).contains("Timed out"))
                }
            }
        }
        print("PASS: delayed publication, readiness, stale/replacement launch, retirement, document, failure, timeout, cancellation")
    }
}
'''.replace('METHOD', method)
        with tempfile.TemporaryDirectory(prefix='nac347-startup-controls-') as temp:
            path = Path(temp) / 'StartupControls.swift'
            binary = Path(temp) / 'startup-controls'
            path.write_text(harness)
            subprocess.run(['xcrun', 'swiftc', '-parse-as-library', '-swift-version', '5', str(path), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True)

if __name__ == '__main__':
    unittest.main()
