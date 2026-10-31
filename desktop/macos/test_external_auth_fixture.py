"""Auth-double contracts. These tests do not prove native/browser acceptance."""
import base64
import hashlib
import json
import socket
import unittest
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from external_auth_fixture import AuthFixture


class ExternalAuthFixtureTests(unittest.TestCase):
    def post(self, fixture, path, value):
        request = Request(fixture.origin + path, data=urlencode(value).encode(), method='POST')
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            with error:
                return error.code, json.load(error)

    def authorize(self, fixture, **changes):
        verifier = 'fixture-verifier-abcdefghijklmnopqrstuvwxyz0123456789'
        query = {'redirect_uri': fixture.callback, 'client_id': 'local-fixture-client', 'response_type': 'code',
                 'code_challenge_method': 'S256', 'state': 'local-state', 'code_challenge':
                 base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()}
        query.update(changes)
        request = Request(fixture.origin + '/oauth/authorize/success?' + urlencode(query),
                          headers={'User-Agent': 'fixture-unit-client'})
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, response.read().decode(), verifier
        except HTTPError as error:
            with error:
                return error.code, error.read().decode(), verifier

    def test_actual_callback_pkce_and_single_use_are_required(self):
        with AuthFixture() as fixture:
            status, _, verifier = self.authorize(fixture)
            self.assertEqual(status, 200)
            code = next(iter(fixture.codes))
            form = {'code': code, 'code_verifier': verifier, 'client_id': 'local-fixture-client',
                    'redirect_uri': fixture.callback, 'grant_type': 'authorization_code'}
            for key, value in [('redirect_uri', 'http://localhost:1457/callback'), ('client_id', 'foreign-client'),
                               ('code_verifier', 'wrong-verifier'), ('grant_type', 'refresh_token')]:
                with self.subTest(key=key):
                    self.assertEqual(self.post(fixture, '/oauth/token', {**form, key: value})[0], 400)
            self.assertEqual(self.post(fixture, '/oauth/token', form)[0], 200)
            self.assertEqual(self.post(fixture, '/oauth/token', form), (400, {'error': 'invalid_grant'}))
            self.assertEqual(fixture.snapshot()['tokens_issued'], 1)

    def test_authorization_never_redirects_to_an_unbound_callback(self):
        with AuthFixture() as fixture:
            for callback in ['https://example.test/callback', 'http://127.0.0.1:1456/callback',
                             'http://localhost:1456/wrong', fixture.callback + '?state=other']:
                with self.subTest(callback=callback):
                    self.assertEqual(self.authorize(fixture, redirect_uri=callback)[0], 400)
            self.assertEqual(fixture.snapshot()['events'], [])

    def test_expiry_is_deterministic_and_evidence_contains_no_credentials(self):
        now = [1.0]
        with AuthFixture(clock=lambda: now[0]) as fixture:
            _, _, verifier = self.authorize(fixture)
            code = next(iter(fixture.codes))
            now[0] += 61
            self.assertEqual(self.post(fixture, '/oauth/token', {'code': code, 'code_verifier': verifier,
                'client_id': 'local-fixture-client', 'redirect_uri': fixture.callback,
                'grant_type': 'authorization_code'})[0], 400)
            evidence = json.dumps(fixture.snapshot())
            for value in [code, verifier, fixture.callback, 'local-state', 'local-fixture-access']:
                self.assertNotIn(value, evidence)

    def test_device_requires_browser_approval_and_expires(self):
        now = [1.0]
        with AuthFixture(clock=lambda: now[0]) as fixture:
            status, device = self.post(fixture, '/device/code', {})
            self.assertEqual(status, 200)
            form = {'device_code': device['device_code']}
            self.assertEqual(self.post(fixture, '/device/token', form), (400, {'error': 'authorization_pending'}))
            with urlopen(device['verification_uri'], timeout=3) as response:
                self.assertEqual(response.status, 200)
            self.assertEqual(self.post(fixture, '/device/token', form)[0], 200)
            now[0] += 61
            self.assertEqual(self.post(fixture, '/device/token', form), (400, {'error': 'expired_token'}))

    def test_listener_retires_and_no_thread_remains(self):
        with AuthFixture() as fixture:
            port = urlsplit(fixture.origin).port
        self.assertFalse(fixture.thread.is_alive())
        with socket.socket() as client:
            client.settimeout(1)
            self.assertNotEqual(client.connect_ex(('127.0.0.1', port)), 0)


if __name__ == '__main__':
    unittest.main()
