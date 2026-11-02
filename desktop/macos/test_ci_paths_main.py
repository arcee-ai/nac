"""Actual main/checkout owners; all command, native and signal seams are inert."""
from contextlib import ExitStack
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import ci
import ci_paths
import ci_qualifications
from ci_paths_budget import BudgetExpired, active, using
from test_ci_paths_budget import Clock


class MainClockControls(unittest.TestCase):
    def exercise(self, mode, *, export_error=False, ordinary=False):
        clock = Clock()
        budget = clock.budget()
        owner_error = RuntimeError('original owner failure')
        retention_error = OSError('inert retention failure')
        exports = []
        console_calls = []
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
            root = Path(temporary).resolve()
            product = root / 'product'
            product.mkdir()
            output = root / 'out'
            sha = 'a' * 40
            argv = ['ci.py', '--expected-sha', sha, '--output', str(output)]
            if not ordinary:
                argv += ['--qualification', 'all-347-paths-macos26', '--source-root', str(product)]
            if mode == 'scope-exit' or ordinary:
                argv += ['--preflight-only']
            stack.enter_context(patch.dict(os.environ, dict(os.environ), clear=True))
            stack.enter_context(patch('ci.sys.argv', argv))
            stack.enter_context(patch('ci.signal.signal'))
            stack.enter_context(patch('ci.Path.home', return_value=root))
            stack.enter_context(patch('ci.platform.system', return_value='Darwin'))
            stack.enter_context(patch('ci.platform.machine', return_value='arm64'))
            stack.enter_context(patch('ci.select_target', return_value={
                'suite': 'paths', 'source_sha': sha, 'envelope': 'ci-toolchain.json'}))
            stack.enter_context(patch('ci_paths.require_allocation', return_value={}))
            stack.enter_context(patch('ci.PathBudget', return_value=budget))
            stack.enter_context(patch('ci.command', side_effect=lambda args, **kw:
                sha if args == ['git', 'rev-parse', 'HEAD'] else ''))
            checkout = stack.enter_context(patch('ci.require_checkout', return_value={
                'source_sha': sha, 'source_dirty': False}))
            stack.enter_context(patch('ci.run'))
            stack.enter_context(patch('ci.qualify_toolchain', return_value=True))
            stack.enter_context(patch('ci.console_state', return_value={}))
            stack.enter_context(patch('ci.require_console', return_value={}))
            stack.enter_context(patch('ci.redact_values', return_value=[]))
            stack.enter_context(patch('ci.settle_apps', return_value={}))
            def reader(args, log):
                if mode == 'scope-exit' and log.name == 'gui-reader.log':
                    clock.to(budget.work.deadline)
                if log.name == 'gui-reader-end.log':
                    if mode == 'end-zero':clock.to(budget.work.deadline)
                    if mode in ('end-clamp', 'end-cross'):clock.to(budget.work.deadline - .25)
                return {}
            stack.enter_context(patch('ci.native_report', side_effect=reader))
            def console(*args, **kwargs):
                console_calls.append(kwargs)
                if len(console_calls) == 2 and mode == 'end-cross':clock.advance(.5)
                return b'inert console'
            stack.enter_context(patch('ci.subprocess.check_output', side_effect=console))
            def qualify(*args, **kwargs):
                if mode in ('owner', 'owner-expiry', 'retention-expiry'):
                    budget.fail('inert owner failure')
                    if mode == 'owner-expiry':clock.to(budget.work.deadline)
                    if mode == 'retention-expiry':clock.to(budget.retention.deadline)
                    raise owner_error
                return {}
            stack.enter_context(patch('ci_paths.qualify', side_effect=qualify))
            def export(raw, out, *args, **kwargs):
                self.assertEqual(active().kind if active() is not None else None,
                                 'retention' if not ordinary else None)
                record = json.loads((raw / 'ci-report.json').read_text())
                exports.append(record)
                (out / 'ci-report.json').write_text(json.dumps(record))
                if export_error:raise retention_error
            stack.enter_context(patch('ci.export_evidence', side_effect=export))
            caught = None
            # A real enclosing context must be restored by both work and
            # retention owners; it is independent of the failed work latch.
            with using(budget.retention if not ordinary and mode != 'retention-expiry' else None):
                parent = active()
                try:ci.main()
                except BaseException as error:caught = error
                self.assertIs(active(), parent)
            self.assertIsNone(active())
            if mode == 'end-zero':self.assertEqual(len(console_calls), 1)
            if mode in ('end-clamp', 'end-cross'):
                self.assertEqual(len(console_calls), 2)
                self.assertGreater(console_calls[1]['timeout'], 0)
                self.assertLessEqual(console_calls[1]['timeout'], .25)
            if mode in ('end-zero', 'end-cross'):self.assertEqual(checkout.call_count, 2)
            if ordinary:self.assertNotIn('timeout', console_calls[0])
            else:self.assertLessEqual(console_calls[0]['timeout'], 30)
            raw_path = root / 'out-private/ci-report.json'
            self.assertTrue(raw_path.exists(), 'actual main must enter independent report retention')
            raw_report = json.loads(raw_path.read_text())
            public_report = json.loads((output / 'ci-report.json').read_text()) if (output / 'ci-report.json').exists() else None
            if mode in ('owner', 'owner-expiry', 'retention-expiry'):
                self.assertIs(caught, owner_error)
                self.assertEqual(raw_report['error'], str(owner_error))
            elif mode in ('scope-exit', 'end-zero', 'end-cross'):
                self.assertIsInstance(caught, BudgetExpired)
            elif export_error:self.assertIs(caught, retention_error)
            else:self.assertIsNone(caught)
            if caught is not None:
                self.assertEqual(raw_report['result'], 'failed')
                if public_report is not None:self.assertEqual(public_report['result'], 'failed')
                if mode != 'normal':self.assertTrue(budget.failed)
            self.assertEqual(len(exports), 0 if mode == 'retention-expiry' else 1)
            if mode in ('owner', 'owner-expiry', 'scope-exit'):
                self.assertEqual(exports[0]['result'], 'failed')
            if export_error:self.assertEqual(raw_report['finalization_error'], str(retention_error))


    def test_latched_owner_failure_still_exports_once(self):self.exercise('owner')
    def test_work_expiry_preserves_owner_and_exports_once(self):self.exercise('owner-expiry')
    def test_failed_normal_scope_exit_still_exports_once(self):self.exercise('scope-exit')
    def test_export_error_does_not_replace_owner(self):self.exercise('owner', export_error=True)
    def test_export_error_does_not_replace_failed_scope_exit(self):self.exercise('scope-exit', export_error=True)
    def test_retention_failure_without_owner_propagates(self):self.exercise('normal', export_error=True)
    def test_retention_admission_error_does_not_replace_owner(self):self.exercise('retention-expiry')
    def test_end_console_zero_remaining_never_launches(self):self.exercise('end-zero')
    def test_end_console_positive_remaining_clamps(self):self.exercise('end-clamp')
    def test_end_console_crossing_blocks_final_checkout(self):self.exercise('end-cross')
    def test_ordinary_initial_console_keeps_previous_no_timeout(self):self.exercise('ordinary', ordinary=True)


