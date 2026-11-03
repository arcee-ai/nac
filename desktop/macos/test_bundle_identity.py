import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile
import unittest


@unittest.skipUnless(platform.system() == 'Darwin', 'Uses the native macOS plist parser')
class BundleIdentityTests(unittest.TestCase):
    def invoke(self, path, kind='normal'):
        helper = Path(__file__).with_name('BundleIdentity.sh').resolve()
        return subprocess.run(['/bin/bash', str(helper), str(path), kind],
                              env={'PATH': '/usr/bin:/bin', 'NAC_BUILD_TRACK': 'inherited-value-must-not-select'},
                              capture_output=True, text=True, timeout=3)

    def test_tracks_and_fixture_identity_are_partitioned_without_ambient_selection(self):
        with tempfile.TemporaryDirectory(prefix='nac-bundle-identity-') as temporary:
            record = Path(temporary) / 'engine-identity.json'
            for track, identifier, name in [('stable', 'ai.arcee.nac', 'NAC'),
                                             ('beta', 'ai.arcee.nac.beta', 'NAC Beta'),
                                             ('dev', 'ai.arcee.nac.dev', 'NAC Development')]:
                record.write_text(json.dumps(dict(product_version='1.2.3', build_id='fixture',
                                                  source_revision='fixture', track=track)))
                result = self.invoke(record)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.splitlines(), [identifier, name])
                smoke = self.invoke(record, 'instance-smoke')
                self.assertEqual(smoke.returncode, 0, smoke.stderr)
                self.assertEqual(smoke.stdout.splitlines(), [identifier + '.instance-smoke', name + ' Instance Smoke'])

    def test_invalid_metadata_cannot_substitute_a_track_or_echo_peer_text(self):
        with tempfile.TemporaryDirectory(prefix='nac-bundle-identity-') as temporary:
            record = Path(temporary) / 'engine-identity.json'
            for payload in ['{bad-private-canary', '{}', '{"track":"private-canary"}',
                            '{"track":["dev"]}', 'x' * 16385]:
                record.write_text(payload)
                result = self.invoke(record)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, '')
                self.assertNotIn('private-canary', result.stderr)
            self.assertNotEqual(self.invoke(record, 'unknown').returncode, 0)
            record.unlink()
            self.assertNotEqual(self.invoke(record).returncode, 0)

    def test_selected_private_engine_identity(self):
        selected = os.environ.get('NAC_INSTANCE_TEST_ENGINE')
        if not selected:
            self.skipTest('Set NAC_INSTANCE_TEST_ENGINE to an exact private engine artifact')
        with tempfile.TemporaryDirectory(prefix='nac-bundle-identity-') as temporary:
            root = Path(temporary)
            identity = json.loads(subprocess.check_output([str(Path(selected).resolve()), '__desktop-identity'],
                                  env={'PATH': '/usr/bin:/bin', 'HOME': str(root)}, timeout=3))
            record = root / 'engine-identity.json'
            record.write_text(json.dumps(identity))
            result = self.invoke(record)
            self.assertEqual(result.returncode, 0, result.stderr)
            expected = {'dev': 'ai.arcee.nac.dev', 'beta': 'ai.arcee.nac.beta', 'stable': 'ai.arcee.nac'}
            self.assertEqual(result.stdout.splitlines()[0], expected[identity['track']])


if __name__ == '__main__':
    unittest.main()
