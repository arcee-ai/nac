"""Canonical API fixtures only; no product process, app or UI execution."""
import threading
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from ci_startup_audit import LiveAudit, PROMPT, RESPONSE, entry_assets, persisted_audit, session_facts, transcript


class StartupAuditTests(unittest.TestCase):
    def fixture(self):
        config = {'workspace': '/owned/workspace', 'expected_store': '/owned/nac/dev.db',
                  'provider_base': 'http://127.0.0.1:1234', 'scenario': 'configuredLocal'}
        messages = [{'role': 'user', 'content': PROMPT}, {'role': 'assistant', 'content': RESPONSE, 'tool_calls': None}]
        metadata = {'session_id': 'owned-session', 'project_id': 'owned-project', 'cwd': config['workspace'],
                    'store_path': config['expected_store'], 'backend': 'openai-responses', 'model': 'gpt-5.6-sol',
                    'base_url': config['provider_base'], 'sandbox_status': 'off'}
        summary = {**metadata, 'sandboxed': False, 'ssh_host': None}
        rows = {'/projects': {'projects': [{'project_id': 'owned-project', 'cwd': config['workspace'], 'ssh_host': None}]},
                '/sessions': [{'summary': summary, 'active_run': None}],
                '/sessions/owned-session': {'metadata': metadata, 'messages': messages},
                '/model-configs': {'configurations': [{'config_id': 'owned-model', 'backend': 'openai-responses',
                    'model': 'gpt-5.6-sol', 'base_url': config['provider_base'], 'extra_headers': {}}]},
                '/sessions/owned-session/messages': {'messages': messages},
                '/sessions/owned-session/user-terminals': {'terminals': []},
                '/sessions/owned-session/events': {'events': [{'event': {'type': 'run_completed', 'response': RESPONSE},
                                                             'run_id': 'owned-run', 'session_id': 'owned-session'}]}}
        return config, rows

    def facts(self, config, rows, live=True):
        with patch('ci_startup_audit.request', side_effect=lambda base, path: rows[path]):
            return session_facts('http://127.0.0.1:4321', config, {'config_id': 'owned-model'}, live=live)

    def test_canonical_settlement_and_restart_read_are_separate_from_ui_reload(self):
        config, rows = self.fixture()
        live = self.facts(config, rows)
        self.assertEqual(live['completed_run_id'], 'owned-run')
        self.assertEqual(live['execution'], {'ssh_host': None, 'sandboxed': False, 'sandbox_status': 'off'})
        with patch('ci_startup_audit.request', side_effect=lambda base, path: rows[path]):
            saved = persisted_audit('http://127.0.0.1:4321', config, {'config_id': 'owned-model'}, {'facts': live})
            self.assertIn('no UI reload', saved['scope'])
            with self.assertRaises(RuntimeError):
                persisted_audit('http://127.0.0.1:4321', config, {'config_id': 'owned-model'}, {'facts': {}})

    def test_pending_unknown_or_failure_never_becomes_settled(self):
        for path, key, value in (('/sessions', 'active_run', {'run_id': 'pending'}),
                                 ('/sessions', 'active_run', 'MISSING'),
                                 ('/sessions/owned-session', 'active_run', {'run_id': 'pending'}),
                                 ('/sessions/owned-session', 'run_failure', {'kind': 'interrupted'}),
                                 ('/sessions/owned-session', 'transcript_recovery_warning', 'failed tail')):
            config, rows = self.fixture()
            row = rows[path][0] if path == '/sessions' else rows[path]
            if value == 'MISSING':
                del row[key]
            else:
                row[key] = value
            with self.subTest(key=key, value=value):
                self.assertIsNone(self.facts(config, rows))
        config, rows = self.fixture()
        rows['/sessions/owned-session/events']['events'] = []
        self.assertIsNone(self.facts(config, rows))

    def test_local_backend_model_store_and_transcript_cannot_be_inferred_from_ui_text(self):
        for path, key, value in (('/projects', 'cwd', '/foreign'), ('/projects', 'ssh_host', 'remote'),
                                ('/sessions', 'sandboxed', True), ('/sessions', 'backend', 'ssh'),
                                ('/sessions/owned-session', 'store_path', '/other/store.db'),
                                ('/sessions/owned-session', 'base_url', 'http://127.0.0.1:9999'),
                                ('/sessions/owned-session', 'sandbox_status', 'on')):
            config, rows = self.fixture()
            row = (rows[path]['projects'][0] if path == '/projects' else rows[path][0]['summary']
                   if path == '/sessions' else rows[path]['metadata'])
            row[key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                self.facts(config, rows)
        config, rows = self.fixture()
        rows['/sessions/owned-session/messages'] = {'messages': [{'role': 'user', 'content': PROMPT}]}
        with self.assertRaises(RuntimeError):
            self.facts(config, rows)

    def test_unexpected_tools_duplicate_or_partial_transcript_rejected(self):
        expected = [{'role': 'user', 'content': PROMPT}, {'role': 'assistant', 'content': RESPONSE}]
        self.assertEqual(transcript([{'role': 'system', 'content': 'fixture system'}, *expected]), expected)
        for messages in (expected + expected, expected[:1], [{**expected[1], 'tool_calls': [{'id': 'unexpected'}]}],
                         [{'role': 'tool', 'content': RESPONSE}]):
            with self.assertRaises(RuntimeError):
                transcript(messages)

    def test_live_api_proof_requires_preinstalled_owner_and_post_request_generation(self):
        app = {'pid': 10}
        node = {'pid': 20, 'parent': 10, 'uid': 501, 'start_seconds': 100, 'start_microseconds': 1,
                'executable': '/owned/NAC.app/Contents/Resources/nac-web', 'kind': 'engine', 'serving': True}
        witness = SimpleNamespace(condition=threading.Condition(), ready=True, failure=None, app=app, latest=[node])
        audit = LiveAudit(witness, {'scenario': 'onboarding', 'engine_identity': {}}, None)
        with patch('ci_startup_audit.owned_listener', side_effect=['http://127.0.0.1:4321', OSError()]), \
                patch('ci_startup_audit.require_readiness', return_value={}), \
                patch('ci_startup_audit.entry_assets', return_value={'scope': 'synthetic assets'}), \
                patch('ci_startup_audit.request', side_effect=[{}, {'projects': []}, []]):
            with self.assertRaises(OSError):
                audit.sample()
        self.assertIsNone(audit.proof)
        witness.latest = [{**node, 'parent': 999}]
        with patch('ci_startup_audit.owned_listener') as query, self.assertRaises(RuntimeError):
            audit.sample()
        query.assert_not_called()

    def test_served_entry_assets_are_compared_as_bytes_without_exporting_content(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            dist = root / 'crates/nac-server/assets/dist'
            (dist / 'assets').mkdir(parents=True)
            index = b'<script type="module" src="/assets/entry.js"></script>'
            script = b'// synthetic entry asset'
            (dist / 'index.html').write_bytes(index)
            (dist / 'assets/entry.js').write_bytes(script)
            opener = MagicMock()
            opener.open.return_value.__enter__.return_value.read.side_effect = [index, script]
            with patch('ci_startup_audit.urllib.request.build_opener', return_value=opener):
                receipt = entry_assets('http://127.0.0.1:4321', root)
            self.assertEqual([row['path'] for row in receipt['observations']], ['/', '/assets/entry.js'])
            self.assertNotIn('synthetic entry asset', str(receipt))
            opener.open.return_value.__enter__.return_value.read.side_effect = [index, b'foreign bytes']
            with patch('ci_startup_audit.urllib.request.build_opener', return_value=opener), self.assertRaises(RuntimeError):
                entry_assets('http://127.0.0.1:4321', root)


if __name__ == '__main__':
    unittest.main()
