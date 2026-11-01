"""Pure/mocked controls; never compile, launch a browser, query helpers or namespaces."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import contract as c
import owned_process as owned
spec = importlib.util.spec_from_file_location('heartbeat_runner', Path(__file__).with_name('run.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def audit(event, _):
    if event.startswith(('subprocess.', 'ctypes.', 'socket.')) or event in ('os.kill', 'os.killpg', 'os.fork'):
        raise AssertionError('REAL_RUNTIME_OPERATION_FORBIDDEN')


sys.addaudithook(audit)


def rows():
    return [{**{key: 1 for key in c.METRICS}, 'schedules': n, 'runnable_chats': active,
             'owners': 2, 'admitted': active, 'pending': n-active}
            for n, active in [(1, 1), (10, 4), (100, 4)]]


def output(values=None):
    # Actual libtest's prefix can precede the first println on the same line.
    return ('running 1 test\ntest '+c.TEST+' ... '+
            '\n'.join('HEARTBEAT_MEASUREMENT '+json.dumps(row) for row in (values or rows()))+
            '\nok\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 352 filtered out; finished in 1s\n')


class Child:
    pid = 123  # A symbolic fixture value; never used by any OS signal call.

    def __init__(self, mode='normal'):
        self.mode, self.code, self.calls = mode, None, []

    def wait(self, timeout):
        self.calls.append(('wait', timeout))
        if self.code is not None:
            return self.code
        if self.mode == 'normal':
            self.code = 0
            return 0
        if self.mode == 'cancel':
            raise owned.Interrupted('synthetic cancel')
        raise subprocess.TimeoutExpired('synthetic', timeout)

    def poll(self):
        return self.code

    def terminate(self):
        self.calls.append(('TERM',))
        if self.mode != 'resist':
            self.code = -15

    def kill(self):
        self.calls.append(('KILL',))
        self.code = -9


class Contracts(unittest.TestCase):
    def test_explicit_event_control_and_pins(self):
        control = 'a'*40
        c.validate_request(control, 'workflow_dispatch', c.BRANCH, c.MODE, c.HEAD, c.TREE, c.BASELINE)
        good = [control, 'workflow_dispatch', c.BRANCH, c.MODE, c.HEAD, c.TREE, c.BASELINE]
        for index, bad in [(0, 'main'), (1, 'pull_request'), (2, 'refs/heads/main'), (3, 'none'),
                           (3, None), (4, 'b'*40), (5, 'c'*40), (6, 'd'*40)]:
            args = good.copy()
            args[index] = bad
            with self.assertRaises(RuntimeError):
                c.validate_request(*args)
        event = {'inputs': {'heartbeat_evidence': c.MODE, 'heartbeat_control_sha': control}}
        c.validate_event(event, c.MODE, control)
        for value in ({}, {'inputs': {}}, {'inputs': {**event['inputs'], 'command': 'no'}},
                      {'inputs': {**event['inputs'], 'heartbeat_evidence': 'none'}}):
            with self.assertRaises(RuntimeError):
                c.validate_event(value, c.MODE, control)

    def test_measurement_actual_prefix_and_nonzero_selection(self):
        self.assertEqual(c.measurement_rows(output()), rows())
        for bad in [output().replace('1 passed;', '0 passed;'), output().replace('0 ignored;', '1 ignored;'),
                    output().replace('352 filtered', '0 filtered'), output().replace(c.TEST, 'other'),
                    output(rows()[:2]), output(rows()+[rows()[0]])]:
            with self.assertRaises(RuntimeError):
                c.measurement_rows(bad)

    def test_measurement_retains_assertions_and_finite_complete_values(self):
        for key, value in [('owners', 1), ('admitted', 2), ('pending', True), ('warm_p95_ms', float('nan')),
                           ('resident_active_kib', None), ('database_bytes', -1), ('unknown', 'no')]:
            values = rows()
            values[0][key] = value
            with self.assertRaises(RuntimeError):
                c.measurement_rows(output(values))
        values = rows()
        values[1]['warm_p50_ms'] = 2
        with self.assertRaisesRegex(RuntimeError, 'MEASUREMENT_ORDER'):
            c.measurement_rows(output(values))

    def test_one_compiled_library_executable(self):
        item = {'reason': 'compiler-artifact', 'target': {'name': 'nac_server'},
                'profile': {'test': True}, 'executable': '/synthetic/test'}
        self.assertEqual(str(c.test_executable(json.dumps(item))), '/synthetic/test')
        for text in ('', json.dumps(item)+'\n'+json.dumps(item), json.dumps({**item, 'executable': None})):
            with self.assertRaisesRegex(RuntimeError, 'EXACT_TEST_EXECUTABLE'):
                c.test_executable(text)

    def test_environment_drops_vendor_credentials_and_preserves_tools(self):
        with patch.dict(os.environ, {'PATH': '/tools', 'OPENAI_API_KEY': 'synthetic',
                                     'ARCEE_API_KEY': 'synthetic', 'GITHUB_TOKEN': 'synthetic'}, clear=True):
            env = owned.clean_environment('/owned-home', '/owned-tmp')
        self.assertFalse(any(key in env for key in ('OPENAI_API_KEY', 'ARCEE_API_KEY', 'GITHUB_TOKEN')))
        self.assertEqual(env['HOME'], '/owned-home')
        self.assertIn('CARGO_HOME', env)
        self.assertIn('RUSTUP_HOME', env)

    def test_no_host_signal_or_inventory_fallback(self):
        argv = runner.namespace_command(Path('/owned/context'), Path('/owned/output'))
        self.assertEqual(argv[:4], ['sudo', '-n', '--', 'unshare'])
        for option in ('--net', '--pid', '--mount', '--mount-proc', '--kill-child=SIGKILL'):
            self.assertIn(option, argv)
        with self.assertRaisesRegex(RuntimeError, 'PRIVATE_PID1_REQUIRED'):
            owned.namespace_members()

    def test_typed_normal_timeout_and_force_custody(self):
        for mode, exit_code, signals in [('normal', 0, []), ('timeout', -15, ['typed TERM']),
                                         ('resist', -9, ['typed TERM', 'typed KILL'])]:
            with tempfile.TemporaryDirectory() as directory:
                child = Child(mode)
                if mode == 'normal':
                    owned.run_owned(['synthetic'], directory, {}, directory, 'phase', 1,
                                    factory=lambda *a, **k: child)
                else:
                    with self.assertRaisesRegex(RuntimeError, 'CHILD_TIMEOUT'):
                        owned.run_owned(['synthetic'], directory, {}, directory, 'phase', 1,
                                        factory=lambda *a, **k: child)
                receipt = json.loads((Path(directory)/'phase.terminal.json').read_text())
                self.assertEqual(receipt['exit'], exit_code)
                self.assertEqual(receipt['signals'], signals)
                self.assertEqual(receipt['stderr_sha256'], c.sha256(Path(directory)/'phase.stderr'))

    def test_cancellation_and_nonzero_exit_preserve_first_safe_error(self):
        for mode, preset, want in [('cancel', None, 'CANCELLED'), ('normal', 7, 'CHILD_FAILED')]:
            with tempfile.TemporaryDirectory() as directory:
                child = Child(mode)
                child.code = preset
                with self.assertRaisesRegex(RuntimeError, want):
                    owned.run_owned(['synthetic'], directory, {}, directory, 'phase', 1,
                                    factory=lambda *a, **k: child)
                receipt = json.loads((Path(directory)/'phase.terminal.json').read_text())
                self.assertEqual(receipt['first_error'], want)
                self.assertTrue(receipt['terminal'])

    def test_post_spawn_receipt_failure_still_retires_typed_child(self):
        with tempfile.TemporaryDirectory() as directory:
            child = Child('timeout')
            real_write, writes = owned.write_json, []

            def sink(path, value):
                writes.append(copy.deepcopy(value))
                if len(writes) == 2:
                    raise OSError('synthetic persistence failure')
                real_write(path, value)

            with patch.object(owned, 'write_json', sink):
                with self.assertRaisesRegex(RuntimeError, 'CHILD_IO_OR_CUSTODY_FAILURE'):
                    owned.run_owned(['synthetic'], directory, {}, directory, 'phase', 1,
                                    factory=lambda *a, **k: child)
            receipt = json.loads((Path(directory)/'phase.terminal.json').read_text())
            self.assertEqual(receipt['exit'], -15)
            self.assertEqual(receipt['first_error'], 'CHILD_IO_OR_CUSTODY_FAILURE')

    def test_artifact_symlink_rejected_without_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory)/'foreign').symlink_to('/does-not-exist')
            with self.assertRaisesRegex(RuntimeError, 'ARTIFACT_SYMLINK'):
                c.artifact_manifest(directory)

    def test_inside_orders_build_capture_settle_measure_and_stops_on_orphans(self):
        for orphan in (False, True):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                product, out = root/'product', root/'out'
                product.mkdir()
                out.mkdir()
                context = root/'context.json'
                c.write_json(context, {'control': 'a'*40, 'product': str(product),
                                      'browsers': '/synthetic', 'tool_environment': {'PATH': '/synthetic'}})
                calls = []

                def phase(argv, cwd, env, output_dir, label, seconds):
                    calls.append(label)
                    build = root/'out-build'
                    if label == 'build-product':
                        (build/'debug').mkdir()
                        (build/'debug/nac-web').write_bytes(b'synthetic executable')
                    if label == 'build-measurement':
                        executable = build/'test'
                        executable.write_bytes(b'synthetic test')
                        (out/(label+'.stdout')).write_text(json.dumps({'reason': 'compiler-artifact',
                            'target': {'name': 'nac_server'}, 'profile': {'test': True}, 'executable': str(executable)}))
                    if label == 'measurement':
                        (out/(label+'.stdout')).write_text(output())

                with patch.dict(os.environ, {}, clear=True), \
                     patch.object(runner, 'bootstrap_namespace', return_value=({'pid1': True}, Mock())), \
                     patch.object(runner, 'verify_product'), patch.object(runner, 'run_owned', phase), \
                     patch.object(runner, 'verify_pair', return_value=[]), \
                     patch.object(runner, 'resource_sample', return_value={}), \
                     patch.object(runner, 'reap_namespace', return_value={'remaining': [303] if orphan else []}):
                    code = runner.inside(context, out)
                self.assertEqual(calls[:3], ['build-product', 'build-measurement', 'capture-pair'])
                self.assertEqual('measurement' in calls, not orphan)
                self.assertEqual(code, 90 if orphan else 0)
                result = json.loads((out/'evidence.json').read_text())
                self.assertEqual(result['first_error'], 'CAPTURE_CHILDREN_REMAIN' if orphan else None)


if __name__ == '__main__':
    unittest.main()
