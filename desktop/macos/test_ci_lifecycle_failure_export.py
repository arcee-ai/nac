"""Failure artifact controls with synthetic bytes; no PNG/native/OCR execution."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import ci_lifecycle_evidence as e
from ci_lifecycle_contract import CASES, FRAMES


def seed(raw, attempted=('run',), count=1, phase='stopped_unknown'):
    (raw / 'lifecycle').mkdir(parents=True)
    cases = {case: {'state': 'not_dispatched', 'dispatches': 0} for case in CASES}
    for i, case in enumerate(attempted):
        cases[case] = {'state': 'passed' if i < len(attempted) - 1 else 'unknown', 'dispatches': 1}
        destination = raw / 'lifecycle' / case
        folder = destination / case
        folder.mkdir(parents=True)
        frames = FRAMES if i < len(attempted) - 1 else FRAMES[:count]
        for frame in frames:
            (folder / frame).write_bytes(b'SYNTHETIC ORIGINAL EXPORT BYTES; NOT VALID PNG')
        passed = i < len(attempted) - 1
        (destination / 'summary.json').write_text(json.dumps({'passed': passed, 'error': 'FIXTURE-SECRET'}))
        (folder / 'native.json').write_text(json.dumps({'passed': passed,
            'diagnostic': '"' * 180000 + 'FIXTURE-SECRET' + 'z' * 180000}))
        (destination / 'runner.log').write_text('owned driver failed FIXTURE-SECRET; MOCK ONLY\n')
    (raw / 'lifecycle/ledger.json').write_text(json.dumps({'phase': phase, 'cases': cases}))
    (raw / 'ci-report.json').write_text('{"result":"failed"}')


class FailureExportControls(unittest.TestCase):
    def retained(self, attempted, phase='stopped_unknown', count=1):
        with tempfile.TemporaryDirectory() as tmp:
            raw, output = Path(tmp).resolve() / 'raw', Path(tmp).resolve() / 'export'
            seed(raw, attempted, count, phase)
            e.export_evidence(raw, output, [('FIXTURE-SECRET', '<redacted>')])
            index = json.loads((output / 'export.json').read_text())
            byname = {row['file']: row for row in index}
            status = json.loads((output / 'failure-evidence.json').read_text())
            self.assertEqual(status['result'], 'failed_or_unknown')
            self.assertFalse(status['native_acceptance'])
            self.assertTrue(status['incomplete'])
            self.assertFalse(status['capture_roster_complete'])
            self.assertEqual(status['attempted_cases'], list(attempted))
            self.assertEqual(len(status['available_pngs']), 5 * (len(attempted) - 1) + count)
            self.assertEqual(len(status['missing_pngs']), 5 - count)
            for source in raw.rglob('*'):
                if not source.is_file():
                    continue
                relative = str(source.relative_to(raw))
                row = byname[relative]
                self.assertFalse(row['truncated'])
                original = source.read_bytes()
                self.assertEqual(row['raw_source_sha256'], hashlib.sha256(original).hexdigest())
                if 'parts' in row:
                    data = ''.join(json.loads((output / part['file']).read_text())['text'] for part in row['parts']).encode()
                else:
                    data = (output / relative).read_bytes()
                expected = original if source.suffix == '.png' else original.replace(b'FIXTURE-SECRET', b'<redacted>')
                self.assertEqual(data, expected)
                self.assertEqual(hashlib.sha256(data).hexdigest(), row['exported_sha256'])
            for case in attempted:
                self.assertIn('lifecycle/' + case + '/' + case + '/native.json', byname)
                self.assertEqual(json.loads((output / 'lifecycle' / case / 'summary.json').read_text())['passed'],
                                 case != attempted[-1])
            self.assertFalse((output / 'export-error.json').exists())

    def test_first_partial_run_preserves_originals_complete_redacted_receipts_and_failure_status(self):
        self.retained(('run',), phase='stopped_failed')

    def test_complete_run_prefix_and_partial_approval_all_survive_unknown_export(self):
        self.retained(('run', 'approval'))

    def test_failed_before_first_capture_still_retains_detailed_JSON_and_logs(self):
        self.retained(('run',), count=0)

    def test_identical_partial_roster_cannot_satisfy_success_or_nonfailure_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp).resolve() / 'raw'
            seed(raw)
            for kwargs in ({}, {'completed': ('run',)}, {'final': True},
                           {'final': True, 'failed_cases': ('run',)},
                           {'completed': ('run',), 'failed_cases': ('run',)}):
                with self.subTest(kwargs=kwargs), self.assertRaises(RuntimeError):
                    e.export_plan(raw, [], **kwargs)
            ledger = raw / 'lifecycle/ledger.json'
            state = json.loads(ledger.read_text())
            state['phase'] = 'complete'
            ledger.write_text(json.dumps(state))
            output = raw.parent / 'rejected-success'
            with self.assertRaises(RuntimeError):
                e.export_evidence(raw, output, [])
            self.assertFalse(json.loads((output / 'export-error.json').read_text())['critical_evidence_complete'])
            reader = mock.Mock()
            with self.assertRaises(RuntimeError):
                e.images(raw / 'lifecycle/run', 'run', Path('UNUSED'), reader, raw)
            reader.assert_not_called()

    def test_partial_failure_still_rejects_unknown_unallocated_symlink_and_oversize_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp).resolve() / 'raw'
            seed(raw)
            for name in ('lifecycle/run/run/extra.png', 'lifecycle/terminal/terminal/' + FRAMES[0]):
                extra = raw / name
                extra.parent.mkdir(parents=True, exist_ok=True)
                extra.write_bytes(b'SYNTHETIC')
                with self.subTest(name=name), self.assertRaises(RuntimeError):
                    e.export_plan(raw, [], failed_cases=('run',))
                extra.unlink()
            image = raw / 'lifecycle/run/run' / FRAMES[0]
            original = image.read_bytes()
            alias = image.with_name(FRAMES[1])
            alias.symlink_to(image)
            with self.assertRaises(RuntimeError):
                e.export_plan(raw, [], failed_cases=('run',))
            alias.unlink()
            image.write_bytes(b'x' * (e.PNG_MAX + 1))
            with self.assertRaises(RuntimeError):
                e.export_plan(raw, [], failed_cases=('run',))
            image.write_bytes(original)
            oversized = raw / 'too-large.json'
            oversized.write_bytes(b'x' * (e.MAX_TOTAL + 1))
            with self.assertRaises(RuntimeError):
                e.export_plan(raw, [], failed_cases=('run',))

    def test_generated_failure_status_is_hashed_and_charged_inside_existing_caps(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp).resolve() / 'raw'
            seed(raw)
            plan, index = e.export_plan(raw, [], failed_cases=('run',))
            row = next(x for x in json.loads(index) if x['file'] == 'failure-evidence.json')
            data = next(data for name, data in plan if str(name) == row['file'])
            self.assertTrue(row['generated'])
            self.assertFalse(row['truncated'])
            self.assertEqual(row['exported_sha256'], hashlib.sha256(data).hexdigest())
            charged = sum(len(data) for name, data in plan if name.suffix != '.png')
            with mock.patch.object(e, 'NON_IMAGE_TOTAL', charged):
                e.export_plan(raw, [], failed_cases=('run',))
            with mock.patch.object(e, 'NON_IMAGE_TOTAL', charged - 1), self.assertRaises(RuntimeError):
                e.export_plan(raw, [], failed_cases=('run',))
            (raw / 'failure-evidence.json').write_text('{"source":"cannot replace generated status"}')
            with self.assertRaisesRegex(RuntimeError, 'collides'):
                e.export_plan(raw, [], failed_cases=('run',))


if __name__ == '__main__':
    unittest.main()
