"""Actual auth cleanup owners through inert ports; real-stub class is separate.

No test invokes AppKit, a browser, a provider listener or a product binary.
"""
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import uuid

import device_auth_contract as contract
import device_auth_profile as profiles
import device_auth_smoke as device
import external_auth_fixture as fixtures
import external_auth_smoke as external


BUILD = {'product_version': 'test', 'build_id': 'dev-' + 'a' * 40,
         'source_revision': 'a' * 40, 'track': 'dev'}
MARKED = {**BUILD, 'build_id': 'native-auth-fixture-v1-' + 'a' * 40}


class Client:
    def __init__(self, running=False, stop_error=None, wait_error=None):
        self.returncode = None if running else 0
        self.stop_error = stop_error
        self.wait_error = wait_error
        self.terminated = self.killed = False
        self.waits = []

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True
        if self.stop_error:
            raise self.stop_error

    def kill(self):
        self.killed = True

    def wait(self, timeout):
        self.waits.append(timeout)
        if self.wait_error:
            error, self.wait_error = self.wait_error, None
            raise error
        if self.returncode is None:
            self.returncode = 0
        return self.returncode


class Listener:
    origin = 'http://127.0.0.1:43123'
    exit_error = None

    def __init__(self, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, kind, primary, traceback):
        if self.exit_error:
            if primary is not None:
                fixtures.cleanup_note(primary, 'Inert listener close', self.exit_error)
            else:
                raise self.exit_error

    def snapshot(self):
        return {'events': [{'kind': 'device_browser', 'webkit_fixture': False}]}


class AuthFixtureCustodyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='nac-auth-inert-test-')
        self.root = Path(self.temporary.name)
        self.source = self.root / 'Source.app'
        resources = self.source / 'Contents/Resources'
        resources.mkdir(parents=True)
        (resources / 'nac-web').write_bytes(b'inert engine bytes, never executed')
        native = self.source / 'Contents/MacOS/NACPreview'
        native.parent.mkdir()
        native.write_bytes(b'inert native bytes, never executed')
        self.sentinel = self.root / 'unrelated-sentinel'
        self.sentinel.write_bytes(b'preserve unrelated bytes')
        self.relocations = []
        self.profile_roots = []
        self.owner_sentinels = {}
        self.write_receipt(BUILD, False)

    def tearDown(self):
        for root in self.relocations + self.profile_roots:
            if root.exists():
                shutil.rmtree(root)
        self.temporary.cleanup()

    def write_receipt(self, build, marked):
        resources = self.source / 'Contents/Resources'
        receipt = {'engine_identity': build, 'source_head': build['source_revision'], 'source_dirty': False,
                   'mode': 'auth-build' if marked else 'smoke-build', 'smoke_instrumentation': True,
                   'normal_startup': False, 'bundle_identifier': 'ai.arcee.nac.native-auth-fixture',
                   'compiler_flags': ['LOCAL_APP', 'PREVIEW_SMOKE', 'NATIVE_AUTH_FIXTURE'] if marked else ['PREVIEW_SMOKE'],
                   'engine_sha256': hashlib.sha256((resources / 'nac-web').read_bytes()).hexdigest(),
                   'native_sha256': hashlib.sha256((self.source / 'Contents/MacOS/NACPreview').read_bytes()).hexdigest()}
        (resources / 'build-receipt.json').write_text(json.dumps(receipt))

    def terminal(self, scenario='external-auth', build=BUILD, store=None):
        root = Path(tempfile.gettempdir()).resolve() / ('nac-mac-preview-' + str(uuid.uuid4()))
        record = {'scenario': scenario, 'passed': True, 'commands_retired': True, 'stopped': True,
                  'engine_reaped': True, 'identity_retired': True, 'profile_removed': True,
                  'app_pid': 12345, 'engine_pid': 12346, 'launch_incarnation': str(uuid.uuid4()),
                  'ready_source': build['source_revision'], 'ready_build': build['build_id'],
                  'ready_track': build['track'], 'profile': str(root),
                  'ready_store': str(store or root / 'store.db'), 'selected_store': str(store),
                  'external_browser_observed': True}
        if scenario == 'external-auth':
            recorder = str(uuid.uuid4())
            runtime = {'source_revision': build['source_revision'], 'build_id': build['build_id'],
                       'schema_version': 50, 'scenario': 'native-external-auth',
                       'store_engine': 'sqlite', 'journal_mode': 'wal'}
            rows = [{'name': 'nac.mcp.oauth.callback.' + name, 'kind': 'diagnostic', 'outcome': outcome,
                     'timestamp_unix_ms': 1, 'export_recorder_id': recorder,
                     'correlation': {'generation': 7}, 'runtime': runtime}
                    for name, outcome in [('listening', 'started'), ('state_rejected', 'error')]]
            proof = {'source': build['source_revision'], 'build': build['build_id'], 'schema': 50,
                     'engine_pid': record['engine_pid'], 'engine_incarnation': record['launch_incarnation'],
                     'document': str(uuid.uuid4()), 'view': str(uuid.uuid4()),
                     'launch': record['launch_incarnation'], 'recorder_id': recorder, 'owner': '7',
                     'rejection_observed_ns': '100', 'cancel_issued_ns': '101',
                     'token_counts_before': [1, 1], 'token_counts_after': [1, 1], 'observations': rows,
                     'state_rejection_observed': True, 'rejection_before_cancel': True,
                     'complete_stream_capture': False}
            final = {'process_id': record['engine_pid'], 'recorder_id': recorder, 'runtime': runtime,
                     'final_receipt': True, 'capacity': 1024, 'receipt_failures': 0,
                     'stats': {'accepted': 2, 'exported': 2, 'dropped': 0, 'failures': 0}}
            record.update(ready_schema=50,
                          external_auth={'wrong_state_rejected_then_canceled': True,
                                         'wrong_state_callback_witness': proof},
                          engine_log_after_shutdown='nac-telemetry-export ' + json.dumps(final) + '\n')
        return record

    def exercise(self, *, marked=False, receipt='complete', changes=None, spawn_error=None,
                 client=None, restart_error=None, inspection=None, listener_error=None, notice_error=False,
                 clock_values=None):
        build = MARKED if marked else BUILD
        self.write_receipt(build, marked)
        source_bytes = {str(f.relative_to(self.source)): f.read_bytes() for f in self.source.rglob('*') if f.is_file()}
        output = self.root / ('output-' + str(uuid.uuid4()))
        original_mkdtemp = tempfile.mkdtemp
        original_profile = profiles.DeviceProfile
        seen = []

        def allocate(*args, **kwargs):
            path = original_mkdtemp(*args, **kwargs)
            self.relocations.append(Path(path))
            return path

        def profile(*args):
            value = original_profile(*args)
            self.profile_roots.append(value.root)
            self.owner_sentinels[value.root] = (value.root / '.native-auth-fixture-owner.json').read_bytes()
            return value

        def popen(arguments, **kwargs):
            seen.append(arguments)
            if spawn_error or (restart_error and len(seen) > 1):
                raise spawn_error or restart_error
            evidence = Path(arguments[arguments.index('--smoke-output') + 1])
            scenario = arguments[arguments.index('--smoke-scenario') + 1]
            store = Path(arguments[arguments.index('--store-path') + 1]) if marked else None
            record = self.terminal(scenario, build, store)
            record.update(changes or {})
            if receipt != 'missing':
                evidence.write_text('{' if receipt == 'malformed' else json.dumps(record))
            return client or Client()

        primary = None
        with ExitStack() as stack:
            stack.enter_context(patch.object(external, 'require_isolated_host', return_value={'observed': True, 'locked': False}))
            stack.enter_context(patch.object(device, 'require_isolated_host', return_value={'observed': True, 'locked': False}))
            stack.enter_context(patch.object(external, 'AuthFixture', Listener))
            stack.enter_context(patch.object(device, 'AuthFixture', Listener))
            stack.enter_context(patch.object(Listener, 'exit_error', listener_error))
            stack.enter_context(patch.object(device, 'DeviceProfile', side_effect=profile))
            stack.enter_context(patch.object(device, 'identity', return_value=build))
            stack.enter_context(patch.object(subprocess, 'check_output', return_value=json.dumps(build)))
            stack.enter_context(patch.object(subprocess, 'run', return_value=inspection or SimpleNamespace(returncode=1, stdout='', stderr='')))
            stack.enter_context(patch.object(subprocess, 'Popen', side_effect=popen))
            stack.enter_context(patch.object(tempfile, 'mkdtemp', side_effect=allocate))
            # This also makes the old source safe for its meaningful RED run.
            if hasattr(external, 'cleanup_failed_case'):
                stack.enter_context(patch.object(external, 'cleanup_failed_case'))
            if hasattr(device, 'cleanup_failed_case'):
                stack.enter_context(patch.object(device, 'cleanup_failed_case'))
            stack.enter_context(patch('sys.argv', ['runner', str(self.source), str(output)]))
            stack.enter_context(patch.object(external.time, 'monotonic', return_value=0.0,
                side_effect=clock_values if clock_values is not None else
                    ([0, 181] if client and client.returncode is None else None)))
            stack.enter_context(patch('builtins.print', side_effect=OSError('notice failure') if notice_error else None))
            try:
                (device.main if marked else external.main)()
            except BaseException as error:
                primary = error
        self.assertEqual({str(f.relative_to(self.source)): f.read_bytes() for f in self.source.rglob('*') if f.is_file()}, source_bytes)
        self.assertEqual(self.sentinel.read_bytes(), b'preserve unrelated bytes')
        self.assertEqual((self.source / 'Contents/Resources/nac-web').read_bytes(), b'inert engine bytes, never executed')
        return primary, output, seen

    def retained(self):
        self.assertTrue(self.relocations)
        self.assertTrue(all(root.exists() for root in self.relocations))
        for root in self.profile_roots:
            self.assertTrue(root.exists())
            self.assertEqual((root / '.native-auth-fixture-owner.json').read_bytes(), self.owner_sentinels[root])

    def test_ambiguous_spawn_retains_actual_main_relocation(self):
        primary = RuntimeError('ambiguous launch')
        error, output, seen = self.exercise(spawn_error=primary)
        self.assertIs(error, primary)
        self.retained()
        self.assertFalse((output / 'browser-observations.json').exists())

    def test_missing_and_malformed_actual_main_evidence_retains(self):
        for receipt in ['missing', 'malformed']:
            with self.subTest(receipt=receipt):
                error, _, _ = self.exercise(receipt=receipt)
                self.assertIsNotNone(error)
                self.retained()

    def test_partial_wrong_case_source_build_store_and_typed_ids_retain(self):
        for changes in [{'passed': False}, {'commands_retired': False}, {'scenario': 'old-case'},
                        {'ready_source': 'old'}, {'ready_build': 'old'}, {'ready_track': 'other'},
                        {'ready_store': '/other/store'}, {'launch_incarnation': ''},
                        {'app_pid': True}, {'engine_pid': -1}, {'engine_pid': 0}, {'profile': '/unrelated'}]:
            with self.subTest(changes=changes):
                error, _, _ = self.exercise(changes=changes)
                self.assertIsNotNone(error)
                self.retained()

    def test_denied_failed_empty_and_live_inspection_are_unknown(self):
        for result in [SimpleNamespace(returncode=1, stdout='', stderr='denied'),
                       SimpleNamespace(returncode=2, stdout='', stderr=''),
                       SimpleNamespace(returncode=0, stdout='', stderr=''),
                       SimpleNamespace(returncode=0, stdout='12345 S', stderr='')]:
            with self.subTest(result=result):
                error, _, _ = self.exercise(inspection=result)
                self.assertIsNotNone(error)
                self.retained()

    def test_timeout_and_client_teardown_preserve_primary_and_notice_failure(self):
        error, _, _ = self.exercise(client=Client(running=True, stop_error=OSError('client stop failed')), notice_error=True)
        self.assertIsInstance(error, TimeoutError)
        self.assertTrue(any('client retirement' in note for note in error.__notes__))
        self.assertTrue(any('retention notice' in note for note in error.__notes__))
        self.retained()
        error, _, _ = self.exercise(clock_values=[0, 181])
        self.assertIsInstance(error, TimeoutError)
        self.retained()

    def test_nonzero_launch_and_marked_bad_receipt_retain(self):
        client = Client()
        client.returncode = 17
        error, _, _ = self.exercise(client=client)
        self.assertIsInstance(error, AssertionError)
        self.retained()
        error, _, _ = self.exercise(marked=True, changes={'selected_store': '/foreign/store'})
        self.assertIsInstance(error, AssertionError)
        self.retained()

    def test_original_handle_wait_fallback_is_bounded(self):
        client = Client(running=True, wait_error=subprocess.TimeoutExpired('client', 5))
        external.retire_client(client)
        self.assertEqual(client.waits, [5, 3])
        self.assertTrue(client.terminated and client.killed)

    def test_positive_terminal_removes_only_owned_relocation(self):
        error, output, _ = self.exercise()
        self.assertIsNone(error)
        self.assertTrue((output / 'browser-observations.json').exists())
        self.assertTrue(all(not root.exists() for root in self.relocations))
        for changes in [{'external_auth': {}}, {'engine_log_after_shutdown': ''}]:
            with self.subTest(incomplete_witness=changes):
                error, _, _ = self.exercise(changes=changes)
                self.assertIsInstance(error, AssertionError)
                self.assertTrue(self.relocations[-1].exists())

    def test_device_success_then_restart_spawn_failure_retains_same_profile(self):
        primary = RuntimeError('restart launch uncertain')
        error, output, seen = self.exercise(marked=True, restart_error=primary)
        self.assertIs(error, primary)
        self.assertEqual(len(seen), 2)
        self.assertEqual(len(self.profile_roots), 1)
        self.retained()
        self.assertFalse((output / 'results.json').exists())

    def test_device_listener_failure_retains_profile_and_bundle(self):
        primary = OSError('listener close failed')
        error, _, _ = self.exercise(marked=True, listener_error=primary)
        self.assertIs(error, primary)
        self.retained()

    def test_device_positive_all_profiles_removed(self):
        error, output, seen = self.exercise(marked=True)
        self.assertIsNone(error)
        self.assertEqual(len(seen), 7)
        self.assertTrue(json.loads((output / 'results.json').read_text())['all_owned_profiles_removed'])
        self.assertTrue(all(not root.exists() for root in self.relocations + self.profile_roots))

    def test_profile_body_exception_and_pending_launch_retain(self):
        with patch.object(profiles.subprocess, 'run'):
            profile = profiles.DeviceProfile(MARKED, Listener.origin)
        self.profile_roots.append(profile.root)
        primary = RuntimeError('body failed')
        profile.__exit__(RuntimeError, primary, None)
        self.assertTrue(profile.root.exists())
        profile.begin_launch()
        with self.assertRaisesRegex(RuntimeError, 'retained'):
            profile.__exit__(None, None, None)
        self.assertTrue(profile.root.exists())

    def test_canonical_store_alias_and_unsettled_relaunch_guard(self):
        with patch.object(profiles.subprocess, 'run'):
            profile = profiles.DeviceProfile(MARKED, Listener.origin)
        self.profile_roots.append(profile.root)
        record = self.terminal('device-success', MARKED, profile.store)
        record['ready_store'] = str(profile.store).replace('/private/tmp/', '/tmp/')
        record['selected_store'] = record['ready_store']
        with patch.object(external.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout='', stderr='')):
            external.require_terminal(record, 'device-success', MARKED, profile)
        profile.begin_launch()
        with self.assertRaisesRegex(RuntimeError, 'unresolved'):
            profile.begin_launch()
        self.assertTrue(profile.pending_launch)

    def test_direct_ambiguous_spawn_retains_actual_profile_and_closes_channels(self):
        with patch.object(profiles.subprocess, 'run'):
            profile = profiles.DeviceProfile(MARKED, Listener.origin)
        self.profile_roots.append(profile.root)
        parent, child = Mock(), Mock()
        primary = RuntimeError('ambiguous direct spawn')
        with patch.object(contract.socket, 'socketpair', return_value=(parent, child)), \
                patch.object(contract.subprocess, 'Popen', side_effect=primary):
            with self.assertRaises(RuntimeError) as raised:
                with profile:
                    contract.OwnedDesktop(Path('/never-executed'), MARKED, profile, self.root / 'ambiguous.log')
        self.assertIs(raised.exception, primary)
        self.assertTrue(profile.pending_launch and profile.root.exists())
        parent.close.assert_called_once()
        child.close.assert_called_once()

    def test_profile_changed_sentinel_refuses_removal(self):
        with patch.object(profiles.subprocess, 'run'):
            profile = profiles.DeviceProfile(MARKED, Listener.origin)
        self.profile_roots.append(profile.root)
        (profile.root / '.native-auth-fixture-owner.json').write_text('{}')
        with self.assertRaisesRegex(AssertionError, 'changed'):
            profile.__exit__(None, None, None)
        self.assertTrue(profile.root.exists())

    def test_replaced_relocation_root_is_not_removed(self):
        with self.assertRaisesRegex(AssertionError, 'replaced'):
            with external.relocated_app(self.source, self.root / 'evidence', 'nac-auth-replacement-test-') as (app, custody):
                original = app.parent
                backup = original.with_name(original.name + '-retained')
                original.rename(backup)
                original.mkdir()
                (original / 'unrelated').write_bytes(b'preserve replacement')
                self.relocations.extend([original, backup])
        self.assertEqual((original / 'unrelated').read_bytes(), b'preserve replacement')
        self.assertTrue(backup.exists())

    def test_profile_constructor_cleanup_error_keeps_original(self):
        run = uuid.uuid4()
        root = Path('/tmp').resolve() / ('nac-native-auth-fixture-' + str(run))
        self.profile_roots.append(root)
        primary = RuntimeError('profile preparation failed')
        with patch.object(profiles.uuid, 'uuid4', return_value=run), \
                patch.object(profiles.subprocess, 'run', side_effect=primary), \
                patch.object(profiles.shutil, 'rmtree', side_effect=OSError('removal failed')):
            with self.assertRaises(RuntimeError) as raised:
                profiles.DeviceProfile(MARKED, Listener.origin)
        self.assertIs(raised.exception, primary)
        self.assertTrue(root.exists())
        self.assertTrue(any('construction cleanup' in note for note in primary.__notes__))

    def test_profile_normal_removal_failure_is_nonzero(self):
        with patch.object(profiles.subprocess, 'run'):
            profile = profiles.DeviceProfile(MARKED, Listener.origin)
        self.profile_roots.append(profile.root)
        failure = OSError('removal failed')
        with patch.object(profiles.shutil, 'rmtree', side_effect=failure):
            with self.assertRaises(OSError) as raised:
                profile.__exit__(None, None, None)
        self.assertIs(raised.exception, failure)
        self.assertTrue(profile.root.exists())

    def test_relocation_removal_and_log_close_failures_do_not_pass(self):
        with patch.object(external.shutil, 'rmtree', side_effect=OSError('removal failed')):
            error, _, _ = self.exercise()
        self.assertIsInstance(error, OSError)
        self.retained()
        primary = RuntimeError('scenario failed')
        log = Mock()
        log.close.side_effect = OSError('close failed')
        external.close_launch(Client(running=True, stop_error=OSError('client failed')), log, primary)
        self.assertEqual(len(primary.__notes__), 2)
        log.close.assert_called_once()

    def test_success_then_replayed_incarnation_is_rejected(self):
        with patch.object(profiles.subprocess, 'run'):
            profile = profiles.DeviceProfile(MARKED, Listener.origin)
        self.profile_roots.append(profile.root)
        incarnation = str(uuid.uuid4())
        profile.begin_launch()
        profile.finish_launch(incarnation)
        profile.begin_launch()
        record = self.terminal('device-restart', MARKED, profile.store)
        record['launch_incarnation'] = incarnation
        with self.assertRaisesRegex(AssertionError, 'reused'):
            external.require_terminal(record, 'device-restart', MARKED, profile)
        self.assertTrue(profile.pending_launch)

    def test_listener_attempts_all_closes_preserving_original(self):
        fixture = fixtures.AuthFixture.__new__(fixtures.AuthFixture)
        fixture.server = Mock()
        fixture.thread = Mock()
        fixture.server.shutdown.side_effect = OSError('shutdown')
        fixture.server.server_close.side_effect = OSError('close')
        fixture.thread.is_alive.return_value = True
        primary = RuntimeError('scenario failed')
        fixture.__exit__(RuntimeError, primary, None)
        fixture.server.server_close.assert_called_once()
        fixture.thread.join.assert_called_once_with(timeout=3)
        self.assertEqual(len(primary.__notes__), 3)
        with self.assertRaises(OSError):
            fixture.__exit__(None, None, None)

    def test_direct_owner_constructor_and_exit_keep_primary_and_close_independently(self):
        profile = Mock()
        profile.environment = {}
        profile.workspace = self.root
        profile.store = self.root / 'store.db'
        parent, child = Mock(), Mock()
        primary = RuntimeError('readiness failed')
        with patch.object(contract.socket, 'socketpair', return_value=(parent, child)), \
                patch.object(contract.subprocess, 'Popen', return_value=Client()), \
                patch.object(contract, 'record', side_effect=primary):
            with self.assertRaises(RuntimeError) as raised:
                contract.OwnedDesktop(Path('/never-executed'), MARKED, profile, self.root / 'direct.log')
        self.assertIs(raised.exception, primary)
        parent.close.assert_called_once()
        owner = contract.OwnedDesktop.__new__(contract.OwnedDesktop)
        owner.profile = profile
        owner.closed = False
        owner.process = Client(running=True)
        owner.incarnation = str(uuid.uuid4())
        owner.parent = Mock()
        owner.parent.sendall.side_effect = OSError('stop channel')
        owner.parent.close.side_effect = OSError('channel close')
        owner.log = Mock()
        owner.log.close.side_effect = OSError('log close')
        owner.__exit__(RuntimeError, primary, None)
        owner.log.close.assert_called_once()
        self.assertTrue(any('direct owner teardown' in note for note in primary.__notes__))


if __name__ == '__main__':
    unittest.main()
