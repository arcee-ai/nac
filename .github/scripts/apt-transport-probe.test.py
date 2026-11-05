#!/usr/bin/env python3
"""Offline source-alignment controls; real APT/hash/signature controls run in probe."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).with_name('apt-transport-probe.py')
SPEC = importlib.util.spec_from_file_location('probe', SCRIPT)
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)

# Actual authenticated amd64v3 Packages fields retained by the local probe.
UTILS = '''Package: xfonts-utils
Version: 1:7.7+7build1
Architecture: amd64
Filename: pool/main/x/xfonts-utils/xfonts-utils_7.7+7build1_amd64v3.deb
Size: 97318
SHA256: 1615a3471599cc5a62d14e145183bad83939b17dc8561a8e2261d829e0551889
'''


class SourceAlignment(unittest.TestCase):
    def test_actual_hosted_variant_selected(self):
        row = probe.metadata(UTILS, 'xfonts-utils')
        self.assertEqual(row['Architecture'], 'amd64')
        self.assertTrue(row['Filename'].endswith('_amd64v3.deb'))

    def test_generic_amd64_pair_cannot_qualify(self):
        # This was the initial local pair's input error, preserved in evidence.
        with self.assertRaisesRegex(ValueError, 'filename variant'):
            probe.metadata(UTILS.replace('_amd64v3.deb', '_amd64.deb'), 'xfonts-utils')

    def test_control_architecture_cannot_be_inferred_from_filename(self):
        with self.assertRaisesRegex(ValueError, 'architecture'):
            probe.metadata(UTILS.replace('Architecture: amd64', 'Architecture: amd64v3'),
                           'xfonts-utils')

    def test_missing_or_ambiguous_exact_version_rejected(self):
        for text in (UTILS.replace('1:7.7+7build1', '1:7.7+7'), UTILS+'\n'+UTILS):
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, 'unavailable or ambiguous'):
                probe.metadata(text, 'xfonts-utils')

    def test_unauthenticated_metadata_rejected(self):
        with self.assertRaisesRegex(ValueError, 'archive hash'):
            probe.metadata(UTILS.replace('1615a347', 'notahash'), 'xfonts-utils')

    def test_cli_requires_official_immutable_image_before_docker(self):
        result = subprocess.run([sys.executable, str(SCRIPT), '--image', 'ubuntu:26.04',
                                 '--source', '0'*40, '--output', '/unused'],
                                capture_output=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn(b'immutable official Ubuntu digest', result.stderr)


if __name__ == '__main__':
    unittest.main()
