"""Inert scheduling, admission, source closure and export envelope controls."""
import ast
import copy
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import patch
from .test_protocol import Fixture
from . import admission as a,protocol as p,materialize,evidence
from .capture_case import Capture
from .owners import Task,positive,settle_independently


class Composition(Fixture):
    def admission(self):
        value=dict(scope=a.SCOPE,controller_sha='c'*40,H_base=a.BASE,P=p.P,Q_sha256=p.digest(Path(a.__file__).with_name('q_driver.py').read_bytes()),
            manifest_sha256=a.MANIFEST,producer=copy.deepcopy(a.PRODUCER),allocation_id='root-capture-test',admission_nonce='d'*64,
            attempt=1,retries=0,prior_dispatch_counts=dict.fromkeys(p.CASES,0),clock=dict(STARTED=1000,WORK_DEADLINE=3880,CLEANUP_DEADLINE=4480,HARD_DEADLINE=4600))
        env=dict(GITHUB_SHA='c'*40,GITHUB_REF=a.BRANCH,GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_RUN_ATTEMPT='1',GITHUB_REPOSITORY='arcee-ai/nac',GITHUB_RUN_ID='1234')
        return value,env
    def test_literal_admission_and_no_retry_or_wrong_branch(self):
        value,env=self.admission();self.assertIs(a.admit(value,env,now=1001),value)
        for mutate in [lambda v:v.update(attempt=True),lambda v:v.update(retries=1),lambda v:v['prior_dispatch_counts'].update(run=False),
            lambda v:v.update(manifest_sha256='e'*64),lambda v:v.update(Q_sha256='e'*64),lambda v:v['producer'].update(artifact_id=1),
            lambda v:v['clock'].update(HARD_DEADLINE=5000),lambda v:v['clock'].update(WORK_DEADLINE=float('nan'))]:
            bad=copy.deepcopy(value);mutate(bad)
            with self.assertRaises(RuntimeError):a.admit(bad,env,now=1001)
        with self.assertRaises(RuntimeError):a.admit(value,dict(env,GITHUB_REF='refs/heads/dev'),now=1001)
        with self.assertRaises(RuntimeError):a.admit(value,env,now=4000)
    def test_exact_consumer_parent_preserves_original_h_base(self):
        self.assertEqual(a.SOURCE_PARENT,'54f8f7ae3c3d794f049bce43fa5083f6938bee5c')
        self.assertEqual(a.BASE,'ebdbd340bdc1220318446180c0a0df579489392c')
        value,env=self.admission();value['H_base']=a.SOURCE_PARENT
        with self.assertRaises(RuntimeError):a.admit(value,env,now=1001)

    def test_case_clock_expiry_latched_without_renewal(self):
        value,_=self.admission();value['clock']=dict(STARTED=0,WORK_DEADLINE=100,CLEANUP_DEADLINE=700,HARD_DEADLINE=820)
        with patch.object(a.time,'monotonic',return_value=10),patch.object(a.time,'time',return_value=50):
            clock=a.make_clock(value);original=clock.work.deadline
            with self.assertRaises(RuntimeError):clock.require_phase('cannot-fit',60)
            with self.assertRaises(RuntimeError):clock.require_phase('small-after-failure',1)
            self.assertEqual(clock.work.deadline,original)
    def test_new_concurrent_envelope_and_original_total(self):
        self.assertEqual(p.CASE_WORK,5+350+45+5+25+10)
        self.assertGreaterEqual(p.CASE_CLEANUP,155+45+25+5+60)
        self.assertEqual(p.CASE_ALLOWANCE,740);self.assertGreater(p.CASE_ALLOWANCE,555)
        self.assertEqual(evidence.capacity()['total'],54*1024**2)
        self.assertEqual(evidence.capacity()['original']['total'],42*1024**2)
    def route(self,*,collect_error=None,runner_error=None):
        port=self.root/'port';port.mkdir(mode=0o700);config=dict(self.config,port=str(port));events=[]
        for i,req in enumerate(self.requests,1):p.publish(port/f'request-{i}.json',req)
        clock=types.SimpleNamespace(work=types.SimpleNamespace(deadline=time.monotonic()+1000,check=lambda:None),require_phase=lambda *args:None)
        instance=Capture(config,None,Path('/private/derived/runner.xctestrun'),None,None,self.root,clock,{},None,None)
        def finish(seconds):events.append('SDK-settled')
        instance.actor=types.SimpleNamespace(done=threading.Event(),error=None,finish=finish)
        instance.witness=types.SimpleNamespace(done=threading.Event(),error=None)
        instance.hints=types.SimpleNamespace(changed=lambda _:True)
        def collect(*args,**kw):
            events.append('actual-collection');self.assertTrue((port/'release-1.json').exists());self.assertFalse((port/'release-2.json').exists())
            if collect_error:raise collect_error
            return self.found,self.origin,{}
        def runner(*args,**kwargs):
            events.append('runner-settled')
            if runner_error:raise runner_error
            return {'old_generation_settled':True}
        def witness(*args):events.append('witness-settled');return {'reaped':True}
        with patch('lifecycle_capture.capture_case.collector.collect_public',side_effect=collect),patch('lifecycle_capture.capture_case.runner_settled',side_effect=runner),patch('lifecycle_capture.capture_case.stop_helper',side_effect=witness):
            instance._route(self.root/'case.xcresult')
        self.assertEqual(events,['SDK-settled','actual-collection','runner-settled','witness-settled'])
        self.assertIs(p.read(port/'release-2.json')['capture_verified'],False)
    def test_release2_only_after_actual_collection_and_all_owners(self):self.route()
    def test_forged_hint_with_missing_actual_collection_never_releases2(self):
        with self.assertRaisesRegex(ValueError,'no actual'):self.route(collect_error=ValueError('no actual'))
        self.assertFalse((self.root/'port/release-2.json').exists())
    def test_live_runner_never_releases2(self):
        with self.assertRaisesRegex(ValueError,'runner live'):self.route(runner_error=ValueError('runner live'))
        self.assertFalse((self.root/'port/release-2.json').exists())
    def test_original_generated_project_is_not_mutated(self):
        harness=Path(__file__).resolve().parents[3];path=harness/materialize.PROJECT/'project.pbxproj';old=path.read_bytes()
        selection=materialize.materialize(harness,self.root/'project')
        self.assertEqual(path.read_bytes(),old);self.assertEqual(len(selection['sources']),2)
        self.assertIn(b'NACLifecycleCaptureUITests',(Path(selection['project'])/'project.pbxproj').read_bytes())
        self.assertIn(b'container:NACNativeUITests.xcodeproj',(Path(selection['project'])/'xcshareddata/xcschemes/NACLifecycleCaptureUITests.xcscheme').read_bytes())
        target=dict(IsUITestBundle=True,BlueprintName=materialize.TARGET,EnvironmentVariables={'NAC_UI_FIXTURE':'/private/session.json'},TestBundlePath='/private/NACLifecycleCaptureUITests.xctest')
        self.assertIs(materialize.runner({'targets':[target]},Path('/private/session.json'),selection),target)
        with self.assertRaises(RuntimeError):materialize.runner({'targets':[target,target]},Path('/private/session.json'),selection)
        with self.assertRaises(RuntimeError):materialize.runner({'targets':[target]},Path('/wrong/session.json'),selection)
    def test_six_supplement_files_and_missing_or_oversize_refused(self):
        for case in p.CASES:
            folder=self.root/(case+'-screens');folder.mkdir()
            for i in (1,2):(folder/f'{i}.png').write_bytes(self.found[(i,'screen')])
        self.assertEqual(len(evidence.plan_screens(self.root,complete=True)),6)
        bad=self.root/'run-screens/1.png';bad.unlink()
        with self.assertRaises(RuntimeError):evidence.plan_screens(self.root,complete=True)
        self.assertEqual(len(evidence.plan_screens(self.root,complete=False)),5)
        bad.write_bytes(b'\x89PNG\r\n\x1a\n'+b'x'*p.PNG_MAX)
        with self.assertRaises(RuntimeError):evidence.plan_screens(self.root,complete=False)
    def test_owned_task_fake_runner_retains_original_custody(self):
        log=self.root/'owned.log';clock=types.SimpleNamespace(work=None,require_phase=lambda *args:None)
        def fake(argv,path,cap,**kwargs):
            self.assertTrue(kwargs['retain_ownership']);self.assertEqual(kwargs['complete_output_limit'],512*1024)
            path.write_text('full fake compiler graph')
            Path(str(path)+'.ownership.json').write_bytes(p.encoded(dict(accepted=True,reaped=True,drain_settled=True,unknown=False,teardown_error=None,pid=123)))
        # Only Python threads and synthetic files; ci.run is replaced, never invoked.
        task=Task(['inert'],log,1,clock,env={},run=fake).start();self.assertTrue(task.finish(1)['reaped'])
        row=p.read(Path(str(log)+'.ownership.json'));row['drain_settled']=False;Path(str(log)+'.ownership.json').write_bytes(p.encoded(row))
        with self.assertRaises(RuntimeError):positive(log)


