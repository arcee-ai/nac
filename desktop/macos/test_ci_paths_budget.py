"""Actual owning seams with inert children/clocks; no native commands or probes."""
from contextlib import ExitStack
import io,json,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import ci,ci_paths_attachments,ci_xctest,ci_support
import test_ci_paths_finalization as finalizers
from ci_paths_budget import PathBudget,BudgetExpired,using,active


class Clock:
    def __init__(self):self.m=100.;self.w=1000.
    def mono(self):return self.m
    def wall(self):return self.w
    def advance(self,seconds):self.m+=seconds;self.w+=seconds
    def to(self,stamp):self.advance(stamp-self.m)
    def budget(self,H=1900,end=3340):
        return PathBudget(dict(started_at_epoch=1000,deadline_epoch=end),H,
                          monotonic=self.mono,wall=self.wall)


class BudgetControls(unittest.TestCase):
    def test_optional_none_retains_exact_existing_absolute_bound_and_parent(self):
        c=Clock();b=c.budget();original=b.work.deadline
        self.assertIs(b.work.capped(None),b.work)
        self.assertEqual(b.work.capped(None).deadline,original)
        shorter=b.work.capped(original-20)
        self.assertIs(shorter.capped(None),shorter)
        with using(shorter):
            with using(b.work.capped(None)):
                self.assertEqual(active().deadline,original-20)
        self.assertEqual(b.work.deadline,original)
        self.assertIsNone(active())
    def test_explicit_zero_and_expired_optional_cap_never_become_fresh_allowance(self):
        c=Clock();b=c.budget();shorter=b.work.capped(105)
        c.advance(6)
        with self.assertRaises(BudgetExpired):shorter.capped(None).check()
        self.assertEqual(shorter.deadline,105)
        self.assertEqual(b.work.capped(0).deadline,0)
        with self.assertRaises(BudgetExpired):b.work.capped(0).check()
        self.assertTrue(b.failed)

    def test_original_H_and_ROOT_uncertainty_cutoffs(self):
        c=Clock();b=c.budget();self.assertEqual(b.hard,1900)
        self.assertEqual((b.work.deadline,b.cleanup.deadline),(1300,1780))
        self.assertEqual(c.budget(H=5000).hard,2380)
    def test_long_queue_cannot_renew_import_or_root_clock(self):
        c=Clock();c.w=2800
        with self.assertRaises(BudgetExpired):c.budget()
    def test_early_H_with_no_reserve_rejects(self):
        with self.assertRaises(BudgetExpired):Clock().budget(H=700)
    def test_nonfinite_bool_duration_and_future_start_reject(self):
        c=Clock()
        for end in [True,float('nan'),float('inf'),3700,999]:
            with self.subTest(end=end),self.assertRaises((ValueError,BudgetExpired)):c.budget(end=end)
    def test_clock_step_latches_no_new_input_but_cleanup_independent(self):
        c=Clock();b=c.budget();c.w+=3
        with self.assertRaises(BudgetExpired):b.work.check()
        with using(b.cleanup):self.assertEqual(active().kind,'cleanup')
        with self.assertRaises(BudgetExpired):b.require_success()
    def test_exact_boundary_never_forces_one_second(self):
        c=Clock();b=c.budget();c.to(b.work.deadline)
        with using(b.retention),patch('ci.subprocess.check_output') as spawn:
            with self.assertRaises(BudgetExpired):
                with using(b.work):ci.command(['inert'])
            spawn.assert_not_called()
    def test_nested_parent_expiry_remains_latched(self):
        c=Clock();b=c.budget()
        with self.assertRaises(BudgetExpired):
            with using(b.work.capped(105)):
                with using(b.retention):c.advance(6)
        with self.assertRaises(BudgetExpired):b.work.check()
        self.assertIsNone(active())
    def test_no_shared_case_or_build_renewal(self):
        c=Clock();b=c.budget();build=min(b.origin+1200,b.work.deadline);cases=min(c.m+900,b.work.deadline)
        c.to(cases)
        with self.assertRaises(BudgetExpired):b.work.capped(cases).check()
        self.assertEqual((build,cases),(1300,1000))
    def test_cleanup_expiry_still_allows_retention_never_success(self):
        c=Clock();b=c.budget();c.to(b.cleanup.deadline)
        with self.assertRaises(BudgetExpired):b.cleanup.check()
        with using(b.retention):self.assertEqual(b.retention.timeout(30),30)
        with self.assertRaises(BudgetExpired):b.require_success()
    def test_command_and_native_report_keep_real_owner_contract(self):
        c=Clock();b=c.budget()
        with tempfile.TemporaryDirectory() as t,using(b.work):
            with patch('ci.subprocess.check_output',return_value=' scoped \n') as call:
                self.assertEqual(ci.command(['inert']),'scoped');self.assertLessEqual(call.call_args.kwargs['timeout'],30)
            result=type('Result',(),dict(returncode=0,stdout='{"ok":true}',stderr='fixture stderr'))()
            with patch('ci.subprocess.run',return_value=result):
                log=Path(t)/'native.log';self.assertEqual(ci.native_report(['inert'],log),{'ok':True})
                self.assertEqual(log.read_text(),'fixture stderr')
        self.assertIsNone(active())


