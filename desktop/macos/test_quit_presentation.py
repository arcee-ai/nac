"""Complete AppQuit with inert boundaries; compiler/runtime require allocation."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

OWNER = Path(__file__).parent


class QuitPresentationTests(unittest.TestCase):
    def compile_control(self, path, owner, fixture, flags=()):
        self.assertEqual(owner.count('import AppKit'), 1)
        self.assertEqual(fixture.count('// APP_QUIT_OWNER'), 1)
        swift = path / 'QuitPresentation.swift'
        swift.write_text(fixture.replace('// APP_QUIT_OWNER', owner.replace('import AppKit', 'import Foundation')))
        compiler = subprocess.check_output(['xcrun', '--find', 'swiftc'], text=True).strip()
        sdk = subprocess.check_output(['xcrun', '--sdk', 'macosx', '--show-sdk-path'], text=True).strip()
        binary = path / 'quit-presentation-controls'
        compiled = subprocess.run([compiler, '-sdk', sdk, '-swift-version', '5',
            '-target', 'arm64-apple-macosx14.0', '-warnings-as-errors', '-Onone', *flags,
            str(OWNER / 'AppLifecycle.swift'), str(swift), '-o', str(binary)],
            text=True, capture_output=True, timeout=60, check=False)
        self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
        return binary

    def test_original_boundaries_and_originating_transaction(self):
        owner = (OWNER / 'AppQuit.swift').read_text()
        fixture = (OWNER / 'QuitPresentationFixture.swift').read_text()
        for name, flags in [('ordinary', ()),
                            ('attention', ('-D', 'PREVIEW_SMOKE', '-D', 'ATTENTION_SMOKE'))]:
            with self.subTest(role=name), tempfile.TemporaryDirectory(prefix='nac-quit-presentation-') as directory:
                binary = self.compile_control(Path(directory), owner, fixture, flags)
                executed = subprocess.run([str(binary)], text=True, capture_output=True, timeout=35, check=False)
                self.assertEqual(executed.returncode, 0, executed.stdout + executed.stderr)
                print(executed.stdout, end='')

    @unittest.skipUnless(os.environ.get('NAC_QUIT_RED_SOURCE'), 'Explicit immutable preimage needed for original RED')
    def test_original_owner_reproduces_premature_termination_cancel(self):
        owner = Path(os.environ['NAC_QUIT_RED_SOURCE']).read_text()
        # The original owner needs its original inert AppKit boundary. The
        # current MainActor fake cannot compile its retained legacy callback.
        # Require the explicit immutable boundary with the explicit owner;
        # candidate and prior-Later controls keep their current strict doubles.
        fixture = Path(os.environ['NAC_QUIT_RED_BOUNDARY']).read_text().split('@main struct QuitPresentationControls')[0]
        fixture += '''@main struct OriginalReplyControl {
            @MainActor static func main() {
                let app = PreviewApp()
                withExtendedLifetime(app) {
                    let owner = AppQuit(app: app)
                    precondition(owner.shouldTerminate() == .terminateLater,
                                 "Original owner aborts originating transaction")
                }
            }
        }
        '''
        with tempfile.TemporaryDirectory(prefix='nac-quit-original-red-') as directory:
            binary = self.compile_control(Path(directory), owner, fixture)
            executed = subprocess.run([str(binary)], text=True, capture_output=True, timeout=5, check=False)
            self.assertNotEqual(executed.returncode, 0)
            self.assertIn('Original owner aborts originating transaction', executed.stdout + executed.stderr)

    @unittest.skipUnless(os.environ.get('NAC_QUIT_FENCE_RED_SOURCE'), 'Exact prior Later owner needed for fence RED')
    def test_prior_later_owner_admits_os_first_native_duplicate(self):
        owner = Path(os.environ['NAC_QUIT_FENCE_RED_SOURCE']).read_text()
        fixture = (OWNER / 'QuitPresentationFixture.swift').read_text().split('@main struct QuitPresentationControls')[0]
        fixture += '''@main struct PriorFenceControl {
            @MainActor static func main() {
                let app = PreviewApp(); NSApp.delegate = app
                withExtendedLifetime(app) {
                    precondition(app.quit.shouldTerminate() == .terminateLater)
                    RunLoop.main.run(until: Date().addingTimeInterval(0.02))
                    NSApp.terminate(nil)
                    precondition(NSApp.publicAdmissions == 0,
                                 "Prior call-stack guard admitted OS-first native duplicate")
                }
            }
        }
        '''
        with tempfile.TemporaryDirectory(prefix='nac-quit-prior-fence-red-') as directory:
            binary = self.compile_control(Path(directory), owner, fixture)
            executed = subprocess.run([str(binary)], text=True, capture_output=True, timeout=5, check=False)
            self.assertNotEqual(executed.returncode, 0)
            self.assertIn('Prior call-stack guard admitted OS-first native duplicate', executed.stdout + executed.stderr)


if __name__ == '__main__':
    unittest.main()
