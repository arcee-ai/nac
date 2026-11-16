"""Actual Bound/companion/ci.run composition with inert thread/process ports."""
from contextlib import ExitStack
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import ci
import ci_paths_budget as budget
from ci_startup_ax import AXCompanion


class CompanionClockTests(unittest.TestCase):
    def exercise(self, *, fail_before=False, expire_before=False, latch_after=False,
                 process_after=False, ui_after='app_windows', expire_after=False):
        temporary = tempfile.TemporaryDirectory(prefix='nac-ax-clock-inert-')
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name).resolve()
        config_path = root / 'config.json'
        config_path.write_text('{}')
        now = [0.]
        clock = budget.PathBudget({'started_at_epoch': 1000., 'deadline_epoch': 2200.},
                                  2000., monotonic=lambda: now[0], wall=lambda: 1000. + now[0])
        original_work = clock.work.deadline
        identity = dict(pid=123, parent=os.getpid(), uid=os.getuid(), start_seconds=1,
                        start_microseconds=2, executable=str(root / 'helper'))
        declaration = dict(path=str(root / 'receipt.json'), nonce='a' * 64,
                           helper_path=identity['executable'], helper_sha256='b' * 64,
                           support_sha256={}, owner_pid=os.getpid(), deadline_ns=str(int(200e9)))
        witness = SimpleNamespace(ready=True, failure=None, ui_terminal=False,
                                  process_failure=None, ui_failure=None)
        threads, acquired, scopes = [], [], []
        class Thread:
            def __init__(self, *, target, **options):
                self.target = target
                self.done = False
                if target.__name__ == 'owned':
                    threads.append(self)
            def start(self):
                if self.target.__name__ != 'owned':
                    self.target()
                    self.done = True
            def join(self, timeout=None):
                pass
            def is_alive(self):
                return not self.done
            def execute(self):
                try:
                    self.target()
                finally:
                    self.done = True
        class Child:
            pid = 123
            returncode = None
            def __init__(self):
                self.stdout = io.BytesIO(b'inert fatal diagnostic; never an AX observation\n')
                self.waits = 0
            def wait(self, timeout=None):
                scopes.append((budget.active().kind, budget.active().deadline))
                self.waits += 1
                if self.waits == 1:
                    if latch_after:
                        clock.fail('parent test failed')
                    witness.failure = witness.ui_failure = ui_after
                    if process_after:
                        witness.process_failure = 'owner_stream_unavailable'
                    if expire_after:
                        now[0] = 201.
                    raise subprocess.TimeoutExpired(['inert helper'], timeout)
                self.returncode = 1
                return self.returncode
            def poll(self):
                return self.returncode
        child = Child()
        def popen(*args, **kwargs):
            acquired.append((list(clock.failed), budget.active().kind, budget.active().deadline))
            return child
        def waiting(path, limit):
            return json.dumps(dict(schema='nac342-ax-witness-v1', status='waiting', sequence='0',
                trusted=True, nonce=declaration['nonce'], configuration_sha256='d' * 64,
                helper_sha256=declaration['helper_sha256'], support_sha256={},
                case_deadline_ns=str(owner.case_deadline_ns), helper=identity)).encode()
        token = budget._ACTIVE.set(clock.work)
        self.addCleanup(budget._ACTIVE.reset, token)
        owner = AXCompanion(witness, {'ax_witness': declaration}, config_path,
                            root / 'helper', root, run=ci.run)
        with ExitStack() as stack:
            stack.enter_context(patch('ci_startup_ax.threading.Thread', Thread))
            stack.enter_context(patch('ci_startup_ax.time.monotonic', side_effect=lambda: now[0]))
            stack.enter_context(patch('ci.RUN_DEADLINE', 1000.))
            stack.enter_context(patch('ci_startup_ax.bounded_file', side_effect=waiting))
            stack.enter_context(patch('ci_startup_ax.digest', return_value='d' * 64))
            stack.enter_context(patch('ci_startup_ax.native_identity', return_value=identity))
            stack.enter_context(patch('ci.subprocess.Popen', side_effect=popen))
            signals = stack.enter_context(patch('ci.os.killpg'))
            # Any accidental fallback to an OS observation or launcher is fatal.
            for name in ('ci.subprocess.run', 'ci.subprocess.check_output', 'ci.os.kill'):
                stack.enter_context(patch(name, side_effect=AssertionError('Unmocked actor port')))
            owner.start()
            if fail_before:
                clock.fail('failed before acquisition')
            if expire_before:
                now[0] = original_work + 1
            budget._ACTIVE.set(None)  # A deferred thread starts without caller context.
            threads[0].execute()
            receipt = json.loads((root / 'ax-companion.log.ownership.json').read_text()) \
                if (root / 'ax-companion.log.ownership.json').exists() else None
            signal_count = signals.call_count
        self.assertEqual(clock.work.deadline, original_work)
        return SimpleNamespace(owner=owner, clock=clock, acquired=acquired, receipt=receipt,
                               scopes=scopes, signals=signal_count, root=root)

    def test_healthy_admission_uses_original_work_check_before_acquisition(self):
        result = self.exercise()
        self.assertEqual(result.acquired[0][0], [])
        self.assertEqual(result.acquired[0][1:], ('cleanup', 200.))
        self.assertEqual(result.scopes, [('cleanup', 200.), ('cleanup', 200.)])
        self.assertRegex(str(result.owner.error), r'failed \(1\)')
        self.assertTrue(result.receipt['accepted'] and result.receipt['reaped'] and result.receipt['drain_settled'])
        self.assertEqual(result.signals, 0)

    def test_work_failure_before_acquisition_denies_new_helper(self):
        result = self.exercise(fail_before=True)
        self.assertIsInstance(result.owner.error, budget.BudgetExpired)
        self.assertEqual(result.acquired, [])
        self.assertEqual(result.signals, 0)

    def test_original_work_expiry_before_acquisition_denies_new_helper(self):
        result = self.exercise(expire_before=True)
        self.assertIsInstance(result.owner.error, budget.BudgetExpired)
        self.assertEqual(result.acquired, [])
        self.assertEqual(result.signals, 0)

    def test_latched_parent_failure_after_acceptance_retains_diagnostic_owner(self):
        result = self.exercise(latch_after=True)
        self.assertEqual(result.clock.failed, ['parent test failed'])
        self.assertRegex(str(result.owner.error), r'failed \(1\)')
        self.assertNotIsInstance(result.owner.error, budget.BudgetExpired)
        self.assertEqual(result.signals, 0)
        self.assertTrue(result.receipt['accepted'] and result.receipt['reaped'] and result.receipt['drain_settled'])
        self.assertFalse(result.receipt['unknown'])
        self.assertIn(b'inert fatal diagnostic', (result.root / 'ax-companion.log').read_bytes())
        with self.assertRaises(budget.BudgetExpired):
            result.clock.work.check()

    def test_process_failure_behind_ui_failure_still_aborts_owned_helper(self):
        result = self.exercise(latch_after=True, process_after=True)
        self.assertRegex(str(result.owner.error), 'ownership unavailable during helper execution')
        self.assertEqual(result.signals, 1)  # Inert signal port only.
        self.assertTrue(result.receipt['reaped'] and result.receipt['drain_settled'])

    def test_other_ui_failure_still_aborts_owned_helper(self):
        result = self.exercise(latch_after=True, ui_after='app_window_reappeared')
        self.assertRegex(str(result.owner.error), 'ownership unavailable during helper execution')
        self.assertEqual(result.signals, 1)

    def test_original_case_deadline_is_not_extended_by_parent_failure(self):
        result = self.exercise(latch_after=True, expire_after=True)
        self.assertIsInstance(result.owner.error, budget.BudgetExpired)
        self.assertEqual(result.signals, 1)
        self.assertTrue(result.receipt['reaped'] and result.receipt['drain_settled'])


if __name__ == '__main__':
    unittest.main()