class SourceClosure(unittest.TestCase):
    def test_original_journey_ast_plus_only_two_capture_hooks(self):
        original_path=os.environ['NAC_ORIGINAL_LIFECYCLE_SOURCE'];data=Path(original_path).read_bytes()
        self.assertEqual(p.digest(data),'8b7abeb982ff974f4630e19662c7ce9b44d02666975f0347d3e660f661dd74cf')
        original=ast.parse(data)
        current=ast.parse(Path(__file__).with_name('q_driver.py').read_text());hooks=[]
        class Strip(ast.NodeTransformer):
            def visit_If(self,node):
                if ast.unparse(node.test)=='public_capture is not None':hooks.append(ast.unparse(node.body[0]));return None
                return self.generic_visit(node)
            def visit_FunctionDef(self,node):
                if node.name=='run_contract':
                    self_outer.assertEqual([arg.arg for arg in node.args.kwonlyargs],['public_capture'])
                    node.args.kwonlyargs=[];node.args.kw_defaults=[]
                return self.generic_visit(node)
        self_outer=self;current=Strip().visit(current)
        self.assertEqual(hooks,["public_capture(journey, scenario, 'confirming')","public_capture(journey, scenario, 'reconfirming')"])
        self.assertEqual(ast.dump(current,include_attributes=False),ast.dump(original,include_attributes=False))
    def test_runner_has_no_raw_ax_or_input_and_no_provisional_png_channel(self):
        source=Path(__file__).with_name('LifecycleCaptureJourneys.swift').read_text()
        for token in ('ApplicationServices','AXUIElementCopy','AXUIElementPerformAction','.click(','.typeText(','.tap(','.press('):self.assertNotIn(token,source)
        self.assertIn('XCUIScreen.main.screenshot().pngRepresentation',source)
        self.assertNotIn('screenshot',ast.unparse(ast.parse(Path(__file__).with_name('protocol.py').read_text()).body[-2]))

