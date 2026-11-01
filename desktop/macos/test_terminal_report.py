"""Acceptance guards: successful scripted output cannot certify physical input."""
import unittest
from copy import deepcopy
import json
from pathlib import Path
import tempfile
from unittest.mock import patch

import terminal
from terminal import REQUIRED, matrix


class TerminalEvidenceTests(unittest.TestCase):
    def run_report(self, build_os, build_os_build, execution, changed_identity=None, changed_runner=False,
                   episode_passed=True):
        """Exercise report publication with no app, engine or host probes."""
        identity = {'source_head': 'source', 'tracked_diff_sha256': 'clean',
                    'native_sources': {'fixture.swift': 'native-source'},
                    'engine_sha256': 'engine', 'native_sha256': 'native', 'assets_tree': 'assets'}
        provenance = {**identity, 'os': build_os, 'os_build': build_os_build,
                      'runner_sources': {'terminal.py': 'runner'},
                      'asset_files': {'/one.js': 'js', '/two.css': 'css'}}
        current = {**deepcopy(identity), **execution}
        if changed_identity:
            current.update(changed_identity)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = root / 'sealed-bundle'
            resources = bundle / 'Contents/Resources'
            resources.mkdir(parents=True)
            manifest = resources / 'terminal-build.json'
            manifest.write_text(json.dumps(provenance))
            original = manifest.read_bytes()
            output = root / 'episode'
            episode = {'passed': episode_passed, 'embedded_assets': [
                {'path': '/one.js', 'sha256': 'js'}, {'path': '/two.css', 'sha256': 'css'}]}
            runner = {'terminal.py': 'changed'} if changed_runner else provenance['runner_sources']
            with patch('sys.argv', ['terminal.py', 'run', str(bundle), str(output),
                                    '--scenario', 'terminal-output']), \
                    patch.object(terminal, 'identity', return_value=current), \
                    patch.object(terminal, 'sources', return_value=runner), \
                    patch.object(terminal, 'environment_probe', return_value={'status': 'unavailable'}), \
                    patch.object(terminal, 'run_case', return_value=episode) as run_case, \
                    patch.object(terminal.subprocess, 'run', side_effect=AssertionError('Host probe forbidden')):
                if changed_identity or changed_runner:
                    with self.assertRaisesRegex(RuntimeError, 'changed'):
                        terminal.main()
                    run_case.assert_not_called()
                    self.assertFalse(output.exists())
                    report = None
                else:
                    if episode_passed:
                        terminal.main()
                    else:
                        with self.assertRaises(SystemExit) as failure:
                            terminal.main()
                        self.assertEqual(failure.exception.code, 1)
                    run_case.assert_called_once()
                    report = json.loads((output / 'matrix.json').read_text())
                    self.assertFalse(report['accepted'])
            self.assertEqual(manifest.read_bytes(), original)
            return report

    def test_execution_os_axis_is_separate_from_build_identity(self):
        for os_version, os_build in [('26.6.2', '25G83'), ('27.0.1', '26A434'), ('27.0.1', '26A435')]:
            with self.subTest(os=os_version, build=os_build):
                report = self.run_report('27.0.1', '26A434', {'os': os_version, 'os_build': os_build})
                provenance = report['provenance']
                self.assertEqual(provenance['os'], os_version)
                self.assertEqual(provenance['os_build'], os_build)
                self.assertEqual(provenance.get('build_os'), '27.0.1')
                self.assertEqual(provenance.get('build_os_build'), '26A434')
                self.assertEqual(provenance.get('execution_os'), os_version)
                self.assertEqual(provenance.get('execution_os_build'), os_build)

    def test_unavailable_execution_axes_never_inherit_build_values(self):
        for execution in [{}, {'os': None, 'os_build': None}, {'os': '26.6.2'}, {'os_build': '25G83'}]:
            with self.subTest(execution=execution):
                provenance = self.run_report('27.0.1', '26A434', execution)['provenance']
                self.assertEqual(provenance['os'], execution.get('os'))
                self.assertEqual(provenance['os_build'], execution.get('os_build'))
                self.assertIn('execution_os', provenance)
                self.assertIn('execution_os_build', provenance)
                self.assertEqual(provenance['execution_os'], execution.get('os'))
                self.assertEqual(provenance['execution_os_build'], execution.get('os_build'))
                self.assertEqual(provenance['build_os'], '27.0.1')
                self.assertEqual(provenance['build_os_build'], '26A434')

    def test_unknown_build_axes_do_not_replace_observed_execution(self):
        provenance = self.run_report(None, None, {'os': '26.6.2', 'os_build': '25G83'})['provenance']
        self.assertIsNone(provenance['build_os'])
        self.assertIsNone(provenance['build_os_build'])
        self.assertEqual(provenance['os'], '26.6.2')
        self.assertEqual(provenance['os_build'], '25G83')
        self.assertEqual(provenance['execution_os'], '26.6.2')
        self.assertEqual(provenance['execution_os_build'], '25G83')

    def test_failed_episode_still_publishes_its_execution_axis(self):
        report = self.run_report('27.0.1', '26A434', {'os': '26.6.2', 'os_build': '25G83'},
                                 episode_passed=False)
        self.assertEqual(report['provenance']['os'], '26.6.2')
        self.assertEqual(report['provenance']['execution_os_build'], '25G83')
        self.assertEqual(report['provenance']['build_os_build'], '26A434')
        self.assertFalse(report['episodes']['terminal-output']['passed'])
        self.assertFalse(report['accepted'])

    def test_source_binary_and_runner_admission_still_precedes_episode(self):
        for key in ['source_head', 'tracked_diff_sha256', 'native_sources',
                    'engine_sha256', 'native_sha256', 'assets_tree']:
            with self.subTest(key=key):
                self.run_report('27.0.1', '26A434', {'os': '26.6.2', 'os_build': '25G83'},
                                changed_identity={key: 'changed'})
        self.run_report('27.0.1', '26A434', {'os': '26.6.2', 'os_build': '25G83'}, changed_runner=True)

    def test_all_scripted_rows_green_still_leaves_required_input_unqualified(self):
        episodes = {}
        for name, scenario in REQUIRED.items():
            if scenario and scenario != 'terminal-xctest':
                episodes.setdefault(scenario, {'passed': True, 'checks': {}})['checks'][name] = {
                    'status': 'pass', 'detail': 'scripted output fixture'}
        report = matrix(episodes)
        self.assertFalse(report['accepted'])
        rows = {row['id']: row for row in report['rows']}
        for name in ('real-cjk-ime', 'edit-menu-bracketed-paste', 'trusted-mac-keyboard-unicode'):
            self.assertEqual(rows[name]['status'], 'unavailable')

    def test_failed_native_cleanup_prevents_pass_for_observed_rows(self):
        report = matrix({'terminal-output': {'passed': False, 'engine_reaped': False,
            'checks': {'unicode-osc': {'status': 'pass', 'detail': 'DOM observed'}}}})
        row = next(row for row in report['rows'] if row['id'] == 'unicode-osc')
        self.assertEqual(row['status'], 'fail')
        self.assertFalse(report['accepted'])

    def test_missing_episode_retains_every_required_row_and_backend_gap(self):
        report = matrix({})
        self.assertEqual(len(report['rows']), len(REQUIRED))
        self.assertTrue(all(row['status'] == 'unavailable' for row in report['rows']))
        self.assertIn('unavailable', report['backends']['ssh'])
        self.assertIn('unavailable', report['backends']['podman'])

    def test_external_readiness_and_ascii_supplier_cannot_certify_unicode_or_resize(self):
        report = matrix({'terminal-xctest': {'passed': True,
            'terminal_xctest_phase': {'schema': 1, 'state': 'ready'},
            'trusted_terminal': {'exact_receipt': True, 'trusted_keydowns': 126}}})
        rows = {row['id']: row for row in report['rows']}
        self.assertEqual(rows['trusted-mac-keyboard-unicode']['status'], 'unavailable')
        self.assertEqual(rows['resize-pty-readback']['status'], 'unavailable')
        self.assertFalse(report['accepted'])

    def test_external_observations_do_not_cover_physical_or_full_job_control(self):
        report = matrix({'terminal-xctest': {'passed': True, 'checks': {
            name: {'status': 'pass', 'detail': 'public XCTest observation'} for name in (
                'trusted-mac-keyboard-unicode', 'resize-pty-readback', 'xctest-ctrl-c-recovery')}}})
        rows = {row['id']: row for row in report['rows']}
        self.assertEqual(rows['trusted-mac-keyboard-unicode']['status'], 'pass')
        for name in ('real-cjk-ime', 'edit-menu-bracketed-paste', 'ctrl-c-job-control',
                     'exact-value-masking', 'physical-selection-attachment-provenance', 'renderer-crash'):
            self.assertEqual(rows[name]['status'], 'unavailable')
        self.assertFalse(report['accepted'])


if __name__ == '__main__':
    unittest.main()
