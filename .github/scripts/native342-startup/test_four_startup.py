"""Inert orchestration and actual Bound/callback tests; no SDK, R build or app."""
import ast
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).parent
PAIR = json.loads((HERE / 'pair.json').read_bytes())
spec = importlib.util.spec_from_file_location('four_startup', HERE / 'four-startup.py')
controller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controller)
# The consumer deliberately consumes H's owner rather than vendoring a clone.
# This explicit source-only test input admits exact H, then loads ONLY Bound.
H = Path(os.environ['NAC_STARTUP_H_ROOT']).resolve()
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=H, text=True).strip() == PAIR['H']
assert not subprocess.check_output(['git', 'status', '--porcelain'], cwd=H)
spec = importlib.util.spec_from_file_location('exact_H_budget', H / 'desktop/macos/ci_paths_budget.py')
budget = importlib.util.module_from_spec(spec)
spec.loader.exec_module(budget)


class SourceControls(unittest.TestCase):
    def setUp(self):
        controller.STOP.clear()
        self.wall, self.mono = 1001, 101
        self.patches = [patch.object(controller.time, 'time', side_effect=lambda: self.wall),
                        patch.object(controller.time, 'monotonic', side_effect=lambda: self.mono)]
        for value in self.patches:
            value.start()
            self.addCleanup(value.stop)
        self.clock = controller.make_clock((1000, 3880, 4480, 4600), budget.Bound)

    def advance(self, seconds):
        self.wall += seconds
        self.mono += seconds

    def admission(self):
        return dict(scope=controller.SCOPE, controller_sha='a' * 40, allocation_id='Root-new-four-source-schema',
                    attempt=1, retries=0, manifest_sha256='b' * 64,
                    producer=dict(run_id=123, artifact_id=456, controller_sha=controller.PRODUCER,
                                  branch=controller.PRODUCER_BRANCH, artifact_name='package-123-1'),
                    clock=dict(STARTED=1000, WORK_DEADLINE=3880, CLEANUP_DEADLINE=4480, HARD_DEADLINE=4600))

    def test_original_queue_inclusive_clock_and_new_scope_never_reuse_old_admission(self):
        value = self.admission()
        self.assertEqual(controller.admit(value, 'a' * 40, now=3700), (1000, 3880, 4480, 4600))
        for changed in (dict(scope='Q04c-on-final-post648-P-onboarding-only'),
                        dict(scope='P10-Q9931-H1c9-R2504-four-startup'),
                        dict(scope='P10-Q9931-R7325-schema50-four-startup'), dict(attempt=2), dict(retries=1),
                        dict(controller_sha='c' * 40), dict(extra=True), dict(manifest_sha256=''),
                        dict(producer={**value['producer'], 'controller_sha': 'c' * 40}),
                        dict(producer={**value['producer'], 'branch': 'codex/old-P9'})):
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                controller.admit({**value, **changed}, 'a' * 40, now=1001)
        for key, entry in [('WORK_DEADLINE', 3881), ('CLEANUP_DEADLINE', 4479), ('HARD_DEADLINE', 4601),
                           ('STARTED', True), ('HARD_DEADLINE', float('inf'))]:
            clock = {**value['clock'], key: entry}
            with self.subTest(clock=clock), self.assertRaises(RuntimeError):
                controller.admit({**value, 'clock': clock}, 'a' * 40, now=1001)
        for now in (999, 3880, 4600, float('nan')):
            with self.assertRaises(RuntimeError):
                controller.admit(value, 'a' * 40, now=now)

    def episode(self, *, failure=None, protocol_failure=False, missing_protocol=False, elapsed=1):
        events, progress = [], []
        startup = Mock(spec=['CASES', 'PROTOCOL_SOURCE', 'PRODUCT', 'run_case'])
        startup.CASES, startup.PROTOCOL_SOURCE, startup.PRODUCT = controller.CASES, PAIR['R'], PAIR['P']
        protocol = Mock(spec=['build', 'verify', 'SCENARIOS'])
        protocol.SCENARIOS = ('future-main', 'future-wal', 'busy-future', 'invalid-db')
        def build(root, output, run, *, product, manifest, package_admission):
            events.append('R-build')
            self.assertEqual((product, manifest, package_admission),
                ('exact-P10-checkout', 'actual-manifest', {'provenance': 'actual'}))
            self.assertIs(budget.active(), self.clock.work)
            return 'private-R', {'actual': 'inert receipt'}
        def verify(private, receipt, app, manifest, admission, output, run):
            events.append('R-verify')
            self.assertEqual((private, receipt, app, manifest, admission),
                ('private-R', {'actual': 'inert receipt'}, 'actual-P10-app', 'actual-manifest', {'provenance': 'actual'}))
            if protocol_failure:
                raise RuntimeError('inert R retirement failure')
            return None if missing_protocol else dict(R=PAIR['R'], P=PAIR['P'], observations=[
                dict(scenario=name, owner_cleanup=True, preserved_store_config=True) for name in protocol.SCENARIOS])
        protocol.build.side_effect, protocol.verify.side_effect = build, verify
        def case(**kwargs):
            name = kwargs['scenario']
            events.append(name)
            try:
                with budget.using(self.clock.work):
                    self.advance(elapsed)
                    if name == failure:
                        raise RuntimeError('inert case failure')
                    kwargs['folder'].mkdir()
                    (kwargs['folder'] / 'case.json').write_text('{"inert":true}\n')
                    return dict(scenario=name, passed=True, cleanup=dict(owned_processes_settled=True),
                        profile_removed=True, persistent_authorization_policy_unchanged=True,
                        public_test_requested=True, input_completion_unknown=False, attachments_complete=True,
                        live_api={}, persisted_api={}, image={}, actual_result={}, integrity={}, provider={})
            finally:
                with budget.using(self.clock.cleanup):
                    events.append(name + '-cleanup')
        startup.run_case.side_effect = case
        def execute():
            with tempfile.TemporaryDirectory() as tmp:
                return controller.selected_episode(startup, protocol, self.clock, budget.using,
                    evidence=Path(tmp), profiles='owned-profiles', app='actual-P10-app', manifest='actual-manifest',
                    product='exact-P10-checkout', tests='exact-Q-checkout', protocol_root='independent-R-checkout',
                    harness_sha=PAIR['H'], package_admission={'provenance': 'actual'}, selection='actual-selection',
                    observer='actual-observer', image_reader='actual-reader', run=Mock(), command=Mock(),
                    native_report=Mock(), progress=lambda **v: progress.append(v))
        return execute, events, progress

    def test_serial_four_success_requires_R_before_any_case_and_same_original_clock(self):
        execute, events, progress = self.episode()
        original = tuple(bound.deadline for bound in (self.clock.work, self.clock.cleanup, self.clock.retention))
        protocol, cases = execute()
        self.assertEqual(events, ['R-build', 'R-verify', *[v for n in controller.CASES for v in (n, n + '-cleanup')]])
        self.assertEqual([r['scenario'] for r in cases], list(controller.CASES))
        self.assertEqual(tuple(bound.deadline for bound in (self.clock.work, self.clock.cleanup, self.clock.retention)), original)
        self.assertEqual(self.clock.failed, [])
        self.assertFalse(self.clock.cleaning)
        self.clock.work.check()
        self.assertIn('protocol', progress[0])

    def test_case_two_failure_stops_three_and_four_and_keeps_cleanup_retention(self):
        execute, events, progress = self.episode(failure='configuredLocal')
        original = self.clock.work.deadline
        with self.assertRaises(RuntimeError):
            execute()
        self.assertEqual(events[-3:], ['onboarding-cleanup', 'configuredLocal', 'configuredLocal-cleanup'])
        self.assertNotIn('invalidConfig', events)
        self.assertNotIn('futureStore', events)
        self.assertTrue(self.clock.failed)
        self.assertTrue(self.clock.cleaning)
        with self.assertRaises((RuntimeError, TimeoutError)):
            self.clock.work.check()
        with budget.using(self.clock.cleanup), budget.using(self.clock.retention):
            self.assertEqual(self.clock.work.deadline, original)

    def test_required_R_failure_or_missing_typed_receipt_never_reaches_UI(self):
        for kw in (dict(protocol_failure=True), dict(missing_protocol=True)):
            with self.subTest(kw=kw):
                self.clock = controller.make_clock((1000, 3880, 4480, 4600), budget.Bound)
                execute, events, progress = self.episode(**kw)
                with self.assertRaises(RuntimeError):
                    execute()
                self.assertEqual(events, ['R-build', 'R-verify'])
                self.assertEqual(progress, [])
                self.assertTrue(self.clock.failed)

    def test_insufficient_original_phase_time_latches_without_launch_or_renewal(self):
        self.advance(1800)
        execute, events, progress = self.episode()
        deadlines = self.clock.work.deadline, self.clock.cleanup.deadline, self.clock.retention.deadline
        with self.assertRaises((RuntimeError, TimeoutError)):
            execute()
        self.assertEqual(events, [])
        self.wall -= 1000
        self.mono -= 1000  # Even a synthetic clock rollback cannot revive latch.
        with self.assertRaises((RuntimeError, TimeoutError)):
            self.clock.work.check()
        self.assertEqual(deadlines, (self.clock.work.deadline, self.clock.cleanup.deadline, self.clock.retention.deadline))

    def test_successful_late_case_cannot_spend_reserve_to_start_next_case(self):
        execute, events, progress = self.episode(elapsed=2300)
        original = self.clock.work.deadline, self.clock.cleanup.deadline, self.clock.retention.deadline
        with self.assertRaises((RuntimeError, TimeoutError)):
            execute()
        self.assertEqual(events, ['R-build', 'R-verify', 'onboarding', 'onboarding-cleanup'])
        self.assertEqual(original, (self.clock.work.deadline, self.clock.cleanup.deadline, self.clock.retention.deadline))
        self.assertTrue(self.clock.failed)
        with budget.using(self.clock.cleanup), budget.using(self.clock.retention):
            pass

    def test_signal_and_clock_discontinuity_stop_work_but_not_original_cleanup(self):
        for fail in ('signal', 'wall-step'):
            self.clock = controller.make_clock((1000, 3880, 4480, 4600), budget.Bound)
            if fail == 'signal':
                controller.STOP.append(15)
            else:
                self.wall += 3
            with self.assertRaises(RuntimeError):
                self.clock.work.check()
            with budget.using(self.clock.cleanup), budget.using(self.clock.retention):
                pass
            controller.STOP.clear()

    def test_failed_AX_JSON_reaches_actual_consumer_final_export_without_cleanup(self):
        import sys
        previous = list(sys.path)
        sys.path.insert(0, str(H / 'desktop/macos'))
        try:
            spec = importlib.util.spec_from_file_location('exact_H_attachment_fixtures', H / 'desktop/macos/test_ci_startup_attachments.py')
            module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
            from ci_startup_attachments import collect
            from ci_support import export_evidence
            helper = module.StartupAttachmentTests()
            config, hashed, witness, row = helper.ax_row()
            config['harness_sha'] = row['harness_sha'] = PAIR['H']
            self.assertEqual(row['test_source_sha'], PAIR['Q'])
            self.assertEqual(row['startup_source_sha256'], PAIR['q_swift_sha256'])
            with tempfile.TemporaryDirectory() as temporary:
                raw = Path(temporary)
                with self.assertRaisesRegex(RuntimeError, 'cleanup_missing'):
                    collect(helper.tool(raw, [('nac342-ax-refusal-v1-configuredLocal', json.dumps(row).encode())], result='Failed'),
                        raw / 'unit.xcresult', config, hashed, witness, raw / 'selected')
                tree = ast.parse((HERE / 'four-startup.py').read_bytes())
                calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                         and n.func.id == 'export_evidence']
                self.assertEqual(len(calls), 1)
                namespace = dict(export_evidence=export_evidence, evidence=raw / 'selected', exported=raw / 'exported',
                    redact_values=lambda: [], roots={'H': H}, package=raw / 'package', output=raw)
                exec(compile(ast.fix_missing_locations(ast.Module(body=[ast.Expr(value=calls[0])], type_ignores=[])),
                             '<actual-consumer-final-export>', 'exec'), namespace)
                exported = raw / 'exported/nac342-ax-refusal-v1-configuredLocal.json'
                self.assertEqual(json.loads(exported.read_bytes()), row)
                index = json.loads((raw / 'exported/index.json').read_bytes())
                self.assertEqual(index['ax_refusal']['retention'], 'retained')
                self.assertFalse(index['complete']); self.assertTrue(index['input_completion_unknown'])
        finally:
            sys.path[:] = previous

    def test_actual_owned_callback_returns_work_after_test_and_latches_failure(self):
        tree = ast.parse((HERE / 'four-startup.py').read_bytes())
        main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
        callbacks = [n for n in main.body if isinstance(n, ast.FunctionDef) and n.name in ('bound', 'run')]
        observed, report = [], {'phases': []}
        ci = Mock(spec=['run'])
        ci.run.side_effect = lambda *a, **k: observed.append(budget.active().kind)
        namespace = dict(clock=self.clock, active=budget.active, using=budget.using, ci=ci,
            roots={'H': H}, report=report, save=Mock(), time=controller.time, Path=Path, STOP=controller.STOP,
            runtime_build_receipt=Mock())
        exec(compile(ast.Module(body=callbacks, type_ignores=[]), '<actual-owned-callbacks>', 'exec'), namespace)
        namespace['run'](['xcodebuild', 'test-without-building'], Path('/inert-log'), 300)
        self.assertFalse(self.clock.cleaning)
        self.assertEqual(observed, ['work'])
        with budget.using(self.clock.cleanup):
            namespace['run'](['inert-final-observation'], Path('/inert-log'), 60)
        self.assertEqual(observed, ['work', 'cleanup'])
        ci.run.side_effect = RuntimeError('inert ownership unknown')
        with self.assertRaises(RuntimeError):
            namespace['run'](['xcodebuild', 'test-without-building'], Path('/inert-log'), 300)
        self.assertTrue(self.clock.failed)
        self.assertTrue(self.clock.cleaning)
        with self.assertRaises((RuntimeError, TimeoutError)):
            self.clock.work.check()


if __name__ == '__main__':
    unittest.main()
