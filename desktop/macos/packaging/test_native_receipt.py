"""Synthetic producer-output admission tests, separate from actual app evidence."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from native_receipt import (ENGINE, ENGINE_IDENTITY, FIXTURE_MARKERS, NORMAL_FLAGS,
                            NORMAL_SOURCES, RECEIPT, SHELL, expected_identity,
                            validate_native_receipt)
from provenance import digest, write_json


class NativeReceiptContract(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='nac native receipt ')
        self.root = Path(self.temporary.name)
        self.app = self.root / 'output/NAC.app'
        self.app.mkdir(parents=True)
        for name in ['Contents/Info.plist', SHELL, ENGINE, ENGINE_IDENTITY, RECEIPT]:
            path = self.app / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'synthetic normal output')
        for name in NORMAL_SOURCES:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('// synthetic compiler input\n')
        self.source = {'revision': 'a' * 40, 'product_version': '1.2.3'}
        self.engine_receipt = {'build': {'id': 'dev-' + 'a' * 40, 'track': 'dev'},
                               'engine': {'sha256': digest(self.app / ENGINE)}}
        self.identity = expected_identity(self.source, self.engine_receipt['build'])
        write_json(self.app / ENGINE_IDENTITY, self.identity)
        self.receipt = {'version': 1, 'phase': 'unsigned-build', 'mode': 'app-build',
                        'normal_startup': True, 'smoke_instrumentation': False, 'source_dirty': False,
                        'preview_definitions_excluded': True, 'source_head': self.source['revision'],
                        'compiler_flags': NORMAL_FLAGS.copy(),
                        'native_source_files': {name: digest(self.root / name) for name in NORMAL_SOURCES},
                        'engine_identity': self.identity, 'fixture_markers_absent': FIXTURE_MARKERS.copy(),
                        'sdk_version': 'synthetic', 'engine_sha256': digest(self.app / ENGINE),
                        'native_sha256': digest(self.app / SHELL),
                        'info_plist_sha256': digest(self.app / 'Contents/Info.plist')}

    def tearDown(self):
        self.temporary.cleanup()

    def validate(self, receipt=None, identity=None):
        write_json(self.app / RECEIPT, self.receipt if receipt is None else receipt)
        return validate_native_receipt(self.app, self.source, self.engine_receipt,
                                       self.identity if identity is None else identity, self.root)

    def test_exact_nominated_source_and_unsigned_output_are_admitted_without_qualification(self):
        result = self.validate()
        self.assertEqual(result, self.receipt)
        self.assertNotIn('consumer_ready', result)
        self.assertNotIn('notarized', result)

    def test_dirty_preview_smoke_wrong_mode_and_missing_proof_fail(self):
        for key, value in [('mode', 'build'), ('mode', 'startup-build'), ('source_dirty', True),
                           ('normal_startup', False), ('smoke_instrumentation', True),
                           ('preview_definitions_excluded', False), ('phase', 'signed'), ('version', 2)]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.validate({**self.receipt, key: value})
        missing = copy.deepcopy(self.receipt)
        del missing['source_dirty']
        with self.assertRaises(ValueError):
            self.validate(missing)

    def test_receipt_flags_cannot_hide_smoke_macro_behind_false_boolean(self):
        for flags in [NORMAL_FLAGS + ['-D', 'PREVIEW_SMOKE'], NORMAL_FLAGS + ['-D', 'CGINPUT'],
                      [x for x in NORMAL_FLAGS if x != 'LOCAL_APP']]:
            with self.assertRaisesRegex(ValueError, 'compiler flags'):
                self.validate({**self.receipt, 'compiler_flags': flags})

    def test_preview_or_unknown_source_cannot_be_admitted_by_normal_label(self):
        for name in ['desktop/macos/FixtureProvider.swift', 'desktop/macos/PreviewProfile.swift',
                     'desktop/macos/StartupSmoke.swift', '../external.swift']:
            sources = {**self.receipt['native_source_files'], name: 'b' * 64}
            with self.assertRaisesRegex(ValueError, 'source list'):
                self.validate({**self.receipt, 'native_source_files': sources})

    def test_hash_binds_actual_compiler_inputs(self):
        name = sorted(NORMAL_SOURCES)[0]
        (self.root / name).write_text('// changed source\n')
        with self.assertRaisesRegex(ValueError, 'source hash'):
            self.validate()

    def test_revision_full_identity_and_track_are_bound_at_all_three_interfaces(self):
        with self.assertRaisesRegex(ValueError, 'different source'):
            self.validate({**self.receipt, 'source_head': 'b' * 40})
        for key in ['source_revision', 'build_id', 'track', 'product_version']:
            changed = {**self.identity, key: 'different'}
            with self.assertRaisesRegex(ValueError, 'engine identity'):
                self.validate(identity=changed)
            with self.assertRaisesRegex(ValueError, 'engine identity'):
                self.validate({**self.receipt, 'engine_identity': changed})
        write_json(self.app / ENGINE_IDENTITY, {**self.identity, 'track': 'stable'})
        with self.assertRaisesRegex(ValueError, 'engine identity'):
            self.validate()

    def test_actual_unsigned_bytes_must_match_all_recorded_digests(self):
        for key in ['engine_sha256', 'native_sha256', 'info_plist_sha256']:
            with self.assertRaisesRegex(ValueError, 'digest'):
                self.validate({**self.receipt, key: 'b' * 64})
        (self.app / ENGINE).write_bytes(b'other private engine')
        with self.assertRaisesRegex(ValueError, 'different private engine'):
            self.validate()

    def test_actual_binary_markers_are_checked_even_with_matching_claimed_hash(self):
        for marker in FIXTURE_MARKERS:
            (self.app / SHELL).write_bytes(b'other code ' + marker.encode())
            receipt = {**self.receipt, 'native_sha256': digest(self.app / SHELL)}
            with self.assertRaisesRegex(ValueError, 'preview marker'):
                self.validate(receipt)
        with self.assertRaisesRegex(ValueError, 'fixture-exclusion proof'):
            self.validate({**self.receipt, 'native_sha256': digest(self.app / SHELL),
                           'fixture_markers_absent': []})

    def test_extra_resource_or_symlink_cannot_smuggle_fixture_content(self):
        extra = self.app / 'Contents/Resources/fixture-key.json'
        extra.write_text('synthetic fixture')
        with self.assertRaisesRegex(ValueError, 'closed layout'):
            self.validate()
        extra.unlink()
        extra.symlink_to(self.app / ENGINE)
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            self.validate()


if __name__ == '__main__':
    unittest.main()
