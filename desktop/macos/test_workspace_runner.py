import contextlib
import io
import json
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from workspace import run_case, wait_for_case


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

    def test_cleanup_timeout_retains_original_failure_and_unreaped_launcher(self):
        for original in (subprocess.TimeoutExpired(['inert-open-W'], 300), KeyboardInterrupt()):
            with self.subTest(original=type(original).__name__), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                app, output, relocation = root / 'Fixture.app', root / 'evidence', root / 'relocation'
                for path in [app, output, relocation]:
                    path.mkdir()
                launcher = Mock(args=['inert-open-W'], returncode=None)
                launcher.poll.return_value = None
                launcher.wait.side_effect = [original, subprocess.TimeoutExpired(launcher.args, 5)]
                with patch('workspace.tempfile.mkdtemp', return_value=str(relocation)), \
                        patch('workspace.console_state', return_value={'prior_pid': 0, 'prior_bundle_id': '', 'screen_locked': True}), \
                        patch('workspace.subprocess.Popen', return_value=launcher), \
                        contextlib.redirect_stdout(io.StringIO()):
                    if isinstance(original, KeyboardInterrupt):
                        with self.assertRaises(KeyboardInterrupt):
                            run_case(app, output, 'workspace-direct')
                    else:
                        run_case(app, output, 'workspace-direct')
                record = json.loads((output / 'workspace-direct.json').read_text())
                self.assertFalse(record['passed'])
                self.assertIn(type(original).__name__, record['runner_error'])
                if isinstance(original, subprocess.TimeoutExpired):
                    self.assertIn('300', record['runner_error'])
                self.assertFalse(record['launcher_reaped'])
                self.assertIn('TimeoutExpired', record['runner_cleanup_errors'][0])
                self.assertTrue((relocation / 'Moved workspace fixture with spaces' / app.name).exists())
                launcher.terminate.assert_called_once_with()

    def test_native_cleanup_error_still_records_failure_and_reaps_launcher(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app, output, relocation = root / 'Fixture.app', root / 'evidence', root / 'relocation'
            for path in [app, output, relocation]:
                path.mkdir()
            evidence = output / 'workspace-direct.json'
            profile = root / 'retained-native-profile'
            profile.mkdir()
            launcher = Mock(returncode=None)
            launcher.poll.side_effect = [None, 0]
            def started(*_):
                evidence.write_text(json.dumps({'profile': str(profile), 'checks': {'direct': {'status': 'pass'}}}))
                raise RuntimeError('original launch failure')
            def reaped(**_):
                evidence.write_text(json.dumps({'profile': str(profile), 'checks': {'direct': {'status': 'pass'},
                    'cleanup-published': {'status': 'pass'}}, 'engine_reaped': True, 'profile_removed': True}))
                launcher.returncode = 0
                return 0
            launcher.wait.side_effect = reaped
            with patch('workspace.tempfile.mkdtemp', return_value=str(relocation)), \
                    patch('workspace.console_state', return_value={'prior_pid': 0, 'prior_bundle_id': '', 'screen_locked': True}), \
                    patch('workspace.subprocess.Popen', return_value=launcher), \
                    patch('workspace.wait_for_case', side_effect=started), \
                    patch('workspace.cleanup_failed_case', side_effect=RuntimeError('native cleanup unavailable')), \
                    contextlib.redirect_stdout(io.StringIO()):
                result = run_case(app, output, 'workspace-direct')
            self.assertFalse(result['passed'])
            self.assertEqual(result['runner_error'], 'RuntimeError: original launch failure')
            self.assertIn('native cleanup unavailable', result['runner_cleanup_errors'][0])
            self.assertIn('Fixture profile survived cleanup', result['runner_cleanup_errors'])
            self.assertTrue(profile.exists())
            self.assertTrue(result['launcher_reaped'])
            self.assertTrue(result['engine_reaped'])
            self.assertTrue(result['profile_removed'])
            self.assertEqual(result['checks']['cleanup-published']['status'], 'pass')
            self.assertEqual(result['checks']['direct']['status'], 'pass')
            self.assertEqual(json.loads(evidence.read_text()), result)
            self.assertTrue(Path(result['relocated_app']).exists())
            launcher.terminate.assert_called_once_with()

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


    def test_first_document_asset_failure_is_retained_when_reloaded_document_is_clean(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            app, output, relocation = root / 'Fixture.app', root / 'evidence', root / 'relocation'
            for path in (app, output, relocation): path.mkdir()
            evidence = output / 'workspace-direct.json'
            documents = [{'phase': 'before-reload', 'complete': True, 'offline_ok': False,
                          'resources': ['https://outside.invalid/font.woff'], 'errors': ['first error']},
                         {'phase': 'after-reload', 'complete': True, 'offline_ok': True,
                          'resources': ['http://127.0.0.1:351/local.js'], 'errors': []}]
            launcher = Mock(returncode=0)
            def finished(**_):
                evidence.write_text(json.dumps({'passed': False, 'engine_reaped': True,
                    'profile_removed': True, 'asset_documents': documents,
                    'checks': {'offline-assets': {'status': 'fail', 'detail': 'First document failed'}}}))
                return 0
            launcher.wait.side_effect = finished
            with patch('workspace.tempfile.mkdtemp', return_value=str(relocation)), \
                    patch('workspace.console_state', return_value={'prior_pid': 0, 'prior_bundle_id': '', 'screen_locked': True}), \
                    patch('workspace.subprocess.Popen', return_value=launcher), contextlib.redirect_stdout(io.StringIO()):
                result = run_case(app, output, 'workspace-direct')
            self.assertFalse(result['passed'])
            self.assertEqual(result['asset_documents'], documents)
            self.assertEqual(json.loads(evidence.read_text())['asset_documents'], documents)
            self.assertEqual(result['checks']['offline-assets']['status'], 'fail')


class ManualBudgetTests(unittest.TestCase):
    def test_slow_staging_keeps_full_operator_window_plus_owned_cleanup(self):
        for stage_seconds in (0, 60, 250):
            with self.subTest(stage_seconds=stage_seconds), tempfile.TemporaryDirectory() as raw:
                evidence = Path(raw) / 'manual.json'
                clock = [0.0]
                launcher = Mock(args=['inert-open-W'], returncode=None)
                launcher.poll.return_value = None
                def wait(*, timeout):
                    if clock[0] < stage_seconds:
                        clock[0] += timeout
                        if clock[0] >= stage_seconds:
                            evidence.write_text(json.dumps({'manual_stage_ready': True}))
                        raise __import__('subprocess').TimeoutExpired(launcher.args, timeout)
                    self.assertEqual(timeout, 930)
                    clock[0] += 900 + 23
                    return 0
                if stage_seconds == 0:
                    evidence.write_text(json.dumps({'manual_stage_ready': True}))
                launcher.wait.side_effect = wait
                with patch('workspace.time.monotonic', side_effect=lambda: clock[0]):
                    self.assertEqual(wait_for_case(launcher, evidence, 'workspace-manual'), 0)
                self.assertGreaterEqual(clock[0], stage_seconds + 923)

    def test_missing_or_nonboolean_manual_checkpoint_has_bounded_staging(self):
        import subprocess
        for value in (None, 1, 'true', False):
            with self.subTest(value=value), tempfile.TemporaryDirectory() as raw:
                evidence = Path(raw) / 'manual.json'
                if value is not None:
                    evidence.write_text(json.dumps({'manual_stage_ready': value}))
                clock = [0.0]
                launcher = Mock(args=['inert-open-W'])
                launcher.poll.return_value = None
                def wait(*, timeout):
                    self.assertLessEqual(timeout, .25)
                    clock[0] += timeout
                    raise subprocess.TimeoutExpired(launcher.args, timeout)
                launcher.wait.side_effect = wait
                with patch('workspace.time.monotonic', side_effect=lambda: clock[0]), self.assertRaises(subprocess.TimeoutExpired):
                    wait_for_case(launcher, evidence, 'workspace-manual')
                self.assertEqual(clock[0], 300)

    def test_early_exit_and_nonmanual_budget_keep_existing_behavior(self):
        launcher = Mock(args=['inert'], returncode=17)
        launcher.poll.return_value = 17
        launcher.wait.return_value = 17
        self.assertEqual(wait_for_case(launcher, Path('never-read'), 'workspace-manual'), 17)
        launcher.wait.assert_called_once_with(timeout=0)
        launcher.reset_mock()
        self.assertEqual(wait_for_case(launcher, Path('never-read'), 'workspace-direct'), 17)
        launcher.wait.assert_called_once_with(timeout=300)


class WorkspaceBuilderTests(unittest.TestCase):
    """Exercise shell composition with inert writers; never compile or launch NAC."""

    def build_fixture(self, directory, *, fail_mode='', ordinary_marker='ordinary fixture'):
        import os
        import subprocess

        root = Path(directory)
        owner = root / 'desktop/macos'
        owner.mkdir(parents=True)
        (owner / 'workspace.sh').write_bytes((Path(__file__).parent / 'workspace.sh').read_bytes())
        builder = owner / 'preview.sh'
        builder.write_text('''#!/bin/bash
set -euo pipefail
echo "$1" >> "$NAC_MAC_OUTPUT/calls"
if [[ "$1" == "$FAIL_MODE" ]]; then exit 17; fi
case "$1" in
build) name='NAC Development Preview.app'; text="$ORDINARY_MARKER" ;;
smoke-build) name='NAC Development Preview Smoke.app'; text='WK_RICH_COMPLETE smoke fixture' ;;
*) exit 99 ;;
esac
mkdir -p "$NAC_MAC_OUTPUT/$name/Contents/MacOS"
printf '%s' "$text" > "$NAC_MAC_OUTPUT/$name/Contents/MacOS/NACPreview"
''')
        builder.chmod(0o755)
        # This writer records only which test bundle was selected, not real provenance.
        (owner / 'workspace.py').write_text('''import json, sys
from pathlib import Path
assert sys.argv[1] == 'capture-build'
app = Path(sys.argv[2])
(app.parent / 'capture.json').write_text(json.dumps({'app': app.name}))
''')
        output = root / 'output'
        output.mkdir()
        fake_bin = root / 'bin'
        fake_bin.mkdir()
        for command in ('xcrun', 'cargo'):
            blocked = fake_bin / command
            blocked.write_text('#!/bin/sh\nexit 99\n')
            blocked.chmod(0o755)
        result = subprocess.run(['bash', str(owner / 'workspace.sh')], cwd=root,
                                env={**os.environ, 'PATH': str(fake_bin) + ':' + os.environ['PATH'],
                                     'NAC_MAC_ENGINE': 'inert-unused-fixture', 'NAC_MAC_OUTPUT': str(output),
                                     'FAIL_MODE': fail_mode, 'ORDINARY_MARKER': ordinary_marker},
                                capture_output=True, text=True, timeout=10)
        return result, output

    def test_current_writer_keeps_normal_and_smoke_bundles_separate(self):
        with tempfile.TemporaryDirectory() as temporary:
            result, output = self.build_fixture(temporary)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual((output / 'calls').read_text().splitlines(), ['build', 'smoke-build'])
            ordinary = output / 'NAC Development Preview.app/Contents/MacOS/NACPreview'
            smoke = output / 'NAC Development Preview Smoke.app/Contents/MacOS/NACPreview'
            self.assertEqual(ordinary.read_text(), 'ordinary fixture')
            self.assertEqual((output / 'normal-preview').read_bytes(), ordinary.read_bytes())
            self.assertIn('WK_RICH_COMPLETE', smoke.read_text())
            self.assertEqual(json.loads((output / 'capture.json').read_text()),
                             {'app': 'NAC Development Preview Smoke.app'})

    def test_failed_build_or_ordinary_instrumentation_never_captures_a_candidate(self):
        for fail_mode, marker, calls in [('build', 'ordinary', ['build']),
                                         ('smoke-build', 'ordinary', ['build', 'smoke-build']),
                                         ('', 'WK_RICH_COMPLETE', ['build'])]:
            with self.subTest(fail_mode=fail_mode, marker=marker), tempfile.TemporaryDirectory() as temporary:
                result, output = self.build_fixture(temporary, fail_mode=fail_mode, ordinary_marker=marker)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual((output / 'calls').read_text().splitlines(), calls)
                self.assertFalse((output / 'capture.json').exists())

    def test_current_builder_limits_workspace_sources_to_preview_smoke_modes(self):
        import subprocess

        source = (Path(__file__).parent / 'preview.sh').read_text()
        selection = source[source.index('local_app=0'):source.index('[[ "$(uname -s)"')]
        arrays = source[source.index('sources=('):source.index('receipt_inputs=')]
        workspace = {'WorkspaceSmoke.swift', 'WorkspaceFixture.swift',
                     'WorkspaceJourneys.swift', 'WorkspaceLegacy.swift'}
        for mode in ('build', 'smoke', 'smoke-build', 'app-build', 'startup-build',
                     'instance-build', 'lifecycle-build', 'auth-build', 'attention-build'):
            with self.subTest(mode=mode):
                # Evaluate only the current writer's array declarations and mode tests.
                probe = ('mode=$1\n' + selection + arrays +
                         '\nprintf "%s\\n" "${sources[@]}" __FLAGS__ "${flags[@]}"\n')
                result = subprocess.run(['bash', '-c', probe, 'source-list', mode],
                                        capture_output=True, text=True, timeout=5, check=True)
                names, flags = result.stdout.split('__FLAGS__\n')
                names = {Path(value).name for value in names.splitlines()}
                self.assertEqual(names.intersection(workspace), workspace if mode.startswith('smoke') else set())
                self.assertIn('NativeCommands.swift', names)
                self.assertIn('WorkspaceRecovery.swift', names)
                self.assertIn('WorkspaceStorage.swift', names)
                if mode in ('app-build', 'startup-build', 'instance-build', 'lifecycle-build', 'auth-build', 'attention-build'):
                    self.assertIn('LOCAL_APP', flags.splitlines())
                    self.assertFalse(names.intersection({'PreviewProfile.swift', 'FixtureProvider.swift',
                                                         'FixtureBootstrap.swift', 'PreviewSmoke.swift'}))
                if mode == 'app-build':
                    self.assertNotIn('PREVIEW_SMOKE', flags.splitlines())
                    self.assertEqual(len(names), 39)
                if mode == 'lifecycle-build':
                    self.assertEqual(len(names), 41)
                if mode == 'auth-build':
                    self.assertIn('NATIVE_AUTH_FIXTURE', flags.splitlines())
                    self.assertIn('DeviceAuthSmoke.swift', names)
                if mode == 'attention-build':
                    self.assertEqual(len(names), 41)
                    self.assertIn('ATTENTION_SMOKE', flags.splitlines())
                    self.assertIn('AttentionFixtureGuard.swift', names)
                if 'LOCAL_APP' in flags.splitlines():
                    self.assertIn('UserNotifications', flags.splitlines())
        self.assertNotIn('xcrun', (Path(__file__).parent / 'workspace.sh').read_text())


if __name__ == '__main__':
    unittest.main()