class HandleControls(unittest.TestCase):
    def exercise(self,fault):
        c=Clock();b=c.budget();signals=[]
        class Child:
            pid=57111
            def __init__(self):self.stdout=io.BytesIO(b'inert');self.done=False;self.waits=0
            def poll(self):return 0 if self.done else None
            def wait(self,timeout=None):
                self.waits+=1
                if fault=='wait' and self.waits==1:
                    c.to(b.work.deadline);raise subprocess.TimeoutExpired(['inert'],timeout)
                self.done=True;return 0
        child=Child()
        class Thread:
            def __init__(self,**_):
                if fault=='thread_construct':c.to(b.work.deadline)
            def start(self):
                if fault=='thread_start':raise TimeoutError('injected expiry after accepted handle')
            def is_alive(self):return False
            def join(self,timeout=None):pass
        def spawn(*_,**__):
            if fault=='acquired':c.to(b.work.deadline)
            return child
        if fault=='before':c.to(b.work.deadline)
        with tempfile.TemporaryDirectory() as t,patch('ci.subprocess.Popen',side_effect=spawn) as popen,patch('ci.threading.Thread',Thread),patch('ci.os.killpg',side_effect=lambda *a:signals.append(a)):
            log=Path(t)/'run.log'
            if fault=='before':
                with self.assertRaises(BudgetExpired):
                    with using(b.work):ci.run(['inert-never-launched'],log,100)
                popen.assert_not_called();return
            with using(b.retention):
                if fault is None:
                    with using(b.work):ci.run(['inert-never-real'],log,100)
                else:
                    with self.assertRaises(TimeoutError):
                        with using(b.work):ci.run(['inert-never-real'],log,100)
            self.assertTrue(child.done,'accepted child must be reaped')
            receipt=json.loads(log.with_name('run.log.ownership.json').read_text())
            self.assertTrue(receipt['accepted']);self.assertTrue(receipt['reaped']);self.assertFalse(receipt['unknown'])
            if fault is not None:self.assertTrue(signals)
        self.assertIsNone(active())
    def test_before_launch(self):self.exercise('before')
    def test_after_accepted_handle(self):self.exercise('acquired')
    def test_before_thread_start(self):self.exercise('thread_construct')
    def test_thread_start_failure_actual_RED_seam(self):self.exercise('thread_start')
    def test_wait_expiry(self):self.exercise('wait')
    def test_normal_accepted_handle_compatibility(self):self.exercise(None)


class CollectorControls(unittest.TestCase):
    def test_actual_collector_expiry_enters_run_case_independent_cleanup(self):
        c=Clock();b=c.budget();calls=[]
        def actual(_tool,result,config,ch,out,**kwargs):
            test_id,url=ci_paths_attachments.identities(config['scenario'])
            class Tool:
                path='/inert/xcresulttool'
                def capture(self,*_,**__):
                    calls.append('actual SDK collector seam');c.to(b.work.deadline)
                    return json.dumps(dict(nodeType='Test Case',nodeIdentifier=test_id,nodeIdentifierURL=url,result='Passed')).encode()
            return ci_paths_attachments.collect(Tool(),result,config,ch,out,**kwargs)
        control=finalizers.CaseFinalizationControls('runTest')
        with self.assertRaises(BudgetExpired):
            with using(b.work):control.exercise(export_error=True,budget=b,actual_collector=actual)
        self.assertEqual(calls,['actual SDK collector seam'])
        self.assertTrue(b.failed)
    def test_actual_cleanup_expiry_retains_relocation_and_never_PASS(self):
        c=Clock();b=c.budget();control=finalizers.CaseFinalizationControls('runTest')
        with self.assertRaises(BudgetExpired):
            with using(b.work):control.exercise(budget=b,expire_cleanup=lambda:c.to(b.cleanup.deadline))
        self.assertTrue(b.failed)
    def test_actual_result_hash_checks_each_chunk(self):
        c=Clock();b=c.budget();real=ci_xctest.hashlib.sha256
        class Hash:
            def __init__(self):self.h=real()
            def update(self,data):self.h.update(data);c.to(b.work.deadline)
            def hexdigest(self):return self.h.hexdigest()
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);(root/'result').write_bytes(b'owned bytes')
            with using(b.retention),patch('ci_xctest.hashlib.sha256',Hash):
                with self.assertRaises(BudgetExpired):
                    with using(b.work):ci_xctest.result_receipt(root)
        self.assertTrue(b.failed)
    def test_actual_export_timeout_leaves_nonpassing_prefix(self):
        c=Clock();b=c.budget()
        def digest(stream):
            import hashlib
            h=hashlib.sha256(stream.read());c.to(b.retention.deadline);return h
        with tempfile.TemporaryDirectory() as t:
            raw=Path(t)/'raw';raw.mkdir();out=Path(t)/'out'
            (raw/'ci-report.json').write_text('{"result":"pending"}')
            with patch('ci_support.checked_digest',side_effect=digest),self.assertRaises(BudgetExpired):
                with using(b.retention):ci_support.export_evidence(raw,out,[],include_hashes=True)
            if (out/'ci-report.json').exists():self.assertNotEqual(json.loads((out/'ci-report.json').read_text())['result'],'passed')
        with self.assertRaises(BudgetExpired):b.require_success()


if __name__=='__main__':unittest.main()
