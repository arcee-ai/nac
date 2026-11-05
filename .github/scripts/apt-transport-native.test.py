#!/usr/bin/env python3
"""Native APT state-isolation controls; real package control is retained separately."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).with_name('apt-transport-native.py')
SPEC = importlib.util.spec_from_file_location('native', SCRIPT)
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)


class Isolation(unittest.TestCase):
    def test_config_redirects_state_and_excludes_host_hooks(self):
        config = native.apt_config(Path('/tmp/nac-owned-control'))
        for fragment in ('Dir::Etc::main', 'Dir::Etc::parts', 'Dir::State::lists',
                         'Dir::Cache::archives', 'Dir::Log'):
            self.assertIn(fragment+' "/tmp/nac-owned-control/', config)
        self.assertIn('Dir::State::status "/var/lib/dpkg/status"', config)
        self.assertIn('Dir::Cache::pkgcache ""', config)
        self.assertIn('Dir::Cache::srcpkgcache ""', config)
        for setting in ('Check-Date', 'Check-Valid-Until'):
            self.assertIn(f'Acquire::{setting} "true"', config)
        self.assertIn('APT::Architecture "amd64v3"', config)
        self.assertNotIn('trusted=', config)

    def test_config_rejects_injection_or_relative_root(self):
        for value in ('relative', '/tmp/a"; Evil "true', '/tmp/a b'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                native.apt_config(Path(value))

    def test_order_and_package_validation_are_shared(self):
        self.assertEqual(native.ORDER, ('azure', 'official', 'official', 'azure'))
        self.assertEqual(len(native.archive.PACKAGES), 9)
        import json
        pins = json.loads(native.PINS.read_text())['packages']
        self.assertEqual({p['Package']: p['Version'] for p in pins}, native.archive.PACKAGES)

    def test_cli_rejects_missing_source_before_tools(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, str(SCRIPT), '--source', 'unbound',
                '--output', str(Path(directory)/'output')], capture_output=True,
                env={**os.environ, 'RUNNER_TEMP': directory})
            self.assertEqual(result.returncode, 2)
            self.assertIn(b'immutable checkout source', result.stderr)
            self.assertFalse((Path(directory)/'output').exists())

    def test_actual_owned_command_timeout_is_nonzero_and_reaped(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            probe = native.NativeProbe(SimpleNamespace(output=root/'output', source='0'*40))
            pidfile = root/'child.pid'
            code = ('import os,signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); '
                    f'open({str(pidfile)!r},"w").write(str(os.getpid())); time.sleep(60)')
            # The controller is exercised with a real child; Linux-only resource
            # setup is excluded on this Mac control host, not production execution.
            with patch.object(native, 'child_limits', lambda: None):
                with self.assertRaises(subprocess.TimeoutExpired):
                    probe.command('owned-timeout', [sys.executable, '-c', code], timeout=0.5)
            pid = int(pidfile.read_text())
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)
            self.assertNotEqual(probe.commands[-1]['exit'], 0)
            self.assertTrue(probe.commands[-1]['interrupted_or_timed_out'])
            self.assertTrue((root/'output/owned-timeout.stderr').exists())


if __name__ == '__main__':
    unittest.main()
