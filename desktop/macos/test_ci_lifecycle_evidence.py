"""Portable original-byte/export controls; native image observations are mocked."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import ci_lifecycle_evidence as evidence
from ci_lifecycle_contract import FRAMES


class ExportControls(unittest.TestCase):
    def test_complete_split_JSON_redacts_before_boundaries_and_reconstructs_exactly(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw, output = Path(tmp) / 'raw', Path(tmp) / 'export'
            raw.mkdir()
            secret = 'EXACT-SECRET-ONLY-FIXTURE'
            data = (json.dumps({'critical': 'x' * 260000 + secret + 'y' * 260000}) + '\n').encode()
            (raw / 'summary.json').write_bytes(data)
            (raw / 'store.db').write_bytes(b'NEVER EXPORT DATABASE')
            private = raw / 'nac-lifecycle-app-fixture'
            private.mkdir()
            (private / 'private.json').write_text('{"must":"not export profile"}')
            evidence.export_evidence(raw, output, [(secret, '<redacted>')])
            index = json.loads((output / 'export.json').read_text())
            self.assertEqual(len(index), 1)
            row = index[0]
            self.assertFalse(row['truncated'])
            self.assertEqual(row['raw_source_sha256'], hashlib.sha256(data).hexdigest())
            joined = ''.join(json.loads((output / part['file']).read_text())['text'] for part in row['parts']).encode()
            self.assertEqual(json.loads(joined), json.loads(data.replace(secret.encode(), b'<redacted>')))
            self.assertEqual(hashlib.sha256(joined).hexdigest(), row['exported_sha256'])
            self.assertTrue(all((output / part['file']).stat().st_size <= evidence.MAX_FILE for part in row['parts']))
            self.assertFalse((output / 'summary.json').exists())
            self.assertFalse(any(secret in p.read_text() for p in output.rglob('*.json') if p.is_file()))

    def test_critical_overflow_fails_with_bounded_failure_metadata_not_silent_truncation(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw, output = Path(tmp) / 'raw', Path(tmp) / 'export'
            raw.mkdir()
            (raw / 'ci-report.json').write_text('{"result":"failed"}')
            (raw / 'critical.json').write_bytes(b'x' * 1025)
            with mock.patch.object(evidence, 'MAX_TOTAL', 1024), self.assertRaises(RuntimeError):
                evidence.export_evidence(raw, output, [])
            self.assertFalse(json.loads((output / 'export-error.json').read_text())['critical_evidence_complete'])
            self.assertEqual(json.loads((output / 'ci-report.json').read_text())['result'], 'failed')

    def test_missing_extra_stale_and_unreadable_PNGs_fail_without_native_execution(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp).resolve()
            case = raw / 'run'
            folder = case / 'run'
            folder.mkdir(parents=True)
            reader = mock.Mock(return_value={'role': 'workspace', 'readable': True,
                'composited_paint_acceptance': False, 'trusted_input_acceptance': False})
            with self.assertRaises(RuntimeError):
                evidence.images(case, 'run', Path('MOCK-READER'), reader, raw)
            for name in FRAMES:
                (folder / name).write_bytes(b'FAKE PNG; helper is MOCKED, not runtime')
            def inspect(argv, _log):
                return {'role': argv[1], 'readable': True,
                        'composited_paint_acceptance': False, 'trusted_input_acceptance': False}
            values = evidence.images(case, 'run', Path('MOCK-READER'), inspect, raw)
            self.assertEqual(len(values), 5)
            self.assertEqual({x['file'] for x in values}, {str((folder / n).relative_to(raw)) for n in FRAMES})
            (folder / 'extra.png').write_bytes(b'extra')
            with self.assertRaises(RuntimeError):
                evidence.images(case, 'run', Path('MOCK-READER'), inspect, raw)
            (folder / 'extra.png').unlink()
            def changed(argv, log):
                Path(argv[-1]).write_bytes(b'changed after hash before mock decoding')
                return inspect(argv, log)
            with self.assertRaisesRegex(RuntimeError, 'changed across'):
                evidence.images(case, 'run', Path('MOCK-READER'), changed, raw)
            with self.assertRaises(RuntimeError):
                evidence.images(case, 'run', Path('MOCK-READER'), lambda *_: {'readable': False}, raw)
            (folder / FRAMES[0]).unlink()
            (folder / FRAMES[0]).symlink_to(folder / FRAMES[1])
            with self.assertRaises(RuntimeError):
                evidence.images(case, 'run', Path('MOCK-READER'), inspect, raw)


if __name__ == '__main__':
    unittest.main()
