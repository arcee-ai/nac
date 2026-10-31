import json
from pathlib import Path
import shutil
import tempfile
import unittest

from ci_support import export_evidence
from ci_xctest import (authorization_policy, relocation_directory, require_generated_runner,
                       require_prerequisites, require_settled, result_receipt)


class XCTestPolicyTests(unittest.TestCase):
    def test_relocation_is_retained_until_owned_cleanup_is_observed(self):
        with tempfile.TemporaryDirectory() as temporary:
            raw = Path(temporary)
            with relocation_directory(raw) as lease:
                completed = lease['path']
            self.assertFalse(completed.exists())
            with self.assertRaisesRegex(RuntimeError, 'fixture failed'):
                with relocation_directory(raw) as lease:
                    retained = lease['path']
                    lease['safe_to_remove'] = False
                    raise RuntimeError('fixture failed')
            self.assertTrue(retained.exists())
            self.assertTrue(json.loads((raw / 'xctest-relocation.json').read_text())['bundle_retained_for_unresolved_cleanup'])
            shutil.rmtree(retained)

    def test_process_and_profile_must_settle_before_bundle_removal(self):
        with tempfile.TemporaryDirectory() as temporary:
            profile = Path(temporary) / 'profile'
            record = {'app_pid': 1, 'engine_pid': 2, 'profile': str(profile)}
            require_settled(record, lambda pid: 'Z' if pid == 2 else '')
            for changed in ({'app_pid': 0}, {'profile': ''}, {'engine_pid': -1}):
                with self.assertRaises(RuntimeError):
                    require_settled({**record, **changed}, lambda pid: '')
            with self.assertRaisesRegex(RuntimeError, 'process survived'):
                require_settled(record, lambda pid: 'S')
            profile.symlink_to(Path(temporary) / 'absent-target')
            with self.assertRaisesRegex(RuntimeError, 'profile removal'):
                require_settled(record, lambda pid: '')
            profile.unlink()
            profile.mkdir()
            with self.assertRaisesRegex(RuntimeError, 'profile removal'):
                require_settled(record, lambda pid: '')

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
                     runner([target, {**target, 'BlueprintName': 'ForeignUITests'}]),
                     runner([{**target, 'EnvironmentVariables': {'NAC_UI_FIXTURE': '$(NAC_UI_FIXTURE)'}}])]:
            with self.assertRaises(RuntimeError):
                require_generated_runner(data, '/private/owned-fixture.json')

    def test_performance_selection_requires_one_real_target_and_bound_source_environment(self):
        selection = {'generated': True, 'expected_target': 'NACPerformanceUITests',
                     'performance_source_path': '/private/owned-P/PerformanceJourneys.swift',
                     'performance_source_sha256': 'a' * 64}
        environment = {'NAC_UI_FIXTURE': '/private/fixture.json',
                       'NAC_PERFORMANCE_SOURCE_PATH': selection['performance_source_path'],
                       'NAC_PERFORMANCE_SOURCE_SHA256': selection['performance_source_sha256']}
        target = {'IsUITestBundle': True, 'BlueprintName': 'NACPerformanceUITests',
                  'EnvironmentVariables': environment, 'TestBundlePath': '__TESTROOT__/Debug/Performance.xctest'}
        data = {'TestTargets': [target]}
        self.assertEqual(require_generated_runner(data, '/private/fixture.json', 'NACPerformanceUITests',
                                                  project_selection=selection), target)
        for change in ({'performance_source_sha256': 'b' * 64}, {'performance_source_path': '/private/foreign.swift'},
                       {'generated': False}, {'expected_target': 'NACNativeUITests'}):
            with self.assertRaisesRegex(RuntimeError, 'materialized source'):
                require_generated_runner(data, '/private/fixture.json', 'NACPerformanceUITests',
                                         project_selection={**selection, **change})
        for name in ('ForeignUITests', 'NACNativeUITests', 'NACPerformanceUITests'):
            with self.assertRaises(RuntimeError):
                require_generated_runner(data, '/private/fixture.json', name)

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
