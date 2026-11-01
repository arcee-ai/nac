"""Synthetic export bytes only: no valid PNG, decoder, native or OCR evidence."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import ci_lifecycle_evidence as e
from ci_lifecycle_contract import CASES, FRAMES


def roster(raw, cases=CASES, size=32):
    result = []
    for case in cases:
        folder = raw / 'lifecycle' / case / case
        folder.mkdir(parents=True, exist_ok=True)
        for frame in FRAMES:
            path = folder / frame
            path.write_bytes(b'SYNTHETIC EXPORT BYTES'.ljust(size, b'x'))
            result.append(path)
    return result


class CapacityControls(unittest.TestCase):
    def test_declared_capacity_reconciles_exact_finite_roster_before_admission(self):
        declared = e.capacity()
        self.assertEqual(len(set(declared['PNG_paths'])), 15)
        self.assertEqual(declared['PNG_each'], 2097152)
        self.assertEqual(declared['PNG_total'], 31457280)
        self.assertEqual(declared['non_image_exported_payload'], 12320768)
        self.assertEqual(declared['index'], 262144)
        self.assertEqual(declared['total'], 44040192)
        for key in ('PNG_TOTAL', 'NON_IMAGE_TOTAL', 'INDEX_MAX', 'EXPORT_TOTAL', 'FINAL_METADATA_BYTES'):
            with self.subTest(key=key), mock.patch.object(e, key, getattr(e, key) + 1), \
                    self.assertRaises(RuntimeError):
                e.capacity()

    def test_fifteen_ceiling_images_and_full_actual_non_image_payload_export_original_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw, output = Path(tmp).resolve() / 'raw', Path(tmp).resolve() / 'export'
            raw.mkdir()
            pngs = roster(raw, size=e.PNG_MAX)
            ledger = raw / 'lifecycle/ledger.json'
            ledger.write_text('{"phase":"complete"}')
            # Quotes exercise actual JSON part-wrapper expansion. Secret crosses
            # the normal part boundary; redaction must precede that splitting.
            original = json.dumps({'value': '"' * 150000 + 'SECRET' + 'z' * 150000}).encode()
            (raw / 'critical.json').write_bytes(original)
            replacements = [('SECRET', '<redacted>')]
            plan, _ = e.export_plan(raw, replacements, final=True)
            charged = sum(len(data) for path, data in plan if path.suffix != '.png')
            remaining = e.NON_IMAGE_TOTAL - e.FINAL_METADATA_BYTES - charged
            for i in range((remaining + e.MAX_FILE - 1) // e.MAX_FILE):
                amount = min(e.MAX_FILE, remaining)
                (raw / ('bounded-' + str(i) + '.log')).write_bytes(b'x' * amount)
                remaining -= amount
            self.assertEqual(remaining, 0)
            e.export_plan(raw, replacements, final=True, reserve=e.FINAL_METADATA_BYTES)
            # Final metadata consumes its reserved bytes inside the same cap.
            (raw / 'final-metadata.log').write_bytes(b'x' * e.FINAL_METADATA_BYTES)
            with self.assertRaises(RuntimeError):
                e.export_plan(raw, replacements, final=True, reserve=1)
            plan, index = e.export_plan(raw, replacements, final=True)
            self.assertEqual(sum(len(data) for path, data in plan if path.suffix == '.png'), e.PNG_TOTAL)
            self.assertEqual(sum(len(data) for path, data in plan if path.suffix != '.png'), e.NON_IMAGE_TOTAL)
            self.assertLessEqual(sum(len(data) for _, data in plan) + len(index), e.EXPORT_TOTAL)
            e.export_evidence(raw, output, replacements)
            for path in pngs:
                self.assertEqual(path.read_bytes(), (output / path.relative_to(raw)).read_bytes())
            row = next(x for x in json.loads(index) if x['file'] == 'critical.json')
            joined = ''.join(json.loads((output / part['file']).read_text())['text'] for part in row['parts']).encode()
            self.assertEqual(joined, original.replace(b'SECRET', b'<redacted>'))
            self.assertEqual(hashlib.sha256(joined).hexdigest(), row['exported_sha256'])
            (raw / 'one-too-many.log').write_bytes(b'x')
            with self.assertRaises(RuntimeError):
                e.export_plan(raw, replacements, final=True)

    def test_per_PNG_limit_plus_one_rejects_an_otherwise_expected_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp).resolve()
            paths = roster(raw, CASES[:1], e.PNG_MAX)
            e.export_plan(raw, [], completed=CASES[:1])
            with paths[0].open('ab') as stream:
                stream.write(b'x')
            with self.assertRaisesRegex(RuntimeError, 'critical receipt'):
                e.export_plan(raw, [], completed=CASES[:1])

    def test_each_kind_and_total_exact_limit_and_limit_plus_one(self):
        e._budget(e.PNG_TOTAL, e.NON_IMAGE_TOTAL, e.INDEX_MAX)
        for values in ((e.PNG_TOTAL + 1, 0, 0), (0, e.NON_IMAGE_TOTAL + 1, 0),
                       (0, 0, e.INDEX_MAX + 1)):
            with self.subTest(values=values), self.assertRaises(RuntimeError):
                e._budget(*values)
        with mock.patch.object(e, 'EXPORT_TOTAL', e.EXPORT_TOTAL - 1), self.assertRaisesRegex(RuntimeError, 'total'):
            e._budget(e.PNG_TOTAL, e.NON_IMAGE_TOTAL, e.INDEX_MAX)
        e._budget(0, e.NON_IMAGE_TOTAL - e.FINAL_METADATA_BYTES, e.INDEX_MAX, e.FINAL_METADATA_BYTES)
        with self.assertRaises(RuntimeError):
            e._budget(0, e.NON_IMAGE_TOTAL - e.FINAL_METADATA_BYTES + 1, 0, e.FINAL_METADATA_BYTES)

    def test_actual_serialized_index_limit_and_limit_plus_one(self):
        overhead = len((json.dumps([{'file': ''}], indent=2) + '\n').encode())
        manifest = [{'file': 'x' * (e.INDEX_MAX - overhead)}]
        self.assertEqual(len(e._index(manifest, 0, 0, 0)), e.INDEX_MAX)
        manifest[0]['file'] += 'x'
        with self.assertRaisesRegex(RuntimeError, 'index'):
            e._index(manifest, 0, 0, 0)

    def test_raw_critical_JSON_limit_is_preserved_before_redaction(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp).resolve()
            path = raw / 'critical.json'
            path.write_bytes(b'{"v":"' + b'x' * (e.MAX_TOTAL - 8) + b'"}')
            self.assertEqual(path.stat().st_size, e.MAX_TOTAL)
            replacements = [('x' * 1024, '')]
            e.export_plan(raw, replacements)
            with path.open('ab') as stream:
                stream.write(b' ')
            with self.assertRaisesRegex(RuntimeError, 'critical receipt'):
                e.export_plan(raw, replacements)

    def test_actual_redacted_and_split_wrapper_bytes_consume_non_image_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp).resolve()
            (raw / 'critical.json').write_text(json.dumps({'value': '"' * 180000}))
            plan, _ = e.export_plan(raw, [])
            actual = sum(len(data) for _, data in plan)
            self.assertGreater(actual, (raw / 'critical.json').stat().st_size)
            with mock.patch.object(e, 'NON_IMAGE_TOTAL', actual):
                e.export_plan(raw, [])
            with mock.patch.object(e, 'NON_IMAGE_TOTAL', actual - 1), self.assertRaises(RuntimeError):
                e.export_plan(raw, [])

    def test_post_redaction_log_limit_and_existing_explicit_log_truncation(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp).resolve()
            path = raw / 'runner.log'
            path.write_bytes(b'a' * (e.MAX_FILE // 2))
            plan, _ = e.export_plan(raw, [('a', 'bb')])
            self.assertEqual(len(plan[0][1]), e.MAX_FILE)
            with path.open('ab') as stream:
                stream.write(b'a')
            with self.assertRaisesRegex(RuntimeError, 'redacted log'):
                e.export_plan(raw, [('a', 'bb')])
            path.write_bytes(b'x' * (e.MAX_FILE + 1))
            plan, index = e.export_plan(raw, [])
            self.assertEqual(len(plan[0][1]), e.MAX_FILE)
            self.assertTrue(json.loads(index)[0]['truncated'])

    def test_completed_prefixes_and_final_missing_unknown_duplicate_rosters(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp).resolve()
            e.export_plan(raw, [], completed=())
            paths = roster(raw, CASES[:1])
            e.export_plan(raw, [], completed=CASES[:1])
            with self.assertRaises(RuntimeError):
                e.export_plan(raw, [], final=True)
            for completed in (('run', 'run'), ('approval',), ('approval', 'run')):
                with self.subTest(completed=completed), self.assertRaises(RuntimeError):
                    e.export_plan(raw, [], completed=completed)
            paths[0].unlink()
            with self.assertRaises(RuntimeError):
                e.export_plan(raw, [], completed=CASES[:1])
            paths[0].write_bytes(b'SYNTHETIC')
            for relative in ('lifecycle/unknown/unknown/work-ready-workspace.png',
                             'lifecycle/run/run/extra.png', 'lifecycle/run/run/extra.PNG',
                             'lifecycle/run/copy/work-ready-workspace.png'):
                extra = raw / relative
                extra.parent.mkdir(parents=True, exist_ok=True)
                extra.write_bytes(b'SYNTHETIC')
                with self.subTest(relative=relative), self.assertRaises(RuntimeError):
                    e.export_plan(raw, [])
                extra.unlink()
            roster(raw, CASES[1:2])
            e.export_plan(raw, [], completed=CASES[:2])
            roster(raw, CASES[2:])
            e.export_plan(raw, [], completed=CASES, final=True)

    def test_final_ledger_requires_all_images_and_retains_explicit_failure_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw, output = Path(tmp).resolve() / 'raw', Path(tmp).resolve() / 'export'
            raw.mkdir()
            roster(raw, CASES[:1])
            ledger = raw / 'lifecycle/ledger.json'
            ledger.write_text('{"phase":"complete"}')
            with self.assertRaises(RuntimeError):
                e.export_evidence(raw, output, [])
            self.assertFalse(json.loads((output / 'export-error.json').read_text())['critical_evidence_complete'])
            self.assertTrue((output / 'lifecycle/ledger.json').is_file())


if __name__ == '__main__':
    unittest.main()
