import json
import os
from pathlib import Path
import plistlib
import shutil
from contextlib import ExitStack
import tempfile
import unittest
from unittest.mock import patch

import ci_xctest
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

    def test_startup_runner_requires_separate_source_and_configuration_bindings(self):
        selection = {'generated': True, 'expected_target': 'NACStartupUITests', 'harness_sha': 'a' * 40,
                     'startup_sha': 'b' * 40, 'startup_source_path': '/private/Q/StartupJourneys.swift',
                     'startup_source_sha256': 'c' * 64}
        binding = {'product_sha': 'd' * 40, 'test_sha': 'b' * 40, 'harness_sha': 'a' * 40,
                   'configuration_sha256': 'e' * 64}
        environment = {'NAC_UI_FIXTURE': '/private/config.json',
                       'NAC_STARTUP_SOURCE_PATH': selection['startup_source_path'],
                       'NAC_STARTUP_SOURCE_SHA256': selection['startup_source_sha256'],
                       **{'NAC_STARTUP_' + key.upper(): value for key, value in binding.items()}}
        target = {'IsUITestBundle': True, 'BlueprintName': 'NACStartupUITests',
                  'EnvironmentVariables': environment, 'TestBundlePath': '__TESTROOT__/NACStartupUITests.xctest'}
        data = {'TestTargets': [target]}
        self.assertEqual(require_generated_runner(data, '/private/config.json', 'NACStartupUITests',
                         project_selection=selection, startup_binding=binding), target)
        for key in environment:
            changed = {**target, 'EnvironmentVariables': {**environment, key: 'foreign'}}
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                require_generated_runner({'TestTargets': [changed]}, '/private/config.json', 'NACStartupUITests',
                                         project_selection=selection, startup_binding=binding)
        for changed in ({**binding, 'test_sha': 'f' * 40}, {**binding, 'harness_sha': 'f' * 40}, {}):
            with self.assertRaises(RuntimeError):
                require_generated_runner(data, '/private/config.json', 'NACStartupUITests',
                                         project_selection=selection, startup_binding=changed)

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


