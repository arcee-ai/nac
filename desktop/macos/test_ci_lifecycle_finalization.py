"""Actual tail serializers with synthetic bytes; no native/PNG/OCR execution."""
import json
from pathlib import Path
import tempfile
import unittest

import ci_lifecycle_contract as c
import ci_lifecycle_evidence as e
import ci_lifecycle_finalization as f
from test_ci_lifecycle_contract import capsule, reservation


class FinalizationControls(unittest.TestCase):
    def tree(self, raw):
        raw.mkdir()
        control = raw / 'lifecycle'
        control.mkdir()
        ledger = c.Ledger(control, capsule(), '123')
        outcomes = []
        for case in c.CASES:
            destination = control / case
            ledger.reserve(case, destination, {'observed': True, 'locked': False}, reservation(case, destination))
            folder = destination / case
            folder.mkdir()
            for frame in c.FRAMES:
                (folder / frame).write_bytes(b'SYNTHETIC EXPORT ONLY; NOT VALID PNG/NATIVE/OCR')
            outcome = {'case': case, 'status': 'passed', 'diagnostic': 'FIXTURE-SECRET'}
            c.persist(destination / 'external-result.json', outcome)
            f.result_guard(raw, destination / 'external-result.json', [])
            outcomes.append(outcome)
            if case != c.CASES[-1]:
                ledger.finish(case, 'passed', {'sha256': c.digest(destination / 'external-result.json')},
                              before_save=lambda value: f.ledger_guard(value, []))
        return ledger, {'result': 'passed', 'lifecycle_cases': outcomes,
                        'quartz_end': {'available': True}, 'unicode': '🙂' * 5, 'secret': 'FIXTURE-SECRET'}

    def fill(self, raw, replacements):
        plan, _ = e.export_plan(raw, replacements, completed=c.CASES, final=True,
                                reserve=e.FINAL_METADATA_BYTES)
        remaining = e.NON_IMAGE_TOTAL - e.FINAL_METADATA_BYTES - sum(
            len(data) for name, data in plan if name.suffix != '.png')
        for i in range((remaining + e.MAX_FILE - 1) // e.MAX_FILE):
            count = min(remaining, e.MAX_FILE)
            (raw / ('prior-' + str(i) + '.log')).write_bytes(b'x' * count)
            remaining -= count
        self.assertEqual(remaining, 0)
        e.export_plan(raw, replacements, completed=c.CASES, final=True, reserve=e.FINAL_METADATA_BYTES)

    def finish_ledger(self, ledger, replacements):
        ledger.finish('terminal', 'passed', {'sha256': 'x' * 64},
                      before_save=lambda value: f.ledger_guard(value, replacements))
        ledger.value['phase'] = 'complete'
        ledger.save()
        ledger.close()

    def report_at(self, report, target, replacements):
        def cost(size):
            value = dict(report, padding='x' * size)
            chunks, _, _ = e.payload(Path('ci-report.json'), f.serialized(value), replacements)
            return sum(len(data) for _, data in chunks)
        lo, hi = 0, target
        while lo < hi:
            mid = (lo + hi) // 2
            if cost(mid) < target:
                lo = mid + 1
            else:
                hi = mid
        self.assertEqual(cost(lo), target)
        return dict(report, padding='x' * lo)

    def actual_crashes(self, folder):
        folder.mkdir()
        for i in range(3):
            data = b'\xff' * 40000 + b' FIXTURE-SECRET ' + b'c' * 40000
            (folder / ('NACPreview-' + str(i) + '.ips')).write_bytes(data)
        (folder / 'NACPreview-alias.ips').symlink_to(folder / 'NACPreview-0.ips')

    def assert_originals(self, raw, output):
        index = json.loads((output / 'export.json').read_text())
        for image in raw.rglob('*.png'):
            self.assertEqual(image.read_bytes(), (output / image.relative_to(raw)).read_bytes())
        self.assertEqual(len(list(output.rglob('*.png'))), 15)
        for row in index:
            if 'parts' in row:
                self.assertTrue(all((output / part['file']).stat().st_size <= e.MAX_FILE for part in row['parts']))
        self.assertLessEqual((output / 'export.json').stat().st_size, e.INDEX_MAX)
        self.assertLessEqual(sum(path.stat().st_size for path in output.rglob('*') if path.is_file()), e.EXPORT_TOTAL)

    def test_actual_final_tail_report_limit_and_limit_plus_one_preserve_all_originals(self):
        replacements = [('FIXTURE-SECRET', '<redacted>')]
        for extra in (0, 1):
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp).resolve()
                raw, output, crashes = root / 'raw', root / 'export', root / 'crashes'
                output.mkdir()  # ci.py's actual initially empty destination.
                ledger, report = self.tree(raw)
                self.fill(raw, replacements)
                self.finish_ledger(ledger, replacements)
                # A legal65536-character stderr can occupy256KiB of UTF8.
                (raw / 'gui-reader-end.log').write_bytes(('🙂' * 65536).encode())
                self.actual_crashes(crashes)
                # Include actual collector metadata before finding the report
                # boundary; finalize uses exactly the same three inputs again.
                report['crash_snippets'] = f.collect_crashes(raw, crashes, 0)
                report['crash_reports'] = len(report['crash_snippets'])
                report = self.report_at(report, e.FINAL_TAIL_LIMITS['report'] + extra, replacements)
                if extra:
                    with self.assertRaisesRegex(RuntimeError, 'producer exceeds'):
                        f.finalize(raw, output, report, replacements, crashes=crashes, started=0)
                else:
                    f.finalize(raw, output, report, replacements, crashes=crashes, started=0)
                self.assert_originals(raw, output)
                final = json.loads((output / 'finalization.json').read_text())
                self.assertEqual(final['export_capacity_validated'], not extra)
                self.assertEqual(json.loads((raw / 'ci-report.json').read_text())['result'], 'failed' if extra else 'passed')
                self.assertEqual(report['result'], 'failed' if extra else 'passed')
                if not extra:
                    self.assertEqual(final['actual_tail']['ci-report.json']['exported_bytes'], e.FINAL_TAIL_LIMITS['report'])
                    self.assertEqual(len(report['crash_snippets']), 3)
                    self.assertTrue(all(row['truncated'] for row in report['crash_snippets']))
                    self.assertTrue(all((output / ('crash-' + str(i) + '.log')).stat().st_size > 65536 for i in range(3)))

    def test_zero_case_pre_admission_exact_budget_and_one_byte_more(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp).resolve()
            (raw / 'lifecycle').mkdir()
            ledger = c.Ledger(raw / 'lifecycle', capsule(), '123')
            try:
                e.capacity()
                f.prepare({'result': 'failed'}, {}, [])
                plan, _ = e.export_plan(raw, [], completed=(), reserve=e.FINAL_METADATA_BYTES)
                remaining = e.NON_IMAGE_TOTAL - e.FINAL_METADATA_BYTES - sum(len(data) for _, data in plan)
                for i in range((remaining + e.MAX_FILE - 1) // e.MAX_FILE):
                    count = min(remaining, e.MAX_FILE)
                    (raw / ('preflight-' + str(i) + '.log')).write_bytes(b'x' * count)
                    remaining -= count
                e.export_plan(raw, [], completed=(), reserve=e.FINAL_METADATA_BYTES)
                (raw / 'one-extra.log').write_bytes(b'x')
                with self.assertRaises(RuntimeError):
                    e.export_plan(raw, [], completed=(), reserve=e.FINAL_METADATA_BYTES)
                self.assertEqual([row['dispatches'] for row in ledger.value['cases'].values()], [0, 0, 0])
            finally:
                ledger.close()

    def test_GUI_UTF8_raw_limit_plus_one_never_exports_a_passing_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            raw, output = root / 'raw', root / 'output'
            ledger, report = self.tree(raw)
            self.finish_ledger(ledger, [])
            (raw / 'gui-reader-end.log').write_bytes(('🙂' * 65536).encode() + b'x')
            with self.assertRaisesRegex(RuntimeError, 'raw file bound'):
                f.finalize(raw, output, report, [])
            self.assert_originals(raw, output)
            self.assertEqual(report['result'], 'failed')
            self.assertEqual(json.loads((output / 'ci-report.json').read_text())['result'], 'failed')

    def test_known_report_and_GUI_protocol_bounds_reject_before_success(self):
        f.prepare({'result': 'failed'}, {}, [])
        with self.assertRaisesRegex(RuntimeError, 'producer exceeds'):
            f.prepare({'oversize': 'x' * f.REPORT_BASE_LIMIT}, {}, [])
        f.gui_guard({'available': True}, [])
        with self.assertRaises(RuntimeError):
            f.gui_guard({'oversize': 'x' * f.GUI_VALUE_LIMIT}, [])

    def test_final_report_and_crash_redaction_and_split_wrappers_are_actual_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            raw, output = root / 'raw', root / 'output'
            ledger, report = self.tree(raw)
            self.finish_ledger(ledger, [])
            report['quoted'] = '"' * 180000 + 'FIXTURE-SECRET'
            (raw / 'gui-reader-end.log').write_text('UTF8🙂 FIXTURE-SECRET')
            crashes = root / 'crashes'
            self.actual_crashes(crashes)
            f.finalize(raw, output, report, [('FIXTURE-SECRET', '<redacted>')], crashes=crashes, started=0)
            rows = json.loads((output / 'export.json').read_text())
            row = next(x for x in rows if x['file'] == 'ci-report.json')
            self.assertIn('parts', row)
            joined = ''.join(json.loads((output / part['file']).read_text())['text'] for part in row['parts']).encode()
            self.assertEqual(joined, (raw / 'ci-report.json').read_bytes().replace(b'FIXTURE-SECRET', b'<redacted>'))
            final = json.loads((output / 'finalization.json').read_text())
            self.assertEqual(final['actual_tail']['ci-report.json']['exported_bytes'],
                             sum(part['bytes'] for part in row['parts']))
            self.assertNotIn('FIXTURE-SECRET', (output / 'gui-reader-end.log').read_text())
            self.assertNotIn('FIXTURE-SECRET', (output / 'crash-0.log').read_text())

    def test_invalid_ledger_still_publishes_bounded_failed_metadata_without_broadening(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            raw, output = root / 'raw', root / 'output'
            (raw / 'lifecycle').mkdir(parents=True)
            cases = {case: {'state': 'not_dispatched', 'dispatches': 0} for case in c.CASES}
            cases['run'] = {'state': 'dispatched', 'dispatches': True}
            path = raw / 'lifecycle/ledger.json'
            path.write_text(json.dumps({'phase': 'case_dispatched', 'active_case': 'run', 'cases': cases}))
            before = path.read_bytes()
            report = {'result': 'passed'}
            with self.assertRaises(RuntimeError):
                f.finalize(raw, output, report, [])
            self.assertEqual(path.read_bytes(), before)
            self.assertFalse(json.loads((output / 'export-error.json').read_text())['critical_evidence_complete'])
            self.assertEqual(json.loads((output / 'ci-report.json').read_text())['result'], 'failed')
            self.assertEqual(len(list(output.rglob('*.png'))), 0)


if __name__ == '__main__':
    unittest.main()
