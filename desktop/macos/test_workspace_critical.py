"""Pure fixture receipt controls. No launcher, native app, process or HTTP calls."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from workspace_critical import MAX_FILE, PHASES, write_critical_receipts


class CriticalReceiptTests(unittest.TestCase):
    def test_failed_predicates_typed_unknown_and_raw_canonical_are_preserved(self):
        canonical = {'metadata': {'session_id': 'fixture'}, 'messages': [
            {'role': 'system', 'content': 'synthetic offline System Ω'},
            {'role': 'user', 'content': 'WK_RICH'}, {'role': 'assistant', 'content': 'full Ω'}]}
        observation = {'ready': False, 'reason': 'fixture mismatch',
                       'canonical_snapshot': canonical,
                       'settled_predicates': {'owner': True, 'message_count_2': False},
                       'full_answer': 'full Ω', 'message_identity': {'message_count': 3, 'visible_index': 2},
                       'surfaces': [{'visible': True, 'within_frame': True, 'geometry': {'width': 100},
                                     'ancestors': [{'content': 'verbose'}]}]}
        digest = hashlib.sha256('full Ω'.encode()).hexdigest()
        record = {'passed': False, 'engine_reaped': True, 'launcher_exit_code': False,
                  'checks': {'goals': {'status': 'fail', 'blocked_by': 'approvals', 'executed': False}},
                  'paint_diagnostics': {'rich-chat.png': {'readiness': observation,
                      'settled_answer_sha256_before': digest, 'png_sha256': 'a' * 64}}}
        original = copy.deepcopy(record)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            png = root / 'original.png'; png.write_bytes(b'original fixture bytes')
            write_critical_receipts(root, 'workspace-direct', record, {'source_head': 's', 'runner_sha256': 'r'})
            episode = json.loads((root / 'workspace-direct-episode-critical.json').read_text())
            self.assertEqual(episode['cleanup']['engine_reaped']['value'], True)
            for field in ('profile_removed', 'launcher_exit_code'):
                self.assertEqual(episode['cleanup'][field]['type'], 'unknown')
                self.assertIsNone(episode['cleanup'][field]['value'])
            self.assertEqual(episode['checks']['goals'], original['checks']['goals'])
            receipt = json.loads((root / 'workspace-direct-rich-readiness-critical.json').read_text())
            self.assertFalse(receipt['observation']['settled_predicates']['message_count_2'])
            self.assertEqual(receipt['capture']['settled_answer_sha256_before'], digest)
            self.assertNotIn('ancestors', receipt['observation']['surfaces'][0])
            self.assertFalse(receipt['acceptance_overridden'])
            raw = json.loads((root / 'workspace-direct-rich-readiness-canonical-critical.json').read_text())
            self.assertEqual(raw['canonical_snapshot'], canonical)
            self.assertEqual(raw['source_identity']['source_head'], 's')
            missing = json.loads((root / 'workspace-direct-approval-readiness-critical.json').read_text())
            self.assertFalse(missing['observation_present'])
            self.assertEqual(png.read_bytes(), b'original fixture bytes')
            self.assertTrue(all(f.stat().st_size <= MAX_FILE for f in root.glob('*.json')))
            with self.assertRaises(FileExistsError):
                write_critical_receipts(root, 'workspace-direct', record, {})
        self.assertEqual(record, original)

    def test_oversize_is_valid_explicit_failure_without_byte_slicing_or_repair(self):
        record = {'paint_diagnostics': {'rich-chat.png': {'initial_readiness': {
            'canonical_snapshot': {'messages': [{'content': 'x' * MAX_FILE}]}}}}}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(RuntimeError, 'Complete essential receipt unavailable'):
                write_critical_receipts(root, 'workspace-direct', record, {})
            failed = json.loads((root / 'workspace-direct-rich-initial_readiness-canonical-critical.json').read_text())
            self.assertIs(failed['complete'], False)
            self.assertEqual(failed['result'], 'failed')
            self.assertGreater(failed['unretained_json_bytes'], MAX_FILE)
            self.assertEqual(len(failed['unretained_json_sha256']), 64)

    def test_missing_failed_early_episode_never_becomes_cleanup_or_observation_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_critical_receipts(root, 'workspace-direct', {}, {})
            for phase in PHASES:
                receipt = json.loads((root / f'workspace-direct-rich-{phase}-critical.json').read_text())
                self.assertFalse(receipt['observation_present'])
                self.assertEqual(receipt['observation'], {})
            episode = json.loads((root / 'workspace-direct-episode-critical.json').read_text())
            self.assertFalse(episode['passed_observation']['observed'])
            self.assertTrue(all(field['type'] == 'unknown' for field in episode['cleanup'].values()))
