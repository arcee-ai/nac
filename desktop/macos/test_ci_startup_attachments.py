"""Production collector controls with synthetic SDK exports, never native proof."""
import copy
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zlib

from ci_startup_attachments import (IDENTITY, PROVENANCE, QUERY_DIAGNOSTIC, QUERY_FLAGS, QUERY_ORDER,
                                    TEST_ID, TEST_URL, collect, png_identity, require_query_diagnostic)
from ci_startup_fixture import CASES, PRODUCT, SCHEMA, TEST_FILES, TEST_SOURCE, operations
from ci_xctest_attachments import AttachmentTool, bounded_file, digest


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
                self.assertEqual(index['query_diagnostic'], {'retention': 'missing'})
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


    def diagnostic(self, config, config_hash, witness, *, partial=False):
        row = {key: config[key] for key in ('source_sha', 'test_source_sha', 'harness_sha', 'startup_source_sha256')}
        row.update({key: witness[key] for key in IDENTITY})
        row.update(schema='nac342-query-diagnostic-v1', version=1, phase='onboarding', scenario=config['scenario'],
                   configuration_sha256=config_hash, legacy_exists=False, guard_before=True, guard_after=True,
                   status='partial' if partial else 'complete', stop_reason='time_budget' if partial else 'none',
                   elapsed_ms=5001 if partial else 12, elapsed_overflow=False,
                   queries=[dict(query=name, count=0, overflow=False, candidate_truncated=False, candidates=[])
                            for name in (QUERY_ORDER[:4] if partial else QUERY_ORDER)])
        if not partial:
            # A positive alternate fixed-target match still cannot pass the legacy assertion.
            candidate = dict.fromkeys(QUERY_FLAGS, False)
            candidate.update(element_type=48, exists=True, hittable=True, enabled=True, window_intersection=True,
                             label_exact=True, label_contains=True, label_trim_exact=True)
            row['queries'][5].update(count=1, candidates=[candidate])
        return row

    def failed_diagnostic(self, raw, payload=None, *, case='onboarding', mutate=None, prefix=0):
        config, config_hash, witness, rows = self.fixture(case)
        if payload is None:
            payload = json.dumps(self.diagnostic(config, config_hash, witness)).encode()
        failed = [*rows[:prefix], (f'nac342-failure-{case}', self.png()), rows[-1], (QUERY_DIAGNOSTIC, payload)]
        with self.assertRaisesRegex(RuntimeError, 'required_ordinary_observation'):
            collect(self.tool(raw, failed, result='Failed', mutate=mutate), raw / 'unit.xcresult',
                    config, config_hash, witness, raw / 'selected')
        index = json.loads((raw / 'selected/index.json').read_text())
        self.assertFalse(index['complete'])
        self.assertTrue(index['input_completion_unknown'])
        self.assertEqual(index['actual_test']['result'], 'Failed')
        self.assertEqual(index['collection_error']['reason'], 'required_ordinary_observation')
        self.assertIn('cleanup', index)
        self.assertIn('failure_image', index)
        self.assertNotIn('image', index)
        self.assertNotIn('observation', index)
        self.assertTrue(all(item['name'] != QUERY_DIAGNOSTIC for item in index['selected']))
        self.assertEqual(len(index['dispatches']), prefix)
        return index

    def test_optional_complete_partial_and_exact_bound_are_retained_without_success_or_input_credit(self):
        for case, partial, padding in (('onboarding', False, False), ('configuredLocal', True, False),
                                       ('onboarding', False, True)):
            with self.subTest(case=case, partial=partial, padding=padding), tempfile.TemporaryDirectory() as temporary:
                raw = Path(temporary)
                config, config_hash, witness, _ = self.fixture(case)
                value = self.diagnostic(config, config_hash, witness, partial=partial)
                data = json.dumps(value).encode()
                if padding:
                    data += b' ' * (8192 - len(data))
                index = self.failed_diagnostic(raw, data, case=case, prefix=2 if case == 'configuredLocal' else 0)
                receipt = index['query_diagnostic']
                self.assertEqual(receipt['retention'], 'retained')
                self.assertEqual(receipt['status'], value['status'])
                self.assertEqual(receipt['sha256'], digest(data))
                self.assertEqual((raw / 'selected' / receipt['file']).read_bytes(), data)

    def test_diagnostic_uses_actual_case_bindings_instead_of_historical_example_pins(self):
        config, config_hash, witness, _ = self.fixture('onboarding')
        config.update(source_sha='1' * 40, test_source_sha='2' * 40, harness_sha='3' * 40,
                      startup_source_sha256='4' * 64)
        data = json.dumps(self.diagnostic(config, config_hash, witness)).encode()
        self.assertEqual(require_query_diagnostic(data, config, config_hash, witness)['harness_sha'], '3' * 40)

    def test_fixed_query_contract_and_append_only_clock_clarification(self):
        self.assertEqual(QUERY_ORDER, ('app_webviews', 'window_webviews', 'legacy_title', 'app_static_title',
                         'window_static_title', 'window_label_title', 'window_value_title', 'window_identifier_title',
                         'window_button_start', 'legacy_button_start', 'window_label_subtitle', 'window_value_subtitle'))
        config, config_hash, witness, _ = self.fixture('onboarding')
        base = self.diagnostic(config, config_hash, witness)
        for elapsed, overflow, status, reason in ((4999, False, 'complete', 'none'),
                (5000, False, 'partial', 'time_budget'), (5001, False, 'partial', 'time_budget'),
                (600000, False, 'partial', 'time_budget'), (600000, True, 'partial', 'time_budget'),
                (0, False, 'partial', 'clock_invalid')):
            with self.subTest(elapsed=elapsed, overflow=overflow):
                row = {**base, 'elapsed_ms': elapsed, 'elapsed_overflow': overflow, 'status': status, 'stop_reason': reason}
                require_query_diagnostic(json.dumps(row).encode(), config, config_hash, witness)
        # Fifth query may contain candidates; the first four queries are counts only.
        row = copy.deepcopy(base)
        row['queries'][4], row['queries'][5] = row['queries'][5], row['queries'][4]
        row['queries'][4]['query'], row['queries'][5]['query'] = QUERY_ORDER[4:6]
        require_query_diagnostic(json.dumps(row).encode(), config, config_hash, witness)
        for index in range(4):
            row = copy.deepcopy(base)
            row['queries'][index].update(count=1, candidates=base['queries'][5]['candidates'])
            with self.assertRaisesRegex(RuntimeError, 'query_count_only'):
                require_query_diagnostic(json.dumps(row).encode(), config, config_hash, witness)
        for changes in ({'elapsed_ms': 5000}, {'elapsed_ms': 5001}, {'elapsed_overflow': True},
                        {'status': 'partial', 'stop_reason': 'time_budget', 'elapsed_ms': 4999},
                        {'status': 'partial', 'stop_reason': 'clock_invalid', 'elapsed_ms': 1},
                        {'status': 'partial', 'stop_reason': 'clock_invalid', 'elapsed_ms': 0, 'elapsed_overflow': True}):
            with self.subTest(changes=changes), self.assertRaises(RuntimeError):
                require_query_diagnostic(json.dumps({**base, **changes}).encode(), config, config_hash, witness)

    def test_count_candidate_and_time_precedence_are_honest_partial_prefixes(self):
        config, config_hash, witness, _ = self.fixture('onboarding')
        base = self.diagnostic(config, config_hash, witness)
        variants = []
        count = copy.deepcopy(base)
        count.update(status='partial', stop_reason='count_limit', queries=count['queries'][:5])
        count['queries'][-1].update(count=4096, overflow=True)
        variants.append(count)
        truncated = copy.deepcopy(base)
        truncated.update(status='partial', stop_reason='candidate_limit')
        truncated['queries'][5].update(candidate_truncated=True)
        variants.append(truncated)
        exhausted = copy.deepcopy(truncated)
        candidate = exhausted['queries'][5]['candidates'][0]
        for index in (4, 5):
            exhausted['queries'][index].update(count=5, candidates=[candidate] * 4, candidate_truncated=True)
        variants.append(exhausted)
        for row in variants:
            for elapsed, reason in ((12, row['stop_reason']), (5000, 'time_budget'), (0, 'clock_invalid')):
                with self.subTest(reason=reason, source_reason=row['stop_reason']):
                    value = {**row, 'elapsed_ms': elapsed, 'stop_reason': reason}
                    require_query_diagnostic(json.dumps(value).encode(), config, config_hash, witness)
        for mutate in (lambda r: r.update(stop_reason='none', status='complete'),
                       lambda r: r.update(stop_reason='candidate_limit'),
                       lambda r: r.update(elapsed_ms=5000),
                       lambda r: r['queries'].append(base['queries'][5])):
            row = copy.deepcopy(count)
            mutate(row)
            with self.assertRaises(RuntimeError):
                require_query_diagnostic(json.dumps(row).encode(), config, config_hash, witness)
        # Nine candidates and an unreported candidate shortfall cannot be a complete census.
        row = copy.deepcopy(exhausted)
        row['queries'][6].update(count=1, candidates=[candidate])
        with self.assertRaisesRegex(RuntimeError, 'query_candidate_bound'):
            require_query_diagnostic(json.dumps(row).encode(), config, config_hash, witness)
        row = copy.deepcopy(base)
        row['queries'][5].update(count=2)
        with self.assertRaisesRegex(RuntimeError, 'query_candidate_prefix'):
            require_query_diagnostic(json.dumps(row).encode(), config, config_hash, witness)

    def test_malformed_optional_json_never_masks_failure_or_retains_rejected_content(self):
        config, config_hash, witness, _ = self.fixture('onboarding')
        base = self.diagnostic(config, config_hash, witness)
        mutations = [('extra_private_content', lambda r: r.update(raw_tree='FOREIGN-MUST-NOT-BE-RETAINED')),
                     ('legacy_success', lambda r: r.update(legacy_exists=True)),
                     ('guard', lambda r: r.update(guard_after=False)),
                     ('version_bool', lambda r: r.update(version=True)),
                     ('phase', lambda r: r.update(phase='FOREIGN-MUST-NOT-BE-RETAINED')),
                     ('status', lambda r: r.update(status='passed')),
                     ('elapsed_bool', lambda r: r.update(elapsed_ms=True)),
                     ('elapsed_bound', lambda r: r.update(elapsed_ms=600001)),
                     ('overflow_type', lambda r: r.update(elapsed_overflow=1)),
                     ('prefix_gap', lambda r: r['queries'].pop(1)),
                     ('duplicate_query', lambda r: r['queries'].append(r['queries'][0])),
                     ('count_bool', lambda r: r['queries'][0].update(count=True)),
                     ('count_negative', lambda r: r['queries'][0].update(count=-1)),
                     ('count_bound', lambda r: r['queries'][0].update(count=4097)),
                     ('candidate_count', lambda r: r['queries'][5].update(candidates=r['queries'][5]['candidates'] * 5)),
                     ('candidate_private', lambda r: r['queries'][5]['candidates'][0].update(label='FOREIGN-MUST-NOT-BE-RETAINED')),
                     ('nonstring_value_flags', lambda r: r['queries'][5]['candidates'][0].update(value_exact=True))]
        for key in ('source_sha', 'test_source_sha', 'harness_sha', 'startup_source_sha256',
                    'configuration_sha256', 'native_sha256', 'app_path'):
            mutations.append((key, lambda r, k=key: r.update({k: 'FOREIGN-MUST-NOT-BE-RETAINED'})))
        for key, value in (('app_pid', 124), ('app_pid', True), ('app_launch_epoch', True),
                           ('app_launch_epoch', float('nan')), ('app_launch_epoch', float('inf')),
                           ('app_launch_epoch', 1234.6), ('window_number', 18), ('window_number', True)):
            mutations.append((key, lambda r, k=key, v=value: r.update({k: v})))
        for name, mutation in mutations:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                row = copy.deepcopy(base)
                mutation(row)
                raw = Path(temporary)
                index = self.failed_diagnostic(raw, json.dumps(row).encode())
                self.assertEqual(index['query_diagnostic']['retention'], 'rejected')
                self.assertFalse((raw / 'selected' / (QUERY_DIAGNOSTIC + '.json')).exists())
                self.assertTrue(all(b'FOREIGN-MUST-NOT-BE-RETAINED' not in file.read_bytes()
                                    for file in (raw / 'selected').iterdir()))
        data = json.dumps(base).encode()
        for malformed in (b'{"raw":"FOREIGN-MUST-NOT-BE-RETAINED"', b'[]', data + b' ',
                          data[:-1] + b',"version":1}', data.replace(b'"count": 0', b'"count": 0,"count": 0', 1)):
            if malformed == data + b' ':
                malformed += b' ' * 8192
            with self.subTest(malformed=digest(malformed)), tempfile.TemporaryDirectory() as temporary:
                raw = Path(temporary)
                index = self.failed_diagnostic(raw, malformed)
                self.assertEqual(index['query_diagnostic']['retention'], 'rejected')
                self.assertFalse((raw / 'selected' / (QUERY_DIAGNOSTIC + '.json')).exists())

    def test_optional_inventory_rejects_late_aliases_unsafe_paths_and_nonregular_files(self):
        def duplicate(export, manifest):
            manifest[0]['attachments'].append(copy.deepcopy(manifest[0]['attachments'][-2]))
        def duplicate_file(export, manifest):
            manifest[0]['attachments'].append({**manifest[0]['attachments'][-2], 'suggestedHumanReadableName': 'Automatic'})
        def unsafe(export, manifest):
            manifest[0]['attachments'][-2]['exportedFileName'] = '../FOREIGN-MUST-NOT-BE-RETAINED'
        def symlink(export, manifest):
            file = export / manifest[0]['attachments'][-2]['exportedFileName']
            file.unlink()
            file.symlink_to(export / 'automatic.png')
        def foreign(export, manifest):
            manifest[0]['attachments'][-2]['suggestedHumanReadableName'] = 'nac342-query-diagnostic-v1-foreign'
        for mutation in (duplicate, duplicate_file, unsafe, symlink, foreign):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary:
                raw = Path(temporary)
                index = self.failed_diagnostic(raw, mutate=mutation)
                self.assertEqual(index['query_diagnostic']['retention'], 'rejected')
                self.assertFalse((raw / 'selected' / (QUERY_DIAGNOSTIC + '.json')).exists())

    def test_optional_diagnostic_on_pass_is_rejected_and_original_failed_result_is_preserved(self):
        for result, reason in (('Passed', 'unexpected_failure_diagnostic'), ('Failed', 'actual_test_result')):
            with self.subTest(result=result), tempfile.TemporaryDirectory() as temporary:
                raw = Path(temporary)
                config, config_hash, witness, rows = self.fixture('onboarding')
                rows.append((QUERY_DIAGNOSTIC, json.dumps(self.diagnostic(config, config_hash, witness)).encode()))
                with self.assertRaisesRegex(RuntimeError, reason):
                    collect(self.tool(raw, rows, result=result), raw / 'unit.xcresult', config, config_hash, witness, raw / 'selected')
                index = json.loads((raw / 'selected/index.json').read_text())
                self.assertEqual(index['actual_test']['result'], result)
                self.assertFalse(index['complete'])
                self.assertTrue(index['input_completion_unknown'])
                self.assertEqual(index['query_diagnostic']['retention'], 'retained' if result == 'Failed' else 'rejected')

    def test_diagnostic_write_failure_removes_partial_file_without_masking_original_failure(self):
        original = Path.write_bytes
        def write(file, data):
            if file.name == QUERY_DIAGNOSTIC + '.json':
                original(file, data[:50])
                raise OSError('FOREIGN-MUST-NOT-BE-RETAINED')
            return original(file, data)
        with tempfile.TemporaryDirectory() as temporary, patch.object(Path, 'write_bytes', write):
            raw = Path(temporary)
            index = self.failed_diagnostic(raw)
            self.assertEqual(index['query_diagnostic']['retention'], 'rejected')
            self.assertFalse((raw / 'selected' / (QUERY_DIAGNOSTIC + '.json')).exists())
            self.assertNotIn('FOREIGN-MUST-NOT-BE-RETAINED', json.dumps(index))

    def test_optional_unavailable_or_growing_file_is_rejected_without_exception_text(self):
        class UnknownError(Exception):
            def __str__(self):
                raise AssertionError('Do not stringify diagnostic errors')
        for failure in ('unavailable', 'growth'):
            def read(path, limit):
                if Path(path).name == 'payload-2':  # Failure PNG, cleanup, then diagnostic.
                    if failure == 'unavailable':
                        raise UnknownError()
                    Path(path).write_bytes(b'FOREIGN-MUST-NOT-BE-RETAINED' + b'x' * 8192)
                return bounded_file(path, limit)
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temporary, \
                    patch('ci_startup_attachments.bounded_file', read):
                raw = Path(temporary)
                index = self.failed_diagnostic(raw)
                self.assertEqual(index['query_diagnostic']['retention'], 'rejected')
                self.assertFalse((raw / 'selected' / (QUERY_DIAGNOSTIC + '.json')).exists())
                self.assertNotIn('FOREIGN-MUST-NOT-BE-RETAINED', json.dumps(index))

    def test_diagnostic_cannot_bypass_cleanup_scope_or_actual_test_selection(self):
        for case, mode, reason in (('onboarding', 'missing_cleanup', 'cleanup_missing'),
                ('invalidConfig', 'wrong_scope', 'required_ordinary_observation'),
                ('futureStore', 'wrong_scope', 'required_ordinary_observation'),
                ('onboarding', 'foreign_test', 'selected_test')):
            with self.subTest(case=case, mode=mode), tempfile.TemporaryDirectory() as temporary:
                raw = Path(temporary)
                config, config_hash, witness, rows = self.fixture(case)
                data = json.dumps(self.diagnostic(config, config_hash, witness)).encode()
                failed = ([] if mode == 'missing_cleanup' else [rows[-1]]) + [(QUERY_DIAGNOSTIC, data)]
                tool = self.tool(raw, failed, result='Failed')
                if mode == 'foreign_test':
                    command = tool.command
                    def foreign(argv):
                        return command(argv).replace(TEST_URL, TEST_URL + '-foreign')
                    tool.command = foreign
                with self.assertRaisesRegex(RuntimeError, reason):
                    collect(tool, raw / 'unit.xcresult', config, config_hash, witness, raw / 'selected')
                index = json.loads((raw / 'selected/index.json').read_text())
                self.assertFalse(index['complete'])
                self.assertTrue(index['input_completion_unknown'])
                self.assertEqual(index['query_diagnostic']['retention'],
                                 'retained' if mode == 'missing_cleanup' else 'missing' if mode == 'foreign_test' else 'rejected')

    def test_candidate_closed_types_and_comparison_projection(self):
        config, config_hash, witness, _ = self.fixture('onboarding')
        base = self.diagnostic(config, config_hash, witness)
        mutations = [(key, 1) for key in QUERY_FLAGS]
        mutations += [('element_type', True), ('element_type', -1), ('element_type', 1001),
                      ('element_type', 48.0), ('raw_hash', 'FOREIGN-MUST-NOT-BE-RETAINED'),
                      ('label_contains', False), ('label_trim_exact', False)]
        for key, value in mutations:
            with self.subTest(key=key, value=value):
                row = copy.deepcopy(base)
                row['queries'][5]['candidates'][0][key] = value
                with self.assertRaises(RuntimeError):
                    require_query_diagnostic(json.dumps(row).encode(), config, config_hash, witness)


if __name__ == '__main__':
    unittest.main()
