"""Mock ci.py delivery, real finalization serializers; no native/OS execution."""
from contextlib import ExitStack
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import ci
from ci_lifecycle_contract import CASES, FRAMES, SOURCE
from ci_lifecycle_evidence import MAX_FILE


class LifecycleDeliveryControls(unittest.TestCase):
    def exercise(self, oversize=False):
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            root = Path(tmp).resolve()
            harness, supplier, home = root / 'harness', root / 'supplier', root / 'home'
            for folder in (harness / 'desktop/macos', supplier, home):
                folder.mkdir(parents=True)
            (harness / 'desktop/macos/ci-toolchain.json').write_text('{}')
            crashes = home / 'Library/Logs/DiagnosticReports'
            crashes.mkdir(parents=True)
            for i in range(3):
                (crashes / ('NACPreview-mock-' + str(i) + '.ips')).write_bytes(b'SYNTHETIC CRASH' * 5000)
            head = 'a' * 40
            stack.enter_context(mock.patch.dict(ci.os.environ, {'HOME': str(home)}, clear=True))
            stack.enter_context(mock.patch.object(ci, 'ROOT', harness))
            stack.enter_context(mock.patch.object(ci.sys, 'argv', ['ci', '--expected-sha', head,
                '--output', str(root / 'output'), '--qualification', 'all-344-lifecycle-macos26',
                '--source-root', str(supplier)]))
            stack.enter_context(mock.patch.object(ci.signal, 'signal'))
            stack.enter_context(mock.patch.object(ci.os, 'getuid', return_value=501))
            stack.enter_context(mock.patch.object(ci.platform, 'system', return_value='Darwin'))
            stack.enter_context(mock.patch.object(ci.platform, 'machine', return_value='arm64'))
            stack.enter_context(mock.patch.object(ci.time, 'time', return_value=0))
            stack.enter_context(mock.patch.object(ci, 'select_target', return_value={
                'suite': 'lifecycle', 'source_sha': SOURCE, 'envelope': 'ci-toolchain.json'}))
            stack.enter_context(mock.patch.object(ci, 'require_lifecycle_capsule'))
            stack.enter_context(mock.patch.object(ci, 'require_checkout', return_value={'source_sha': SOURCE}))
            stack.enter_context(mock.patch.object(ci, 'qualify_toolchain', return_value=True))
            stack.enter_context(mock.patch.object(ci, 'console_state', return_value={'MOCK': True}))
            stack.enter_context(mock.patch.object(ci, 'require_console', return_value={'MOCK': True}))
            stack.enter_context(mock.patch.object(ci, 'run'))
            def command(argv, **_kwargs):
                if argv == ['git', 'rev-parse', 'HEAD']:
                    return head
                if argv == ['git', 'status', '--porcelain']:
                    return ''
                return 'MOCK SOURCE METADATA'
            stack.enter_context(mock.patch.object(ci, 'command', side_effect=command))
            stack.enter_context(mock.patch.object(ci.subprocess, 'check_output', return_value=b'MOCK IOREG; NEVER RUN'))
            def native(_argv, log):
                log.write_bytes(b'x' * (MAX_FILE + 1 if oversize and log.name == 'gui-reader-end.log' else 32))
                return {'available': True, 'MOCK': True}
            stack.enter_context(mock.patch.object(ci, 'native_report', side_effect=native))
            def qualify(raw, *_args, **kwargs):
                self.assertEqual(kwargs['report']['harness_sha'], head)
                for case in CASES:
                    folder = raw / 'lifecycle' / case / case
                    folder.mkdir(parents=True)
                    for frame in FRAMES:
                        (folder / frame).write_bytes(b'SYNTHETIC EXPORT, NOT VALID PNG/NATIVE/OCR')
                (raw / 'lifecycle/ledger.json').write_text(json.dumps({'phase': 'complete', 'active_case': None,
                    'cases': {case: {'state': 'passed', 'dispatches': 1} for case in CASES}}))
                return {'target_suite': {'passed': True}, 'lifecycle_cases': ['MOCK ONLY']}
            qualified = stack.enter_context(mock.patch.object(ci, 'qualify_lifecycle', side_effect=qualify))
            if oversize:
                with self.assertRaisesRegex(RuntimeError, 'raw file bound'):
                    ci.main()
            else:
                ci.main()
            qualified.assert_called_once()
            output = root / 'output'
            report = json.loads((output / 'ci-report.json').read_text())
            self.assertEqual(report['result'], 'failed' if oversize else 'passed')
            self.assertEqual(report['crash_reports'], 3)
            self.assertEqual(len(list(output.rglob('*.png'))), 15)
            self.assertEqual(json.loads((output / 'finalization.json').read_text())['export_capacity_validated'], not oversize)

    def test_actual_ci_finally_stages_all_writers_before_success_publication(self):
        self.exercise()

    def test_actual_ci_finally_tail_violation_keeps_originals_and_overrides_pass(self):
        self.exercise(oversize=True)


if __name__ == '__main__':
    unittest.main()
