"""Fail-closed source-input and no-skip controls for the required portable lane."""
import hashlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import ci_startup_console_check as check
import ci_startup_fixture as fixture
import test_ci_startup_console as console


class ConsoleRecordingSourceTests(unittest.TestCase):
    def source(self):
        data = Path(__file__).with_name('startup_xctest').joinpath('StartupJourneys.swift').read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), fixture.TEST_FILES['StartupJourneys.swift'])
        return data.decode()

    def trace(self, source, case):
        # Exercise the real source-trace assertions with isolated mutant bytes.
        # Only this synthetic control replaces their digest; production source
        # admission still requires the exact nominated checkout and inventory.
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'StartupJourneys.swift'
            path.write_text(source)
            hashes = {**fixture.TEST_FILES, 'StartupJourneys.swift': hashlib.sha256(path.read_bytes()).hexdigest()}
            with patch.dict(os.environ, {'NAC_STARTUP_TEST_SOURCE': str(path)}), \
                    patch.object(console, 'TEST_FILES', hashes):
                return console.StartupConsoleTests().source_trace(case)

    def test_checked_default_and_nonrecorded_input_checks_keep_exact_export_counts(self):
        source = self.source()
        self.assertEqual(len(fixture.operations({'scenario': 'configuredLocal', 'home': '/private/owned home'})), 11)
        for case, expected in (('onboarding', 5), ('configuredLocal', 27), ('invalidConfig', 4), ('futureStore', 4)):
            with self.subTest(case=case):
                self.assertEqual(len(self.trace(source, case)), expected)

    def test_missing_swallowed_disabled_or_wrong_default_recording_is_rejected(self):
        source = self.source()
        ordinary = 'try guardWindow(ui, running: running, paths: paths, launch: launch, number: number)'
        immediate = ordinary[:-1] + ', record: false)'
        record = 'if record { observations.append(state) }'
        mutations = {
            'wrong-default': ('record: Bool = true', 'record: Bool = false'),
            'missing-console': ('let state = try console()', 'let state: [String: Any] = [:]'),
            'swallowed-console': ('let state = try console()', 'let state = (try? console()) ?? [:]'),
            'disabled-recording': (record, 'if false { observations.append(state) }'),
            'missing-recording': (record, '_ = state'),
            'unconditional-recording': (record, 'observations.append(state)'),
            'duplicate-recording': (record, record + '\n        observations.append(state)'),
            'ordinary-not-recorded': (ordinary, immediate),
            'immediate-recorded': (immediate, ordinary[:-1] + ', record: true)'),
            'missing-immediate-check': (immediate, '_ = number'),
        }
        for name, (before, after) in mutations.items():
            self.assertEqual(source.count(before), 1, name)
            changed = source.replace(before, after, 1)
            for case in fixture.CASES:
                with self.subTest(mutation=name, case=case), self.assertRaises(AssertionError):
                    self.trace(changed, case)


