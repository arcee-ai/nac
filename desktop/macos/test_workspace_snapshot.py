"""Verbatim Swift capture fault controls with headless ports, not native paint."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

from test_workspace_recovery import member

OWNER = Path(__file__).parent


class WorkspaceSnapshotTests(unittest.TestCase):
    def test_targeted_capture_commits_only_after_every_fallible_step(self):
        source = Path(os.environ.get('NAC_SNAPSHOT_SOURCE', OWNER / 'WorkspaceSmoke.swift')).read_text()
        fixture = (OWNER / 'WorkspaceSnapshotFixture.swift').read_text()
        self.assertEqual(fixture.count('// SNAPSHOT_METHOD'), 1)
        fixture = fixture.replace('// SNAPSHOT_METHOD', member(source, 'func snapshot('))
        compiler = subprocess.check_output(['xcrun', '--find', 'swiftc'], text=True).strip()
        sdk = subprocess.check_output(['xcrun', '--sdk', 'macosx', '--show-sdk-path'], text=True).strip()
        cases = ['success', 'read-before', 'js', 'snapshot', 'tiff', 'bitmap', 'png', 'write',
                 'read-after', 'not-ready-after', 'identity-after', 'source-dirty', 'source-missing',
                 'answer-after', 'surface-after', 'prior-pass-failure', 'sticky-unavailable',
                 'diagnostic-success', 'diagnostic-snapshot', 'diagnostic-write']
        with tempfile.TemporaryDirectory(prefix='nac-snapshot-controls-') as directory:
            root = Path(directory)
            swift = root / 'SnapshotControls.swift'
            swift.write_text(fixture)
            binary = root / 'snapshot-controls'
            compiled = subprocess.run([compiler, '-parse-as-library', '-sdk', sdk, '-swift-version', '5',
                '-target', 'arm64-apple-macosx14.0', '-warnings-as-errors', '-Onone', str(swift), '-o', str(binary)],
                capture_output=True, text=True, timeout=120)
            self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
            for case in cases:
                with self.subTest(case=case):
                    result = subprocess.run([str(binary), case], capture_output=True, text=True, timeout=10)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    print(result.stdout, end='')

    def test_exact_mcp_probe_controls(self):
        result = subprocess.run(['node', '--test', str(OWNER / 'test_workspace_mcp.mjs')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        print(result.stdout, end='')


if __name__ == '__main__':
    unittest.main()
