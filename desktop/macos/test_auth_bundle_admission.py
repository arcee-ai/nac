"""Producer negative fixtures; fake metadata never establishes app acceptance."""
import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile
import unittest


@unittest.skipUnless(platform.system() == 'Darwin' and platform.machine() == 'arm64', 'Apple Silicon builder contract')
class AuthBundleAdmissionTests(unittest.TestCase):
    def test_normal_modes_refuse_fixture_before_replacing_bundle_files(self):
        builder = Path(__file__).with_name('preview.sh').resolve()
        with tempfile.TemporaryDirectory(prefix='nac-auth-builder-negative-') as temporary:
            root = Path(temporary)
            engine = root / 'fake-engine'
            identity = {'product_version': 'test', 'build_id': 'native-auth-fixture-v1-negative', 'source_revision': 'fake', 'track': 'dev'}
            engine.write_text('#!/bin/sh\ncat <<\'IDENTITY\'\n' + json.dumps(identity) + '\nIDENTITY\n')
            engine.chmod(0o700)
            for mode, name in [('build', 'NAC Development Preview.app'), ('app-build', 'NAC.app'),
                               ('smoke-build', 'NAC Development Preview Smoke.app'),
                               ('startup-build', 'NAC Startup Smoke.app'), ('instance-build', 'NAC Instance Smoke.app')]:
                with self.subTest(mode=mode):
                    output = root / mode
                    resource = output / name / 'Contents/Resources'
                    resource.mkdir(parents=True)
                    (resource / 'nac-web').write_text('preserve exact existing artifact')
                    before = {str(path.relative_to(output)): path.read_bytes() for path in output.rglob('*') if path.is_file()}
                    environment = {**os.environ, 'NAC_MAC_SKIP_ENGINE_BUILD': '1', 'NAC_MAC_ENGINE': str(engine), 'NAC_MAC_OUTPUT': str(output)}
                    result = subprocess.run(['bash', str(builder), mode], env=environment, text=True, capture_output=True, timeout=10)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('reject the isolated auth-fixture engine', result.stderr)
                    after = {str(path.relative_to(output)): path.read_bytes() for path in output.rglob('*') if path.is_file()}
                    self.assertEqual(after, before)

    def test_auth_mode_refuses_an_ordinary_engine_before_creating_app(self):
        builder = Path(__file__).with_name('preview.sh').resolve()
        with tempfile.TemporaryDirectory(prefix='nac-auth-builder-negative-') as temporary:
            root = Path(temporary)
            engine = root / 'fake-engine'
            engine.write_text('#!/bin/sh\necho \'{"product_version":"test","build_id":"ordinary","source_revision":"fake","track":"dev"}\'\n')
            engine.chmod(0o700)
            result = subprocess.run(['bash', str(builder), 'auth-build'],
                env={**os.environ, 'NAC_MAC_SKIP_ENGINE_BUILD': '1', 'NAC_MAC_ENGINE': str(engine), 'NAC_MAC_OUTPUT': str(root / 'output')},
                text=True, capture_output=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('requires its exact dev fixture engine', result.stderr)
            self.assertFalse((root / 'output/NAC Auth Fixture.app').exists())
