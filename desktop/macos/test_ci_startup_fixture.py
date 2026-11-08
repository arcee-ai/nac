"""Private fixture tests: no app, engine, provider or XCTest is launched."""
import json
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock, patch

from ci_startup_fixture import (CASES, PRODUCT, TEST_SOURCE, immutable_snapshot, prepare_configuration,
                                prepare_profile, remove_profile, require_integrity)


class StartupFixtureTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.parent = Path(self.temporary.name).resolve()

    def profile(self, case):
        return prepare_profile(self.parent, case, 'http://127.0.0.1:4173/models-dev')

    def test_ax_pin_and_complete_inventory_reject_tamper_before_contract_import(self):
        import ci_startup_fixture as fixture
        self.assertEqual(TEST_SOURCE, 'ba266ba1b3bea331768d91fc8a0b2ee66b484d01')
        self.assertEqual(fixture.TEST_FILES, {
            'README.md': '39c0b3aec37188e18eb141ef5537711e6f60b1fd384920d47d248cfd19758ed9',
            'StartupJourneys.swift': '7b731b4c4f40f890fb62ed97652b9c6b480c4fda463770a9fe5a95b1f30eb4f8',
            'contract.py': 'd159672bb8eda5d3bf4e5d462813452c83a673974749ed4f7f07b3bb9341b91b',
            'test_contract.py': '493457530363e6992941960a6de2911c65da463db7452deb17f3af24443f916d',
            'StartupAXGuard.swift': '3be7835fe8cf48164bcfae3d5e803a1423b188ba78512ccb658858486dfa4a18',
            'StartupAXReceipt.swift': 'a25b94b791e2ff24cb15016b976f78cf366540d15382c01f9bce8ec585f93217',
            'AX-WITNESS-CONTRACT.md': '1041bcef5739ebc1fe146673f7460ab82448d13dbb763af93c78f9cbf53c3bf6',
            'test_ax_witness.py': '26e3fb9b290a03642e43eb07965564d2beb8013cc28d3294a6e07c946289cdc3',
            'AGENTS.md': '074ff7d390c45a739b80048cf155274607ba3db5da74183cd5e4f673286a20fe',
        })
        directory = self.parent / 'desktop/macos/startup_xctest'
        directory.mkdir(parents=True)
        (directory / 'README.md').write_text('tampered inert fixture')
        with patch('ci_startup_fixture.require_checkout') as checkout, \
                patch('ci_startup_fixture.importlib.util.spec_from_file_location') as load:
            with self.assertRaisesRegex(RuntimeError, 'startup source inventory differs'):
                fixture.test_contract(self.parent)
        checkout.assert_called_once_with(self.parent, TEST_SOURCE)
        load.assert_not_called()

    def test_four_profiles_are_distinct_and_environment_has_no_inherited_authority(self):
        profiles = [self.profile(case) for case in CASES]
        self.assertEqual(len({p['root'] for p in profiles}), 4)
        for profile in profiles:
            self.assertTrue((profile['workspace'] / '.git').is_dir())
            self.assertTrue(profile['root'].name.startswith('nac342-xctest-'))
            self.assertEqual(profile['environment']['HOME'], str(profile['home']))
            self.assertEqual(profile['environment']['NAC_HOME'], str(profile['nac_home']))
            self.assertNotIn('NAC_MANAGED_CONFIG', profile['environment'])
            self.assertFalse(any(key.endswith(('_TOKEN', '_API_KEY')) for key in profile['environment']))
        self.assertFalse(profiles[0]['config'].exists())
        self.assertFalse(profiles[1]['store'].exists())
        self.assertEqual(profiles[2]['config'].read_text(), '[broken\n')
        with closing(sqlite3.connect(profiles[3]['store'])) as connection, connection:
            self.assertEqual(connection.execute('PRAGMA user_version').fetchone()[0], 999)
        self.assertEqual(immutable_snapshot(profiles[3])['wal_shm'], [])
        with self.assertRaises(RuntimeError):
            self.profile('unknown')

    def test_error_profiles_protect_bytes_and_reject_fallback_databases(self):
        for case in ('invalidConfig', 'futureStore'):
            with self.subTest(case=case):
                profile = self.profile(case)
                before = immutable_snapshot(profile)
                self.assertTrue(require_integrity(profile, before)['no_alternate_database'])
                profile['config'].write_text('changed')
                with self.assertRaisesRegex(RuntimeError, 'protected'):
                    require_integrity(profile, before)
        profile = self.profile('invalidConfig')
        before = immutable_snapshot(profile)
        with closing(sqlite3.connect(profile['nac_home'] / 'fallback.db')) as connection, connection:
            connection.execute('CREATE TABLE unexpected(value)')
        with self.assertRaisesRegex(RuntimeError, 'alternate'):
            require_integrity(profile, before)

    def test_future_wal_and_symlink_paths_are_not_admitted(self):
        profile = self.profile('futureStore')
        before = immutable_snapshot(profile)
        Path(str(profile['store']) + '-wal').write_bytes(b'unexpected')
        with self.assertRaisesRegex(RuntimeError, 'protected'):
            require_integrity(profile, before)
        link = self.parent / 'link'
        link.symlink_to(self.parent, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'canonical'):
            prepare_profile(link, 'onboarding', 'http://127.0.0.1:4173/models-dev')

    def test_configuration_uses_final_hashes_and_separate_source_and_unsigned_provenance(self):
        profile = self.profile('onboarding')
        app = self.parent / 'Synthetic.app'
        app.mkdir()
        (app / 'not-an-executable').write_text('unit fixture only')
        manifest = self.parent / 'manifest.json'
        manifest.write_text('{}')
        proof = {'bundle_id': 'ai.arcee.nac.dev', 'engine_identity': {'source_revision': PRODUCT},
                 'post_sign_receipt': {key: chr(97 + index) * 64 for index, key in
                                      enumerate(('native_sha256', 'engine_sha256', 'info_plist_sha256'))},
                 **{key: 'f' * 64 for key in ('manifest_sha256', 'package_identity_sha256',
                                             'engine_identity_sha256', 'build_receipt_sha256')}}
        owner = Mock()
        owner.inspect_normal_package.return_value = proof
        owner.validate_normal_package.return_value = {'scope': 'synthetic-unit-admission-only'}
        child = {**profile['environment'], 'PATH': '/synthetic-resolved-path'}
        with patch('ci_startup_fixture.require_checkout'), patch('ci_startup_fixture.test_contract', return_value=owner), \
                patch('ci_startup_fixture.resolve_environment', return_value=(child, {'scope': 'synthetic resolver'})):
            config, path, admission = prepare_configuration(profile, app, manifest, self.parent, self.parent, '1' * 40)
        self.assertEqual(config['source_sha'], PRODUCT)
        self.assertEqual(config['test_source_sha'], TEST_SOURCE)
        self.assertEqual(config['harness_sha'], '1' * 40)
        self.assertEqual(config['environment'], profile['environment'])
        self.assertEqual(config['child_environment'], child)
        self.assertEqual(config['environment_resolution']['app_launch_arguments'], ['--directory', str(profile['home'])])
        self.assertEqual(config['environment_resolution']['configuration_helper_arguments'],
                         ['__desktop-configuration', '--directory', str(profile['home'])])
        for key, expected in proof['post_sign_receipt'].items():
            self.assertEqual(config[key], expected)
        self.assertEqual(json.loads(path.read_text()), config)
        self.assertEqual(path.stat().st_mode & 0o777, 0o400)
        owner.validate_normal_package.assert_called_once()
        self.assertIn('synthetic', admission['scope'])
        self.assertFalse((profile['root'] / 'app-output.json').exists())

    def test_product_pin_rejects_legacy_before_package_or_resolver(self):
        from ci_startup_environment import PRODUCT as RESOLVER_PRODUCT
        self.assertEqual(PRODUCT, '4b7a1f3e0bf6175a77c5ebf627fe965860e99976')
        self.assertEqual(RESOLVER_PRODUCT, PRODUCT)
        with patch('ci_startup_fixture.require_checkout', side_effect=RuntimeError('legacy product rejected')) as checkout, \
                patch('ci_startup_fixture.test_contract') as contract, \
                patch('ci_startup_fixture.resolve_environment') as resolver:
            with self.assertRaisesRegex(RuntimeError, 'legacy product rejected'):
                prepare_configuration({}, self.parent, self.parent, self.parent, self.parent, '1' * 40)
        checkout.assert_called_once_with(self.parent, PRODUCT)
        contract.assert_not_called()
        resolver.assert_not_called()

    def test_unknown_process_ownership_preserves_profile(self):
        profile = self.profile('onboarding')
        for proof in ({}, {'owned_processes_settled': True, 'root': '/foreign'},
                      {'owned_processes_settled': 1, 'root': str(profile['root'])}):
            with self.assertRaises(RuntimeError):
                remove_profile(profile, proof)
            self.assertTrue(profile['root'].is_dir())
        remove_profile(profile, {'owned_processes_settled': True, 'root': str(profile['root'])})
        self.assertFalse(profile['root'].exists())


if __name__ == '__main__':
    unittest.main()
