"""Profile and Arcee-wire double tests; no native/vendor qualification."""
import json
from pathlib import Path
import re
import subprocess
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import urlencode

from device_auth_profile import DeviceProfile
from device_auth_smoke import require_browser_handoff
from external_auth_fixture import AuthFixture


class DeviceAuthFixtureTests(unittest.TestCase):
    def post(self, fixture, path, body):
        request = Request(fixture.origin + path, data=json.dumps(body).encode(),
                          headers={'Content-Type': 'application/json'}, method='POST')
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            with error:
                return error.code, json.load(error)

    def test_arcee_wire_uses_legacy_client_and_never_issues_a_managed_binding(self):
        with AuthFixture() as fixture:
            self.assertEqual(self.post(fixture, '/app/v1/device/code', {'client_id': 'managed-nac'})[0], 400)
            status, prompt = self.post(fixture, '/app/v1/device/code', {'client_id': 'nac-cli'})
            self.assertEqual(status, 200)
            form = {'client_id': 'nac-cli', 'device_code': prompt['device_code']}
            self.assertEqual(self.post(fixture, '/app/v1/device/token', form), (400, {'error': 'authorization_pending'}))
            with urlopen(prompt['verification_uri_complete'], timeout=3) as response:
                self.assertEqual(response.status, 200)
            status, token = self.post(fixture, '/app/v1/device/token', form)
            self.assertEqual(status, 200)
            self.assertEqual(token['base_url'], 'https://api.arcee.ai/api/v1')
            self.assertNotIn('managed_binding', token)
            self.assertNotIn(token['access_token'], json.dumps(fixture.snapshot()))

    def test_denial_expiry_and_hold_are_actual_double_outcomes(self):
        for mode, expected in [('denied', 'access_denied'), ('expired', 'expired_token'), ('hold', 'authorization_pending')]:
            with self.subTest(mode=mode), AuthFixture(device_mode=mode) as fixture:
                _, prompt = self.post(fixture, '/app/v1/device/code', {'client_id': 'nac-cli'})
                with urlopen(prompt['verification_uri_complete'], timeout=3):
                    pass
                self.assertEqual(self.post(fixture, '/app/v1/device/token', {'client_id': 'nac-cli',
                    'device_code': prompt['device_code']}), (400, {'error': expected}))

    def test_timeout_keeps_owner_default_and_bounds_native_scheduling_allowance(self):
        for expiry in (3, 15):
            now = [1.0]
            with self.subTest(expiry=expiry), AuthFixture(clock=lambda: now[0], device_mode='timeout',
                    **({} if expiry == 3 else {'device_timeout_seconds': 15})) as fixture:
                _, prompt = self.post(fixture, '/app/v1/device/code', {'client_id': 'nac-cli'})
                self.assertEqual(prompt['expires_in'], expiry)
                form = {'client_id': 'nac-cli', 'device_code': prompt['device_code']}
                now[0] = 1.0 + expiry - .1
                self.assertEqual(self.post(fixture, '/app/v1/device/token', form)[1], {'error': 'authorization_pending'})
                now[0] = 1.0 + expiry + .1
                with urlopen(prompt['verification_uri_complete'], timeout=3):
                    pass
                self.assertEqual(self.post(fixture, '/app/v1/device/token', form)[1], {'error': 'expired_token'})
                self.assertFalse(any(event['kind'] == 'browser_observation' for event in fixture.snapshot()['events']))

    def test_an_expired_card_or_missing_handoff_never_qualifies_browser_coverage(self):
        for record in [
            {'passed': True, 'actual_owner_failure': 'expired'},
            {'passed': True, 'external_browser_observed': False, 'handoff_coverage_missing': True},
            {'passed': True, 'external_browser_observed': True, 'handoff_coverage_missing': True},
        ]:
            with self.subTest(record=record), self.assertRaises(AssertionError):
                require_browser_handoff(record)

    def test_external_profile_is_exact_private_owned_and_removed(self):
        build = {'track': 'dev', 'build_id': 'native-auth-fixture-v1-test', 'source_revision': 'test-source'}
        with DeviceProfile(build, 'http://127.0.0.1:43123') as profile:
            root = profile.root
            self.assertEqual(root.stat().st_mode & 0o777, 0o700)
            sentinel = root / '.native-auth-fixture-owner.json'
            self.assertEqual(sentinel.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(sentinel.read_text())['run'], str(profile.run))
            self.assertEqual(profile.environment['NAC_HOME'], str(root / 'nac-home'))
            self.assertEqual(profile.store, root / 'store.db')
            self.assertEqual(root.parent, Path('/tmp').resolve())
        self.assertFalse(root.exists())

    def test_generated_device_and_oauth_page_scripts_parse_without_execution(self):
        with AuthFixture() as fixture:
            _, prompt = self.post(fixture, '/app/v1/device/code', {'client_id': 'nac-cli'})
            authorization = fixture.origin + '/oauth/authorize/success?' + urlencode({
                'client_id': 'fixture', 'redirect_uri': fixture.callback, 'response_type': 'code',
                'state': 'fixture', 'code_challenge_method': 'S256', 'code_challenge': 'fixture'})
            for page in [prompt['verification_uri_complete'], authorization]:
                with urlopen(page, timeout=3) as response:
                    script = re.search(r'<script>(.*?)</script>', response.read().decode(), re.S).group(1)
                parsed = subprocess.run(['node', '--check'], input=script, text=True, capture_output=True, timeout=5)
                self.assertEqual(parsed.returncode, 0, parsed.stderr)