class FinalOwners(Fixture):
    def test_expired_cleanup_still_attempts_every_accepted_owner(self):
        events=[];primary=ValueError('original failure')
        def expired():raise TimeoutError('original cleanup cutoff')
        def cancel(name):
            def run(seconds):events.append((name,seconds));raise RuntimeError(name+' unsettled')
            return run
        clock=types.SimpleNamespace(cleanup=types.SimpleNamespace(deadline=0,check=expired))
        capture=Capture(dict(self.config,port=str(self.root)),None,None,None,None,self.root,clock,{},None,None)
        capture.actor=types.SimpleNamespace(cancel=cancel('SDK'))
        capture.witness=types.SimpleNamespace(cancel=cancel('AX'))
        capture.router=types.SimpleNamespace(join=lambda timeout:events.append(('router',timeout)),is_alive=lambda:False)
        capture.hints=types.SimpleNamespace(__exit__=lambda *args:events.append(('hints',0)))
        with self.assertRaises(ValueError) as caught:capture.cleanup(primary)
        self.assertIs(caught.exception,primary)
        self.assertEqual([x[0] for x in events],['SDK','AX','router','hints'])
        self.assertTrue(all(x[1]==0 for x in events))
    def test_combined_export_keeps_old15_and_new6_and_complete_sdk_log(self):
        from test_ci_lifecycle_finalization import FinalizationControls
        raw=self.root/'raw';ledger,report=FinalizationControls().tree(raw)
        try:
            ledger.finish('terminal','passed',{})
            ledger.value['phase']='complete';ledger.save()
            auxiliary=self.root/'capture';auxiliary.mkdir()
            for case in p.CASES:
                folder=auxiliary/(case+'-screens');folder.mkdir()
                for i in (1,2):(folder/f'{i}.png').write_bytes(self.found[(i,'screen')])
            complete='first SwiftCompile '+('complete SDK graph '*25000)+' final input'
            (raw/'SDK-build.log.complete.json').write_bytes(p.encoded({'text':complete}))
            report['structural_capture_complete']=True
            output=self.root/'export';evidence.finalize(raw,auxiliary,output,report,[('FIXTURE-SECRET','<redacted>')])
            self.assertEqual(len(list((output/'base/lifecycle').rglob('*.png'))),15)
            self.assertEqual(len(list((output/'screens').rglob('*.png'))),6)
            index=json.loads((output/'base/export.json').read_bytes())
            row=next(x for x in index if x['file']=='SDK-build.log.complete.json')
            self.assertFalse(row['truncated']);self.assertTrue(row['parts'])
            joined=''.join(json.loads((output/'base'/part['file']).read_bytes())['text'] for part in row['parts'])
            self.assertEqual(json.loads(joined)['text'],complete)
            self.assertLessEqual(sum(q.stat().st_size for q in output.rglob('*') if q.is_file()),p.TOTAL_MAX)
        finally:ledger.close()
    def test_typed_external_proof_rejects_bool_ids_and_nonfinite_frames(self):
        for edit in [lambda m:m['before'].update(ordinal=True),lambda m:m['before'].update(sequence=True),
                     lambda m:m['before'].update(root_frame=[0,0,True,500]),lambda m:m['before'].update(engine_birth=[124,True,1])]:
            saved=self.found[(1,'caption')];self.edit(1,edit)
            with self.assertRaises(RuntimeError):self.joined()
            self.found[(1,'caption')]=saved


