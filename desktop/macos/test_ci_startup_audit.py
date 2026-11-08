"""Canonical API fixtures only; no product process, app or UI execution."""
import threading
import hashlib
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from ci_startup_audit import (EntryAssets, LiveAudit, PROMPT, RESPONSE, entry_asset_source, entry_assets,
                              persisted_audit, session_facts, transcript)

# Exact immutable P d443a2ac index bytes, test data only. Mock asset bodies below
# do not replace product build inputs or imply native asset/runtime acceptance.
PRODUCT_INDEX = b'''<!doctype html>
<html lang="en" class="dark" data-theme="dark" style="color-scheme: dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <!-- Referenced from `src/` rather than a `public/` copy: the embedded server
         serves only `/assets/*`, so an icon at the dist root would 404. -->
    <link rel="icon" type="image/svg+xml" href="/assets/dist/assets/favicon-BxL16L46.svg" />
    <title>NAC</title>
    <script type="module" crossorigin src="/assets/dist/assets/index-B-oYdGsr.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/dist/assets/rolldown-runtime-XKyaHtl9.js">
    <link rel="stylesheet" crossorigin href="/assets/dist/assets/index-C-d7co9y.css">
  </head>
  <body>
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <div id="root"></div>
  </body>
</html>
'''


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
            index = PRODUCT_INDEX
            self.assertEqual(hashlib.sha256(index).hexdigest(), '39adfd7b80001221964d37c3cbec7a21b3747dc3f9c42b6894b3d1bf3d0de8ce')
            parser = EntryAssets()
            parser.feed(index.decode())
            self.assertEqual(len(parser.paths), 4)
            bodies = {path: ('synthetic body for ' + path).encode() for path in parser.paths}
            (dist / 'index.html').write_bytes(index)
            for path, data in bodies.items():
                (dist / path.removeprefix('/assets/dist/')).write_bytes(data)
            opener = MagicMock()
            opener.open.return_value.__enter__.return_value.read.side_effect = [index, *[bodies[path] for path in sorted(bodies)]]
            with patch('ci_startup_audit.urllib.request.build_opener', return_value=opener):
                receipt = entry_assets('http://127.0.0.1:4321', root)
            self.assertEqual([row['path'] for row in receipt['observations']], ['/', *sorted(bodies)])
            self.assertNotIn('synthetic body', str(receipt))
            opener.open.return_value.__enter__.return_value.read.side_effect = [index, b'foreign bytes']
            with patch('ci_startup_audit.urllib.request.build_opener', return_value=opener), self.assertRaises(RuntimeError):
                entry_assets('http://127.0.0.1:4321', root)

    def test_entry_mapping_rejects_foreign_absolute_escaped_traversal_and_symlink_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            dist = Path(temporary).resolve() / 'dist'
            (dist / 'assets').mkdir(parents=True)
            outside = dist.parent / 'outside.js'
            outside.write_bytes(b'outside must never be fetched')
            (dist / 'assets/alias.js').symlink_to(outside)
            for path in ('/assets/entry.js', '/foreign/file.js', 'https://example.invalid/entry.js',
                         '//example.invalid/entry.js', '/assets/dist//outside.js', '/assets/dist/../outside.js',
                         '/assets/dist/assets/../../outside.js', '/assets/dist/assets/./entry.js',
                         '/assets/dist/assets/%2e%2e/outside.js', '/assets/dist/assets/entry.js?raw=1',
                         '/assets/dist/assets/entry.js#fragment', '/assets/dist/assets/alias.js',
                         '/assets/dist/\\outside.js', '/assets/dist/assets/\0.js'):
                with self.subTest(path=path), self.assertRaises(RuntimeError):
                    entry_asset_source(dist, path)


if __name__ == '__main__':
    unittest.main()
