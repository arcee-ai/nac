#!/usr/bin/env python3
"""Offline proof wiring/guards; no Docker, Cargo, scanner or network execution."""
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
SPEC = importlib.util.spec_from_file_location('proof', Path(__file__).with_name('image-incremental-proof.py'))
proof = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(proof)
ROOT = Path(__file__).resolve().parents[2]
LOCAL = ['nac-contracts', 'nac-core', 'nac-server', 'nac-managed', 'nac-process', 'nac-credential-store']


class ProofControls(unittest.TestCase):
    def test_exact_real_pair_and_all_seven_manifests_preserved(self):
        original = (ROOT/'docker/managed/Dockerfile').read_text()
        text = proof.candidate_dockerfile(original, 'nac-image-incremental-123-1-candidate')
        self.assertEqual(proof.digest(original.encode()), proof.DOCKERFILE_SHA)
        self.assertEqual(text.count(proof.CACHE_ENV), 2)
        for line in original.splitlines():
            if line.startswith(('FROM ', 'COPY ', 'ARG ', 'ENV ', 'USER ', 'ENTRYPOINT ')):
                self.assertIn(line, text)
        self.assertEqual(text.count('COPY crates/'), 7)
        self.assertLess(text.index('COPY . .'), text.index('RUN cargo clean'))
        self.assertIn('RUN cargo clean --release --locked --offline --workspace\nRUN --mount=', text)
        self.assertNotIn('target=/src/nac/target,', text)
        self.assertIn('NAC_IMAGE_INCREMENTAL_PRE_UNITS', text)
        self.assertIn('test "$kib" -le 4194304', text)
        self.assertNotIn('NAC_IMAGE_INCREMENTAL', original)

    def test_unknown_source_and_cache_id_rejected(self):
        original = (ROOT/'docker/managed/Dockerfile').read_text()
        for text, cache in [(original+'\n', 'nac-image-incremental-1-1-candidate'),
                            (original, 'global'), (original, 'nac-image-incremental-1-1-candidate,ro'),
                            (original, 'nac-image-incremental-1-1-candidate\nRUN evil')]:
            with self.subTest(cache=cache), self.assertRaises(ValueError):
                proof.candidate_dockerfile(text, cache)

    def test_source_compiles_separated_from_new_dependency_profile(self):
        lines = ['#10 [build 12/15] RUN cargo build -vv --release',
                 '#10 1.0 Compiling syn v1.0.0', '#10 1.1 Compiling nac-server v0.1.4',
                 '#22 [build 15/15] RUN CARGO_INCREMENTAL=1 NAC_SOURCE_REVISION="abc" cargo build -vv --release']
        lines += ['#22 1.0 Compiling '+name+' v0.1.0' for name in LOCAL]
        lines += ['#22 1.1 Running `rustc -C codegen-units=16 -C incremental=/src/nac/target/release/incremental/nac_web-abc`']
        result = proof.compilation('\n'.join(lines))
        self.assertEqual(result['source']['local'], LOCAL)
        self.assertEqual(result['source']['external'], [])
        self.assertEqual(result['all']['external'], ['syn'])
        self.assertTrue(result['incremental_rustc_flag'])
        self.assertTrue(result['codegen16_rustc_flag'])
        self.assertFalse(result['source_run_cached'])
        # Stub compiles must not stand in for actual source compilation.
        cached = proof.compilation('\n'.join(lines[:3]+[lines[3], '#22 CACHED']))
        self.assertEqual(cached['source']['local'], [])
        self.assertTrue(cached['source_run_cached'])
        with self.assertRaises(ValueError):
            proof.compilation('\n'.join(lines[:3]))

    def test_usage_is_conservative_and_schema_unit_fail_closed(self):
        rows = [{'Type': t, 'Size': '1.00GB'} for t in
                ('Images', 'Containers', 'Local Volumes', 'Build Cache')]
        text = '\n'.join(json.dumps(row) for row in rows)
        self.assertGreater(proof.docker_bytes(text), 4*1000**3)
        for bad in [rows[:3], rows+[rows[0]], [{**r, 'Size': 'NaNGB'} for r in rows],
                    [{**r, 'Size': '1.00GiB'} for r in rows]]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                proof.docker_bytes('\n'.join(json.dumps(r) for r in bad))

    def test_plain_child_environment_and_log_redaction(self):
        with tempfile.TemporaryDirectory() as value:
            p = proof.Proof(ROOT, Path(value), {'PATH': os.environ['PATH'],
                'ACTIONS_RUNTIME_TOKEN': 'private-runtime-token', 'GH_TOKEN': 'private-gh-token',
                'AWS_SECRET_ACCESS_KEY': 'unrelated-secret'})
            self.assertEqual(set(p.plain), {'PATH'})
            self.assertEqual(p.redact(b'private-runtime-token private-gh-token'), b'*** ***')
            self.assertEqual(p.redact(b'https://host/path?sig=generated&x=1'), b'https://host/path?sig=***&x=1')
            self.assertNotIn('TOKEN', json.dumps(p.report))

    def test_resource_failure_stops_before_next_command(self):
        with tempfile.TemporaryDirectory() as value:
            p = proof.Proof(ROOT, Path(value), {})
            with patch.object(proof.shutil, 'disk_usage') as disk:
                disk.return_value.free = 12*proof.GIB
                with self.assertRaisesRegex(ValueError, 'host free reserve'):
                    p.guard()
            self.assertFalse(p.commands)
            p.cleanup_deadline = time.monotonic()-1
            with self.assertRaisesRegex(ValueError, 'cleanup deadline'):
                p.command('expired-cleanup', [sys.executable, '-c', 'raise SystemExit(0)'], monitor=False)
            self.assertNotIn('pid', p.commands[-1])

    def test_logical_budget_and_foreign_container_cleanup_fail_closed(self):
        with tempfile.TemporaryDirectory() as value:
            p = proof.Proof(ROOT, Path(value), {})
            rows = [{'Type': t, 'Size': '5GB'} for t in
                    ('Images', 'Containers', 'Local Volumes', 'Build Cache')]
            with patch.object(proof.shutil, 'disk_usage') as disk, patch.object(p, 'command') as command:
                disk.return_value.free = 40*proof.GIB
                command.return_value = ('\n'.join(json.dumps(r) for r in rows), 0)
                with self.assertRaisesRegex(ValueError, 'logical budget'):
                    p.guard(force=True)
            p.report['arms'][0]['image'] = 'sha256:'+'1'*64
            calls = []
            def fake(label, argv, **_kwargs):
                calls.append(argv)
                return ((json.dumps([{'Image': 'sha256:'+'3'*64}]) if 'inspect' in argv else '2'*64), 0)
            with patch.object(p, 'command', fake):
                failures = p.cleanup()
            self.assertIn('baseline-A-container', failures)
            self.assertFalse(any('rm' in argv for argv in calls))

    def test_actual_build_command_never_exports_and_binds_source_metadata(self):
        with tempfile.TemporaryDirectory() as value:
            p = proof.Proof(ROOT, Path(value), {'PATH': os.environ['PATH'],
                'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1',
                'ACTIONS_RUNTIME_TOKEN': 'secret-cache-read-token'})
            context = p.private/'source-A/docker/managed'
            context.mkdir(parents=True)
            (context/'Dockerfile').write_bytes((ROOT/'docker/managed/Dockerfile').read_bytes())
            captured = []
            image = 'sha256:'+'1'*64
            def fake(label, argv, **kwargs):
                captured.append((argv, kwargs))
                p.commands.append({'label': label, 'seconds': 1, 'exit': 0})
                if label.endswith('-inspect'):
                    return json.dumps([{'Id': image, 'Architecture': 'amd64', 'Os': 'linux'}]), 0
                Path(argv[argv.index('--iidfile')+1]).write_text(image)
                Path(argv[argv.index('--metadata-file')+1]).write_text(json.dumps({
                    'containerimage.digest': image, 'buildx.build.provenance': {
                        'materials': [{'uri': 'pkg:docker/wolfi', 'digest': {'sha256': 'a'*64}},
                                      {'uri': 'pkg:docker/dockerfile', 'digest': {'sha256': 'b'*64}}],
                        'invocation': {
                        'parameters': {'args': {'build-arg:NAC_BUILD_TRACK': 'dev',
                            'build-arg:NAC_BUILD_ID': 'dev-'+proof.SOURCE_A,
                            'build-arg:NAC_SOURCE_REVISION': proof.SOURCE_A}},
                        'environment': {'platform': 'linux/amd64'}}}}))
                log = '#22 [build 15/15] RUN NAC_SOURCE_REVISION="abc" cargo build -vv --release\n'
                log += '\n'.join('#22 1.0 Compiling '+n+' v0.1.0' for n in LOCAL)
                return log, 0
            with patch.object(p, 'command', fake):
                _, actual = p.build(p.report['arms'][0])
            self.assertEqual(actual, image)
            generated = (p.private/'baseline-A.Dockerfile').read_text()
            self.assertIn(proof.DEPENDENCY, generated)
            self.assertEqual(generated.count('cargo build -vv'), 1)
            argv, kwargs = captured[0]
            self.assertIn('--load', argv)
            self.assertIn('type=gha,scope=nac-managed-linux-amd64-v1', argv)
            self.assertNotIn('--cache-to', argv)
            self.assertNotIn('--push', argv)
            self.assertIn('NAC_SOURCE_REVISION='+proof.SOURCE_A, argv)
            self.assertEqual(kwargs['env']['ACTIONS_RUNTIME_TOKEN'], 'secret-cache-read-token')
            self.assertEqual(kwargs['env']['BUILDX_METADATA_PROVENANCE'], 'max')
            self.assertNotIn('ACTIONS_RUNTIME_TOKEN', p.plain)

    def test_actual_timeout_kills_owned_child_and_grandchild_not_sentinel(self):
        with tempfile.TemporaryDirectory() as value:
            root = Path(value)
            sentinel = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
            state = {}
            grand = root/'grand.pid'
            grand_code = f'import os,time; open({str(grand)!r},"w").write(str(os.getpid())); time.sleep(30)'
            code = ('import os,signal,subprocess,sys,time; '
                    'signal.signal(signal.SIGTERM,signal.SIG_IGN); '
                    f'p=subprocess.Popen([sys.executable,"-c",{grand_code!r}]); '
                    'time.sleep(30)')
            try:
                with self.assertRaisesRegex(ValueError, 'deadline'):
                    proof.supervise([sys.executable, '-c', code], dict(os.environ), 0.5,
                                    65536, state)
                self.assertIsNotNone(state['exit'])
                with self.assertRaises(ProcessLookupError):
                    os.kill(state['pid'], 0)
                self.assertIsNone(sentinel.poll())
                pid = int(grand.read_text())
                status = subprocess.run(['ps', '-p', str(pid), '-o', 'stat='],
                                        capture_output=True, text=True).stdout.strip()
                self.assertTrue(not status or status.startswith('Z'), status)
            finally:
                sentinel.kill()
                sentinel.wait(timeout=2)

    def test_output_overflow_and_guard_failure_reap_owned_process(self):
        cases = [('print("x"*10000)', 16, None, 'output exceeded'),
                 ('import time; time.sleep(30)', 65536,
                  lambda: proof.require(False, 'resource-control'), 'resource-control')]
        for code, limit, tick, message in cases:
            state = {}
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                proof.supervise([sys.executable, '-c', code], dict(os.environ), 2,
                                limit, state, tick)
            self.assertIsNotNone(state['exit'])
            self.assertTrue(state['interrupted_or_failed'])
            self.assertNotIn('reap_failed', state)


if __name__ == '__main__':
    unittest.main()
