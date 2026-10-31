"""A recording fixture never authorizes opening the personal shared browser."""
import unittest
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
