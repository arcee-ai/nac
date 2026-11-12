"""Characterize the actual clipboard helper without AppKit or clipboard access."""

from pathlib import Path
import platform
import subprocess
import tempfile
import unittest

from test_workspace_recovery import member


OWNER = Path(__file__).parent


class NativeClipboardOwnershipTests(unittest.TestCase):
    @unittest.skipUnless(platform.system() == 'Darwin', 'Swift compiler on macOS is required')
    def test_failure_reasons_and_short_circuit_reads(self):
        source = (OWNER / 'NativeCommandInput.swift').read_text()
        fixture = (OWNER / 'ClipboardOwnershipFixture.swift').read_text()
        self.assertEqual(fixture.count('// OWNERSHIP_HELPER'), 1)
        fixture = fixture.replace('// OWNERSHIP_HELPER', member(source, 'private func ownedClipboardChange('))
        with tempfile.TemporaryDirectory(prefix='nac-clipboard-inert-') as directory:
            root = Path(directory)
            swift = root / 'ClipboardOwnership.swift'
            swift.write_text(fixture)
            binary = root / 'clipboard-ownership-tests'
            compiled = subprocess.run([
                'xcrun', 'swiftc', '-swift-version', '5', '-warnings-as-errors',
                '-Onone', '-parse-as-library', str(swift), '-o', str(binary),
            ], text=True, capture_output=True, timeout=90, check=False)
            self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
            executed = subprocess.run([str(binary)], text=True, capture_output=True,
                                      timeout=15, check=False)
            self.assertEqual(executed.returncode, 0, executed.stdout + executed.stderr)
            self.assertIn('no system clipboard accessed', executed.stdout)
            print(executed.stdout, end='')


if __name__ == '__main__':
    unittest.main()
