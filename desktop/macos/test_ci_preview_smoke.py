"""CI orchestration controls only; these do not qualify a native app or compiler."""
import ast
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from ci import run_preview_smoke

ROOT = Path(__file__).resolve().parents[2]


class PreviewPhaseTests(unittest.TestCase):
    def test_build_controls_and_actual_journeys_have_separate_bounded_phases(self):
        output, source = Path('/private/owned evidence'), Path('/exact source')
        with patch('ci.run') as run:
            run_preview_smoke(output, source)
        calls = run.call_args_list
        self.assertEqual(len(calls), 3)
        self.assertEqual([call.args[0][:3] for call in calls], [
            ['bash', 'desktop/macos/preview.sh', 'smoke-build'],
            ['bash', 'desktop/macos/smoke_controls.sh', str(output)],
            ['python3', '-B', 'desktop/macos/smoke.py']])
        self.assertEqual(calls[-1].args[0][3:], [
            str(output / 'NAC Development Preview Smoke.app'), str(output / 'evidence')])
        self.assertEqual(calls[-1].args[2], 800)
        self.assertEqual([call.kwargs['cwd'] for call in calls], [source] * 3)
        self.assertFalse(any('unittest' in call.args[0] for call in calls))

    def test_pinned_source_keeps_its_original_smoke_owner(self):
        tree = ast.parse((ROOT / 'desktop/macos/ci.py').read_text())
        branch = next(node for node in ast.walk(tree) if isinstance(node, ast.If)
                      and isinstance(node.test, ast.Name) and node.test.id == 'target'
                      and any(isinstance(child, ast.Call) and isinstance(child.func, ast.Name)
                              and child.func.id == 'run_preview_smoke'
                              for statement in node.orelse for child in ast.walk(statement)))
        script = compile(ast.Module(body=[branch], type_ignores=[]), '<actual CI routing>', 'exec')
        for target in (None, {'source_sha': 'immutable'}):
            with self.subTest(target=target), patch('ci.run') as run, patch('ci.run_preview_smoke') as split:
                exec(script, dict(target=target, run=run, run_preview_smoke=split,
                                  raw=Path('/owned'), source_root=Path('/source')))
                if target:
                    split.assert_not_called()
                    self.assertEqual(run.call_args.args[0], ['bash', 'desktop/macos/preview.sh', 'smoke'])
                    self.assertEqual(run.call_args.args[2], 800)
                else:
                    run.assert_not_called()
                    split.assert_called_once_with(Path('/owned'), Path('/source'))

    def test_a_failed_build_or_protocol_control_never_launches_app_journeys(self):
        for phase in (0, 1):
            with self.subTest(phase=phase), patch('ci.run') as run:
                failure = RuntimeError('owned phase failed')
                run.side_effect = [None] * phase + [failure]
                with self.assertRaises(RuntimeError) as caught:
                    run_preview_smoke(Path('/owned'), Path('/source'))
                self.assertIs(caught.exception, failure)
                self.assertEqual(run.call_count, phase + 1)

    def test_shared_shell_executes_both_controls_and_stops_on_compile_or_control_failure(self):
        # Synthetic xcrun records the actual shell's argv and supplies inert
        # executables. This verifies fail-closed orchestration, not Swift behavior.
        for failure in ('', 'compile', 'control'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                record = root / 'calls.jsonl'
                compiler = root / 'xcrun'
                compiler.write_text('''#!/usr/bin/env python3
import json,os,pathlib,sys
with open(os.environ['CONTROL_RECORD'], 'a') as record:
    record.write(json.dumps(sys.argv[1:])+'\\n')
if os.environ['CONTROL_FAILURE']=='compile': sys.exit(7)
out=pathlib.Path(sys.argv[sys.argv.index('-o')+1])
out.write_text('#!/bin/sh\\necho control >> "$CONTROL_EXECUTIONS"\\nexit '+
               ('8' if os.environ['CONTROL_FAILURE']=='control' else '0')+'\\n')
out.chmod(0o700)
''')
                compiler.chmod(0o700)
                execution = root / 'executed'
                result = subprocess.run(['bash', str(ROOT / 'desktop/macos/smoke_controls.sh'),
                                         str(root / 'private output')], capture_output=True, text=True,
                    env={**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH'],
                         'CONTROL_RECORD': str(record), 'CONTROL_FAILURE': failure,
                         'CONTROL_EXECUTIONS': str(execution)}, timeout=10)
                calls = [json.loads(line) for line in record.read_text().splitlines()]
                self.assertEqual(len(calls), 1 if failure else 2)
                self.assertIn('desktop/macos/ProtocolTests.swift', calls[0])
                if not failure:
                    self.assertIn('desktop/macos/NativeCommandStateTests.swift', calls[1])
                self.assertEqual(result.returncode, 7 if failure == 'compile' else 8 if failure else 0)
                self.assertEqual(len(execution.read_text().splitlines()) if execution.exists() else 0,
                                 0 if failure == 'compile' else 1 if failure else 2)


if __name__ == '__main__':
    unittest.main()
