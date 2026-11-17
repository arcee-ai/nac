"""Portable failure controls for the actual-app evidence runner."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parent))
from ci import Lane, LIMIT, require_verdict, sanitized, source_identity, summary


class EvidenceTests(unittest.TestCase):
    def test_export_excludes_attachment_bytes_and_bounds_error_details(self):
        document = dict(suites=[dict(title='fixture', specs=[dict(file='smoke.spec.ts', line=1,
            title='scenario', tests=[dict(expectedStatus='passed', status='unexpected',
                attachments=[dict(body='secret-base64')], results=[dict(status='failed', duration=12,
                    attachments=[dict(body='secret-base64')], errors=[dict(message='x' * 9000)])])])])])
        record = summary(document)[0]
        self.assertNotIn('secret-base64', json.dumps(record))
        self.assertEqual(record['results'][0]['status'], 'failed')
        self.assertEqual(len(record['results'][0]['errors'][0]), 4000)
        with self.assertRaisesRegex(RuntimeError, 'missing'):
            summary(dict(suites=[]))

    def test_exact_value_redaction_precedes_path_fallback(self):
        private = '/private/tmp/nac-fixture'
        exported = sanitized(private + '/store.db /Users/person/file token-value',
                             [(private, '<fixture>'), ('token-value', '<redacted>')])
        self.assertEqual(exported, '<fixture>/store.db <home>/file <redacted>')

    def test_command_failure_remains_failure_and_logs_are_bounded(self):
        with tempfile.TemporaryDirectory() as temporary:
            lane = Lane(Path(temporary) / 'export', 'a' * 40)
            # No external process inventory or real application is involved.
            with self.assertRaisesRegex(RuntimeError, 'failed'):
                lane.run('negative', [sys.executable, '-c',
                         'import sys; print("x" * 400000); sys.exit(7)'], 5)
            self.assertEqual(lane.report['phases'][0]['code'], 7)
            self.assertLessEqual((lane.output / 'negative.log').stat().st_size, LIMIT)
            self.assertNotIn('NAC_ELECTRON_ENGINE', lane.env)
            self.assertNotIn('RUSTFLAGS', lane.env)
            self.assertNotIn('CARGO_PROFILE_RELEASE_OPT_LEVEL', lane.env)
            import shutil
            shutil.rmtree(lane.raw)

    def test_source_selector_rejects_aliases(self):
        for invalid in ('dev', 'HEAD', 'a' * 39, 'A' * 40, '../source'):
            with self.assertRaisesRegex(RuntimeError, 'immutable'):
                source_identity(invalid)

    def test_pass_requires_scenarios_and_positive_cleanup_without_skips(self):
        passed = [dict(status='expected', results=[dict(status='passed')])]
        settled = [dict(settled=True)]
        require_verdict(passed, settled, [])
        for scenarios, records, remaining in (
                (None, settled, []), ([], settled, []),
                ([dict(status='expected', results=[])], settled, []),
                ([dict(status='skipped', results=[dict(status='skipped')])], settled, []),
                ([dict(status='unexpected', results=[dict(status='failed')])], settled, []),
                (passed, [], []), (passed, [dict(settled=False)], []),
                (passed, settled, [123])):
            with self.assertRaises(RuntimeError):
                require_verdict(scenarios, records, remaining)


if __name__ == '__main__':
    unittest.main()
