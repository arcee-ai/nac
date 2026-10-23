"""Real process/failure controls; never run provider, SSH or container services."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).with_name('nightly-portability.py')
spec = importlib.util.spec_from_file_location('portability', SCRIPT)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class Controls(unittest.TestCase):
    def test_signal_permission_failure_remains_closed_for_live_group(self):
        with patch.object(runner.os, 'killpg', side_effect=PermissionError('denied')):
            with patch.object(runner, 'live_group_members', return_value=[{'pid': 123, 'group': 123, 'state': 'T'}]):
                with self.assertRaisesRegex(RuntimeError, 'live members'):
                    runner.signal_owned_group(123, signal.SIGKILL)
            with patch.object(runner, 'live_group_members', return_value=[]):
                runner.signal_owned_group(123, signal.SIGKILL)
            for observation in ('malformed output', ''):
                with patch.object(runner.subprocess, 'check_output', return_value=observation):
                    with self.assertRaisesRegex(RuntimeError, 'cannot inspect owned group'):
                        runner.signal_owned_group(123, signal.SIGKILL)
            with patch.object(runner.subprocess, 'check_output', side_effect=RuntimeError('ps failed')):
                with self.assertRaisesRegex(RuntimeError, 'cannot inspect owned group'):
                    runner.signal_owned_group(123, signal.SIGKILL)

    def test_actual_zombie_only_group_is_already_settled(self):
        child = subprocess.Popen([sys.executable, '-c', 'pass'], start_new_session=True,
                                 stdout=subprocess.PIPE)
        try:
            child.stdout.read()
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                state = subprocess.check_output(['ps', '-p', str(child.pid), '-o', 'stat='], text=True).strip()
                if state.startswith('Z'):
                    break
                time.sleep(.01)
            else:
                self.fail('owned child did not reach zombie barrier before reaping')
            self.assertEqual(runner.live_group_members(child.pid), [])
            runner.signal_owned_group(child.pid, signal.SIGKILL)
        finally:
            child.wait()
            child.stdout.close()

    def test_cleanup_failure_keeps_duration_and_partial_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            phases = []
            with patch.object(runner, 'signal_owned_group', side_effect=RuntimeError('cleanup denied')):
                with self.assertRaisesRegex(RuntimeError, 'cleanup denied'):
                    runner.run([sys.executable, '-c', 'print("owned fixture")'], output / 'fixture.log',
                               dict(os.environ), phases, 'fixture')
            self.assertIn('seconds', phases[0])
            report = {'platform': 'control', 'architecture': 'control', 'result': 'failed',
                      'seconds': 0, 'phases': phases + [{'label': 'interrupted', 'log': 'interrupted.log'}]}
            runner.summary(report, output)
            self.assertIn('| interrupted | interrupted | interrupted |', (output / 'summary.md').read_text())

    def test_stale_evidence_cannot_mix_candidates(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            sentinel = output / 'report.json'
            sentinel.write_text('previous candidate')
            result = subprocess.run([sys.executable, str(SCRIPT), '--output', str(output)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn('new or empty evidence directory', result.stderr)
            self.assertEqual(sentinel.read_text(), 'previous candidate')

    def test_inventory_drift_fails_closed(self):
        inventory = json.loads(runner.INVENTORY.read_text())
        listing = '\n'.join(case['name'] + ': test' for case in inventory)
        runner.verify_inventory(listing, inventory)
        for changed in (listing + '\nunreviewed::paid_test: test', listing.split('\n', 1)[1]):
            with self.assertRaisesRegex(RuntimeError, 'inventory drift'):
                runner.verify_inventory(changed, inventory)
        with self.assertRaisesRegex(RuntimeError, 'duplicate'):
            runner.verify_inventory(listing, inventory + inventory[:1])

    def test_zero_selected_or_ignored_does_not_pass(self):
        for log in ('running 0 tests', 'test exact::case ... ignored'):
            with self.assertRaisesRegex(RuntimeError, 'exact test did not pass'):
                runner.require_exact(log, 'exact::case')
        runner.require_exact('test exact::case ... ok', 'exact::case')

    def test_allowlist_and_serial_commands(self):
        # Guard the public CLI contract against accidentally including all ignored cases.
        source = SCRIPT.read_text()
        self.assertNotIn('--include-ignored', source)
        self.assertIn("'--test-threads=1'", source)
        included = [c for c in json.loads(runner.INVENTORY.read_text()) if c['disposition'] == 'included']
        self.assertEqual(len(included), 4)
        self.assertEqual(sum('process-PATH mutation' in c['capabilities'] for c in included), 2)
        self.assertFalse(any('Podman machine' in c['capabilities'] for c in included))

    def test_full_command_plan_is_serial_and_exact(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'debug').mkdir()
            (root / 'debug/nac-web').touch()
            cargo = root / 'cargo'
            cargo.write_text("""#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
inventory=json.loads(Path(os.environ['CONTROL_INVENTORY']).read_text())
if '--no-run' in sys.argv:
    assert os.environ.get('TMPDIR') == os.environ.get('CONTROL_BUILD_TMPDIR')
elif '--list' in sys.argv:
    print('\\n'.join(c['name']+': test' for c in inventory))
elif '--exact' in sys.argv:
    assert '--ignored' in sys.argv and '--test-threads=1' in sys.argv
    assert '--show-output' in sys.argv and '--nocapture' not in sys.argv
    names=[c['name'] for c in inventory if c['name'] in sys.argv]
    assert len(names)==1
    print('test '+names[0]+' ... ok')
    with open(os.environ['CONTROL_ORDER'],'a') as f: f.write(names[0]+'\\n')
