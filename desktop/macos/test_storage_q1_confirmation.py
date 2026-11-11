"""Compile the actual Q1 observation guard against the real Quit state machine."""
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest


@unittest.skipUnless(sys.platform == 'darwin', 'Requires the macOS Swift compiler')
class QuitConfirmationObservationControls(unittest.TestCase):
    def test_confirmation_observes_only_the_originating_live_document(self):
        root = Path(__file__).resolve().parent
        source = (root / 'RecoverySmoke.swift').read_text()
        guard = source.split('            let confirming: Bool = {', 1)[1].split('            let finalFlush', 1)[0]
        guard = 'let confirming: Bool = {' + guard
        fixture = textwrap.dedent('''
            import Foundation
            struct Receipt {
                var incarnation = "i", kind = "k", version = "v", stage = "s", code = "c"
                var message = "m", endpoint = "e", identity = "id", store = "store", schema = "schema"
            }
            @MainActor final class Quit {
                let lifecycle = AppLifecycle()
                var launch: UUID? { lifecycle.launch }
            }
            @MainActor final class App {
                var stopping = false, failure: String?
                let quit = Quit()
                var webView: NSObject? = NSObject()
                var engine = Engine(), recovery = Recovery()
                struct Engine { var pid = 17, receipt: Receipt? = Receipt() }
                struct Recovery { var documentGeneration = 3 }
                var canRecoverWorkspace: Bool { !stopping && failure == nil && quit.lifecycle.phase == .running }
                var commands: [String: Any] = ["launch": "l", "view": "v", "document": "d"]
            }
            @MainActor final class Owner {
                let app = App()
                var storageQ1Owner: String? = "owner"
                func accepts(_ event: [String: Any], _ q1QuitLaunch: UUID, _ view: NSObject?,
                             _ generation: Int = 3, _ enginePID: Int = 17, _ receipt: Receipt = Receipt()) -> Bool {
                    let current: [String: Any]? = app.commands
                    let launch = "l", viewID = "v", document = "d"
                    __ACTUAL_GUARD__
                    return live
                }
            }
            @main struct Controls {
                @MainActor static func main() {
                    let owner = Owner(), event: [String: Any] = ["owner": "owner"]
                    let app = owner.app, view = app.webView, launch = app.quit.lifecycle.beginLaunch()!
                    precondition(owner.accepts(event, launch, view))
                    guard case .confirm(let sheet) = app.quit.lifecycle.requestQuit(activity: .init()) else { fatalError() }
                    precondition(!app.canRecoverWorkspace) // The old observation gate drops this interval.
                    precondition(owner.accepts(event, launch, view))
                    precondition(!owner.accepts(["owner": "foreign"], launch, view))
                    precondition(!owner.accepts(event, UUID(), view))
                    precondition(!owner.accepts(event, launch, NSObject()))
                    precondition(!owner.accepts(event, launch, view, 4))
                    precondition(!owner.accepts(event, launch, view, 3, 18))
                    app.commands["document"] = "old"
                    precondition(!owner.accepts(event, launch, view))
                    app.commands["document"] = "d"
                    app.engine.receipt?.incarnation = "successor"
                    precondition(!owner.accepts(event, launch, view))
                    app.engine.receipt = Receipt(); app.failure = "failed"
                    precondition(!owner.accepts(event, launch, view))
                    app.failure = nil; app.stopping = true
                    precondition(!owner.accepts(event, launch, view))
                    app.stopping = false; owner.storageQ1Owner = nil
                    precondition(!owner.accepts(event, launch, view))
                    owner.storageQ1Owner = "owner"
                    _ = app.quit.lifecycle.answer(sheet, stop: false)
                    precondition(owner.accepts(event, launch, view))
                    print("actual confirmation guard + real Cancel transition passed")
                }
            }
        ''').replace('__ACTUAL_GUARD__', guard)
        with tempfile.TemporaryDirectory(prefix='nac-q1-confirm-') as temporary:
            directory = Path(temporary); file = directory / 'Controls.swift'; file.write_text(fixture)
            binary = directory / 'controls'
            result = subprocess.run(['xcrun', 'swiftc', '-swift-version', '5', '-parse-as-library',
                                     str(root / 'AppLifecycle.swift'), str(file), '-o', str(binary)],
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
