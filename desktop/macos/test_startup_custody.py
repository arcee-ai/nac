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
                 wrapper_error=False, provider_timeout=False, provider_error=False):
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
            real_cleanup = startup_smoke.cleanup_failed_case
            cleanup = Mock(side_effect=cleanup_error) if cleanup_error else Mock(wraps=real_cleanup)
            captured = io.StringIO()
            with ExitStack() as stack:
                stack.enter_context(patch.object(startup_smoke, 'tempfile', SimpleNamespace(
                    TemporaryDirectory=temporary_directory, mkdtemp=mkdtemp)))
                stack.enter_context(patch.object(startup_smoke, 'console_locked', return_value=False))
                stack.enter_context(patch.object(startup_smoke, 'ThreadingHTTPServer', return_value=catalog))
                stack.enter_context(patch.object(startup_smoke.threading, 'Thread'))
                stack.enter_context(patch.object(startup_smoke, 'cleanup_failed_case', cleanup))
                stack.enter_context(patch.object(startup_smoke.sys, 'argv', ['startup_smoke.py', str(app), str(output)]))
                stack.enter_context(patch.dict(startup_smoke.os.environ, {'NAC_STARTUP_SCENARIOS': 'startup-fresh'}, clear=True))
                stack.enter_context(patch.object(subprocess, 'Popen', side_effect=popen))
                stack.enter_context(patch.object(subprocess, 'check_output', return_value='inert source'))
                stack.enter_context(patch.object(subprocess, 'run', return_value=SimpleNamespace(stdout='')))
                for name in ('kill', 'killpg', 'getpgid', 'system'):
                    stack.enter_context(patch.object(startup_smoke.os, name, side_effect=AssertionError('OS API denied')))
                stack.enter_context(patch('socket.socket', side_effect=AssertionError('network denied')))
                stack.enter_context(patch.object(startup_smoke.time, 'sleep', side_effect=AssertionError('sleep denied')))
                stack.enter_context(patch.object(startup_smoke.sys, 'stderr', captured))
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
                'diagnostics': captured.getvalue(),
            })
            self.assertEqual(len(roots), 2)
            retained = receipt != 'complete' or cleanup_error is not None
            for root in roots:
                self.assertEqual(root.exists(), retained, str(root))
                if retained:
                    self.assertIn(str(root), captured.getvalue())
            self.assertEqual(sentinel.read_bytes(), b'preserve')
            self.assertTrue(app.exists())
            catalog.shutdown.assert_called_once()
            catalog.server_close.assert_called_once()
            self.assertTrue(provider.wait.called, 'provider shutdown must still be attempted')
            if success:
                self.assertIsNone(error)
                self.assertIn('{"kind":"finish"}', provider.stdin.getvalue())
                self.assertTrue((output / 'provider-result.json').exists())
                self.assertTrue((output / 'results.json').exists())
            else:
                self.assertIs(error, primary)
            if receipt == 'complete':
                cleanup.assert_called_once()
            else:
                cleanup.assert_not_called()
            if provider_timeout:
                provider.terminate.assert_called_once()
            return captured.getvalue()

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


if __name__ == '__main__':
    unittest.main()
