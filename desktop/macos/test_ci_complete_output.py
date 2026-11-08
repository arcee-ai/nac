"""Actual ci.run/drain/export with accepted inert handles; no child is launched."""
from contextlib import ExitStack
import hashlib
import inspect
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import ci
from ci_support import export_evidence


class InlineThread:
    def __init__(self,target,**_): self.target=target
    def start(self): self.target()
    def is_alive(self): return False
    def join(self,**_): pass


class CompleteOutputTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='nac-complete-log-inert-')
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve()
        self.log=self.root/'startup-protocol-runner/protocol-build.log'
        self.log.parent.mkdir()
        self.payload=b'PREFIX\n'+b'x'*(66*4096)+b'\nSHORT-END\n'

    def execute(self,payload=None,*,limit=1024*1024,code=0,wait_error=None,drain_error=None,
                abort=None,write_error=False,legacy=False,thread_class=InlineThread,retain_ownership=True,
                signal_error=None,close_error=None):
        data=self.payload if payload is None else payload
        clock=[100.]
        class Stream(io.BytesIO):
            def read(self,size):
                if drain_error: raise drain_error
                return super().read(size)
            def close(self):
                if close_error and not getattr(self,'failed_close',False):
                    self.failed_close=True
                    raise close_error
                super().close()
        class Child:
            pid=98765
            def __init__(self): self.stdout=Stream(data);self.done=False;self.waits=0
            def poll(self): return code if self.done else None
            def wait(self,**_):
                self.waits+=1
                if wait_error and self.waits==1:
                    clock[0]+=4
                    raise wait_error
                self.done=True;return code
        child=Child();signals=[]
        options={} if legacy else dict(complete_output_limit=limit)
        with ExitStack() as stack:
            stack.enter_context(patch('ci.subprocess.Popen',return_value=child))
            stack.enter_context(patch('ci.threading.Thread',thread_class))
            def kill(*values):
                signals.append(values)
                if signal_error:raise signal_error
            stack.enter_context(patch('ci.os.killpg',side_effect=kill))
            stack.enter_context(patch('ci.time.monotonic',side_effect=lambda:clock[0]))
            stack.enter_context(patch('ci.RUN_DEADLINE',1000.))
            if write_error: stack.enter_context(patch.object(Path,'write_bytes',side_effect=OSError('inert finalization')))
            ci.run(['inert-never-executed'],self.log,2,retain_ownership=retain_ownership,abort=abort,**options)
        return child,signals

    def receipt(self): return json.loads(self.log.with_name(self.log.name+'.ownership.json').read_text())

    def test_complete_capture_retains_prefix_short_last_chunk_and_digest(self):
        # The predecessor executes its real default drainer, demonstrating prefix
        # loss rather than failing merely because the new keyword is absent.
        self.execute(legacy='complete_output_limit' not in inspect.signature(ci.run).parameters)
        self.assertEqual(self.log.read_bytes(),self.payload)
        row=self.receipt();capture=row['output_capture']
        self.assertTrue(row['accepted'] and row['reaped'] and row['drain_settled'])
        self.assertFalse(row['unknown']);self.assertTrue(capture['complete'])
        self.assertEqual(capture['sha256'],hashlib.sha256(self.payload).hexdigest())
        self.assertEqual(capture['bytes_seen'],len(self.payload))

    def test_legacy_tail_still_drops_old_chunks_without_new_capture_contract(self):
        self.execute(legacy=True)
        self.assertFalse(self.log.read_bytes().startswith(b'PREFIX'))
        self.assertTrue(self.log.read_bytes().endswith(b'SHORT-END\n'))
        self.assertNotIn('output_capture',self.receipt())

    def test_overflow_fails_closed_reaps_drains_and_retains_only_bounded_prefix(self):
        with self.assertRaisesRegex(RuntimeError,'complete output exceeds'):
            self.execute(limit=65536)
        row=self.receipt();capture=row['output_capture']
        self.assertTrue(row['reaped'] and row['drain_settled']);self.assertFalse(row['unknown'])
        self.assertTrue(capture['overflow']);self.assertFalse(capture['complete'])
        self.assertEqual(capture['bytes_retained'],65536)
        self.assertEqual(self.log.read_bytes(),self.payload[:65536])

    def test_nonzero_timeout_and_abort_stay_primary_during_finalization(self):
        for options,error in [(dict(code=7),RuntimeError),
                (dict(wait_error=subprocess.TimeoutExpired(['inert'],2)),subprocess.TimeoutExpired),
                (dict(abort=iter([False,True]).__next__),RuntimeError)]:
            with self.subTest(options=list(options)):
                with self.assertRaises(error): self.execute(write_error=True,**options)
                row=self.receipt()
                self.assertEqual(row['primary_error'],error.__name__)
                self.assertEqual(row['teardown_error'],'OSError')
                self.assertTrue(row['reaped'] and row['drain_settled'])

    def test_owned_tail_primary_identity_survives_secondary_log_close_and_kill_failures(self):
        for secondary in ('log','close','kill'):
            with self.subTest(secondary=secondary):
                primary=RuntimeError('original helper failure object')
                options=dict(legacy=True,wait_error=primary)
                if secondary=='log':options['write_error']=True
                if secondary=='close':options['close_error']=OSError('PRIVATE-CLOSE')
                if secondary=='kill':options['signal_error']=OSError('PRIVATE-KILL')
                with self.assertRaises(RuntimeError) as caught:self.execute(**options)
                self.assertIs(caught.exception,primary)
                row=self.receipt()
                self.assertEqual(row['primary_error'],'RuntimeError')
                self.assertEqual(row['teardown_error'],'OSError')
                self.assertEqual(row['unknown'],secondary=='kill')
                self.assertNotIn('PRIVATE-',json.dumps(row))
                self.assertNotIn('output_capture',row)

    def test_ordinary_unowned_tail_keeps_existing_teardown_precedence(self):
        primary=RuntimeError('original legacy helper error')
        with self.assertRaises(OSError):
            self.execute(legacy=True,retain_ownership=False,wait_error=primary,write_error=True)
        self.assertFalse(self.log.with_name(self.log.name+'.ownership.json').exists())

    def test_owned_success_cannot_hide_cleanup_failure(self):
        with self.assertRaises(OSError):self.execute(legacy=True,write_error=True)
        self.assertIsNone(self.receipt()['primary_error'])
        self.assertEqual(self.receipt()['teardown_error'],'OSError')

    def test_owned_abort_primary_object_survives_secondary_before_and_after_acquisition(self):
        for after_launch in (False,True):
            with self.subTest(after_launch=after_launch):
                primary=RuntimeError('exact ownership abort object')
                calls=[]
                def abort():
                    calls.append(True)
                    if not after_launch or len(calls)>1:raise primary
                    return False
                with self.assertRaises(RuntimeError) as caught:
                    self.execute(legacy=True,abort=abort,write_error=True)
                self.assertIs(caught.exception,primary)
                row=self.receipt()
                self.assertEqual(row['accepted'],after_launch)
                self.assertFalse(row['unknown'])

    def test_existing_bound_keeps_primary_and_sticky_cleanup_failure(self):
        from ci_paths_budget import using
        from test_ci_startup_clock import Clock
        clock=Clock(1000)
        primary=RuntimeError('original bounded helper error')
        with using(clock.cleanup):
            with self.assertRaises(RuntimeError) as caught:
                self.execute(legacy=True,wait_error=primary,write_error=True)
        self.assertIs(caught.exception,primary)
        self.assertIn('helper finalization unknown',clock.failed)
        self.assertEqual(self.receipt()['teardown_error'],'OSError')

    def test_drain_error_and_thread_start_failure_never_claim_complete_capture(self):
        with self.assertRaisesRegex(RuntimeError,'complete output drain failed'):
            self.execute(drain_error=OSError('SECRET-CANARY'))
        self.assertFalse(self.receipt()['output_capture']['complete'])
        self.assertNotIn('SECRET-CANARY',json.dumps(self.receipt()))
        class BrokenThread(InlineThread):
            def start(self): raise RuntimeError('inert thread start')
        with self.assertRaisesRegex(RuntimeError,'inert thread start'): self.execute(thread_class=BrokenThread)
        self.assertFalse(self.receipt()['output_capture']['complete'])

    def test_unsettled_drain_fails_without_closing_or_claiming_the_pipe(self):
        class UnsettledThread(InlineThread):
            def start(self): pass
            def is_alive(self): return True
        with self.assertRaisesRegex(RuntimeError,'complete output drain failed'):
            self.execute(thread_class=UnsettledThread)
        row=self.receipt()
        self.assertTrue(row['reaped']);self.assertFalse(row['drain_settled'])
        self.assertTrue(row['unknown']);self.assertFalse(row['output_capture']['complete'])

    def test_export_complete_R_log_above_default_cap_keeps_ends_and_hashes(self):
        self.execute()
        out=self.root/'public'
        export_evidence(self.root,out,[],include_hashes=True)
        exported=out/'startup-protocol-runner/protocol-build.log'
        self.assertEqual(exported.read_bytes(),self.payload)
        row=next(v for v in json.loads((out/'export.json').read_text()) if v['file'].endswith('protocol-build.log'))
        self.assertFalse(row['truncated']);self.assertTrue(row['capture_complete'])
        self.assertEqual(row['raw_source_sha256'],row['exported_sha256'])

    def test_export_retains_declared_overflow_prefix_as_incomplete_and_refuses_tampering(self):
        with self.assertRaises(RuntimeError): self.execute(limit=65536)
        out=self.root/'public'
        export_evidence(self.root,out,[],include_hashes=True)
        row=next(v for v in json.loads((out/'export.json').read_text()) if v['file'].endswith('protocol-build.log'))
        self.assertTrue(row['truncated']);self.assertFalse(row['capture_complete'])
        self.assertEqual((out/'startup-protocol-runner/protocol-build.log').read_bytes(),self.payload[:65536])
        self.log.write_bytes(b'tampered')
        with self.assertRaisesRegex(RuntimeError,'capture receipt invalid'):
            export_evidence(self.root,self.root/'tampered-output',[],include_hashes=True)

    def test_receipt_digest_or_unsettled_owner_cannot_claim_complete_export(self):
        self.execute()
        owner=self.log.with_name(self.log.name+'.ownership.json');receipt=self.receipt()
        for change in ('sha256','unknown'):
            row=json.loads(json.dumps(receipt))
            if change=='sha256': row['output_capture']['sha256']='f'*64
            else: row['unknown']=True
            owner.write_text(json.dumps(row))
            with self.assertRaises(RuntimeError): export_evidence(self.root,self.root/('out-'+change),[])

    def test_missing_symlink_or_oversize_capture_receipt_never_gets_larger_export(self):
        self.execute()
        owner=self.log.with_name(self.log.name+'.ownership.json');data=owner.read_bytes()
        owner.unlink()
        with self.assertRaises(FileNotFoundError): export_evidence(self.root,self.root/'out-missing',[])
        saved=self.root/'inert-owner.json';saved.write_bytes(data);owner.symlink_to(saved)
        with self.assertRaises(OSError): export_evidence(self.root,self.root/'out-link',[])
        owner.unlink();owner.write_bytes(b' '*8193)
        with self.assertRaisesRegex(RuntimeError,'receipt unavailable'):
            export_evidence(self.root,self.root/'out-overflow',[])

    def test_invalid_capture_cap_is_rejected_before_acquisition(self):
        for limit in (True,0,-1,2*1024*1024+1,float('inf'),'1024'):
            with self.subTest(limit=limit),patch('ci.subprocess.Popen') as launch,self.assertRaises(ValueError):
                ci.run(['inert'],self.log,2,complete_output_limit=limit)
            launch.assert_not_called()


if __name__=='__main__': unittest.main()
