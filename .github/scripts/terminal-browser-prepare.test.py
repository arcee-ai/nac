"""Inert controls only: fake children, clocks and disposable JSON/files.

No test may invoke Cargo, APT, HTTP, a browser, a real child or a signal.
"""
from contextlib import ExitStack, nullcontext
import importlib.util
import json
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('terminal_prepare', Path(__file__).with_name('terminal-browser-prepare.py'))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class Inert(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for name in ('Popen', 'run', 'check_call', 'check_output'):
            self.stack.enter_context(patch.object(subprocess, name, side_effect=AssertionError('real child forbidden')))
        self.stack.enter_context(patch.object(prepare.os, 'killpg', side_effect=AssertionError('real signal forbidden')))
        self.stack.enter_context(patch.object(signal, 'signal', side_effect=AssertionError('real signal handler forbidden')))
        self.stack.enter_context(patch.object(signal, 'setitimer', side_effect=AssertionError('real timer forbidden')))
        self.stack.enter_context(patch.object(signal, 'getitimer', return_value=(0.0, 0.0)))
        for name in ('subreaper', 'process', 'same', 'owned', 'reaped', 'settle'):
            self.stack.enter_context(patch.object(prepare.supervision, name,
                                                  side_effect=AssertionError('real kernel action forbidden')))


class ParentControls(Inert):
    def setUp(self):
        super().setUp()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        (self.root / 'producer').mkdir()
        (self.root / 'producer/identity.json').write_text(json.dumps({'source': 'a' * 40}))
        self.events, self.mode, self.clock = [], 'success', 0.0
        self.uid = prepare.os.getuid()
        self.caller = {'pid': 123, 'start': 10, 'uid': self.uid}
        self.child = SimpleNamespace(pid=42, returncode=None)
        self.child.poll = lambda: self.child.returncode
        self.child.wait = lambda **_: self.child.returncode
        self.stack.enter_context(patch.object(prepare, 'cleanup_signals', side_effect=lambda **_: nullcontext()))
        self.stack.enter_context(patch.object(signal, 'getitimer', return_value=(100.0, 0.0)))
        self.stack.enter_context(patch.object(prepare.secrets, 'token_hex', return_value='1' * 32))
        self.stack.enter_context(patch.object(prepare.time, 'monotonic', side_effect=self.tick))
        self.stack.enter_context(patch.object(prepare.time, 'sleep', return_value=None))
        self.stack.enter_context(patch.object(prepare.supervision, 'process', return_value=self.caller))
        self.stack.enter_context(patch.object(prepare.supervision, 'same', return_value={'uid': self.uid}))
        self.stack.enter_context(patch.object(prepare.subprocess, 'Popen', side_effect=self.launch))
        self.stack.enter_context(patch.object(prepare, 'token', side_effect=self.go))
        self.stack.enter_context(patch.object(prepare.apt, 'request_stop', side_effect=self.stop))

    def tick(self):
        self.clock += .1
        return self.clock

    def write(self, name, value):
        (self.root / 'supervision' / name).write_text(json.dumps(value))

    def result(self, remaining=None):
        return {'schema': 1, 'nonce': '1' * 32, 'uid': self.uid, 'source': 'a' * 40,
                'caller': {'pid': 123, 'start': 10}, 'reason': 'completed', 'error_type': None,
                'cleanup': {'remaining': remaining or []}, 'phases': [],
                'roots': [{'label': 'build', 'exit': 0}, {'label': 'prefetch', 'exit': 0}]}

    def launch(self, *_a, **_kw):
        self.events.append('launch')
        if self.mode == 'constructor':
            raise InterruptedError('fake interrupted constructor')
        ready = {'schema': 1, 'nonce': '1' * 32, 'uid': self.uid, 'source': 'a' * 40,
                 'caller': {'pid': 123, 'start': 10}, 'supervisor': {'pid': 42, 'start': 20}}
        if self.mode == 'foreign-ready':
            ready['source'] = 'b' * 40
        self.write('ready.json', ready)
        return self.child

    def go(self, *_args):
        self.events.append('GO')
        if self.mode == 'missing-result':
            self.child.returncode = -9
        else:
            result = self.result([{'pid': 99}] if self.mode == 'remaining' else None)
            self.write('result.json', result)
            self.child.returncode = 0

    def stop(self, *_args):
        self.events.append('STOP')
        if self.mode != 'missing-result':
            result = self.result([{'pid': 99}] if self.mode == 'remaining' else None)
            self.write('result.json', result)
        self.child.returncode = -15

    def run_parent(self):
        phases = []
        prepare.parallel(prepare.command_set(self.root, {}, True), self.root, {}, phases)

    def test_GO_only_after_bound_original_supervisor_handle(self):
        self.run_parent()
        self.assertEqual(self.events, ['launch', 'GO'])

    def test_constructor_interruption_STOP_without_GO(self):
        self.mode = 'constructor'
        with self.assertRaisesRegex(InterruptedError, 'constructor'):
            self.run_parent()
        self.assertEqual(self.events, ['launch', 'STOP'])

    def test_foreign_READY_never_gets_GO(self):
        self.mode = 'foreign-ready'
        with self.assertRaisesRegex(RuntimeError, 'unbound'):
            self.run_parent()
        self.assertEqual(self.events, ['launch', 'STOP'])

    def test_killed_supervisor_missing_receipt_is_UNKNOWN(self):
        self.mode = 'missing-result'
        with self.assertRaisesRegex(RuntimeError, 'UNKNOWN'):
            self.run_parent()
        self.assertIn('STOP', self.events)
        self.assertTrue(self.root.exists())

    def test_remaining_descendant_is_not_cleanup_PASS(self):
        self.mode = 'remaining'
        with self.assertRaisesRegex(RuntimeError, 'UNKNOWN'):
            self.run_parent()
        self.assertTrue(self.root.exists())


class SupervisorControls(Inert):
    def setUp(self):
        super().setUp()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        control = self.root / 'control'
        control.mkdir(mode=0o700)
        (self.root / 'producer').mkdir()
        (self.root / 'producer/identity.json').write_text(json.dumps({'source': 'a' * 40}))
        self.args = SimpleNamespace(control=control, work=self.root, caller=123, start=10,
                                    nonce='1' * 32, source='a' * 40, seconds=100, prefetch=True)
        self.events, self.mode, self.launches = [], 'success', 0
        self.uid = prepare.os.getuid()
        self.stack.enter_context(patch.object(prepare.sys, 'platform', 'linux'))
        self.stack.enter_context(patch.object(signal, 'signal', return_value=None))
        self.stack.enter_context(patch.object(prepare.supervision, 'subreaper', side_effect=lambda: self.events.append('subreaper')))
        self.stack.enter_context(patch.object(prepare.supervision, 'process', return_value={'pid': 42, 'start': 20, 'uid': self.uid}))
        self.stack.enter_context(patch.object(prepare.supervision, 'same', side_effect=self.lease))
        self.stack.enter_context(patch.object(prepare.supervision, 'requested', side_effect=lambda *_: self.mode == 'stop-before-go'))
        self.stack.enter_context(patch.object(prepare.supervision, 'reaped', side_effect=self.reaped))
        self.stack.enter_context(patch.object(prepare.supervision, 'owned', side_effect=lambda: {99: {}} if self.mode == 'leak' else {}))
        self.stack.enter_context(patch.object(prepare.supervision, 'settle', side_effect=self.settle))
        self.stack.enter_context(patch.object(prepare.subprocess, 'Popen', side_effect=self.launch))
        self.stack.enter_context(patch.object(prepare.shutil, 'disk_usage', return_value=SimpleNamespace(free=14 * 1024**3)))
        original = prepare.supervision.publish

        def publish(fd, name, value):
            original(fd, name, value)
            if name == 'ready.json':
                (control / 'go').write_bytes(b'1' * 32)
        self.stack.enter_context(patch.object(prepare.supervision, 'publish', side_effect=publish))

    def lease(self, _value):
        if self.mode == 'parent-loss' and self.launches:
            return None
        return {'uid': self.uid, 'state': 'S'}

    def launch(self, *_args, **_kwargs):
        self.assertEqual(self.events[0], 'subreaper')
        self.launches += 1
        if self.mode == 'partial-launch' and self.launches == 2:
            raise InterruptedError('fake constructor interruption')
        return SimpleNamespace(pid=10 + self.launches, returncode=None)

    def reaped(self, _child):
        if self.mode == 'parent-loss':
            return []
        return [{'pid': 11, 'exit': 0}, {'pid': 12, 'exit': -9 if self.mode == 'exporter-loss' else 0}]

    def settle(self, _child):
        self.events.append('settle-adopted')
        return {'remaining': [{'pid': 99}] if self.mode == 'leak' else [],
                'reaped': [{'pid': 99, 'exit': -15}], 'signals': []}

    def outcome(self):
        return json.loads((self.args.control / 'result.json').read_text())

    def test_success_has_subreaper_before_all_spawns_and_no_adoptees(self):
        prepare.supervise(self.args)
        self.assertEqual(self.launches, 2)
        self.assertEqual(self.outcome()['reason'], 'completed')
        self.assertEqual(self.outcome()['cleanup']['remaining'], [])

    def test_exporter_loss_settles_adopted_different_session_downloader(self):
        self.mode = 'exporter-loss'
        with self.assertRaisesRegex(RuntimeError, 'supervisor failed'):
            prepare.supervise(self.args)
        self.assertIn('settle-adopted', self.events)
        self.assertEqual(self.outcome()['cleanup']['reaped'][0]['pid'], 99)
        self.assertIsNotNone(self.outcome()['error_type'])

    def test_stop_before_GO_starts_no_work(self):
        self.mode = 'stop-before-go'
        with self.assertRaises(RuntimeError):
            prepare.supervise(self.args)
        self.assertEqual(self.launches, 0)

    def test_partial_constructor_interruption_still_settles(self):
        self.mode = 'partial-launch'
        with self.assertRaises(RuntimeError):
            prepare.supervise(self.args)
        self.assertEqual(self.outcome()['error_type'], 'InterruptedError')
        self.assertIn('settle-adopted', self.events)

    def test_parent_lease_loss_fails_and_settles(self):
        self.mode = 'parent-loss'
        with self.assertRaises(RuntimeError):
            prepare.supervise(self.args)
        self.assertIn('settle-adopted', self.events)

    def test_owned_leak_remains_failed_and_unrelated_sentinel_untouched(self):
        self.mode = 'leak'
        sentinel = self.root / 'unrelated-sentinel'
        sentinel.write_text('unchanged')
        with self.assertRaises(RuntimeError):
            prepare.supervise(self.args)
        self.assertEqual(sentinel.read_text(), 'unchanged')
        self.assertTrue(self.outcome()['cleanup']['remaining'])


class PreparationControls(Inert):
    def setUp(self):
        super().setUp()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.output = self.root / 'fresh'
        self.events = []
        self.mode, self.consume_mode = 'ready', 'verified-offer'
        self.preflight_mode = 'pending'
        self.fail = None
        self.identity = {'source': 'a' * 40, 'repository': 'owner/repo', 'run_id': '1', 'attempt': 1, 'image': 'same@1'}
        binary = self.root / 'target/debug/nac-web'
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b'fake executable')
        binary.chmod(0o700)
        self.stack.enter_context(patch.object(prepare, 'ROOT', self.root))
        self.stack.enter_context(patch.object(prepare.sys, 'platform', 'linux'))
        self.stack.enter_context(patch.object(prepare.os, 'geteuid', return_value=501))
        self.stack.enter_context(patch.object(prepare, 'deadline', side_effect=lambda _: nullcontext()))
        self.stack.enter_context(patch.object(prepare, 'cleanup_signals', side_effect=lambda **_: nullcontext()))
        self.stack.enter_context(patch.object(prepare, 'operation', side_effect=self.operation))
        self.stack.enter_context(patch.object(prepare, 'parallel', side_effect=self.parallel))
        self.stack.enter_context(patch.object(prepare, 'normal_install', side_effect=self.install))
        self.stack.enter_context(patch.object(prepare.apt, 'source_identity', return_value=self.identity))
        self.stack.enter_context(patch.object(prepare.apt, 'run', side_effect=self.root_command))

    def operation(self, name, state, source, **_values):
        self.events.append((name, state.name))
        if self.fail == name:
            raise RuntimeError('fake ' + name)
        if name == 'preflight':
            state.mkdir(mode=0o700)
            (state / 'identity.json').write_text(json.dumps(self.identity))
            return {'mode': self.preflight_mode}
        if name == 'plan':
            return {'mode': self.mode}
        if name == 'consume':
            self.assertIn('receipt', prepare.os.environ['BROWSER_APT_RECEIPT'])
            return {'mode': self.consume_mode}
        return {}

    def parallel(self, commands, output, _env, phases):
        self.events.append(('join', tuple(label for label, _ in commands)))
        self.assertEqual(commands[0][1], ['cargo', 'build', '--locked', '-p', 'nac-server', '--bin', 'nac-web'])
        if self.fail == 'join':
            raise InterruptedError('fake branch failure')
        phases.append({'label': 'build', 'exit': 0})
        (output / 'producer/export.json').write_text(json.dumps({'receipt': {'receipt': 'fake'}}))

    def install(self, _state):
        self.events.append(('install', None))
        if self.fail == 'install':
            raise RuntimeError('fake normal install')

    def root_command(self, _state, label, _command, **_kwargs):
        self.events.append((label, None))
        if self.fail == label:
            raise RuntimeError('fake ' + label)

    def prepare(self):
        return prepare.prepare('a' * 40, self.output, env={})

    def test_join_fresh_consumer_offer_install_check_cleanup_order(self):
        result = self.prepare()
        names = [e[0] for e in self.events]
        self.assertLess(names.index('join'), names.index('consume'))
        self.assertLess(names.index('consume'), names.index('offer-command'))
        self.assertLess(names.index('offer-command'), names.index('install'))
        self.assertLess(names.index('installed'), names.index('cleanup-command'))
        self.assertEqual(names.count('join'), 1)
        self.assertEqual(result['status'], 'prepared')
        self.assertFalse(result['quality_verdict'])

    def test_failed_join_never_installs(self):
        self.fail = 'join'
        with self.assertRaises(RuntimeError) as failure:
            self.prepare()
        self.assertIsInstance(failure.exception.__cause__, InterruptedError)
        self.assertEqual(str(failure.exception.__cause__), 'fake branch failure')
        self.assertIn(('join', ('build', 'prefetch')), self.events)
        self.assertNotIn('install', [e[0] for e in self.events])

    def test_partial_offer_failure_still_cleans_owned_entries(self):
        self.fail = 'offer-command'
        with self.assertRaises(RuntimeError) as failure:
            self.prepare()
        self.assertEqual(str(failure.exception.__cause__), 'fake offer-command')
        self.assertIn(('offer-command', None), self.events)
        names = [e[0] for e in self.events]
        self.assertNotIn('install', names)
        self.assertEqual(names.count('cleanup-command'), 1)

    def test_install_failure_cleans_and_cannot_report_prepared(self):
        self.fail = 'install'
        with self.assertRaises(RuntimeError) as failure:
            self.prepare()
        self.assertEqual(str(failure.exception.__cause__), 'fake normal install')
        self.assertIn(('install', None), self.events)
        self.assertIn(('cleanup-command', None), self.events)
        result = json.loads((self.output / 'preparation.json').read_text())
        self.assertEqual(result['status'], 'failed')

    def test_valid_incompatible_offer_uses_normal_install_without_cache_offer(self):
        self.consume_mode = 'normal'
        result = self.prepare()
        self.assertEqual(result['archive_mode'], 'normal')
        self.assertIn(('install', None), self.events)
        self.assertNotIn(('offer-command', None), self.events)

    def test_foreign_transport_failure_does_not_fall_back_or_install(self):
        self.fail = 'consume'
        with patch.dict(prepare.os.environ, {'BROWSER_APT_RECEIPT': 'original'}):
            with self.assertRaises(RuntimeError) as failure:
                self.prepare()
            self.assertEqual(str(failure.exception.__cause__), 'fake consume')
            self.assertIn(('consume', 'consumer'), self.events)
            self.assertEqual(prepare.os.environ['BROWSER_APT_RECEIPT'], 'original')
        self.assertNotIn(('install', None), self.events)

    def test_nothing_missing_does_not_spawn_prefetch(self):
        self.mode = 'nothing-missing'
        result = self.prepare()
        self.assertIn(('join', ('build',)), self.events)
        self.assertEqual(result['archive_mode'], 'nothing-missing')

    def test_cold_preflight_keeps_normal_install_without_prefetch(self):
        self.preflight_mode = 'disabled-cold'
        result = prepare.prepare('a' * 40, self.output, env={}, cold=True)
        self.assertIn(('join', ('build',)), self.events)
        self.assertIn(('install', None), self.events)
        self.assertNotIn(('offer-command', None), self.events)
        self.assertEqual(result['archive_mode'], 'disabled-cold')

    def test_source_or_run_drift_prevents_install(self):
        with patch.object(prepare.apt, 'source_identity', return_value={**self.identity, 'attempt': 2}):
            with self.assertRaises(RuntimeError) as failure:
                self.prepare()
            self.assertEqual(str(failure.exception.__cause__), 'source or run identity changed during preparation')
            self.assertIn(('join', ('build', 'prefetch')), self.events)
        self.assertNotIn(('install', None), self.events)

    def test_cleanup_failure_revokes_prepared_result(self):
        self.fail = 'cleanup-command'
        with self.assertRaises(RuntimeError) as failure:
            self.prepare()
        self.assertEqual(str(failure.exception.__cause__), 'fake cleanup-command')
        for event in [('install', None), ('installed', 'consumer'), ('cleanup-command', None)]:
            self.assertIn(event, self.events)
        self.assertEqual(json.loads((self.output / 'preparation.json').read_text())['status'], 'failed')

    def test_existing_output_refuses_retry(self):
        self.output.mkdir()
        with self.assertRaisesRegex(RuntimeError, 'fresh'):
            self.prepare()
        self.assertEqual(self.events, [])

    def test_symlink_output_ancestor_is_rejected_before_any_actor(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        self.output = alias / 'fresh'
        with self.assertRaisesRegex(RuntimeError, 'symlink output ancestor'):
            self.prepare()
        self.assertEqual(self.events, [])
        self.assertFalse((self.root / 'fresh').exists())


class TimerControls(Inert):
    def test_cleanup_rearms_only_remaining_deadline(self):
        calls = []
        with patch.object(signal, 'getsignal', return_value='old'), \
                patch.object(signal, 'getitimer', return_value=(10.0, 0.0)), \
                patch.object(signal, 'signal', side_effect=lambda *_: None), \
                patch.object(signal, 'setitimer', side_effect=lambda *args: calls.append(args)), \
                patch.object(prepare.time, 'monotonic', side_effect=[20.0, 23.0]):
            with prepare.cleanup_signals(resume_deadline=True):
                pass
        self.assertEqual(calls[-1], (signal.ITIMER_REAL, 7.0))

    def test_expired_deadline_does_not_get_a_new_budget(self):
        calls = []
        with patch.object(signal, 'getsignal', return_value='old'), \
                patch.object(signal, 'getitimer', return_value=(2.0, 0.0)), \
                patch.object(signal, 'signal', side_effect=lambda *_: None), \
                patch.object(signal, 'setitimer', side_effect=lambda *args: calls.append(args)), \
                patch.object(prepare.time, 'monotonic', side_effect=[20.0, 23.0]):
            with self.assertRaisesRegex(RuntimeError, 'expired during cleanup'):
                with prepare.cleanup_signals(resume_deadline=True):
                    pass
        self.assertEqual(calls, [(signal.ITIMER_REAL, 0)])


class NormalCommandControls(Inert):
    def test_locked_normal_cli_runs_under_existing_root_supervisor(self):
        with tempfile.TemporaryDirectory() as directory:
            web = Path(directory)
            cli = web / 'node_modules/playwright/cli.js'
            cli.parent.mkdir(parents=True)
            cli.write_text('fake CLI, never executed')
            calls = []
            with patch.object(prepare, 'WEB', web), \
                    patch.object(prepare.shutil, 'which', return_value='/fake/node'), \
                    patch.object(prepare.apt, 'run', side_effect=lambda *a, **kw: calls.append((a, kw))):
                prepare.normal_install(web)
            command = calls[0][0][2]
            self.assertEqual(command, ['sudo', '/fake/node', str(cli.resolve()), 'install-deps', 'chromium'])
            self.assertEqual(calls[0][1]['cwd'], web)


class BinaryCustodyControls(Inert):
    def setUp(self):
        super().setUp()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.target = self.root / 'target'
        self.binary = self.target / 'debug/nac-web'
        self.binary.parent.mkdir(parents=True)
        self.binary.write_bytes(b'fake executable, never run')
        self.binary.chmod(0o700)
        self.output = self.root / 'output'
        self.output.mkdir(mode=0o700)

    def test_lexical_compiled_leaf_symlink_is_refused(self):
        foreign = self.root / 'foreign'
        foreign.write_bytes(b'foreign executable, never run')
        foreign.chmod(0o700)
        self.binary.unlink()
        self.binary.symlink_to(foreign)
        with self.assertRaises(OSError):
            prepare.copy_binary(self.target, self.output)
        self.assertEqual(foreign.read_bytes(), b'foreign executable, never run')
        self.assertFalse((self.output / 'engine').exists())

    def test_cargo_hardlink_and_explicit_target_directory_alias_are_preserved(self):
        prepare.os.link(self.binary, self.binary.with_name('cargo-alias'))
        alias = self.root / 'configured-target'
        alias.symlink_to(self.target, target_is_directory=True)
        result = prepare.copy_binary(alias, self.output)
        self.assertEqual(self.binary.stat().st_nlink, 2)
        self.assertEqual(result['target_directory'], str(self.target))
        self.assertEqual(prepare.verify_binary(result), self.output / 'engine/nac-web')
        self.assertEqual(Path(result['path']).stat().st_nlink, 1)

    def test_replaced_copy_same_bytes_cannot_pass_inode_binding(self):
        result = prepare.copy_binary(self.target, self.output)
        copied = Path(result['path'])
        with copied.open('rb') as retained:
            copied.unlink()
            copied.write_bytes(retained.read())
            copied.chmod(0o500)
            with self.assertRaisesRegex(RuntimeError, 'identity changed'):
                prepare.verify_binary(result)

    def test_copy_leaf_symlink_is_refused_before_use(self):
        result = prepare.copy_binary(self.target, self.output)
        copied = Path(result['path'])
        copied.unlink()
        copied.symlink_to(self.binary)
        with self.assertRaises(OSError):
            prepare.verify_binary(result)

    def test_nonexecutable_compiled_file_never_publishes_copy(self):
        self.binary.chmod(0o600)
        with self.assertRaisesRegex(RuntimeError, 'invalid compiled binary'):
            prepare.copy_binary(self.target, self.output)
        self.assertFalse((self.output / 'engine').exists())


if __name__ == '__main__':
    unittest.main(failfast=True)
