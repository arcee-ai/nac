"""R consumer validation uses synthetic records; never invokes an engine or R."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ci_startup_fixture import FUTURE_MESSAGE, PRODUCT
from ci_startup_protocol import FILES, REVISION, SCENARIOS, TESTS, build, validate_record, verify


class ProtocolConsumerTests(unittest.TestCase):
    def fixture(self, scenario):
        identity = {'product_version': '0.1.4', 'source_revision': PRODUCT, 'track': 'dev', 'build_id': 'dev-' + PRODUCT}
        nonce = '12345678-1234-4234-8234-123456789abc'
        wire = {'kind': 'failed', 'version': 1, 'incarnation': nonce, 'stage': 'startup', 'code': SCENARIOS[scenario],
                'message': FUTURE_MESSAGE if scenario.startswith('future-') else 'constant typed failure'}
        data = (json.dumps(wire) + '\n').encode()
        cleanup = {'cleanup_error': None, 'cleanup': {'result': 'ok', 'port': 'finish_checked', 'direct_child_reaped': True}}
        row = {'schema': 'nac356-private-protocol-observation-v1', 'scenario': scenario, 'result': 'passed',
               'test_compiler_git_revision': REVISION,
               'test_source_sha256': FILES['crates/nac-server/tests/desktop_schema_contract.rs'],
               'test_executable_sha256': 'a' * 64, 'engine_path': '/private/P/NAC.app/Contents/Resources/nac-web',
               'engine_sha256_observed': 'b' * 64, 'engine_identity_observed': identity,
               'expected_target': ['b' * 64, identity], 'raw_wire_utf8': data.decode(),
               'raw_wire_sha256': hashlib.sha256(data).hexdigest(), 'observed_record': wire,
               'hello_sent': {'kind': 'hello', 'version': 1, 'incarnation': nonce, 'identity': identity,
                              'store': '/private/owned/store.db'},
               'preflight_selection_observed': {'version': 1, 'status': 'selected', 'store': '/private/owned/store.db', 'track': 'dev'},
               'exit_code': 1, 'extra_record_absent': True, 'preserved_store_config': True,
               'alternate_database_absent': True, 'lease_reacquired': True,
               'store_before_sha256': ['c' * 64, None, None], 'store_after_sha256': ['c' * 64, None, None],
               'config_before_sha256': 'd' * 64, 'config_sha256': 'd' * 64,
               'profile_cleanup': {'result': 'ok', 'error': None},
               **{key: copy.deepcopy(cleanup) for key in ('configuration', 'identity_inspection', 'serving_supervision')}}
        return row, identity

    def validate(self, row, identity):
        return validate_record(row, row['scenario'], Path('/private/P/NAC.app/Contents/Resources/nac-web'),
                               'b' * 64, identity, 'a' * 64)

    def test_four_process_cases_remain_separate_from_native_ui(self):
        for scenario in SCENARIOS:
            row, identity = self.fixture(scenario)
            receipt = self.validate(row, identity)
            self.assertEqual(receipt['actual_code'], SCENARIOS[scenario])
            self.assertIn('ordinary app UI/private pipe not observed', receipt['scope'])

    def test_wrong_current_source_artifact_or_expected_target_never_passes(self):
        for field, value in (('test_compiler_git_revision', 'a1fed9d4e3edcda264d529a6fdb51078c86390b0'),
                             ('test_source_sha256', 'e' * 64), ('test_executable_sha256', 'e' * 64),
                             ('engine_path', '/outside/engine'), ('engine_sha256_observed', 'e' * 64),
                             ('expected_target', None)):
            row, identity = self.fixture('future-main')
            row[field] = value
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                self.validate(row, identity)

    def test_wire_framing_nonce_stage_and_full_literal_are_observations(self):
        for change in ({'stage': 'preflight'}, {'incarnation': 'foreign'}, {'message': 'Compatible version needed.'},
                       {'endpoint': 'http://127.0.0.1:1'}, {'version': True}):
            row, identity = self.fixture('future-main')
            wire = {**row['observed_record'], **change}
            data = (json.dumps(wire) + '\n').encode()
            row.update(observed_record=wire, raw_wire_utf8=data.decode(), raw_wire_sha256=hashlib.sha256(data).hexdigest())
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                self.validate(row, identity)
        row, identity = self.fixture('future-main')
        row['raw_wire_utf8'] += '{}\n'
        with self.assertRaises(RuntimeError):
            self.validate(row, identity)

    def test_unknown_preservation_or_cleanup_never_becomes_success(self):
        for field, value in (('store_before_sha256', None), ('store_after_sha256', ['changed', None, None]),
                             ('config_before_sha256', None), ('exit_code', True), ('extra_record_absent', 1),
                             ('alternate_database_absent', False), ('lease_reacquired', False),
                             ('profile_cleanup', {'result': 'failed', 'error': 'unknown'})):
            row, identity = self.fixture('future-main')
            row[field] = value
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                self.validate(row, identity)
        row, identity = self.fixture('future-main')
        row['serving_supervision']['cleanup']['direct_child_reaped'] = False
        with self.assertRaises(RuntimeError):
            self.validate(row, identity)

    def test_build_copies_only_actual_compiler_test_artifact_before_return(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            compiler_output = root / 'compiled-test'
            compiler_output.write_bytes(b'synthetic compiler artifact; never executed')
            calls = []
            def run(args, log, timeout, **options):
                calls.append((args, options))
                if args[0] == 'cargo':
                    log.write_text(json.dumps({'reason': 'compiler-artifact',
                        'target': {'name': 'desktop_schema_contract', 'kind': ['test']},
                        'profile': {'test': True}, 'executable': str(compiler_output)}) + '\n')
                else:
                    self.assertEqual(args[1:], ['adapter_', '--nocapture'])
                    self.assertEqual(options['env']['PATH'], '/usr/bin:/bin:/usr/sbin:/sbin')
                    log.write_text('synthetic adapter control success\n')
            with patch('ci_startup_protocol.sources', return_value=root):
                private, receipt = build(root, root / 'private', run)
            self.assertEqual(private.read_bytes(), compiler_output.read_bytes())
            self.assertEqual(private.stat().st_mode & 0o777, 0o500)
            self.assertEqual(receipt['R'], REVISION)
            self.assertEqual(calls[0][1]['env']['NAC_SOURCE_REVISION'], REVISION)
            self.assertIn('--locked', calls[0][0])
            compiler_output.write_bytes(b'changed shared target')
            self.assertNotEqual(private.read_bytes(), compiler_output.read_bytes())

    def test_runtime_uses_four_closed_overrides_and_new_package_digest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            app = root / 'NAC.app'
            engine = app / 'Contents/Resources/nac-web'
            engine.parent.mkdir(parents=True)
            engine.write_bytes(b'synthetic package; never executed')
            manifest = root / 'manifest.json'
            manifest.write_text('{}\n')
            private = root / 'private-test'
            private.write_bytes(b'synthetic external test; never executed')
            sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
            _, identity = self.fixture('future-main')
            admission = {'provenance': {'engine_identity': identity, 'manifest_sha256': sha(manifest),
                         'post_sign_receipt': {'engine_sha256': sha(engine)}}}
            runner = {'R': REVISION, 'P': PRODUCT, 'R_files': FILES,
                      'private_executable': str(private), 'test_executable_sha256': sha(private)}
            def run(args, log, timeout, **options):
                self.assertEqual(args, [str(private), '--exact', *TESTS, '--nocapture'])
                env = options['env']
                self.assertEqual(set(env), {'HOME', 'TMPDIR', 'PATH', 'LANG', 'NAC_DESKTOP_SCHEMA_ENGINE',
                    'NAC_DESKTOP_SCHEMA_SHA256', 'NAC_DESKTOP_SCHEMA_IDENTITY', 'NAC_DESKTOP_SCHEMA_OUTPUT'})
                self.assertEqual(env['NAC_DESKTOP_SCHEMA_ENGINE'], str(engine))
                self.assertEqual(env['NAC_DESKTOP_SCHEMA_SHA256'], sha(engine))
                records = Path(env['NAC_DESKTOP_SCHEMA_OUTPUT'])
                records.mkdir(mode=0o700)
                for scenario in SCENARIOS:
                    row, _ = self.fixture(scenario)
                    row.update(engine_path=str(engine), engine_sha256_observed=sha(engine),
                               expected_target=[sha(engine), identity], test_executable_sha256=sha(private))
                    (records / (scenario + '.json')).write_text(json.dumps(row))
                log.write_text('synthetic four-test runtime\n')
            receipt = verify(private, runner, app, manifest, admission, root / 'runtime', run)
            self.assertEqual(len(receipt['observations']), 4)
            self.assertFalse(receipt['native_UI_qualified'])
            with self.assertRaises(RuntimeError):
                verify(private, {**runner, 'R': '0' * 40}, app, manifest, admission, root / 'rejected', run)


if __name__ == '__main__':
    unittest.main()
