"""Fixture preflight contracts; no app, serving engine or native paint proof."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from instance_smoke import coexist_case, coexist_selection


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.diagnostic = self.root / 'configuration-failure.json'
        self.binary = self.root / 'exact engine'
        self.env = {'HOME': str(self.root), 'OPENAI_API_KEY': 'private-value'}

    def selected(self, track='dev'):
        return dict(status='selected', version=1, track=track, root_cwd=str(self.root),
                    store=str(self.root / (track + '.db')))

    def invoke(self, value, code=0, stderr=b'', raw=False):
        stdout = value if raw else json.dumps(value).encode()
        response = subprocess.CompletedProcess([], code, stdout, stderr)
        with patch('instance_smoke.subprocess.run', return_value=response) as run:
            result = coexist_selection(self.binary, self.root, self.env, 'dev', self.diagnostic)
        return result, run

    def test_each_fresh_track_uses_exact_owned_cwd_and_actual_default_name(self):
        for track in ('dev', 'stable'):
            response = subprocess.CompletedProcess([], 0, json.dumps(self.selected(track)).encode(), b'')
            with patch('instance_smoke.subprocess.run', return_value=response) as run:
                store = coexist_selection(self.binary, self.root, self.env, track, self.diagnostic)
            self.assertEqual(store, self.root / (track + '.db'))
            run.assert_called_once_with([str(self.binary), '__desktop-configuration', '--directory', str(self.root)],
                                        cwd=self.root, env=self.env, capture_output=True, timeout=12)
            self.assertFalse(self.diagnostic.exists())

    def test_failed_variant_without_store_retains_code_and_never_launches_app(self):
        failed = dict(status='failed', version=1, code='bootstrap_directory', message='private-value')
        response = subprocess.CompletedProcess([], 0, json.dumps(failed).encode(), b'private-value')
        with patch('instance_smoke.subprocess.run', return_value=response), \
                patch('instance_smoke.subprocess.check_output', return_value=b'{"track":"dev"}'), \
                patch('instance_smoke.AppJourney') as app:
            with self.assertRaisesRegex(AssertionError, 'not selected version 1'):
                coexist_case(self.root / 'dev.app', self.root / 'stable.app', self.root, self.root,
                             self.root / 'observer', [])
        app.assert_not_called()
        diagnostic = json.loads((self.root / 'dev/configuration-failure.json').read_text())
        self.assertEqual(diagnostic['response']['code'], 'bootstrap_directory')
        self.assertNotIn('private-value', json.dumps(diagnostic))
        self.assertEqual(diagnostic['exit_code'], 0)

    def test_rejects_each_inconsistent_selected_field_before_store_access(self):
        variants = [None, [], {}, dict(status='failed', version=1),
                    *[dict(self.selected(), **{key: value}) for key, value in (
                        ('status', 'unknown'), ('version', True), ('version', 2), ('track', 'stable'),
                        ('root_cwd', '/elsewhere'), ('store', None), ('store', ''), ('store', 7),
                        ('store', 'relative.db'), ('store', '/bad\0path'),
                        ('store', str(self.root / 'sub/../dev.db')))],
                    {key: value for key, value in self.selected().items() if key != 'store'}]
        for value in variants:
            with self.subTest(value=value), self.assertRaises(AssertionError):
                self.invoke(value)
            self.assertLess(self.diagnostic.stat().st_size, 4096)

    def test_nonzero_exit_rejects_even_a_selected_payload(self):
        with self.assertRaisesRegex(AssertionError, 'exited unsuccessfully'):
            self.invoke(self.selected(), code=70)
        self.assertEqual(json.loads(self.diagnostic.read_text())['exit_code'], 70)

    def test_canonical_foreign_store_is_rejected_before_app_creation(self):
        with tempfile.TemporaryDirectory() as foreign:
            value = dict(self.selected(), store=str(Path(foreign).resolve() / 'foreign.db'))
            response = subprocess.CompletedProcess([], 0, json.dumps(value).encode(), b'')
            with patch('instance_smoke.subprocess.run', return_value=response), \
                    patch('instance_smoke.subprocess.check_output', return_value=b'{"track":"dev"}'), \
                    patch('instance_smoke.AppJourney') as app:
                with self.assertRaisesRegex(AssertionError, 'escaped the owned fixture root'):
                    coexist_case(self.root / 'dev.app', self.root / 'stable.app', self.root, self.root,
                                 self.root / 'observer', [])
            app.assert_not_called()
            self.assertFalse((Path(foreign) / 'foreign.db').exists())

    def test_symlink_outside_cannot_supply_an_owned_store(self):
        with tempfile.TemporaryDirectory() as foreign:
            outside = Path(foreign).resolve()
            alias = self.root / 'escape'
            alias.symlink_to(outside, target_is_directory=True)
            for store in (alias / 'foreign.db', (alias / 'foreign.db').resolve()):
                with self.subTest(store=store), self.assertRaises(AssertionError):
                    self.invoke(dict(self.selected(), store=str(store)))
            self.assertFalse((outside / 'foreign.db').exists())

    def test_malformed_oversized_and_stderr_are_hashed_without_retaining_text(self):
        for raw in (b'private-value not JSON', b'\xff', b'private-value' * 2000):
            with self.subTest(size=len(raw)), self.assertRaises(AssertionError):
                self.invoke(raw, stderr=b'private-value', raw=True)
            encoded = self.diagnostic.read_text()
            diagnostic = json.loads(encoded)
            self.assertNotIn('private-value', encoded)
            self.assertEqual(diagnostic['stdout_bytes'], len(raw))
            self.assertEqual(diagnostic['stdout_sha256'], hashlib.sha256(raw).hexdigest())
            self.assertLess(len(encoded), 4096)

    def test_unknown_fields_and_protocol_values_cannot_leak_into_diagnostic(self):
        value = dict(status='private-value', version='private-value', track='private-value',
                     code='private-value', root_cwd='private-value', store='private-value',
                     message='private-value', extra='private-value')
        with self.assertRaises(AssertionError):
            self.invoke(value)
        self.assertNotIn('private-value', self.diagnostic.read_text())

    def test_timeout_retains_partial_byte_identity_and_does_not_retry(self):
        error = subprocess.TimeoutExpired([], 12, output=b'private-value', stderr=b'private-value')
        with patch('instance_smoke.subprocess.run', side_effect=error) as run:
            with self.assertRaisesRegex(AssertionError, 'timed out'):
                coexist_selection(self.binary, self.root, self.env, 'dev', self.diagnostic)
        self.assertEqual(run.call_count, 1)
        diagnostic = json.loads(self.diagnostic.read_text())
        self.assertIsNone(diagnostic['exit_code'])
        self.assertEqual(diagnostic['stdout_bytes'], len(b'private-value'))
        self.assertNotIn('private-value', self.diagnostic.read_text())


if __name__ == '__main__':
    unittest.main()