class XCTestLaunchEnvironmentTests(unittest.TestCase):
    def exercise_launch(self, *, failure=None):
        """Exercise the real launcher with inert bundle/result/process adapters."""
        permitted = {'PATH': '/Selected/tools:/usr/bin', 'DEVELOPER_DIR': '/Selected/Xcode',
                     'SDKROOT': '/Selected/SDK', 'LANG': 'en_US.UTF-8', 'LC_ALL': 'C',
                     'HOME': '/private/fixture-home', 'TMPDIR': '/private/fixture-tmp',
                     'NAC_MAC_ENGINE': '/private/fixture-engine', 'NAC_MAC_SKIP_ENGINE_BUILD': '1'}
        forbidden = {'NAC_MANAGED_CONFIG': 'ambient-managed-canary',
                     'GITHUB_TOKEN': 'ambient-github-canary', 'OTHER_TOKEN': 'ambient-token-canary',
                     'OPENAI_API_KEY': 'ambient-api-canary', 'OTHER_API_KEY': 'ambient-other-api-canary'}
        ambient = {**permitted, **forbidden}
        observations, cleaned, settled = [], [], []
        status = {'xcode_helper_accessibility_rows': [
            {'service': 'kTCCServiceAccessibility', 'client': 'com.apple.dt.Xcode-Helper',
             'client_type': 0, 'auth_value': 2}],
            'developer_status': 'Developer mode is enabled.',
            'automation_status': 'Automation DOES NOT REQUIRE authentication.'}
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
            raw = Path(temporary)
            executable = raw / 'NAC Development Preview Smoke.app/Contents/MacOS/NACPreview'
            executable.parent.mkdir(parents=True)
            executable.write_bytes(b'inert fixture executable; never executed')
            evidence = raw / 'evidence/ci-terminal-xctest.json'
            profile = raw / 'removed-profile'

            def fake_run(args, log, timeout, **kwargs):
                # Capture the effective child environment, including the original
                # bug's env=None inheritance, without launching any process.
                environment = kwargs.get('env')
                observations.append((args[1], dict(os.environ if environment is None else environment)))
                if args[1] == 'build-for-testing':
                    if failure == 'build':
                        raise RuntimeError('inert build failure')
                    derived = Path(args[args.index('-derivedDataPath') + 1])
                    products = derived / 'Build/Products'
                    products.mkdir(parents=True)
                    config = next(arg.split('=', 1)[1] for arg in args if arg.startswith('NAC_UI_FIXTURE='))
                    target = {'IsUITestBundle': True, 'BlueprintName': 'NACNativeUITests',
                              'EnvironmentVariables': {'NAC_UI_FIXTURE': config},
                              'TestBundlePath': '__TESTROOT__/NACNativeUITests.xctest'}
                    (products / 'fixture.xctestrun').write_bytes(plistlib.dumps({'TestTargets': [target]}))
                elif args[1] == 'test-without-building':
                    evidence.write_text(json.dumps({'app_pid': 100001, 'engine_pid': 100002,
                        'profile': str(profile), 'engine_reaped': failure is None,
                        'profile_removed': failure is None}))
                    result = Path(args[args.index('-resultBundlePath') + 1])
                    result.mkdir()
                    (result / 'inert-result.json').write_text('{}')
                    if failure:
                        raise RuntimeError('inert test failure')
                else:
                    self.fail('Unexpected launch command')

            def cleanup(record, app):
                self.assertTrue(app.is_dir())
                self.assertEqual(record, evidence)
                cleaned.append(str(app))
                if failure == 'cleanup':
                    raise RuntimeError('inert cleanup failure')

            def process_status(pid, **kwargs):
                settled.append(pid)
                return ''

            stack.enter_context(patch.dict(os.environ, ambient, clear=True))
            stack.enter_context(patch.object(ci_xctest, 'observe_prerequisites', return_value=status))
            stack.enter_context(patch.object(ci_xctest, 'observe_process_status', side_effect=process_status))
            for name in ('Popen', 'run', 'check_output'):
                stack.enter_context(patch.object(ci_xctest.subprocess, name,
                    side_effect=AssertionError('No process execution is allowed in this inert control')))
            if failure:
                with self.assertRaisesRegex(RuntimeError, 'inert ' + ('build' if failure == 'build' else 'test') + ' failure'):
                    ci_xctest.run_terminal(raw, fake_run, lambda args: '{}', cleanup=cleanup,
                                           validate=lambda record: {'inert': True})
            else:
                result = ci_xctest.run_terminal(raw, fake_run, lambda args: '{}', cleanup=cleanup,
                                                validate=lambda record: {'inert': True})
                self.assertEqual(result['terminal'], {'inert': True})
                config = json.loads((raw / 'xctest-fixture.json').read_text())
                self.assertEqual(config['scenario'], 'ci-terminal-xctest')
                self.assertEqual(result['runner']['generated_target']['EnvironmentVariables'],
                                 {'NAC_UI_FIXTURE': str(raw / 'xctest-fixture.json')})
            self.assertEqual(dict(os.environ), ambient, 'Parent environment must remain unchanged')
            receipt = json.loads((raw / 'xctest-relocation.json').read_text())
            retained = failure == 'cleanup'
            self.assertEqual(receipt['bundle_retained_for_unresolved_cleanup'], retained)
            self.assertEqual(Path(receipt['path']).exists(), retained)
            if retained:
                shutil.rmtree(receipt['path'])  # Inert files only, after retention is asserted.
            if failure != 'build':
                outcomes = json.loads((raw / 'xctest-outcomes.json').read_text())
                self.assertTrue(outcomes['input_launch_requested'])
                self.assertEqual(bool(outcomes['errors']['test']), failure is not None)
                self.assertEqual(bool(outcomes['errors']['cleanup']), retained)
            self.assertEqual(len(cleaned), int(failure in ('test', 'cleanup')))
            self.assertEqual(settled, [] if failure in ('build', 'cleanup') else [100001, 100002])
        self.assertEqual([stage for stage, _ in observations],
                         ['build-for-testing'] if failure == 'build' else ['build-for-testing', 'test-without-building'])
        for stage, environment in observations:
            with self.subTest(stage=stage, failure=failure):
                self.assertEqual(environment, permitted)
                self.assertTrue(set(forbidden).isdisjoint(environment))
                self.assertTrue(set(forbidden.values()).isdisjoint(environment.values()))

    def test_both_xcodebuild_children_filter_ambient_credentials(self):
        self.exercise_launch()

    def test_failed_build_filters_environment_and_removes_unlaunched_bundle(self):
        self.exercise_launch(failure='build')

    def test_failed_input_filters_environment_and_settles_owned_fixture(self):
        self.exercise_launch(failure='test')

    def test_failed_cleanup_retains_bundle_and_primary_failure(self):
        self.exercise_launch(failure='cleanup')


if __name__ == '__main__':
    unittest.main()
