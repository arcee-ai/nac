"""Admission regression tests; no XCTest execution or paint claim."""
import copy
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest

from contract import (BASELINE, CASES, SCHEMA, FUTURE_RECOVERY_MESSAGE,
                      inspect_normal_package, require_console, require_future_recovery,
                      validate, validate_normal_package)

PRODUCT = 'd443a2aca506def2817b9afc0c9a20a75f5c4b5d'
HARNESS = 'a4ec6b17a92dabd28501fa427992528cd3729100'


def console_matrix():
    """H's existing UID123/root-false/Quartz fixture, plus malformed flags."""
    base = {'name': 'positive-omitted-quartz', 'uid': 123, 'root': {'IOConsoleLocked': False,
            'IOConsoleUsers': [{'kCGSSessionUserIDKey': 123, 'kCGSSessionOnConsoleKey': True,
                               'kCGSessionLoginDoneKey': True, 'CGSSessionScreenIsLocked': False}]},
            'quartz': {'quartz_session_available': True, 'on_console': True, 'login_done': True,
                       'screen_count': 1, 'screen_is_locked': None,
                       'frontmost_bundle': 'com.apple.AccessibilityUIServer'}}
    cases = [base]
    for side in ('session', 'quartz'):
        for label, value in [('omitted', None), ('false', False), ('true', True), ('zero', 0),
                             ('one', 1), ('string', 'false'), ('list', []), ('object', {})]:
            row = copy.deepcopy(base)
            row['name'] = side + '-' + label
            target = row['quartz'] if side == 'quartz' else row['root']['IOConsoleUsers'][0]
            key = 'screen_is_locked' if side == 'quartz' else 'CGSSessionScreenIsLocked'
            if value is None:
                target.pop(key, None)
            else:
                target[key] = value
            cases.append(row)
    for section, key, value in [
        ('root', 'IOConsoleLocked', None), ('root', 'IOConsoleLocked', True),
        ('root', 'IOConsoleLocked', 0), ('session', 'kCGSSessionUserIDKey', 456),
        ('session', 'kCGSSessionOnConsoleKey', False), ('session', 'kCGSessionLoginDoneKey', False),
        ('quartz', 'quartz_session_available', False), ('quartz', 'on_console', False),
        ('quartz', 'login_done', False), ('quartz', 'screen_count', 0),
        ('quartz', 'frontmost_bundle', None), ('quartz', 'frontmost_bundle', ''),
        ('quartz', 'frontmost_bundle', 'unavailable'), ('quartz', 'frontmost_bundle', 'com.apple.loginwindow')]:
        row = copy.deepcopy(base)
        row['name'] = section + '-' + key + '-' + str(value)
        target = row['root']['IOConsoleUsers'][0] if section == 'session' else row[section]
        if value is None:
            target.pop(key, None)
        else:
            target[key] = value
        cases.append(row)
    return cases


def policy_result(row):
    try:
        return {'passed': True, 'observation': require_console(row['root'], row['uid'], row['quartz'])}
    except ValueError:
        return {'passed': False}


class ConsoleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.environ.get('NAC342_SWIFT_POLICY_PROOF') != '1':
            return
        cls.temporary = tempfile.TemporaryDirectory(prefix='nac342-console-policy-unit-')
        cls.addClassCleanup(cls.temporary.cleanup)
        source = Path(__file__).with_name('StartupJourneys.swift').read_text()
        policy = source.split('// BEGIN CONSOLE POLICY', 1)[1].split('\n', 1)[1].split('// END CONSOLE POLICY', 1)[0]
        driver = '''
let bytes = FileHandle.standardInput.readDataToEndOfFile()
let cases = try JSONSerialization.jsonObject(with: bytes) as! [[String: Any]]
let results: [[String: Any]] = cases.map { row in
    do {
        let observation = try StartupConsolePolicy.evaluate(root: row["root"] as! [String: Any],
            uid: (row["uid"] as! NSNumber).intValue, quartz: row["quartz"] as! [String: Any])
        return ["passed": true, "observation": observation]
    } catch { return ["passed": false] }
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: results, options: [.sortedKeys]))
'''
        file = Path(cls.temporary.name) / 'main.swift'
        file.write_text('import Foundation\nimport CoreFoundation\n' + policy + driver)
        cls.runner = Path(cls.temporary.name) / 'console-policy'
        subprocess.run(['swiftc', str(file), '-o', str(cls.runner)], check=True, capture_output=True)

    def test_same_matrix_against_immutable_H_policy(self):
        source = subprocess.check_output(['git', 'show', HARNESS + ':desktop/macos/ci_support.py'])
        namespace = {}
        exec(compile(source, 'immutable_H_ci_support.py', 'exec'), namespace)
        for row in console_matrix():
            with self.subTest(case=row['name']):
                try:
                    expected = {'passed': True, 'observation': namespace['require_console'](
                        plistlib.dumps(row['root']), row['uid'], row['quartz'])}
                except RuntimeError:
                    expected = {'passed': False}
                self.assertEqual(policy_result(row), expected)

    def test_absent_flags_remain_null_and_duplicate_UID_is_refused(self):
        row = console_matrix()[0]
        del row['root']['IOConsoleUsers'][0]['CGSSessionScreenIsLocked']
        result = policy_result(row)
        self.assertTrue(result['passed'])
        self.assertIsNone(result['observation']['session_lock_flag'])
        self.assertIsNone(result['observation']['quartz_lock_flag'])
        row['root']['IOConsoleUsers'].append(copy.deepcopy(row['root']['IOConsoleUsers'][0]))
        self.assertFalse(policy_result(row)['passed'])

    @unittest.skipUnless(os.environ.get('NAC342_SWIFT_POLICY_PROOF') == '1', 'Foundation-only Swift source proof not requested')
    def test_same_matrix_against_compiled_exact_Swift_policy(self):
        cases = console_matrix()
        result = subprocess.run([str(self.runner)], input=json.dumps(cases).encode(),
                                capture_output=True, check=True)
        self.assertEqual(json.loads(result.stdout), [policy_result(row) for row in cases])


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
    def test_nominated_serving_failure_and_exact_guidance(self):
        # Synthetic observation only, not a producer implementation claim.
        failure = {'kind': 'failed', 'version': 1, 'code': 'store_schema_incompatible', 'stage': 'startup'}
        require_future_recovery(failure, FUTURE_RECOVERY_MESSAGE)
        for key, value in [('code', 'startup_failed'), ('stage', '__desktop-configuration'),
                           ('kind', 'ready'), ('version', True), ('version', 2)]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                require_future_recovery({**failure, key: value}, FUTURE_RECOVERY_MESSAGE)

    def test_old_source_generic_failure_or_footer_cannot_pass(self):
        generic = ('A store written by a newer NAC version requires a compatible version; '
                   'keep the existing database. Check directory access and whether another NAC process owns this store.')
        nominated = {'kind': 'failed', 'version': 1, 'code': 'store_schema_incompatible', 'stage': 'startup'}
        for message in (generic, 'NAC could not continue', FUTURE_RECOVERY_MESSAGE.lower(),
                        FUTURE_RECOVERY_MESSAGE[:-1], FUTURE_RECOVERY_MESSAGE + ' '):
            with self.subTest(message=message), self.assertRaises(ValueError):
                require_future_recovery(nominated, message)
        # A unique message alone also cannot disguise an old typed producer.
        with self.assertRaises(ValueError):
            require_future_recovery({**nominated, 'code': 'startup_failed'}, FUTURE_RECOVERY_MESSAGE)

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


