"""Acceptance guards: successful scripted output cannot certify physical input."""
import unittest

from terminal import REQUIRED, matrix


class TerminalEvidenceTests(unittest.TestCase):
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
