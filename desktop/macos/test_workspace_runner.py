import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from workspace import run_case


class WorkspaceRunnerTests(unittest.TestCase):
    def test_launcher_or_native_cleanup_failure_cannot_inherit_a_pass(self):
        for code, reaped, removed in [(42, True, True), (0, False, True), (0, True, False)]:
            with self.subTest(code=code, reaped=reaped, removed=removed), \
                    tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                app, output, relocation = root / 'Fixture.app', root / 'evidence', root / 'relocation'
                for path in [app, output, relocation]:
                    path.mkdir()
                evidence = output / 'workspace-direct.json'
                launcher = Mock(returncode=code)

                def finished(**_):
                    evidence.write_text(json.dumps({'passed': True, 'engine_reaped': reaped,
                                                    'profile_removed': removed}))
                    return code

                launcher.wait.side_effect = finished
                with patch('workspace.tempfile.mkdtemp', return_value=str(relocation)), \
                        patch('workspace.console_state', return_value={'prior_pid': 0, 'prior_bundle_id': '', 'screen_locked': True}), \
                        patch('workspace.subprocess.Popen', return_value=launcher), \
                        patch('workspace.cleanup_failed_case'), contextlib.redirect_stdout(io.StringIO()):
                    result = run_case(app, output, 'workspace-direct')
                self.assertFalse(result['passed'])
                self.assertEqual(result['launcher_exit_code'], code)
                self.assertIn('runner_error', result)

    def test_missing_ownership_preserves_bundle_and_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app, output, relocation = root / 'Fixture.app', root / 'evidence', root / 'relocation'
            for path in [app, output, relocation]:
                path.mkdir()
            (app / 'sentinel').write_text('owned fixture')
            launcher = Mock(returncode=0)
            launcher.wait.return_value = 0
            launcher.poll.return_value = 0
            with patch('workspace.tempfile.mkdtemp', return_value=str(relocation)), \
                    patch('workspace.console_state', return_value={'prior_pid': 0, 'prior_bundle_id': '', 'screen_locked': True}), \
                    patch('workspace.subprocess.Popen', return_value=launcher), \
                    contextlib.redirect_stdout(io.StringIO()):
                result = run_case(app, output, 'workspace-direct')
            self.assertFalse(result['passed'])
            self.assertIn('runner_error', result)
            self.assertTrue(Path(result['relocated_app']).exists())
            self.assertEqual(json.loads((output / 'workspace-direct.json').read_text()), result)
            launcher.terminate.assert_not_called()

    def test_interrupt_retains_partial_checks_and_records_owned_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app, output, relocation = root / 'Fixture.app', root / 'evidence', root / 'relocation'
            for path in [app, output, relocation]:
                path.mkdir()
            evidence = output / 'workspace-direct.json'
            evidence.write_text(json.dumps({'checks': {'direct': {'status': 'pass'}}}))
            # run_case refuses preexisting evidence: write it only after launch.
            initial = evidence.read_text()
            evidence.unlink()
            launcher = Mock(returncode=0)
            launcher.poll.return_value = 0

            def interrupted(**_):
                evidence.write_text(initial)
                raise KeyboardInterrupt()

            launcher.wait.side_effect = interrupted
            with patch('workspace.tempfile.mkdtemp', return_value=str(relocation)), \
                    patch('workspace.console_state', return_value={'prior_pid': 0, 'prior_bundle_id': '', 'screen_locked': True}), \
                    patch('workspace.subprocess.Popen', return_value=launcher), \
                    patch('workspace.cleanup_failed_case') as cleanup, \
                    self.assertRaises(KeyboardInterrupt):
                run_case(app, output, 'workspace-direct')
            result = json.loads(evidence.read_text())
            self.assertFalse(result['passed'])
            self.assertTrue(result['runner_cleanup_attempted'])
            self.assertEqual(result['checks']['direct']['status'], 'pass')
            cleanup.assert_called_once_with(evidence, Path(result['relocated_app']))


if __name__ == '__main__':
    unittest.main()
