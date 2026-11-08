"""Startup supervisor controls; synthetic actors never launch product or UI."""
from contextlib import ExitStack
import json
import hashlib
import os
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from ci import run as owned_run
from ci_startup import audit_diagnostic, run_case, runner_environment
from ci_startup_api import FixtureFailure
from ci_startup_audit import LiveAudit


class StartupSupervisorTests(unittest.TestCase):
    def test_xcode_environment_removes_credentials_before_external_actor(self):
        with patch.dict(os.environ, {'DEVELOPER_DIR': '/Selected/Xcode', 'FIXTURE_TOKEN': 'test-only',
                                     'FIXTURE_API_KEY': 'test-only', 'NAC_MANAGED_CONFIG': 'test-only'}, clear=True):
            self.assertEqual(runner_environment(), {'DEVELOPER_DIR': '/Selected/Xcode'})

    def exercise(self, *, sdk_failure=False, cleanup_failure=False, test_failure=False, integrity_failure=False,
                 diagnostic_error=None, witness_rejection=False, configured=False, ax_failure=False,
                 companion_diagnostic_error=False, ui_failure=False, settled_ax_failure=False, export_failure=False, pre_input_failure=False, observer_stop_failure=False):
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
            root = Path(temporary).resolve()
            scenario = 'configuredLocal' if configured else 'onboarding'
            profiles, folder = root / 'profiles', root / 'case'
            profiles.mkdir()
            fixture = profiles / 'nac342-xctest-onboarding-synthetic'
            fixture.mkdir()
            config_path = fixture / 'startup-config.json'
            config_path.write_text('{}\n')
            config = {'app_path': str(fixture / 'NAC.app'), 'scenario': scenario, 'fixture_root': str(fixture)}
            profile = {'root': fixture}
            calls = []
            primary = RuntimeError('synthetic test failure')
            witness = MagicMock(failure=None, ui_terminal=False)
            def start_witness(*args):
                calls.append('preinstalled')
                if pre_input_failure: witness.failure = 'app_windows'
            witness.start.side_effect = start_witness
            if observer_stop_failure: witness.stop.side_effect = RuntimeError('inert unsettled metadata helper')
            witness.attachment_binding.return_value = {'scope': 'synthetic unit fixture'}
            witness.settle.side_effect = RuntimeError('unknown owner') if cleanup_failure else None
            witness.settle.return_value = {'root': str(fixture), 'owned_processes_settled': True, 'observed_processes': []}
            witness.failure_receipt.return_value = {'scope': 'synthetic unit owner receipt'}
            companion = MagicMock(failure=None, settlement=None)
            companion.failure_diagnostic.return_value = None
            if companion_diagnostic_error:
                companion.failure_diagnostic.side_effect = RuntimeError('private diagnostic canary')
            companion.stop.return_value = {'owned_processes_settled': True}
            companion.reconcile_retirement.return_value = {'terminal_observed': False}
            if configured:
                def stop_companion():
                    calls.append('ax-stopped')
                    if ax_failure: raise RuntimeError('unknown companion custody')
                    companion.settlement = {'owned_processes_settled': True}
                    if settled_ax_failure: raise primary
                    return companion.settlement
                def settle_app(*args):
                    calls.append('app-settled')
                    return {'root': str(fixture), 'owned_processes_settled': True, 'observed_processes': []}
                companion.stop.side_effect = stop_companion
                witness.settle.side_effect = settle_app
            setup = MagicMock()
            setup.__enter__.return_value = {'base_url': 'http://inert-fixture', 'scope': 'synthetic; no engine'}
            audit = MagicMock(failure=None)
            audit.stop.return_value = {'scope': 'synthetic unit API'}
            audit.failure_snapshot.return_value = {'schema': 'nac-startup-api-diagnostic-v1', 'rejected': False}
            begun = threading.Event()
            child_pid = root / 'owned-test-child.pid'
            if diagnostic_error is not None:
                audit = LiveAudit(SimpleNamespace(), {'scenario': 'onboarding'}, root)
                audit.phase = 'entry_assets'
                def rejected_sample():
                    if not begun.wait(timeout=2):
                        raise AssertionError('Controlled child did not start')
                    raise diagnostic_error
                audit.sample = rejected_sample
            if witness_rejection:
                audit.failure = 'ordinary_api_audit_rejected'
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
                if diagnostic_error is not None:
                    def abort():
                        if child_pid.exists():
                            begun.set()
                        return options['abort']()
                    # This actual child only writes its PID and waits. The CI
                    # runner owns its process group; no NAC, Xcode or UI runs.
                    owned_run([sys.executable, '-B', '-c',
                        'import os,pathlib,sys,time; pathlib.Path(sys.argv[1]).write_text(str(os.getpid())); time.sleep(30)',
                        str(child_pid)], folder / 'controlled-child.log', 3, abort=abort)
                if witness_rejection or ui_failure:
                    witness.failure = 'app_windows' if ui_failure else 'ownership_observation_unavailable'
                    self.assertEqual(options['abort'](), witness.failure)
                if test_failure:
                    raise primary
            def collect(*args):
                calls.append('collect')
                if diagnostic_error is not None:
                    raise RuntimeError('Interrupted test has no complete dispatch receipt')
                attachments = folder / 'attachments'
                attachments.mkdir()
                (attachments / ('nac342-ordinary-' + scenario + '.png')).write_bytes(b'unit-placeholder-never-decoded')
                return {'complete': True, 'scope': 'synthetic unit attachments'}
            replacements = {
                'AXCompanion': MagicMock(return_value=companion), 'ax_declaration': MagicMock(return_value={}),
                'setup_engine': MagicMock(return_value=setup), 'seed_model': MagicMock(return_value={}), 'persisted_audit': MagicMock(return_value={}),
                'Provider': MagicMock(return_value=provider), 'prepare_profile': MagicMock(return_value=profile),
                'prepare_configuration': MagicMock(return_value=(config, config_path, {})),
                'configuration_selection': MagicMock(return_value={}), 'immutable_snapshot': MagicMock(return_value={}),
                'generated_runner': generated, 'observe_prerequisites': MagicMock(return_value={}),
                'authorization_policy': MagicMock(return_value={}), 'test_contract': MagicMock(), 'package_contract': MagicMock(),
                'AttachmentTool': MagicMock(), 'OwnerWitness': MagicMock(return_value=witness),
                'LiveAudit': MagicMock(return_value=audit), 'result_receipt': MagicMock(return_value={'files': 1}),
                'collect': collect, 'require_integrity': MagicMock(return_value={}), 'remove_profile': MagicMock()}
            if integrity_failure:
                replacements['require_integrity'].side_effect = RuntimeError('protected bytes changed')
            for name, replacement in replacements.items():
                stack.enter_context(patch('ci_startup.' + name, replacement))
            if export_failure:
                from ci_startup import write as actual_write
                def failed_export(path, value):
                    if path.name == 'case.json': raise OSError('inert export failure')
                    return actual_write(path, value)
                stack.enter_context(patch('ci_startup.write', failed_export))
            if sdk_failure or cleanup_failure or test_failure or integrity_failure or diagnostic_error is not None or ax_failure or ui_failure or settled_ax_failure or witness_rejection or pre_input_failure or observer_stop_failure:
                with self.assertRaises(RuntimeError) as caught:
                    run_case(folder, profiles, scenario, root, root, root, root, 'a' * 40, {}, root, root,
                             run, MagicMock(), MagicMock(return_value={'scope': 'synthetic OCR'}))
                if test_failure or settled_ax_failure: self.assertIs(caught.exception, primary)
                if export_failure:
                    self.assertIsInstance(caught.exception.__cause__, OSError)
                    witness.settle.assert_called_once(); witness.stop.assert_called_once()
                    return
            else:
                run_case(folder, profiles, scenario, root, root, root, root, 'a' * 40, {}, root, root,
                         run, MagicMock(), MagicMock(return_value={'scope': 'synthetic OCR'}))
            result = json.loads((folder / 'case.json').read_text())
            if sdk_failure:
                self.assertEqual(calls, ['full-sdk-build'])
                witness.start.assert_not_called()
                self.assertFalse(result['public_test_requested'])
                self.assertTrue(result['input_completion_unknown'])
            elif pre_input_failure:
                self.assertEqual(calls, ['full-sdk-build', 'preinstalled'])
                witness.settle.assert_called_once(); witness.stop.assert_called_once()
                self.assertFalse(result['public_test_requested'])
                self.assertTrue(result['input_completion_unknown'])
                self.assertFalse(result['passed'])
            else:
                expected = ['full-sdk-build', 'preinstalled', 'test-request']
                if configured: expected.append('ax-stopped')
                if not (ui_failure or witness_rejection or ax_failure or settled_ax_failure): expected.append('collect')
                if configured: expected.append('app-settled')
                self.assertEqual(calls, expected)
                witness.settle.assert_called_once()
                witness.stop.assert_called_once()
                self.assertTrue(result['public_test_requested'])
            if sdk_failure or cleanup_failure or integrity_failure or ax_failure or observer_stop_failure:
                replacements['remove_profile'].assert_not_called()
                self.assertTrue((folder / 'retained-fixture.json').exists())
            else:
                replacements['remove_profile'].assert_called_once()
            if configured:
                companion.start.assert_called_once()
                companion.stop.assert_called_once()
                self.assertEqual(result['errors']['ax_owner'] is not None, ax_failure or settled_ax_failure)
                self.assertEqual(replacements['persisted_audit'].call_count, 0 if ax_failure or ui_failure or settled_ax_failure else 1)
            if test_failure:
                self.assertFalse(result['passed'])
                self.assertEqual(result['errors']['test']['type'], 'RuntimeError')
                if diagnostic_error is None and not witness_rejection:
                    self.assertIsNone(result['errors']['collector'])
            if diagnostic_error is not None:
                metadata = json.loads((folder / 'live-api-diagnostic.json').read_text())
                self.assertEqual(metadata['caller_abort'], {'observed': True, 'origin': 'audit'})
                self.assertEqual(metadata['phase'], 'entry_assets')
                self.assertTrue(metadata['rejected'])
                self.assertLessEqual((folder / 'live-api-diagnostic.json').stat().st_size, 8192)
                self.assertTrue(result['input_completion_unknown'])
                self.assertFalse(result['passed'])
                self.assertNotIn('private-marker', json.dumps(result))
                if type(diagnostic_error) is FixtureFailure:
                    self.assertEqual(metadata['failure']['guard_code'], 'served_entry_asset_bytes')
                    self.assertEqual(metadata['failure']['operands']['asset_ordinal'], 0)
                else:
                    self.assertEqual(metadata['failure']['exception_type'], 'unknown')
                self.assertFalse(audit.thread.is_alive())
                with self.assertRaises(ProcessLookupError):
                    os.kill(int(child_pid.read_text()), 0)  # Observation only; never signal an adopted PID.
            if ui_failure or settled_ax_failure:
                self.assertFalse(result['passed'])
                self.assertTrue(result['cleanup']['owned_processes_settled'])
                self.assertTrue(result['profile_removed'])
                if ui_failure: self.assertTrue(result['input_completion_unknown'])
                if settled_ax_failure: self.assertTrue(result['ax_companion_custody']['owned_processes_settled'])
            if witness_rejection:
                self.assertEqual(result['api_audit_diagnostic']['caller_abort'], {'observed': True, 'origin': 'witness'})
            self.assertFalse(result['rendered_UI_reload_observed'])
            if integrity_failure:
                retained = json.loads((folder / 'retained-fixture.json').read_text())
                self.assertTrue(retained['positive_process_settlement'])
                self.assertIn('integrity', retained['retention_reasons'])
                self.assertEqual(result['protected_before'], {})
                self.assertEqual(result['protected_after'], {})

    def test_ui_failure_before_input_requests_zero_public_tests(self):
        self.exercise(pre_input_failure=True)

    def test_unknown_metadata_helper_retains_profile_after_positive_app_settlement(self):
        self.exercise(observer_stop_failure=True)

    def test_ui_failure_still_settles_but_remains_failed_unknown_and_skips_later_api(self):
        self.exercise(configured=True, ui_failure=True)

    def test_settled_failed_companion_preserves_error_without_poisoning_profile_custody(self):
        self.exercise(configured=True, settled_ax_failure=True)

    def test_primary_failure_survives_case_export_fault_after_cleanup(self):
        self.exercise(test_failure=True, export_failure=True)

    def test_unknown_ax_companion_retains_profile_after_successful_app_settlement(self):
        self.exercise(configured=True, ax_failure=True)

    def test_settled_ax_companion_allows_existing_profile_cleanup(self):
        self.exercise(configured=True)

    def test_companion_diagnostic_loss_never_changes_success_or_unknown_custody(self):
        self.exercise(configured=True, companion_diagnostic_error=True)
        self.exercise(configured=True, ax_failure=True, companion_diagnostic_error=True)

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

    def test_real_audit_thread_aborts_owned_helper_and_preserves_safe_failure_before_stop(self):
        error = FixtureFailure('served_entry_asset_bytes', {'asset_ordinal': 0, 'actual_bytes': 1384,
                               'expected_bytes': 941, 'actual_sha256': 'a' * 64, 'body': 'private-marker'})
        self.exercise(test_failure=True, diagnostic_error=error)

    def test_unknown_thread_exception_content_is_never_formatted_or_retained(self):
        class PrivateError(Exception):
            def __str__(self):
                raise AssertionError('private-marker')
        self.exercise(test_failure=True, diagnostic_error=PrivateError())

    def test_witness_rejection_preserves_original_or_order_when_audit_also_rejects(self):
        self.exercise(test_failure=True, witness_rejection=True)

    def test_diagnostic_bound_and_sink_failure_do_not_change_fixture_control_flow(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            audit = MagicMock()
            audit.failure_snapshot.return_value = {'oversize': 'private-marker' * 8192}
            value = audit_diagnostic(audit, {'observed': True, 'origin': 'audit'}, folder)
            self.assertTrue(value['unavailable'])
            self.assertNotIn('private-marker', (folder / 'live-api-diagnostic.json').read_text())
            audit.failure_snapshot.side_effect = ValueError('private-marker')
            for error in (OSError('private-marker'), RuntimeError('private-marker'), KeyboardInterrupt()):
                with patch.object(Path, 'write_bytes', side_effect=error):
                    self.assertTrue(audit_diagnostic(audit, {}, folder)['unavailable'])


if __name__ == '__main__':
    unittest.main()
