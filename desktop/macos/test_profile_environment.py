"""Actual Foundation/profile component tests; never launch NAC or AppKit."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest

DIRECTORY = Path(__file__).resolve().parent
PROFILE = DIRECTORY / 'PreviewProfile.swift'
PROBE = DIRECTORY / 'test-fixtures/ProfileEnvironmentMain.swift'
ENVIRONMENT_NAMES = {'HOME', 'NAC_HOME', 'XDG_CONFIG_HOME', 'TMPDIR', 'PATH', 'LANG',
                     'BROWSER', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL',
                     'NAC_TELEMETRY', 'NAC_ORCHESTRATION'}


def run_owned(argv, *, env, timeout):
    """Bound only our helper/compiler group, including any owned Git child."""
    process = subprocess.Popen(argv, env=env, text=True, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, start_new_session=True)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        stdout, stderr = process.communicate()
        raise RuntimeError(f'Owned component timed out: {argv!r}\n{stdout}\n{stderr}')
    return subprocess.CompletedProcess(argv, process.returncode, stdout, stderr)


@unittest.skipUnless(sys.platform == 'darwin' and shutil.which('xcrun'),
                     'Actual Darwin Swift SDK required; not native acceptance')
class ProfileEnvironmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='nac-profile-env-component-')
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.binaries = {}
        cls.environment = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
        for smoke in (False, True):
            binary = Path(cls.temporary.name) / ('smoke' if smoke else 'ordinary')
            argv = ['xcrun', 'swiftc', '-swift-version', '5', '-target',
                    'arm64-apple-macosx14.0', '-O']
            if smoke:
                argv.extend(['-D', 'PREVIEW_SMOKE'])
            argv.extend([str(DIRECTORY / 'EngineProtocol.swift'), str(DIRECTORY / 'EngineFailure.swift'),
                         str(PROFILE), str(PROBE), '-o', str(binary)])
            result = run_owned(argv, env=cls.environment, timeout=60)
            record = {'argv': argv, 'exit_code': result.returncode,
                      'protocol_sha256': hashlib.sha256((DIRECTORY / 'EngineProtocol.swift').read_bytes()).hexdigest(),
                      'failure_sha256': hashlib.sha256((DIRECTORY / 'EngineFailure.swift').read_bytes()).hexdigest(),
                      'profile_sha256': hashlib.sha256(PROFILE.read_bytes()).hexdigest(),
                      'probe_sha256': hashlib.sha256(PROBE.read_bytes()).hexdigest(),
                      'stdout': result.stdout, 'stderr': result.stderr}
            if binary.exists():
                record['binary_sha256'] = hashlib.sha256(binary.read_bytes()).hexdigest()
            print('PROFILE_COMPILE ' + json.dumps(record), flush=True)
            if result.returncode:
                raise RuntimeError('Actual profile component compilation failed')
            cls.binaries[smoke] = binary

    def probe(self, smoke, arguments, enabled, *, ambient='1'):
        env = {**self.environment, 'NAC_ORCHESTRATION': ambient,
               'NAC_HOME': '/DO-NOT-USE-PERSONAL-NAC', 'OPENAI_API_KEY': 'owned-fixture-not-a-credential'}
        argv = [str(self.binaries[smoke]), *arguments]
        result = run_owned(argv, env=env, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        record = json.loads(result.stdout)
        print('PROFILE_ENVIRONMENT ' + json.dumps({
            'argv': argv, 'ambient_names': ['NAC_ORCHESTRATION', 'NAC_HOME', 'OPENAI_API_KEY'],
            'observation': record}), flush=True)
        self.assertIs(record['compiled_smoke'], smoke)
        self.assertTrue(record['valid_orchestration_value'])
        self.assertTrue(record['private_profile_paths'])
        self.assertTrue(record['store_within_profile'])
        self.assertIs(record['profile_removed'], True)
        self.assertFalse(Path(record['owned_profile_root']).exists())
        self.assertEqual(set(record['environment_names']), ENVIRONMENT_NAMES)
        self.assertIs(record['orchestration_enabled'], enabled)

    def test_smoke_legacy_enables_orchestration(self):
        self.probe(True, ['--smoke-scenario', 'workspace-legacy'], True)

    def test_ordinary_legacy_stays_disabled(self):
        self.probe(False, ['--smoke-scenario', 'workspace-legacy'], False)

    def test_no_scenario_stays_disabled(self):
        for smoke in (False, True):
            with self.subTest(smoke=smoke):
                self.probe(smoke, [], False)

    def test_direct_and_manual_stay_disabled(self):
        for smoke in (False, True):
            for scenario in ('workspace-direct', 'workspace-manual'):
                with self.subTest(smoke=smoke, scenario=scenario):
                    self.probe(smoke, ['--smoke-scenario', scenario], False)

    def test_missing_value_stays_disabled(self):
        for smoke in (False, True):
            with self.subTest(smoke=smoke):
                self.probe(smoke, ['--smoke-scenario'], False)

    def test_invalid_values_stay_disabled(self):
        for smoke in (False, True):
            for value in ('workspace-legacy-extra', 'WORKSPACE-LEGACY', 'unknown'):
                with self.subTest(smoke=smoke, value=value):
                    self.probe(smoke, ['--smoke-scenario', value], False)

    def test_unrelated_flag_does_not_enable_orchestration(self):
        for smoke in (False, True):
            with self.subTest(smoke=smoke):
                self.probe(smoke, ['--scenario', 'workspace-legacy'], False)

    def test_explicit_legacy_overrides_ambient_disabled_only_in_smoke(self):
        self.probe(True, ['--smoke-scenario', 'workspace-legacy'], True, ambient='0')
        self.probe(False, ['--smoke-scenario', 'workspace-legacy'], False, ambient='0')


if __name__ == '__main__':
    unittest.main()
