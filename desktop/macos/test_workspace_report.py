import unittest

from workspace_report import matrix


class WorkspaceMatrixTests(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
