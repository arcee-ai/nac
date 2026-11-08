"""Closed caller fixtures only: no subprocess/thread/network/SDK/native admission."""
import ast
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import caller as c
from lifecycle_capture import admission as a
from lifecycle_capture.protocol import digest


def value():
    return dict(scope=a.SCOPE,controller_sha='a'*40,H_base=a.BASE,P=a.P,Q_sha256=digest((c.ROOT/'desktop/macos/lifecycle_capture/q_driver.py').read_bytes()),
        manifest_sha256=a.MANIFEST,producer=copy.deepcopy(a.PRODUCER),allocation_id='INERT-ONLY',admission_nonce='d'*64,attempt=1,retries=0,
        prior_dispatch_counts=dict.fromkeys(('run','approval','terminal'),0),clock=dict(STARTED=1000,WORK_DEADLINE=3880,CLEANUP_DEADLINE=4480,HARD_DEADLINE=4600))


def env():
    return dict(GITHUB_SHA='a'*40,GITHUB_REF=a.BRANCH,GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_RUN_ATTEMPT='1',GITHUB_REPOSITORY='arcee-ai/nac',
        GITHUB_RUN_ID='123',GITHUB_WORKFLOW_REF=c.WORKFLOW_REF,GITHUB_JOB='capture',ImageVersion='20261102.0473.1',GH_TOKEN='INERT-ONLY')


def identities():
    p=a.PRODUCER
    run=dict(id=p['run_id'],head_sha=p['controller_sha'],head_branch=p['branch'],event='workflow_dispatch',run_attempt=1,status='completed',conclusion='success',repository={'full_name':'arcee-ai/nac'},head_repository={'full_name':'arcee-ai/nac'})
    artifact=dict(id=p['artifact_id'],name=p['artifact_name'],expired=False,size_in_bytes=c.transfer.ARTIFACT['outer_bytes'],digest='sha256:'+c.transfer.ARTIFACT['outer_sha256'],workflow_run=dict(id=p['run_id'],head_sha=p['controller_sha'],head_branch=p['branch'],repository_id=10,head_repository_id=10))
    return run,artifact