class RequiredConsoleTests(unittest.TestCase):
    def source(self, root):
        directory = root / 'desktop/macos/startup_xctest'
        directory.mkdir(parents=True)
        payloads = {'README.md': b'Synthetic unit Q only\n', 'StartupJourneys.swift': b'// not executed\n',
                    'contract.py': b'SYNTHETIC_UNIT_ONLY = True\n', 'test_contract.py': b'# no discovery\n'}
        for name, data in payloads.items():
            (directory / name).write_bytes(data)
        hashes = {name: hashlib.sha256(data).hexdigest() for name, data in payloads.items()}
        return directory, hashes

    def test_panel_gate_requires_exactly_thirty_six_with_zero_skips(self):
        def skip():
            raise unittest.SkipTest('panel proof skipped')
        good = unittest.TextTestRunner(stream=io.StringIO()).run(
            unittest.TestSuite([unittest.FunctionTestCase(lambda: None) for _ in range(36)]))
        check.require_complete(good, 36)
        bad = unittest.TextTestRunner(stream=io.StringIO()).run(
            unittest.TestSuite([unittest.FunctionTestCase(lambda: None) for _ in range(35)]
                               + [unittest.FunctionTestCase(skip)]))
        with self.assertRaisesRegex(RuntimeError, 'all 36 tests with zero skips'):
            check.require_complete(bad, 36)
        for wrong_count in (35, 37):
            with self.assertRaisesRegex(RuntimeError, 'zero skips'):
                check.require_complete(good, wrong_count)

    def test_actual_nominated_panel_classes_require_six_seven_twenty_three_without_execution(self):
        source = Path(check.__file__).with_name('startup_xctest').joinpath('StartupJourneys.swift')
        result = unittest.TestResult()
        result.testsRun = 36
        with patch.object(check.sys, 'platform', 'darwin'), patch.object(check, 'admit_source', return_value=source), \
                patch.object(check.unittest, 'TextTestRunner') as runner:
            runner.return_value.run.return_value = result
            self.assertIs(check.run_required('/unused', panel=True), result)
            suite = runner.return_value.run.call_args.args[0]
            self.assertEqual([group.countTestCases() for group in suite], [6, 7, 23])
            names = [case.id() for group in suite for case in group]
            self.assertTrue(any('catch_preserves_error_identity' in name for name in names))
            self.assertTrue(any('float_selection' in name for name in names))

    def test_twenty_two_or_twenty_four_receipt_controls_fail_before_any_runner(self):
        source = Path(check.__file__).with_name('startup_xctest').joinpath('StartupJourneys.swift')
        loader = check.unittest.defaultTestLoader.loadTestsFromTestCase
        for count in (22, 24):
            def load(case):
                if case.__name__ == 'ReceiptControls':
                    return unittest.TestSuite([unittest.FunctionTestCase(lambda: None) for _ in range(count)])
                return loader(case)
            with self.subTest(count=count), patch.object(check.sys, 'platform', 'darwin'), \
                    patch.object(check, 'admit_source', return_value=source), \
                    patch.object(check.unittest.defaultTestLoader, 'loadTestsFromTestCase', side_effect=load), \
                    patch.object(check.unittest, 'TextTestRunner') as runner:
                with self.assertRaisesRegex(RuntimeError, 'exact twenty-three'):
                    check.run_required('/unused', panel=True)
                runner.assert_not_called()

    def test_thirteen_total_cannot_hide_wrong_six_plus_seven_class_distribution(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve(); directory, hashes = self.source(root)
            text = 'import unittest\n'
            for name, count in (('NativeFolderPolicyTests', 5), ('AXRefusalTests', 8)):
                text += 'class ' + name + '(unittest.TestCase):\n'
                text += ''.join('    def test_' + str(n) + '(self): pass\n' for n in range(count))
            (directory / 'test_contract.py').write_text(text)
            hashes['test_contract.py'] = hashlib.sha256(text.encode()).hexdigest()
            with patch.object(check.sys, 'platform', 'darwin'), patch.object(fixture, 'TEST_FILES', hashes), \
                    patch.object(fixture, 'require_checkout'), patch.object(check.unittest, 'TextTestRunner') as runner:
                with self.assertRaisesRegex(RuntimeError, 'exact six geometry and seven AX'):
                    check.run_required(root, panel=True)
                runner.assert_not_called()

    def test_panel_control_cannot_succeed_or_skip_on_linux(self):
        with patch.object(check.sys, 'platform', 'linux'), patch.object(check, 'admit_source') as source:
            with self.assertRaisesRegex(RuntimeError, 'requires Darwin'):
                check.run_required('/unused', panel=True)
            source.assert_not_called()

    def test_resolver_uses_the_current_exact_nomination(self):
        self.assertEqual(check.nominated_revision(), fixture.TEST_SOURCE)

    def test_missing_or_mutated_required_source_fails_before_test_runner(self):
        for mutation in ('root-missing', 'file-missing', 'file-mutated', 'symlink'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary).resolve()
                directory, hashes = self.source(root)
                supplied = root
                source = directory / 'StartupJourneys.swift'
                if mutation == 'root-missing':
                    supplied = root / 'absent'
                elif mutation == 'file-missing':
                    source.unlink()
                elif mutation == 'file-mutated':
                    source.write_bytes(b'changed Q bytes')
                else:
                    source.unlink()
                    source.symlink_to(directory / 'README.md')
                with patch.object(fixture, 'TEST_FILES', hashes), patch.object(fixture, 'require_checkout'), \
                        patch.object(check.unittest, 'TextTestRunner') as runner:
                    with self.assertRaises((RuntimeError, FileNotFoundError)):
                        check.run_required(supplied)
                    runner.assert_not_called()

    def test_wrong_revision_is_rejected_by_existing_checkout_admission(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            with patch.object(fixture, 'require_checkout', side_effect=RuntimeError('wrong revision')) as checkout:
                with self.assertRaisesRegex(RuntimeError, 'wrong revision'):
                    check.admit_source(root)
                checkout.assert_called_once_with(root, fixture.TEST_SOURCE)

    def test_a_green_unittest_skip_report_is_not_required_success(self):
        def skip():
            raise unittest.SkipTest('source trace was not exercised')
        suites = [unittest.TestSuite([unittest.FunctionTestCase(lambda: None) for _ in range(3)]
                                    + [unittest.FunctionTestCase(skip)]),
                  unittest.TestSuite([unittest.FunctionTestCase(lambda: None) for _ in range(3)])]
        for suite in suites:
            result = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
            self.assertTrue(result.wasSuccessful())
            with self.assertRaisesRegex(RuntimeError, 'all 4 tests with zero skips'):
                check.require_complete(result)

    def test_required_runner_refuses_a_real_skipped_control_after_source_admission(self):
        def skip():
            raise unittest.SkipTest('required source trace skipped')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            _, hashes = self.source(root)
            suite = unittest.TestSuite([unittest.FunctionTestCase(lambda: None) for _ in range(3)]
                                      + [unittest.FunctionTestCase(skip)])
            with patch.object(fixture, 'TEST_FILES', hashes), patch.object(fixture, 'require_checkout'):
                with self.assertRaisesRegex(RuntimeError, 'all 4 tests with zero skips'):
                    check.run_required(root, suite=suite, stream=io.StringIO())

    def test_required_runner_binds_source_and_restores_the_caller_environment(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            directory, hashes = self.source(root)
            expected = str(directory / 'StartupJourneys.swift')
            def observe():
                self.assertEqual(os.environ['NAC_STARTUP_TEST_SOURCE'], expected)
            for previous in (None, 'preserved-caller-value'):
                with self.subTest(previous=previous), patch.dict(os.environ, {}, clear=False):
                    if previous is None:
                        os.environ.pop('NAC_STARTUP_TEST_SOURCE', None)
                    else:
                        os.environ['NAC_STARTUP_TEST_SOURCE'] = previous
                    suite = unittest.TestSuite([unittest.FunctionTestCase(observe) for _ in range(4)])
                    with patch.object(fixture, 'TEST_FILES', hashes), patch.object(fixture, 'require_checkout') as checkout:
                        result = check.run_required(root, suite=suite, stream=io.StringIO())
                        self.assertEqual(result.testsRun, 4)
                        checkout.assert_called_once_with(root, fixture.TEST_SOURCE)
                    self.assertEqual(os.environ.get('NAC_STARTUP_TEST_SOURCE'), previous)