class CheckoutClockControls(unittest.TestCase):
    def exercise(self, mode):
        clock = Clock()
        budget = clock.budget()
        root = Path('/inert-exact-repository')
        sha = 'a' * 40
        calls = []
        def query(args, **kwargs):
            calls.append((args, kwargs))
            if mode == 'cross':clock.advance(.5)
            if args[1:] == ['rev-parse', 'HEAD']:return sha
            if args[1:] == ['status', '--porcelain']:return ''
            return str(root)
        with patch('ci_qualifications.subprocess.check_output', side_effect=query):
            if mode == 'ordinary':ci_qualifications.require_checkout(root, sha)
            else:
                with using(budget.retention):
                    if mode in ('zero', 'cross'):
                        with self.assertRaises(BudgetExpired):
                            with using(budget.work):
                                clock.to(budget.work.deadline - (0 if mode == 'zero' else .25))
                                ci_qualifications.require_checkout(root, sha)
                    else:
                        with using(budget.work):
                            clock.to(budget.work.deadline - .25)
                            ci_qualifications.require_checkout(root, sha)
        self.assertIsNone(active())
        self.assertEqual(len(calls), {'zero': 0, 'cross': 1}.get(mode, 3))
        for _, kwargs in calls:
            self.assertEqual(kwargs['cwd'], root)
            self.assertTrue(kwargs['text'])
            if mode == 'ordinary':self.assertEqual(kwargs['timeout'], 15)
            else:
                self.assertGreater(kwargs['timeout'], 0)
                self.assertLessEqual(kwargs['timeout'], .25)
        if mode in ('zero', 'cross'):self.assertTrue(budget.failed)

    def test_no_remaining_time_launches_none(self):self.exercise('zero')
    def test_all_three_queries_clamp_to_remaining(self):self.exercise('clamp')
    def test_first_crossing_prevents_next_two_queries(self):self.exercise('cross')
    def test_ordinary_checkout_keeps_fixed_fifteen_seconds(self):self.exercise('ordinary')


if __name__ == '__main__':unittest.main()
