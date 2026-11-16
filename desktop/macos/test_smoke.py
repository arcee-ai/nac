import json
from contextlib import ExitStack
import hashlib
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

import smoke
from smoke import cleanup_failed_case


class CleanupTests(unittest.TestCase):
    def test_mismatched_process_and_profile_remain_untouched(self):
        with tempfile.TemporaryDirectory(prefix='nac-mac-preview-') as temporary:
            root = Path(temporary)
            record = root / 'ownership.json'
            unrelated = subprocess.Popen(['/bin/sleep', '60'], start_new_session=True)
            try:
                record.write_text(json.dumps({'engine_pid': unrelated.pid, 'profile': str(root)}))
                with self.assertRaisesRegex(RuntimeError, 'mismatched'):
                    cleanup_failed_case(record, root / 'Other.app')
                self.assertIsNone(unrelated.poll())
                self.assertTrue(root.exists())
            finally:
                unrelated.terminate()
                unrelated.wait()

    def test_owned_process_group_and_fixture_are_removed(self):
        with tempfile.TemporaryDirectory(prefix='nac-smoke-cleanup-test-') as temporary:
            bundle = Path(temporary) / 'Owned.app'
            engine = bundle / 'Contents/Resources/nac-web'
            engine.parent.mkdir(parents=True)
            engine.write_text('#!/bin/sh\nwhile :; do /bin/sleep 1; done\n')
            engine.chmod(0o755)
            with tempfile.TemporaryDirectory(prefix='nac-mac-preview-') as profile:
                record = Path(temporary) / 'ownership.json'
                child = subprocess.Popen([str(engine)], start_new_session=True)
                try:
                    record.write_text(json.dumps({'engine_pid': child.pid, 'profile': profile}))
                    cleanup_failed_case(record, bundle)
                    child.wait(timeout=5)
                    self.assertIsNotNone(child.returncode)
                    self.assertFalse(Path(profile).exists())
                finally:
                    if child.poll() is None:
                        child.kill()
                        child.wait()


