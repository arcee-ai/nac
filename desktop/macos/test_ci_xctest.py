import json
from pathlib import Path
import tempfile
import unittest

from ci_support import export_evidence
from ci_xctest import authorization_policy, require_generated_runner, require_prerequisites, result_receipt


class XCTestPolicyTests(unittest.TestCase):
    def test_missing_existing_permission_never_admits_ui_test(self):
        valid = ('2', 'Developer mode is currently enabled.', 'Automation DOES NOT REQUIRE authentication.')
        self.assertTrue(require_prerequisites(*valid)['declared_no_permission_mutation_commands'])
        for values in [('0', *valid[1:]), ('', *valid[1:]),
                       ('2', 'Developer mode is disabled.', valid[2]),
                       (*valid[:2], 'Automation requires authentication.')]:
            with self.assertRaisesRegex(RuntimeError, 'no grant requested'):
                require_prerequisites(*values)

    def test_active_session_mode_is_distinct_from_existing_authorization_policy(self):
        row = {'service': 'kTCCServiceAccessibility', 'client': 'com.apple.dt.Xcode-Helper',
               'client_type': 0, 'auth_value': 2, 'csreq_hex': '', 'last_modified': 1}
        before = {'xcode_helper_accessibility_rows': [row],
                  'developer_status': 'Developer mode is enabled.',
                  'automation_status': 'Automation Mode is disabled. This device DOES NOT REQUIRE authentication.'}
        policy = authorization_policy(before)
        self.assertEqual(authorization_policy({**before, 'automation_status':
            'Automation Mode is enabled. This device DOES NOT REQUIRE authentication.',
            'xcode_helper_accessibility_rows': [{**row, 'last_modified': 2}]}), policy)
        self.assertNotEqual(authorization_policy({**before, 'xcode_helper_accessibility_rows':
            [{**row, 'csreq_hex': 'ABCD'}]}), policy)
        for changed in ({'xcode_helper_accessibility_rows': []},
                        {'xcode_helper_accessibility_rows': [{**row, 'auth_value': 0}]},
                        {'automation_status': 'This device requires authentication.'}):
            with self.assertRaises(RuntimeError):
                authorization_policy({**before, **changed})

    def test_generated_runner_must_bind_only_one_exact_fixture(self):
        target = {'IsUITestBundle': True, 'BlueprintName': 'NACNativeUITests',
                  'EnvironmentVariables': {'NAC_UI_FIXTURE': '/private/owned-fixture.json'},
                  'TestBundlePath': '__TESTROOT__/Debug/NACNativeUITests.xctest'}
        def runner(targets):
            return {'TestConfigurations': [{'TestTargets': targets}]}
        self.assertEqual(require_generated_runner(runner([target]), '/private/owned-fixture.json'), target)
        for data in [runner([]), runner([target, target]), runner([{**target, 'IsUITestBundle': False}]),
                     runner([{**target, 'EnvironmentVariables': {'NAC_UI_FIXTURE': '$(NAC_UI_FIXTURE)'}}])]:
            with self.assertRaises(RuntimeError):
                require_generated_runner(data, '/private/owned-fixture.json')

    def test_actual_result_binding_and_raw_diagnostic_exclusion(self):
        with tempfile.TemporaryDirectory() as temporary:
            raw = Path(temporary) / 'raw'
            result = raw / 'native-input.xcresult'
            result.mkdir(parents=True)
            (result / 'diagnostics.json').write_text('host-private-diagnostics')
            receipt = result_receipt(result)
            self.assertEqual(receipt['files'], 1)
            (raw / 'xctest-result.json').write_text(json.dumps(receipt))
            public = Path(temporary) / 'public'
            export_evidence(raw, public, [])
            self.assertTrue((public / 'xctest-result.json').exists())
            self.assertFalse((public / 'native-input.xcresult').exists())
            (result / 'diagnostics.json').write_text('changed')
            self.assertNotEqual(result_receipt(result)['tree_sha256'], receipt['tree_sha256'])
            (result / 'link').symlink_to('/etc/hosts')
            with self.assertRaisesRegex(RuntimeError, 'symlink'):
                result_receipt(result)


if __name__ == '__main__':
    unittest.main()
