"""Portable package boundary tests; these never stand in for actual Mac acceptance."""
import copy
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import package
from provenance import (ASSETS, clean_source, digest, inventory, new_directory,
                        object_digest, validate_receipt, write_json)


class PackageContract(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='nac package fixture ')
        self.root = Path(self.temporary.name)
        self.app = self.root / 'Fixture.app'
        self.app.mkdir()
        resources = self.app / 'Contents/Resources'
        resources.mkdir(parents=True)
        self.identity = {'consumer_distribution': False, 'purpose': 'development-preview-fixture'}
        write_json(resources / 'PackageIdentity.json', self.identity)
        self.engine = resources / 'nac-web'
        self.engine.write_bytes(b'fixture engine, not runnable code')
        self.engine.chmod(0o755)
        self.archive = self.root / 'Fixture.zip'
        self.archive.write_bytes(b'fixture container')
        files = inventory(self.app)
        self.manifest = {'schema_version': 1, 'identity': self.identity,
                         'bundle': {'name': self.app.name, 'files': files, 'sha256': object_digest(files)},
                         'container': {'name': self.archive.name, 'sha256': digest(self.archive),
                                       'size': self.archive.stat().st_size},
                         'qualification': {'developer_id': False, 'notarized': False}}

    def tearDown(self):
        self.temporary.cleanup()

    def test_complete_inventory_survives_relocation_including_spaces(self):
        package.verify_files(self.manifest, self.root)
        moved = self.root.parent / (self.root.name + ' relocated')
        self.root.rename(moved)
        try:
            package.verify_files(self.manifest, moved)
        finally:
            moved.rename(self.root)

    def test_tampered_missing_extra_and_mode_changed_bundle_fail(self):
        self.engine.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'inventory'):
            package.verify_files(self.manifest, self.root)
        self.engine.unlink()
        with self.assertRaisesRegex(ValueError, 'inventory'):
            package.verify_files(self.manifest, self.root)
        self.engine.write_bytes(b'fixture engine, not runnable code')
        self.engine.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'inventory'):
            package.verify_files(self.manifest, self.root)
        self.engine.chmod(0o755)
        (self.app / 'extra').touch()
        with self.assertRaisesRegex(ValueError, 'inventory'):
            package.verify_files(self.manifest, self.root)

    def test_special_executable_permission_changes_are_part_of_integrity(self):
        self.engine.chmod(0o4755)
        self.assertEqual(inventory(self.app)['Contents/Resources/nac-web']['mode'], 0o4755)
        with self.assertRaisesRegex(ValueError, 'inventory'):
            package.verify_files(self.manifest, self.root)

    def test_container_tampering_fails_even_with_untouched_app(self):
        self.archive.write_bytes(b'changed archive')
        with self.assertRaisesRegex(ValueError, 'Container'):
            package.verify_files(self.manifest, self.root)

    def test_symlinks_and_artifact_path_escape_fail(self):
        alias = self.app / 'link'
        alias.symlink_to(self.engine)
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            inventory(self.app)
        alias.unlink()
        for name in ('../Fixture.app', '/Fixture.app', '..', ''):
            changed = copy.deepcopy(self.manifest)
            changed['bundle']['name'] = name
            with self.assertRaisesRegex(ValueError, 'path component'):
                package.verify_files(changed, self.root)

    def test_fixture_cannot_claim_distribution_or_runtime_acceptance(self):
        for key in ('developer_id', 'notarized', 'actual_app_runtime', 'gatekeeper'):
            changed = copy.deepcopy(self.manifest)
            changed['qualification'][key] = True
            with self.assertRaisesRegex(ValueError, 'qualification'):
                package.verify_files(changed, self.root)
        changed = copy.deepcopy(self.manifest)
        changed['identity']['consumer_distribution'] = True
        with self.assertRaisesRegex(ValueError, 'identity'):
            package.verify_files(changed, self.root)

    def test_distribution_plan_cannot_promote_preview_fixture(self):
        path = self.root / 'manifest.json'
        write_json(path, self.manifest)
        args = SimpleNamespace(manifest=str(path), output=str(self.root / 'plan'))
        with patch('package.signing_commands') as signer:
            with self.assertRaisesRegex(ValueError, 'preview fixtures'):
                package.distribution_plan(args)
            signer.assert_not_called()
        self.assertFalse((self.root / 'plan').exists())

    def test_normal_distribution_plan_preserves_adhoc_input_and_never_executes(self):
        identity = {**self.identity, 'purpose': 'normal-app-preparation',
                    'source': {'revision': 'a' * 40}, 'native_build_receipt': {'version': 1}}
        write_json(self.app / 'Contents/Resources/PackageIdentity.json', identity)
        files = inventory(self.app)
        manifest = {**self.manifest, 'identity': identity,
                    'bundle': {**self.manifest['bundle'], 'files': files, 'sha256': object_digest(files)}}
        path = self.root / 'manifest.json'
        write_json(path, manifest)
        args = SimpleNamespace(manifest=str(path), output=str(self.root / 'plan'),
                               certificate='a' * 40, team='TESTTEAM01', notary_profile='synthetic-profile')
        before = inventory(self.app)
        with patch('package.subprocess.run') as execute:
            package.distribution_plan(args)
            execute.assert_not_called()
        plan = json.loads((self.root / 'plan/distribution-plan.json').read_text())
        self.assertFalse(plan['execution_authorized'])
        self.assertEqual(inventory(self.app), before)
        self.assertEqual(plan['staging_commands'][1][1], str(self.app.resolve()))
        for command in plan['signing_commands']:
            self.assertIn('/plan/developer-id-candidate/', command[-1])
            self.assertNotEqual(command[-1], str(self.app))
        self.assertIn('Qualified track identifiers', plan['required_gate'])
        self.assertEqual(len(plan['signature_inspections']), 2)
        for item in plan['signature_inspections']:
            self.assertIn('--entitlements', item['entitlements_argv'])
            self.assertIn('--verbose=4', item['details_argv'])
        stages = plan['notarization']['stages']
        gate = stages[0]
        self.assertEqual(gate['name'], 'verify-developer-id-policy')
        self.assertIn('verify-developer-id', gate['argv'])
        self.assertEqual(gate['postconditions'], {
            'kind': 'developer-id', 'team_id': 'TESTTEAM01', 'hardened_runtime': True,
            'secure_timestamp': True, 'entitlements': {}})
        self.assertLess([item['name'] for item in stages].index(gate['name']),
                        [item['name'] for item in stages].index('notary-submit'))

    def test_readonly_developer_gate_checks_both_objects_and_writes_only_verified_facts(self):
        details = ('CodeDirectory v=20500 size=10 flags=0x10000(runtime) hashes=1\n'
                   'TeamIdentifier=TESTTEAM01\nTimestamp=synthetic timestamp\n'
                   'Authority=Developer ID Application: Synthetic Fixture\n')
        empty = subprocess.CompletedProcess([], 0, stdout=plistlib.dumps({}), stderr=b'')
        valid = subprocess.CompletedProcess([], 0, stdout='', stderr=details)
        args = SimpleNamespace(app=str(self.app), certificate='a' * 40, team='TESTTEAM01',
                               output=str(self.root / 'signature-verification'))
        before = inventory(self.app)
        with patch('package.require_mac'), patch('package.run') as crypto, \
                patch('package.subprocess.run', side_effect=[empty, valid, empty, valid]) as inspect:
            package.verify_developer_id(args)
        self.assertEqual(inventory(self.app), before)
        self.assertEqual(inspect.call_count, 4)
        for call in crypto.call_args_list:
            self.assertIn('--verify', call.args)
            self.assertNotIn('--sign', call.args)
        result = json.loads((self.root / 'signature-verification/signature-evidence.json').read_text())
        self.assertEqual(set(result['signatures']), {'app', 'engine'})
        self.assertTrue(all(item['secure_timestamp'] for item in result['signatures'].values()))
        self.assertFalse(result['notary_submission_performed'])
        self.assertFalse(result['consumer_qualification'])
        self.assertNotIn('Synthetic Fixture', str(result))

    def test_developer_gate_never_emits_evidence_when_app_policy_fails(self):
        details = ('CodeDirectory v=20500 size=10 flags=0x10000(runtime) hashes=1\n'
                   'TeamIdentifier=TESTTEAM01\nTimestamp=synthetic timestamp\n'
                   'Authority=Developer ID Application: Synthetic Fixture\n')
        empty = subprocess.CompletedProcess([], 0, stdout=plistlib.dumps({}), stderr=b'')
        valid = subprocess.CompletedProcess([], 0, stdout='', stderr=details)
        bad_entitlements = subprocess.CompletedProcess([], 0,
            stdout=plistlib.dumps({'com.apple.security.get-task-allow': True}), stderr=b'')
        missing_timestamp = subprocess.CompletedProcess([], 0, stdout='',
            stderr=details.replace('Timestamp=synthetic timestamp\n', ''))
        for index, responses in enumerate([[empty, valid, bad_entitlements, valid],
                                           [empty, valid, empty, missing_timestamp]]):
            output = self.root / f'failed-verification-{index}'
            args = SimpleNamespace(app=str(self.app), certificate='a' * 40, team='TESTTEAM01', output=str(output))
            with patch('package.require_mac'), patch('package.run'), \
                    patch('package.subprocess.run', side_effect=responses):
                with self.assertRaises(ValueError):
                    package.verify_developer_id(args)
            self.assertFalse(output.exists())

    def test_post_sign_receipt_binds_versions_track_metadata_identity_and_signed_bytes(self):
        engine_identity = {'product_version': '1.2.3', 'source_revision': 'a' * 40,
                           'track': 'stable', 'build_id': 'stable-' + 'a' * 40}
        identity = {'source': {'product_version': '1.2.3', 'revision': 'a' * 40},
                    'engine_identity': engine_identity,
                    'native_build_receipt': {'bundle_identifier': 'ai.arcee.nac', 'bundle_name': 'NAC'}}
        info = {'CFBundleIdentifier': 'ai.arcee.nac', 'CFBundleName': 'NAC',
                'CFBundleShortVersionString': '1.2.3', 'CFBundleVersion': '1.2.3'}
        files = {package.ENGINE_PATH: {'sha256': 'e' * 64},
                 package.SHELL_PATH: {'sha256': 'a' * 64}, 'Contents/Info.plist': {'sha256': 'f' * 64}}
        signatures = {name: {'kind': 'ad-hoc', 'hardened_runtime': True, 'entitlements': {}}
                      for name in ['app', 'engine']}
        record = package.post_sign_record(identity, info, files, signatures, engine_identity)
        self.assertEqual(record['engine_sha256'], 'e' * 64)
        self.assertFalse(record['qualified_consumer'])
        self.assertEqual(record['phase'], 'ad-hoc-preparation')
        for key in ['CFBundleIdentifier', 'CFBundleName', 'CFBundleShortVersionString', 'CFBundleVersion']:
            with self.assertRaises(ValueError):
                package.post_sign_record(identity, {**info, key: 'changed'}, files, signatures, engine_identity)
        with self.assertRaisesRegex(ValueError, 'engine identity'):
            package.post_sign_record(identity, info, files, signatures, {**engine_identity, 'track': 'dev'})
        with self.assertRaisesRegex(ValueError, 'ad-hoc signatures'):
            package.post_sign_record(identity, info, files, {}, engine_identity)

    def test_post_sign_receipt_tampering_fails_with_unchanged_bundle(self):
        identity = {**self.identity, 'source': {'product_version': '1.2.3', 'revision': 'a' * 40},
                    'engine_identity': {'source_revision': 'a' * 40}}
        info = {'CFBundleIdentifier': 'fixture', 'CFBundleName': 'Fixture',
                'CFBundleShortVersionString': '1.2.3', 'CFBundleVersion': '1.2.3'}
        write_json(self.app / 'Contents/Resources/PackageIdentity.json', identity)
        write_json(self.app / 'Contents/Resources/engine-identity.json', identity['engine_identity'])
        (self.app / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
        shell = self.app / package.SHELL_PATH
        shell.parent.mkdir(parents=True)
        shell.write_bytes(b'synthetic native code')
        files = inventory(self.app)
        signatures = {name: {'kind': 'ad-hoc', 'hardened_runtime': True, 'entitlements': {}}
                      for name in ['app', 'engine']}
        record = package.post_sign_record(identity, info, files, signatures, identity['engine_identity'])
        manifest = {**self.manifest, 'identity': identity, 'signatures': signatures,
                    'post_sign_receipt': record,
                    'bundle': {**self.manifest['bundle'], 'files': files, 'sha256': object_digest(files)}}
        package.verify_files(manifest, self.root)
        manifest['post_sign_receipt'] = {**record, 'engine_sha256': 'b' * 64}
        with self.assertRaisesRegex(ValueError, 'Post-sign preparation receipt'):
            package.verify_files(manifest, self.root)

    def test_engine_receipt_binds_source_assets_schema_bytes_and_track(self):
        source = {'revision': 'a' * 40, 'assets': {'sha256': 'b' * 64}, 'store_schema': 40}
        receipt = {'schema_version': 1, 'source': source, 'target': 'aarch64-apple-darwin',
                   'build': {'track': 'dev', 'id': 'dev-' + source['revision']},
                   'engine': {'sha256': digest(self.engine), 'size': self.engine.stat().st_size}}
        validate_receipt(receipt, source, self.engine)
        for field, value in [('source', {}), ('engine', {}), ('target', 'x86_64-apple-darwin'),
                             ('build', {'track': 'stable', 'id': 'dev-' + source['revision']})]:
            changed = copy.deepcopy(receipt)
            changed[field] = value
            with self.assertRaises(ValueError):
                validate_receipt(changed, source, self.engine)

    def test_outputs_never_overwrite_existing_or_dangling_paths(self):
        for path in (self.app, self.archive):
            with self.assertRaisesRegex(ValueError, 'new directory'):
                new_directory(path)
        dangling = self.root / 'dangling'
        dangling.symlink_to(self.root / 'absent')
        with self.assertRaisesRegex(ValueError, 'new directory'):
            new_directory(dangling)

    def test_nested_signing_is_leaf_first_and_never_deep_or_credentialed(self):
        with patch('package.run') as command, patch('package.verify_signatures', return_value={}) as verify:
            package.sign_adhoc(self.app, package.ENGINE_PATH)
        calls = [call.args for call in command.call_args_list]
        self.assertEqual([x[-1] for x in calls], [str(self.app / package.ENGINE_PATH), str(self.app)])
        for args in calls:
            self.assertNotIn('--deep', args)
            self.assertEqual(args[args.index('--sign') + 1], '-')
            self.assertIn('runtime', args)
            self.assertNotIn('--entitlements', args)
        verify.assert_called_once()

    def test_entitlement_expansion_fails_closed(self):
        response = subprocess.CompletedProcess([], 0,
            stdout=plistlib.dumps({'com.apple.security.get-task-allow': True}), stderr=b'')
        with patch('package.run'), patch('package.subprocess.run', side_effect=[response,
                subprocess.CompletedProcess([], 0, stdout='', stderr='flags=0x10000(runtime)\nSignature=adhoc')]):
            with self.assertRaisesRegex(ValueError, 'Unexpected entitlements'):
                package.verify_signatures(self.app, package.ENGINE_PATH)

    def test_non_system_or_wrong_arch_runtime_dependency_fails(self):
        for results in [('x86_64',), ('arm64', 'shell:\n\t/opt/homebrew/lib/libfixture.dylib (compatibility version 1)')]:
            with patch('package.run', side_effect=results):
                with self.assertRaises(ValueError):
                    package.executable_evidence(self.engine)


class SourceContract(unittest.TestCase):
    def test_clean_source_checks_untracked_and_binds_version_assets_schema(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                return subprocess.run(['git', *args], cwd=root, check=True,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            git('init')
            git('config', 'user.name', 'Package Fixture')
            git('config', 'user.email', 'fixture@example.invalid')
            (root / ASSETS).mkdir(parents=True)
            (root / ASSETS / 'index.html').write_text('fixture')
            schema = root / 'crates/nac-core/src/store/schema.rs'
            schema.parent.mkdir(parents=True)
            schema.write_text('const STORE_SCHEMA_VERSION: i64 = 40;\n')
            (root / 'version.txt').write_text('1.2.3\n')
            git('add', '.')
            git('commit', '-m', 'fixture')
            source = clean_source(root)
            self.assertEqual(source['product_version'], '1.2.3')
            self.assertEqual(source['store_schema'], 40)
            self.assertEqual(len(source['revision']), 40)
            self.assertEqual(source['assets']['sha256'], object_digest(inventory(root / ASSETS)))
            (root / 'untracked').touch()
            with self.assertRaisesRegex(ValueError, 'clean committed'):
                clean_source(root)
            (root / 'untracked').unlink()
            (root / '.gitignore').write_text('.env\nempty-ignored/\n')
            git('add', '.gitignore')
            git('commit', '-m', 'ignore fixture metadata')
            for relative in [ASSETS / '.env', ASSETS.parent / '.env']:
                ignored = root / relative
                ignored.write_text('synthetic ignored input, not a secret\n')
                with self.assertRaisesRegex(ValueError, 'tracked source tree'):
                    clean_source(root)
                ignored.unlink()
            empty = root / ASSETS / 'empty-ignored'
            empty.mkdir()
            with self.assertRaisesRegex(ValueError, 'tracked source tree'):
                clean_source(root)
            empty.rmdir()
            # Ignored inputs outside the actual compiler-owned asset tree remain allowed.
            (root / '.env').write_text('synthetic local configuration\n')
            self.assertEqual(clean_source(root)['product_version'], '1.2.3')
            with tempfile.TemporaryDirectory(prefix='nac outside asset ') as outside:
                target = Path(outside) / 'shared.txt'
                target.write_text('synthetic external bytes, not a secret\n')
                alias = root / ASSETS.parent / 'shared.txt'
                alias.symlink_to(target)
                git('add', str(alias.relative_to(root)))
                git('commit', '-m', 'tracked outside-dist symlink fixture')
                with self.assertRaisesRegex(ValueError, 'Symlink'):
                    clean_source(root)


if __name__ == '__main__':
    unittest.main()
