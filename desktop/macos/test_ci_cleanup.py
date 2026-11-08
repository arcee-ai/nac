"""Inert controls: every process observation/signal API is replaced before use."""
from contextlib import ExitStack
import itertools
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import ci


class RecordedCleanupTests(unittest.TestCase):
    app, engine, later, helper = 41001, 41002, 42001, 41003

    def exercise(self, *, fault=None, disappear=False, both_gone=False,
                 first_command=None, engine_command=None, engine_fault=None, cleanup_failure=False,
                 later_failure=False, survivor=None):
        live = {self.app, self.engine, self.later}
        probes, cleaned, forbidden = [], [], []
        extras = {self.helper} if survivor == 'helper' else set()
        bundle = (Path(tempfile.gettempdir()).resolve() / 'nac-mac-relocation-inert'
                  / 'folder with spaces' / 'NAC Development Preview Smoke.app')
        def deny(*_args, **_kwargs):
            forbidden.append('unmocked process/signal call')
            raise AssertionError(forbidden[-1])
        def inspect(args):
            self.assertEqual(args[:2], ['/bin/ps', '-p'])
            self.assertEqual(args[3:], ['-o', 'command='])
            pid = int(args[2])
            probes.append(pid)
            if pid == self.app:
                if disappear:
                    live.discard(self.app)
                    if both_gone:
                        live.discard(self.engine)
                if fault is not None:
                    raise fault
                if first_command is not None:
                    return first_command
            if pid == self.engine:
                if engine_fault is not None:
                    raise engine_fault
                return engine_command or str(bundle / 'Contents/Resources/nac-web')
            return str(bundle / 'Contents/MacOS/NACPreview')
        with tempfile.TemporaryDirectory(prefix='nac-inert-cleanup-') as temporary:
            raw = Path(temporary)
            (raw / 'evidence').mkdir()
            first = raw / 'evidence/01-first.json'
            second = raw / 'evidence/02-later.json'
            data = {'scenario': 'first', 'app_pid': self.app, 'engine_pid': self.engine}
            profile = raw / 'profile'
            if survivor == 'profile':
                profile.mkdir()
                data['profile'] = str(profile)
            if extras:
                data['app_helper_pid'] = self.helper
            first.write_text(json.dumps(data))
            second.write_text(json.dumps({'scenario': 'later', 'app_pid': self.later}))
            def clean(record, actual_bundle):
                self.assertEqual(actual_bundle, bundle)
                cleaned.append(record.name)
                if (record == first and cleanup_failure) or (record == second and later_failure):
                    raise RuntimeError('inert cleaner failed')
                live.difference_update((self.app, self.engine) if record == first else (self.later,))
            with ExitStack() as stack:
                stack.enter_context(patch('ci.alive', side_effect=lambda pid: pid in live))
                stack.enter_context(patch('ci.command', side_effect=inspect))
                stack.enter_context(patch('ci.time.monotonic', side_effect=itertools.count(0, 4)))
                for name in ['ci.subprocess.Popen', 'ci.subprocess.run', 'ci.subprocess.check_output',
                             'ci.os.kill', 'ci.os.killpg', 'ci.os.getpgid', 'ci.time.sleep']:
                    stack.enter_context(patch(name, side_effect=deny))
                result, error = None, None
                try:
                    result = ci.settle_apps(raw, cleanup=clean, extra_alive=lambda pid: pid in extras)
                except Exception as caught:
                    error = caught
            self.assertEqual(forbidden, [], 'No real process API is permitted')
        return result, error, probes, cleaned, live

    def no_row(self):
        return subprocess.CalledProcessError(1, ['/bin/ps'], output='')

    def test_app_disappears_before_ps_surviving_engine_and_later_record_cleaned(self):
        result, error, probes, cleaned, live = self.exercise(fault=self.no_row(), disappear=True)
        self.assertIsNone(error)
        self.assertEqual(probes, [self.app, self.engine, self.later])
        self.assertEqual(cleaned, ['01-first.json', '02-later.json'])
        self.assertEqual([r['scenario'] for r in result], ['first', 'later'])
        self.assertFalse(live)

    def test_both_gone_after_no_row_no_guessed_cleanup_later_attempted(self):
        result, error, probes, cleaned, live = self.exercise(
            fault=self.no_row(), disappear=True, both_gone=True)
        self.assertIsNone(error)
        self.assertEqual(probes, [self.app, self.later])
        self.assertEqual(cleaned, ['02-later.json'])
        self.assertEqual([r['scenario'] for r in result], ['later'])
        self.assertFalse(live)

    def test_empty_success_only_accepts_confirmed_disappearance(self):
        result, error, probes, cleaned, live = self.exercise(disappear=True, first_command='')
        self.assertIsNone(error)
        self.assertEqual(probes, [self.app, self.engine, self.later])
        self.assertEqual(len(result), 2)
        self.assertFalse(live)

    def test_permission_timeout_diagnostic_unknown_never_imply_death(self):
        errors = [PermissionError('inert denied'), subprocess.TimeoutExpired(['/bin/ps'], 1),
                  RuntimeError('inert unknown'), ProcessLookupError('inert inspection failure'),
                  subprocess.CalledProcessError(2, ['/bin/ps'], output=''),
                  subprocess.CalledProcessError(1, ['/bin/ps'], output='inert diagnostic'),
                  subprocess.CalledProcessError(1, ['/bin/ps'], output=None)]
        for fault in errors:
            for disappear in [False, True]:
                with self.subTest(fault=repr(fault), app_disappeared=disappear):
                    result, error, probes, cleaned, live = self.exercise(fault=fault, disappear=disappear)
                    self.assertIsNone(result)
                    self.assertIsInstance(error, RuntimeError)
                    self.assertIs(error.__cause__, fault)
                    self.assertIn('01-first.json', str(error))
                    self.assertEqual(probes, [self.app, self.later])
                    self.assertEqual(cleaned, ['02-later.json'])
                    self.assertEqual(live, {self.engine} if disappear else {self.app, self.engine})

    def test_surviving_engine_inspection_unknown_never_authorizes_cleanup(self):
        for fault in [PermissionError('inert denied'), subprocess.TimeoutExpired(['/bin/ps'], 1)]:
            with self.subTest(fault=repr(fault)):
                result, error, probes, cleaned, live = self.exercise(
                    fault=self.no_row(), disappear=True, engine_fault=fault)
                self.assertIsNone(result)
                self.assertIs(error.__cause__, fault)
                self.assertEqual(probes, [self.app, self.engine, self.later])
                self.assertEqual(cleaned, ['02-later.json'])
                self.assertEqual(live, {self.engine})

    def test_no_row_while_pid_still_alive_is_unknown_not_dead(self):
        result, error, probes, cleaned, live = self.exercise(fault=self.no_row())
        self.assertIsNone(result)
        self.assertIsInstance(error.__cause__, subprocess.CalledProcessError)
        self.assertEqual(probes, [self.app, self.later])
        self.assertEqual(cleaned, ['02-later.json'])
        self.assertEqual(live, {self.app, self.engine})

    def test_empty_success_while_live_retains_uncertainty(self):
        result, error, probes, cleaned, live = self.exercise(first_command='')
        self.assertIsNone(result)
        self.assertIn('empty while still live', str(error))
        self.assertEqual(probes, [self.app, self.later])
        self.assertEqual(cleaned, ['02-later.json'])
        self.assertEqual(live, {self.app, self.engine})

    def test_reused_app_pid_wrong_bundle_denied_later_record_attempted(self):
        for command in ['/Applications/Other.app/Contents/MacOS/Other',
                        '/tmp/Other/NAC Development Preview Smoke.app/Contents/MacOS/NACPreview']:
            with self.subTest(command=command):
                result, error, probes, cleaned, live = self.exercise(first_command=command)
                self.assertIsNone(result)
                self.assertIn('refusing signal', str(error))
                self.assertEqual(probes, [self.app, self.later])
                self.assertEqual(cleaned, ['02-later.json'])
                self.assertEqual(live, {self.app, self.engine})

    def test_reused_engine_pid_after_app_disappearance_denied(self):
        result, error, probes, cleaned, live = self.exercise(
            fault=self.no_row(), disappear=True, engine_command='/Applications/Other.app/engine')
        self.assertIsNone(result)
        self.assertIn('refusing signal', str(error))
        self.assertEqual(probes, [self.app, self.engine, self.later])
        self.assertEqual(cleaned, ['02-later.json'])
        self.assertEqual(live, {self.engine})

    def test_cleaner_failure_retained_later_record_still_attempted(self):
        result, error, probes, cleaned, live = self.exercise(cleanup_failure=True)
        self.assertIsNone(result)
        self.assertIn('inert cleaner failed', str(error))
        self.assertEqual(cleaned, ['01-first.json', '02-later.json'])
        self.assertEqual(live, {self.app, self.engine})

    def test_multiple_failures_retained_by_record(self):
        result, error, probes, cleaned, live = self.exercise(cleanup_failure=True, later_failure=True)
        self.assertIsNone(result)
        self.assertIn('01-first.json', str(error))
        self.assertIn('02-later.json', str(error))
        self.assertEqual(cleaned, ['01-first.json', '02-later.json'])
        self.assertEqual(live, {self.app, self.engine, self.later})

    def test_surviving_profile_or_helper_is_failed_after_later_cleanup(self):
        for survivor in ['profile', 'helper']:
            with self.subTest(survivor=survivor):
                result, error, probes, cleaned, live = self.exercise(survivor=survivor)
                self.assertIsNone(result)
                self.assertIn('survived cleanup', str(error))
                self.assertEqual(cleaned, ['01-first.json', '02-later.json'])
                self.assertFalse(live)


if __name__ == '__main__':
    unittest.main()
