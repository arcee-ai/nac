"""Actual recovery/load/admission branches with headless adapters, not native QA."""
from pathlib import Path
import subprocess
import tempfile
import unittest

from test_workspace_recovery import member

OWNER = Path(__file__).parent


class RecoveryQuitAdmissionTests(unittest.TestCase):
    def test_quit_retains_explicit_recovery_across_retirement_and_engine_readiness(self):
        recovery = (OWNER / 'WorkspaceRecovery.swift').read_text()
        app = (OWNER / 'PreviewApp.swift').read_text()
        methods = ''.join(member(recovery, declaration) for declaration in [
            'func seedRoute(', 'func engineReady(', 'private func next(',
            'private func current(', 'private func sameEngine(', 'private func reconnect(',
            'private func performRestart(', 'private func unavailable(',
            'private func showActions(', 'private func hideActions(',
        ])
        replacement = member(app, 'func replaceWorkspace(')
        profile_initial = 'initial: Bool' in replacement
        # Keep every actual admission guard, stopping at the first construction
        # adapter. Only the admitted WK constructor is replaced by a recorder.
        prefix = replacement[:replacement.index('        var address = URLComponents')]
        recorder = '        replacements += 1; webView = View(); commands = Commands()\n'
        if profile_initial:
            recorder += '        lastInitial = initial\n'
        fixture = (OWNER / 'RecoveryQuitAdmissionFixture.swift').read_text()
        for marker, source in [
            ('// APP_ADMISSION', member(app, 'var canRecoverWorkspace:')),
            ('// APP_LOAD', member(app, 'private func load(')),
            ('// APP_REPLACEMENT_ADMISSION', prefix + recorder + '    }\n'),
            ('// RECOVERY_METHODS', methods),
        ]:
            self.assertEqual(fixture.count(marker), 1)
            fixture = fixture.replace(marker, source)
        compiler = subprocess.check_output(['xcrun', '--find', 'swiftc'], text=True).strip()
        sdk = subprocess.check_output(['xcrun', '--sdk', 'macosx', '--show-sdk-path'], text=True).strip()
        with tempfile.TemporaryDirectory(prefix='nac-recovery-quit-admission-') as directory:
            path = Path(directory)
            swift = path / 'RecoveryQuitAdmission.swift'
            swift.write_text(fixture)
            binary = path / 'recovery-quit-admission'
            compiled = subprocess.run([compiler, '-sdk', sdk, '-swift-version', '5',
                '-target', 'arm64-apple-macosx14.0', '-warnings-as-errors', '-Onone', '-D', 'LOCAL_APP',
                str(OWNER / 'EngineProtocol.swift'), str(OWNER / 'EngineFailure.swift'),
                str(OWNER / 'AppLifecycle.swift'), str(swift), '-o', str(binary)],
                text=True, capture_output=True, timeout=120, check=False)
            self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
            for scenario in ['retirement-cancel', 'retirement-stale', 'retirement-stop', 'late-readiness', 'initial']:
                with self.subTest(scenario=scenario):
                    args = [str(binary), scenario]
                    if profile_initial:
                        args.append('profile-initial')
                    executed = subprocess.run(args, text=True, capture_output=True, timeout=15, check=False)
                    self.assertEqual(executed.returncode, 0, executed.stdout + executed.stderr)
                    print(executed.stdout, end='')


if __name__ == '__main__':
    unittest.main()
