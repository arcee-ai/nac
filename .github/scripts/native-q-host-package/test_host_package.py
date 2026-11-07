"""Inert clock, routing and capacity controls; no H/P import or process launch."""
import copy
import importlib.util
import json
import os
import sys
import tempfile
import textwrap
from unittest.mock import patch
from pathlib import Path
import unittest

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('host_package', HERE/'host-package.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ClockRouting(unittest.TestCase):
    def values(self):
        a = dict(scope=m.SCOPE, controller_sha='a'*40, allocation_id='Root-hosted-1', attempt=1, retries=0,
                 clock=dict(STARTED=1000, WORK_DEADLINE=2800, CLEANUP_DEADLINE=3280, HARD_DEADLINE=3400))
        e = dict(GITHUB_SHA='a'*40, GITHUB_REF=m.BRANCH, GITHUB_EVENT_NAME='workflow_dispatch', GITHUB_RUN_ATTEMPT='1')
        return a, e

    def test_original_queue_time_and_reserves_cannot_be_renewed(self):
        a,e = self.values()
        self.assertEqual(m.admit(a,e,now=2700),(1000,2800,3280,3400))
        for stamp in [999,2800,3400,float('nan')]:
            with self.subTest(stamp=stamp), self.assertRaises(RuntimeError):
                m.admit(a,e,now=stamp)
        for key,value in [('STARTED',True),('WORK_DEADLINE',2801),('CLEANUP_DEADLINE',3279),
                          ('HARD_DEADLINE',3401),('STARTED',float('inf'))]:
            b=copy.deepcopy(a); b['clock'][key]=value
            with self.subTest(key=key,value=value),self.assertRaises(RuntimeError):
                m.admit(b,e,now=1001)

    def test_retries_other_sources_and_nonmanual_routes_fail_closed(self):
        a,e=self.values()
        for key,value in [('scope','onboarding'),('controller_sha','b'*40),('attempt',2),('retries',1),('extra',True)]:
            with self.subTest(key=key),self.assertRaises(RuntimeError):
                m.admit({**a,key:value},e,now=1001)
        for key,value in [('GITHUB_REF','refs/heads/dev'),('GITHUB_REF','refs/heads/codex/experimental-native-q-host-package'),('GITHUB_EVENT_NAME','push'),('GITHUB_RUN_ATTEMPT','2')]:
            with self.subTest(key=key),self.assertRaises(RuntimeError):
                m.admit(a,{**e,key:value},now=1001)

    def test_bootstrap_and_retention_are_original_remaining_time_only(self):
        a,e=self.values()
        self.assertEqual(m.minutes(a,e,3,now=1001),3)
        self.assertEqual(m.minutes(a,e,3,now=2600),2)
        with self.assertRaises(RuntimeError):m.minutes(a,e,3,now=2741)
        self.assertEqual(m.minutes(a,e,2,now=3410,retention=True),0)

    def test_capacity_requires_positive_actual_integer_observations(self):
        m.capacity(6*1024**3,8*1024**3,2)
        for values in [(0,8*1024**3,2),(6*1024**3,0,2),(6*1024**3,8*1024**3,True)]:
            with self.subTest(values=values),self.assertRaises(RuntimeError):m.capacity(*values)

    def test_clock_adapter_keeps_fixed_deadline_and_latches_discontinuity(self):
        class Bound:
            def __init__(self,owner,deadline,kind):self.deadline=deadline
        class Fake:
            mono=100; epoch=2000
        f=Fake()
        c=m.PackageClock((1000,2800,3280,3400),Bound,10000,monotonic=lambda:f.mono,wall=lambda:f.epoch)
        self.assertEqual(c.work.deadline,900)
        f.mono+=50; f.epoch+=50; c.observe()
        self.assertEqual(c.work.deadline,900)
        f.epoch+=5
        with self.assertRaises(RuntimeError):c.observe()
        f.epoch-=5
        with self.assertRaises(RuntimeError):c.observe()
        self.assertEqual(c.work.deadline,900)

    def test_fixed_plan_builds_only_P_dev_and_never_actor_or_H(self):
        stages=m.plan(Path('/P'),Path('/out'))
        self.assertEqual([x[0] for x in stages],['prepare-engine','normal','verify','relocate-check'])
        self.assertEqual(stages[0][2][3:],['prepare-engine','--track','dev','--output','/out/engine'])
        for _,cap,argv in stages:
            self.assertLessEqual(cap,1080)
            self.assertEqual(argv[2],'/P/desktop/macos/packaging/package.py')
            self.assertFalse(any(x in argv for x in ['fixture','smoke','app-run','xcodebuild','test-without-building','distribution-plan']))
        pair=json.loads((HERE/'pair.json').read_text())
        self.assertEqual(pair['P'],'6c578a2c18050e218b83daf80f46731040e4b3e4')
        self.assertEqual(pair['P_parent'],'478895c50034b3d2b200cce5391e098c7ec477ae')
        self.assertEqual(pair['P_native_base'],'e785f5a1c4886a55c1c6edb7f6cc1d61b54879c1')
        self.assertEqual(pair['source_context'],'4b852f065e2200f46c194b4ad2c5ace3fbd766a8')
        self.assertEqual(pair['H_tools'],'9863b7714c32ed77bd66867973de6d5b02a753f8')
        self.assertEqual(pair['Q'],'04c073bbbead6f4077da0199bacd542e45cf4e57')

    def test_initial_image_gate_records_and_rejects_before_bootstrap(self):
        text=(HERE.parents[1]/'workflows/stable-release.yml').read_text()
        body=text.split("          python3 -B - <<'PYCODE'\n",1)[1].split('          PYCODE\n',1)[0]
        code=compile(textwrap.dedent(body),'initial-image-inert','exec')
        expected=json.loads((HERE/'pair.json').read_text())['host_image']
        for actual in [expected,None,'','20261026.0455.2']:
            with self.subTest(actual=actual),tempfile.TemporaryDirectory() as directory:
                a,e=self.values()
                output=Path(directory)/'output'
                e.update(ROOT_PACKAGE_ADMISSION=json.dumps(a),RUNNER_TEMP=directory,GITHUB_OUTPUT=str(output))
                if actual is not None:e['ImageVersion']=actual
                with patch.dict(os.environ,e,clear=True),patch('time.time',return_value=1001):
                    if actual==expected:exec(code,{})
                    else:
                        with self.assertRaises(AssertionError):exec(code,{})
                receipt=json.loads((Path(directory)/'ff8-host-package-gate/initial.json').read_text())
                self.assertEqual(receipt['actual_image'],actual)
                self.assertEqual(receipt['expected_image'],expected)
                self.assertFalse(receipt['product_build'])
                self.assertEqual(receipt['status'],'PASS' if actual==expected else 'FAIL')
                self.assertEqual(output.exists(),actual==expected)

    def test_cache_partial_restore_is_distinct_from_true_miss_and_stale_engine(self):
        a,_=self.values()
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory).resolve()/'target'
            deps=target/'aarch64-apple-darwin/release/deps'
            before=dict(status='PASS',target_absent=True,target=str(target),controller_sha=a['controller_sha'],
                        allocation_id=a['allocation_id'],original_clock=a['clock'])
            for hit in ['true','false']:
                with self.assertRaises(RuntimeError):m.cache_ready(target,before,a,1530,hit)
            deps.mkdir(parents=True)
            with self.assertRaises(RuntimeError):m.cache_ready(target,before,a,1530,'false')
            (deps/'libdependency.rlib').write_bytes(b'inert-cache-fixture')
            for hit in ['true','false']:
                self.assertEqual(m.cache_ready(target,before,a,1530,hit)['exact_hit'],hit=='true')
            for seconds in [1529,0,True,float('nan')]:
                with self.subTest(seconds=seconds),self.assertRaises(RuntimeError):
                    m.cache_ready(target,before,a,seconds,'false')
            for key,value in [('target_absent',False),('controller_sha','b'*40),('allocation_id','old'),('original_clock',{})]:
                with self.subTest(key=key),self.assertRaises(RuntimeError):
                    m.cache_ready(target,{**before,key:value},a,1530,'false')
            with self.assertRaises(RuntimeError):m.cache_ready(target,before,a,1530,None)
            (deps.parent/'nac-web').write_bytes(b'stale-engine')
            with self.assertRaises(RuntimeError):m.cache_ready(target,before,a,1530,'true')

    def test_actual_cache_bootstrap_requires_fresh_target_and_binds_receipt(self):
        source=(HERE/'host-package.py').read_text()
        for preexisting in [False,True]:
            with self.subTest(preexisting=preexisting),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve()
                workspace=root/'workspace';workspace.mkdir()
                (root/'ff8-host-package-gate').mkdir()
                target=workspace/'target'
                if preexisting:target.mkdir()
                a,e=self.values()
                e.update(ROOT_PACKAGE_ADMISSION=json.dumps(a),RUNNER_TEMP=str(root),
                         GITHUB_WORKSPACE=str(workspace),GITHUB_OUTPUT=str(root/'output'))
                with patch.dict(os.environ,e,clear=True),patch('time.time',return_value=1001), \
                     patch.object(sys,'argv',['host-package.py','--bootstrap-budget','restore-cache']):
                    if preexisting:
                        with self.assertRaises(RuntimeError):exec(compile(source,'cache-bootstrap-inert','exec'),{'__name__':'__main__'})
                    else:exec(compile(source,'cache-bootstrap-inert','exec'),{'__name__':'__main__'})
                receipt=json.loads((root/'ff8-host-package-gate/clock-restore-cache.json').read_text())
                self.assertEqual(receipt['status'],'FAIL' if preexisting else 'PASS')
                if not preexisting:
                    self.assertFalse(target.exists())
                    self.assertEqual(receipt['controller_sha'],a['controller_sha'])
                    self.assertEqual(receipt['allocation_id'],a['allocation_id'])
                    self.assertEqual(receipt['minutes'],2)

    def test_cache_bootstrap_never_renews_original_time(self):
        a,e=self.values()
        self.assertEqual(m.CAPS['restore-cache'],2)
        self.assertEqual(m.minutes(a,e,m.CAPS['restore-cache'],now=1001),2)
        self.assertEqual(m.minutes(a,e,m.CAPS['restore-cache'],now=2680),1)
        with self.assertRaises(RuntimeError):m.minutes(a,e,m.CAPS['restore-cache'],now=2741)

    def test_workflow_is_exact_guarded_private_package_route(self):
        text=(HERE.parents[1]/'workflows/stable-release.yml').read_text()
        self.assertIn('timeout-minutes: 40',text)
        self.assertIn("github.ref == '"+m.BRANCH+"'",text)
        self.assertIn("github.run_attempt == 1",text)
        self.assertIn('contents: read',text)
        pair=json.loads((HERE/'pair.json').read_text())
        self.assertIn("assert p['P']=='"+pair['P']+"'",text)
        self.assertNotIn("github.ref == 'refs/heads/codex/experimental-native-q-host-package'",text)
        self.assertNotIn('contents: write',text)
        self.assertNotIn('pull_request:',text)
        self.assertNotIn('secrets.',text)
        self.assertIn('ff8-host-package-output/handoff',text)
        self.assertNotIn('upload-artifact@main',text)
        self.assertIn("steps.retention.outputs.minutes != '0'",text)
        source=(HERE/'host-package.py').read_text()
        self.assertIn('ci.run(argv, log, cap',source)
        self.assertNotIn('subprocess.Popen',source)
        self.assertNotIn('run_case(',source)
        self.assertNotIn('xcodebuild',source.replace("['xcodebuild', '-version']",''))


if __name__ == '__main__':
    unittest.main()
