import copy
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import tempfile
import unittest
from unittest.mock import Mock, patch

from ci_terminal import CONTRACT
from ci_xctest import run_terminal
from ci_xctest_attachments import (AttachmentTool, MAX_SNAPSHOT, PROTOCOL, TEST_URL, actual_test,
                                    bounded_file, json_data, require_snapshots, selected_attachments)


class AttachmentPolicyTests(unittest.TestCase):
    def setUp(self):
        self.operations = json.loads(CONTRACT.read_text())['phases']
        self.binding = {'harness_sha': 'a' * 40, 'target_sha': 'b' * 40,
                        'configuration_sha256': 'c' * 64, 'operation_contract_sha256': 'd' * 64,
                        'native_sha256': 'e' * 64, 'test_identifier_url': TEST_URL,
                        'app': {'schema': 1, 'app_pid': 101, 'engine_pid': 102, 'target_window_number': 17,
                                'app_launch_epoch': 1234.5, 'bundle_path': '/private/owned/Fixture.app',
                                'session_id': 'session', 'terminal_id': 'terminal', 'controller_revision': '1',
                                'unfocused_guard_rejected': True, 'total_seconds_limit': 240,
                                'app_event_post_access': False}}
        self.test = {'nodeIdentifierURL': TEST_URL, 'nodeIdentifier': 'NativeJourneys/testTerminalUnicodeControlResize()',
                     'nodeType': 'Test Case', 'name': 'testTerminalUnicodeControlResize()', 'result': 'Passed'}

    def snapshots(self):
        rows, snapshots = [], []
        for phase in self.operations:
            rows.append({**copy.deepcopy(phase), 'state': 'dispatching-once'})
            for stage in ('before', 'after'):
                if stage == 'after':
                    rows[-1].update(state='dispatched-once', elapsed_ms=10)
                number = len(snapshots) + 1
                snapshots.append({'schema': PROTOCOL, 'event_index': number, 'stage': stage,
                                  'uptime_ns': str(number * 10000000), 'binding': copy.deepcopy(self.binding),
                                  'rows': copy.deepcopy(rows)})
        return snapshots

    def export(self, directory, snapshots):
        directory.mkdir(parents=True, exist_ok=True)
        entries = []
        for snapshot in snapshots:
            number, stage = snapshot['event_index'], snapshot['stage']
            filename = f'payload-{number:02d}.json'
            (directory / filename).write_text(json.dumps(snapshot))
            entries.append({'exportedFileName': filename, 'suggestedHumanReadableName':
                f'{PROTOCOL}-{number:02d}-{stage}_0_12345678-1234-1234-1234-123456789abc.json'})
        (directory / 'automatic.png').write_bytes(b'unit fixture: must never be copied to retained evidence')
        entries.append({'exportedFileName': 'automatic.png', 'suggestedHumanReadableName': 'Automatic screenshot'})
        manifest = [{'testIdentifier': self.test['nodeIdentifier'], 'attachments': entries}]
        (directory / 'manifest.json').write_text(json.dumps(manifest))
        return manifest

    def test_complete_and_partial_prefix_never_infer_input_completion(self):
        snapshots = self.snapshots()
        complete = require_snapshots(snapshots, self.binding, self.operations)
        self.assertTrue(complete['complete'])
        self.assertEqual(len(complete['rows']), 6)
        for count in range(13):
            result = require_snapshots(snapshots[:count], self.binding, self.operations)
            self.assertEqual(result['complete'], count == 12)
            self.assertEqual(result['input_completion_unknown'], count % 2 == 1)
            self.assertIn('partial input', result['partial_scope'])
            self.assertNotIn('zero_input', result)

    def test_binding_reorder_gap_prior_edit_and_literal_mutation_fail(self):
        mutations = [lambda s: s.reverse(), lambda s: s.pop(2), lambda s: s.append(copy.deepcopy(s[-1])),
                     lambda s: s[2]['rows'][0].update(elapsed_ms=9),
                     lambda s: s[0]['binding'].update(target_sha='f' * 40),
                     lambda s: s[0]['binding']['app'].update(controller_revision='2'),
                     lambda s: s[0]['binding'].update(configuration_sha256='f' * 64),
                     lambda s: s[0]['rows'][0]['operation'].update(text='different command'),
                     lambda s: s[0]['rows'][0].update(sequence=True),
                     lambda s: s[0]['rows'][0].update(state='dispatched-once', elapsed_ms=0),
                     lambda s: s[5]['rows'][-1].update(elapsed_ms=10001),
                     lambda s: s[1].update(uptime_ns=s[0]['uptime_ns'])]
        for mutate in mutations:
            snapshots = self.snapshots()
            mutate(snapshots)
            with self.subTest(mutation=mutate), self.assertRaises(RuntimeError):
                require_snapshots(snapshots, self.binding, self.operations)

    def test_actual_result_requires_one_exact_test_url(self):
        self.assertEqual(actual_test({'testNodes': [self.test]})['nodeIdentifierURL'], TEST_URL)
        for nodes in ([], [self.test, self.test], [{**self.test, 'nodeIdentifierURL': 'test://foreign'}]):
            with self.assertRaises(RuntimeError):
                actual_test({'testNodes': nodes})

    def test_manifest_filters_automatic_data_and_rejects_foreign_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            export = Path(temporary)
            manifest = self.export(export, self.snapshots())
            selected, ignored = selected_attachments(export, manifest, self.test)
            self.assertEqual((len(selected), ignored), (12, 1))
            for mutate in (
                lambda m: m[0].update(testIdentifier='foreign'),
                lambda m: m[0]['attachments'][0].update(exportedFileName='../outside.json'),
                lambda m: m[0]['attachments'][1].update(exportedFileName='payload-01.json'),
                lambda m: m[0]['attachments'][0].update(suggestedHumanReadableName=PROTOCOL+'-02-after.json'),
                lambda m: m[0]['attachments'][0].update(suggestedHumanReadableName='nac352-dispatch-v2-01-before.json'),
            ):
                changed = copy.deepcopy(manifest)
                mutate(changed)
                with self.assertRaises(RuntimeError):
                    selected_attachments(export, changed, self.test)
            file = export / 'payload-01.json'
            file.unlink()
            file.symlink_to(export / 'payload-02.json')
            with self.assertRaises(RuntimeError):
                selected_attachments(export, manifest, self.test)

    def test_size_and_nonregular_bounds_precede_attachment_json_decode(self):
        with tempfile.TemporaryDirectory() as temporary:
            export = Path(temporary)
            manifest = self.export(export, self.snapshots())
            file = export / 'payload-01.json'
            file.write_bytes(b'x' * (MAX_SNAPSHOT + 1))
            with self.assertRaisesRegex(RuntimeError, 'bound before decoding'):
                selected_attachments(export, manifest, self.test)
            with self.assertRaisesRegex(RuntimeError, 'bound'):
                bounded_file(file, MAX_SNAPSHOT)
            with self.assertRaisesRegex(RuntimeError, 'before decoding'):
                json_data(b'x' * (MAX_SNAPSHOT + 1), MAX_SNAPSHOT)
            file.unlink()
            file.mkdir()
            with self.assertRaisesRegex(RuntimeError, 'nonregular'):
                selected_attachments(export, manifest, self.test)

    def test_host_collector_projects_only_actual_complete_or_partial_snapshots(self):
        for count in (1, 12):
            with self.subTest(count=count), tempfile.TemporaryDirectory() as temporary:
                raw = Path(temporary) / 'raw'
                raw.mkdir()
                def command(argv):
                    if argv[1:4] == ['get', 'test-results', 'tests']:
                        return json.dumps({'testNodes': [self.test]})
                    export = Path(argv[argv.index('--output-path') + 1])
                    self.export(export, self.snapshots()[:count])
                    return 'Exported'
                tool = AttachmentTool(raw, command)
                tool.path = '/selected-xcode/xcresulttool'  # Unit adapter only; no native result/build claim.
                result = tool.collect(raw / 'actual-result.xcresult', self.binding, self.operations)
                self.assertEqual(result['complete'], count == 12)
                self.assertEqual((raw / 'xctest-driver.json').exists(), count == 12)
                self.assertFalse(list(raw.rglob('*.png')))
                index = json.loads((raw / 'xctest-dispatch-observations/index.json').read_text())
                self.assertEqual(len(index['snapshots']), count)
                self.assertEqual(index['omitted_automatic_attachments'], 1)
                if count == 12:
                    with self.assertRaisesRegex(RuntimeError, 'stale'):
                        tool.collect(raw / 'actual-result.xcresult', self.binding, self.operations)

    def test_unknown_tool_schema_retains_actual_identity_and_stops_before_input(self):
        with tempfile.TemporaryDirectory() as temporary:
            raw = Path(temporary) / 'raw'
            raw.mkdir()
            developer = Path(temporary) / 'Selected.app/Contents/Developer'
            tool_path = developer / 'usr/bin/xcresulttool'
            tool_path.parent.mkdir(parents=True)
            tool_path.write_bytes(b'unit-only selected SDK tool identity')
            def command(argv):
                if argv == ['xcrun', '--find', 'xcresulttool']:
                    return str(tool_path)
                if argv[-1] == 'version':
                    return 'unit SDK version'
                return '{}'
            tool = AttachmentTool(raw, command)
            with patch.dict(os.environ, {'DEVELOPER_DIR': str(developer)}):
                with self.assertRaisesRegex(RuntimeError, 'schema lacks'):
                    tool.prepare()
            receipt = json.loads((raw / 'xctest-attachment-tool.json').read_text())
            self.assertEqual(receipt['identity']['path'], str(tool_path.resolve()))
            self.assertEqual(len(receipt['identity']['sha256']), 64)
            self.assertEqual(receipt['calls'][-1]['argv'][-1], '--schema')
            self.assertTrue(all(call['status'] == 0 for call in receipt['calls']))

    def test_rejected_payload_never_retained_but_earlier_valid_prefix_survives(self):
        for rejection in ('malformed-json', 'wrong-binding', 'rewritten-prefix'):
            with self.subTest(rejection=rejection), tempfile.TemporaryDirectory() as temporary:
                raw = Path(temporary) / 'raw'
                raw.mkdir()
                rejected = None
                def command(argv):
                    nonlocal rejected
                    if argv[1:4] == ['get', 'test-results', 'tests']:
                        return json.dumps({'testNodes': [self.test]})
                    export = Path(argv[argv.index('--output-path') + 1])
                    snapshots = self.snapshots()[:4]
                    if rejection == 'wrong-binding':
                        snapshots[2]['binding']['app']['terminal_id'] = 'FOREIGN-PAYLOAD-MUST-NOT-BE-RETAINED'
                    if rejection == 'rewritten-prefix':
                        snapshots[2]['rows'][0]['elapsed_ms'] = 9
                    self.export(export, snapshots)
                    file = export / 'payload-03.json'
                    if rejection == 'malformed-json':
                        file.write_bytes(b'{"FOREIGN-PAYLOAD-MUST-NOT-BE-RETAINED":')
                    rejected = file.read_bytes()
                    return 'Exported'
                tool = AttachmentTool(raw, command)
                tool.path = '/unit/xcresulttool'
                with self.assertRaises((RuntimeError, json.JSONDecodeError)):
                    tool.collect(raw / 'unit.xcresult', self.binding, self.operations)
                folder = raw / 'xctest-dispatch-observations'
                index = json.loads((folder / 'index.json').read_text())
                self.assertEqual(index['observed_snapshots'], 2)
                self.assertEqual(len(index['snapshots']), 2)
                self.assertFalse(index['complete'])
                self.assertFalse(index['rejected_input']['retained'])
                self.assertEqual(index['rejected_input']['sha256'], hashlib.sha256(rejected).hexdigest())
                self.assertEqual(index['rejected_input']['bytes'], len(rejected))
                self.assertFalse((raw / 'xctest-driver.json').exists())
                self.assertEqual(len(list(folder.glob(PROTOCOL + '-*.json'))), 2)
                for file in raw.rglob('*'):
                    if file.is_file():
                        self.assertNotIn(b'FOREIGN-PAYLOAD-MUST-NOT-BE-RETAINED', file.read_bytes())

    def launch_adapter(self, raw, *, fail=False):
        # Portable orchestration fixture, never an actual Xcode/native qualification.
        app = raw / 'NAC Development Preview Smoke.app/Contents/MacOS'
        app.mkdir(parents=True)
        (app / 'NACPreview').write_bytes(b'unit-only fixture input')
        row = {'service': 'kTCCServiceAccessibility', 'client': 'com.apple.dt.Xcode-Helper',
               'client_type': 0, 'auth_value': 2}
        policy = {'xcode_helper_accessibility_rows': [row], 'developer_status': 'Developer mode enabled.',
                  'automation_status': 'DOES NOT REQUIRE authentication.'}
        def run(argv, log, timeout):
            if 'build-for-testing' in argv:
                derived = Path(argv[argv.index('-derivedDataPath') + 1]) / 'Build/Products'
                derived.mkdir(parents=True)
                config = next(value.split('=', 1)[1] for value in argv if value.startswith('NAC_UI_FIXTURE='))
                target = {'IsUITestBundle': True, 'BlueprintName': 'NACNativeUITests',
                          'EnvironmentVariables': {'NAC_UI_FIXTURE': config}, 'TestBundlePath': 'Unit.xctest'}
                (derived / 'Unit.xctestrun').write_bytes(plistlib.dumps({'TestTargets': [target]}))
            else:
                config = json.loads((raw / 'xctest-fixture.json').read_text())
                evidence = Path(config['evidence'])
                evidence.write_text(json.dumps({'app_pid': 999999, 'engine_pid': 0,
                    'profile': str(raw / 'absent-owned-profile'), 'engine_reaped': not fail, 'profile_removed': not fail}))
                result = Path(argv[argv.index('-resultBundlePath') + 1])
                result.mkdir()
                (result / 'Unit').write_text('unit result fixture, not an actual xcresult')
                if fail:
                    raise RuntimeError('ORIGINAL TEST FAILURE')
        return policy, run

    def test_original_test_collector_and_cleanup_errors_are_retained_separately(self):
        with tempfile.TemporaryDirectory() as temporary:
            raw = Path(temporary)
            policy, run = self.launch_adapter(raw, fail=True)
            observer = Mock(path='/unit/xcresulttool')
            observer.collect.side_effect = RuntimeError('COLLECTOR FAILURE')
            cleanup = Mock(side_effect=RuntimeError('OWNED CLEANUP FAILURE'))
            binding = {key: self.binding[key] for key in
                       ('harness_sha', 'target_sha', 'operation_contract_sha256', 'test_identifier_url')}
            with patch('ci_xctest.observe_prerequisites', return_value=policy), \
                    patch('ci_xctest.AttachmentTool', return_value=observer):
                with self.assertRaisesRegex(RuntimeError, 'ORIGINAL TEST FAILURE'):
                    run_terminal(raw, run, lambda argv: '{}', operations=self.operations,
                                 observer_binding=binding, cleanup=cleanup)
            errors = json.loads((raw / 'xctest-outcomes.json').read_text())['errors']
            self.assertEqual(errors['test']['message'], 'ORIGINAL TEST FAILURE')
            self.assertEqual(errors['collector']['message'], 'COLLECTOR FAILURE')
            self.assertEqual(errors['cleanup']['message'], 'OWNED CLEANUP FAILURE')
            observer.collect.assert_called_once()
            relocation = json.loads((raw / 'xctest-relocation.json').read_text())
            self.assertTrue(relocation['bundle_retained_for_unresolved_cleanup'])
            shutil.rmtree(relocation['path'])  # Only this unit fixture; no app/process was launched.

    def test_default_ascii_needs_no_optional_attachment_tool_or_binding(self):
        with tempfile.TemporaryDirectory() as temporary:
            raw = Path(temporary)
            policy, run = self.launch_adapter(raw)
            with patch('ci_xctest.observe_prerequisites', return_value=policy), \
                    patch('ci_xctest.require_settled'), patch('ci_xctest.AttachmentTool') as optional:
                result = run_terminal(raw, run, lambda argv: '{}', validate=lambda record: {'unit': True})
            optional.assert_not_called()
            self.assertIsNone(result['observer'])
            self.assertTrue(all(error is None for error in json.loads((raw / 'xctest-outcomes.json').read_text())['errors'].values()))


if __name__ == '__main__':
    unittest.main()
