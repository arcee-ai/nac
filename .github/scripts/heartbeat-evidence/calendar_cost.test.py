"""Pure Calendar controls. An audit hook prohibits all real subprocess/socket use."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import contract as c
import calendar_cost as cost
spec = importlib.util.spec_from_file_location('calendar_runner', Path(__file__).with_name('run.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def audit(event, _):
    if event.startswith(('subprocess.', 'ctypes.', 'socket.')) or event in ('os.kill', 'os.killpg', 'os.fork'):
        raise AssertionError('REAL_RUNTIME_FORBIDDEN')


sys.addaudithook(audit)


def listing():
    return '\n'.join(x+': test' for x in (*cost.TESTS, 'other'))+'\n\n3 tests, 0 benchmarks\n'


def values(index):
    return [{**{k: 1 for k in cost.VALUES}, **{k: None for k in cost.RSS},
             'calculation_ms': 0 if index == 0 else 1, 'schedules': n,
             'runnable_chats': active, 'owners': 2, 'admitted': active, 'pending': n-active,
             'catchup_points_per_schedule': 1 if index == 0 else 8,
             'retained_occurrence_rows': n, 'cadence': 'interval' if index == 0 else 'calendar_daily_utc'}
            for n, active in ((1, 1), (10, 4), (100, 4))]


def output(index, rows=None):
    prefix = 'HEARTBEAT_MEASUREMENT' if index == 0 else 'HEARTBEAT_CALENDAR_MEASUREMENT'
    return ('running 1 test\ntest '+cost.TESTS[index]+' ... '+
            '\n'.join(prefix+' '+json.dumps(x) for x in (values(index) if rows is None else rows))+
            '\nok\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 1s\n')


def compiler(executable='/synthetic/test'):
    return [{'reason': 'compiler-artifact', 'target': {'name': 'nac_server', 'kind': ['lib']}, 'features': [],
             'profile': {'test': True, 'opt_level': '0', 'debuginfo': 2,
                         'debug_assertions': True, 'overflow_checks': True}, 'executable': executable},
            *[{'reason': 'compiler-artifact', 'target': {'name': name},
               'features': ['default', 'openapi', 'test-support'], 'profile': {'test': False}}
              for name in ('nac_core', 'nac_managed')]]


class Contracts(unittest.TestCase):
    def test_fixed_dispatch_and_product(self):
        args = ['a'*40, 'workflow_dispatch', cost.BRANCH, cost.MODE, cost.HEAD, cost.TREE, '']
        c.validate_request(*args, expected_mode=cost.MODE)
        c.validate_event({'inputs': {'heartbeat_evidence': cost.MODE, 'heartbeat_control_sha': args[0]}},
                         cost.MODE, args[0], expected_mode=cost.MODE)
        for index, bad in ((1, 'push'), (2, c.BRANCH), (3, c.MODE), (4, c.HEAD), (5, c.TREE), (6, c.BASELINE)):
            changed = args.copy()
            changed[index] = bad
            with self.assertRaises(RuntimeError):
                c.validate_request(*changed, expected_mode=cost.MODE)
        with self.assertRaises(RuntimeError):
            c.validate_event({'inputs': {'heartbeat_evidence': cost.MODE, 'heartbeat_control_sha': args[0],
                                        'selector': 'arbitrary'}}, cost.MODE, args[0], expected_mode=cost.MODE)

    def test_both_exact_registrations(self):
        self.assertEqual(cost.inventory(listing())['total'], 3)
        for bad in (listing().replace(cost.TESTS[1], 'wrong'), listing().replace('other', cost.TESTS[0])):
            with self.assertRaises(RuntimeError):
                cost.inventory(bad)

    def test_both_current_schemas_and_nullable_rss(self):
        for i in (0, 1):
            self.assertEqual(cost.rows(output(i), cost.inventory(listing()), i), values(i))

    def test_wrong_selector_prefix_summary_or_count(self):
        for bad in (output(1).replace(cost.TESTS[1], cost.TESTS[0]),
                    output(1).replace('HEARTBEAT_CALENDAR_MEASUREMENT', 'HEARTBEAT_MEASUREMENT'),
                    output(1).replace('1 passed', '0 passed'), output(1).replace('2 filtered', '3 filtered'),
                    output(1, values(1)[:2]), output(1, values(1)+[values(1)[0]])):
            with self.assertRaises(RuntimeError):
                cost.rows(bad, cost.inventory(listing()), 1)

    def test_invalid_cardinality_schema_order_and_values(self):
        for key, value in (('owners', 1), ('pending', True), ('retained_occurrence_rows', 0),
                           ('catchup_points_per_schedule', 1), ('calculation_ms', float('nan')),
                           ('cadence', 'interval'), ('database_bytes', 0), ('resident_active_kib', True),
                           ('extra', 1), ('warm_p50_ms', 100)):
            rows = values(1)
            rows[0][key] = value
            with self.assertRaises(RuntimeError):
                cost.rows(output(1, rows), cost.inventory(listing()), 1)

    def test_default_profile_and_dependency_closure(self):
        records = compiler()
        encode = lambda xs: '\n'.join(json.dumps(x) for x in xs)
        self.assertEqual(cost.compiler_artifact(encode(records))['features'], [])
        for mutate in (lambda xs: xs[0]['features'].append('review-fixture'),
                       lambda xs: xs[0]['profile'].update(debuginfo=0),
                       lambda xs: xs[0]['profile'].update(opt_level='2'),
                       lambda xs: xs[0]['target'].update(kind=['bin']),
                       lambda xs: xs[1]['features'].append('managed-fault-fixture'),
                       lambda xs: xs.append(copy.deepcopy(xs[0]))):
            changed = copy.deepcopy(records)
            mutate(changed)
            with self.assertRaises(RuntimeError):
                cost.compiler_artifact(encode(changed))

    def test_new_mode_environment_has_no_profile_or_vendor_overrides(self):
        with patch.dict(os.environ, {'PATH': '/synthetic', 'CARGO_PROFILE_TEST_DEBUG': '0',
                                    'RUSTFLAGS': 'override', 'OPENAI_API_KEY': 'synthetic'}, clear=True):
            env = cost.clean_environment(Path('/home'), Path('/tmp'))
        self.assertFalse(set(env) & {'CARGO_PROFILE_TEST_DEBUG', 'RUSTFLAGS', 'OPENAI_API_KEY'})

    def test_exact_product_identity_is_checked_against_git(self):
        def git(_, *args):
            return {('rev-parse', 'HEAD'): cost.HEAD, ('rev-parse', 'HEAD^{tree}'): cost.TREE,
                    ('status', '--porcelain'): ''}[args]
        cost.verify_product(Path('/synthetic'), git)
        with self.assertRaisesRegex(RuntimeError, 'CALENDAR_PRODUCT_HEAD'):
            cost.verify_product(Path('/synthetic'), lambda *_: 'wrong')


class FakeMonitor:
    def __init__(self):
        self.error = None
        self.started = False
        self.closed = 0

    def ensure(self):
        if self.error:
            raise self.error

    def start(self, deadline):
        self.started = True

    def close(self):
        self.closed += 1
        self.ensure()


class Workload(unittest.TestCase):
    def test_cost_mode_uses_existing_namespace_bootstrap_and_closes_lifeline(self):
        with tempfile.TemporaryDirectory() as d:
            context = Path(d)/'context.json'
            context.write_text(json.dumps({'mode': cost.MODE}))
            lifeline = Mock()
            with patch.object(runner, 'bootstrap_namespace', return_value=({'pid1': True}, lifeline)), \
                 patch.object(cost, 'workload', return_value=0) as workload:
                self.assertEqual(runner.inside(context, Path(d)), 0)
            workload.assert_called_once()
            lifeline.close.assert_called_once()

    def test_cost_terminal_binds_t3_after_retirement_and_has_no_pixel_claim(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            c.write_json(root/'evidence.json', {'state': 'PASS_CALENDAR_COST_SIX_ROWS', 'namespace': {'pid1': True}})
            with patch.object(runner, 'NamespaceCustody'), \
                 patch.object(runner, 'execute_namespace', return_value=(None, {'state': 'RETIRED'})), \
                 patch.object(cost, 'verify_product') as verify, patch.object(runner, 'verify_product') as old:
                runner.finalize_namespace([], {}, root, root, {'mode': cost.MODE, 'control': 'a'*40})
            terminal = json.loads((root/'terminal.json').read_text())
            self.assertEqual((terminal['head'], terminal['tree']), (cost.HEAD, cost.TREE))
            self.assertFalse(terminal['review_original_pngs'])
            self.assertEqual(json.loads((root/'artifact-manifest.json').read_text())['pixel_inspection'],
                             'NOT_APPLICABLE_COST_ONLY_MODE')
            old.assert_not_called()
            verify.assert_called_once()

    def exercise(self, root, failure=None):
        root = root.resolve()  # macOS /var temp alias is not a canonical Cargo output.
        product, out = root/'product', root/'out'
        product.mkdir()
        (product/'Cargo.lock').write_text('synthetic')
        for name in ('Cargo.toml', 'crates/nac-server/Cargo.toml', 'crates/nac-core/Cargo.toml',
                     'crates/nac-managed/Cargo.toml', 'crates/nac-server/src/application/heartbeat_scheduler/tests.rs'):
            file = product/name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('synthetic source, never compiled')
        out.mkdir()
        calls, envs = [], []
        monitor = FakeMonitor()
        clock = [0.0]

        def phase(argv, cwd, env, output_dir, label, bound):
            calls.append((label, argv, bound))
            envs.append(env)
            if label == 'build-measurement':
                exe = root/'out-build/test'
                exe.write_bytes(b'synthetic; NEVER EXECUTED')
                records = compiler(str(exe))
                if failure == 'profile':
                    records[0]['profile']['debuginfo'] = 0
                text = '\n'.join(json.dumps(x) for x in records)
            elif label == 'measurement-inventory':
                text = listing()
            elif label.startswith('measurement-'):
                i = 0 if label == 'measurement-interval' else 1
                if failure == 'child':
                    raise RuntimeError('CHILD_FAILED')
                text = 'malformed' if failure == 'parser' else globals()['output'](i)
                if failure == 'noise' and i == 0:
                    monitor.error = RuntimeError('CALENDAR_COMPETING_HEAVY_PROCESS')
                if failure == 'late' and i == 0:
                    clock[0] = 1000
                if failure == 'fixture':
                    (out/'perf-tmp/leftover').write_text('preserve')
            else:
                text = 'synthetic provenance'
            (out/(label+'.stdout')).write_text(text)

        context = {'control': 'a'*40, 'product': str(product), 'tool_environment': {'PATH': '/synthetic'}}
        with patch.dict(os.environ, {}, clear=True), patch.object(cost, 'run_owned', phase), \
             patch.object(cost, 'verify_product'), \
             patch.object(cost, 'free_bytes', return_value=0 if failure == 'disk' else 20*cost.GIB), \
             patch.object(cost, 'reap_namespace', return_value={'remaining': []}), \
             patch.object(cost, 'QuietMonitor', return_value=monitor), \
             patch.object(cost.os, 'uname', return_value=Mock(sysname='SyntheticLinux', release='synthetic', machine='synthetic')), \
             patch.object(cost.time, 'monotonic', side_effect=lambda: clock[0]), \
             patch.object(runner, 'resource_sample', return_value={}):
            resources = lambda: {'memory': {'MemAvailable': str(0 if failure == 'memory' else 8*1024**2)+' kB'},
                                 'loadavg': 'synthetic'}
            code = cost.workload(context, out, {'pid1': True}, runner.retain_executable,
                                 runner.final_checks, Mock(), resources)
        return code, json.loads((out/'evidence.json').read_text()), calls, envs, monitor

    def test_one_build_same_binary_order_and_full_finalizers(self):
        with tempfile.TemporaryDirectory() as d:
            code, result, calls, envs, monitor = self.exercise(Path(d))
        self.assertEqual(code, 0)
        selected = [x for x in calls if x[0] in ('measurement-interval', 'measurement-calendar')]
        self.assertEqual([x[1][1] for x in selected], list(cost.TESTS))
        self.assertEqual(selected[0][1][0], selected[1][1][0])
        self.assertEqual([x[2] for x in selected], [180, 180])
        self.assertEqual(sum(x[0] == 'build-measurement' for x in calls), 1)
        self.assertEqual(len(result['measurements']), 2)
        self.assertTrue(monitor.started)
        self.assertTrue(all(not any(k.startswith('CARGO_PROFILE_') for k in env) for env in envs))

    def test_profile_failure_never_runs_inventory_or_cases(self):
        with tempfile.TemporaryDirectory() as d:
            code, result, calls, *_ = self.exercise(Path(d), 'profile')
        self.assertEqual(code, 90)
        self.assertEqual(result['first_error'], 'CALENDAR_DEFAULT_PROFILE')
        self.assertFalse(any(x[0].startswith('measurement-') for x in calls))

    def test_first_child_parser_or_noise_failure_stops_second_case(self):
        for failure in ('child', 'parser', 'noise', 'late'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as d:
                code, result, calls, *_ = self.exercise(Path(d), failure)
                self.assertEqual(code, 90)
                self.assertEqual(sum(x[0] == 'measurement-interval' for x in calls), 1)
                self.assertFalse(any(x[0] == 'measurement-calendar' for x in calls))
                for name in ('post-measurement-resources', 'performance-fixture-cleanup', 'final-product-verification'):
                    self.assertTrue((Path(d)/'out'/(name+'.json')).exists())

    def test_fixture_cleanup_failure_cannot_pass(self):
        with tempfile.TemporaryDirectory() as d:
            code, result, *_ = self.exercise(Path(d), 'fixture')
        self.assertEqual(code, 90)
        self.assertEqual(result['first_error'], 'PERFORMANCE_FIXTURE_RETAINED')

    def test_guest_disk_or_memory_admission_prevents_any_cargo_phase(self):
        for failure in ('disk', 'memory'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as d:
                code, result, calls, *_ = self.exercise(Path(d), failure)
                self.assertEqual(code, 90)
                self.assertEqual(calls, [])
                self.assertFalse(result['measurement_attempted'])


class Workflow(unittest.TestCase):
    def test_registered_default_lane_and_legacy_routing_are_preserved(self):
        root = Path(__file__).resolve().parents[3]
        stable = (root/'.github/workflows/stable-release.yml').read_text()
        # Exact comparison covers every ordinary job/gate, not merely a substring count.
        restored = stable.replace('custody-check, calendar-cost]', 'custody-check]')
        self.assertEqual(hashlib.sha256(restored.encode()).hexdigest(),
                         '59f287c4415c06c9fe575d9e038fb33e707c5418b4c6a449be41e141029aae61')
        self.assertIn('default: none', stable)
        self.assertIn("options: [none, matched-and-measure, custody-check, calendar-cost]", stable)

    def test_calendar_build_and_execution_are_fixed_and_legacy_capture_stays_gated(self):
        root = Path(__file__).resolve().parents[3]
        text = (root/'.github/workflows/heartbeat-evidence.yml').read_text()
        self.assertIn('timeout-minutes: ${{ inputs.mode == \'custody-check\' && 5 || 45 }}', text)
        self.assertIn('--mode calendar-cost --head '+cost.HEAD, text)
        self.assertIn('--tree '+cost.TREE+" --baseline ''", text)
        self.assertIn('include-hidden-files: true', text)
        self.assertIn('persist-credentials: false', text)
        for name in ('Install Chromium system dependencies', 'Compile, capture and measure once'):
            step = text.split('- name: '+name, 1)[1].split('- name:', 1)[0]
            self.assertIn("if: ${{ inputs.mode == 'matched-and-measure' }}", step)


class Quiet(unittest.TestCase):
    def test_full_postwriter_sixty_seconds_without_real_sleep_or_thread(self):
        clock = [0.0]
        def sleep(seconds):
            clock[0] += seconds
        thread = Mock()
        thread.is_alive.return_value = False
        with tempfile.TemporaryDirectory() as d, patch.object(cost.time, 'monotonic', side_effect=lambda: clock[0]), \
             patch.object(cost.time, 'sleep', sleep), patch.object(cost, 'process_sample', return_value=[]), \
             patch.object(cost, 'free_bytes', return_value=10*cost.GIB), \
             patch.object(cost.threading, 'Thread', return_value=thread):
            monitor = cost.QuietMonitor(Path(d))
            monitor.start(1200)
            self.assertGreaterEqual(clock[0], 60)
            monitor.close()
            self.assertGreaterEqual(json.loads((Path(d)/'quiet-window.json').read_text())['completed'], 60)

    def test_insufficient_case_reservation_never_observes(self):
        with tempfile.TemporaryDirectory() as d, patch.object(cost.time, 'monotonic', return_value=0), \
             patch.object(cost, 'process_sample') as observe:
            with self.assertRaisesRegex(RuntimeError, 'CALENDAR_CASE_RESERVATION'):
                cost.QuietMonitor(Path(d)).start(600)
            observe.assert_not_called()

    def test_new_heavy_or_unknown_sample_is_not_quiet(self):
        for sample in ([{'pid': 4, 'name': 'rustc'}], [{'pid': 5, 'name': 'node'}],
                       [{'pid': 6, 'vanished_before_read': True}]):
            with self.subTest(sample=sample), self.assertRaises(RuntimeError):
                cost.check_sample(sample)

    def test_floor_failure_and_observer_exception_fail_closed(self):
        with tempfile.TemporaryDirectory() as d, patch.object(cost, 'process_sample', return_value=[]), \
             patch.object(cost, 'free_bytes', return_value=0):
            with self.assertRaisesRegex(RuntimeError, 'CALENDAR_GUEST_FLOOR'):
                cost.QuietMonitor(Path(d)).observe()
        monitor = cost.QuietMonitor(Path('/synthetic'))
        monitor.error = RuntimeError('UNKNOWN_OBSERVER')
        with self.assertRaisesRegex(RuntimeError, 'UNKNOWN_OBSERVER'):
            monitor.ensure()


if __name__ == '__main__':
    unittest.main()
