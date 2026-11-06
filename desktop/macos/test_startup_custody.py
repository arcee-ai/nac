"""Inert controls at the real startup runner's root/provider lifetime boundary."""
from contextlib import ExitStack
import io
import json
from pathlib import Path
import subprocess
import tempfile
import traceback
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import startup_smoke


class StartupCustody(unittest.TestCase):
    observations = []

    def exercise(self, receipt='complete', cleanup_error=None, success=False,
                 wrapper_error=False, provider_timeout=False, provider_error=False,
                 relocation_error=False, catalog_error=None, stdin_error=False,
                 stderr_failure=None, stale_receipt=False, duplicate_scenario=False):
        with tempfile.TemporaryDirectory(prefix='nac-custody-control-') as sandbox:
            sandbox = Path(sandbox)
            app = sandbox / 'Source.app'
            for relative in ('Contents/Resources/nac-web', 'Contents/MacOS/NACPreview'):
                target = app / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b'inert; never executable')
            (app / 'Contents/Resources/engine-identity.json').write_text('{"track":"dev"}')
            sentinel = sandbox / 'unrelated'
            sentinel.write_bytes(b'preserve')
            output = sandbox / 'evidence'
            prior = {}
            if stale_receipt:
                (output / 'startup-fresh').mkdir(parents=True)
                prior = {
                    output / 'startup-fresh/result.json': json.dumps({
                        'app_pid': 1234, 'engine_pid': 0, 'passed': True, 'stopped': True}).encode(),
                    output / 'metadata.json': b'prior source metadata',
                    output / 'provider.log': b'prior provider evidence',
                }
                for path, data in prior.items():
                    path.write_bytes(data)
            roots = []
            phases = ['fixture prepared']

            def temporary_directory(**options):
                directory = tempfile.TemporaryDirectory(dir=sandbox, **options)
                roots.append(Path(directory.name))
                phases.append('temporary root created')
                return directory

            def mkdtemp(**options):
                directory = tempfile.mkdtemp(dir=sandbox, **options)
                roots.append(Path(directory))
                phases.append('owned root created')
                return directory

            primary = RuntimeError('original launch failure')
            provider = Mock(returncode=None)
            provider.stdin = io.StringIO()
            provider.stdout = io.StringIO('{"base_url":"http://inert.invalid"}\n'
                                         '{"passed":true,"requests":[]}\n')
            provider.poll.side_effect = lambda: provider.returncode
            if stdin_error:
                provider.stdin = Mock(wraps=provider.stdin)
                provider.stdin.close.side_effect = OSError('stdin close failed')

            def provider_wait(timeout):
                if provider_timeout and not provider.terminate.called:
                    raise subprocess.TimeoutExpired('inert provider', timeout)
                if provider_error:
                    raise RuntimeError('provider teardown failed')
                provider.returncode = 0
                return 0

            provider.wait.side_effect = provider_wait
            opened = Mock(returncode=None)
            opened.poll.side_effect = lambda: opened.returncode

            def opened_wait(timeout):
                if timeout == 180:
                    if success:
                        opened.returncode = 0
                    else:
                        raise primary
                return 0

            opened.wait.side_effect = opened_wait
            if wrapper_error:
                opened.terminate.side_effect = RuntimeError('wrapper stop failed')
            else:
                opened.terminate.side_effect = lambda: setattr(opened, 'returncode', 0)

            def popen(command, **options):
                phases.append('mock launch: ' + command[0])
                if command[0] == 'node':
                    return provider
                self.assertEqual(command[0], '/usr/bin/open')
                evidence = Path(command[command.index('--smoke-output') + 1])
                records = {
                    'complete': {'app_pid': 1234, 'engine_pid': 0, 'passed': True, 'stopped': True},
                    'incomplete': {'app_pid': 1234},
                    'empty': {}, 'array': [],
                    'bool-app': {'app_pid': True, 'engine_pid': 0},
                    'bool-engine': {'app_pid': 1234, 'engine_pid': False},
                    'negative-engine': {'app_pid': 1234, 'engine_pid': -1},
                }
                if receipt == 'malformed':
                    evidence.write_text('{')
                elif receipt != 'missing':
                    evidence.write_text(json.dumps(records[receipt]))
                return opened

            catalog = Mock(server_port=12345)
            if catalog_error:
                getattr(catalog, catalog_error).side_effect = OSError(f'{catalog_error} failed')
            real_rmtree = startup_smoke.shutil.rmtree
            relocation_removals = []

            def rmtree(root, *args, **options):
                if Path(root).name.startswith('nac-finder-relocation-'):
                    relocation_removals.append(str(root))
                    if relocation_error:
                        raise OSError('relocation removal failed')
                return real_rmtree(root, *args, **options)

            real_cleanup = startup_smoke.cleanup_failed_case
            cleanup = Mock(side_effect=cleanup_error) if cleanup_error else Mock(wraps=real_cleanup)

            class DiagnosticStream(io.StringIO):
                def __init__(self):
                    super().__init__()
                    self.attempts = []
                    self.failed_writes = 0

                def write(self, text):
                    self.attempts.append(text)
                    if stderr_failure and (stderr_failure == 'all' or text.startswith(stderr_failure)):
                        self.failed_writes += 1
                        raise OSError('injected stderr write failure')
                    return super().write(text)

            provider_logs = []
            real_open = Path.open

            def track_open(path, *args, **options):
                handle = real_open(path, *args, **options)
                if path.resolve() == (output / 'provider.log').resolve():
                    provider_logs.append(handle)
                return handle

            captured = DiagnosticStream()
            with ExitStack() as stack:
                stack.enter_context(patch.object(startup_smoke, 'tempfile', SimpleNamespace(
                    TemporaryDirectory=temporary_directory, mkdtemp=mkdtemp)))
                stack.enter_context(patch.object(startup_smoke, 'console_locked', return_value=False))
                stack.enter_context(patch.object(startup_smoke, 'ThreadingHTTPServer', return_value=catalog))
                stack.enter_context(patch.object(startup_smoke.threading, 'Thread'))
                stack.enter_context(patch.object(startup_smoke, 'cleanup_failed_case', cleanup))
                stack.enter_context(patch.object(startup_smoke.shutil, 'rmtree', side_effect=rmtree))
                stack.enter_context(patch.object(startup_smoke.sys, 'argv', ['startup_smoke.py', str(app), str(output)]))
                stack.enter_context(patch.dict(startup_smoke.os.environ, {'NAC_STARTUP_SCENARIOS': 'startup-fresh,startup-fresh' if duplicate_scenario else 'startup-fresh'}, clear=True))
                stack.enter_context(patch.object(subprocess, 'Popen', side_effect=popen))
                stack.enter_context(patch.object(subprocess, 'check_output', return_value='inert source'))
                stack.enter_context(patch.object(subprocess, 'run', return_value=SimpleNamespace(stdout='')))
                for name in ('kill', 'killpg', 'getpgid', 'system'):
                    stack.enter_context(patch.object(startup_smoke.os, name, side_effect=AssertionError('OS API denied')))
                stack.enter_context(patch('socket.socket', side_effect=AssertionError('network denied')))
                stack.enter_context(patch.object(startup_smoke.time, 'sleep', side_effect=AssertionError('sleep denied')))
                stack.enter_context(patch.object(startup_smoke.sys, 'stderr', captured))
                stack.enter_context(patch.object(Path, 'open', track_open))
                error = None
                error_trace = None
                try:
                    startup_smoke.main()
                except BaseException as caught:
                    error = caught
                    error_trace = traceback.format_exc()
            self.observations.append({
                'test': self._testMethodName, 'receipt': receipt, 'phases': phases,
                'roots_created': len(roots),
                'roots_after_runner': [{'path': str(root), 'exists': root.exists()} for root in roots],
                'caught_type': type(error).__name__ if error else None,
                'caught_message': str(error) if error else None,
                'caught_traceback': error_trace, 'original_failure_primary': error is primary,
                'cleanup_calls': cleanup.call_count, 'provider_wait_calls': provider.wait.call_count,
                'relocation_removals': relocation_removals,
                'diagnostics': captured.getvalue(), 'stderr_failure': stderr_failure,
                'diagnostic_write_attempts': captured.attempts,
                'diagnostic_write_failures': captured.failed_writes,
                'exception_notes': getattr(error, '__notes__', []),
                'catalog_shutdown_calls': catalog.shutdown.call_count,
                'catalog_close_calls': catalog.server_close.call_count,
                'provider_terminate_calls': provider.terminate.call_count,
                'provider_logs_closed': [handle.closed for handle in provider_logs],
            })
            if stale_receipt or duplicate_scenario:
                self.assertIsInstance(error, FileExistsError)
                self.assertEqual(roots, [], 'Refused evidence must not start a new profile or relocation')
                self.assertFalse(any(phase.startswith('mock launch:') for phase in phases))
                cleanup.assert_not_called()
                provider.wait.assert_not_called()
                catalog.shutdown.assert_not_called()
                catalog.server_close.assert_not_called()
                self.assertEqual(relocation_removals, [])
                for path, data in prior.items():
                    self.assertEqual(path.read_bytes(), data, 'Prior evidence was replaced')
                if duplicate_scenario:
                    self.assertFalse((output / 'metadata.json').exists())
                    self.assertFalse((output / 'provider.log').exists())
                self.assertEqual(sentinel.read_bytes(), b'preserve')
                return captured.getvalue()
            self.assertEqual(len(roots), 2)
            retained = receipt != 'complete' or cleanup_error is not None
            for index, root in enumerate(roots):
                self.assertEqual(root.exists(), retained or (index == 0 and relocation_error), str(root))
                if retained:
                    self.assertIn(str(root), ''.join(captured.attempts) if stderr_failure else captured.getvalue())
                    if stderr_failure:
                        self.assertIn(str(root), '\n'.join(error.__notes__))
            if retained:
                self.assertEqual(relocation_removals, [])
            self.assertEqual(sentinel.read_bytes(), b'preserve')
            self.assertTrue(app.exists())
            catalog.shutdown.assert_called_once()
            catalog.server_close.assert_called_once()
            self.assertTrue(provider.wait.called, 'provider shutdown must still be attempted')
            self.assertEqual([handle.closed for handle in provider_logs], [True])
            if success:
                if cleanup_error is not None:
                    self.assertIs(error, cleanup_error)
                elif relocation_error or catalog_error:
                    self.assertIsInstance(error, OSError)
                    self.assertIn('relocation removal failed' if relocation_error else f'{catalog_error} failed', str(error))
                else:
                    self.assertIsNone(error)
                    self.assertIn('{"kind":"finish"}', provider.stdin.getvalue())
                    self.assertTrue((output / 'provider-result.json').exists())
                    self.assertTrue((output / 'results.json').exists())
            else:
                self.assertIs(error, primary)
                for enabled, message in [(relocation_error and not retained, 'relocation removal failed'),
                                         (catalog_error, f'{catalog_error} failed'),
                                         (stdin_error, 'stdin close failed')]:
                    if enabled:
                        self.assertIn(message, '\n'.join(error.__notes__))
            if captured.failed_writes:
                self.assertIn('injected stderr write failure', '\n'.join(error.__notes__))
            if stderr_failure and not (success and not (cleanup_error or relocation_error)):
                self.assertGreater(captured.failed_writes, 0)
            if receipt == 'complete':
                cleanup.assert_called_once()
            else:
                cleanup.assert_not_called()
            if provider_timeout:
                provider.terminate.assert_called_once()
            return captured.getvalue()

    def test_stale_receipt_cannot_clean_a_new_unproven_attempt(self):
        self.exercise(receipt='missing', stale_receipt=True)

    def test_duplicate_scenarios_are_refused_before_any_actor(self):
        self.exercise(duplicate_scenario=True)

    def test_missing_receipt_retains_both_roots(self):
        self.exercise(receipt='missing')

    def test_cleanup_refusal_retains_both_roots(self):
        self.exercise(cleanup_error=RuntimeError('Refusing cleanup of mismatched engine_pid'))

    def test_cleanup_exception_retains_both_roots(self):
        self.exercise(cleanup_error=OSError('cleanup could not settle'))

    def test_incomplete_malformed_and_boolean_identities_retain_roots(self):
        for receipt in ('malformed', 'array', 'empty', 'incomplete', 'bool-app', 'bool-engine', 'negative-engine'):
            with self.subTest(receipt=receipt):
                self.exercise(receipt=receipt)

    def test_successful_cleanup_after_failure_removes_only_owned_roots(self):
        self.exercise()

    def test_wrapper_stop_error_does_not_mask_original_failure(self):
        self.exercise(wrapper_error=True, cleanup_error=RuntimeError('cleanup refused'))

    def test_terminal_no_engine_receipt_and_provider_finish(self):
        self.exercise(success=True)

    def test_provider_timeout_still_terminates_retained_handle(self):
        self.exercise(receipt='missing', provider_timeout=True)

    def test_provider_teardown_error_does_not_mask_original_failure(self):
        self.exercise(receipt='missing', provider_error=True)

    def test_relocation_cleanup_failure_preserves_original_failure(self):
        self.exercise(relocation_error=True)

    def test_relocation_cleanup_failure_after_success_is_reported(self):
        self.exercise(success=True, relocation_error=True)

    def test_retained_profile_never_removes_relocation(self):
        self.exercise(receipt='missing', relocation_error=True)

    def test_catalog_teardown_failure_still_reaps_provider(self):
        for phase in ['shutdown', 'server_close']:
            for timeout in [False, True]:
                with self.subTest(phase=phase, timeout=timeout):
                    self.exercise(catalog_error=phase, provider_timeout=timeout)

    def test_stdin_close_failure_still_reaps_provider(self):
        self.exercise(stdin_error=True, provider_timeout=True)

    def test_catalog_failure_after_success_is_reported(self):
        self.exercise(success=True, catalog_error='shutdown')

    def test_multiple_teardown_errors_preserve_scenario_failure(self):
        self.exercise(relocation_error=True, catalog_error='shutdown', provider_error=True)

    def test_profile_diagnostic_write_failure_preserves_original(self):
        self.exercise(receipt='missing', stderr_failure='Startup cleanup unproven')

    def test_retained_bundle_diagnostic_write_failure_preserves_original(self):
        self.exercise(receipt='missing', stderr_failure='Retained relocated bundle root')

    def test_relocation_diagnostic_write_failure_preserves_original(self):
        self.exercise(relocation_error=True, stderr_failure='Relocation cleanup failed')

    def test_profile_diagnostic_write_failure_preserves_cleanup_error_after_success(self):
        self.exercise(success=True, cleanup_error=OSError('exact cleanup failure'),
                      stderr_failure='Startup cleanup unproven')

    def test_relocation_diagnostic_write_failure_preserves_cleanup_error_after_success(self):
        self.exercise(success=True, relocation_error=True, stderr_failure='Relocation cleanup failed')

    def test_all_diagnostic_writes_fail_but_all_teardown_is_attempted(self):
        self.exercise(receipt='missing', wrapper_error=True, catalog_error='shutdown',
                      stdin_error=True, provider_timeout=True, provider_error=True,
                      stderr_failure='all')

    def test_success_with_broken_stderr_needs_no_diagnostic(self):
        self.exercise(success=True, stderr_failure='all')


if __name__ == '__main__':
    unittest.main()
