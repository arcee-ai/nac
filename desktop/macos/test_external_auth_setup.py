"""Execute the actual auth-arrangement scripts with inert DOM/HTTP boundaries."""
from pathlib import Path
import subprocess
import unittest


class ExternalAuthSetupControls(unittest.TestCase):
    def test_actual_scripts_wait_for_the_session_and_keep_only_the_fake_credential_name(self):
        owner = Path(__file__).parent
        result = subprocess.run(['node', str(owner / 'test_support/external_auth_setup.cjs'),
                                 str(owner / 'ExternalAuthSmoke.swift')], check=False,
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
