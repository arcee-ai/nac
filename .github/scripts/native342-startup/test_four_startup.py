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
import atexit
from unittest.mock import Mock, patch

HERE = Path(__file__).parent
PAIR = json.loads((HERE / 'pair.json').read_bytes())
spec = importlib.util.spec_from_file_location('four_startup', HERE / 'four-startup.py')
controller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controller)
# Load exact immutable H Python owner sources as an inert temporary fixture.
# No checkout/worktree is made or another owner's active loan inspected.
repository = HERE.parents[2]
fixture = tempfile.TemporaryDirectory(prefix='nac-exact-H-python-source-')
atexit.register(fixture.cleanup)
H = Path(fixture.name)
paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', PAIR['H'], 'desktop/macos'],
                                cwd=repository, text=True).splitlines()
for name in paths:
    if name.endswith(('.py', '.xcscheme', '/project.pbxproj')) or name in ('desktop/macos/ci-qualifications.json', 'desktop/macos/ci-toolchain.json'):
        target = H / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(subprocess.check_output(['git', 'show', PAIR['H'] + ':' + name], cwd=repository))
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
        return dict(scope=controller.SCOPE, controller_sha='a' * 40, purpose='native', allocation_id='Root-new-four-source-schema',
                    attempt=1, retries=0, manifest_sha256=controller.MANIFEST_SHA256,
                    producer=dict(run_id=controller.PRODUCER_RUN, artifact_id=controller.PRODUCER_ARTIFACT, controller_sha=controller.PRODUCER,
                                  branch=controller.PRODUCER_BRANCH, artifact_name=controller.PRODUCER_ARTIFACT_NAME),
                    clock=dict(STARTED=1000, WORK_DEADLINE=3880, CLEANUP_DEADLINE=4480, HARD_DEADLINE=4600))

    def test_original_queue_inclusive_clock_and_new_scope_never_reuse_old_admission(self):
        value = self.admission()
        self.assertEqual(controller.admit(value, 'a' * 40, now=3700), (1000, 3880, 4480, 4600))
        for changed in (dict(scope='Q04c-on-final-post648-P-onboarding-only'),
                        dict(scope='P10-Q9931-H1c9-R2504-four-startup'),
                        dict(scope='P10-Q9931-R7325-schema50-four-startup'), dict(attempt=2), dict(retries=1),
                        dict(controller_sha='c' * 40), dict(extra=True), dict(manifest_sha256=''),
                        dict(producer={**value['producer'], 'controller_sha': 'c' * 40}),
                        dict(producer={**value['producer'], 'branch': 'codex/old-P9'}),
                        dict(producer={**value['producer'], 'run_id': 42426305195}),
                        dict(producer={**value['producer'], 'artifact_id': 13594999645}),
                        dict(producer={**value['producer'], 'artifact_name': 'lifecycle-role'}),
                        dict(manifest_sha256='0' * 64)):
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
                ('exact-P12-checkout', 'actual-manifest', {'provenance': 'actual'}))
            self.assertIs(budget.active(), self.clock.work)
            return 'private-R', {'actual': 'inert receipt'}
        def verify(private, receipt, app, manifest, admission, output, run):
            events.append('R-verify')
            self.assertEqual((private, receipt, app, manifest, admission),
                ('private-R', {'actual': 'inert receipt'}, 'actual-P12-app', 'actual-manifest', {'provenance': 'actual'}))
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
                    evidence=Path(tmp), profiles='owned-profiles', app='actual-P12-app', manifest='actual-manifest',
                    product='exact-P12-checkout', tests='exact-Q-checkout', protocol_root='independent-R-checkout',
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

    def test_complete_helper_compilation_uses_H_service_and_all_four_pinned_inputs(self):
        tree = ast.parse((HERE / 'four-startup.py').read_bytes())
        main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
        scope = next(n for n in ast.walk(main) if isinstance(n, ast.With)
                     and any(isinstance(x, ast.Assign) and any(isinstance(t, ast.Name)
                         and t.id == 'helper_sources' for t in x.targets) for x in n.body))
        start = next(i for i,n in enumerate(scope.body) if isinstance(n, ast.Assign)
                     and any(isinstance(t,ast.Name) and t.id=='helper_sources' for t in n.targets))
        stop = next(i for i,n in enumerate(scope.body[start:],start) if isinstance(n,ast.Assign)
                    and any(isinstance(t,ast.Subscript) and isinstance(t.value,ast.Name)
                        and t.value.id=='report' and isinstance(t.slice,ast.Constant)
                        and t.slice.value=='observer_sources_sha256' for t in n.targets))
        code = compile(ast.Module(body=scope.body[start:stop+1],type_ignores=[]),'<actual-helper-composition>','exec')
        for mutate in (False, True):
            with self.subTest(mutate=mutate), tempfile.TemporaryDirectory() as temp:
                root=Path(temp);files=[]
                for name in ('CIStartupObserver.swift','CIStartupAXWitness.swift','StartupAXGuard.swift','StartupAXReceipt.swift'):
                    file=root/name;file.write_bytes(b'inert source');files.append(str(file))
                startup=Mock(spec=['observer_sources']);startup.observer_sources.return_value=files
                calls=[];report={}
                def run(argv,*args,**kwargs):
                    calls.append(argv)
                    if mutate and len(calls)==1:Path(files[1]).write_bytes(b'changed source')
                namespace=dict(startup=startup,roots={'H':Path('/exact-H'),'Q':Path('/exact-Q')},digest=controller.digest,
                    observer=root/'observer',image_reader=root/'image',gui_reader=root/'gui',evidence=root,
                    runner_environment=lambda:{},run=run,require=controller.require,report=report,str=str)
                if mutate:
                    with self.assertRaisesRegex(RuntimeError,'source inputs changed'):exec(code,namespace)
                    self.assertNotIn('observer_sources_sha256',report)
                else:
                    exec(code,namespace)
                    self.assertEqual(set(report['observer_sources_sha256']),set(files))
                startup.observer_sources.assert_called_once_with(Path('/exact-H'),Path('/exact-Q'))
                self.assertEqual(len(calls),3)
                self.assertEqual(calls[0][5:9],files)
                self.assertIn('-parse-as-library',calls[0])

    def closing_main(self, expire, ordinary_failure=False):
        from contextlib import contextmanager
        tree=ast.parse((HERE/'four-startup.py').read_bytes())
        main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
        actual=next(n for n in main.body if isinstance(n,ast.Try))
        final=actual.body[-1]
        self.assertIsInstance(final,ast.With)
        code=compile(ast.fix_missing_locations(ast.Module(body=[ast.Try(body=[final],handlers=actual.handlers,
            orelse=actual.orelse,finalbody=actual.finalbody)],type_ignores=[])),'<actual-main-closing>','exec')
        observed=[];original=[]
        ordinary=ValueError("inert original final-check failure")
        @contextmanager
        def using(bound):
            try:
                with budget.using(bound):
                    yield
                    if expire and bound.kind=='cleanup':
                        self.advance(self.clock.cleanup.deadline-self.mono+1)
            except BaseException as error:
                original.append(error)
                raise
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);profiles=root/'profiles';profiles.mkdir()
            raw=root/'raw';raw.mkdir();exported=root/'exported';exported.mkdir()
            report=dict(status='FAIL',package_before={'exact':'inert-package'},
                prefix_binary_acceptance=False,final_integrated_native_acceptance=False)
            startup=Mock(spec=['package_contract']);startup.package_contract.return_value=report['package_before']
            def save():controller.write(raw/'four-startup.json',report)
            def export(*args,**kwargs):
                observed.append('export');controller.write(exported/'four-startup.json',report)
            def checkout(*args):
                if ordinary_failure:raise ordinary
            namespace=dict(clock=self.clock,using=using,report=report,console=lambda _: {},startup=startup,
                contract=object(),manifest=root/'manifest',app=root/'app',roots={k:root/k for k in ('H','P','Q','R')},pair=PAIR,
                evidence=raw,profiles=profiles,run=Mock(),require=controller.require,require_checkout=checkout,
                controller=root/'controller',admission={'controller_sha':'a'*40},STOP=controller.STOP,
                time=controller.time,save=save,export_evidence=export,redact_values=lambda:[],
                package=root/'package',output=root,exported=exported)
            caught=None
            try:exec(code,namespace)
            except BaseException as error:caught=error
            value=json.loads((exported/'four-startup.json').read_bytes())
            self.assertEqual(value,json.loads((raw/'four-startup.json').read_bytes()))
            self.assertFalse(profiles.exists(),repr(caught))
            self.assertEqual(observed,['export'])
            self.assertFalse(value['prefix_binary_acceptance']);self.assertFalse(value['final_integrated_native_acceptance'])
            return value,caught,original

    def test_actual_main_cleanup_exit_expiry_exports_failure(self):
        value,caught,original=self.closing_main(True)
        self.assertTrue(original)
        self.assertIs(caught,original[0])
        self.assertEqual(value['status'],'FAIL')
        self.assertEqual(value['error_type'],type(caught).__name__)
        self.assertIn('episode failed/unknown',value['clock_failures'])

    def test_actual_main_ordinary_failure_retains_original_exception_and_failure_export(self):
        value,caught,original=self.closing_main(False,ordinary_failure=True)
        self.assertIsInstance(caught,ValueError)
        self.assertIs(caught,original[0])
        self.assertEqual(value['status'],'FAIL');self.assertEqual(value['error_type'],'ValueError')
        self.assertIn('episode failed/unknown',value['clock_failures'])

    def test_actual_main_normal_cleanup_exit_preserves_success_without_acceptance(self):
        value,caught,original=self.closing_main(False)
        self.assertIsNone(caught);self.assertEqual(original,[])
        self.assertEqual(value['status'],'PASS');self.assertEqual(value['clock_failures'],[])

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

    def test_actual_owned_callback_forwards_complete_R_capture_without_new_owner_or_budget(self):
        tree = ast.parse((HERE / 'four-startup.py').read_bytes())
        main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
        callbacks = [n for n in main.body if isinstance(n, ast.FunctionDef) and n.name in ('bound', 'run')]
        report, ci = {'phases': []}, Mock(spec=['run'])
        namespace = dict(clock=self.clock, active=budget.active, using=budget.using, ci=ci,
            roots={'H': H}, report=report, save=Mock(), time=controller.time, Path=Path, STOP=controller.STOP,
            runtime_build_receipt=Mock(), COMPLETE_LOG_LIMIT=2*1024*1024, require=controller.require)
        exec(compile(ast.Module(body=callbacks, type_ignores=[]), '<actual-complete-R-callback>', 'exec'), namespace)
        argv = ['cargo', 'test', '--locked', '-p', 'nac-server', '--test',
                'desktop_schema_contract', '--no-run', '--message-format=json']
        log = Path('/inert/startup-protocol-runner/protocol-build.log')
        namespace['run'](argv, log, 900, complete_output_limit=2*1024*1024)
        self.assertEqual(ci.run.call_count, 1)
        self.assertEqual(ci.run.call_args.kwargs['complete_output_limit'], 2*1024*1024)
        self.assertEqual(report['phases'][0]['complete_output_limit_bytes'], 2*1024*1024)
        self.assertEqual(report['phases'][0]['status'], 'PASS')
        self.assertFalse(self.clock.cleaning)
        for command, path, cap in [(['xcodebuild'], log, 2*1024*1024),
                                   (argv, Path('/inert/other.log'), 2*1024*1024),
                                   (argv, log, 2*1024*1024+1)]:
            with self.subTest(command=command), self.assertRaises(RuntimeError):
                namespace['run'](command, path, 900, complete_output_limit=cap)
        self.assertEqual(ci.run.call_count, 1)