class Caller(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name).resolve()
    def test_actual_head_nomination_and_workflow_identity(self):
        with patch.dict(os.environ,env(),clear=True):
            self.assertEqual(c.context(value(),now=1001),value())
            for key,bad in [('GITHUB_SHA','b'*40),('GITHUB_REF','refs/heads/codex/private-native-lifecycle-capture-source01'),('GITHUB_WORKFLOW_REF','unregistered.yml'),('GITHUB_JOB','other'),('ImageVersion','wrong')]:
                with patch.dict(os.environ,{key:bad}),self.assertRaises(RuntimeError):c.context(value(),now=1001)
        self.assertEqual(a.SOURCE_PARENT,'10f0894bf4b4d3d1fc8fe260cbd671dcddfd560e');self.assertEqual(a.BASE,'ebdbd340bdc1220318446180c0a0df579489392c')
    def test_all_caps_original_clock_and_cleanup_retention(self):
        with patch.dict(os.environ,env(),clear=True):
            for phase in (*c.CAPS,'episode'):
                self.assertGreaterEqual(c.minutes(value(),phase,now=1001),1)
                with self.assertRaises(RuntimeError):c.minutes(value(),phase,now=3880)
            self.assertEqual(c.minutes(value(),'episode',now=1800),43)
            self.assertEqual(c.retention_minutes(value(),now=4480),1)
            with self.assertRaises(RuntimeError):c.retention_minutes(value(),now=4600)
            with self.assertRaises(RuntimeError):c.minutes(value(),'arbitrary',now=1001)
    def test_partial_setup_700_seconds_is_refused(self):
        with patch.dict(os.environ,env(),clear=True),self.assertRaises(RuntimeError):c.minutes(value(),'setup-controller',now=3180)
    def test_every_non_episode_phase_full_exact_boundary_and_late_refusal(self):
        with patch.dict(os.environ,env(),clear=True):
            for phase,cap in c.CAPS.items():
                boundary=value()['clock']['WORK_DEADLINE']-60-cap*60
                with self.subTest(phase=phase):
                    self.assertEqual(c.minutes(value(),phase,now=boundary),cap)
                    self.assertEqual(c.minutes(value(),phase,now=boundary-0.25),cap)
                    for now in (boundary+0.001,boundary+30,3879,3880,4480):
                        with self.subTest(now=now),self.assertRaises(RuntimeError):c.minutes(value(),phase,now=now)
    def test_refused_setup_gate_publishes_no_short_minutes_or_helper(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t).resolve();out=root/'output';fixture=dict(env(),CAPTURE_GATE=str(root),GITHUB_OUTPUT=str(out),ROOT_LIFECYCLE_CAPTURE_ADMISSION=json.dumps(value()))
            with patch.dict(os.environ,fixture,clear=True),patch.object(c.time,'time',return_value=3180),patch.object(c.sys,'argv',['caller.py','--gate','setup-controller']),patch.object(c,'Task',side_effect=AssertionError('helper must not be acquired')),self.assertRaises(RuntimeError):c.main()
            self.assertFalse(out.exists());self.assertFalse((root/'clock-setup-controller.json').exists())
    def test_episode_and_retention_still_use_original_global_cutoffs(self):
        with patch.dict(os.environ,env(),clear=True):
            self.assertEqual(c.minutes(value(),'episode',now=3180),20)
            self.assertEqual(c.retention_minutes(value(),now=4480),1)
            with self.assertRaises(RuntimeError):c.minutes(value(),'episode',now=3880)
            with self.assertRaises(RuntimeError):c.retention_minutes(value(),now=4600)

    def setup_control(self, selector, start, elapsed, *, dirty=False):
        from ci_paths_budget import active
        state=dict(wall=float(start),mono=100.);calls=[];makes=[];clocks=[]
        source=c.ROOT if selector=='controller' else self.root
        expected=value()['controller_sha'] if selector=='controller' else a.P
        original_clock=c.make_clock
        def clock_factory(v):
            clock=original_clock(v);clocks.append(clock);return clock
        def git(argv,**kw):
            self.assertEqual(kw['cwd'],source)
            calls.append(dict(argv=argv,timeout=kw['timeout'],wall=state['wall'],bound=active() is clocks[0].work))
            state['wall']+=elapsed;state['mono']+=elapsed
            if argv[1:]==['rev-parse','HEAD']:return expected+'\n'
            if argv[1:]==['status','--porcelain']:return ' M dirty\n' if dirty else ''
            self.assertEqual(argv[1:],['rev-parse','--show-toplevel']);return str(source)+'\n'
        def owned(argv,log,seconds,clock,**kw):
            clock.work.check();makes.append((argv,seconds,clock));return None
        fixture=dict(env(),CAPTURE_GATE=str(self.root),P_ROOT=str(self.root),ROOT_LIFECYCLE_CAPTURE_ADMISSION=json.dumps(value()))
        with patch.dict(os.environ,fixture,clear=True),patch.object(c.sys,'argv',['caller.py','--setup',selector]),patch.object(c.time,'time',side_effect=lambda:state['wall']),patch.object(c.time,'monotonic',side_effect=lambda:state['mono']),patch.object(c,'make_clock',side_effect=clock_factory),patch('subprocess.check_output',side_effect=git),patch.object(c,'owned',side_effect=owned):
            try:c.main()
            except (RuntimeError,TimeoutError) as error:outcome=error
            else:outcome=None
        self.assertIsNone(active())
        return calls,makes,outcome,clocks
    def test_setup_work_cutoff_clamps_first_git_and_stops_between_checks(self):
        from ci_paths_budget import BudgetExpired
        for selector in ('controller','P'):
            for elapsed in (1,2):
                with self.subTest(selector=selector,elapsed=elapsed):
                    calls,makes,error,clocks=self.setup_control(selector,3879,elapsed)
                    self.assertIsInstance(error,BudgetExpired);self.assertEqual(len(calls),1)
                    self.assertEqual(calls[0]['timeout'],1);self.assertTrue(calls[0]['bound']);self.assertFalse(makes)
    def test_setup_expired_initial_bound_starts_no_git_or_make(self):
        from ci_paths_budget import BudgetExpired
        for selector in ('controller','P'):
            with self.subTest(selector=selector),patch.object(c,'context',return_value=value()):
                calls,makes,error,_=self.setup_control(selector,3880,0)
                self.assertIsInstance(error,BudgetExpired);self.assertFalse(calls);self.assertFalse(makes)
    def test_setup_early_path_keeps_three_identity_checks_and_original_make(self):
        for selector in ('controller','P'):
            with self.subTest(selector=selector):
                calls,makes,error,clocks=self.setup_control(selector,1001,2)
                self.assertIsNone(error);self.assertEqual(len(calls),3)
                self.assertTrue(all(x['timeout']==15 and x['bound'] for x in calls))
                source=c.ROOT if selector=='controller' else self.root
                self.assertEqual(makes,[(['make','-C',str(source),'setup'],600,clocks[0])])
    def test_setup_identity_failure_still_acquires_no_make(self):
        for selector in ('controller','P'):
            with self.subTest(selector=selector):
                calls,makes,error,_=self.setup_control(selector,1001,2,dirty=True)
                self.assertIsInstance(error,RuntimeError);self.assertEqual(len(calls),3);self.assertFalse(makes)

    def test_original_producer_identity_exact_and_nonexpired(self):
        run,artifact=identities();self.assertEqual(c.transfer.artifact_identity(value(),run,artifact)['producer_sha'],a.PRODUCER['controller_sha'])
        for field,bad in [('expired',True),('digest','sha256:'+'x'*64),('size_in_bytes',1),('id',1),('name','other')]:
            changed=copy.deepcopy(artifact);changed[field]=bad
            with self.assertRaises(RuntimeError):c.transfer.artifact_identity(value(),run,changed)
        for field,bad in [('conclusion','failure'),('run_attempt',2),('event','push'),('head_sha','x'*40)]:
            changed=copy.deepcopy(run);changed[field]=bad
            with self.assertRaises(RuntimeError):c.transfer.artifact_identity(value(),changed,artifact)
    def test_metadata_is_two_direct_fixed_gets_and_no_redirect(self):
        run,artifact=identities();calls=[]
        class Response:
            status=200
            def __init__(self,req,body):self.req,self.body=req,body
            def geturl(self):return self.req.full_url
            def read(self,n):return json.dumps(self.body).encode()[:n]
            def __enter__(self):return self
            def __exit__(self,*args):pass
        class Opener:
            def open(self,req,timeout):
                calls.append((req.full_url,timeout,req.get_header('Authorization')))
                return Response(req,run if len(calls)==1 else artifact)
        with patch.dict(os.environ,env(),clear=True),patch.object(c.time,'time',return_value=1001):c.metadata(value(),self.root,opener=Opener())
        self.assertEqual([x[0] for x in calls],['https://api.github.com/repos/arcee-ai/nac/actions/runs/42455455480','https://api.github.com/repos/arcee-ai/nac/actions/artifacts/13607980704'])
        self.assertTrue(all(x[1]<=30 and x[2]=='Bearer INERT-ONLY' for x in calls))
        self.assertNotIn('INERT-ONLY',''.join(p.read_text() for p in self.root.iterdir()))
        with self.assertRaisesRegex(RuntimeError,'redirect'):c.NoRedirects().redirect_request(None,None,None,None,None,None)
    def test_outer_closed_layout_digest_and_no_follow(self):
        root=self.root/'download';root.mkdir();(root/'safe').mkdir();target=root/'safe/file';target.write_bytes(b'inert')
        expected={'safe/file':{'bytes':5,'sha256':digest(b'inert')}}
        with patch.dict(c.transfer.ARTIFACT,{'files':expected}):
            self.assertEqual(set(c.transfer.outer_files(root)),{'safe/file'})
            (root/'unexpected').write_bytes(b'x')
            with self.assertRaises(RuntimeError):c.transfer.outer_files(root)
            (root/'unexpected').unlink();target.write_bytes(b'other')
            with self.assertRaises(RuntimeError):c.transfer.outer_files(root)
            target.unlink();target.symlink_to(root/'absent')
            with self.assertRaises(RuntimeError):c.transfer.outer_files(root)
    def test_owned_runner_uses_existing_task_without_spawning_in_test(self):
        events=[]
        class FakeTask:
            def __init__(self,args,log,cap,clock,**kwargs):events.append((args,cap,kwargs))
            def start(self):return self
            def finish(self,seconds):return {'reaped':True}
        clock=SimpleNamespace(require_phase=lambda *args:None,cleanup=SimpleNamespace(deadline=1000))
        with patch.object(c,'Task',FakeTask):self.assertTrue(c.owned(['inert'],self.root/'log',600,clock,env={})['reaped'])
        self.assertEqual(events[0][1],600);self.assertEqual(events[0][2]['limit'],256*1024)
    def test_retention_one_envelope_and_no_package_or_raw_input(self):
        retained=self.root/'retained';retained.mkdir();gate=retained/'caller';gate.mkdir();(gate/'metadata.json').write_bytes(b'{}')
        episode=self.root/'episode';evidence=episode/'evidence';(evidence/'base').mkdir(parents=True);(evidence/'base/report.json').write_bytes(b'{"result":"passed"}')
        (episode/'package.zip').write_bytes(b'NOT RETAINED');(episode/'store.db').write_bytes(b'NOT A REAL DB')
        with patch.object(c,'retention_minutes',return_value=1):c.retain(value(),gate,episode,retained)
        self.assertEqual((retained/'episode/base/report.json').read_bytes(),b'{"result":"passed"}')
        self.assertFalse((retained/'package.zip').exists());self.assertFalse((retained/'store.db').exists())
        self.assertTrue((retained/'retention.json').is_file())
    def test_retention_oversize_and_symlink_refused_before_copy(self):
        retained=self.root/'retained';retained.mkdir();gate=retained/'caller';gate.mkdir();episode=self.root/'episode';evidence=episode/'evidence';evidence.mkdir(parents=True)
        bad=evidence/'bad.json';bad.write_bytes(b'x'*(256*1024+1))
        with patch.object(c,'retention_minutes',return_value=1),self.assertRaises(RuntimeError):c.retain(value(),gate,episode,retained)
        self.assertFalse((retained/'episode').exists());bad.unlink();bad.symlink_to(gate)
        with patch.object(c,'retention_minutes',return_value=1),self.assertRaises(RuntimeError):c.retain(value(),gate,episode,retained)
    def test_existing_full_nonimage_budget_cannot_expand_for_caller(self):
        retained=self.root/'retained';retained.mkdir();gate=retained/'caller';gate.mkdir();(gate/'metadata.json').write_bytes(b'{}')
        episode=self.root/'episode';evidence=episode/'evidence';evidence.mkdir(parents=True)
        for i in range(48):(evidence/(str(i)+'.json')).write_bytes(b'x'*(256*1024))
        with patch.object(c,'retention_minutes',return_value=1),self.assertRaises(RuntimeError):c.retain(value(),gate,episode,retained)
        self.assertFalse((retained/'episode').exists())

    def test_prepare_keeps_manifest_archive_and_owned_extractor_only(self):
        package=self.root/'package';download=self.root/'download';download.mkdir();manifest=download/'manifest.json';archive=download/'original.zip';manifest.write_bytes(b'inert manifest');archive.write_bytes(b'inert archive');events=[]
        (self.root/'producer-run.json').write_text('{}');(self.root/'producer-artifact.json').write_text('{}')
        fixture=value();fixture['manifest_sha256']=digest(manifest.read_bytes())
        body={'role':'canonical-lifecycle-fixture-v1','container':{'sha256':digest(archive.read_bytes())}}
        with patch.object(c.transfer,'artifact_identity'),patch.object(c.transfer,'handoff',return_value=(manifest,archive,body)),patch.object(c,'owned',side_effect=lambda argv,*args,**kwargs:events.append(argv)):
            c.prepare(fixture,None,self.root,download,package)
        self.assertEqual(events,[['/usr/bin/ditto','-x','-k',str(package/'original.zip'),str(package)]])
        self.assertEqual((package/'manifest.json').read_bytes(),manifest.read_bytes());self.assertFalse((package/'NAC.app').exists())

