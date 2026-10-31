"""Admission regression tests; no XCTest execution or paint claim."""
import copy
import unittest

from contract import BASELINE, CASES, SCHEMA, validate


def fixture():
    root = '/private/tmp/nac342-xctest-owned'
    home = root + '/home with spaces'
    config = dict(schema=SCHEMA, contract_baseline=BASELINE, scenario='onboarding',
                  source_sha=BASELINE, startup_source_sha256='1' * 64,
                  native_sha256='2' * 64, engine_sha256='3' * 64,
                  info_plist_sha256='4' * 64, build_receipt_sha256='5' * 64,
                  bundle_id='ai.arcee.nac.local-development', fixture_root=root,
                  app_path=root + '/Moved app folder with spaces/NAC.app', home=home,
                  nac_home=home + '/selected nac', workspace=root + '/workspace with spaces',
                  expected_store=home + '/selected nac/dev.db', environment={
                      'HOME': home, 'NAC_HOME': home + '/selected nac',
                      'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'en_US.UTF-8',
                      'NAC_TELEMETRY': 'disabled', 'NAC_ORCHESTRATION': '0',
                      'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
                      'BROWSER': 'none', 'MODELS_DEV_URL': 'http://127.0.0.1:12345/models-dev'})
    receipt = dict(source_head=BASELINE, source_dirty=False, mode='app-build',
                   engine_identity={'source_revision': BASELINE}, normal_startup=True,
                   preview_definitions_excluded=True, smoke_instrumentation=False,
                   compiler_flags=['-swift-version', '5', '-D', 'LOCAL_APP'],
                   **{key: config[key] for key in ('native_sha256', 'engine_sha256', 'info_plist_sha256')})
    return config, receipt


class AdmissionTests(unittest.TestCase):
    def test_four_exact_states_are_declarations_only(self):
        config, receipt = fixture()
        for case in CASES:
            config['scenario'] = case
            result = validate(config, receipt)
            self.assertEqual(result, {'scope': 'declaration_admission_only', 'scenario': case,
                                      'actual_ui_run': False, 'paint_qualified': False})

    def test_instrumented_or_dirty_receipts_are_refused(self):
        for key, value in [('source_dirty', True), ('source_dirty', 0),
                           ('smoke_instrumentation', True), ('normal_startup', False),
                           ('preview_definitions_excluded', False), ('mode', 'startup-build'),
                           ('instance_smoke_instrumentation', True),
                           ('compiler_flags', ['-D', 'LOCAL_APP', '-D', 'PREVIEW_SMOKE']),
                           ('compiler_flags', ['-D', 'LOCAL_APP', '-D']),
                           ('native_sha256', 'f' * 64), ('bundle_identifier', 'ai.arcee.nac')]:
            with self.subTest(key=key, value=value):
                config, receipt = fixture()
                receipt[key] = value
                with self.assertRaises(ValueError):
                    validate(config, receipt)

    def test_wrong_source_and_engine_are_refused(self):
        config, receipt = fixture()
        for section in ('source_head', 'engine_identity'):
            wrong = copy.deepcopy(receipt)
            wrong[section] = 'f' * 40 if section == 'source_head' else {'source_revision': 'f' * 40}
            with self.assertRaises(ValueError):
                validate(config, wrong)

    def test_profile_escape_and_preview_app_are_refused(self):
        for key, value in [('home', '/Users/personal'), ('nac_home', '/Users/personal/.config/nac'),
                           ('expected_store', '/private/tmp/alternate.db'),
                           ('workspace', '/private/tmp/nac342-xctest-owned/../personal'),
                           ('app_path', '/private/tmp/nac342-xctest-owned/Moved app folder with spaces/NAC Startup Smoke.app'),
                           ('fixture_root', '/private/tmp/unowned')]:
            with self.subTest(key=key):
                config, receipt = fixture()
                config[key] = value
                with self.assertRaises(ValueError):
                    validate(config, receipt)

    def test_real_credential_managed_or_remote_catalog_are_refused(self):
        for key, value in [('ARCEE_API_KEY', 'do-not-use'), ('NAC_MANAGED_CONFIG', ''),
                           ('MODELS_DEV_URL', 'https://models.example.test/models-dev'),
                           ('MODELS_DEV_URL', 'http://user:password@127.0.0.1:123/models-dev'),
                           ('MODELS_DEV_URL', 'http://127.0.0.1:123/models-dev?key=no'),
                           ('HOME', '/Users/personal'), ('NAC_ORCHESTRATION', 'true')]:
            with self.subTest(key=key, value=value):
                config, receipt = fixture()
                config['environment'][key] = value
                with self.assertRaises(ValueError):
                    validate(config, receipt)

    def test_unknown_state_or_unbound_source_is_refused(self):
        for key, value in [('scenario', 'genericError'), ('source_sha', 'HEAD'),
                           ('contract_baseline', 'f' * 40), ('startup_source_sha256', '')]:
            config, receipt = fixture()
            config[key] = value
            with self.assertRaises(ValueError):
                validate(config, receipt)


if __name__ == '__main__':
    unittest.main()
