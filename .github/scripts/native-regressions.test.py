"""Subprocess controls for native test selection and build/fixture isolation."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True

SCRIPT = Path(__file__).with_name('native-regressions.py').resolve()
spec = importlib.util.spec_from_file_location('native_regressions', SCRIPT)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerControls(unittest.TestCase):
    def exercise(self, mode):
        with tempfile.TemporaryDirectory(prefix='native-runner-control-') as directory:
            root = Path(directory).resolve()
            tools = root / 'bin'
            tools.mkdir()
            build = root / 'build-temp'
            build.mkdir()
            cargo = tools / 'cargo'
            cargo.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
names = json.loads(os.environ['CONTROL_NAMES'])
if '--no-run' in sys.argv:
    # Model a compiler/xcrun cache which intentionally outlives compilation.
    pathlib.Path(os.environ['TMPDIR'], 'compiler-cache').write_text('cache')
elif '--list' in sys.argv:
    if os.environ['CONTROL_MODE'] == 'missing':
        names.pop()
    print('\\n'.join(name + ': test' for name in names))
elif '--exact' in sys.argv:
    assert all(name in sys.argv for name in names)
    print('\\n'.join('test ' + name + ' ... ok' for name in names))
elif '-V' in sys.argv:
    print('cargo control')
elif os.environ['CONTROL_MODE'] == 'leak':
    pathlib.Path(os.environ['TMPDIR'], 'leaked-credential').write_text('synthetic')
''')
            cargo.chmod(0o700)
            output = root / 'evidence'
            env = dict(os.environ, PATH=str(tools) + os.pathsep + os.environ['PATH'],
                       TMPDIR=str(build), TMP=str(build), TEMP=str(build),
                       CONTROL_NAMES=json.dumps(runner.CORE_TESTS), CONTROL_MODE=mode)
            result = subprocess.run([sys.executable, str(SCRIPT), '--output', str(output)],
                                    env=env, text=True, capture_output=True, check=False)
            report = json.loads((output / 'report.json').read_text())
            self.assertEqual((build / 'compiler-cache').read_text(), 'cache')
            return result, report

    def test_compiler_cache_is_not_a_fixture_leak(self):
        result, report = self.exercise('clean')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(report['fixture_files_remaining'], [])
        self.assertEqual(report['result'], 'passed')

    def test_real_fixture_leak_still_blocks(self):
        result, report = self.exercise('leak')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('fixture files remain', result.stderr)
        self.assertEqual(report['fixture_files_remaining'], ['leaked-credential'])
        self.assertNotIn('result', report)

    def test_missing_exact_selection_blocks_before_execution(self):
        result, report = self.exercise('missing')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('missing exact native tests', result.stderr)
        self.assertNotIn('core-first', report['phases'])


if __name__ == '__main__':
    unittest.main()
