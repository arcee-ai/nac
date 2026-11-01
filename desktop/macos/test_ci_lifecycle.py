"""Mocked hosted adapter controls. No native/process/console runtime evidence."""
from contextlib import ExitStack
import json
from pathlib import Path
import subprocess
import shutil
import tempfile
import unittest
from unittest import mock

import ci_lifecycle as adapter
import ci_lifecycle_contract as c
from test_ci_lifecycle_contract import HEAD, build, capsule, case, environment


def fixture_receipt(destination, scenario='run'):
    root = destination / 'nac-lifecycle-app-fixture'
    path = root / scenario / ('controls-' + scenario) / 'fixture.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({'session_id': 'MOCK-SESSION', 'approval_session_id': 'MOCK-APPROVAL',
        'descendant_pid': 999, 'goal_id': 'MOCK-GOAL', 'goal_status': 'paused',
        'terminal_id': 'MOCK-TERMINAL', 'provider_requests': ['transcript', 'goal', 'approval']}))
    return path


class CompositionControls(unittest.TestCase):
    def exercise(self, *, fail=None, locked=False, build_fail=False, cleanup_unknown=False, budget=False,
                 image_bytes=48, overflow=None, capacity_bad=False, partial_failure=None,
                 publication_fault=None, observation=None, report_oversize=False):
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            root = Path(tmp).resolve()
            raw, source, harness = root / 'raw', root / 'source', root / 'harness'
            for path in (raw, source, harness):
                path.mkdir()
            (harness / 'desktop/macos').mkdir(parents=True)
            (harness / 'desktop/macos/CILifecycleImages.swift').write_text('MOCK READER SOURCE')
            assets = source / 'crates/nac-server/assets/dist'
            assets.mkdir(parents=True)
            (assets / 'fixture.js').write_text('MOCK SOURCE ONLY')
            expected_assets = {'fixture.js': c.digest(assets / 'fixture.js')}
            env = dict(environment(), NAC_LIFECYCLE_CUSTODY=json.dumps(capsule()))
            stack.enter_context(mock.patch.dict(adapter.os.environ, env, clear=True))
            stack.enter_context(mock.patch.object(adapter, 'ROOT', harness))
            stack.enter_context(mock.patch.object(adapter, 'require_checkout'))
            stack.enter_context(mock.patch.object(adapter, 'require_source'))
            stack.enter_context(mock.patch.object(adapter, 'require_build', side_effect=lambda mode, *_: build(mode)))
            stack.enter_context(mock.patch.object(adapter, '_require_builds'))
            stack.enter_context(mock.patch.object(adapter.time, 'monotonic', return_value=0))
            stack.enter_context(mock.patch.object(adapter, 'images', return_value=[{'mock': name} for name in c.FRAMES]))
            if capacity_bad:
                stack.enter_context(mock.patch('ci_lifecycle_evidence.EXPORT_TOTAL', 1))
            if cleanup_unknown:
                stack.enter_context(mock.patch.object(adapter, 'audit_cleanup', return_value={
                    'complete': False, 'private_fixture_processes': [{'pid': 111}], 'retained_failure_roots': []}))
            called = []
            def command(argv, **_kwargs):
                if argv[-1] == '__desktop-identity':
                    return json.dumps(build()['engine_identity'])
                if 'console' in argv:
                    return json.dumps({'observed': True, 'locked': locked})
                if argv[0] == '/bin/ps':
                    return '1 Ss /sbin/launchd\n'
                if len(argv) > 1 and argv[1] == 'state':
                    return '{"apps":[]}'
                return ''
            def run(argv, _log, _timeout, **kwargs):
                if argv[0] == 'cargo':
                    if build_fail:
                        raise RuntimeError('mock setup/build failure before reservation')
                    binary = Path(kwargs['env']['CARGO_TARGET_DIR']) / 'debug/nac-web'
                    binary.parent.mkdir(parents=True)
                    binary.write_text('MOCK PRIVATE ENGINE; NEVER EXECUTED')
                elif argv[0] == 'bash':
                    folder = raw / 'lifecycle-builds'
                    (folder / 'InstanceObservation').write_text('MOCK OBSERVER; NEVER EXECUTED')
                elif argv[0] == 'xcrun':
                    Path(argv[-1]).write_text('MOCK READER; NEVER EXECUTED')
            def driver(argv, _log, child_env):
                name = child_env['NAC_LIFECYCLE_SCENARIOS']
                destination = raw / 'lifecycle' / name
                durable = json.loads((destination.parent / 'ledger.json').read_text())
                self.assertEqual(durable['active_case'], name)
                self.assertEqual(durable['cases'][name]['state'], 'dispatched')
                self.assertEqual(durable['cases'][name]['dispatches'], 1)
                self.assertEqual(json.loads((destination.parent / 'builds.json').read_text())
                                 ['export_capacity']['total'], 44040192)
                called.append(name)
                if fail == name:
                    raise KeyboardInterrupt('mock interruption; no OS signal')
                summary = case(name, build(), expected_assets, destination)
                if partial_failure == name:
                    summary['passed'] = False
                    summary['cases'][0]['native']['passed'] = False
                (destination / 'summary.json').write_text(json.dumps(summary))
                source_receipt = fixture_receipt(destination, name)
                adapter.ownership.retain(destination, name)
                shutil.rmtree(source_receipt.parents[2])
                folder = destination / name
                folder.mkdir()
                for frame in (c.FRAMES[:1] if partial_failure == name else c.FRAMES):
                    # Export capacity bytes only; never valid PNG/native/OCR evidence.
                    (folder / frame).write_bytes(b'SYNTHETIC EXPORT ONLY'.ljust(image_bytes, b'x'))
                if partial_failure == name:
                    (folder / 'native.json').write_text('{"passed":false,"diagnostic":"MOCK SECRET"}')
                    (destination / 'runner.log').write_text('MOCK failed driver SECRET; no process launched')
                    raise adapter.DriverFailure('mock driver failed after partial capture')
                if overflow == name:
                    (destination / 'oversized.json').write_bytes(b'x' * (12 * 1024 * 1024 + 1))
            stack.enter_context(mock.patch.object(adapter, 'run_case', side_effect=driver))
            original_persist = adapter.persist
            original_replace = c.os.replace
            def persist(path, value):
                if publication_fault == 'result' and Path(path).name == 'external-result.json' \
                        and Path(path).parent.name == partial_failure:
                    raise OSError('MOCK result persistence interrupted before Ledger.finish')
                return original_persist(path, value)
            def replace(source_path, destination_path):
                if publication_fault == 'ledger' and Path(destination_path).name == 'ledger.json':
                    pending = json.loads(Path(source_path).read_text())
                    if pending['cases'][partial_failure]['state'] in ('failed', 'unknown'):
                        raise OSError('MOCK ledger save interrupted before atomic replacement')
                return original_replace(source_path, destination_path)
            stack.enter_context(mock.patch.object(adapter, 'persist', side_effect=persist))
            stack.enter_context(mock.patch.object(c.os, 'replace', side_effect=replace))
            result, error = None, None
            try:
                result = adapter.qualify(raw, source, c.TARGET, HEAD, run, command, mock.Mock(),
                                         1 if budget else 10000, audit_command=command,
                                         report={'oversize': 'x' * 131072} if report_oversize else {})
            except BaseException as caught:
                error = caught
            ledger = json.loads((raw / 'lifecycle/ledger.json').read_text())
            ledger_before_export = (raw / 'lifecycle/ledger.json').read_bytes()
            if observation is not None:
                observation.update(ledger=ledger, primary=type(error).__name__, PNGs=len(list(raw.rglob('*.png'))))
            if overflow:
                receipt = raw / 'lifecycle' / overflow / 'external-result.json'
                outcome = json.loads(receipt.read_text())
                self.assertEqual(outcome['status'], 'unknown')
                self.assertLessEqual(len(outcome['export_error']), 4096)
                self.assertEqual(ledger['cases'][overflow]['receipt']['external_result_sha256'], c.digest(receipt))
            if result is not None or partial_failure:
                from ci_lifecycle_evidence import export_evidence
                output = root / 'export'
                export_evidence(raw, output, [('SECRET', '<redacted>')])
                self.assertEqual((raw / 'lifecycle/ledger.json').read_bytes(), ledger_before_export)
                pngs = list(raw.rglob('*.png'))
                self.assertEqual(len(pngs), 5 * c.CASES.index(partial_failure) + 1 if partial_failure else 15)
                for path in pngs:
                    self.assertEqual(path.read_bytes(), (output / path.relative_to(raw)).read_bytes())
                if partial_failure:
                    status = json.loads((output / 'failure-evidence.json').read_text())
                    self.assertTrue(status['incomplete'])
                    self.assertFalse(status['native_acceptance'])
                    failed = output / 'lifecycle' / partial_failure
                    self.assertFalse(json.loads((failed / 'summary.json').read_text())['passed'])
                    self.assertFalse(json.loads((failed / partial_failure / 'native.json').read_text())['passed'])
                    self.assertIn('<redacted>', (failed / 'runner.log').read_text())
                else:
                    result['synthetic_exported_PNGs'] = len(pngs)
            return result, error, ledger, called

    def test_order_and_durable_reservation_before_every_mock_driver(self):
        result, error, ledger, called = self.exercise()
        self.assertIsNone(error)
        self.assertEqual(called, list(c.CASES))
        self.assertEqual(ledger['phase'], 'complete')
        self.assertTrue(result['target_suite']['passed'])
        self.assertEqual([ledger['cases'][x]['dispatches'] for x in c.CASES], [1, 1, 1])

    def test_guard_build_and_budget_failures_reserve_zero_cases(self):
        for arguments in ({'locked': True}, {'build_fail': True}, {'budget': True},
                          {'capacity_bad': True}, {'report_oversize': True}):
            with self.subTest(arguments=arguments):
                result, error, ledger, called = self.exercise(**arguments)
                self.assertIsNone(result)
                self.assertIsNotNone(error)
                self.assertEqual(called, [])
                self.assertEqual([ledger['cases'][x]['dispatches'] for x in c.CASES], [0, 0, 0])

    def test_interruption_and_cleanup_unknown_stop_before_next_reservation(self):
        for arguments in ({'fail': 'run'}, {'cleanup_unknown': True}, {'fail': 'approval'}):
            with self.subTest(arguments=arguments):
                result, error, ledger, called = self.exercise(**arguments)
                self.assertIsNone(result)
                self.assertIsNotNone(error)
                expected = ['run', 'approval'] if arguments.get('fail') == 'approval' else ['run']
                self.assertEqual(called, expected)
                self.assertEqual(ledger['cases']['terminal']['dispatches'], 0)
                self.assertTrue(ledger['phase'].startswith('stopped_'))

    def test_three_mock_cases_export_fifteen_ceiling_images_without_extra_reservations(self):
        result, error, ledger, called = self.exercise(image_bytes=2 * 1024 * 1024)
        self.assertIsNone(error)
        self.assertEqual(called, list(c.CASES))
        self.assertEqual(result['synthetic_exported_PNGs'], 15)
        self.assertEqual([ledger['cases'][n]['dispatches'] for n in c.CASES], [1, 1, 1])

    def test_real_export_overflow_after_run_or_approval_persists_unknown_and_stops(self):
        for name in ('run', 'approval'):
            with self.subTest(name=name):
                result, error, ledger, called = self.exercise(overflow=name)
                self.assertIsNone(result)
                self.assertIsInstance(error, RuntimeError)
                self.assertEqual(called, list(c.CASES[:c.CASES.index(name) + 1]))
                self.assertEqual(ledger['cases'][name]['state'], 'unknown')
                self.assertEqual(ledger['phase'], 'stopped_unknown')
                self.assertEqual(ledger['cases']['terminal']['dispatches'], 0)

    def test_failed_mock_driver_keeps_partial_final_export_and_stops_after_allocated_prefix(self):
        for name in ('run', 'approval'):
            with self.subTest(name=name):
                result, error, ledger, called = self.exercise(partial_failure=name)
                self.assertIsNone(result)
                self.assertIsInstance(error, adapter.DriverFailure)
                self.assertEqual(called, list(c.CASES[:c.CASES.index(name) + 1]))
                self.assertEqual(ledger['phase'], 'stopped_unknown')
                self.assertEqual(ledger['cases'][name]['state'], 'unknown')
                self.assertEqual([ledger['cases'][n]['dispatches'] for n in c.CASES],
                                 [1, 0, 0] if name == 'run' else [1, 1, 0])

    def test_result_or_atomic_ledger_publication_failure_retains_dispatched_prefix_read_only(self):
        for name in ('run', 'approval'):
            for fault in ('result', 'ledger'):
                with self.subTest(name=name, fault=fault):
                    result, error, ledger, called = self.exercise(partial_failure=name, publication_fault=fault)
                    self.assertIsNone(result)
                    self.assertIsInstance(error, adapter.DriverFailure)
                    self.assertEqual(ledger['phase'], 'case_dispatched')
                    self.assertEqual(ledger['active_case'], name)
                    self.assertEqual(ledger['cases'][name]['state'], 'dispatched')
                    self.assertEqual(called, list(c.CASES[:c.CASES.index(name) + 1]))
                    self.assertEqual([ledger['cases'][n]['dispatches'] for n in c.CASES],
                                     [1, 0, 0] if name == 'run' else [1, 1, 0])


