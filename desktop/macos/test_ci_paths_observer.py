"""Whole maintained Swift observer compiler controls; no native execution.

Nominal helper boundary types provide declarations only. The observer and Darwin
functions are real compiler inputs; this does not compile the full XCTest target.
"""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


HELPER_TYPES = '''
@MainActor
enum NativePathJourney {
    struct Scope: Decodable {
        let run, source: String
        let app_pid, window, engine_pid: Int
        let operation, launch, view, document: String
    }
    enum PhaseName: String, Decodable {
        case ready
        case documentReloaded = "document-reloaded"
        case folderMoved = "folder-moved"
        case folderRestored = "folder-restored"
        case revealObserved = "reveal-observed"
        case failurePanelObserved = "failure-panel-observed"
    }
    struct Phase: Decodable {
        let version: Int
        let name: PhaseName
        let sequence: Int
        let run, source: String
        let app_pid, window, engine_pid: Int
        let operation, launch, view, document: String
    }
}
'''


@unittest.skipUnless(sys.platform == 'darwin' and shutil.which('xcrun'),
                     'Darwin Swift SDK compiler unavailable')
class ObserverCompilerControls(unittest.TestCase):
    def test_full_observer_resolves_global_read_despite_instance_reader(self):
        observer = Path(__file__).resolve().parent / 'NativeUITests/PathPhaseObserver.swift'
        source = observer.read_text()
        with tempfile.TemporaryDirectory(prefix='nac-path-observer-compiler-') as temporary:
            root = Path(temporary)
            helper = root / 'HelperTypes.swift'
            helper.write_text(HELPER_TYPES)
            for architecture in ('arm64', 'x86_64'):
                with self.subTest(architecture=architecture):
                    command = ['xcrun', 'swiftc', '-swift-version', '5', '-typecheck',
                               '-target', architecture + '-apple-macosx14.0',
                               '-module-cache-path', str(root / 'module-cache'), str(helper)]
                    actual = subprocess.run([*command, str(observer)], capture_output=True,
                                            text=True, timeout=60)
                    self.assertEqual(actual.returncode, 0, actual.stdout + actual.stderr)
                    # Same full class/method context, reverting only the observed defect.
                    self.assertEqual(source.count('Darwin.read('), 1)
                    mutant = root / 'PathPhaseObserverUnqualified.swift'
                    mutant.write_text(source.replace('Darwin.read(', 'read(', 1))
                    broken = subprocess.run([*command, str(mutant)], capture_output=True,
                                            text=True, timeout=60)
                    self.assertNotEqual(broken.returncode, 0)
                    self.assertIn("use of 'read' refers to instance method", broken.stderr)


if __name__ == '__main__':
    unittest.main()
