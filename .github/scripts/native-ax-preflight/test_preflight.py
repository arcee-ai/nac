"""Inert controls: fake owners/callbacks only; never launch, AX, input or signal."""
import contextlib
import copy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('diagnostic', Path(__file__).with_name('preflight.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class Admission(unittest.TestCase):
    def value(self):
        return dict(scope=p.SCOPE, controller_sha='a'*40, allocation_id='Root-distinct-diagnostic', attempt=1, retries=0,
            manifest_sha256=p.MANIFEST, producer=copy.deepcopy(p.PRODUCER),
            clock=dict(STARTED=1000, WORK_DEADLINE=3880, CLEANUP_DEADLINE=4480, HARD_DEADLINE=4600))

    def test_real_source_blocks_unnominated_H_before_bootstrap(self):
        with self.assertRaisesRegex(RuntimeError, 'not nominated'):
            p.admit(self.value(), 'a'*40, now=1001)

    def test_exact_p10_only_and_original_clock_even_after_nomination(self):
        pair = json.loads((p.HERE/'pair.json').read_text())
        pair['H_nomination_ready'] = True
        with patch.object(Path, 'read_text', return_value=json.dumps(pair)):
            self.assertEqual(p.admit(self.value(), 'a'*40, now=1001), (1000,3880,4480,4600))
            changes = [dict(scope=p.legacy.SCOPE), dict(attempt=2), dict(retries=1),
                       dict(controller_sha='b'*40), dict(manifest_sha256='0'*64),
                       dict(producer={**p.PRODUCER, 'artifact_id':13601342195}),
                       dict(clock={**self.value()['clock'], 'STARTED':False}),
                       dict(clock={**self.value()['clock'], 'HARD_DEADLINE':float('nan')})]
            for changed in changes:
                with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                    p.admit({**self.value(), **changed}, 'a'*40, now=1001)
            with self.assertRaises(RuntimeError):
                p.admit(self.value(), 'a'*40, now=3880)


class Lifecycle(unittest.TestCase):
    def execute(self, *, fail_capture=False, fail_launch=False, fail_cleanup=False, fail_integrity=False):
        events=[]
        class Witness:
            def __init__(self,*args):
                self.ready=False; self.history={}; self.failure=None
            def start(self,*args):
                events.append('observer'); self.ready=True
            def settle(self,*args):
                events.append('settle')
                if fail_cleanup: raise RuntimeError('unknown')
                return dict(root=str(root/'fixture'),owned_processes_settled=True)
            def stop(self): events.append('stop')
            def failure_receipt(self): return dict(positive_settlement=False)
        def capture(*args,**kwargs):
            events.append('capture')
            if fail_capture: raise RuntimeError('AX not trusted')
            return dict(acceptance=False, trusted=True, bound=True, identity_rechecked=True)
        def command(argv,*args,**kwargs):
            events.append('launch')
            self.assertEqual(argv[0:2], ['/usr/bin/open','-a'])
            self.assertNotIn('-n',argv)
            self.assertNotIn('--instance-mode',argv)
            if fail_launch: raise RuntimeError('launch refused')
        def integrity(*args):
            events.append('integrity')
            if fail_integrity: raise RuntimeError('changed')
        def package(*args,**kwargs): return dict(normal=True)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            (root/'desktop/macos').mkdir(parents=True)
            (root/'desktop/macos/CIStartupObserver.swift').write_text('inert source bytes')
            config_path=root/'config.json'; config_path.write_text('{}')
            helper=root/'helper'; helper.write_bytes(b'never executed')
            profile=dict(root=root/'fixture')
            config=dict(app_path=str(root/'fixture/NAC.app'),home=str(root/'fixture/home'),environment={})
            startup=SimpleNamespace(prepare_profile=lambda *a,**k:profile,
                prepare_configuration=lambda *a,**k:(config,config_path,dict(normal=True)),
                test_contract=lambda *a:None,package_contract=package,immutable_snapshot=lambda *a:{},
                cleanup_receipt=lambda x:x,require_integrity=integrity,
                remove_profile=lambda *a:events.append('remove'))
            clock=SimpleNamespace(work=object(),cleanup=object(),cleaning=False,failed=[],fail=lambda x:events.append('failed'))
            owner=SimpleNamespace(OwnerWitness=Witness,capture_ax_preflight=capture)
            def ready(*args): events.append('binding');return dict(owned_incarnation_verified=True)
            with patch.object(p,'wait_owned',side_effect=ready):
                result=p.episode(startup,owner,clock,lambda x:contextlib.nullcontext(),folder=root,
                    profiles=root,app=root/'NAC.app',manifest=root/'manifest.json',roots=dict(H=root,P=root,Q=root),
                    pair=dict(H='h',P='p',Q='q'),helper=helper,run=command)
        return result,events

    def test_one_launch_one_capture_preinstalled_owner_and_positive_cleanup(self):
        result,events=self.execute()
        self.assertEqual(events,['observer','launch','binding','capture','settle','stop','integrity','remove'])
        self.assertEqual((result['status'],result['launch_attempts'],result['capture_attempts']),('GO',1,1))
        self.assertIs(result['acceptance'],False)

    def test_untrusted_or_failed_capture_always_cleans_and_never_qualifies(self):
        result,events=self.execute(fail_capture=True)
        self.assertEqual(result['status'],'NO_GO')
        self.assertEqual(events.count('capture'),1)
        self.assertEqual(events[-4:],['settle','stop','integrity','remove'])
        self.assertIs(result['acceptance'],False)

    def test_launch_failure_never_probes_but_still_uses_owner_cleanup(self):
        result,events=self.execute(fail_launch=True)
        self.assertNotIn('capture',events)
        self.assertIn('settle',events)
        self.assertEqual(result['capture_attempts'],0)
        self.assertEqual(result['status'],'NO_GO')

    def test_unknown_cleanup_and_integrity_preserve_custody(self):
        for failure in ('fail_cleanup','fail_integrity'):
            with self.subTest(failure=failure):
                result,events=self.execute(**{failure:True})
                self.assertNotIn('remove',events)
                self.assertEqual(result['status'],'NO_GO')
                self.assertIn('retained_profile',result)
                self.assertIn('stop',events)


class CurrentOwnership(unittest.TestCase):
    def test_only_current_single_window_and_single_serving_engine_bind(self):
        app = dict(kind='app', pid=20, windows=[7])
        engine = dict(kind='engine', pid=21, serving=True)
        clock = SimpleNamespace(require_phase=lambda *a:None, observe=lambda:None)
        def witness(latest, failure=None):
            return SimpleNamespace(condition=threading.Condition(), latest=latest, app=app,
                failure=failure, attachment_binding=lambda:dict(pid=20,window=7))
        self.assertEqual(p.wait_owned(witness([app,engine]),clock,seconds=0),dict(pid=20,window=7))
        # A retained prior app, hidden/multiple windows, a missing engine, or a
        # second serving engine cannot be promoted to a fresh binding.
        invalid = [[engine], [{**app,'pid':30},engine], [{**app,'windows':[]},engine],
                   [{**app,'windows':[7,8]},engine], [app], [app,engine,{**engine,'pid':22}]]
        for latest in invalid:
            with self.subTest(latest=latest), self.assertRaises(RuntimeError):
                p.wait_owned(witness(latest),clock,seconds=0)
        with self.assertRaises(RuntimeError):
            p.wait_owned(witness([app,engine],failure='unknown'),clock,seconds=0)


if __name__ == '__main__':
    unittest.main()
