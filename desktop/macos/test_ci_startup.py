"""Startup supervisor controls; synthetic actors never launch product or UI."""
from contextlib import ExitStack
import json
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from ci_startup import run_case, runner_environment


class StartupSupervisorTests(unittest.TestCase):
    def test_xcode_environment_removes_credentials_before_external_actor(self):
        with patch.dict(os.environ, {'DEVELOPER_DIR': '/Selected/Xcode', 'FIXTURE_TOKEN': 'test-only',
                                     'FIXTURE_API_KEY': 'test-only', 'NAC_MANAGED_CONFIG': 'test-only'}, clear=True):
            self.assertEqual(runner_environment(), {'DEVELOPER_DIR': '/Selected/Xcode'})

    def exercise(self, *, sdk_failure=False, cleanup_failure=False, test_failure=False, integrity_failure=False):
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
            root = Path(temporary).resolve()
            profiles, folder = root / 'profiles', root / 'case'
            profiles.mkdir()
            fixture = profiles / 'nac342-xctest-onboarding-synthetic'
            fixture.mkdir()
            config_path = fixture / 'startup-config.json'
            config_path.write_text('{}\n')
            config = {'app_path': str(fixture / 'NAC.app'), 'scenario': 'onboarding', 'fixture_root': str(fixture)}
            profile = {'root': fixture}
            calls = []
            witness = MagicMock(failure=None)
            witness.start.side_effect = lambda *args: calls.append('preinstalled')
            witness.attachment_binding.return_value = {'scope': 'synthetic unit fixture'}
            witness.settle.side_effect = RuntimeError('unknown owner') if cleanup_failure else None
            witness.settle.return_value = {'root': str(fixture), 'owned_processes_settled': True, 'observed_processes': []}
            witness.failure_receipt.return_value = {'scope': 'synthetic unit owner receipt'}
            audit = MagicMock(failure=None)
            audit.stop.return_value = {'scope': 'synthetic unit API'}
            provider = MagicMock()
            provider.start.return_value = 'http://127.0.0.1:4321'
            provider.stop.return_value = {'scope': 'synthetic provider'}
            def generated(*args):
                calls.append('full-sdk-build')
                if sdk_failure:
                    raise RuntimeError('SDK unavailable')
                runner = root / 'synthetic.xctestrun'
                runner.write_bytes(b'unit-only synthetic runner')
                return runner, {'xctestrun_sha256': hashlib.sha256(runner.read_bytes()).hexdigest()}
            def run(args, *arguments, **options):
                self.assertIn('preinstalled', calls)
                calls.append('test-request')
                (folder / 'ordinary-startup.xcresult').mkdir()
                if test_failure:
                    raise RuntimeError('synthetic test failure')
            def collect(*args):
                calls.append('collect')
                attachments = folder / 'attachments'
                attachments.mkdir()
                (attachments / 'nac342-ordinary-onboarding.png').write_bytes(b'unit-placeholder-never-decoded')
                return {'complete': True, 'scope': 'synthetic unit attachments'}
            replacements = {
                'Provider': MagicMock(return_value=provider), 'prepare_profile': MagicMock(return_value=profile),
                'prepare_configuration': MagicMock(return_value=(config, config_path, {})),
                'configuration_selection': MagicMock(return_value={}), 'immutable_snapshot': MagicMock(return_value={}),
                'generated_runner': generated, 'observe_prerequisites': MagicMock(return_value={}),
                'authorization_policy': MagicMock(return_value={}), 'test_contract': MagicMock(),
                'AttachmentTool': MagicMock(), 'OwnerWitness': MagicMock(return_value=witness),
                'LiveAudit': MagicMock(return_value=audit), 'result_receipt': MagicMock(return_value={'files': 1}),
                'collect': collect, 'require_integrity': MagicMock(return_value={}), 'remove_profile': MagicMock()}
            if integrity_failure:
                replacements['require_integrity'].side_effect = RuntimeError('protected bytes changed')
            for name, replacement in replacements.items():
                stack.enter_context(patch('ci_startup.' + name, replacement))
            if sdk_failure or cleanup_failure or test_failure or integrity_failure:
                with self.assertRaises(RuntimeError):
                    run_case(folder, profiles, 'onboarding', root, root, root, root, 'a' * 40, {}, root, root,
                             run, MagicMock(), MagicMock(return_value={'scope': 'synthetic OCR'}))
            else:
                run_case(folder, profiles, 'onboarding', root, root, root, root, 'a' * 40, {}, root, root,
                         run, MagicMock(), MagicMock(return_value={'scope': 'synthetic OCR'}))
            result = json.loads((folder / 'case.json').read_text())
            if sdk_failure:
                self.assertEqual(calls, ['full-sdk-build'])
                witness.start.assert_not_called()
                self.assertFalse(result['public_test_requested'])
                self.assertTrue(result['input_completion_unknown'])
            else:
                self.assertEqual(calls, ['full-sdk-build', 'preinstalled', 'test-request', 'collect'])
                witness.settle.assert_called_once()
                witness.stop.assert_called_once()
                self.assertTrue(result['public_test_requested'])
            if sdk_failure or cleanup_failure or integrity_failure:
                replacements['remove_profile'].assert_not_called()
                self.assertTrue((folder / 'retained-fixture.json').exists())
            else:
                replacements['remove_profile'].assert_called_once()
            if test_failure:
                self.assertFalse(result['passed'])
                self.assertEqual(result['errors']['test']['type'], 'RuntimeError')
                self.assertIsNone(result['errors']['collector'])
            self.assertFalse(result['rendered_UI_reload_observed'])
            if integrity_failure:
                retained = json.loads((folder / 'retained-fixture.json').read_text())
                self.assertTrue(retained['positive_process_settlement'])
                self.assertIn('integrity', retained['retention_reasons'])
                self.assertEqual(result['protected_before'], {})
                self.assertEqual(result['protected_after'], {})

    def test_sdk_failure_never_starts_observer_or_requests_input(self):
        self.exercise(sdk_failure=True)

    def test_unknown_cleanup_preserves_fixture(self):
        self.exercise(cleanup_failure=True)

    def test_test_failure_still_collects_and_settles_exact_owner(self):
        self.exercise(test_failure=True)

    def test_integrity_failure_keeps_before_after_hashes_and_profile_after_settlement(self):
        self.exercise(integrity_failure=True)

    def test_success_requires_build_witness_collection_policy_integrity_and_cleanup(self):
        self.exercise()


if __name__ == '__main__':
    unittest.main()
