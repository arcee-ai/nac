"""Production collector controls with synthetic SDK exports, never native proof."""
import copy
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zlib

from ci_startup_attachments import (IDENTITY, PROVENANCE, TEST_ID, TEST_URL, collect, png_identity)
from ci_startup_fixture import CASES, PRODUCT, SCHEMA, TEST_FILES, TEST_SOURCE, operations
from ci_xctest_attachments import AttachmentTool, digest


class StartupAttachmentTests(unittest.TestCase):
    def fixture(self, case):
        config = {key: 'a' * 64 for key in PROVENANCE}
        config.update(schema=SCHEMA, scenario=case, source_sha=PRODUCT, test_source_sha=TEST_SOURCE,
                      harness_sha='b' * 40, startup_source_sha256=TEST_FILES['StartupJourneys.swift'],
                      home='/private/owned home', app_path='/private/owned/NAC.app', bundle_id='ai.arcee.nac.dev')
        witness = dict(app_pid=123, app_launch_epoch=1234.5, window_number=17,
                       app_path=config['app_path'], native_sha256=config['native_sha256'],
                       preinstalled=True, owned_incarnation_verified=True)
        config_hash = 'c' * 64
        rows = []
        for number, operation in enumerate(operations(config), 1):
            for stage in ('before', 'after'):
                row = dict(schema='nac342-dispatch-v1', scenario=case, configuration_sha256=config_hash,
                           operation_index=number, operation=operation, stage=stage,
                           **{key: witness[key] for key in IDENTITY})
                rows.append((f'nac342-dispatch-v1-{number:02d}-{stage}', json.dumps(row).encode()))
        png = self.png()
        console = dict(on_console=True, login_done=True, root_locked=False, session_lock_flag=None,
                       quartz_lock_flag=None, rendered_app_qualification_required=True)
        observation = {key: config[key] for key in PROVENANCE}
        observation.update({key: witness[key] for key in IDENTITY})
        observation.update(schema=SCHEMA, scenario=case, configuration_sha256=config_hash,
            bundle_id=config['bundle_id'], ordinary_compile_mode='LOCAL_APP', smoke_instrumentation=False,
            operations=operations(config), console=[console] * (26 if operations(config) else 4),
            capture='public-XCTest-window-screenshot', png_sha256=digest(png), visible_paint='requires_actual_image_review',
            input_method='public-XCTest', physical_keyboard_or_ime_claim=False, external_cleanup_required=True,
            future_schema_G2_assertion=('exact_unique_message_observed_producer_binding_required'
                                       if case == 'futureStore' else 'not_applicable'),
            expected_private_failure=({'kind': 'failed', 'version': 1, 'code': 'store_schema_incompatible',
                                      'stage': 'startup'} if case == 'futureStore' else {}),
            private_failure_observation='not_read_by_public_UI_actor',
            four_case_acceptance='requires_producer_source_binding_SDK_run_and_external_integrity_audits')
        cleanup = dict(schema='nac342-cleanup-v1', scenario=case, configuration_sha256=config_hash,
                       app_pid=witness['app_pid'], app_path=config['app_path'], app_termination_observed=True,
                       engine_cleanup='requires_external_exact_owner_audit', profile_cleanup='requires_external_exact_owner_audit')
        rows.extend([(f'nac342-ordinary-{case}', png),
                     (f'nac342-ordinary-v1-{case}', json.dumps(observation).encode()),
                     (f'nac342-cleanup-v1-{case}', json.dumps(cleanup).encode())])
        return config, config_hash, witness, rows

    def png(self):
        def chunk(kind, body):
            return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xffffffff)
        # Stored DEFLATE makes this >256KiB, explicitly synthetic, with valid CRC/framing.
        pixels = (b'\0' + b'\x21\x32\x43' * 800) * 500
        return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 800, 500, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(pixels, level=0)) + chunk(b'IEND', b''))

    def tool(self, raw, rows, *, result='Passed', mutate=None):
        def command(argv):
            if argv[1:4] == ['get', 'test-results', 'tests']:
                return json.dumps({'testNodes': [{'nodeType': 'Test Case', 'nodeIdentifier': TEST_ID,
                                                  'nodeIdentifierURL': TEST_URL, 'result': result}]})
            export = Path(argv[argv.index('--output-path') + 1])
            export.mkdir()
            entries = []
            for number, (name, data) in enumerate(rows):
                filename = f'payload-{number}'
                (export / filename).write_bytes(data)
                entries.append({'exportedFileName': filename, 'suggestedHumanReadableName': name})
            (export / 'automatic.png').write_bytes(b'HOST-AUTOMATIC-MUST-NOT-BE-RETAINED')
            entries.append({'exportedFileName': 'automatic.png', 'suggestedHumanReadableName': 'Automatic screenshot'})
            manifest = [{'testIdentifier': TEST_ID, 'attachments': entries}]
            if mutate:
                mutate(export, manifest)
            (export / 'manifest.json').write_text(json.dumps(manifest))
            return 'Synthetic unit export only'
        tool = AttachmentTool(raw, command)
        tool.path = '/unit/xcresulttool'
        return tool

    def test_all_four_cases_require_actual_named_bindings_and_preserve_large_png_intact(self):
        for case in CASES:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as temporary:
                raw = Path(temporary)
                config, config_hash, witness, rows = self.fixture(case)
                index = collect(self.tool(raw, rows), raw / 'unit.xcresult', config, config_hash, witness, raw / 'selected')
                self.assertTrue(index['complete'])
                self.assertEqual(len(index['dispatches']), 22 if case == 'configuredLocal' else 0)
                image = (raw / 'selected' / f'nac342-ordinary-{case}.png').read_bytes()
                self.assertGreater(len(image), 256 * 1024)
                self.assertEqual(digest(image), index['observation']['png_sha256'])
                self.assertEqual(len(image), index['image']['bytes'])
                self.assertEqual(index['automatic_omitted'], 1)
                for file in raw.rglob('*'):
                    if file.is_file():
                        self.assertNotIn(b'HOST-AUTOMATIC-MUST-NOT-BE-RETAINED', file.read_bytes())

    def test_partial_malformed_or_wrong_binding_never_retains_rejected_json_or_completes(self):
        for failure in ('partial-before', 'gap', 'order', 'malformed', 'wrong-binding', 'wrong-stage', 'console'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temporary:
                raw = Path(temporary)
                config, config_hash, witness, rows = self.fixture('configuredLocal')
                if failure == 'partial-before':
                    rows = rows[:1]
                elif failure == 'gap':
                    rows.pop(2)
                elif failure == 'order':
                    rows[2], rows[3] = rows[3], rows[2]
                elif failure == 'malformed':
                    rows[2] = (rows[2][0], b'{"FOREIGN-MUST-NOT-BE-RETAINED":')
                elif failure in ('wrong-binding', 'wrong-stage'):
                    value = json.loads(rows[2][1])
                    value['configuration_sha256' if failure == 'wrong-binding' else 'stage'] = 'FOREIGN-MUST-NOT-BE-RETAINED'
                    rows[2] = (rows[2][0], json.dumps(value).encode())
                else:
                    name, data = rows[-2]
                    value = json.loads(data)
                    value['console'][0]['session_lock_flag'] = 0
                    rows[-2] = (name, json.dumps(value).encode())
                with self.assertRaises((RuntimeError, json.JSONDecodeError)):
                    collect(self.tool(raw, rows), raw / 'unit.xcresult', config, config_hash, witness, raw / 'selected')
                index = json.loads((raw / 'selected/index.json').read_text())
                self.assertFalse(index['complete'])
                self.assertTrue(index['input_completion_unknown'])
                if failure != 'console':
                    self.assertEqual(len(index['dispatches']), 1 if failure == 'partial-before' else 2)
                for file in (raw / 'selected').rglob('*'):
                    if file.is_file():
                        self.assertNotIn(b'FOREIGN-MUST-NOT-BE-RETAINED', file.read_bytes())

    def test_manifest_and_preinstalled_witness_guards_fail_closed(self):
        def symlink(export, manifest):
            file = export / manifest[0]['attachments'][0]['exportedFileName']
            file.unlink()
            file.symlink_to(export / 'automatic.png')
        mutations = [lambda e, m: m[0]['attachments'].append(copy.deepcopy(m[0]['attachments'][0])),
                     lambda e, m: m[0].update(testIdentifier='FOREIGN-MUST-NOT-BE-RETAINED'), symlink,
                     lambda e, m: m[0]['attachments'][0].update(exportedFileName='../outside')]
        for mutation in mutations:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary:
                raw = Path(temporary)
                config, config_hash, witness, rows = self.fixture('onboarding')
                with self.assertRaises(RuntimeError):
                    collect(self.tool(raw, rows, mutate=mutation), raw / 'unit.xcresult', config, config_hash, witness, raw / 'selected')
                self.assertFalse(json.loads((raw / 'selected/index.json').read_text())['complete'])
        with tempfile.TemporaryDirectory() as temporary:
            raw = Path(temporary)
            config, config_hash, witness, rows = self.fixture('onboarding')
            with self.assertRaisesRegex(RuntimeError, 'external_witness'):
                collect(self.tool(raw, rows), raw / 'unit.xcresult', config, config_hash,
                        {**witness, 'preinstalled': False}, raw / 'selected')

    def test_late_inventory_errors_keep_only_unambiguous_continuous_dispatch_prefix(self):
        def unsafe(export, manifest):
            manifest[0]['attachments'][3]['exportedFileName'] = '../FOREIGN-MUST-NOT-BE-RETAINED'
        def duplicate_name_with_unsafe_path(export, manifest):
            manifest[0]['attachments'].append({
                **manifest[0]['attachments'][2], 'exportedFileName': '../FOREIGN-MUST-NOT-BE-RETAINED'})
        def duplicate_file_with_automatic_name(export, manifest):
            manifest[0]['attachments'].append({**manifest[0]['attachments'][2],
                                               'suggestedHumanReadableName': 'Automatic screenshot'})
        for mutation, expected in ((unsafe, 3), (duplicate_name_with_unsafe_path, 2),
                                   (duplicate_file_with_automatic_name, 2)):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary:
                raw = Path(temporary)
                config, config_hash, witness, rows = self.fixture('configuredLocal')
                with self.assertRaises(RuntimeError):
                    collect(self.tool(raw, rows, mutate=mutation), raw / 'unit.xcresult',
                            config, config_hash, witness, raw / 'selected')
                index = json.loads((raw / 'selected/index.json').read_text())
                self.assertFalse(index['complete'])
                self.assertTrue(index['input_completion_unknown'])
                self.assertEqual(len(index['dispatches']), expected)
                self.assertTrue(index['selection_errors'])
                self.assertLessEqual(len(index['selection_metadata']), 64)
                for file in (raw / 'selected').rglob('*'):
                    if file.is_file():
                        self.assertNotIn(b'FOREIGN-MUST-NOT-BE-RETAINED', file.read_bytes())

    def test_test_failure_keeps_valid_bound_observation_without_promoting_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            raw = Path(temporary)
            config, config_hash, witness, rows = self.fixture('onboarding')
            with self.assertRaisesRegex(RuntimeError, 'actual_test_result'):
                collect(self.tool(raw, rows, result='Failed'), raw / 'unit.xcresult', config, config_hash, witness, raw / 'selected')
            self.assertTrue((raw / 'selected/nac342-ordinary-onboarding.png').exists())
            self.assertFalse(json.loads((raw / 'selected/index.json').read_text())['complete'])

    def test_png_crc_truncation_and_unbounded_images_are_rejected(self):
        image = self.png()
        for data in (image[:-1], image + b'extra', b'x' * (2 * 1024 * 1024 + 1),
                     image[:40] + b'x' + image[41:]):
            with self.assertRaises(RuntimeError):
                png_identity(data)

    def test_foreign_final_observations_never_escape_through_payload_or_error(self):
        for field, value in (('app_pid', True), ('app_launch_epoch', 9999.0), ('window_number', 23),
                             ('native_sha256', 'FOREIGN-MUST-NOT-BE-RETAINED'), ('png_sha256', 'f' * 64),
                             ('ordinary_compile_mode', 'PREVIEW_SMOKE'), ('test_source_sha', 'f' * 40),
                             ('external_cleanup_required', 1)):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temporary:
                raw = Path(temporary)
                config, config_hash, witness, rows = self.fixture('onboarding')
                name, data = rows[-2]
                observation = json.loads(data)
                observation[field] = value
                rows[-2] = (name, json.dumps(observation).encode())
                with self.assertRaises(RuntimeError):
                    collect(self.tool(raw, rows), raw / 'unit.xcresult', config, config_hash, witness, raw / 'selected')
                self.assertFalse((raw / 'selected' / (name + '.json')).exists())
                for file in (raw / 'selected').rglob('*'):
                    if file.is_file():
                        self.assertNotIn(b'FOREIGN-MUST-NOT-BE-RETAINED', file.read_bytes())


if __name__ == '__main__':
    unittest.main()
