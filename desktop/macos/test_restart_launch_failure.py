"""Actual restart/failure owner seam with inert collaborators, not native acceptance."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import tempfile
import time
import sys
import unittest

OWNER = Path(__file__).parent
SOURCE = OWNER
ARTIFACTS = None



class RestartLaunchFailureTests(unittest.TestCase):
    def test_async_restart_launch_failure_keeps_remaining_attempt_and_lifecycle_fences(self):
        sys.path.insert(0, str(SOURCE))
        from test_workspace_recovery import member
        app = (SOURCE / 'PreviewApp.swift').read_text()
        recovery = (SOURCE / 'WorkspaceRecovery.swift').read_text()
        methods = ''.join(member(recovery, declaration) for declaration in [
            'private func next(', 'private func current(', 'private func performRestart(',
            'func engineExited(', 'private func unavailable(',
            'private func showActions(', 'private func hideActions(',
        ])
        fixture = (OWNER / 'RestartLaunchFailureFixture.swift').read_text()
        loss_recording = (member(recovery, 'func ownedEngineWillStop(')
                          if 'func ownedEngineWillStop(' in recovery else '')
        for marker, text in [
            ('// APP_ADMISSION', member(app, 'var canRecoverWorkspace:')),
            ('// APP_RESTART', member(app, 'func restartOwnedEngine(')),
            ('// APP_FAILURE', member(app, 'private func engineFailed(')),
            ('// RECOVERY_METHODS', methods),
            ('// ACTUAL_SMOKE_RESTART', member(recovery, 'func smokeRestart(')),
            ('// LOSS_PRESENTATION', member(recovery, 'var noticeHeight:') + member(recovery, 'func showLossNotice(')),
            ('// LOSS_RECORDING', loss_recording),
        ]:
            self.assertEqual(fixture.count(marker), 1)
            fixture = fixture.replace(marker, text)
        temporary = None
        if ARTIFACTS is None:
            temporary = tempfile.TemporaryDirectory(prefix='nac-restart-launch-failure-')
            self.addCleanup(temporary.cleanup)
            output = Path(temporary.name) / 'retained'
        else:
            output = ARTIFACTS
        output.mkdir(parents=True, exist_ok=False)
        swift = output / 'RestartLaunchFailure.swift'
        swift.write_text(fixture)
        receipt = {'actual_app_sha256': hashlib.sha256(app.encode()).hexdigest(),
                   'actual_recovery_sha256': hashlib.sha256(recovery.encode()).hexdigest(),
                   'fixture_sha256': hashlib.sha256(fixture.encode()).hexdigest(),
                   'native_or_engine_operations': False, 'commands': []}
        def run(argv, timeout):
            started = time.monotonic()
            p = subprocess.run(argv, text=True, capture_output=True, timeout=timeout, check=False)
            receipt['commands'].append({'argv': argv, 'exit': p.returncode,
                                        'stdout': p.stdout, 'stderr': p.stderr,
                                        'seconds': time.monotonic() - started})
            (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
            return p
        binary = output / 'restart-launch-failure'
        compiled = run(['xcrun', 'swiftc', '-parse-as-library', '-swift-version', '5',
                        '-target', 'arm64-apple-macosx14.0', '-warnings-as-errors', '-Onone',
                        '-D', 'LOCAL_APP', str(SOURCE / 'EngineProtocol.swift'),
                        str(SOURCE / 'EngineFailure.swift'), str(SOURCE / 'AppLifecycle.swift'),
                        str(SOURCE / 'StoreConflict.swift'), str(swift), '-o', str(binary)], 120)
        self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
        for case in ['timeout', 'channel-loss', 'invalid-receipt', 'restart-store-conflict',
                     'ready-then-loss', 'quit-cancel', 'stop-late-failure',
                     'first-start', 'first-store-conflict',
                     'truth-retirement-timeout', 'truth-restart-admission', 'truth-zero-pid',
                     'truth-quit-before-stop', 'truth-cancel-before-stop', 'truth-stale-before-stop',
                     'truth-selection-before-stop', 'truth-cleanup-timeout', 'truth-cancel-after-stop',
                     'truth-quit-after-stop', 'truth-stop-after-stop', 'truth-start-failure',
                     'truth-success', 'truth-real-exit', 'truth-prior-exit-then-denied']:
            with self.subTest(case=case):
                result = run([str(binary), case], 10)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                print(result.stdout, end='')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--source-root', type=Path)
    parser.add_argument('--artifacts', type=Path)
    args, rest = parser.parse_known_args()
    if args.source_root:
        SOURCE = args.source_root.resolve()
    ARTIFACTS = args.artifacts.resolve() if args.artifacts else None
    unittest.main(argv=[__file__, *rest])
