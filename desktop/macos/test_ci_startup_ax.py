"""Inert companion/process-port controls; no subprocess, AX, app or signal."""
import json
import io
import os
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from ci_startup_ax import AXCompanion, guard_phases, require_guard_proof
from ci_xctest_attachments import bounded_file


def publish_fixture_receipt(path, row):
    """Match the Swift producer: private complete file, read-only, then rename."""
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    pending = Path(temporary)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(json.dumps(row).encode())
            os.fchmod(stream.fileno(), 0o400)
        os.replace(pending, path)
    finally:
        pending.unlink(missing_ok=True)


class ReceiptPublicationControls(unittest.TestCase):
    def test_initial_and_replacement_publication_expose_only_complete_receipts(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'receipt.json'
            original_replace = os.replace
            previous = None
            for row in [{'sequence': '0'}, {'sequence': '1'}]:
                def before_rename(pending, destination):
                    self.assertEqual(destination, target)
                    self.assertEqual(pending.stat().st_mode & 0o777, 0o400)
                    self.assertEqual(json.loads(bounded_file(pending, 8192)), row)
                    if previous is None:
                        with self.assertRaises(FileNotFoundError): bounded_file(target, 8192)
                    else:
                        self.assertEqual(json.loads(bounded_file(target, 8192)), previous)
                    original_replace(pending, destination)
                with patch('os.replace', side_effect=before_rename) as replace:
                    publish_fixture_receipt(target, row)
                replace.assert_called_once()
                self.assertEqual(json.loads(bounded_file(target, 8192)), row)
                self.assertEqual(list(target.parent.iterdir()), [target])
                previous = row

    def test_failed_publication_preserves_previous_receipt_and_removes_private_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'receipt.json'
            publish_fixture_receipt(target, {'sequence': '0'})
            with patch('os.replace', side_effect=OSError('inert publication failure')):
                with self.assertRaises(OSError): publish_fixture_receipt(target, {'sequence': '1'})
            self.assertEqual(json.loads(bounded_file(target, 8192)), {'sequence': '0'})
            self.assertEqual(list(target.parent.iterdir()), [target])


class CompanionControls(unittest.TestCase):
    def exercise(self, *, wrong_nonce=False, unknown=False, fail=False, metadata_loss=False, retire=False):
        events=[]
        with tempfile.TemporaryDirectory(prefix='nac-ax-parent-inert-') as temporary:
            root=Path(temporary).resolve(); private=root/'ax';private.mkdir(mode=0o700)
            config_path=root/'config.json';config_path.write_text('{}')
            helper=root/'helper';helper.write_text('inert; never executed')
            identity=dict(pid=123,parent=os.getpid(),uid=os.getuid(),start_seconds=1,start_microseconds=2,executable=str(helper))
            declaration=dict(path=str(private/'receipt.json'),nonce='a'*64,helper_path=str(helper),helper_sha256='b'*64,
                             support_sha256={'inert':'c'*64},owner_pid=os.getpid(),deadline_ns=str(int((time.monotonic()+60)*1e9)))
            witness=SimpleNamespace(ready=True,failure=None,ui_terminal=False,ui_failure=None,process_failure=None)
            begun=threading.Event()
            retire_now=threading.Event();retired_published=threading.Event()
            primary=ValueError('inert original helper failure')
            def owned(argv,log,cap,**kwargs):
                events.append('owned-start')
                self.assertIs(kwargs['retain_ownership'], True)
                if fail: raise primary
                row=dict(schema='nac342-ax-witness-v1',status='waiting',sequence='0',trusted=True,
                         nonce='wrong' if wrong_nonce else declaration['nonce'],configuration_sha256='d'*64,
                         helper_sha256=declaration['helper_sha256'],support_sha256=declaration['support_sha256'],
                         case_deadline_ns=argv[-1],helper=identity)
                publish_fixture_receipt(Path(declaration['path']), row)
                begun.set()
                until=time.monotonic()+2
                while not Path(declaration['path']+'.stop').exists() and time.monotonic()<until:
                    if retire_now.is_set() and not retired_published.is_set():
                        terminal=dict(row,status='retired',refusal_stage='target_retired',observation=None,
                            target=dict(pid=400,parent=1,uid=os.getuid(),start_seconds=3,start_microseconds=4,executable='/inert/app'),
                            app_launch_epoch=10,window_number=7)
                        publish_fixture_receipt(Path(declaration['path']), terminal)
                        events.append('retired-terminal');retired_published.set()
                    if kwargs['abort'](): raise RuntimeError('inert metadata loss')
                    time.sleep(.005)
                log.write_text('inert')
                log.with_name(log.name+'.ownership.json').write_text(json.dumps(dict(accepted=True,pid=identity['pid'],reaped=not unknown,
                    drain_settled=True,unknown=unknown,teardown_error=None)))
                events.append('owned-reaped')
            owner=AXCompanion(witness,{'ax_witness':declaration},config_path,helper,root,owned)
            with patch('ci_startup_ax.digest',return_value='d'*64),patch('ci_startup_ax.native_identity',return_value=identity):
                # Helper hash is independent of configuration digest in this inert port.
                if wrong_nonce or fail:
                    with self.assertRaises(RuntimeError):owner.start()
                else:owner.start()
                if retire:
                    retire_now.set();self.assertTrue(retired_published.wait(.5))
                    self.assertIsNone(owner.failure);self.assertFalse(owner.finished.is_set())
                if metadata_loss:
                    witness.failure=witness.process_failure='inert stream failure'
                    self.assertTrue(begun.wait(.2))
                    owner.finished.wait(.5)
                    self.assertEqual(owner.failure,'ax_companion_unavailable')
                if unknown or fail or metadata_loss:
                    with self.assertRaises(BaseException) as raised:owner.stop()
                    if fail:self.assertIs(raised.exception,primary)
                else:
                    proof=owner.stop();self.assertTrue(proof['owned_processes_settled'])
                    if retire:
                        _,settled,collection=RetirementCompositionControls().fixture()
                        self.assertTrue(owner.reconcile_retirement(settled,collection)['metadata_settlement_verified'])
                self.assertFalse(owner.thread.is_alive())
            return events

    def test_normal_retirement_before_parent_stop_keeps_owned_companion_alive_until_stop(self):
        self.assertEqual(self.exercise(retire=True),['owned-start','retired-terminal','owned-reaped'])

    def test_positive_owned_completion_and_no_target_signal(self):
        self.assertEqual(self.exercise(),['owned-start','owned-reaped'])

    def test_wrong_readiness_nonce_prevents_next_phase_and_still_settles(self):
        self.assertEqual(self.exercise(wrong_nonce=True),['owned-start','owned-reaped'])

    def test_unknown_child_settlement_never_qualifies(self):
        self.exercise(unknown=True)

    def test_original_helper_failure_survives_stop(self):
        self.exercise(fail=True)

    def test_metadata_failure_aborts_companion_without_blocking_metadata_port(self):
        self.exercise(metadata_loss=True)


class RetirementCompositionControls(unittest.TestCase):
    def fixture(self):
        target=dict(pid=400,parent=1,uid=os.getuid(),start_seconds=3,start_microseconds=4,executable='/inert/app')
        app=dict(target,kind='app',windows=[7],app_launch_epoch=10)
        engine=dict(pid=401,parent=400,uid=os.getuid(),start_seconds=3,start_microseconds=5,executable='/inert/engine',kind='engine',serving=True)
        owner=AXCompanion.__new__(AXCompanion)
        owner.terminal=dict(target=target,app_launch_epoch=10,window_number=7,status='retired')
        settled=dict(owned_processes_settled=True,complete_observation=True,app=app,observed_processes=[app,engine],
                     retired_identities=[dict(identity=n,proof='kill_zero_ESRCH') for n in [app,engine]])
        return owner,settled,dict(complete=True)

    def test_normal_final_retirement_requires_completed_case_and_exact_app_engine_settlement(self):
        owner,settled,collection=self.fixture()
        self.assertTrue(owner.reconcile_retirement(settled,collection)['metadata_settlement_verified'])
        owner.terminal['status']='retiring'
        proof=owner.reconcile_retirement(settled,collection)
        self.assertTrue(proof['retiring_observed']);self.assertFalse(proof['terminal_observed'])

    def test_premature_unknown_missing_engine_or_replaced_retirement_never_qualifies(self):
        for mode in ['premature','unknown','engine','replacement','window','launch','proof']:
            owner,settled,collection=self.fixture()
            if mode=='premature':collection['complete']=False
            if mode=='unknown':settled['complete_observation']=False
            if mode=='engine':settled['observed_processes'].pop()
            if mode=='replacement':owner.terminal['target']={**owner.terminal['target'],'start_seconds':9}
            if mode=='window':owner.terminal['window_number']=8
            if mode=='launch':owner.terminal['app_launch_epoch']=11
            if mode=='proof':settled['retired_identities'][0]['proof']='unknown'
            with self.subTest(mode=mode),self.assertRaises(RuntimeError):owner.reconcile_retirement(settled,collection)


class GuardProofControls(unittest.TestCase):
    def fixture(self):
        config=dict(source_sha='a'*40,test_source_sha='b'*40,harness_sha='c'*40,
                    ax_witness=dict(helper_sha256='d'*64,support_sha256={}))
        witness=dict(app_pid=1,app_launch_epoch=2.5,window_number=3)
        row={k:config[k] for k in ['source_sha','test_source_sha','harness_sha']}
        row.update(witness,schema='nac342-ax-guards-v1',configuration_sha256='e'*64,
                   helper_sha256='d'*64,support_sha256={},rows=[])
        for i,phase in enumerate(guard_phases(),1):
            entry=dict(sequence=str(i),entered_ns=str(i*100),began_ns=str(i*100+1),ended_ns=str(i*100+2),
                consumed_ns=str(i*100+3),surface=phase,root_id='00000000-0000-0000-0000-000000000001',focus_checked=phase=='goTo')
            if phase!='form':entry['panel_id']='00000000-0000-0000-0000-000000000002'
            if phase=='goTo':entry['go_to_id']='00000000-0000-0000-0000-000000000003'
            row['rows'].append(entry)
        from test_ci_startup_interaction import interaction_facts
        row['interactions'] = interaction_facts(row['rows'])
        return config,witness,row

    def test_exact_26_guards_and_all_existing_11_action_phases(self):
        config,witness,row=self.fixture()
        self.assertEqual(len(row['rows']),26)
        self.assertEqual(guard_phases(),['form','form','form','form','form','panel','panel','goTo','goTo','goTo','goTo','goTo',
                                      'goTo','panel','panel','form','form','form','form','form','form','form','form','form','form','form'])
        self.assertIs(require_guard_proof(row,config,'e'*64,witness),row)

    def test_missing_stale_replayed_replaced_private_or_wrong_source_proof_is_refused(self):
        import copy
        config,witness,original=self.fixture()
        for mode in ['count','source','stale','replay','replacement','value_dump','focus','phase']:
            row=copy.deepcopy(original)
            if mode=='count':row['rows'].pop()
            if mode=='source':row['test_source_sha']='0'*40
            if mode=='stale':row['rows'][1]['began_ns']=row['rows'][1]['entered_ns']
            if mode=='replay':row['rows'][1]['sequence']=row['rows'][0]['sequence']
            if mode=='replacement':row['rows'][-1]['root_id']='00000000-0000-0000-0000-000000000009'
            if mode=='value_dump':row['rows'][0]['private_value']='must-not-retain'
            if mode=='focus':row['rows'][7]['focus_checked']=False
            if mode=='phase':row['rows'][7]['surface']='form'
            with self.subTest(mode=mode),self.assertRaises((RuntimeError,ValueError)):
                require_guard_proof(row,config,'e'*64,witness)


class ExistingOwnerReceiptControls(unittest.TestCase):
    def exercise(self, *, retain=False, fail=False, receipt_failure=False):
        from ci import run
        from ci_paths_budget import active
        self.assertIsNone(active())
        class Child:
            pid=57111
            def __init__(self):self.stdout=io.BytesIO(b'inert; never a real child')
            def wait(self,timeout=None):return 1 if fail else 0
            def poll(self):return 1 if fail else 0
        class Thread:
            def __init__(self,*,target,**kwargs):self.target=target
            def start(self):self.target()
            def is_alive(self):return False
        child=Child()
        original=Path.write_text
        def write(path,*args,**kwargs):
            if receipt_failure and path.name.endswith('.ownership.json'):raise OSError('inert custody sink failure')
            return original(path,*args,**kwargs)
        with tempfile.TemporaryDirectory() as temporary, patch('ci.subprocess.Popen',return_value=child), \
                patch('ci.threading.Thread',Thread),patch('ci.os.killpg') as signal,patch.object(Path,'write_text',write):
            log=Path(temporary)/'owner.log'
            if fail:
                with self.assertRaisesRegex(RuntimeError,r'failed \(1\)'):run(['inert'],log,1,retain_ownership=retain)
            elif receipt_failure:
                with self.assertRaises(OSError):run(['inert'],log,1,retain_ownership=retain)
            else:run(['inert'],log,1,retain_ownership=retain)
            receipt=log.with_name(log.name+'.ownership.json')
            if retain and not receipt_failure:
                row=json.loads(receipt.read_text())
                self.assertTrue(row['accepted'] and row['reaped'] and row['drain_settled'])
                self.assertFalse(row['unknown']);self.assertIsNone(row['teardown_error'])
            else:self.assertFalse(receipt.exists())
            signal.assert_not_called();self.assertTrue(child.stdout.closed)

    def test_explicit_receipt_works_without_PathBudget_and_default_is_unchanged(self):
        self.exercise();self.exercise(retain=True)

    def test_receipt_failure_refuses_success_and_preserves_original_helper_failure(self):
        self.exercise(retain=True,receipt_failure=True)
        self.exercise(retain=True,fail=True,receipt_failure=True)


if __name__=='__main__':unittest.main()
