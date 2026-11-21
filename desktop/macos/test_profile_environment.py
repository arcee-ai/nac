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
                     'NAC_TELEMETRY'}


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

    def probe(self, smoke, arguments, *, ambient='fixture-canary'):
        env = {**self.environment, 'PREVIEW_CANARY': ambient,
               'NAC_HOME': '/DO-NOT-USE-PERSONAL-NAC', 'OPENAI_API_KEY': 'owned-fixture-not-a-credential'}
        argv = [str(self.binaries[smoke]), *arguments]
        result = run_owned(argv, env=env, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        record = json.loads(result.stdout)
        print('PROFILE_ENVIRONMENT ' + json.dumps({
            'argv': argv, 'ambient_names': ['PREVIEW_CANARY', 'NAC_HOME', 'OPENAI_API_KEY'],
            'observation': record}), flush=True)
        self.assertIs(record['compiled_smoke'], smoke)
        self.assertTrue(record['private_profile_paths'])
        self.assertTrue(record['store_within_profile'])
        self.assertIs(record['profile_removed'], True)
        self.assertFalse(Path(record['owned_profile_root']).exists())
        self.assertEqual(set(record['environment_names']), ENVIRONMENT_NAMES)

    def test_scenarios_keep_the_same_isolated_profile(self):
        for smoke in (False, True):
            for arguments in ([], ['--smoke-scenario'], ['--smoke-scenario', 'workspace-direct'],
                              ['--smoke-scenario', 'workspace-legacy'], ['--scenario', 'workspace-legacy']):
                with self.subTest(smoke=smoke, arguments=arguments):
                    self.probe(smoke, arguments)

    def test_ambient_values_never_enter_the_profile(self):
        for smoke in (False, True):
            self.probe(smoke, ['--smoke-scenario', 'workspace-legacy'], ambient='other-canary')


if __name__ == '__main__':
    unittest.main()
