"""Pure external-capsule transport/negative controls, never approval or input."""
import json
from pathlib import Path
import tempfile
import unittest

from ci_paths import require_allocation
from ci_paths_custody import materialize
from ci_paths_protocol import CASES, PRODUCT


class CustodyTransportControls(unittest.TestCase):
    def capsule(self):
        return dict(version=1,H='a'*40,T=PRODUCT,cases=list(CASES),source_preflight=True,
                    native_eligibility=True,allocation_id='synthetic-unit-only',
                    started_at_epoch=1000,deadline_epoch=3340,retry_budget=0)

    def test_exact_bytes_original_clock_and_absolute_known_file_reaches_cli(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent=Path(temporary).resolve()
            data=(' \n'+json.dumps(self.capsule(),indent=3)+'\n').encode()
            path=materialize(data,parent,'a'*40,now=2000)
            self.assertTrue(path.is_absolute());self.assertEqual(path.read_bytes(),data)
            self.assertEqual(path.stat().st_mode & 0o777,0o600)
            self.assertEqual(path.parent.stat().st_mode & 0o777,0o700)
            self.assertFalse(path.with_name(path.name+'.consumed').exists())
            value=require_allocation(path,'a'*40,now=2001,environment={})
            self.assertEqual(value,self.capsule())
            self.assertEqual(value['started_at_epoch'],1000);self.assertEqual(value['deadline_epoch'],3340)
            self.assertEqual(value['deadline_epoch']-value['started_at_epoch'],2340)
            with self.assertRaises(FileExistsError):materialize(data,parent,'a'*40,now=2002)
            with self.assertRaises(FileExistsError):require_allocation(path,'a'*40,now=2002,environment={})

    def test_declared_2340_second_boundary_cannot_be_extended(self):
        self.assertEqual(self.capsule()['deadline_epoch'],3340)
        self.assertEqual(self.capsule()['deadline_epoch']-self.capsule()['started_at_epoch'],2340)
        for end in (3341,3340.001):
            with self.subTest(end=end),tempfile.TemporaryDirectory() as temporary:
                parent=Path(temporary).resolve()
                data=json.dumps({**self.capsule(),'deadline_epoch':end}).encode()
                with self.assertRaises(RuntimeError):materialize(data,parent,'a'*40,now=2000)
                self.assertFalse((parent/'nac347-path-custody').exists())

    def test_missing_malformed_foreign_unapproved_reordered_and_expired_never_write(self):
        values=[b'',b'{',b'[]',b'{"H":1,"H":2}',b' '*8193]
        for change in ({'H':'b'*40},{'T':'b'*40},{'source_preflight':False},{'native_eligibility':False},
                       {'retry_budget':1},{'cases':list(reversed(CASES))},{'deadline_epoch':1999},
                       {'started_at_epoch':2001},{'deadline_epoch':9999}):
            values.append(json.dumps({**self.capsule(),**change}).encode())
        for data in values:
            with self.subTest(data=data[:60]),tempfile.TemporaryDirectory() as temporary:
                parent=Path(temporary).resolve()
                with self.assertRaises((RuntimeError,ValueError,TypeError)):
                    materialize(data,parent,'a'*40,now=2000)
                self.assertFalse((parent/'nac347-path-custody').exists())

    def test_symlink_parent_and_existing_handoff_never_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent=Path(temporary).resolve();actual=parent/'actual';actual.mkdir()
            link=parent/'link';link.symlink_to(actual,target_is_directory=True)
            data=json.dumps(self.capsule()).encode()
            with self.assertRaisesRegex(RuntimeError,'canonical'):materialize(data,link,'a'*40,now=2000)
            handoff=actual/'nac347-path-custody';handoff.mkdir();sentinel=handoff/'sentinel';sentinel.write_bytes(b'untouched')
            with self.assertRaises(FileExistsError):materialize(data,actual,'a'*40,now=2000)
            self.assertEqual(sentinel.read_bytes(),b'untouched')

    def test_hosted_rerun_or_wrong_event_ref_is_rejected_before_consumption(self):
        valid=dict(GITHUB_ACTIONS='true',GITHUB_RUN_ATTEMPT='1',GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_REF='refs/heads/codex/path')
        for changed in ({'GITHUB_RUN_ATTEMPT':'2'},{'GITHUB_EVENT_NAME':'pull_request'},{'GITHUB_REF':'refs/heads/dev'}):
            with tempfile.TemporaryDirectory() as temporary:
                path=materialize(json.dumps(self.capsule()).encode(),Path(temporary).resolve(),'a'*40,now=2000)
                with self.assertRaisesRegex(RuntimeError,'first explicit'):
                    require_allocation(path,'a'*40,now=2000,environment={**valid,**changed})
                self.assertFalse(path.with_name(path.name+'.consumed').exists())
                self.assertEqual(require_allocation(path,'a'*40,now=2001,environment=valid),self.capsule())


if __name__=='__main__':unittest.main()
