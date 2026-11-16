"""Fresh bounded failure-report files only; no actor, host profile or process."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ci_support import MAX_FILE, MAX_TOTAL, export_evidence, retain_path_failure_report


class FailureReportControls(unittest.TestCase):
    def test_short_write_completes_and_zero_progress_restores_previous_pair(self):
        for zero in (False,True):
            with self.subTest(zero=zero), tempfile.TemporaryDirectory() as temporary:
                raw,output=self.fixture(Path(temporary).resolve())
                report,index=output/'ci-report.json',output/'export.json'
                original=(report.read_bytes(),index.read_bytes())
                inode=index.stat().st_ino
                writing=os.write
                calls=[]
                def write(fd,data):
                    if os.fstat(fd).st_ino==inode and not calls:
                        calls.append(True)
                        return 0 if zero else writing(fd,data[:7])
                    return writing(fd,data)
                with patch('ci_support.os.write',side_effect=write):
                    if zero:
                        with self.assertRaisesRegex(OSError,'no progress'):
                            retain_path_failure_report(raw,output,[])
                    else:retain_path_failure_report(raw,output,[])
                if zero:self.assertEqual((report.read_bytes(),index.read_bytes()),original)
                else:
                    entry=next(x for x in json.loads(index.read_text()) if x['file']=='ci-report.json')
                    self.assertEqual(entry['exported_sha256'],hashlib.sha256(report.read_bytes()).hexdigest())

    def test_duplicate_acquisition_failure_restores_missing_index_and_closes_handles(self):
        for missing_index in (False,True):
            with self.subTest(missing_index=missing_index), tempfile.TemporaryDirectory() as temporary:
                raw,output=self.fixture(Path(temporary).resolve())
                report,index=output/'ci-report.json',output/'export.json'
                if missing_index:index.unlink()
                original=(report.read_bytes(),None if missing_index else index.read_bytes())
                opening,duplicating=os.open,os.dup
                descriptors=[]
                duplicates=[]
                primary=OSError('inert duplicate acquisition failure')
                def open_file(path,flags,*args,**kwargs):
                    fd=opening(path,flags,*args,**kwargs)
                    if flags & os.O_WRONLY:descriptors.append(fd)
                    return fd
                def duplicate(fd):
                    if duplicates:raise primary
                    result=duplicating(fd);duplicates.append(result);descriptors.append(result);return result
                with patch('ci_support.os.open',side_effect=open_file),patch('ci_support.os.dup',side_effect=duplicate):
                    with self.assertRaises(OSError) as caught:retain_path_failure_report(raw,output,[])
                self.assertIs(caught.exception,primary)
                self.assertEqual(report.read_bytes(),original[0])
                self.assertEqual(None if not index.exists() else index.read_bytes(),original[1])
                for fd in descriptors:
                    with self.assertRaises(OSError):os.fstat(fd)

    def test_persistent_storage_failure_reports_restoration_failure_without_masking_primary(self):
        with tempfile.TemporaryDirectory() as temporary:
            raw,output=self.fixture(Path(temporary).resolve())
            inode=(output/'export.json').stat().st_ino
            writing=os.write
            primary=OSError('inert persistent storage failure')
            def write(fd,data):
                if os.fstat(fd).st_ino==inode:raise primary
                return writing(fd,data)
            with patch('ci_support.os.write',side_effect=write):
                with self.assertRaises(OSError) as caught:retain_path_failure_report(raw,output,[])
            self.assertIs(caught.exception,primary)
            self.assertIn('Failure report/index restoration: OSError',caught.exception.__notes__)
            self.assertEqual((output/'receipt.json').read_text(),'{"proof":"fresh independent prefix"}')

    def test_second_destination_faults_preserve_old_report_and_index_pair(self):
        for mode in ('open','truncate','write','partial-write','close','closed-then-error'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temporary:
                raw, output = self.fixture(Path(temporary).resolve())
                report, index = output/'ci-report.json', output/'export.json'
                original = (report.read_bytes(), index.read_bytes())
                payload = (output/'receipt.json').read_bytes()
                identity = index.stat().st_ino
                primary = OSError('inert second metadata destination failure')
                triggered = []
                opening, writing, truncating, closing = os.open, os.write, os.ftruncate, os.close
                def is_index(fd):return os.fstat(fd).st_ino == identity
                def opening_fault(path,flags,*args,**kwargs):
                    if mode=='open' and Path(path)==index and flags & os.O_WRONLY:
                        triggered.append(True);raise primary
                    return opening(path,flags,*args,**kwargs)
                def writing_fault(fd,data):
                    if mode in ('write','partial-write') and is_index(fd) and not triggered:
                        triggered.append(True)
                        if mode=='partial-write':writing(fd,data[:7])
                        raise primary
                    return writing(fd,data)
                def truncating_fault(fd,length):
                    if mode=='truncate' and is_index(fd) and not triggered:
                        triggered.append(True);truncating(fd,0);raise primary
                    return truncating(fd,length)
                def closing_fault(fd):
                    if mode in ('close','closed-then-error') and is_index(fd) and not triggered:
                        triggered.append(True)
                        if mode=='closed-then-error':closing(fd)
                        raise primary
                    return closing(fd)
                with patch('ci_support.os.open',side_effect=opening_fault), \
                        patch('ci_support.os.write',side_effect=writing_fault), \
                        patch('ci_support.os.ftruncate',side_effect=truncating_fault), \
                        patch('ci_support.os.close',side_effect=closing_fault):
                    with self.assertRaises(OSError) as caught:
                        retain_path_failure_report(raw,output,[('secret-canary','<redacted>')])
                self.assertIs(caught.exception,primary)
                self.assertTrue(triggered)
                self.assertEqual((report.read_bytes(),index.read_bytes()),original)
                self.assertEqual((output/'receipt.json').read_bytes(),payload)

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
