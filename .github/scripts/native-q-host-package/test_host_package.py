"""Inert clock, routing and capacity controls; no H/P import or process launch."""
import copy
import importlib.util
import json
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
        self.assertEqual(pair['P'],'478895c50034b3d2b200cce5391e098c7ec477ae')
        self.assertEqual(pair['P_parent'],'e785f5a1c4886a55c1c6edb7f6cc1d61b54879c1')
        self.assertEqual(pair['P_base'],'4b852f065e2200f46c194b4ad2c5ace3fbd766a8')
        self.assertEqual(pair['H_tools'],'9863b7714c32ed77bd66867973de6d5b02a753f8')
        self.assertEqual(pair['Q'],'04c073bbbead6f4077da0199bacd542e45cf4e57')

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
