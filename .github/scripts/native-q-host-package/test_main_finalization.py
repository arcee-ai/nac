"""Actual producer-main finalization with inert H/toolchain/compiler/owner ports.

No H/Product code or native process is imported or executed. Test-owned byte
fixtures exercise both real handoff copies, receipt writes and finally export.
"""
from contextlib import contextmanager, ExitStack
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('finalization_subject', HERE/'host-package.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class BudgetExpired(TimeoutError):
    pass


class MainFinalization(unittest.TestCase):
    def exercise(self, failure=None):
        pair = json.loads((HERE/'pair.json').read_text())
        terminal_error = BudgetExpired('Path work original cutoff')
        ordinary_error = RuntimeError('inert ordinary inspection refusal')
        clock = SimpleNamespace(mono=100.0, epoch=1001.0)
        events, budgets = [], []
        with tempfile.TemporaryDirectory(prefix='producer-main-inert-') as temporary:
            root = Path(temporary).resolve()
            def removed():
                self.assertFalse(root.exists(), 'Test-owned temporary tree remains')
                print('INERT-TEMP-REMOVAL '+str(not root.exists()), flush=True)
            self.addCleanup(removed)
            tools, product, output = [root/name for name in ('H', 'P', 'output')]
            (tools/'desktop/macos').mkdir(parents=True)
            (tools/'desktop/macos/ci-toolchain.json').write_text('{}')
            product.mkdir()
            gate = root/'ff8-host-package-gate'; gate.mkdir()
            (gate/'clock-restore-cache.json').write_text('{}')
            handoff = output/'handoff'
            handoffs = ['manifest.json', 'NAC-normal-app-preparation-arm64.zip',
                        'lifecycle/manifest.json', 'lifecycle/NAC-lifecycle-fixture-arm64.zip']

            class Bound:
                def __init__(self, owner, deadline, kind):
                    self.owner, self.deadline, self.kind = owner, deadline, kind
                def check(self):
                    if self.kind == 'work':
                        self.owner.observe()
                        if self.owner.failed:
                            raise AssertionError('Work was reentered after its original failure')
                    if self.owner.monotonic() >= self.deadline:
                        self.owner.fail(self.kind+': original cutoff')
                        raise terminal_error

            @contextmanager
            def using(bound):
                bound.check()
                yield bound
                # Selected H using() also checks after yield. Refuse only at the
                # final work exit, after BOTH real handoff copies and hash checks.
                if bound.kind == 'work' and all((handoff/name).is_file() for name in handoffs):
                    events.append('both-handoffs-at-terminal-exit')
                    if failure == 'terminal':
                        delta = bound.deadline-clock.mono
                        clock.mono += delta
                        clock.epoch += delta
                bound.check()

            original_clock = m.PackageClock
            def package_clock(epochs, bound_type, deadline):
                value = original_clock(epochs, bound_type, deadline,
                                       monotonic=lambda: clock.mono, wall=lambda: clock.epoch)
                budgets.append(value)
                return value

            def command(argv):
                # Closed fake observations: no toolchain/capacity command runs.
                answers = {('sysctl','-n','hw.memsize'): str(6*1024**3),
                    ('sysctl','-n','hw.logicalcpu'): '2', ('xcodebuild','-version'): 'inert Xcode',
                    ('xcrun','--sdk','macosx','--show-sdk-version'): 'inert SDK',
                    ('xcrun','swiftc','--version'): 'inert Swift',
                    ('sw_vers','-productVersion'): 'inert OS', ('sw_vers','-buildVersion'): 'inert build',
                    ('rustc','--version'): 'rustc '+pair['rust_version'], ('node','--version'): pair['node_version']}
                return answers[tuple(argv)]

            def compile_port(argv, log, cap, **kwargs):
                events.append(log.stem)
                if argv[-1:] == ['--inspect'] and failure == 'ordinary':
                    raise ordinary_error
                if len(argv) > 3 and argv[3] in ('normal', 'lifecycle-build'):
                    role = 'normal' if argv[3] == 'normal' else 'lifecycle'
                    directory = output/role; directory.mkdir()
                    name = ('NAC-normal-app-preparation-arm64.zip' if role == 'normal'
                            else 'NAC-lifecycle-fixture-arm64.zip')
                    # Deliberately non-ZIP inert bytes; no production archive writer.
                    (directory/name).write_bytes(('inert '+role+' container').encode())
                    value = dict(container=dict(name=name, sha256=m.digest(directory/name)))
                    if role == 'lifecycle': value['role'] = 'canonical-lifecycle-fixture-v1'
                    (directory/'manifest.json').write_text(json.dumps(value))
                log.write_text('inert phase; no command executed\n')
                log.with_name(log.name+'.ownership.json').write_text(json.dumps(dict(
                    accepted=True, reaped=True, drain_settled=True, unknown=False,
                    primary_error=None, teardown_error=None, synthetic_test_port=True)))

            def export(raw, destination, redactions, **kwargs):
                events.append('retention-export')
                destination.mkdir()
                shutil.copyfile(raw/'host-package.json', destination/'host-package.json')

            modules = {name: ModuleType(name) for name in
                       ('ci','ci_paths_budget','ci_qualifications','ci_support','ci_xctest','lifecycle_package')}
            modules['ci'].__dict__.update(RUN_DEADLINE=9999, command=command, run=compile_port)
            modules['ci_paths_budget'].__dict__.update(Bound=Bound, using=using)
            modules['ci_qualifications'].require_checkout = lambda *args: events.append('checkout-check')
            modules['ci_support'].__dict__.update(qualify_toolchain=lambda *args: None,
                export_evidence=export, redact_values=lambda: [])
            modules['ci_xctest'].runner_environment = lambda: {}
            modules['lifecycle_package'].normal_snapshot = lambda *args: {'synthetic_snapshot': True}
            admission = dict(scope=m.SCOPE, controller_sha='a'*40, allocation_id='inert-finalization',
                attempt=1, retries=0, clock=dict(STARTED=1000, WORK_DEADLINE=3400,
                                               CLEANUP_DEADLINE=3880, HARD_DEADLINE=4000))
            env = dict(ROOT_PACKAGE_ADMISSION=json.dumps(admission), GITHUB_SHA='a'*40,
                GITHUB_REF=m.BRANCH, GITHUB_EVENT_NAME='workflow_dispatch', GITHUB_RUN_ATTEMPT='1',
                H_ROOT=str(tools), P_ROOT=str(product), OUTPUT_ROOT=str(output), RUNNER_TEMP=str(root),
                ImageVersion=pair['host_image'])
            caught = None
            with ExitStack() as stack:
                stack.enter_context(patch.dict(sys.modules, modules))
                stack.enter_context(patch.dict(os.environ, env, clear=True))
                stack.enter_context(patch.object(sys, 'argv', ['host-package.py']))
                stack.enter_context(patch.object(sys, 'path', sys.path.copy()))
                stack.enter_context(patch.object(m.platform, 'system', return_value='Darwin'))
                stack.enter_context(patch.object(m.platform, 'machine', return_value='arm64'))
                stack.enter_context(patch.object(m.time, 'time', side_effect=lambda: clock.epoch))
                stack.enter_context(patch.object(m.time, 'monotonic', side_effect=lambda: clock.mono))
                stack.enter_context(patch.object(m, 'PackageClock', side_effect=package_clock))
                stack.enter_context(patch.object(m, 'cache_ready', return_value={'synthetic_cache': True}))
                stack.enter_context(patch.object(m.shutil, 'disk_usage', return_value=SimpleNamespace(free=16*1024**3)))
                stack.enter_context(patch.object(m, 'STOP', []))
                try: m.main()
                except BaseException as error: caught = error
            raw = json.loads((output/'raw/host-package.json').read_text())
            final = json.loads((handoff/'host-package.json').read_text())
            exported = json.loads((handoff/'receipts/host-package.json').read_text())
            both = all((handoff/name).is_file() for name in handoffs)
            result = dict(case=failure or 'success', raw_status=raw['status'], handoff_status=final['status'],
                exported_status=exported['status'], both_handoffs=both, original_exception_identity=(
                    caught is terminal_error if failure == 'terminal' else caught is ordinary_error if failure else caught is None),
                clock_failures=raw['clock_failures'], error_type=raw.get('error_type'))
            print('FINALIZATION-OBSERVATION '+json.dumps(result, sort_keys=True), flush=True)
            self.assertTrue(result['original_exception_identity'])
            self.assertEqual(raw, final)
            self.assertEqual(raw, exported)
            self.assertIn('retention-export', events)
            self.assertEqual(raw['admission'], admission)
            if failure:
                expected = terminal_error if failure == 'terminal' else ordinary_error
                self.assertIs(caught, expected)
                self.assertEqual(raw['error'], str(expected))
                self.assertEqual(raw['error_type'], type(expected).__name__)
                self.assertEqual(raw['status'], 'FAIL')
            else:
                self.assertIsNone(caught)
                self.assertEqual(raw['status'], 'PASS')
                self.assertNotIn('error', raw)
                self.assertEqual(raw['clock_failures'], [])
            if failure == 'terminal':
                self.assertTrue(both)
                self.assertEqual(events.count('both-handoffs-at-terminal-exit'), 1)
                self.assertEqual(budgets[0].failed, ['work: original cutoff'])
                self.assertEqual(raw['clock_failures'], budgets[0].failed)
            elif failure == 'ordinary':
                self.assertFalse(both)
                self.assertEqual(raw['clock_failures'], [])
        self.assertFalse(root.exists(), 'Test-owned temporary tree must be positively removed')

    def test_terminal_work_exit_after_both_handoffs_retains_FAIL(self):
        self.exercise('terminal')

    def test_genuine_success_retains_PASS_after_both_handoffs(self):
        self.exercise()

    def test_ordinary_failure_keeps_original_exception_and_FAIL(self):
        self.exercise('ordinary')


if __name__ == '__main__':
    unittest.main()
