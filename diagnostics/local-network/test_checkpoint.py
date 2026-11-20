import json
from contextlib import contextmanager
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError

from checkpoint import TEST_ID, TEST_URL, compare, parse_export


class Provider:
    def __init__(self):
        self.settled = False
    def start(self):
        events.append('provider')
        return 'private'
    def stop(self, require_complete):
        assert require_complete is False
        events.append('settle')
        self.settled = True


events = []


class Tests(unittest.TestCase):
    def setUp(self):
        events.clear()

    def test_before_operation_after_and_settlement_order(self):
        for cell in ('idle', 'provider', 'loopback'):
            events.clear()
            def snapshot(stage):
                events.append(stage)
                return ('ocr_title_match' if stage == 'positive' else 'unknown', 'ocr_complete')
            def request(*_):
                events.append('request')
                raise HTTPError('private', 404, 'private', {}, None)
            result = compare(cell, snapshot, Provider, request)
            self.assertEqual(events, {'idle': ['positive', 'before', 'after'],
                                      'provider': ['positive', 'before', 'provider', 'after', 'settle'],
                                      'loopback': ['positive', 'before', 'provider', 'request', 'after', 'settle']}[cell])
            self.assertEqual(result['modal'], 'unknown')
            self.assertEqual(result['fixture_process_settlement'], 'unknown')
            self.assertNotIn('private', str(result))

    def test_panel_requires_sheet_test_completion(self):
        def sample(stage):
            events.append(stage)
            return ('ocr_title_match' if stage == 'positive' else 'unknown', 'ocr_complete')
        result = compare('panel', sample, Provider, lambda *_: self.fail())
        self.assertEqual(events, ['positive', 'before', 'panel'])
        self.assertEqual(result['operation'], 'panel_sheet_observed')
        self.assertEqual(result['modal'], 'unknown')
        def failed(stage):
            return ('ocr_title_match', 'ocr_complete') if stage == 'positive' else ('unknown', 'test_failed')
        self.assertEqual(compare('panel', failed, Provider, lambda *_: None)['operation'], 'unavailable')

    def test_engine_context_settles_before_provider(self):
        @contextmanager
        def engine(base):
            self.assertEqual(base, 'private')
            events.append('engine_enter')
            try:
                yield
            finally:
                events.append('engine_exit')
        def sample(stage):
            events.append(stage)
            return ('ocr_title_match' if stage == 'positive' else 'unknown', 'ocr_complete')
        result = compare('engine', sample, Provider, lambda *_: self.fail(), engine)
        self.assertEqual(events, ['positive', 'before', 'provider', 'engine_enter', 'after', 'engine_exit', 'settle'])
        self.assertEqual(result['operation'], 'completed')
        self.assertEqual(result['fixture_process_settlement'], 'unknown')

    def test_positive_failure_stops_before_operations(self):
        result = compare('loopback', lambda _: ('unknown', 'test_failed'), Provider, lambda *_: self.fail())
        self.assertEqual(result['positive_coverage'], 'test_failed')
        self.assertEqual(result['operation'], 'not_started')
        self.assertEqual(events, [])
        def failed_snapshot(_):
            raise RuntimeError('private')
        failure = compare('provider', failed_snapshot, Provider, lambda *_: None)
        self.assertEqual(failure['positive_coverage'], 'test_unavailable')
        self.assertNotIn('private', str(failure))

    def test_operation_failure_still_stops_provider_and_leaves_after_unknown(self):
        def fail(*_):
            raise RuntimeError('private')
        result = compare('loopback', lambda stage: ('ocr_title_match' if stage == 'positive' else 'unknown', 'ocr_complete'), Provider, fail)
        self.assertEqual(result['operation'], 'unavailable')
        self.assertEqual(result['after_image'], 'unknown')
        self.assertEqual(events, ['provider', 'settle'])
        self.assertNotIn('private', str(result))

    def test_only_unique_bound_manifest_and_fixed_value_are_read(self):
        with tempfile.TemporaryDirectory() as root:
            export = Path(root)
            (export / 'payload.txt').write_text('ocr_title_match')
            entry = {'suggestedHumanReadableName': 'nac-local-network-checkpoint-v1',
                     'exportedFileName': 'payload.txt'}
            group = {'testIdentifier': TEST_ID, 'testIdentifierURL': TEST_URL, 'attachments': [entry]}
            manifest = export / 'manifest.json'
            def save():
                manifest.write_text(json.dumps([group]))
            save()
            self.assertEqual(parse_export(export), ('ocr_title_match', 'ocr_complete'))
            group['testIdentifier'] = 'CheckpointJourneys/testPositiveControl()'
            group['testIdentifierURL'] = TEST_URL.replace('testSnapshot', 'testPositiveControl')
            save()
            self.assertEqual(parse_export(export, positive=True), ('ocr_title_match', 'ocr_complete'))
            self.assertEqual(parse_export(export), ('unknown', 'attachment_invalid'))
            group['testIdentifier'] = 'CheckpointJourneys/testFolderControl()'
            group['testIdentifierURL'] = TEST_URL.replace('testSnapshot', 'testFolderControl')
            save()
            self.assertEqual(parse_export(export, folder=True), ('ocr_title_match', 'ocr_complete'))
            self.assertEqual(parse_export(export), ('unknown', 'attachment_invalid'))
            group['testIdentifier'] = TEST_ID; group['testIdentifierURL'] = TEST_URL
            save()
            (export / 'payload.txt').write_text('unknown')
            self.assertEqual(parse_export(export), ('unknown', 'ocr_complete'))
            (export / 'payload.txt').write_text('ocr_title_match')
            manifest.write_text('[{\"testIdentifier\":\"foreign\",\"testIdentifier\":\"' + TEST_ID + '\",\"attachments\":[' + json.dumps(entry) + ']}]')
            self.assertEqual(parse_export(export), ('unknown', 'attachment_invalid'))
            group['attachments'].append(dict(entry)); save()
            self.assertEqual(parse_export(export), ('unknown', 'attachment_invalid'))
            group['attachments'].pop(); group['testIdentifierURL'] = 'foreign'; save()
            self.assertEqual(parse_export(export), ('unknown', 'attachment_invalid'))
            group['testIdentifierURL'] = TEST_URL; save()
            (export / 'payload.txt').unlink()
            (export / 'payload.txt').symlink_to(manifest)
            self.assertEqual(parse_export(export), ('unknown', 'attachment_invalid'))

if __name__ == '__main__':
    unittest.main()
