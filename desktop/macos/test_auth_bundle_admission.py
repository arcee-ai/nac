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
    def test_cargo_child_metadata_is_scoped_to_the_selected_producer(self):
        builder = Path(__file__).with_name('preview.sh').resolve()
        # Exercise the actual producer block without compiling or emitting an app.
        source = builder.read_text()
        block = source.split('if [[ "${NAC_MAC_SKIP_ENGINE_BUILD:-0}" != 1 ]]; then\n', 1)[1].split('\nfi\nengine=', 1)[0]
        root = builder.parents[2]
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
        with tempfile.TemporaryDirectory(prefix='nac-auth-producer-env-') as temporary:
            cargo = Path(temporary) / 'cargo'
            cargo.write_text('#!/usr/bin/env python3\nimport json,os,sys\n'
                             'print(json.dumps({"args":sys.argv[1:],"env":{name:os.environ.get(name) for name in '
                             '["NAC_BUILD_ID","NAC_SOURCE_REVISION","NAC_BUILD_TRACK",'
                             '"NAC_NATIVE_AUTH_FIXTURE_ROOT","NAC_NATIVE_AUTH_FIXTURE_ORIGIN"]}}))\n')
            cargo.chmod(0o700)
            inherited = {**os.environ, 'PATH': temporary + os.pathsep + os.environ['PATH'],
                         'NAC_BUILD_ID': 'native-auth-fixture-v1-inherited', 'NAC_SOURCE_REVISION': 'forged-source',
                         'NAC_BUILD_TRACK': 'beta', 'NAC_NATIVE_AUTH_FIXTURE_ROOT': '/unused-fixture',
                         'NAC_NATIVE_AUTH_FIXTURE_ORIGIN': 'http://127.0.0.1:1'}
            for mode in ['app-build', 'auth-build', 'app-build']:
                result = subprocess.run(['/bin/bash', '-euc', 'mode=$1\n' + block, 'producer-control', mode],
                                        cwd=root, env=inherited, text=True, capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                observed = json.loads(result.stdout)
                fixture = mode == 'auth-build'
                self.assertEqual(observed['args'], ['build', '--locked', '-p', 'nac-server', '--bin', 'nac-web'] +
                                 (['--features', 'native-auth-fixture'] if fixture else []))
                self.assertEqual(observed['env']['NAC_BUILD_ID'], 'native-auth-fixture-v1-' + revision if fixture else None)
                self.assertEqual(observed['env']['NAC_BUILD_TRACK'], 'dev' if fixture else 'beta')
                for name in ['NAC_SOURCE_REVISION', 'NAC_NATIVE_AUTH_FIXTURE_ROOT', 'NAC_NATIVE_AUTH_FIXTURE_ORIGIN']:
                    self.assertIsNone(observed['env'][name])
            self.assertEqual(inherited['NAC_BUILD_ID'], 'native-auth-fixture-v1-inherited')
            self.assertEqual(inherited['NAC_SOURCE_REVISION'], 'forged-source')

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
                               ('startup-build', 'NAC Startup Smoke.app'), ('instance-build', 'NAC Instance Smoke.app'),
                               ('lifecycle-build', 'NAC Lifecycle Smoke.app')]:
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