@unittest.skipUnless(os.environ.get('NAC342_PRODUCT_SOURCE_ROOT'), 'Exact separate P checkout is required')
class NormalPackageTests(unittest.TestCase):
    """Tiny synthetic artifacts, real nominated P owner; never executable code."""
    @classmethod
    def setUpClass(cls):
        cls.product = Path(os.environ['NAC342_PRODUCT_SOURCE_ROOT']).resolve()
        script = '''
import json,sys
from pathlib import Path
root=Path(sys.argv[1]);sys.path.insert(0,str(root/'desktop/macos/packaging'))
from provenance import clean_source,digest
from native_receipt import NORMAL_SOURCES,BUILD_SUPPORT,NORMAL_FLAGS,FIXTURE_MARKERS
print(json.dumps({'source':clean_source(root),'flags':NORMAL_FLAGS,
 'markers':FIXTURE_MARKERS,
 'native':{name:digest(root/name) for name in NORMAL_SOURCES},
 'support':{name:digest(root/name) for name in BUILD_SUPPORT}}))
'''
        cls.description = json.loads(subprocess.check_output([sys.executable, '-B', '-c', script, str(cls.product)]))
        if cls.description['source']['revision'] != PRODUCT:
            raise ValueError('Tests require the nominated clean P')

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='nac342-package-unit-')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.original = self.base / 'producer/NAC.app'
        self.root = self.base / 'nac342-xctest-case'
        self.relocated = self.root / 'Moved app folder with spaces/NAC.app'
        self.manifest_path = self.original.parent / 'manifest.json'
        self.identity = {'product_version': self.description['source']['product_version'],
                         'source_revision': PRODUCT, 'track': 'dev', 'build_id': 'dev-' + PRODUCT}
        self.receipt = dict(version=1, phase='unsigned-build', source_head=PRODUCT, source_dirty=False,
            mode='app-build', normal_startup=True, smoke_instrumentation=False, instance_smoke_instrumentation=False,
            preview_definitions_excluded=True, compiler_flags=self.description['flags'],
            fixture_markers_absent=self.description['markers'], sdk_version='synthetic-unit-not-SDK-qualification',
            native_source_files=copy.deepcopy(self.description['native']), build_support_files=self.description['support'],
            bundle_identifier='ai.arcee.nac.dev', bundle_name='NAC Development', engine_identity=self.identity,
            native_sha256='1' * 64, engine_sha256='2' * 64, info_plist_sha256='3' * 64)
        self.marker = {'schema_version': 1, 'purpose': 'normal-app-preparation', 'consumer_distribution': False,
            'source': copy.deepcopy(self.description['source']), 'build': {'track': 'dev', 'id': 'dev-' + PRODUCT},
            'engine_identity': copy.deepcopy(self.identity), 'native_build_receipt': copy.deepcopy(self.receipt),
            'engine_input': {'sha256': self.receipt['engine_sha256'], 'size': 5}}
        self.seal()

    def seal(self):
        app = self.original
        (app / 'Contents/Resources').mkdir(parents=True, exist_ok=True)
        (app / 'Contents/MacOS').mkdir(parents=True, exist_ok=True)
        (app / 'Contents/MacOS/NACPreview').write_bytes(b'synthetic signed native; never execute')
        (app / 'Contents/Resources/nac-web').write_bytes(b'synthetic signed engine; never execute')
        for name, data in [('PackageIdentity.json', self.marker), ('build-receipt.json', self.receipt),
                           ('engine-identity.json', self.identity)]:
            (app / 'Contents/Resources' / name).write_text(json.dumps(data))
        info = {'CFBundleIdentifier': 'ai.arcee.nac.dev', 'CFBundleName': 'NAC Development',
                'CFBundleShortVersionString': self.identity['product_version'], 'CFBundleVersion': self.identity['product_version']}
        (app / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
        files = {str(file.relative_to(app)): {'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
                 'size': file.stat().st_size, 'mode': file.stat().st_mode & 0o7777}
                 for file in app.rglob('*') if file.is_file()}
        signatures = {key: {'kind': 'ad-hoc', 'hardened_runtime': True, 'entitlements': {}}
                      for key in ('app', 'engine')}
        post = {'schema_version': 1, 'phase': 'ad-hoc-preparation', 'source_revision': PRODUCT,
            'engine_identity': self.identity, 'bundle_identifier': info['CFBundleIdentifier'],
            'bundle_name': info['CFBundleName'], 'product_version': self.identity['product_version'],
            'bundle_version': self.identity['product_version'], 'signatures': signatures, 'qualified_consumer': False,
            **{key: files[name]['sha256'] for key, name in [('native_sha256', 'Contents/MacOS/NACPreview'),
                ('engine_sha256', 'Contents/Resources/nac-web'), ('info_plist_sha256', 'Contents/Info.plist')]}}
        archive = self.original.parent / 'synthetic.zip'
        archive.write_bytes(b'synthetic container; not a distributable archive')
        self.manifest = {'schema_version': 1, 'identity': self.marker,
            'bundle': {'name': 'NAC.app', 'identifier': info['CFBundleIdentifier'], 'files': files,
                       'sha256': hashlib.sha256(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()).hexdigest()},
            'container': {'name': archive.name, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'size': archive.stat().st_size},
            'post_sign_receipt': post, 'signatures': signatures, 'qualification': {'actual_app_runtime': False}}
        self.write_manifest()
        if self.relocated.exists():
            shutil.rmtree(self.relocated)
        shutil.copytree(app, self.relocated)

    def write_manifest(self):
        self.manifest_path.write_text(json.dumps(self.manifest))

    def config(self):
        config, _ = fixture()
        home = str(self.root / 'home with spaces')
        config.update(source_sha=PRODUCT, test_source_sha=BASELINE, harness_sha=HARNESS,
            fixture_root=str(self.root), app_path=str(self.relocated), home=home,
            nac_home=home + '/selected nac', workspace=str(self.root / 'workspace with spaces'),
            expected_store=home + '/selected nac/dev.db', bundle_id='ai.arcee.nac.dev',
            engine_identity=self.identity, manifest_sha256=hashlib.sha256(self.manifest_path.read_bytes()).hexdigest())
        config['environment'].update(HOME=home, NAC_HOME=home + '/selected nac')
        for key, name in [('native_sha256', 'Contents/MacOS/NACPreview'), ('engine_sha256', 'Contents/Resources/nac-web'),
                          ('info_plist_sha256', 'Contents/Info.plist'), ('build_receipt_sha256', 'Contents/Resources/build-receipt.json'),
                          ('package_identity_sha256', 'Contents/Resources/PackageIdentity.json'),
                          ('engine_identity_sha256', 'Contents/Resources/engine-identity.json')]:
            config[key] = hashlib.sha256((self.relocated / name).read_bytes()).hexdigest()
        return config

    def admit(self, config=None):
        return validate_normal_package(config or self.config(), self.manifest_path, self.product,
            product_sha=PRODUCT, test_sha=BASELINE, harness_sha=HARNESS)

    def test_final_hashes_admit_without_rewriting_unsigned_receipt(self):
        before = (self.relocated / 'Contents/Resources/build-receipt.json').read_bytes()
        result = self.admit()
        self.assertEqual(result['scope'], 'normal_package_admission_only')
        self.assertFalse(result['actual_ui_run'])
        self.assertEqual(before, (self.relocated / 'Contents/Resources/build-receipt.json').read_bytes())
        with self.assertRaises(ValueError):
            validate(self.config(), self.receipt)
        wrong = self.config()
        wrong.update({key: self.receipt[key] for key in ('native_sha256', 'engine_sha256', 'info_plist_sha256')})
        with self.assertRaises(ValueError):
            self.admit(wrong)

    def test_missing_or_wrong_post_sign_phase_is_refused(self):
        for phase in (None, 'unsigned-build'):
            self.manifest['post_sign_receipt'].pop('phase', None)
            if phase:
                self.manifest['post_sign_receipt']['phase'] = phase
            self.write_manifest()
            with self.assertRaises(ValueError):
                self.admit()

    def test_foreign_embedded_receipt_cannot_be_resealed_into_provenance(self):
        self.receipt['source_head'] = 'f' * 40
        self.seal()
        with self.assertRaises(ValueError):
            self.admit()

    def test_consistent_foreign_source_is_refused(self):
        self.marker['source']['revision'] = 'f' * 40
        self.seal()
        with self.assertRaises(ValueError):
            self.admit()

    def test_source_roster_or_fixture_compiler_cannot_be_resealed(self):
        for field, value in [('native_source_files', {}), ('compiler_flags', ['-D', 'LOCAL_APP', '-D', 'PREVIEW_SMOKE']),
                             ('fixture_markers_absent', []), ('sdk_version', '')]:
            original = self.receipt[field]
            self.receipt[field] = value
            self.marker['native_build_receipt'] = copy.deepcopy(self.receipt)
            self.seal()
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.admit()
            self.receipt[field] = original

    def test_relocated_inventory_and_full_engine_identity_are_bound(self):
        (self.relocated / 'Contents/Resources/nac-web').write_bytes(b'foreign engine')
        with self.assertRaises(ValueError):
            self.admit()
        self.seal()
        self.identity['build_id'] = 'foreign-build'
        self.seal()
        with self.assertRaises(ValueError):
            self.admit()

    def test_manifest_marker_receipt_and_PQH_hashes_are_independent(self):
        for key in ('manifest_sha256', 'package_identity_sha256', 'engine_identity_sha256',
                    'build_receipt_sha256', 'test_source_sha', 'harness_sha'):
            config = self.config()
            config[key] = 'f' * len(config[key])
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.admit(config)


if __name__ == '__main__':
    unittest.main()
