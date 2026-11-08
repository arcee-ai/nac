"""Actual dummy HTTP fixture and owned endpoint controls; no NAC app/engine."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import urllib.request

from ci_startup_api import (FixtureFailure, Provider, endpoint, failure_metadata, owned_listener,
                           require, require_readiness, seed_model)
from ci_startup_fixture import PRODUCT


class StartupAPITests(unittest.TestCase):
    def test_diagnostic_byte_sentinel_is_bounded_and_only_applies_to_actual_bytes(self):
        limit = 8 * 1024 * 1024
        for value in (0, limit, limit + 1):
            metadata = failure_metadata(FixtureFailure('served_entry_asset_bytes', {'actual_bytes': value}))
            self.assertEqual(metadata['operands'], {'actual_bytes': value})
        for key in ('expected_bytes', 'asset_ordinal', 'http_status'):
            self.assertEqual(failure_metadata(FixtureFailure('served_entry_asset_bytes', {key: limit}))['operands'],
                             {key: limit})
            self.assertEqual(failure_metadata(FixtureFailure('served_entry_asset_bytes', {key: limit + 1}))['operands'], {})
        for value in (True, False, -1, limit + 2, 10**100, float(limit), str(limit)):
            self.assertEqual(failure_metadata(FixtureFailure('served_entry_asset_bytes', {'actual_bytes': value}))['operands'], {})

    def test_named_transcript_guard_keeps_closed_redacted_operands(self):
        metadata = failure_metadata(FixtureFailure('transcript_schema', {'actual_bytes': 9,
            'body': 'private-canary', 'path': '/private-canary', 'url': 'https://private-canary.invalid'}))
        self.assertEqual(metadata, {'exception_type': 'FixtureFailure', 'guard_code': 'transcript_schema',
                                    'operands': {'actual_bytes': 9}})
        self.assertNotIn('private-canary', json.dumps(metadata))

    def test_failure_metadata_never_formats_unknown_exception_or_exports_arbitrary_operands(self):
        class PrivateError(Exception):
            def __str__(self):
                raise AssertionError('Must never format private URL/token/body')
        for error in (PrivateError(), RuntimeError('https://private.invalid/token/secret'),
                      ValueError('private body'), json.JSONDecodeError('private', 'secret-document', 0)):
            metadata = failure_metadata(error)
            self.assertNotIn('private', json.dumps(metadata))
            self.assertNotIn('secret', json.dumps(metadata))
            self.assertEqual(metadata['guard_code'], 'unknown')
            self.assertEqual(metadata['operands'], {})
        with self.assertRaises(RuntimeError) as caught:
            require(False, 'served_entry_asset_bytes', facts={'actual_bytes': 7, 'expected_bytes': 9,
                'asset_ordinal': 0, 'http_status': 200, 'actual_sha256': 'a' * 64, 'expected_sha256': 'b' * 64,
                'body': 'private-token', 'path': '/private/profile', 'URL': 'https://private.invalid'})
        metadata = failure_metadata(caught.exception)
        self.assertEqual(metadata['guard_code'], 'served_entry_asset_bytes')
        self.assertEqual(len(metadata['operands']), 6)
        self.assertNotIn('private', json.dumps(metadata))
        for facts in ({'actual_bytes': True, 'asset_ordinal': -1}, {'http_status': 10**50},
                      {'actual_sha256': 'secret'}, {'expected_sha256': 'A' * 64}):
            self.assertEqual(failure_metadata(FixtureFailure('served_entry_asset_bytes', facts))['operands'], {})
        self.assertEqual(failure_metadata(FixtureFailure('private-unknown-reason'))['guard_code'], 'unknown')

    def test_owned_dummy_provider_matches_shared_script_and_records_no_credentials(self):
        with tempfile.TemporaryDirectory() as temporary:
            log = Path(temporary) / 'provider.log'
            provider = Provider(log)
            try:
                base = provider.start()
                body = {'model': 'gpt-5.6-sol', 'input': 'FINDER_CONFIGURED_LOCAL_startup-home', 'stream': False}
                call = urllib.request.Request(base + '/responses', data=json.dumps(body).encode(),
                    headers={'Content-Type': 'application/json', 'Authorization': 'Bearer preview-dummy-only'})
                with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(call, timeout=5) as response:
                    result = json.loads(response.read(65536))
                self.assertIn('Finder configured local response.', json.dumps(result))
                journal = provider.stop()
                self.assertTrue(journal['valid'])
                self.assertEqual(len(journal['requests']), 1)
                self.assertTrue(journal['requests'][0]['dummy_authorization_matches'])
                self.assertNotIn('preview-dummy-only', json.dumps(journal))
                self.assertEqual(provider.stop(), journal)
            finally:
                if provider.process and provider.process.poll() is None:
                    provider.stop(require_complete=False)
            self.assertIsNotNone(provider.process.returncode)

    def test_unused_or_wrong_dummy_authorization_is_not_a_successful_model_case(self):
        for use_request in (False, True):
            with self.subTest(use_request=use_request):
                provider = Provider()
                try:
                    base = provider.start()
                    if use_request:
                        call = urllib.request.Request(base + '/responses',
                            data=json.dumps({'model': 'gpt-5.6-sol', 'input': 'FINDER_CONFIGURED_LOCAL_startup-home'}).encode(),
                            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer wrong-unit-only'})
                        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(call, timeout=5) as response:
                            response.read(65536)
                    journal = provider.stop(require_complete=False)
                    self.assertFalse(journal['valid'])
                    self.assertNotIn('wrong-unit-only', json.dumps(journal))
                    with self.assertRaises(RuntimeError):
                        provider.stop(require_complete=True)
                finally:
                    if provider.process and provider.process.poll() is None:
                        provider.stop(require_complete=False)

    def test_provider_source_mismatch_stops_owned_fixture_before_admission(self):
        provider = Provider()
        with patch('ci_startup_api.digest', return_value='f' * 64), self.assertRaises(RuntimeError):
            provider.start()
        self.assertIsNotNone(provider.process.poll())

    def test_endpoint_binding_rejects_remote_credentials_paths_and_queries(self):
        self.assertEqual(endpoint('http://127.0.0.1:1234/'), 'http://127.0.0.1:1234')
        for value in ('http://localhost:1234', 'https://127.0.0.1:1234', 'http://127.0.0.1',
                      'http://user:secret@127.0.0.1:1234', 'http://127.0.0.1:1234/api',
                      'http://127.0.0.1:secret-port', 'http://127.0.0.1:65536', 'http://127.0.0.1:1234/?key=value', 'http://127.0.0.1:1234/#fragment'):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                endpoint(value)

    def test_readiness_binds_full_product_identity_and_unmanaged_local_context(self):
        identity = {'product_version': '0.1.4', 'source_revision': PRODUCT, 'track': 'dev', 'build_id': 'dev-' + PRODUCT}
        row = {'status': 'ok', 'managed': False, 'product_version': identity['product_version'],
               'source_revision': PRODUCT, 'build_track': 'dev', 'build_id': identity['build_id']}
        self.assertEqual(require_readiness(row, identity), row)
        for changed in ({'status': 'unavailable'}, {'managed': True}, {'managed': 0},
                        {'source_revision': 'foreign'}, {'build_track': 'stable'}, {'build_id': 'other'}):
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                require_readiness({**row, **changed}, identity)

    def test_model_fixture_seeds_only_a_preset_through_normal_rust_settings_api(self):
        with patch('ci_startup_api.request', side_effect=[{'projects': []}, [], {'config_id': 'owned'},
                                                        {'projects': []}, []]) as call:
            proof = seed_model('http://127.0.0.1:1234', 'http://127.0.0.1:4321')
        self.assertFalse(proof['project_seeded'])
        writes = [entry.args for entry in call.call_args_list if len(entry.args) == 3]
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0][1], '/model-configs')
        self.assertEqual(writes[0][2]['api_key'], 'preview-dummy-only')
        self.assertEqual(writes[0][2]['model'], 'gpt-5.6-sol')
        with patch('ci_startup_api.request', return_value={'projects': [{'project_id': 'foreign'}]}), self.assertRaises(RuntimeError):
            seed_model('http://127.0.0.1:1234', 'http://127.0.0.1:4321')

    def test_listener_requires_kernel_generation_and_one_actual_owned_loopback_address(self):
        node = {'pid': 123, 'parent': 50, 'uid': 501, 'start_seconds': 1234,
                'start_microseconds': 567, 'executable': '/private/owned/NAC.app/Contents/Resources/nac-web'}
        result = SimpleNamespace(returncode=0, stdout=b'p123\nn127.0.0.1:43123\n')
        with patch('ci_startup_api.native_identity', side_effect=[node, node]), \
                patch('ci_startup_api.subprocess.run', return_value=result):
            self.assertEqual(owned_listener(123, node), 'http://127.0.0.1:43123')
        for data in (b'p999\nn127.0.0.1:43123\n', b'p123\nn0.0.0.0:43123\n',
                     b'p123\nn127.0.0.1:43123\nn127.0.0.1:43124\n'):
            with patch('ci_startup_api.native_identity', return_value=node), \
                    patch('ci_startup_api.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout=data)), \
                    self.assertRaises(RuntimeError):
                owned_listener(123, node)
        with patch('ci_startup_api.native_identity', side_effect=[node, {**node, 'start_microseconds': 999}]), \
                patch('ci_startup_api.subprocess.run', return_value=result), self.assertRaises(RuntimeError):
            owned_listener(123, node)
        with patch('ci_startup_api.native_identity', return_value=None), \
                patch('ci_startup_api.subprocess.run') as command, self.assertRaises(RuntimeError):
            owned_listener(123, node)
        command.assert_not_called()


if __name__ == '__main__':
    unittest.main()
