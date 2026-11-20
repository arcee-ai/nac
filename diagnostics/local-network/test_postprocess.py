import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from postprocess import P, Q, R, H, TEST, postprocess

PNG = b'\x89PNG\r\n\x1a\nsynthetic-private-image'
CONFIG = 'a' * 64


def encode(value):
    return json.dumps(value, sort_keys=True).encode()


def metadata(data):
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.case = self.root / 'startup-configuredLocal'
        self.attachments = self.case / 'attachments'
        self.attachments.mkdir(parents=True)
        self.owner = {'positive_process_settlement': True}
        self.write(self.case / 'owner-observation.json', self.owner)
        self.write(self.case / 'case.json', {'P': P, 'Q': Q, 'R': R, 'H': H, 'scenario': 'configuredLocal',
                                           'owner_observation': self.owner})
        row = {'schema': 'nac342-dispatch-v1', 'scenario': 'configuredLocal', 'configuration_sha256': CONFIG,
               'operation_index': 2, 'stage': 'before', 'operation': 'click:Choose Working Folder: private'}
        data = encode(row)
        self.filename = 'nac342-dispatch-v1-02-before.json'
        (self.attachments / self.filename).write_bytes(data)
        (self.attachments / 'nac342-failure-configuredLocal.png').write_bytes(PNG)
        self.index = {'P': P, 'Q': Q, 'H': H, 'scenario': 'configuredLocal', 'configuration_sha256': CONFIG,
                      'actual_test': {'nodeIdentifierURL': TEST, 'result': 'Failed'}, 'selection_errors': [],
                      'diagnostic_dispatch_order': 'sdk_inventory_not_execution',
                      'diagnostic_dispatches': [{'file': self.filename, **metadata(data)}],
                      'failure_image': metadata(PNG)}
        self.save()

    def write(self, path, value):
        path.write_bytes(encode(value))

    def save(self):
        self.write(self.attachments / 'index.json', self.index)

    def run_probe(self):
        return postprocess(self.root, lambda data: 'ocr_title_match' if data == PNG else 'unknown')

    def test_positive_evidence_is_closed_and_does_not_claim_input(self):
        self.assertEqual(self.run_probe(), {'image_observation': 'ocr_title_match', 'phase': 'folder_dispatch_before_observed',
                                            'process_settlement': 'positive_owner_proof', 'input_completion': 'unknown'})

    def test_bad_binding_and_ambiguous_inventory_fail_closed(self):
        for key, value in [('Q', 'wrong'), ('selection_errors', ['private']), ('actual_test', {'result': 'Passed'})]:
            original = self.index[key]
            self.index[key] = value
            self.save()
            result = self.run_probe()
            self.assertEqual((result['image_observation'], result['phase']), ('unknown', 'unknown'))
            self.index[key] = original
        self.save()

    def test_missing_or_changed_image_never_invokes_ocr(self):
        (self.attachments / 'nac342-failure-configuredLocal.png').write_bytes(PNG + b'changed')
        self.assertEqual(postprocess(self.root, lambda _: self.fail('unbound image'))['image_observation'], 'unknown')

    def test_bad_dispatch_and_false_settlement_remain_unknown(self):
        self.index['diagnostic_dispatches'].append(dict(self.index['diagnostic_dispatches'][0]))
        self.save()
        self.owner['positive_process_settlement'] = False
        self.write(self.case / 'owner-observation.json', self.owner)
        result = self.run_probe()
        self.assertEqual(result['phase'], 'unknown')
        self.assertEqual(result['process_settlement'], 'unknown')
        self.assertEqual(result['image_observation'], 'ocr_title_match')

    def test_symlinked_image_is_never_read(self):
        image = self.attachments / 'nac342-failure-configuredLocal.png'
        image.unlink()
        image.symlink_to(self.case / 'case.json')
        self.assertEqual(postprocess(self.root, lambda _: self.fail('symlink'))['image_observation'], 'unknown')

if __name__ == '__main__':
    unittest.main()
