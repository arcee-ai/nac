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


if __name__ == '__main__':
    unittest.main()
