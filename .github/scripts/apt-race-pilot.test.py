#!/usr/bin/env python3
"""Offline result/byte controls; GNU-only real lease controls run in the pilot VM."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


pilot = load('pilot', 'apt-race-pilot.py')
worker = load('worker', 'apt-race-worker.py')
fixture = load('fixture', 'apt-archive-store.test.py')


def result(reason='completed', exit=0):
    return {'reason': reason, 'exit': exit, 'error': None, 'cleanup': {'remaining': []}}


class Boundary(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        raw = fixture.deb()
        self.row = {'Package': 'fixture-font', 'Version': '1:2.0', 'Architecture': 'all',
            'Filename': 'pool/main/f/fixture/fixture-font_2.0_all.deb', 'Size': str(len(raw)),
            'SHA256': pilot.hashlib.sha256(raw).hexdigest()}
        self.plan = {'schema': 1, 'repository': 'arcee-ai/nac', 'platform': pilot.native.PLATFORM,
                     'packages': [self.row]}
        self.arms = []
        for name in ('azure', 'official'):
            root = self.root/name
            (root/'downloads').mkdir(parents=True)
            (root/'downloads'/pilot.store.offer_name(self.row)).write_bytes(raw)
            self.arms.append((name, root, root/'apt.conf'))

    def test_complete_exact_control_and_full_inventory(self):
        self.assertEqual(pilot.verified(self.arms[0][1]/'downloads', self.plan)['fixture-font']['sha256'], self.row['SHA256'])
        (self.arms[0][1]/'downloads'/'extra').touch()
        with self.assertRaisesRegex(ValueError, 'partial/extra'):
            pilot.verified(self.arms[0][1]/'downloads', self.plan)

    def test_foreign_version_arch_variant_size_hash_and_plan_rejected(self):
        for key, value in [('repository', 'foreign/repo'), ('platform', 'ubuntu24')]:
            changed = copy.deepcopy(self.plan)
            changed[key] = value
            with self.assertRaises(ValueError):
                pilot.agree(self.plan, changed)
        for key, value in [('Version', '3'), ('Architecture', 'amd64'), ('SHA256', '0'*64),
                           ('Size', str(int(self.row['Size'])+1)), ('Filename', 'pool/a/font_2.0_amd64v3.deb')]:
            changed = copy.deepcopy(self.plan)
            changed['packages'][0][key] = value
            with self.assertRaises(ValueError):
                pilot.agree(self.plan, changed)

    def test_control_name_and_arch_corruption_with_consistent_digest(self):
        for key, value in [('Package', 'other-font'), ('Version', '3'), ('Architecture', 'amd64')]:
            changed = copy.deepcopy(self.plan)
            changed['packages'][0][key] = value
            directory = self.root/key
            directory.mkdir()
            (directory/pilot.store.offer_name(changed['packages'][0])).write_bytes(fixture.deb())
            with self.assertRaisesRegex(ValueError, 'control'):
                pilot.verified(directory, changed)

    def test_corrupt_partial_link_and_foreign_root_cleanup_refused(self):
        path = self.arms[0][1]/'downloads'/pilot.store.offer_name(self.row)
        original = path.read_bytes()
        for raw in (original[:20], b'bad'):
            path.write_bytes(raw)
            with self.assertRaises(ValueError):
                pilot.verified(path.parent, self.plan)
        path.unlink()
        outside = self.root/'outside'
        outside.write_bytes(original)
        path.symlink_to(outside)
        with self.assertRaises(OSError):
            pilot.verified(path.parent, self.plan)
        with self.assertRaisesRegex(ValueError, 'link'):
            pilot.tree_bytes(self.root)

    def test_aggregate_copy_cap_and_full_closure_bound(self):
        changed = copy.deepcopy(self.plan)
        changed['packages'][0]['Size'] = str(64*1024**2)
        with self.assertRaisesRegex(ValueError, 'aggregate archive'):
            pilot.resource_plan(changed)
        changed['packages'] *= 33
        with self.assertRaises(ValueError):
            pilot.resource_plan(changed)

    def test_actual_architecture_and_variant_preserved_without_default(self):
        text = 'APT::Architecture "amd64";\nAPT::Architecture-Variant "amd64v3";\nAPT::Architectures "";\nAPT::Architectures:: "amd64";\n'
        value = pilot.architecture(text)
        self.assertEqual(value, text.strip())
        self.assertIn(value, pilot.config(Path('/tmp/owned'), value))
        with self.assertRaises(ValueError):
            pilot.architecture(text.replace('amd64', 'arm64'))

    def fake_race(self, observed, cancelled=None):
        controller = object.__new__(pilot.Pilot)
        controller.report = {}
        controller.guard = lambda: None
        controller.deadline = time.monotonic()+1000
        records = {name: {'child': SimpleNamespace(returncode=125), 'row': {'label': name}} for name in observed}
        controller.acquire = lambda name, _root, _config, _plan: records[name.removeprefix('race-')]
        calls = {name: 0 for name in observed}
        def read(record):
            name = record['row']['label']
            values = observed[name]
            value = values[min(calls[name], len(values)-1)]
            calls[name] += 1
            return value
        controller.result = read
        controller.cancel = lambda _record, _reason: cancelled or result('winner-cancelled', -15)
        return controller

    def test_first_failure_beats_winner_in_either_order(self):
        for values in ({'azure': result(), 'official': result('failed', 100)},
                       {'official': result(), 'azure': result('failed', 100)}):
            controller = self.fake_race({k: [v] for k,v in values.items()})
            with self.assertRaisesRegex(ValueError, 'unexpected acquisition failure'):
                controller.race(self.arms, self.plan)

    def test_late_error_during_verification_cannot_hide_as_cancel(self):
        controller = self.fake_race({'azure': [result()], 'official': [None, result('failed', 100)]})
        with self.assertRaisesRegex(ValueError, 'unexpected acquisition failure'):
            controller.race(self.arms, self.plan)
        controller = self.fake_race({'azure': [result()], 'official': [None]}, result('failed', 100))
        with self.assertRaisesRegex(ValueError, 'unexpected loser failure'):
            controller.race(self.arms, self.plan)

    def test_winner_cancels_only_redundant_owned_arm_and_tie_verifies_both(self):
        for winner in ('azure', 'official'):
            values = {name: [result() if name == winner else None] for name in ('azure', 'official')}
            controller = self.fake_race(values)
            self.assertEqual(controller.race(self.arms, self.plan), next(root for name,root,_ in self.arms if name == winner))
            self.assertEqual(controller.report['race']['winner'], winner)
        controller = self.fake_race({'azure': [result()], 'official': [result()]})
        controller.race(self.arms, self.plan)
        self.assertEqual(set(controller.report['race']['completed_verified']), {'azure', 'official'})
        (self.arms[1][1]/'downloads'/pilot.store.offer_name(self.row)).write_bytes(b'bad')
        with self.assertRaises(ValueError):
            controller.race(self.arms, self.plan)

    def test_network_signature_timeout_leak_receipts_not_success(self):
        for why, code in [('failed', 100), ('timeout', -9), ('parent-loss', -15), ('signal', -15), ('leak', 0)]:
            with self.assertRaisesRegex(ValueError, 'unexpected acquisition failure'):
                pilot.elect({'native-signed-command': result(why, code)})
        value = result()
        value['cleanup']['remaining'] = [{'pid': 123}]
        with self.assertRaises(ValueError):
            pilot.elect({'bad': value})

    def test_full_native_solver_uri_and_authenticated_metadata_join(self):
        solver = 'Inst fixture-font (1:2.0 Ubuntu:26.04/resolute [all])\n'
        name = pilot.store.offer_name(self.row)
        uri = f"'mirror+file:/etc/apt/apt-mirrors.txt/{self.row['Filename']}' {name} {self.row['Size']} MD5Sum:unused\n"
        records = '\n'.join(key+': '+value for key,value in self.row.items())+'\n'
        self.assertEqual(pilot.selection(solver, uri, records, 'arcee-ai/nac'), self.plan)
        for broken in [uri.replace(self.row['Filename'], 'pool/main/foreign.deb'), uri+uri]:
            with self.assertRaises(ValueError):
                pilot.selection(solver, broken, records, 'arcee-ai/nac')
        with self.assertRaises(ValueError):
            pilot.selection('Remv old-font\n'+solver, uri, records, 'arcee-ai/nac')

    def test_stop_nonce_and_link_ownership(self):
        path = self.root/'stop'
        path.write_text(json.dumps({'nonce': 'a'*32, 'reason': 'winner-cancelled'}))
        self.assertEqual(worker.stop(path, 'a'*32), 'winner-cancelled')
        with self.assertRaises(ValueError):
            worker.stop(path, 'b'*32)
        path.unlink()
        path.symlink_to(self.root/'outside')
        with self.assertRaises(OSError):
            worker.stop(path, 'a'*32)

    def test_foreign_root_replacement_not_removed_and_resource_fences(self):
        with patch.dict(os.environ, {'RUNNER_TEMP': str(self.root), 'PILOT_JOB_STARTED': str(time.time())}):
            controller = pilot.Pilot(self.root/'output')
        (controller.root/'part').write_bytes(b'123456')
        with patch.object(pilot, 'TOTAL_CAP', 1):
            with self.assertRaisesRegex(ValueError, 'owned total'):
                controller.guard()
        moved = controller.root.with_name(controller.root.name+'-moved')
        controller.root.rename(moved)
        controller.root.mkdir()
        (controller.root/'sentinel').write_text('foreign replacement')
        controller.finish()
        self.assertEqual((controller.root/'sentinel').read_text(), 'foreign replacement')
        self.assertEqual(controller.report['status'], 'failed')
        self.assertIn('refuse foreign', controller.report['cleanup_failures'][0])

    def test_absolute_job_clock_and_full_native_admission_refusal(self):
        self.assertEqual(pilot.budget_deadline(1000, 1100, 50), 2150)
        self.assertEqual(pilot.budget_deadline(1000, 2300, 50), 1120)
        controller = object.__new__(pilot.Pilot)
        controller.guard = lambda: None
        controller.deadline = time.monotonic()+929
        with patch.object(pilot.subprocess, 'Popen') as spawn:
            with self.assertRaisesRegex(pilot.BudgetNotExecuted, 'not launched'):
                controller.start('not-run', ['/native'], self.root)
            spawn.assert_not_called()
        controller.deadline = time.monotonic()+931
        controller.admit()
        with self.assertRaises(ValueError):
            pilot.budget_deadline(1000, 999, 50)

    def test_budget_refusal_drains_existing_operation_without_cancel(self):
        controller = object.__new__(pilot.Pilot)
        controller.deadline = time.monotonic()+1
        controller.active = ['already-admitted']
        calls = []
        def completed(value):
            calls.append(value)
            if len(calls) == 2:
                controller.active.remove(value)
        controller.result = completed
        controller.cancel = lambda *_args: self.fail('budget refusal shortened an admitted operation')
        controller.drain_budget()
        self.assertEqual(calls, ['already-admitted', 'already-admitted'])


@unittest.skipUnless(sys.platform == 'linux', 'actual Linux subreaper/pidfd controls run in private hosted VM only')
class LinuxLease(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.children = []
        self.addCleanup(self.cleanup)

    def cleanup(self):
        for child in self.children:
            if child.poll() is None:
                child.terminate()
            try:
                child.wait(timeout=8)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
                self.fail('owned fixture child required forced termination')
        destination = os.environ.get('APT_RACE_CONTROL_EVIDENCE')
        if destination:
            copied = Path(destination)/self._testMethodName
            shutil.copytree(self.root, copied)

    def launch(self, text):
        state = self.root/('worker-'+str(len(self.children)))
        state.mkdir(mode=0o700)
        me = pilot.supervisor.process(os.getpid())
        child = subprocess.Popen([sys.executable, str(Path(worker.__file__)), '--state', str(state),
            '--cwd', str(self.root), '--parent', str(os.getpid()), '--start', str(me['start']), '--nonce', 'a'*32,
            '--deadline', str(time.monotonic()+1000), '--', sys.executable, '-c', text], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.children.append(child)
        deadline = time.monotonic()+5
        while not (state/'ready.json').exists():
            self.assertIsNone(child.poll())
            self.assertLess(time.monotonic(), deadline)
            time.sleep(.01)
        return child, state

    def test_real_escaped_term_ignoring_child_cancel_and_foreign_sentinel(self):
        sentinel = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(30)'])
        self.children.append(sentinel)
        marker = self.root/'escaped'
        code = f"import os,signal,time,pathlib; p=os.fork(); os.setsid() if p==0 else None; signal.signal(signal.SIGTERM,signal.SIG_IGN); pathlib.Path({str(marker)!r}).write_text(str(os.getpid())) if p==0 else None; time.sleep(30)"
        child, state = self.launch(code)
        deadline = time.monotonic()+5
        while not marker.exists():
            self.assertLess(time.monotonic(), deadline)
            time.sleep(.01)
        pilot.write(state/'stop', {'nonce': 'a'*32, 'reason': 'winner-cancelled'})
        child.wait(timeout=8)
        value = json.loads((state/'result.json').read_text())
        self.assertEqual(child.returncode, 125)
        self.assertEqual(value['cleanup']['remaining'], [])
        self.assertTrue(value['cleanup']['signals'])
        self.assertFalse(Path('/proc', marker.read_text()).exists())
        self.assertIsNone(sentinel.poll())

    def test_real_sigint_sigterm_fail_with_cleanup(self):
        for sig in (signal.SIGINT, signal.SIGTERM):
            child, state = self.launch('import time;time.sleep(30)')
            child.send_signal(sig)
            child.wait(timeout=8)
            value = json.loads((state/'result.json').read_text())
            self.assertNotEqual(child.returncode, 0)
            self.assertEqual(value['reason'], 'signal')
            self.assertEqual(value['cleanup']['remaining'], [])

    def test_real_parent_loss_reaps_owned_child(self):
        state = self.root/'parent-loss'
        state.mkdir(mode=0o700)
        source = f'''import os,subprocess,sys,time
import importlib.util
s=importlib.util.spec_from_file_location('supervisor',{pilot.supervisor.__file__!r})
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
me=m.process(os.getpid())
subprocess.Popen([sys.executable,{worker.__file__!r},'--state',{str(state)!r},'--cwd',{str(self.root)!r},'--parent',str(os.getpid()),'--start',str(me['start']),'--nonce',{'b'*32!r},'--deadline',str(time.monotonic()+1000),'--',sys.executable,'-c','import time;time.sleep(30)'])
from pathlib import Path
end=time.monotonic()+5
while not Path({str(state/'ready.json')!r}).exists():
 if time.monotonic()>end:sys.exit(3)
 time.sleep(.01)
os._exit(0)
'''
        parent = subprocess.Popen([sys.executable, '-c', source])
        self.children.append(parent)
        parent.wait(timeout=8)
        self.assertEqual(parent.returncode, 0)
        deadline = time.monotonic()+8
        while not (state/'result.json').exists():
            self.assertLess(time.monotonic(), deadline)
            time.sleep(.01)
        value = json.loads((state/'result.json').read_text())
        self.assertEqual(value['reason'], 'parent-loss')
        self.assertEqual(value['cleanup']['remaining'], [])

    def test_real_worker_budget_refusal_never_spawns_command(self):
        state = self.root/'refused'
        state.mkdir(mode=0o700)
        marker = self.root/'must-not-exist'
        me = pilot.supervisor.process(os.getpid())
        completed = subprocess.run([sys.executable, worker.__file__, '--state', str(state),
            '--cwd', str(self.root), '--parent', str(os.getpid()), '--start', str(me['start']),
            '--nonce', 'c'*32, '--deadline', str(time.monotonic()+100), '--', sys.executable,
            '-c', f'from pathlib import Path;Path({str(marker)!r}).touch()'], capture_output=True, timeout=5)
        self.assertNotEqual(completed.returncode, 0)
        value = json.loads((state/'result.json').read_text())
        self.assertEqual(value['reason'], 'budget-not-executed')
        self.assertIsNone(value['exit'])
        self.assertFalse(marker.exists())
        self.assertFalse((state/'ready.json').exists())


if __name__ == '__main__':
    unittest.main()
