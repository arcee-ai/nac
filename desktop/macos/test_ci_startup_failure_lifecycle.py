"""Actual caller/audit/run/settlement with inert process and kernel ports."""
from contextlib import ExitStack
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import ci
from ci_startup import run_case
from ci_support import MAX_FILE, export_evidence
from ci_startup_api import FixtureFailure, owned_listener
from ci_startup_audit import LiveAudit
import test_ci_startup_owner as owner_fixtures


class FailureLifecycleTests(unittest.TestCase):
    def exercise(self, mode, *, with_baseline=False, cleanup_error=False):
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
            root = Path(temporary).resolve()
            profiles = root / 'profiles'; profiles.mkdir()
            fixture = profiles / 'nac342-xctest-inert'; fixture.mkdir()
            folder = root / 'case'
            config_path = fixture / 'configuration.json'; config_path.write_text('{}')
            source = owner_fixtures.StartupOwnerTests('runTest'); source.setUp()
            source.config.update(scenario='configuredLocal', app_path=str(fixture / 'NAC.app'), fixture_root=str(fixture))
            owner = source.owner
            events, primary = [], []
            state = {'alive': True, 'commit': False}
            started, sampled = threading.Event(), threading.Event()
            app, engine = source.node('app', 10, 1), source.node('engine', 11, 10)
            owner.start = lambda *_: (source.ready(), source.observe([app, engine]))
            owner.stop = Mock()
            def wait_empty(after, seconds=25):
                self.assertIn('collect', events)
                events.append('external_settle')
                source.clock = max(source.clock, after + .01)
                source.observe([])
                state['alive'] = False
                return True
            owner.wait_empty = wait_empty
            audit = LiveAudit(owner, {'scenario': 'configuredLocal'}, root)
            def sample():
                if not started.wait(1): raise AssertionError('Inert child never began')
                try:
                    if mode == 'early_api': raise FixtureFailure('served_entry_asset_bytes')
                    owned_listener(11, engine)
                finally:
                    sampled.set()
            audit.sample = sample
            companion = Mock(failure=None)
            companion.settlement = {'owned_processes_settled': True}
            companion.stop.return_value = companion.settlement
            companion.preflight_diagnostic.return_value = None
            companion.failure_diagnostic.return_value = None
            companion.reconcile_retirement.return_value = {}
            if mode == 'unknown_cleanup':
                def unknown_owner():
                    owner.process_failure = 'ownership_observation_unavailable' if with_baseline else 'owner_stream_unavailable'
                    if with_baseline:
                        owner.stream_diagnostic = {'producer_failure': {
                            'stage': 'resources_candidates', 'kind': 'ownership_invalid'}}
                companion.stop.side_effect = unknown_owner
            child_state = {'returncode': None}
            class Child:
                pid = 57001
                stdout = io.BytesIO(b'Inert failed XCTest and first attachment progress\n')
                def poll(self): return child_state['returncode']
                def wait(self, timeout=None):
                    if child_state['returncode'] is not None: return child_state['returncode']
                    if mode == 'prior_termination':
                        state['alive'] = False; events.append('test_terminate')
                    started.set()
                    if not sampled.wait(1): raise AssertionError('Actual audit never sampled')
                    if mode in ('prior_termination', 'early_api'):
                        audit.thread.join(1)
                        raise subprocess.TimeoutExpired(['inert-xcodebuild'], timeout)
                    state['commit'] = True; events.append('xcresult_commit')
                    child_state['returncode'] = 65
                    return 65
            def kill_group(pid, signum):
                self.assertEqual(pid, 57001)
                events.append('owned_wrapper_signal'); child_state['returncode'] = -int(signum)
            stack.enter_context(patch('ci.subprocess.Popen', return_value=Child()))
            stack.enter_context(patch('ci.os.killpg', side_effect=kill_group))
            stack.enter_context(patch('ci_startup_api.native_identity', side_effect=lambda _: engine if state['alive'] else None))
            stack.enter_context(patch('ci_startup_api.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout=b'p11\nn127.0.0.1:4321\n')))
            def launch(args, log, cap, **kwargs):
                self.assertEqual(cap, 300)
                try: ci.run(args, log, cap, **kwargs)
                except BaseException as error:
                    primary.append(error); raise
            def generated(*_, **options):
                path = root / 'inert.xctestrun'; path.write_bytes(b'inert')
                return path, {'xctestrun_sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
            def collect(*args):
                events.append('collect')
                if not state['commit']: raise RuntimeError('No committed XCTest tree')
                self.assertTrue(state['alive'], 'Test teardown must leave existing external owner in custody')
                output = folder / 'attachments'; output.mkdir()
                (output / 'nac342-first-preflight-failure-v1-configuredLocal.json').write_text(json.dumps({
                    'schema': 'nac342-first-preflight-failure-v1', 'acceptance': False,
                    'nonce': 'a' * 64, 'configuration_sha256': hashlib.sha256(config_path.read_bytes()).hexdigest(),
                    'step': 'prepare_interaction', 'operation_index': 1, 'error_family': 'receipt_invalid'}))
                raise RuntimeError('Failed test cannot supply complete ordinary evidence')
            setup = Mock(); setup.__enter__ = Mock(return_value={'base_url': 'http://inert'})
            setup.__exit__ = Mock(return_value=False)
            provider = Mock(); provider.start.return_value = 'http://127.0.0.1:4321'
            provider.stop.return_value = {'scope': 'inert provider'}
            remove = Mock()
            replacements = {
                'prepare_profile': Mock(return_value={'root': fixture}),
                'prepare_configuration': Mock(return_value=(source.config, config_path, {})),
                'configuration_selection': Mock(return_value={}), 'setup_engine': Mock(return_value=setup),
                'seed_model': Mock(return_value={}), 'Provider': Mock(return_value=provider),
                'immutable_snapshot': Mock(return_value={}), 'observe_prerequisites': Mock(return_value={}),
                'authorization_policy': Mock(return_value={}), 'generated_runner': generated,
                'test_contract': Mock(), 'package_contract': Mock(), 'AttachmentTool': Mock(),
                'OwnerWitness': Mock(return_value=owner), 'AXCompanion': Mock(return_value=companion),
                'ax_declaration': Mock(return_value={}), 'LiveAudit': Mock(return_value=audit),
                'result_receipt': Mock(return_value={}), 'collect': collect,
                'require_integrity': Mock(return_value={}), 'remove_profile': remove,
                'persisted_audit': Mock()}
            # Signature admission has its own real-call-path inert tests.
            stack.enter_context(patch('ci_startup_signatures.recheck_private_build'))
            for name, value in replacements.items(): stack.enter_context(patch('ci_startup.' + name, value))
            original_generated = generated
            retained = {}
            def generated_result(*args, **options):
                (folder / 'ordinary-startup.xcresult').mkdir()
                if with_baseline:
                    for relative in ('derived', 'normal-signature-baseline/derived'):
                        products = folder / relative / 'Build/Intermediates.noindex/XCBuildData/inert.xcbuilddata'
                        products.mkdir(parents=True)
                        (products / 'manifest.json').write_text(json.dumps({'inert': 'x' * MAX_FILE}))
                    retained.update({
                        'runner.json': json.dumps({'private_request_signature_gate': {
                            'acceptance': False, 'scope': 'inert embedded gate fixture'}}),
                        'normal-signature-baseline/runner.json': '{"scope":"inert normal runner"}',
                        'normal-signature-baseline/build.log': 'inert normal build log',
                        'normal-signature-baseline/other-derived/keep.log': 'unrelated build directory',
                        'private-request-signatures.json': '{"acceptance":false,"scope":"inert gate"}',
                        'signature-command-15.log': 'inert signature observation INERT-SECRET'})
                    for relative, value in retained.items():
                        target = folder / relative; target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_text(value)
                return original_generated(*args, **options)
            if cleanup_error:
                import shutil
                removing = shutil.rmtree
                def remove_build(path, *args, **kwargs):
                    if Path(path) == folder / 'normal-signature-baseline/derived':
                        raise OSError('inert baseline derived cleanup failed')
                    return removing(path, *args, **kwargs)
                stack.enter_context(patch('ci_startup.shutil.rmtree', side_effect=remove_build))
            stack.enter_context(patch('ci_startup.generated_runner', side_effect=generated_result))
            with self.assertRaises(RuntimeError) as caught:
                run_case(folder, profiles, 'configuredLocal', root, root, root, root, 'a' * 40, {}, root, root,
                         launch, Mock(), Mock())
            self.assertEqual(len(primary), 1); self.assertIs(caught.exception, primary[0])
            case = json.loads((folder / 'case.json').read_text())
            self.assertFalse(case['passed']); self.assertTrue(case['input_completion_unknown'])
            replacements['persisted_audit'].assert_not_called()
            provider.stop.assert_called_once_with(require_complete=False)
            if mode in ('prior_termination', 'early_api'):
                self.assertFalse(state['commit']); self.assertIn('owned_wrapper_signal', events)
                self.assertEqual(case['api_audit_diagnostic']['caller_abort']['origin'], 'audit')
                self.assertEqual(case['api_audit_diagnostic']['failure']['guard_code'],
                                 'listener_process_generation' if mode == 'prior_termination' else 'served_entry_asset_bytes')
            else:
                self.assertTrue(state['commit']); self.assertNotIn('owned_wrapper_signal', events)
                self.assertFalse(case['api_audit_diagnostic']['caller_abort']['observed'])
                if mode != 'unknown_cleanup':
                    self.assertLess(events.index('xcresult_commit'), events.index('collect'))
                    self.assertLess(events.index('collect'), events.index('external_settle'))
                    self.assertTrue(case['cleanup']['owned_processes_settled'])
                    self.assertEqual(len(case['cleanup']['retired_identities']), 2)
                    self.assertEqual(case['cleanup']['fallback_signals'], [])
                    self.assertTrue((folder / 'attachments/nac342-first-preflight-failure-v1-configuredLocal.json').exists())
            if mode == 'unknown_cleanup':
                remove.assert_not_called(); self.assertTrue((folder / 'retained-fixture.json').exists())
                self.assertNotIn('cleanup', case)
            else: remove.assert_called_once()
            self.assertFalse(audit.thread.is_alive())
            if with_baseline:
                if mode == 'unknown_cleanup':
                    self.assertEqual(case['owner_observation']['process_failure'], 'ownership_observation_unavailable')
                    self.assertEqual(case['owner_observation']['stream_diagnostic']['producer_failure'],
                                     {'stage': 'resources_candidates', 'kind': 'ownership_invalid'})
                    self.assertFalse(case['owner_observation']['positive_process_settlement'])
                    self.assertTrue(fixture.exists())
                for relative, value in retained.items():
                    self.assertEqual((folder / relative).read_text(), value)
                if cleanup_error:
                    self.assertIsInstance(caught.exception.__cause__, OSError)
                    self.assertEqual(str(caught.exception.__cause__), 'inert baseline derived cleanup failed')
                    self.assertTrue((folder / 'normal-signature-baseline/derived').exists())
                    return
                output = root / 'exported'
                # The real strict exporter previously stopped on the leaked
                # baseline build manifest, hiding otherwise bounded evidence.
                export_evidence(folder, output, [('INERT-SECRET', '<redacted>')],
                                strict_json=True, essential_first=True, include_hashes=True)
                self.assertEqual(json.loads((output / 'case.json').read_text()), case)
                self.assertFalse((folder / 'derived').exists())
                self.assertFalse((folder / 'normal-signature-baseline/derived').exists())
                for relative, value in retained.items():
                    self.assertEqual((output / relative).read_text(), value.replace('INERT-SECRET', '<redacted>'))
                self.assertTrue((output / 'test.log').is_file())
                diagnostic = output / 'attachments/nac342-first-preflight-failure-v1-configuredLocal.json'
                # Unknown ownership already prevents collection in this fixture;
                # retaining other evidence must not fabricate that attachment.
                self.assertEqual(diagnostic.is_file(), mode != 'unknown_cleanup')
                if mode == 'unknown_cleanup':
                    retained_fixture = json.loads((output / 'retained-fixture.json').read_text())
                    self.assertFalse(retained_fixture['positive_process_settlement'])
                    self.assertIn('cleanup', retained_fixture['retention_reasons'])

    def test_baseline_build_products_cannot_block_failed_case_evidence_export(self):
        for mode in ('handoff', 'unknown_cleanup'):
            with self.subTest(mode=mode): self.exercise(mode, with_baseline=True)

    def test_baseline_build_cleanup_error_preserves_original_failed_test(self):
        self.exercise('unknown_cleanup', with_baseline=True, cleanup_error=True)

    def test_prior_test_termination_can_abort_the_wrapper_before_result_commit(self):
        self.exercise('prior_termination')

    def test_failed_test_commit_and_collection_precede_existing_external_settlement(self):
        self.exercise('handoff')

    def test_independent_earlier_audit_failure_still_aborts_immediately(self):
        self.exercise('early_api')

    def test_failed_outcome_never_grants_unknown_cleanup_or_profile_removal(self):
        self.exercise('unknown_cleanup')