class BuildOnlyControls(unittest.TestCase):
    advance = SourceControls.advance

    def setUp(self):
        SourceControls.setUp(self)
        self.tmp = self.enterContext(tempfile.TemporaryDirectory(prefix='nac-c17-inert-'))
        self.base = Path(self.tmp).resolve()
        self.profiles = self.base / 'profiles'
        self.profiles.mkdir(mode=0o700)
        self.events = []
        self.original = ValueError('original inert work error')
        self.cleanup_error = RuntimeError('inert cleanup error')
        self.mode = None
        self.profile = None
        self.declaration = None
        self.owned_runs = []
        self.provider = Mock(spec=['start', 'stop', 'settled'])
        self.provider.settled = False
        def start():
            self.events.append('provider-start')
            return 'http://127.0.0.1:12345'
        def stop(*, require_complete):
            self.assertFalse(require_complete)
            self.events.append('provider-stop')
            if self.mode in ('provider', 'both'): raise self.cleanup_error
            self.provider.settled = True
        self.provider.start.side_effect = start
        self.provider.stop.side_effect = stop
        names = ['Provider', 'observer_sources', 'prepare_profile', 'ax_declaration', 'prepare_configuration',
                 'generated_runner', 'immutable_snapshot', 'remove_profile', 'digest']
        self.startup = Mock(spec=names)
        self.startup.Provider.return_value = self.provider
        self.sources = []
        for name in ('Observer.swift', 'Witness.swift', 'Guard.swift', 'Receipt.swift'):
            path = self.base / name
            path.write_bytes(b'inert source')
            self.sources.append(str(path))
        self.selection = dict(project=str(self.base / 'ordinary.xcodeproj'), receipt=dict(
            sources={path:controller.digest(path) for path in self.sources}))
        self.startup.observer_sources.return_value = self.sources
        self.startup.digest.side_effect = controller.digest
        self.startup.immutable_snapshot.return_value = dict(config=None, store=None, wal_shm=[])
        def prepare(parent, scenario, url, *, run, directory):
            self.events.append('profile')
            self.assertEqual((parent, scenario, url), (self.profiles, 'configuredLocal', 'http://127.0.0.1:12345/models-dev'))
            root = Path(tempfile.mkdtemp(prefix='nac342-xctest-configuredLocal-', dir=parent))
            home = root / 'home'
            home.mkdir(mode=0o700)
            (home / 'nac').mkdir(mode=0o700)
            self.profile = dict(root=root, home=home, scenario=scenario)
            run(['git', 'init'], directory / 'profile.log', 15)
            if self.mode == 'prepare': raise self.original
            return self.profile
        self.startup.prepare_profile.side_effect = prepare
        def declaration(profile, helper, tests):
            self.events.append('declaration')
            self.assertIs(profile, self.profile)
            self.assertTrue(helper.is_file())
            proof = profile['root'] / 'ax-witness'
            proof.mkdir(mode=0o700)
            (proof / 'requests').mkdir(mode=0o700)
            self.declaration = dict(path=str(proof / 'receipt.json'), nonce='a'*64, owner_pid=os.getpid())
            return self.declaration
        self.startup.ax_declaration.side_effect = declaration
        def configuration(profile, app, manifest, product, tests, harness_sha, *, run, directory, ax_witness):
            self.events.append('configuration')
            self.assertIs(profile, self.profile)
            self.assertIs(ax_witness, self.declaration)
            run(['inert-environment-resolver'], directory / 'environment.log', 45)
            if self.mode == 'configuration': raise self.original
            config = dict(scenario='configuredLocal', harness_sha=harness_sha, ax_witness=ax_witness)
            path = profile['root'] / 'startup-config.json'
            path.write_text(json.dumps(config))
            return config, path, {'actual_normal_package':'inert port'}
        self.startup.prepare_configuration.side_effect = configuration
        def generated(folder, config_path, hashed, config, selection, run, *, private_request, command):
            self.events.append('generated-runner')
            self.assertIs(selection, self.selection)
            self.assertIs(private_request['profile'], self.profile)
            self.assertIs(private_request['declaration'], self.declaration)
            self.assertEqual(private_request['profiles_root'], self.profiles)
            self.assertEqual(hashed, controller.digest(config_path))
            baseline = folder / 'normal-signature-baseline'
            baseline.mkdir(mode=0o700)
            command(['xcodebuild', '-version'])
            for name, target in (('baseline',baseline), ('candidate',folder)):
                self.events.append(name)
                (target / 'derived').mkdir(mode=0o700)
                run(['xcodebuild', 'build-for-testing'], target / 'build.log', 240)
            port = Path(self.declaration['path']).parent / 'requests'
            paths = (self.profile['root'], port.parent, port)
            gate = dict(schema='nac342-request-child-signatures-v1', acceptance=False,
                configuration_sha256=hashed, sources=selection['receipt']['sources'],
                baseline=dict(runner={},testbundle={}), candidate=dict(runner={},testbundle={}),
                both_actual_signatures_verified=True, request_port=dict(nonce=self.declaration['nonce'],
                directory=str(port), identities={str(p):controller.directory_identity(p) for p in paths},
                actual_runner_entitlements_verified=True, actual_testbundle_entitlements_verified=True))
            for _ in range(4):
                command(['/usr/bin/codesign','--verify','inert'])
                command(['/usr/bin/codesign','--display','inert'])
            if self.mode in ('signature', 'both'): raise self.original
            if self.mode == 'missing-gate': gate['both_actual_signatures_verified'] = False
            if self.mode == 'wrong-gate': gate['configuration_sha256'] = 'changed'
            if self.mode == 'home': (self.profile['home'] / 'foreign.db').write_bytes(b'changed')
            if self.mode == 'port': port.chmod(0o755)
            if self.mode == 'root':
                old=self.profile['root'];old.rename(old.with_name(old.name+'-retained'));old.mkdir(mode=0o700)
            if self.mode == 'integrity': self.startup.immutable_snapshot.return_value = dict(changed=True)
            return folder/'inert.xctestrun',dict(private_request_signature_gate=gate)
        self.startup.generated_runner.side_effect = generated
        def remove(profile, proof):
            import shutil
            self.events.append('remove')
            self.assertIs(profile, self.profile)
            self.assertTrue(proof['owned_processes_settled'])
            self.assertTrue(proof['provider_settled'])
            self.assertTrue(proof['helper_receipts'])
            self.assertFalse(proof['public_test_requested'])
            self.assertEqual(proof['root'], str(profile['root']))
            if self.mode == 'remove': raise self.cleanup_error
            shutil.rmtree(profile['root'])
        self.startup.remove_profile.side_effect = remove

    def read(self, path, limit):
        self.assertLessEqual(path.stat().st_size, limit)
        self.assertFalse(path.is_symlink())
        return path.read_bytes()

    def owned_port(self, argv, log, cap, **kwargs):
        # Never invoke a command. The exact route/callback executes against data.
        self.owned_runs.append((argv, log, cap))
        self.assertNotIn('test-without-building', argv)
        log.write_text('inert command port')
        if '-o' in argv: Path(argv[argv.index('-o')+1]).write_bytes(b'inert nonexecutable helper')
        owner=dict(accepted=True,pid=100+len(self.owned_runs),reaped=True,drain_settled=True,
                   unknown=False,teardown_error=None)
        path=log.with_name(log.name+'.ownership.json')
        if self.mode=='unknown':owner['unknown']=True
        if self.mode=='unreaped':owner['reaped']=False
        if self.mode=='drain':owner['drain_settled']=False
        if self.mode=='teardown':owner['teardown_error']='inert'
        if self.mode!='missing-owner':path.write_text(json.dumps(owner))
        if self.mode=='observer' and argv[0]=='xcrun':raise self.original
        if self.mode=='baseline' and log.parent.name=='normal-signature-baseline':raise self.original
        if self.mode=='candidate' and argv[:2]==['xcodebuild','build-for-testing'] and log.parent.name!='normal-signature-baseline':raise self.original

    def execute(self, using=None):
        return controller.signature_build_only(self.startup, self.clock, using or budget.using,
            folder=self.base/'signature',profiles=self.profiles,app=self.base/'app',manifest=self.base/'manifest',
            product=self.base/'P',tests=self.base/'Q',harness_sha=PAIR['H'],selection=self.selection,
            observer=self.base/'observer',harness=self.base/'H',run=self.owned_port,bounded_file=self.read)

    def test_live_fixture_pair_route_stops_before_native_and_uses_positive_cleanup(self):
        proof=self.execute()
        self.assertEqual(self.events,['provider-start','profile','declaration','configuration','generated-runner',
                                     'baseline','candidate','provider-stop','remove'])
        self.assertEqual([cap for argv,_,cap in self.owned_runs if argv[:2]==['xcodebuild','build-for-testing']],[240,240])
        self.assertEqual(sum(argv[:2]==['/usr/bin/codesign','--verify'] for argv,_,_ in self.owned_runs),4)
        self.assertEqual(sum(argv[:2]==['/usr/bin/codesign','--display'] for argv,_,_ in self.owned_runs),4)
        self.assertEqual(proof['status'],'PASS')
        self.assertTrue(proof['profile_removed'])
        self.assertFalse(proof['public_test_requested'])
        self.assertTrue(proof['input_completion_unknown'])
        self.assertEqual(len(proof['helper_receipts']),len(self.owned_runs))
        self.assertFalse(any(self.profiles.iterdir()))
        self.assertFalse((self.base/'signature/derived').exists())
        self.assertFalse((self.base/'signature/normal-signature-baseline/derived').exists())
        # spec has no run_case/OwnerWitness/AXCompanion/setup_engine/native port.
        self.assertNotIn('test-without-building',str(self.owned_runs))

    def test_work_and_signature_failures_preserve_original_and_stop_without_native(self):
        for mode in ('observer','prepare','configuration','baseline','candidate','signature','both'):
            with self.subTest(mode=mode):
                fixture=BuildOnlyControls('test_live_fixture_pair_route_stops_before_native_and_uses_positive_cleanup')
                fixture.setUp()
                try:
                    fixture.mode=mode
                    with self.assertRaises(ValueError) as caught:fixture.execute()
                    self.assertIs(caught.exception,fixture.original)
                    self.assertNotIn('test-without-building',str(fixture.owned_runs))
                    if mode in ('prepare','configuration','both'):
                        fixture.startup.remove_profile.assert_not_called()
                        self.assertTrue((fixture.base/'signature/retained-fixture.json').exists())
                    elif mode in ('baseline','candidate','signature'):
                        self.assertFalse(any(fixture.profiles.iterdir()))
                finally:fixture.doCleanups()

    def test_unknown_helper_provider_identity_integrity_or_gate_fails_closed(self):
        for mode in ('unknown','unreaped','drain','teardown','missing-owner','provider','root','port','home','integrity','remove',
                     'missing-gate','wrong-gate'):
            with self.subTest(mode=mode):
                fixture=BuildOnlyControls('test_live_fixture_pair_route_stops_before_native_and_uses_positive_cleanup')
                fixture.setUp()
                try:
                    fixture.mode=mode
                    with self.assertRaises((RuntimeError,FileNotFoundError)):fixture.execute()
                    proof=json.loads((fixture.base/'signature/build-only.json').read_text())
                    self.assertEqual(proof['status'],'FAIL')
                    self.assertFalse(proof['public_test_requested'])
                    if mode not in ('missing-gate','wrong-gate'):
                        self.assertTrue(any(fixture.profiles.iterdir()))
                        self.assertTrue((fixture.base/'signature/retained-fixture.json').exists())
                finally:fixture.doCleanups()

    def test_cleanup_bound_failure_never_replaces_original_work_error(self):
        from contextlib import contextmanager
        self.mode='signature'
        @contextmanager
        def using(bound):
            if bound.kind=='cleanup':raise self.cleanup_error
            with budget.using(bound):yield
        with self.assertRaises(ValueError) as caught:self.execute(using)
        self.assertIs(caught.exception,self.original)
        self.assertIs(caught.exception.__cause__,self.cleanup_error)
        self.startup.remove_profile.assert_not_called()
        self.assertTrue(any(self.profiles.iterdir()))

    def test_missing_unknown_or_mismatched_purpose_refuses_and_both_closed_purposes_admit(self):
        value=SourceControls.admission(self)
        for purpose in ('native','build-only'):
            correct={**value,'purpose':purpose,'scope':controller.PURPOSE_SCOPES[purpose]}
            self.assertEqual(controller.admit(correct,'a'*40,now=1001),(1000,3880,4480,4600))
        invalid=[{k:v for k,v in value.items() if k!='purpose'}]
        invalid += [{**value,'purpose':p} for p in (None,True,[],{},'unknown','build-only')]
        invalid += [{**value,'purpose':'native','scope':controller.PURPOSE_SCOPES['build-only']}]
        for row in invalid:
            with self.subTest(row=row),self.assertRaises((RuntimeError,TypeError,KeyError)):
                controller.admit(row,'a'*40,now=1001)

    def test_extra_baseline_is_reserved_before_configured_fixture_or_input(self):
        execute,events,_=SourceControls.episode(self,elapsed=2100)
        before=(self.clock.work.deadline,self.clock.cleanup.deadline,self.clock.retention.deadline)
        with self.assertRaises((RuntimeError,TimeoutError)):execute()
        self.assertEqual(events,['R-build','R-verify','onboarding','onboarding-cleanup'])
        self.assertEqual(before,(self.clock.work.deadline,self.clock.cleanup.deadline,self.clock.retention.deadline))

    def test_actual_main_build_only_branch_returns_before_native_helpers_and_R(self):
        tree=ast.parse((HERE/'four-startup.py').read_bytes())
        main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
        branch=next(n for n in ast.walk(main) if isinstance(n,ast.If) and isinstance(n.test,ast.Compare)
                    and ast.unparse(n.test)=="admission['purpose'] == 'build-only'")
        self.assertIsInstance(branch.body[-1],ast.Return)
        text=ast.unparse(branch)
        self.assertNotIn('selected_episode',text)
        self.assertNotIn('run_case',text)
        self.assertNotIn('console(',text)
        self.assertNotIn('test-without-building',text)
        self.assertIn('signature_build_only',text)
        native=next(n for n in ast.walk(main) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name)
                    and n.func.id=='selected_episode')
        self.assertLess(branch.end_lineno,native.lineno)

    def test_actual_main_branch_returns_without_native_fallthrough_and_keeps_counters_separate(self):
        tree=ast.parse((HERE/'four-startup.py').read_bytes())
        main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
        branch=next(n for n in ast.walk(main) if isinstance(n,ast.If) and isinstance(n.test,ast.Compare)
                    and ast.unparse(n.test)=="admission['purpose'] == 'build-only'")
        output=self.base/'route-output';output.mkdir()
        report=dict(package_before={'normal':'exact'},runtime_attempts=0,cases_requested=[],
                    protocol_executed=False,full_four_case_run=False,prefix_binary_acceptance=False,
                    final_integrated_native_acceptance=False)
        startup=Mock(spec=['package_contract']);startup.package_contract.return_value=report['package_before']
        build=Mock(return_value={'status':'PASS'})
        native=Mock(side_effect=AssertionError('native fallthrough'))
        body=[branch,ast.Expr(value=ast.Call(func=ast.Name(id='native',ctx=ast.Load()),args=[],keywords=[]))]
        wrapped=ast.parse('def route():\n    pass\n').body[0];wrapped.body=body
        namespace=dict(admission={'purpose':'build-only','controller_sha':'a'*40},output=output,Path=Path,
            signature_build_only=build,startup=startup,clock=self.clock,using=budget.using,evidence=output,
            app=output/'app',manifest=output/'manifest',roots={key:output/key for key in ('H','P','Q','R')},
            pair=PAIR,selection=self.selection,run=self.owned_port,bounded_file=self.read,report=report,
            require=controller.require,contract=object(),require_checkout=Mock(),controller=output/'controller',
            STOP=[],native=native)
        exec(compile(ast.fix_missing_locations(ast.Module(body=[wrapped],type_ignores=[])),'<actual-build-only-route>','exec'),namespace)
        namespace['route']()
        native.assert_not_called();build.assert_called_once()
        self.assertEqual(report['status'],'PASS')
        self.assertEqual((report['runtime_attempts'],report['cases_requested'],report['protocol_executed'],report['full_four_case_run']),
                         (0,[],False,False))
        self.assertFalse(report['prefix_binary_acceptance']);self.assertFalse(report['final_integrated_native_acceptance'])
        self.assertFalse((output/'profiles').exists())

    def test_actual_H_pair_and_controller_receipt_callback_gate_both_real_output_shapes(self):
        # Real maintained pair/generator/validator/inspector, inert build/sign ports.
        import sys
        previous=list(sys.path);sys.path.insert(0,str(H/'desktop/macos'))
        try:
            spec=importlib.util.spec_from_file_location('c17_exact_signature_fixtures',H/'desktop/macos/test_ci_startup_signatures.py')
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            import ci_startup
            from ci_xctest import require_generated_runner
            from ci_xctest_attachments import bounded_file
            tree=ast.parse((HERE/'four-startup.py').read_bytes())
            main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
            callback=next(n for n in main.body if isinstance(n,ast.FunctionDef) and n.name=='runtime_build_receipt')
            for mode in (None,'candidate-receipt','bundle-not-propagated','parent-grant'):
                with self.subTest(mode=mode):
                    fixture=module.PairTests('test_pair_real_wiring_builds_normal_baseline_first_and_gates_both_outputs')
                    fixture.setUp()
                    try:
                        fixture.mode=mode
                        source,source_hash=next(iter(fixture.selection['receipt']['sources'].items()))
                        fixture.selection['receipt'].update(harness_sha=PAIR['H'],startup_sha=PAIR['Q'],
                            startup_source_path=source,startup_source_sha256=source_hash)
                        fixture.config['harness_sha']=PAIR['H'];fixture.marker.write_text(json.dumps(fixture.config))
                        report={};namespace=dict(Path=Path,plistlib=__import__('plistlib'),require=controller.require,
                            selection=fixture.selection,require_generated_runner=require_generated_runner,
                            build_selection_receipt=controller.build_selection_receipt,bounded_file=bounded_file,
                            digest=controller.digest,report=report,write=controller.write)
                        exec(compile(ast.Module(body=[callback],type_ignores=[]),'<actual-runtime-build-receipt>','exec'),namespace)
                        calls=[]
                        def run(argv,log,cap,*,env):
                            self.assertEqual(argv[:2],['xcodebuild','build-for-testing']);self.assertEqual(cap,240)
                            project=Path(argv[argv.index('-project')+1])
                            selected=fixture.selection if project==fixture.project else dict(project=str(project),
                                scheme=module.m.TARGETS[2],receipt=json.loads((project.parent/'project-selection.json').read_text()))
                            runner,receipt=fixture.build(log.parent,fixture.marker,controller.digest(fixture.marker),fixture.config,selected,None)
                            target=receipt['generated_target'];target.update(IsUITestBundle=True,BlueprintName=module.m.TARGETS[2],
                                EnvironmentVariables=dict(arg.split('=',1) for arg in argv if arg.startswith('NAC_')))
                            target['EnvironmentVariables'].update(NAC_STARTUP_SOURCE_PATH=source,NAC_STARTUP_SOURCE_SHA256=source_hash)
                            runner.write_bytes(__import__('plistlib').dumps(dict(actual_inert_target=target)))
                            log.write_text('inert complete build port')
                            calls.append(argv)
                            if mode=='candidate-receipt' and project!=fixture.project:
                                path=project.parent/'project-selection.json';bad=json.loads(path.read_text())
                                bad['private_request_proposal']['nonce']='0'*64;path.write_text(json.dumps(bad))
                            namespace['runtime_build_receipt'](argv)
                        def execute():
                            return ci_startup.generated_runner(fixture.folder,fixture.marker,controller.digest(fixture.marker),
                                fixture.config,fixture.selection,run,private_request=fixture.context,command=fixture.command)
                        if mode is None:
                            _,receipt=execute()
                            self.assertTrue(receipt['private_request_signature_gate']['both_actual_signatures_verified'])
                            self.assertEqual(sum(a[1]=='--verify' for a in fixture.commands if a[0]=='/usr/bin/codesign'),4)
                            self.assertEqual(len(report['runtime_builds']),2)
                        else:
                            with self.assertRaises(RuntimeError):execute()
                        self.assertEqual(len(calls),2)
                        self.assertEqual(calls[0][calls[0].index('NAC_UI_FIXTURE='+str(fixture.marker))],
                                         calls[1][calls[1].index('NAC_UI_FIXTURE='+str(fixture.marker))])
                    finally:fixture.doCleanups()
        finally:sys.path[:]=previous

    def test_actual_project_selection_uses_normal_or_exact_live_candidate_and_rejects_mutations(self):
        import copy
        normal=self.base/'ordinary.xcodeproj'
        normal.mkdir()
        (normal/'project.pbxproj').write_bytes(b'normal')
        selection=dict(project=str(normal),receipt=dict(generated=True,generated_project_sha256=controller.digest(normal/'project.pbxproj'),sources={'source':'a'*64}))
        folder=self.base/'case';folder.mkdir()
        project=folder/'request-project'/normal.name;project.mkdir(parents=True)
        (project/'project.pbxproj').write_bytes(b'candidate')
        config=self.base/'config.json';config.write_text(json.dumps(dict(scenario='configuredLocal',ax_witness=dict(nonce='a'*64,path=str(self.base/'proof/receipt.json')))))
        hashed=controller.digest(config)
        proposal=dict(nonce='a'*64,configuration_sha256=hashed,directory=str(self.base/'proof/requests'))
        candidate=dict(selection['receipt'],generated_project_sha256=controller.digest(project/'project.pbxproj'),private_request_proposal=proposal)
        receipt=project.parent/'project-selection.json'
        receipt.write_text(json.dumps(candidate))
        argv=['xcodebuild','build-for-testing','-project',str(project),'-derivedDataPath',str(folder/'derived')]
        self.assertIs(controller.build_selection_receipt(['-project',str(normal)],selection,config,hashed,self.read),selection['receipt'])
        self.assertEqual(controller.build_selection_receipt(argv,selection,config,hashed,self.read),candidate)
        for attack in ('sources','project','nonce','configuration','directory','extra','duplicate','alias','foreign-project','fixture'):
            row=copy.deepcopy(candidate);actual=list(argv);original_project=(project/'project.pbxproj').read_bytes()
            if attack=='sources':row['sources']={}
            elif attack=='project':row['generated_project_sha256']='0'*64
            elif attack in ('nonce','configuration','directory'):
                key='configuration_sha256' if attack=='configuration' else attack
                row['private_request_proposal'][key]='changed'
            elif attack=='extra':row['extra']=True
            elif attack=='foreign-project':actual[3]=str(normal.parent/'foreign.xcodeproj')
            elif attack=='fixture':config.write_text('{}')
            receipt.write_text(json.dumps(row))
            if attack=='duplicate':receipt.write_text(receipt.read_text()[:-1]+',"generated":true}')
            if attack=='alias':
                real=receipt.with_name('real.json');receipt.rename(real);receipt.symlink_to(real)
            with self.subTest(attack=attack),self.assertRaises((RuntimeError,AssertionError,KeyError,FileNotFoundError)):
                controller.build_selection_receipt(actual,selection,config,hashed,self.read)
            if attack=='alias':receipt.unlink();real.rename(receipt)
            if attack=='fixture':config.write_text(json.dumps(dict(scenario='configuredLocal',ax_witness=dict(nonce='a'*64,path=str(self.base/'proof/receipt.json')))))
            (project/'project.pbxproj').write_bytes(original_project)


if __name__ == '__main__':
    unittest.main()