class DriverAndAuditControls(unittest.TestCase):
    def test_interrupted_owned_driver_gets_cleanup_grace_without_native_PID_signals(self):
        for first in (KeyboardInterrupt('mock handler callback'), subprocess.TimeoutExpired('mock', 300)):
            with tempfile.TemporaryDirectory() as tmp:
                child = mock.Mock()
                child.pid = 123
                child.wait.side_effect = [first, 0]
                child.poll.side_effect = [None, 0]
                with mock.patch.object(adapter.signal, 'pthread_sigmask', return_value=set()), \
                        mock.patch.object(adapter.time, 'monotonic', side_effect=[0, 0, 241]), \
                        self.assertRaises(type(first)):
                    adapter.run_case(['MOCK DRIVER'], Path(tmp).resolve() / 'runner.log',
                                     {'NAC_LIFECYCLE_SOURCE': tmp, 'NAC_LIFECYCLE_SCENARIOS': 'run'},
                                     spawn=lambda *_args, **_kwargs: child)
                child.terminate.assert_called_once()
                self.assertIn(mock.call(timeout=150), child.wait.call_args_list)

    def test_pending_cancel_is_delivered_only_after_direct_handle_is_owned(self):
        with tempfile.TemporaryDirectory() as tmp:
            child = mock.Mock()
            child.pid = 123
            child.poll.side_effect = [None, 0]
            original = KeyboardInterrupt('mock pending cancellation; no real signal')
            with mock.patch.object(adapter.signal, 'pthread_sigmask', side_effect=[set(), original]), \
                    self.assertRaises(KeyboardInterrupt) as caught:
                adapter.run_case(['MOCK DRIVER'], Path(tmp) / 'runner.log',
                                 {'NAC_LIFECYCLE_SOURCE': tmp}, spawn=lambda *_a, **_k: child)
            self.assertIs(caught.exception, original)
            child.terminate.assert_called_once()
            child.wait.assert_called_once_with(timeout=150)

    def test_fixed_driver_requires_matching_reserved_capsule_and_single_case(self):
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            root = Path(tmp).resolve()
            source, control = root / 'supplier', root / 'lifecycle'
            source.mkdir()
            control.mkdir()
            destination = control / 'run'
            destination.mkdir()
            folder = root / 'lifecycle-builds'
            app = folder / c.MODES['lifecycle-build']
            app.mkdir(parents=True)
            observer = folder / 'InstanceObservation'
            observer.write_text('MOCK OBSERVER; not executable')
            (control / 'builds.json').write_text(json.dumps({'observer_sha256': c.digest(observer), 'engine_sha256': 'mock'}))
            value = {'active_case': 'run', 'phase': 'case_dispatched', 'run_id': '123', 'capsule': capsule(),
                     'cases': {'run': {'state': 'dispatched', 'dispatches': 1, 'output': str(destination),
                                       'console': {'observed': True, 'locked': False}, 'execution': {
                                           'source_sha': c.SOURCE, 'harness_sha': HEAD,
                                           'builds_sha256': c.digest(control / 'builds.json'),
                                           'observer_sha256': c.digest(observer),
                                           'command': adapter.child_command('driver', source, 'run', app, destination, observer)}}}}
            (control / 'ledger.json').write_text(json.dumps(value))
            env = dict(environment(), NAC_LIFECYCLE_CUSTODY=json.dumps(capsule()),
                       NAC_LIFECYCLE_CONTROLLER=str(control), NAC_LIFECYCLE_SCENARIOS='run')
            stack.enter_context(mock.patch.dict(adapter.os.environ, env, clear=True))
            stack.enter_context(mock.patch.object(adapter, 'require_checkout'))
            stack.enter_context(mock.patch.object(adapter, 'require_source'))
            stack.enter_context(mock.patch.object(adapter, 'require_build'))
            stack.enter_context(mock.patch.object(adapter.signal, 'signal'))
            stack.enter_context(mock.patch.object(adapter.signal, 'pthread_sigmask'))
            invoked = stack.enter_context(mock.patch.object(adapter.runpy, 'run_path'))
            stack.enter_context(mock.patch.object(adapter.sys, 'path', list(adapter.sys.path)))
            args = ['wrapper', 'driver', str(source), 'run', str(app), str(destination), str(observer)]
            with mock.patch.object(adapter.sys, 'argv', args):
                adapter.main()
            invoked.assert_called_once_with(str(source / 'desktop/macos/lifecycle_smoke.py'), run_name='__main__')
            for change in ('wrong-run', 'not-reserved', 'multiple-scenarios'):
                invalid = json.loads(json.dumps(value))
                adapter.os.environ['NAC_LIFECYCLE_SCENARIOS'] = 'run'
                if change == 'wrong-run': invalid['run_id'] = '999'
                if change == 'not-reserved': invalid['cases']['run']['state'] = 'not_dispatched'
                if change == 'multiple-scenarios': adapter.os.environ['NAC_LIFECYCLE_SCENARIOS'] = 'run,run'
                (control / 'ledger.json').write_text(json.dumps(invalid))
                with mock.patch.object(adapter.sys, 'argv', args), self.subTest(change=change), self.assertRaises(RuntimeError):
                    adapter.main()
            self.assertEqual(invoked.call_count, 1)

    def test_source_bound_residual_audit_retains_unsettled_state_and_never_signals(self):
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp).resolve()
            fixture = destination / 'nac-lifecycle-app-test'
            fixture.mkdir()
            (destination / 'summary.json').write_text(json.dumps({'fixture_retained': str(fixture)}))
            calls = []
            def command(argv):
                calls.append(argv)
                if argv[0] == 'observer':
                    return '{"apps":[]}'
                return '1 Ss unrelated\n42 S ' + str(fixture / 'moved/NAC.app/Contents/Resources/nac-web') + '\n'
            result = adapter.audit_cleanup(destination, Path('observer'), command)
            self.assertFalse(result['complete'])
            self.assertEqual(result['private_fixture_processes'][0]['pid'], 42)
            self.assertFalse(result['fallback_signals'])
            self.assertTrue(all('terminate' not in argv and 'crash' not in argv for argv in calls))
            alias = destination / 'nac-lifecycle-app-alias'
            alias.symlink_to(fixture)
            with self.assertRaises(RuntimeError):
                adapter.audit_cleanup(destination, Path('observer'), command)

    def test_ownership_receipt_survives_private_teardown_and_detects_plain_sleep(self):
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp).resolve() / 'run'
            destination.mkdir()
            receipt = fixture_receipt(destination)
            self.assertTrue(adapter.ownership.retain(destination, 'run'))
            native = {'ready_store': str(receipt.parents[1] / 'selected store.db')}
            owned = adapter.ownership.require(destination, 'run', native)
            self.assertEqual(owned['fixture']['descendant_pid'], 999)
            shutil.rmtree(receipt.parents[2])
            result = adapter.audit_cleanup(destination, Path('observer'), lambda argv:
                '{"apps":[]}' if argv[0] == 'observer' else '1 Ss launchd\n999 S /bin/sleep 120\n')
            self.assertFalse(result['complete'])
            self.assertEqual(result['recorded_descendants_still_live_or_reused'], [{'pid': 999, 'state': 'S'}])
            self.assertEqual(result['private_fixture_processes'], [])
            with self.assertRaises(RuntimeError):
                adapter.ownership.require(destination, 'run', {'ready_store': '/wrong/profile/store.db'})

    def test_receipt_partial_missing_changed_and_symlink_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp).resolve()
            self.assertFalse(adapter.ownership.retain(destination, 'run'))
            with self.assertRaises(RuntimeError):
                adapter.ownership.require(destination, 'run')
            path = fixture_receipt(destination)
            data = path.read_text()
            path.write_text('{')
            self.assertFalse(adapter.ownership.retain(destination, 'run'))
            path.write_text(data)
            self.assertTrue(adapter.ownership.retain(destination, 'run'))
            path.write_text(data.replace('999', '998'))
            with self.assertRaises(RuntimeError):
                adapter.ownership.retain(destination, 'run')
            path.unlink()
            other = destination / 'other.json'
            other.write_text(data)
            path.symlink_to(other)
            with self.assertRaises(RuntimeError):
                adapter.ownership.retain(destination, 'run')

    def test_owned_wait_copies_receipt_before_supplier_deletes_profile(self):
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp).resolve()
            path = fixture_receipt(destination)
            child = mock.Mock(pid=123)
            def wait(**_kwargs):
                shutil.rmtree(path.parents[2])
                return 0
            child.wait.side_effect = wait
            with mock.patch.object(adapter.signal, 'pthread_sigmask', return_value=set()):
                result = adapter.run_case(['MOCK DRIVER'], destination / 'runner.log',
                    {'NAC_LIFECYCLE_SOURCE': tmp, 'NAC_LIFECYCLE_SCENARIOS': 'run'},
                    spawn=lambda *_a, **_k: child)
            self.assertEqual(result['state'], 'exited')
            self.assertEqual(adapter.ownership.require(destination, 'run')['fixture']['descendant_pid'], 999)
            child.terminate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