elif '--workspace' in sys.argv and '--no-run' not in sys.argv:
    assert '--ignored' not in sys.argv
    with open(os.environ['CONTROL_ORDER'],'a') as f: f.write('workspace\\n')
""")
            cargo.chmod(0o700)
            sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=runner.ROOT, text=True).strip()
            order = root / 'order'
            env = dict(os.environ, CARGO=str(cargo), CARGO_TARGET_DIR=str(root),
                       CONTROL_INVENTORY=str(runner.INVENTORY), CONTROL_ORDER=str(order),
                       CONTROL_BUILD_TMPDIR=os.environ.get('TMPDIR', ''))
            result = subprocess.run([sys.executable, str(SCRIPT), '--expected-sha', sha,
                                     '--output', str(root / 'evidence')],
                                    env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            included = [c['name'] for c in json.loads(runner.INVENTORY.read_text())
                        if c['disposition'] == 'included']
            self.assertEqual(order.read_text().splitlines(), ['workspace', *included])
            report = json.loads((root / 'evidence/report.json').read_text())
            self.assertEqual(report['fixture_pids_remaining'], [])
            self.assertEqual(report['fixture_files_remaining'], [])

    def test_real_rust_seed_is_detected_once_and_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=runner.ROOT, text=True).strip()
            result = subprocess.run([sys.executable, str(SCRIPT), '--expected-sha', sha,
                                     '--seed-failure', '--output', str(output)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            report = json.loads((output / 'report.json').read_text())
            self.assertEqual(report['result'], 'failed')
            phases = report['phases']
            self.assertEqual([p['label'] for p in phases].count('portability_seeded_failure'), 1)
            self.assertEqual(phases[-1]['returncode'], 101)
            self.assertIn('portability_seeded_failure ... FAILED', (output / 'seed-failure.log').read_text())
            binary = Path(phases[-1]['command'][0])
            self.assertFalse(binary.parent.exists())
            self.assertFalse(any(p['label'] == 'workspace-default' for p in phases))

    def test_long_fixture_argv_is_visible_to_cleanup(self):
        with tempfile.TemporaryDirectory(prefix='nac-portability-long-argv-') as directory:
            fixture = Path(directory).resolve() / ('nested-' * 35) / 'fixture-marker'
            child = subprocess.Popen([sys.executable, '-c',
                                      "import time; print('ready',flush=True); time.sleep(300)",
                                      str(fixture)], stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(), 'ready')
                self.assertIn(child.pid, runner.fixture_processes(fixture))
            finally:
                child.kill()
                child.wait()
                child.stdout.close()

    def test_cancellation_kills_root_and_child_and_retains_log(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            # Execute the actual workflow shell block, so signal delivery cannot
            # accidentally stop at a wrapper shell instead of the Python supervisor.
            cargo = root / 'cargo'
            ready = root / 'ready'
            cargo.write_text("""#!/usr/bin/env python3
import os, pathlib, subprocess, sys, time
if '-V' in sys.argv:
    print('cargo cancellation fixture')
else:
    p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(300)'])
    pathlib.Path(os.environ['CONTROL_READY']).write_text(str(os.getpid())+' '+str(p.pid))
    print('ready',flush=True)
    time.sleep(300)
""")
            cargo.chmod(0o700)
            workflow = SCRIPT.parents[1] / 'workflows/nightly-portability.yml'
            block = workflow.read_text().split('      - name: Run full workspace and exact reviewed ignored cases\n')[1]
            block = block.split('        run: |\n')[1].split('      - name: Summarize')[0]
            shell = root / 'workflow-step.sh'
            shell.write_text('\n'.join(line[10:] for line in block.splitlines())+'\n')
            sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=runner.ROOT, text=True).strip()
            env = dict(os.environ, CARGO=str(cargo), CONTROL_READY=str(ready),
                       EXPECTED_SHA=sha, RUNNER_TEMP=str(root), SEED_FAILURE='false')
            wrapper_output = root / 'wrapper.log'
            wrapper_log = wrapper_output.open('w')
            process = subprocess.Popen(['bash', str(shell)], cwd=runner.ROOT, env=env,
                                       stdout=wrapper_log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 10
                while not ready.exists() and time.monotonic() < deadline:
                    time.sleep(.02)
                self.assertTrue(ready.exists(), 'child never reached readiness barrier')
                pids = [int(p) for p in ready.read_text().split()]
                process.send_signal(signal.SIGINT)
                code = process.wait(timeout=10)
                wrapper_log.flush()
                report_path = root / 'nightly-portability/report.json'
                diagnostics = wrapper_output.read_text()
                if report_path.exists():
                    diagnostics += '\n' + report_path.read_text()
                self.assertEqual(code, 130, diagnostics)
                for pid in pids:
                    result = subprocess.run(['ps', '-p', str(pid), '-o', 'stat='], capture_output=True, text=True)
                    self.assertTrue(not result.stdout.strip() or result.stdout.strip().startswith('Z'), result.stdout)
                evidence = root / 'nightly-portability'
                report = json.loads((evidence / 'report.json').read_text())
                self.assertEqual(report['result'], 'cancelled')
                self.assertIn('ready', (evidence / 'build.log').read_text())
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                wrapper_log.close()



if __name__ == '__main__':
    unittest.main()
