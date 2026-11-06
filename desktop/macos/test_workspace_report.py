import json
from pathlib import Path
import tempfile
import unittest
from copy import deepcopy

from workspace_report import matrix, write_report


class WorkspaceMatrixTests(unittest.TestCase):
    def test_lifecycle_requires_exact_clean_source_native_engine_and_os(self):
        provenance = {'os': '27.0.1', 'os_build': '26A434', 'source_head': 'head',
                      'source_status': '', 'engine_sha256': 'engine', 'native_sha256': 'native'}
        baseline = {**provenance, 'os': 'ProductName:\tmacOS\nProductVersion:\t27.0.1\nBuildVersion:\t26A434',
                    'source_dirty': False, 'scenarios': [{'scenario': name, 'passed': True} for name in
                        ('normal', 'engine-exit', 'missing', 'exit', 'close-startup', 'timeout')]}

        def lifecycle(record):
            return next(row for row in matrix(provenance, {}, record)['rows']
                        if row['os'] == '27.0.1' and row['id'] == 'lifecycle-cleanup')

        self.assertEqual(lifecycle(baseline)['status'], 'pass')
        for field, value in [('native_sha256', 'other'), ('engine_sha256', 'other'),
                             ('source_head', 'other'), ('source_dirty', True),
                             ('os', baseline['os'].replace('27.0.1', '127.0.1')),
                             ('os', baseline['os'].replace('26A434', '26A435'))]:
            with self.subTest(field=field, value=value):
                changed = {**baseline, field: value}
                self.assertEqual(lifecycle(changed)['status'], 'unavailable')
                self.assertFalse(lifecycle(changed)['tested'])

        failed = deepcopy(baseline)
        failed['scenarios'][0]['passed'] = False
        self.assertEqual(lifecycle(failed)['status'], 'fail')
        incomplete = {**baseline, 'scenarios': [baseline['scenarios'][0]] * 6}
        self.assertEqual(lifecycle(incomplete)['status'], 'unavailable')

    def test_missing_os_and_real_input_never_inherit_scripted_pass(self):
        evidence = {'workspace-direct': {'checks': {
            'direct': {'status': 'pass'}, 'real-cjk': {'status': 'pass'}}}}
        report = matrix({'os': '27.0.1'}, evidence)
        rows = {(row['os'], row['id']): row for row in report['rows']}
        self.assertEqual(rows['27.0.1', 'direct']['status'], 'pass')
        self.assertEqual(rows['14', 'direct']['status'], 'unavailable')
        self.assertEqual(rows['27.0.1', 'real-cjk']['status'], 'unavailable')
        self.assertFalse(report['full_acceptance'])
        self.assertIsNone(report['minimum_selected'])

    def test_failed_and_unreached_checks_survive_as_distinct_results(self):
        report = matrix({'os': '27.0.1'}, {'workspace-direct': {'checks': {
            'direct': {'status': 'fail', 'detail': 'UI failed to create session'}}}})
        rows = {row['id']: row for row in report['rows'] if row['os'] == '27.0.1'}
        self.assertEqual(rows['direct']['status'], 'fail')
        self.assertTrue(rows['direct']['tested'])
        self.assertEqual(rows['settings']['status'], 'unavailable')
        self.assertFalse(rows['settings']['tested'])


    def test_execution_flag_is_exact_and_legacy_present_checks_remain_compatible(self):
        cases = [
            ('blocked', {'status': 'fail', 'blocked_by': 'approvals', 'executed': False,
                         'detail': 'Goals not exercised: approvals failed'}, False),
            ('executed pass', {'status': 'pass', 'executed': True}, True),
            ('executed fail', {'status': 'fail', 'executed': True}, True),
            ('legacy pass', {'status': 'pass'}, True),
            ('legacy fail', {'status': 'fail'}, True),
        ]
        for invalid in (None, 0, 1, 'false', 'true', [], {}):
            cases.append(('nonboolean ' + repr(invalid), {'status': 'fail', 'executed': invalid}, False))
        for name, check, tested in cases:
            with self.subTest(name=name):
                original = deepcopy(check)
                report = matrix({'os': '27.0.1'}, {'workspace-direct': {'checks': {'goals': check}}})
                row = next(r for r in report['rows'] if r['os'] == '27.0.1' and r['id'] == 'goals')
                self.assertIs(row['tested'], tested)
                self.assertEqual(row['status'], check['status'])
                self.assertEqual(row['evidence'], original)
                self.assertEqual(check, original)
                self.assertFalse(report['full_acceptance'])
                self.assertIsNone(report['minimum_selected'])

    def test_missing_check_is_unavailable_and_not_legacy_execution_evidence(self):
        for episodes in ({}, {'workspace-direct': {'checks': {}}},
                         {'workspace-direct': {'checks': {'direct': {'status': 'pass'}}}}):
            with self.subTest(episodes=episodes):
                report = matrix({'os': '27.0.1'}, episodes)
                row = next(r for r in report['rows'] if r['os'] == '27.0.1' and r['id'] == 'goals')
                self.assertIs(row['tested'], False)
                self.assertEqual(row['status'], 'unavailable')
                self.assertIsNone(row['evidence'])
                self.assertFalse(report['full_acceptance'])

    def test_json_and_markdown_keep_blocked_failure_untested_and_suite_unaccepted(self):
        episodes = {'workspace-direct': {'checks': {
            'direct': {'status': 'pass', 'executed': True},
            'approvals': {'status': 'fail', 'executed': True},
            'goals': {'status': 'fail', 'blocked_by': 'approvals', 'executed': False,
                      'detail': 'Goals not exercised: approvals failed'},
        }}}
        provenance = {'os': '27.0.1', 'source_head': 'fixture-source', 'engine_version': 'fixture-engine'}
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            write_report(output, provenance, episodes)
            report = json.loads((output / 'matrix.json').read_text())
            rows = {row['id']: row for row in report['rows'] if row['os'] == '27.0.1'}
            self.assertIs(rows['goals']['tested'], False)
            self.assertEqual(rows['goals']['status'], 'fail')
            self.assertEqual(rows['goals']['evidence']['blocked_by'], 'approvals')
            self.assertIs(rows['goals']['evidence']['executed'], False)
            self.assertFalse(report['full_acceptance'])
            self.assertIsNone(report['minimum_selected'])
            markdown = (output / 'matrix.md').read_text()
            self.assertIn('| goals | 27.0.1 | False | fail |', markdown)
            self.assertIn('| approvals | 27.0.1 | True | fail |', markdown)
            self.assertIn('| direct | 27.0.1 | True | pass |', markdown)
            self.assertIn('Full acceptance is not established.', markdown)


if __name__ == '__main__':
    unittest.main()
