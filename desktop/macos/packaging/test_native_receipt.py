"""Synthetic producer-output admission tests, separate from actual app evidence."""
import ast
import copy
import json
import plistlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from native_receipt import (BUILD_SUPPORT, ENGINE, ENGINE_IDENTITY, FIXTURE_MARKERS, NORMAL_FLAGS,
                            NORMAL_SOURCES, RECEIPT, SHELL, expected_identity,
                            validate_native_receipt)
from provenance import digest, write_json


class NativeReceiptContract(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='nac native receipt ')
        self.root = Path(self.temporary.name)
        self.app = self.root / 'output/NAC.app'
        self.app.mkdir(parents=True)
        for name in ['Contents/Info.plist', SHELL, ENGINE, ENGINE_IDENTITY, RECEIPT]:
            path = self.app / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'synthetic normal output')
        for name in NORMAL_SOURCES:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('// synthetic compiler input\n')
        for name in BUILD_SUPPORT:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('# synthetic build support\n')
        (self.app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
            'CFBundleIdentifier': 'ai.arcee.nac.dev', 'CFBundleName': 'NAC Development'}))
        factory = patch('native_receipt.run', return_value='ai.arcee.nac.dev\nNAC Development')
        self.factory = factory.start()
        self.addCleanup(factory.stop)
        self.source = {'revision': 'a' * 40, 'product_version': '1.2.3'}
        self.engine_receipt = {'build': {'id': 'dev-' + 'a' * 40, 'track': 'dev'},
                               'engine': {'sha256': digest(self.app / ENGINE)}}
        self.identity = expected_identity(self.source, self.engine_receipt['build'])
        write_json(self.app / ENGINE_IDENTITY, self.identity)
        self.receipt = {'version': 1, 'phase': 'unsigned-build', 'mode': 'app-build',
                        'normal_startup': True, 'smoke_instrumentation': False, 'source_dirty': False,
                        'instance_smoke_instrumentation': False, 'lifecycle_smoke_instrumentation': False,
                        'attention_smoke_instrumentation': False,
                        'bundle_identifier': 'ai.arcee.nac.dev',
                        'bundle_name': 'NAC Development',
                        'build_support_files': {name: digest(self.root / name) for name in BUILD_SUPPORT},
                        'preview_definitions_excluded': True, 'source_head': self.source['revision'],
                        'compiler_flags': NORMAL_FLAGS.copy(),
                        'native_source_files': {name: digest(self.root / name) for name in NORMAL_SOURCES},
                        'engine_identity': self.identity, 'fixture_markers_absent': FIXTURE_MARKERS.copy(),
                        'sdk_version': 'synthetic', 'engine_sha256': digest(self.app / ENGINE),
                        'native_sha256': digest(self.app / SHELL),
                        'info_plist_sha256': digest(self.app / 'Contents/Info.plist')}

    def tearDown(self):
        self.temporary.cleanup()

    def validate(self, receipt=None, identity=None):
        write_json(self.app / RECEIPT, self.receipt if receipt is None else receipt)
        return validate_native_receipt(self.app, self.source, self.engine_receipt,
                                       self.identity if identity is None else identity, self.root)

    def test_exact_nominated_source_and_unsigned_output_are_admitted_without_qualification(self):
        result = self.validate()
        self.assertEqual(result, self.receipt)
        self.assertNotIn('consumer_ready', result)
        self.assertNotIn('notarized', result)

    CURRENT_MARKERS = [
        'preview-dummy-only', 'nac-mac-preview-', 'FixtureProvider', 'FixtureBootstrap',
        'NativeCommandSmoke', 'NativeCommandInput', '__commandInputEvidence',
        'AttentionSmoke', 'LifecycleSmoke', 'QuitWebViewFixture', '__quitLifecycleObserver',
        'offline-dummy-local-only', 'OfflineProviderPolicy', 'OfflineNetworkFence',
        'OfflineWebProbe', 'OfflineProviderSmoke', 'OfflineHTTPControlTarget',
    ]

    def test_current_seventeen_marker_receipt_is_admitted(self):
        receipt = {**self.receipt, 'fixture_markers_absent': self.CURRENT_MARKERS.copy()}
        self.assertEqual(self.validate(receipt), receipt)
        self.assertEqual(FIXTURE_MARKERS, self.CURRENT_MARKERS)

    def test_closed_marker_contract_matches_current_canonical_writer(self):
        writer = Path(__file__).resolve().parents[1] / 'build_receipt.py'
        assignments = [node.value for node in ast.walk(ast.parse(writer.read_text()))
                       if isinstance(node, ast.Assign) and any(
                           isinstance(target, ast.Name) and target.id == 'markers'
                           for target in node.targets)]
        self.assertEqual(len(assignments), 1)
        self.assertEqual(ast.literal_eval(assignments[0]), self.CURRENT_MARKERS)
        self.assertEqual(len(FIXTURE_MARKERS), 17)
        self.assertEqual(FIXTURE_MARKERS, self.CURRENT_MARKERS)

    def test_old_missing_extra_duplicate_or_reordered_marker_proofs_are_rejected(self):
        current = self.CURRENT_MARKERS
        variants = [('old eleven', current[:11]), ('extra', current + ['UnexpectedFixture']),
                    ('duplicate appended', current + [current[-1]]),
                    ('duplicate replacing missing', current[:-1] + [current[0]]),
                    ('reordered', list(reversed(current)))]
        variants.extend(('missing ' + marker, current[:index] + current[index + 1:])
                        for index, marker in enumerate(current))
        for label, markers in variants:
            with self.subTest(proof=label), self.assertRaisesRegex(ValueError, 'fixture-exclusion proof'):
                self.validate({**self.receipt, 'fixture_markers_absent': markers})

    def test_dirty_preview_smoke_wrong_mode_and_missing_proof_fail(self):
        for key, value in [('mode', 'build'), ('mode', 'startup-build'), ('mode', 'auth-build'), ('mode', 'attention-build'),
                           ('source_dirty', True),
                           ('normal_startup', False), ('smoke_instrumentation', True),
                           ('instance_smoke_instrumentation', True),
                           ('lifecycle_smoke_instrumentation', True), ('attention_smoke_instrumentation', True),
                           ('preview_definitions_excluded', False), ('phase', 'signed'), ('version', 2)]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.validate({**self.receipt, key: value})
        missing = copy.deepcopy(self.receipt)
        del missing['source_dirty']
        with self.assertRaises(ValueError):
            self.validate(missing)

    def test_receipt_flags_cannot_hide_smoke_macro_behind_false_boolean(self):
        for flags in [NORMAL_FLAGS + ['-D', 'PREVIEW_SMOKE'], NORMAL_FLAGS + ['-D', 'LIFECYCLE_SMOKE'],
                      NORMAL_FLAGS + ['-D', 'CGINPUT'], NORMAL_FLAGS + ['-D', 'NATIVE_AUTH_FIXTURE'],
                      NORMAL_FLAGS + ['-D', 'ATTENTION_SMOKE'],
                      ['-swift-version', '5', '-target', 'arm64-apple-macosx14.0', '-O',
                       '-framework', 'AppKit', '-framework', 'WebKit', '-D', 'LOCAL_APP'],
                      [x for x in NORMAL_FLAGS if x != 'LOCAL_APP']]:
            with self.assertRaisesRegex(ValueError, 'compiler flags'):
                self.validate({**self.receipt, 'compiler_flags': flags})

    def test_preview_or_unknown_source_cannot_be_admitted_by_normal_label(self):
        for name in ['desktop/macos/FixtureProvider.swift', 'desktop/macos/PreviewProfile.swift',
                     'desktop/macos/StartupSmoke.swift', 'desktop/macos/NativeCommandSmoke.swift',
                     'desktop/macos/NativeCommandInput.swift', 'desktop/macos/LifecycleSmoke.swift',
                     'desktop/macos/QuitWebViewFixture.swift', 'desktop/macos/RecoverySmoke.swift',
                     'desktop/macos/WorkspaceSmoke.swift', 'desktop/macos/WorkspaceFixture.swift',
                     'desktop/macos/WorkspaceJourneys.swift', 'desktop/macos/WorkspaceLegacy.swift',
                     'desktop/macos/ExternalNavigationSmoke.swift', 'desktop/macos/ExternalAuthSmoke.swift',
                     'desktop/macos/NativePathSmoke.swift', 'desktop/macos/DeviceAuthSmoke.swift',
                     'desktop/macos/AttentionSmoke.swift', 'desktop/macos/AttentionFixtureGuard.swift',
                     'desktop/macos/AttentionFixtureRoot.swift', 'desktop/macos/AttentionFixtureCleanup.swift',
                     'desktop/macos/OfflineProviderPolicy.swift', 'desktop/macos/OfflineNetworkFence.swift',
                     'desktop/macos/OfflineWebProbe.swift', 'desktop/macos/OfflineProviderSmoke.swift',
                     'desktop/macos/OfflineHTTPControlTarget.swift',
                     'desktop/macos/UnexpectedNormal.swift', '../external.swift']:
            sources = {**self.receipt['native_source_files'], name: 'b' * 64}
            with self.assertRaisesRegex(ValueError, 'source list'):
                self.validate({**self.receipt, 'native_source_files': sources})

        missing = copy.deepcopy(self.receipt['native_source_files'])
        del missing[next(iter(missing))]
        with self.assertRaisesRegex(ValueError, 'source list'):
            self.validate({**self.receipt, 'native_source_files': missing})

    def test_final_normal_contract_requires_explicit_false_lifecycle_smoke(self):
        for value in [None, True, 0, 'false']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.validate({**self.receipt, 'lifecycle_smoke_instrumentation': value})
        missing = copy.deepcopy(self.receipt)
        del missing['lifecycle_smoke_instrumentation']
        with self.assertRaises(ValueError):
            self.validate(missing)
        with self.assertRaises(ValueError):
            self.validate({**self.receipt, 'mode': 'lifecycle-build'})

    def test_historical_nine_source_receipt_is_not_current_final_composition(self):
        legacy = {f'desktop/macos/{name}.swift' for name in (
            'main', 'PreviewApp', 'PreviewEngine', 'EngineProtocol', 'CommandEnvironment',
            'DesktopStartup', 'EngineFailure', 'AppInstance', 'StoreConflict')}
        with self.assertRaisesRegex(ValueError, 'source list'):
            self.validate({**self.receipt, 'native_source_files': {
                name: value for name, value in self.receipt['native_source_files'].items() if name in legacy}})

    def test_historical_twenty_two_source_receipt_is_not_current_normal_composition(self):
        legacy = {f'desktop/macos/{name}.swift' for name in (
            'main', 'PreviewApp', 'PreviewEngine', 'EngineProtocol', 'EngineFailure',
            'NativeCommands', 'NativeCommandState', 'NativeCommandScript', 'NativeCommandBridge',
            'WorkspaceRecovery', 'WorkspaceRetirement', 'WorkspaceReadiness', 'WorkspaceCheckpoint',
            'WorkspaceStorage', 'WorkspaceStorageBridge', 'WorkspaceStorageScript',
            'CommandEnvironment', 'DesktopStartup', 'AppInstance', 'StoreConflict', 'AppLifecycle', 'AppQuit')}
        with self.assertRaisesRegex(ValueError, 'source list'):
            self.validate({**self.receipt, 'native_source_files': {
                name: value for name, value in self.receipt['native_source_files'].items() if name in legacy}})

    def test_final_normal_contract_requires_explicit_false_attention_smoke(self):
        for value in [None, True, 0, 'false']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.validate({**self.receipt, 'attention_smoke_instrumentation': value})
        missing = copy.deepcopy(self.receipt)
        del missing['attention_smoke_instrumentation']
        with self.assertRaises(ValueError):
            self.validate(missing)
        with self.assertRaises(ValueError):
            self.validate({**self.receipt, 'mode': 'attention-build'})

    def test_historical_twenty_eight_source_receipt_is_not_current_normal_composition(self):
        legacy = {f'desktop/macos/{name}.swift' for name in (
            'main', 'PreviewApp', 'PreviewEngine', 'EngineProtocol', 'EngineFailure',
            'NativeCommands', 'NativeCommandState', 'NativeCommandScript', 'NativeCommandBridge',
            'WorkspaceRecovery', 'WorkspaceRetirement', 'WorkspaceReadiness', 'WorkspaceCheckpoint',
            'WorkspaceStorage', 'WorkspaceStorageBridge', 'WorkspaceStorageScript', 'ExternalNavigation',
            'NativeFolderSelection', 'NativeFolderPanel', 'NativePathRequest', 'NativePathScript',
            'NativePathBridge', 'CommandEnvironment', 'DesktopStartup', 'AppInstance', 'StoreConflict',
            'AppLifecycle', 'AppQuit')}
        with self.assertRaisesRegex(ValueError, 'source list'):
            self.validate({**self.receipt, 'native_source_files': {
                name: value for name, value in self.receipt['native_source_files'].items() if name in legacy}})

    def test_build_support_is_exact_and_verified_before_readonly_factory(self):
        missing = copy.deepcopy(self.receipt)
        del missing['build_support_files']['desktop/macos/BundleIdentity.sh']
        with self.assertRaisesRegex(ValueError, 'build support'):
            self.validate(missing)
        (self.root / 'desktop/macos/BundleIdentity.sh').write_text('# changed factory\n')
        with self.assertRaisesRegex(ValueError, 'support hash'):
            self.validate()
        self.factory.assert_not_called()

    def test_bundle_metadata_must_match_factory_receipt_and_actual_plist(self):
        for field in ['bundle_identifier', 'bundle_name']:
            with self.assertRaisesRegex(ValueError, 'bundle metadata'):
                self.validate({**self.receipt, field: 'wrong track metadata'})
        self.factory.return_value = 'ai.arcee.nac\nNAC'
        with self.assertRaisesRegex(ValueError, 'bundle metadata'):
            self.validate()
        self.factory.return_value = 'malformed factory response'
        with self.assertRaisesRegex(ValueError, 'factory output'):
            self.validate()

    def test_factory_is_reused_for_stable_engine_instead_of_ambient_track(self):
        self.engine_receipt['build'] = {'track': 'stable', 'id': 'stable-' + 'a' * 40}
        self.identity = expected_identity(self.source, self.engine_receipt['build'])
        write_json(self.app / ENGINE_IDENTITY, self.identity)
        (self.app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
            'CFBundleIdentifier': 'ai.arcee.nac', 'CFBundleName': 'NAC'}))
        self.receipt.update(engine_identity=self.identity, bundle_identifier='ai.arcee.nac',
                            bundle_name='NAC', info_plist_sha256=digest(self.app / 'Contents/Info.plist'))
        self.factory.return_value = 'ai.arcee.nac\nNAC'
        self.validate()
        args = self.factory.call_args.args
        self.assertEqual(args[1], self.root / 'desktop/macos/BundleIdentity.sh')
        self.assertEqual(args[2], self.app / ENGINE_IDENTITY)
        self.assertEqual(args[3], 'normal')

    def test_hash_binds_actual_compiler_inputs(self):
        name = sorted(NORMAL_SOURCES)[0]
        (self.root / name).write_text('// changed source\n')
        with self.assertRaisesRegex(ValueError, 'source hash'):
            self.validate()

    def test_revision_full_identity_and_track_are_bound_at_all_three_interfaces(self):
        with self.assertRaisesRegex(ValueError, 'different source'):
            self.validate({**self.receipt, 'source_head': 'b' * 40})
        for key in ['source_revision', 'build_id', 'track', 'product_version']:
            changed = {**self.identity, key: 'different'}
            with self.assertRaisesRegex(ValueError, 'engine identity'):
                self.validate(identity=changed)
            with self.assertRaisesRegex(ValueError, 'engine identity'):
                self.validate({**self.receipt, 'engine_identity': changed})
        write_json(self.app / ENGINE_IDENTITY, {**self.identity, 'track': 'stable'})
        with self.assertRaisesRegex(ValueError, 'engine identity'):
            self.validate()

    def test_actual_unsigned_bytes_must_match_all_recorded_digests(self):
        for key in ['engine_sha256', 'native_sha256', 'info_plist_sha256']:
            with self.assertRaisesRegex(ValueError, 'digest'):
                self.validate({**self.receipt, key: 'b' * 64})
        (self.app / ENGINE).write_bytes(b'other private engine')
        with self.assertRaisesRegex(ValueError, 'different private engine'):
            self.validate()

    def test_actual_binary_markers_are_checked_even_with_matching_claimed_hash(self):
        for marker in dict.fromkeys([*FIXTURE_MARKERS, 'AttentionSmoke']):
            (self.app / SHELL).write_bytes(b'other code ' + marker.encode())
            receipt = {**self.receipt, 'native_sha256': digest(self.app / SHELL)}
            with self.assertRaisesRegex(ValueError, 'preview marker'):
                self.validate(receipt)
        with self.assertRaisesRegex(ValueError, 'fixture-exclusion proof'):
            self.validate({**self.receipt, 'native_sha256': digest(self.app / SHELL),
                           'fixture_markers_absent': []})

    def test_extra_resource_or_symlink_cannot_smuggle_fixture_content(self):
        extra = self.app / 'Contents/Resources/fixture-key.json'
        extra.write_text('synthetic fixture')
        with self.assertRaisesRegex(ValueError, 'closed layout'):
            self.validate()
        extra.unlink()
        extra.symlink_to(self.app / ENGINE)
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            self.validate()


if __name__ == '__main__':
    unittest.main()
