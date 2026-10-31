import json
from pathlib import Path
import tempfile
import unittest

from ci_support import export_evidence
from ci_xctest import require_generated_runner, require_prerequisites, result_receipt


class XCTestPolicyTests(unittest.TestCase):
    def test_missing_existing_permission_never_admits_ui_test(self):
        valid = ('2', 'Developer mode is currently enabled.', 'Automation DOES NOT REQUIRE authentication.')
        self.assertFalse(require_prerequisites(*valid)['permission_mutations'])
        for values in [('0', *valid[1:]), ('', *valid[1:]),
                       ('2', 'Developer mode is disabled.', valid[2]),
                       (*valid[:2], 'Automation requires authentication.')]:
            with self.assertRaisesRegex(RuntimeError, 'no grant requested'):
                require_prerequisites(*values)

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
