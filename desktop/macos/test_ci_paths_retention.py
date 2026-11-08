"""Fresh bounded failure-report files only; no actor, host profile or process."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from ci_support import MAX_FILE, MAX_TOTAL, export_evidence, retain_path_failure_report


class FailureReportControls(unittest.TestCase):
    def fixture(self, root):
        raw, output = root / 'raw', root / 'out'
        raw.mkdir()
        report = dict(result='passed', source_sha='a'*40, paths_clock={'failed':[]},
                      paths={'cases':[{'receipt':'fresh receipt', 'error':'secret-canary'}]})
        (raw/'ci-report.json').write_text(json.dumps(report))
        (raw/'receipt.json').write_text('{"proof":"fresh independent prefix"}')
        export_evidence(raw, output, [('secret-canary','<redacted>')],
                        strict_json=True, essential_first=True, include_hashes=True)
        report.update(result='failed', finalization_error='secret-canary late failure', retention_complete=False)
        report['paths_clock']['failed'].append('original work latch')
        (raw/'ci-report.json').write_text(json.dumps(report))
        return raw, output

    def test_full_failure_replacement_preserves_prefix_and_updates_both_hashes(self):
        with tempfile.TemporaryDirectory() as temporary:
            raw, output = self.fixture(Path(temporary).resolve())
            old = json.loads((output/'export.json').read_text())
            retain_path_failure_report(raw, output, [('secret-canary','<redacted>')])
            report = json.loads((output/'ci-report.json').read_text())
            self.assertEqual(report['result'], 'failed')
            self.assertFalse(report['retention_complete'])
            self.assertEqual(report['paths_clock']['failed'], ['original work latch'])
            self.assertEqual(report['paths']['cases'][0]['receipt'], 'fresh receipt')
            self.assertNotIn('secret-canary', (output/'ci-report.json').read_text())
            index = json.loads((output/'export.json').read_text())
            self.assertEqual(index[1:], old[1:])
            self.assertEqual(index[0]['raw_source_sha256'], hashlib.sha256((raw/'ci-report.json').read_bytes()).hexdigest())
            self.assertEqual(index[0]['exported_sha256'], hashlib.sha256((output/'ci-report.json').read_bytes()).hexdigest())

    def test_missing_report_is_not_invented(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            raw, output = self.fixture(root)
            (output/'ci-report.json').unlink()
            before = (output/'export.json').read_bytes()
            retain_path_failure_report(raw, output, [])
            self.assertFalse((output/'ci-report.json').exists())
            self.assertEqual((output/'export.json').read_bytes(), before)

    def test_symlink_raw_report_public_report_and_index_never_follow(self):
        for place, name in [('raw','ci-report.json'), ('out','ci-report.json'), ('out','export.json')]:
            with self.subTest(place=place, name=name), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary).resolve()
                raw, output = self.fixture(root)
                outside = root/'outside.json'; outside.write_text('{"unowned":"fresh canary"}')
                before = outside.read_bytes()
                target = root/place/name; target.unlink(); target.symlink_to(outside)
                with self.assertRaises(OSError):retain_path_failure_report(raw, output, [])
                self.assertEqual(outside.read_bytes(), before)

    def test_oversize_malformed_and_redaction_expansion_do_not_truncate_or_publish(self):
        for mode in ('oversize', 'malformed', 'redaction-expansion'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temporary:
                raw, output = self.fixture(Path(temporary).resolve())
                before = [(output/name).read_bytes() for name in ('ci-report.json','export.json')]
                data = b'x'*(MAX_FILE+1) if mode=='oversize' else b'{invalid'
                replacements = []
                if mode=='redaction-expansion':
                    data = json.dumps({'error':'x'*(MAX_FILE//2)}).encode()
                    replacements = [('x','xx')]
                (raw/'ci-report.json').write_bytes(data)
                with self.assertRaises((RuntimeError,json.JSONDecodeError)):
                    retain_path_failure_report(raw, output, replacements)
                self.assertEqual([(output/name).read_bytes() for name in ('ci-report.json','export.json')], before)

    def test_total_limit_includes_written_but_unindexed_partial_payload(self):
        with tempfile.TemporaryDirectory() as temporary:
            raw, output = self.fixture(Path(temporary).resolve())
            (output/'unindexed.log').write_bytes(b'x'*MAX_TOTAL)
            before = [(output/name).read_bytes() for name in ('ci-report.json','export.json')]
            with self.assertRaisesRegex(RuntimeError,'total upload limit'):
                retain_path_failure_report(raw, output, [])
            self.assertEqual([(output/name).read_bytes() for name in ('ci-report.json','export.json')], before)


if __name__ == '__main__':unittest.main()
