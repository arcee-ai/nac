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

    def test_panel_gate_requires_exactly_five_with_zero_skips(self):
        def skip():
            raise unittest.SkipTest('panel proof skipped')
        good = unittest.TextTestRunner(stream=io.StringIO()).run(
            unittest.TestSuite([unittest.FunctionTestCase(lambda: None) for _ in range(5)]))
        check.require_complete(good, 5)
        bad = unittest.TextTestRunner(stream=io.StringIO()).run(
            unittest.TestSuite([unittest.FunctionTestCase(lambda: None) for _ in range(4)]
                               + [unittest.FunctionTestCase(skip)]))
        with self.assertRaisesRegex(RuntimeError, 'all 5 tests with zero skips'):
            check.require_complete(bad, 5)
        with self.assertRaisesRegex(RuntimeError, 'zero skips'):
            check.require_complete(good, 4)

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
