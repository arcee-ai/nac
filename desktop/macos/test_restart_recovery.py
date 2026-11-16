"""Verbatim Restart-sheet callback with headless UI/engine doubles, not native acceptance."""

from pathlib import Path
import os
import subprocess
import tempfile
import unittest

from test_workspace_recovery import member


OWNER = Path(__file__).parent


class RestartRecoveryTests(unittest.TestCase):
    def test_restart_sheet_retains_current_loss_and_preserves_other_owners(self):
        source = Path(os.environ.get('NAC_RECOVERY_SOURCE', OWNER / 'WorkspaceRecovery.swift')).read_text()
        methods = ''.join(member(source, declaration) for declaration in [
            'private func next(', 'private func current(', 'private func sameEngine(',
            'func rendererFailed(', 'func connectionLost(', 'private func reconnect(',
            'func documentLoaded(', 'func engineExited(', '@objc private func restartEngine(',
            'private func performRestart(', 'private func willSleep(', 'private func unavailable(',
            'private func showActions(', 'private func hideActions(', 'func close(',
            'func cancelPending(', 'func applicationQuitRequested(', 'private func cancelConfirmation(',
        ])
        app = (OWNER / 'PreviewApp.swift').read_text()
        fixture = (OWNER / 'RestartRecoveryFixture.swift').read_text()
        for marker, contents in [
            ('// RECOVERY_METHODS', methods),
            ('// APP_ADMISSION', member(app, 'var canRecoverWorkspace:')),
            ('// APP_RENDERER_TERMINATION', member(app, 'func webViewWebContentProcessDidTerminate(')),
        ]:
            self.assertEqual(fixture.count(marker), 1)
            fixture = fixture.replace(marker, contents)
        compiler = subprocess.check_output(['xcrun', '--find', 'swiftc'], text=True).strip()
        sdk = subprocess.check_output(['xcrun', '--sdk', 'macosx', '--show-sdk-path'], text=True).strip()
        with tempfile.TemporaryDirectory(prefix='nac-restart-pure-') as directory:
            path = Path(directory)
            swift = path / 'RestartOwner.swift'
            swift.write_text(fixture)
            binary = path / 'restart-owner-pure-tests'
            command = [compiler, '-sdk', sdk, '-swift-version', '5', '-target', 'arm64-apple-macosx14.0',
                       '-warnings-as-errors', '-Onone', '-D', 'LOCAL_APP',
                       str(OWNER / 'EngineProtocol.swift'), str(OWNER / 'EngineFailure.swift'),
                       str(OWNER / 'AppLifecycle.swift'), str(swift), '-o', str(binary)]
            compiled = subprocess.run(command, text=True, capture_output=True, timeout=120, check=False)
            self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
            for scenario in ['existing', 'retirement-reload', 'retirement-restart', 'failed-attempt-bounds']:
                with self.subTest(scenario=scenario):
                    executed = subprocess.run([str(binary), scenario], text=True, capture_output=True, timeout=15, check=False)
                    self.assertEqual(executed.returncode, 0, executed.stdout + executed.stderr)
                    print(executed.stdout, end='')


if __name__ == '__main__':
    unittest.main()
