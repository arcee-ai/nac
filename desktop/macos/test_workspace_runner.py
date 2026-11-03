import contextlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, call, patch

from workspace import run_case


class WorkspaceRunnerTests(unittest.TestCase):
    @contextlib.contextmanager
    def owned_launcher(self, scenario):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app, output, relocation = root / 'Fixture.app', root / 'evidence', root / 'relocation'
            for path in [app, output, relocation]:
                path.mkdir()
            launcher = Mock(returncode=0)
            launcher.poll.return_value = 0
            relocated = relocation / 'Moved workspace fixture with spaces' / app.name
            with patch('workspace.tempfile.mkdtemp', return_value=str(relocation)), \
                    patch('workspace.console_state', return_value={'prior_pid': 0, 'prior_bundle_id': '', 'screen_locked': False}), \
                    patch('workspace.subprocess.Popen', return_value=launcher), \
                    patch('workspace.cleanup_failed_case') as cleanup, \
                    contextlib.redirect_stdout(io.StringIO()):
                yield output / f'{scenario}.json', app, output, relocated, launcher, cleanup

    def test_manual_capture_survives_slow_setup_and_full_operator_window(self):
        with self.owned_launcher('terminal-manual') as fixture:
            evidence, app, output, _, launcher, cleanup = fixture

            def finished(*, timeout):
                # Virtual elapsed time: staging, full operator window and cleanup.
                # No real process, native operation, sleep or clock change occurs.
                evidence.write_text(json.dumps({'passed': True, 'engine_reaped': True,
                                                'profile_removed': True, 'manual_seconds_limit': 180}))
                if timeout < 480:
                    raise subprocess.TimeoutExpired('owned launcher', timeout)
                return 0

            launcher.wait.side_effect = finished
            result = run_case(app, output, 'terminal-manual')
            self.assertTrue(result['passed'], result.get('runner_error'))
            self.assertEqual(result['manual_seconds_limit'], 180)
            launcher.wait.assert_called_once_with(timeout=930)
            launcher.terminate.assert_not_called()
            cleanup.assert_not_called()

    def test_manual_allowance_preserves_other_scenario_deadlines(self):
        for scenario, timeout in [('workspace-manual', 930), ('terminal-manual', 930),
                                  ('workspace-direct', 300), ('workspace-legacy', 300),
                                  ('terminal-output', 300), ('terminal-renderer-failure', 300),
                                  ('terminal-xctest', 300)]:
            with self.subTest(scenario=scenario), self.owned_launcher(scenario) as fixture:
                evidence, app, output, _, launcher, cleanup = fixture

                def finished(**_):
                    evidence.write_text(json.dumps({'passed': True, 'engine_reaped': True,
                                                    'profile_removed': True}))
                    return 0

                launcher.wait.side_effect = finished
                self.assertTrue(run_case(app, output, scenario)['passed'])
                launcher.wait.assert_called_once_with(timeout=timeout)
                cleanup.assert_not_called()

    def test_manual_timeout_retains_partial_evidence_and_owned_cleanup(self):
        with self.owned_launcher('terminal-manual') as fixture:
            evidence, app, output, relocated, launcher, cleanup = fixture
            launcher.returncode = None
            launcher.poll.return_value = None
            partial = {'partial-frame-parser-completion': {'status': 'pass'}}

            def waited(*, timeout):
                if timeout == 5:
                    launcher.returncode = -15
                    return -15
                evidence.write_text(json.dumps({'passed': True, 'checks': partial,
                                                'engine_reaped': False, 'profile_removed': False}))
                raise subprocess.TimeoutExpired('owned launcher', timeout)

            def cleaned(path, owned_app):
                record = json.loads(path.read_text())
                record.update(engine_reaped=True, profile_removed=True)
                path.write_text(json.dumps(record))

            launcher.wait.side_effect = waited
            cleanup.side_effect = cleaned
            result = run_case(app, output, 'terminal-manual')
            self.assertFalse(result['passed'])
            self.assertIn('TimeoutExpired', result['runner_error'])
            self.assertEqual(result['checks'], partial)
            self.assertEqual(result, json.loads(evidence.read_text()))
            self.assertTrue(result['engine_reaped'])
            self.assertTrue(result['profile_removed'])
            self.assertTrue(relocated.exists())
            cleanup.assert_called_once_with(evidence, relocated)
            launcher.terminate.assert_called_once_with()
            self.assertEqual(launcher.wait.call_args_list, [call(timeout=930), call(timeout=5)])

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
