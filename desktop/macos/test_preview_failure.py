"""Compile the actual common failure funnel with inert UI/engine boundaries."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


PORTS = r'''
import Foundation
struct Receipt { let kind: String }
final class Engine {
    var pid: Int32 = 17
    var receipt: Receipt? = Receipt(kind: "ready")
    var stops = 0
    let log = "inert"
    func stop(completion: () -> Void) { stops += 1; pid = 0; receipt = nil; completion() }
}
final class Port {
    var retired = false
    var isHidden = false
    var isEnabled = true
    var stringValue = ""
    var stops = 0
    func retire() { retired = true }
    func stopLoading() {}
    func stop() { stops += 1 }
    func cancelPending() {}
    func cancel() {}
    func suspend() {}
}
struct Configuration { let store = URL(fileURLWithPath: "/inert/store") }
struct Selection { let task = Port() }
final class Quit {
    var launch: UUID? = UUID()
    var exits = 0
    func childExited(_ id: UUID) { exits += 1 }
}
final class PreviewApp {
    var stopping = false
    var failure: String?
    var failedViewRetainedEngine = false
    let engine = Engine()
    var commands: Port! = Port()
    var webView: Port! = Port()
    let status = Port()
    let provider = Port()
    let quit = Quit()
    var storeRetryButton: Port? = Port()
    var launchConfiguration: Configuration? = Configuration()
    // Later layers add these independent retirement owners to the same funnel.
    let recovery = Port()
    var workspaceStorageSelection: Selection?
    var nativePaths: Port?
    var attention: Port?
    func deliver(_ message: String) { fail(message) }
'''

CONTROLS = r'''
}
func check(_ value: Bool, _ message: String) {
    if !value { fputs(message + "\n", stderr); exit(1) }
}
@main struct Controls {
    static func main() {
        #if LOCAL_APP
        let app = PreviewApp()
        app.deliver("renderer failed while hidden")
        check(app.engine.stops == 0 && app.engine.pid == 17 && app.engine.receipt != nil,
              "a view failure stopped a verified ready engine")
        check(app.commands.retired && app.webView.isHidden && !app.status.isHidden,
              "the broken view must retire while status remains available")
        check(app.status.stringValue.contains("running work continues") &&
              app.status.stringValue.contains("Quit NAC"), "retention status is not truthful")
        app.deliver("duplicate")
        check(app.engine.stops == 0 && app.failure == "renderer failed while hidden", "duplicate failure changed owners")
        app.engine.receipt = nil
        app.deliver("later channel failure")
        check(!app.status.stringValue.contains("running work continues") &&
              app.status.stringValue.contains("service is unavailable") &&
              app.status.stringValue.contains("Cleanup may still be finishing") && app.engine.stops == 0,
              "later receipt invalidation kept a stale running-work claim or resent shutdown")
        // A direct natural exit is a separate callback path. Protocol failure
        // may consume onExit through its existing stop completion; do not assume
        // it will deliver another status update after readiness is invalidated.
        let exited = PreviewApp(); exited.deliver("view failure before natural exit")
        exited.engine.receipt = nil; exited.engine.pid = 0
        exited.deliver("natural engine exit")
        check(exited.status.stringValue.contains("service has stopped") && exited.engine.stops == 0,
              "natural engine exit did not settle status without another control")
        for state in 0..<4 {
            let broken = PreviewApp()
            switch state {
            case 0: broken.engine.receipt = nil
            case 1: broken.engine.pid = 0
            case 2: broken.engine.receipt = Receipt(kind: "failed")
            default: broken.quit.launch = nil
            }
            broken.deliver("not a retainable ready launch")
            check(broken.engine.stops == 1 && broken.engine.pid == 0 && broken.engine.receipt == nil,
                  "an invalid, exited or unowned launch escaped cleanup")
            check(!broken.status.stringValue.contains("running work continues"), "invalid launch claimed retention")
        }
        let stopping = PreviewApp(); stopping.stopping = true; stopping.deliver("late failure")
        check(stopping.failure == nil && stopping.engine.stops == 0 && !stopping.commands.retired,
              "late failure interfered with original stop")
        #else
        let preview = PreviewApp(); preview.deliver("preview failure")
        check(preview.engine.stops == 1 && preview.provider.stops == 1 && preview.commands.retired,
              "disposable preview no longer uses ordinary cleanup")
        #endif
    }
}
'''


class PreviewFailureTests(unittest.TestCase):
    def exercise(self, local):
        source = Path(os.environ.get('NAC_PREVIEW_FAILURE_SOURCE', Path(__file__).with_name('PreviewApp.swift'))).read_text()
        start = source.index('    private func fail(_ message: String) {')
        end = source.index('\n    }', start) + len('\n    }')
        with tempfile.TemporaryDirectory(prefix='nac-preview-failure-control-') as raw:
            root = Path(raw)
            file = root / 'control.swift'
            file.write_text(PORTS + source[start:end] + CONTROLS)
            command = ['xcrun', 'swiftc', '-parse-as-library', '-swift-version', '5']
            if local:
                command += ['-D', 'LOCAL_APP']
            subprocess.run([*command, str(file), '-o', str(root / 'control')], check=True,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=30)
            result = subprocess.run([str(root / 'control')], stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, text=True, timeout=3)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_local_failure_retains_only_ready_owned_engine(self):
        self.exercise(True)

    def test_disposable_preview_keeps_normal_cleanup(self):
        self.exercise(False)


if __name__ == '__main__':
    unittest.main()
