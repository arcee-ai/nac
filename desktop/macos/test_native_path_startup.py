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
        func require(_ value: Bool) { precondition(value) }
        func publish(_ app: PreviewApp, _ bridge: NativePathBridge, launch: String = "current") {
            app.nativePaths = bridge; app.baseURL = URL(string: "http://127.0.0.1:1234")
            app.engine.pid = 42; app.engine.receipt = Receipt(incarnation: "current")
            app.commands.binding = Binding(launch: "current")
            bridge.smokeSnapshot = ["installed":true,"ready":true,"launch":launch]
        }
        // start() runs before provider/receipt/bootstrap publishes any bridge.
        let delayed = PreviewApp(), expected = NativePathBridge()
        Task { @MainActor in
            try await Task.sleep(nanoseconds: 20_000_000)
            publish(delayed, expected)
        }
        let acquired = try await NativePathSmoke.awaitBridge(app: delayed, timeout: 0.3)
        require(acquired === expected)
        // An installed stale launch is not sufficient; acquire its current replacement.
        let replacement = PreviewApp(), stale = NativePathBridge(), current = NativePathBridge()
        publish(replacement, stale, launch: "retired")
        Task { @MainActor in
            try await Task.sleep(nanoseconds: 20_000_000)
            publish(replacement, current)
        }
        let replaced = try await NativePathSmoke.awaitBridge(app: replacement, timeout: 0.3)
        require(replaced === current)
        // A published bridge still waits for current-document activation.
        let unpublished = PreviewApp(), pending = NativePathBridge()
        publish(unpublished, pending); pending.smokeSnapshot["ready"] = false
        Task { @MainActor in
            try await Task.sleep(nanoseconds: 20_000_000)
            pending.smokeSnapshot["ready"] = true
        }
        let ready = try await NativePathSmoke.awaitBridge(app: unpublished, timeout: 0.3)
        require(ready === pending)
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
