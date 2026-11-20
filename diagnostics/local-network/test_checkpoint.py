import json
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
                return 'unknown'
            def request(*_):
                events.append('request')
                raise HTTPError('private', 404, 'private', {}, None)
            result = compare(cell, snapshot, Provider, request)
            self.assertEqual(events, {'idle': ['before', 'after'],
                                      'provider': ['before', 'provider', 'after', 'settle'],
                                      'loopback': ['before', 'provider', 'request', 'after', 'settle']}[cell])
            self.assertEqual(result['modal'], 'unknown')
            self.assertEqual(result['fixture_process_settlement'], 'unknown')
            self.assertNotIn('private', str(result))

    def test_operation_failure_still_stops_provider_and_leaves_after_unknown(self):
        def fail(*_):
            raise RuntimeError('private')
        result = compare('loopback', lambda stage: 'unknown', Provider, fail)
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
            self.assertEqual(parse_export(export), 'ocr_title_match')
            manifest.write_text('[{\"testIdentifier\":\"foreign\",\"testIdentifier\":\"' + TEST_ID + '\",\"attachments\":[' + json.dumps(entry) + ']}]')
            self.assertEqual(parse_export(export), 'unknown')
            group['attachments'].append(dict(entry)); save()
            self.assertEqual(parse_export(export), 'unknown')
            group['attachments'].pop(); group['testIdentifierURL'] = 'foreign'; save()
            self.assertEqual(parse_export(export), 'unknown')
            group['testIdentifierURL'] = TEST_URL; save()
            (export / 'payload.txt').unlink()
            (export / 'payload.txt').symlink_to(manifest)
            self.assertEqual(parse_export(export), 'unknown')

if __name__ == '__main__':
    unittest.main()
