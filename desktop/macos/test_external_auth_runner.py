"""A recording fixture never authorizes opening the personal shared browser."""
from pathlib import Path
import unittest
import device_auth_smoke
from unittest.mock import patch

import external_auth_smoke


class ExternalAuthRunnerIsolation(unittest.TestCase):
    def test_shared_host_is_refused_even_when_console_is_unlocked(self):
        with patch.dict('os.environ', {}, clear=True), patch('sys.argv', ['runner', '/fixture.app', '/evidence']), \
                patch.object(external_auth_smoke.subprocess, 'Popen') as launch:
            with self.assertRaisesRegex(SystemExit, 'isolated hosted Mac'):
                external_auth_smoke.main()
            launch.assert_not_called()

    def test_locked_and_unknown_hosted_console_are_refused_before_browser_launch(self):
        for console in [{'observed': True, 'locked': True}, {'observed': False, 'locked': None}]:
            with self.subTest(console=console), patch.dict('os.environ', {'GITHUB_ACTIONS': 'true', 'RUNNER_OS': 'macOS'}, clear=True), \
                    patch('sys.argv', ['runner', '/fixture.app', '/evidence']), \
                    patch.object(external_auth_smoke, 'session_lock_state', return_value=console), \
                    patch.object(external_auth_smoke.subprocess, 'Popen') as launch:
                with self.assertRaisesRegex(SystemExit, 'unlocked isolated Mac'):
                    external_auth_smoke.main()
                launch.assert_not_called()

    def test_explicit_observer_uses_strong_console_guard_without_legacy_fallback(self):
        observer = Path('/owned/source-compiled-observer')
        strong = {'unlocked': True, 'root': {'IOConsoleLocked': False}}
        with patch.dict('os.environ', {'GITHUB_ACTIONS': 'true', 'RUNNER_OS': 'macOS'}, clear=True), \
                patch.object(external_auth_smoke, 'session_lock_state') as legacy, \
                patch.object(external_auth_smoke, 'require_console', return_value=strong) as guard:
            self.assertIs(external_auth_smoke.require_isolated_host(observer), strong)
            guard.assert_called_once_with(observer, [], 'hosted-auth-driver-before-launch')
            legacy.assert_not_called()
            guard.side_effect = AssertionError('explicit or unknown console refusal')
            with self.assertRaisesRegex(AssertionError, 'console refusal'):
                external_auth_smoke.require_isolated_host(observer)
            legacy.assert_not_called()

    def test_explicit_observer_cannot_admit_the_shared_host(self):
        with patch.dict('os.environ', {}, clear=True), \
                patch.object(external_auth_smoke, 'require_console') as guard:
            with self.assertRaisesRegex(SystemExit, 'isolated hosted Mac'):
                external_auth_smoke.require_isolated_host(Path('/owned/observer'))
            guard.assert_not_called()

    def test_old_cli_stays_compatible_and_new_observer_is_explicit(self):
        app, output, observer = external_auth_smoke.auth_arguments(['/fixture.app', '/evidence'])
        self.assertEqual((app, output, observer), (Path('/fixture.app'), Path('/evidence'), None))
        app, output, observer = external_auth_smoke.auth_arguments([
            '/fixture.app', '/evidence', '--console-observer', '/owned/observer'])
        self.assertEqual(observer, Path('/owned/observer'))

    def test_both_actual_entrypoints_forward_observer_and_stop_before_launch_on_refusal(self):
        for driver in (external_auth_smoke, device_auth_smoke):
            with self.subTest(driver=driver.__name__), \
                    patch('sys.argv', ['runner', '/fixture.app', '/evidence', '--console-observer', '/owned/observer']), \
                    patch.object(driver, 'require_isolated_host', side_effect=AssertionError('console refused')) as guard, \
                    patch.object(driver.subprocess, 'Popen') as launch:
                with self.assertRaisesRegex(AssertionError, 'console refused'):
                    driver.main()
                guard.assert_called_once_with(Path('/owned/observer'))
                launch.assert_not_called()