from types import SimpleNamespace
class Publication(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve();self.target=self.root/'request-1.json'
    def test_exact_old_link_interleaving_never_exposes_rejected_record(self):
        real=p.os.link;rejections=[]
        def linked(source,destination):
            real(source,destination)
            try:p.read(destination)
            except BaseException as error:rejections.append(error)
        with patch.object(p.os,'link',side_effect=linked):p.publish(self.target,{'nonce':'complete'})
        self.assertEqual(rejections,[],'visible publication must never fail its own strict reader')
        self.assertEqual(p.read(self.target),{'nonce':'complete'})
    def test_real_atomic_commit_boundary_is_complete_single_link(self):
        real=p.rename_exclusive;observations=[]
        def committed(source,destination):
            self.assertFalse(destination.exists());self.assertEqual(source.stat().st_nlink,1)
            self.assertEqual(p.read(source),{'nonce':'complete'})
            real(source,destination)
            observations.append((destination.stat().st_nlink,p.read(destination)))
            self.assertFalse(source.exists())
        with patch.object(p,'rename_exclusive',side_effect=committed):p.publish(self.target,{'nonce':'complete'})
        self.assertEqual(observations,[(1,{'nonce':'complete'})])
        self.assertEqual(list(self.root.iterdir()),[self.target])
    def test_concurrent_target_creation_cannot_be_overwritten(self):
        real=p.rename_exclusive
        def race(source,destination):
            destination.write_bytes(p.encoded({'original':'wins'}));real(source,destination)
        with patch.object(p,'rename_exclusive',side_effect=race),self.assertRaises(FileExistsError):p.publish(self.target,{'new':'loses'})
        self.assertEqual(p.read(self.target),{'original':'wins'})
        self.assertEqual(list(self.root.iterdir()),[self.target])
    def test_dangling_symlink_and_hardlink_reentry_refused(self):
        self.target.symlink_to(self.root/'absent')
        with self.assertRaises(RuntimeError):p.publish(self.target,{'nonce':'x'})
        self.assertTrue(self.target.is_symlink());self.target.unlink()
        original=self.root/'original';original.write_bytes(p.encoded({'nonce':'x'}));os.link(original,self.target)
        with self.assertRaises(RuntimeError):p.read(self.target)
        with self.assertRaises(RuntimeError):p.publish(self.target,{'nonce':'new'})
    def test_commit_failure_removes_temp_and_never_publishes(self):
        with patch.object(p,'rename_exclusive',side_effect=OSError('inert commit failure')),self.assertRaises(OSError):p.publish(self.target,{'nonce':'complete'})
        self.assertEqual(list(self.root.iterdir()),[])


class Custody(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name).resolve()
    def make(self,variant,primary=None):
        log=self.root/(variant+'-'+str(len(list(self.root.iterdir())))+'.log')
        def fake(*args,**kwargs):
            log.write_text('inert')
            if variant!='missing':
                row=dict(accepted=True,reaped=True,drain_settled=True,unknown=False,teardown_error=None,pid=123)
                if variant=='invalid':row.update(reaped=False,unknown=True)
                Path(str(log)+'.ownership.json').write_bytes(p.encoded(row))
            if primary is not None:raise primary
        return Task(['inert'],log,1,SimpleNamespace(work=None,require_phase=lambda *args:None),env={},run=fake).start()
    def test_original_helper_error_survives_missing_and_invalid_receipts(self):
        for variant in ('missing','invalid'):
            with self.subTest(variant=variant):
                original=ValueError('original helper failure');task=self.make(variant,original)
                with self.assertRaises(ValueError) as caught:task.finish(1)
                self.assertIs(caught.exception,original);self.assertIsNotNone(caught.exception.__cause__)
                self.assertIsNotNone(task.settlement_error)
    def test_helper_budget_cancel_failures_with_each_receipt(self):
        for error_type in (ValueError,TimeoutError,KeyboardInterrupt):
            for variant in ('missing','invalid','valid'):
                for cancel in (False,True):
                    with self.subTest(error=error_type.__name__,receipt=variant,cancel=cancel):
                        original=error_type('original');task=self.make(variant,original)
                        with self.assertRaises(error_type) as caught:(task.cancel if cancel else task.finish)(1)
                        self.assertIs(caught.exception,original)
                        self.assertEqual(task.settlement_error is None,variant=='valid')
                        self.assertEqual(task.cancelled.is_set(),cancel)
    def test_success_and_receipt_only_failure(self):
        self.assertTrue(self.make('valid').finish(1)['reaped'])
        for variant in ('missing','invalid'):
            task=self.make(variant)
            with self.assertRaises((FileNotFoundError,RuntimeError)):task.finish(1)
            self.assertIsNotNone(task.settlement_error)
    def test_unfinished_owner_latches_unknown_then_records_late_settlement(self):
        task=Task(['inert'],self.root/'unfinished.log',1,None,env={});original=ValueError('already stored original')
        task.error=original
        class Pending:
            alive=True
            def join(self,timeout):pass
            def is_alive(self):return self.alive
        task.thread=Pending()
        with self.assertRaises(ValueError) as caught:task.finish(0)
        self.assertIs(caught.exception,original);self.assertIsInstance(task.settlement_error,RuntimeError)
        task.thread.alive=False
        Path(str(task.log)+'.ownership.json').write_bytes(p.encoded(dict(accepted=True,reaped=True,drain_settled=True,unknown=False,teardown_error=None,pid=123)))
        with self.assertRaises(ValueError):task.finish(0)
        self.assertTrue(task.settlement['reaped']);self.assertIsNotNone(task.settlement_error)
        # Even with no original helper error, a once-unknown owner cannot later pass.
        task.error=None
        with self.assertRaises(RuntimeError):task.finish(0)
    def test_cleanup_attempts_all_owners_and_keeps_first_cause(self):
        original=TimeoutError('original budget');events=[]
        tasks=[self.make('missing',original),self.make('invalid',RuntimeError('secondary helper'))]
        def action(index):
            def run():events.append(index);return tasks[index].cancel(1)
            return run
        with self.assertRaises(TimeoutError) as caught:settle_independently([('SDK',action(0)),('witness',action(1)),('last',lambda:events.append(2))],original)
        self.assertIs(caught.exception,original);self.assertEqual(events,[0,1,2]);self.assertIsInstance(original.__cause__,FileNotFoundError)


if __name__=='__main__':unittest.main()
