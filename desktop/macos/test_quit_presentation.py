"""Complete AppQuit source with inert UI doubles; never native activation evidence."""
from pathlib import Path
import subprocess
import tempfile
import unittest

OWNER = Path(__file__).parent


class QuitPresentationTests(unittest.TestCase):
    def test_owned_quit_requests_activation_before_presenting_one_sheet(self):
        source = (OWNER / 'AppQuit.swift').read_text()
        self.assertEqual(source.count('import AppKit'), 1)
        source = source.replace('import AppKit', 'import Foundation')
        fixture = (OWNER / 'QuitPresentationFixture.swift').read_text()
        self.assertEqual(fixture.count('// APP_QUIT_OWNER'), 1)
        fixture = fixture.replace('// APP_QUIT_OWNER', source)
        compiler = subprocess.check_output(['xcrun', '--find', 'swiftc'], text=True).strip()
        sdk = subprocess.check_output(['xcrun', '--sdk', 'macosx', '--show-sdk-path'], text=True).strip()
        with tempfile.TemporaryDirectory(prefix='nac-quit-presentation-') as directory:
            path = Path(directory)
            swift = path / 'QuitPresentation.swift'
            swift.write_text(fixture)
            binary = path / 'quit-presentation-controls'
            compiled = subprocess.run([compiler, '-sdk', sdk, '-swift-version', '5',
                '-target', 'arm64-apple-macosx14.0', '-warnings-as-errors', '-Onone',
                str(OWNER / 'AppLifecycle.swift'), str(swift), '-o', str(binary)],
                text=True, capture_output=True, timeout=120, check=False)
            self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
            executed = subprocess.run([str(binary)], text=True, capture_output=True, timeout=15, check=False)
            self.assertEqual(executed.returncode, 0, executed.stdout + executed.stderr)
            print(executed.stdout, end='')


if __name__ == '__main__':
    unittest.main()