class Bootstrap(unittest.TestCase):
    def test_actual_inline_bootstrap_validates_and_writes_real_lines(self):
        packet=Path(os.environ['NAC_CALLER_TEST_PACKET']);source=(packet/'inline-0.py').read_text()
        ast.parse(source)
        with tempfile.TemporaryDirectory() as t:
            root=Path(t).resolve();output=root/'output';environment=root/'env'
            fixture=dict(env(),RUNNER_TEMP=str(root),GITHUB_ENV=str(environment),GITHUB_OUTPUT=str(output),ROOT_LIFECYCLE_CAPTURE_ADMISSION=json.dumps(value()))
            with patch.dict(os.environ,fixture,clear=True),patch.object(c.time,'time',return_value=1001):exec(compile(source,'inert-inline-bootstrap','exec'),{})
            self.assertEqual(output.read_bytes(),b'minutes=1\n')
            self.assertEqual(len(environment.read_text().splitlines()),5)
            self.assertEqual(json.loads((root/'native344-capture-retained/caller/initial.json').read_bytes())['status'],'PASS')
    def test_inline_refuses_old_ref_wrong_head_and_reentry(self):
        source=(Path(os.environ['NAC_CALLER_TEST_PACKET'])/'inline-0.py').read_text()
        for change in ({'GITHUB_SHA':'b'*40},{'ImageVersion':'other'},{'GITHUB_WORKFLOW_REF':'new-unregistered.yml'}):
            with self.subTest(change=change),tempfile.TemporaryDirectory() as t:
                root=Path(t).resolve();fixture=dict(env(),RUNNER_TEMP=str(root),GITHUB_ENV=str(root/'env'),GITHUB_OUTPUT=str(root/'output'),ROOT_LIFECYCLE_CAPTURE_ADMISSION=json.dumps(value()));fixture.update(change)
                with patch.dict(os.environ,fixture,clear=True),patch.object(c.time,'time',return_value=1001),self.assertRaises(RuntimeError):exec(compile(source,'inert-refusal-bootstrap','exec'),{})
                self.assertFalse((root/'output').exists())
    def test_initial_one_minute_checkout_cannot_authorize_short_setup(self):
        source=(Path(os.environ['NAC_CALLER_TEST_PACKET'])/'inline-0.py').read_text()
        with tempfile.TemporaryDirectory() as t:
            root=Path(t).resolve();output=root/'output';environment=root/'env'
            fixture=dict(env(),RUNNER_TEMP=str(root),GITHUB_ENV=str(environment),GITHUB_OUTPUT=str(output),ROOT_LIFECYCLE_CAPTURE_ADMISSION=json.dumps(value()))
            with patch.dict(os.environ,fixture,clear=True),patch.object(c.time,'time',return_value=3180):exec(compile(source,'inert-bootstrap-to-setup','exec'),{})
            self.assertEqual(output.read_bytes(),b'minutes=1\n')
            fixture.update(dict(line.split('=',1) for line in environment.read_text().splitlines()))
            with patch.dict(os.environ,fixture,clear=True),patch.object(c.time,'time',return_value=3180),patch.object(c.sys,'argv',['caller.py','--gate','setup-controller']),patch.object(c,'Task',side_effect=AssertionError('no helper acquisition')),self.assertRaises(RuntimeError):c.main()
            self.assertEqual(output.read_bytes(),b'minutes=1\n')
            self.assertFalse((root/'native344-capture-retained/caller/clock-setup-controller.json').exists())

    def test_inline_hard_deadline_retention_does_not_renew_work(self):
        source=(Path(os.environ['NAC_CALLER_TEST_PACKET'])/'inline-1.py').read_text();ast.parse(source)
        with tempfile.TemporaryDirectory() as t:
            output=Path(t)/'output'
            with patch.dict(os.environ,dict(ROOT_LIFECYCLE_CAPTURE_ADMISSION=json.dumps(value()),GITHUB_OUTPUT=str(output)),clear=True),patch.object(c.time,'time',return_value=4480):exec(compile(source,'inert-retention-clock','exec'),{})
            self.assertEqual(output.read_bytes(),b'minutes=1\n')


if __name__=='__main__':unittest.main()
