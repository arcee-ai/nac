"""Inert delegation controls only; never collect the repository suite."""
from contextlib import ExitStack
import io
import json
from pathlib import Path
import sys
import types
import tempfile
import hashlib
import unittest
from unittest.mock import patch

import driver
import timing


class Controls(unittest.TestCase):
    def sample(self):
        class A(unittest.TestCase):
            @classmethod
            def setUpClass(cls):
                events.append('setup-A')
            def test_a(self):
                self.assertEqual(2, 2)
            def test_b(self):
                self.fail('inert failure')
            @unittest.skip('inert skip')
            def test_c(self):
                raise AssertionError('must skip')
        class B(unittest.TestCase):
            @classmethod
            def setUpClass(cls):
                events.append('setup-B')
                raise RuntimeError('inert setup failure')
            def test_a(self):
                raise AssertionError('must not run')
        events = []
        module = types.ModuleType('inert_timing_module')
        module.A = A
        module.Alias = A  # Preserve default imported/exposed TestCase duplication.
        module.B = B
        return module, events

    def execute(self, timed):
        module, events = self.sample()
        loader = timing.TimingLoader() if timed else unittest.TestLoader()
        suite = loader.loadTestsFromModule(module)
        stream, marks = io.StringIO(), io.StringIO()
        runner = timing.TimingRunner if timed else unittest.TextTestRunner
        with patch('sys.stderr', marks):
            result = runner(stream=stream, verbosity=2).run(suite)
        return result, events, marks.getvalue(), suite.countTestCases()

    def test_delegation_preserves_count_order_setup_failure_skip_and_status(self):
        base, base_events, _, base_count = self.execute(False)
        timed, timed_events, marks, timed_count = self.execute(True)
        self.assertEqual(base_count, timed_count)
        self.assertEqual(base_count, 7)
        self.assertEqual(base_events, timed_events)
        for field in ('testsRun', 'shouldStop'):
            self.assertEqual(getattr(base, field), getattr(timed, field))
        for field in ('failures', 'errors', 'skipped', 'expectedFailures', 'unexpectedSuccesses'):
            self.assertEqual(len(getattr(base, field)), len(getattr(timed, field)))
        self.assertEqual(base.wasSuccessful(), timed.wasSuccessful())
        self.assertFalse(timed.wasSuccessful())
        self.assertEqual(marks.count('TEST_BEGIN '), 6)
        self.assertEqual(marks.count('TEST_END '), 6)
        self.assertEqual(marks.count('CLASS_SETUP_BEGIN '), 2)
        self.assertEqual(marks.count('CLASS_SETUP_END '), 2)
        self.assertIn('DISCOVERED_COUNT=7', marks)

    def test_timing_records_flush_and_monotonic(self):
        class Sink:
            def __init__(self):
                self.flushes = 0
                self.data = ''
            def write(self, value):
                self.data += value
            def flush(self):
                self.flushes += 1
        sink = Sink()
        with patch('sys.stderr', sink), patch('timing.time.monotonic', return_value=12.5):
            timing.mark('TEST_BEGIN', 'inert.id')
        self.assertEqual(sink.data, 'TEST_BEGIN monotonic=12.500000000 id=inert.id\n')
        self.assertEqual(sink.flushes, 1)

    def test_setup_delegate_return_and_exception_remain_unchanged(self):
        test = unittest.FunctionTestCase(lambda: None)
        result = unittest.TestResult()
        sentinel = object()
        with patch('sys.stderr', io.StringIO()), patch.object(unittest.TestSuite, '_handleClassSetUp', return_value=sentinel) as delegate:
            self.assertIs(timing.TimingSuite()._handleClassSetUp(test, result), sentinel)
            delegate.assert_called_once_with(test, result)
        error = RuntimeError('inert delegate failure')
        with patch('sys.stderr', io.StringIO()), patch.object(unittest.TestSuite, '_handleClassSetUp', side_effect=error):
            with self.assertRaises(RuntimeError) as raised:
                timing.TimingSuite()._handleClassSetUp(test, result)
        self.assertIs(raised.exception, error)

    def test_original_cli_discovery_and_verbosity_preserved(self):
        with patch('timing.unittest.main') as main, patch.object(sys, 'path', list(sys.path)):
            timing.main()
        kw = main.call_args.kwargs
        self.assertIsNone(kw['module'])
        self.assertEqual(kw['argv'], ['unittest', 'discover', '-s', 'desktop/macos', '-p', 'test_*.py', '-v'])
        self.assertIsInstance(kw['testLoader'], timing.TimingLoader)
        self.assertIs(kw['testRunner'], timing.TimingRunner)

    def allocation(self):
        return dict(scope='native544-fixture60-timing02', source_sha='a'*40, source_tree='b'*40,
                    started=10, work=20, cleanup=60, hard=100, attempt=1, retry=0, actors_sha256='c'*64)

    def test_original_clock_closed_types_and_no_retry(self):
        self.assertEqual(driver.capsule(self.allocation(), 15), self.allocation())
        for change in [dict(work=15), dict(started=16), dict(cleanup=19), dict(hard=2000),
                       dict(attempt=True), dict(retry=True), dict(retry=1), dict(work=float('nan')),
                       dict(source_sha='HEAD'), dict(actors_sha256='HEAD'), dict(cleanup=25), dict(extra='field')]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                driver.capsule(dict(self.allocation(), **change), 15)

    def test_success_and_class_skip_semantics(self):
        @unittest.skip('class skip')
        class Skipped(unittest.TestCase):
            def test_no(self):
                raise AssertionError('must not run')
        class Passed(unittest.TestCase):
            def test_yes(self):
                pass
        for loader, runner in [(unittest.TestLoader(), unittest.TextTestRunner),
                               (timing.TimingLoader(), timing.TimingRunner)]:
            suite = loader.suiteClass([loader.loadTestsFromTestCase(Skipped), loader.loadTestsFromTestCase(Passed)])
            with patch('sys.stderr', io.StringIO()):
                result = runner(stream=io.StringIO(), verbosity=2).run(suite)
            self.assertTrue(result.wasSuccessful())
            self.assertEqual(result.testsRun, 2)
            self.assertEqual(len(result.skipped), 1)

    def test_retention_is_complete_redacted_bounded_and_expiry_fails_closed(self):
        with tempfile.TemporaryDirectory(prefix='nac544-logger-inert-') as temporary:
            root = Path(temporary)
            raw, output = root / 'raw', root / 'out'
            raw.mkdir(); output.mkdir()
            original = b'PREFIX SECRET-CANARY TAIL\n'
            (raw / 'fixture-controls.log').write_bytes(original)
            report = dict(status='failed', error_type='TimeoutExpired')
            driver.retain(raw, output, report, [('SECRET-CANARY', '<redacted>')], 100, now=lambda: 50)
            data = (output / 'fixture-controls.log').read_bytes()
            self.assertEqual(data, b'PREFIX <redacted> TAIL\n')
            self.assertEqual(report['files'][0]['raw_sha256'], hashlib.sha256(original).hexdigest())
            self.assertEqual(report['files'][0]['sha256'], hashlib.sha256(data).hexdigest())
            self.assertEqual(json.loads((output / 'report.json').read_text())['error_type'], 'TimeoutExpired')
            with self.assertRaisesRegex(RuntimeError, 'Hard cutoff'):
                driver.retain(raw, output, report, [], 100, now=lambda: 100)
            (raw / 'fixture-controls.log').write_bytes(b'x' * (driver.TRACE_LIMIT + 1))
            with self.assertRaisesRegex(RuntimeError, 'Invalid timing evidence'):
                driver.retain(raw, output, report, [], 100, now=lambda: 50)

    def test_driver_keeps_fixture60_and_original_run_owner(self):
        import ast
        source = Path(driver.__file__).read_text()
        tree = ast.parse(source)
        calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call)
                 and isinstance(n.func, ast.Attribute) and ast.unparse(n.func) == 'ci.run']
        fixture = next(n for n in calls if 'fixture-controls.log' in ast.unparse(n))
        self.assertEqual(ast.literal_eval(fixture.args[0]),
            ['python3', '-B', '.github/scripts/native544-fixture60/timing.py'])
        self.assertEqual(ast.literal_eval(fixture.args[2]), 60)
        self.assertIn('retain_ownership=True', ast.unparse(fixture))
        self.assertIn('complete_output_limit=TRACE_LIMIT', ast.unparse(fixture))
        self.assertNotIn('ci.main(', source)
        self.assertNotIn('qualify_startup(', source)
        self.assertIn('if primary is None:', source)

    def test_driver_inert_flow_preserves_original_error_even_if_retention_fails(self):
        allowed = ['.github/workflows/stable-release.yml'] + [
            '.github/scripts/native544-fixture60/' + n
            for n in ('timing.py', 'driver.py', 'controls.py', 'README.md', 'ROSTER.json')]
        for fail, retention_fail in ((False, False), (True, False), (True, True), (False, True)):
            with self.subTest(fail=fail, retention_fail=retention_fail), tempfile.TemporaryDirectory(prefix='nac544-flow-inert-') as temporary:
                c = self.allocation()
                roster = Path(driver.__file__).with_name('ROSTER.json')
                c['actors_sha256'] = hashlib.sha256(roster.read_bytes()).hexdigest()
                env = dict(NAC544_ROOT_CUSTODY=json.dumps(c), GITHUB_EVENT_NAME='workflow_dispatch',
                    GITHUB_REF=driver.BRANCH, GITHUB_RUN_ATTEMPT='1', GITHUB_SHA=c['source_sha'],
                    ImageVersion='20261102.0473.1', DEVELOPER_DIR='/Applications/Xcode_26.6.app/Contents/Developer',
                    RUNNER_TEMP=temporary)
                def git(argv, **kwargs):
                    args = tuple(argv[1:])
                    values = {('rev-parse', 'HEAD'): c['source_sha'],
                        ('rev-parse', 'HEAD^{tree}'): c['source_tree'],
                        ('rev-parse', 'HEAD^'): driver.BASE,
                        ('rev-parse', driver.BASE + '^{tree}'): driver.BASE_TREE,
                        ('status', '--porcelain'): '',
                        ('diff', '--name-only', driver.BASE, 'HEAD'): '\n'.join(allowed)}
                    return values[args]
                calls = []
                primary = ValueError('inert original suite failure')
                fake = types.ModuleType('ci')
                def run(argv, log, seconds, **kwargs):
                    calls.append((argv, seconds, kwargs))
                    text = {'xcode.log': 'Xcode 26.6\nBuild version 17F113', 'sdk.log': '26.5'}.get(log.name, 'PREFIX SECRET-CANARY TAIL')
                    log.write_text(text)
                    if log.name == 'fixture-controls.log' and fail:
                        raise primary
                fake.run = run
                fake.redact_values = lambda: [('SECRET-CANARY', '<redacted>')]
                with ExitStack() as stack:
                    stack.enter_context(patch.dict('os.environ', env, clear=True))
                    stack.enter_context(patch.dict('sys.modules', {'ci': fake}))
                    stack.enter_context(patch.object(sys, 'argv', ['driver.py']))
                    stack.enter_context(patch.object(sys, 'path', list(sys.path)))
                    stack.enter_context(patch('driver.subprocess.check_output', side_effect=git))
                    stack.enter_context(patch('driver.platform.system', return_value='Darwin'))
                    stack.enter_context(patch('driver.platform.machine', return_value='arm64'))
                    stack.enter_context(patch('driver.time.time', return_value=15))
                    stack.enter_context(patch('driver.signal.signal'))
                    class BrokenSink:
                        def write(self, value):
                            raise OSError('inert broken stderr')
                        def flush(self):
                            raise OSError('inert broken stderr')
                    stack.enter_context(patch('sys.stderr', BrokenSink() if retention_fail else io.StringIO()))
                    # retain's default clock is bound at definition, so supply an explicit inert one.
                    real_retain = driver.retain
                    if retention_fail:
                        stack.enter_context(patch('driver.retain', side_effect=OSError('inert retention failure')))
                    else:
                        stack.enter_context(patch('driver.retain', side_effect=lambda *args: real_retain(*args, now=lambda: 15)))
                    if fail:
                        with self.assertRaises(ValueError) as raised:
                            driver.main()
                        self.assertIs(raised.exception, primary)
                    elif retention_fail:
                        with self.assertRaisesRegex(OSError, 'inert retention failure'):
                            driver.main()
                    else:
                        driver.main()
                self.assertEqual([n[1] for n in calls], [15, 15, 600, 60])
                self.assertEqual(calls[-1][2], dict(retain_ownership=True, complete_output_limit=2*1024*1024))
                if not retention_fail:
                    report = json.loads((Path(temporary) / 'native544-fixture60-upload/report.json').read_text())
                    self.assertFalse(report['acceptance'])
                    self.assertEqual(report['status'], 'failed' if fail else 'fixture-suite-passed')
                    self.assertNotIn('SECRET-CANARY', (Path(temporary) / 'native544-fixture60-upload/fixture-controls.log').read_text())

    def test_real_ci_run_has_no_acquisition_at_work_cutoff_or_after_latch(self):
        # Import definitions only; all actor ports remain denied by the outer guard.
        import ci
        from ci_paths_budget import BudgetExpired, using
        ticks = dict(mono=100., wall=15.)
        with tempfile.TemporaryDirectory(prefix='nac544-cutoff-inert-') as temporary, \
             patch('driver.time.monotonic', side_effect=lambda: ticks['mono']), \
             patch('driver.time.time', side_effect=lambda: ticks['wall']), \
             patch('ci.subprocess.Popen') as acquire:
            clock = driver.make_clock(self.allocation())
            with self.assertRaises(BudgetExpired):
                with using(clock.work):
                    ticks.update(mono=105., wall=20.)
                    ci.run(['inert-never-launched'], Path(temporary) / 'cutoff.log', 60,
                           retain_ownership=True, complete_output_limit=1024)
            acquire.assert_not_called()
            receipt = json.loads((Path(temporary) / 'cutoff.log.ownership.json').read_text())
            self.assertFalse(receipt['accepted'])
            ticks.update(mono=100., wall=15.)
            with self.assertRaises(BudgetExpired):
                with using(clock.work):
                    ci.run(['inert-never-launched'], Path(temporary) / 'latched.log', 60)
            acquire.assert_not_called()

    def test_git_cannot_acquire_after_interstitial_work_expiry(self):
        from ci_paths_budget import BudgetExpired
        ticks = dict(mono=100., wall=15.)
        c = self.allocation()
        with patch('driver.time.monotonic', side_effect=lambda: ticks['mono']), \
             patch('driver.time.time', side_effect=lambda: ticks['wall']):
            clock = driver.make_clock(c)
            ticks.update(mono=105., wall=20.)
            env = dict(NAC544_ROOT_CUSTODY=json.dumps(c), GITHUB_EVENT_NAME='workflow_dispatch',
                       GITHUB_REF=driver.BRANCH, GITHUB_RUN_ATTEMPT='1', GITHUB_SHA=c['source_sha'])
            with patch.dict('os.environ', env, clear=True), patch('driver.capsule', return_value=c), \
                 patch('driver.make_clock', return_value=clock), patch('driver.subprocess.check_output') as acquire:
                with self.assertRaises(BudgetExpired):
                    driver.main()
                acquire.assert_not_called()

    def test_upload_admission_uses_original_hard_and_conservative_minutes(self):
        c = self.allocation()
        self.assertEqual(driver.upload_minutes(c, 25), 1)
        self.assertEqual(driver.upload_minutes(c, 26), 0)
        self.assertEqual(driver.upload_minutes(c, 99), 0)
        with self.assertRaises(ValueError):
            driver.upload_minutes(c, 100)
        with tempfile.TemporaryDirectory(prefix='nac544-upload-inert-') as temporary:
            output = Path(temporary) / 'output'
            env = dict(NAC544_ROOT_CUSTODY=json.dumps(c), GITHUB_EVENT_NAME='workflow_dispatch',
                       GITHUB_REF=driver.BRANCH, GITHUB_RUN_ATTEMPT='1', GITHUB_SHA=c['source_sha'],
                       GITHUB_OUTPUT=str(output))
            for now, expected in ((25, '1'), (26, '0'), (100, '0')):
                with patch.dict('os.environ', env, clear=True), patch('driver.time.time', return_value=now):
                    driver.upload_gate()
                self.assertEqual(output.read_text().splitlines()[-1], 'minutes=' + expected)
            with patch.dict('os.environ', dict(env, GITHUB_SHA='d'*40), clear=True), patch('driver.time.time', return_value=25):
                driver.upload_gate()
            self.assertEqual(output.read_text().splitlines()[-1], 'minutes=0')


if __name__ == '__main__':
    # Deny acquisition even if logger/control code regresses.
    with ExitStack() as guards:
        for port in ('subprocess.Popen', 'threading.Thread.start', 'socket.socket', 'ctypes.CDLL',
                     'os.kill', 'os.killpg', 'sqlite3.connect', 'urllib.request.urlopen'):
            guards.enter_context(patch(port, side_effect=AssertionError('forbidden actor port: ' + port)))
        unittest.main(verbosity=2)