class MainCustodyTests(unittest.TestCase):
    def exercise(self, *, receipt='complete', actor_error=None, launch_error='timeout',
                 wrapper_error=False, wrapper_timeout=False, passed=True, stderr_error=None,
                 prepare_error=False):
        with tempfile.TemporaryDirectory(prefix='nac-smoke-main-control-') as sandbox:
            sandbox = Path(sandbox)
            app = sandbox / 'Source.app'
            for relative in ('Contents/Resources/nac-web', 'Contents/MacOS/NACPreview'):
                target = app / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b'inert fixture, never executed')
            (app / 'Contents/Resources/engine-identity.json').write_text('{"track":"dev"}')
            sentinel = sandbox / 'unrelated'
            sentinel.write_bytes(b'untouched')
            before = {str(f.relative_to(app)): hashlib.sha256(f.read_bytes()).hexdigest()
                      for f in app.rglob('*') if f.is_file()}
            profile = sandbox / 'owned-profile'
            profile.mkdir()
            (profile / 'keep').write_bytes(b'owned unresolved profile')
            roots = []
            real_mkdtemp = tempfile.mkdtemp

            def mkdtemp(suffix=None, prefix=None, dir=None):
                root = Path(real_mkdtemp(suffix=suffix, prefix=prefix, dir=sandbox))
                roots.append(root)
                return str(root)

            primary = (subprocess.TimeoutExpired('owned open wrapper', 115)
                       if launch_error == 'timeout' else RuntimeError('original launch failure'))
            launch = Mock(returncode=None)
            launch.poll.side_effect = lambda: launch.returncode
            teardown_waits = []

            def wait(timeout):
                if timeout == 115:
                    if launch_error is not None:
                        raise primary
                    launch.returncode = 0
                    if passed:
                        import shutil
                        shutil.rmtree(profile)
                    return 0
                teardown_waits.append(timeout)
                if wrapper_timeout and not launch.kill.called:
                    raise subprocess.TimeoutExpired('owned open wrapper', timeout)
                launch.returncode = 0
                return 0

            launch.wait.side_effect = wait
            if wrapper_error:
                launch.terminate.side_effect = OSError('owned wrapper stop failed')

            def popen(command, **options):
                self.assertEqual(command[:5], ['/usr/bin/open', '-n', '-W', '-a', str(roots[0] / 'Moved folder with spaces' / app.name)])
                evidence = Path(command[command.index('--smoke-output') + 1])
                record = dict(app_pid=1234, engine_pid=5678, passed=passed,
                              engine_reaped=True, profile_removed=True, identity_retired=True,
                              profile=str(profile))
                if receipt == 'partial':
                    record.pop('engine_pid')
                elif receipt == 'bool-pid':
                    record['engine_pid'] = True
                elif receipt == 'zero-engine':
                    record['engine_pid'] = 0
                if receipt == 'malformed':
                    evidence.write_text('{')
                elif receipt != 'missing':
                    evidence.write_text(json.dumps(record))
                return launch

            def cleanup(evidence, relocated):
                if actor_error:
                    raise RuntimeError(actor_error)
                import shutil
                shutil.rmtree(profile)

            def output(command, **options):
                if command[:2] == ['git', 'status']:
                    return ''
                return 'inert observation\n'

            cleanup_mock = Mock(side_effect=cleanup)
            control = Mock()
            control.finish.return_value = None
            failure = None
            with ExitStack() as stack:
                for target, replacement in [
                    ('sys.argv', ['smoke.py', str(app), str(sandbox / 'evidence')]),
                    ('tempfile.mkdtemp', mkdtemp),
                    ('subprocess.Popen', popen), ('subprocess.check_output', output),
                    ('run_contract', Mock()), ('socket.socket', Mock()),
                    ('threading.Thread', Mock()), ('LifecycleControl', Mock(return_value=control)),
                    ('session_lock_state', Mock(return_value=dict(observed=True, locked=True))),
                    ('alive', Mock(return_value=False)), ('cleanup_failed_case', cleanup_mock),
                ]:
                    stack.enter_context(patch.object(smoke, target, replacement) if '.' not in target
                                        else patch('smoke.' + target, replacement))
                if prepare_error:
                    stack.enter_context(patch('smoke.os.link', side_effect=primary))
                stack.enter_context(patch.dict('os.environ', {'NAC_MAC_SMOKE_SCENARIOS': 'normal'}))
                sink = Mock(write=Mock(side_effect=stderr_error)) if stderr_error else io.StringIO()
                stack.enter_context(patch('sys.stderr', sink))
                stack.enter_context(patch('sys.stdout', new_callable=io.StringIO))
                try:
                    smoke.main()
                except BaseException as error:
                    failure = error
            relocated = roots[0] / 'Moved folder with spaces' / app.name
            engine = relocated / 'Contents/Resources/nac-web'
            saved = engine.with_name('saved-engine')
            after = {str(f.relative_to(app)): hashlib.sha256(f.read_bytes()).hexdigest()
                     for f in app.rglob('*') if f.is_file()}
            self.assertEqual(before, after)
            self.assertEqual(sentinel.read_bytes(), b'untouched')
            return dict(failure=failure, primary=primary, retained=roots[0].exists(),
                        engine_retained=engine.exists(), saved_retained=saved.exists(),
                        profile_retained=profile.exists(), cleanup=cleanup_mock,
                        launcher=launch, teardown_waits=teardown_waits)

    def test_timeout_actor_refusal_keeps_custody_and_reaps_launcher(self):
        result = self.exercise(actor_error='mismatched actor ownership')
        self.assertTrue(result['retained'])
        self.assertIs(result['failure'], result['primary'])
        self.assertTrue(result['engine_retained'])
        self.assertTrue(result['saved_retained'])
        self.assertTrue(result['profile_retained'])
        result['launcher'].terminate.assert_called_once()
        self.assertEqual(result['teardown_waits'], [5])
        self.assertIn('mismatched actor ownership', '\n'.join(result['failure'].__notes__))

    def test_prelaunch_failure_keeps_primary_without_unbound_driver(self):
        result = self.exercise(prepare_error=True)
        self.assertIs(result['failure'], result['primary'])
        self.assertFalse(result['retained'])
        result['launcher'].terminate.assert_not_called()

    def test_incomplete_actor_receipts_never_establish_cleanup(self):
        for receipt in ('missing', 'malformed', 'partial', 'bool-pid', 'zero-engine'):
            with self.subTest(receipt=receipt):
                result = self.exercise(receipt=receipt)
                self.assertIs(result['failure'], result['primary'])
                self.assertTrue(result['retained'])
                self.assertTrue(result['profile_retained'])
                result['cleanup'].assert_not_called()
                result['launcher'].terminate.assert_called_once()
                self.assertEqual(result['teardown_waits'], [5])

    def test_failed_retention_notice_preserves_primary_failure_and_custody(self):
        result = self.exercise(actor_error='mismatched actor ownership',
                               stderr_error=BrokenPipeError('closed retention sink'))
        self.assertIs(result['failure'], result['primary'])
        self.assertIsInstance(result['failure'], subprocess.TimeoutExpired)
        self.assertTrue(result['retained'])
        self.assertTrue(result['engine_retained'])
        self.assertTrue(result['saved_retained'])
        self.assertTrue(result['profile_retained'])
        result['launcher'].terminate.assert_called_once()
        self.assertEqual(result['teardown_waits'], [5])
        notes = '\n'.join(result['failure'].__notes__)
        self.assertIn('retained app root', notes)
        self.assertIn('closed retention sink', notes)

    def test_timeout_with_settled_actors_removes_only_owned_relocation(self):
        result = self.exercise()
        self.assertIs(result['failure'], result['primary'])
        self.assertFalse(result['retained'])
        self.assertFalse(result['profile_retained'])
        result['cleanup'].assert_called_once()
        result['launcher'].terminate.assert_called_once()
        self.assertEqual(result['teardown_waits'], [5])

    def test_wrapper_failure_keeps_original_failure_and_custody(self):
        result = self.exercise(wrapper_error=True)
        self.assertIs(result['failure'], result['primary'])
        self.assertTrue(result['retained'])
        self.assertIn('owned wrapper stop failed', '\n'.join(result['failure'].__notes__))

    def test_owned_wrapper_timeout_has_bounded_kill_and_reap(self):
        result = self.exercise(wrapper_timeout=True)
        self.assertIs(result['failure'], result['primary'])
        self.assertFalse(result['retained'])
        result['launcher'].kill.assert_called_once()
        self.assertEqual(result['teardown_waits'], [5, 5])

    def test_non_timeout_launch_failure_also_retains_unsettled_actors(self):
        result = self.exercise(launch_error='other', actor_error='inspection refused')
        self.assertIs(result['failure'], result['primary'])
        self.assertTrue(result['retained'])
        result['launcher'].terminate.assert_called_once()

    def test_post_launch_assertion_failure_keeps_actor_custody(self):
        result = self.exercise(launch_error=None, passed=False, actor_error='inspection refused')
        self.assertIsInstance(result['failure'], AssertionError)
        self.assertTrue(result['retained'])
        self.assertTrue(result['profile_retained'])
        result['cleanup'].assert_called_once()
        result['launcher'].terminate.assert_not_called()

    def test_success_removes_relocation_without_actor_cleanup(self):
        result = self.exercise(launch_error=None)
        self.assertIsNone(result['failure'])
        self.assertFalse(result['retained'])
        result['cleanup'].assert_not_called()
        result['launcher'].terminate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
