"""External disposable-profile ownership for the marked fixture engine only."""
from contextlib import AbstractContextManager
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid


PREFIX = 'native-auth-fixture-v1-'


def identity(binary):
    value = json.loads(subprocess.check_output([str(binary), '__desktop-identity'], text=True))
    if set(value) != {'product_version', 'build_id', 'source_revision', 'track'}:
        raise AssertionError('Fixture engine changed the strict v1 identity')
    if value['track'] != 'dev' or not value['build_id'].startswith(PREFIX):
        raise AssertionError('Expected the explicitly marked dev fixture engine')
    return value


class DeviceProfile(AbstractContextManager):
    def __init__(self, engine_identity, service_origin):
        if engine_identity['track'] != 'dev' or not engine_identity['build_id'].startswith(PREFIX):
            raise AssertionError('Ordinary engine cannot own a native auth fixture profile')
        self.run = uuid.uuid4()
        self.root = Path('/tmp').resolve() / ('nac-native-auth-fixture-' + str(self.run))
        self.root.mkdir(mode=0o700)
        try:
            for name in ('home', 'nac-home', 'xdg', 'workspace'):
                (self.root / name).mkdir(mode=0o700)
            sentinel = self.root / '.native-auth-fixture-owner.json'
            descriptor = os.open(sentinel, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, 'w') as file:
                json.dump({'version': 1, 'source_revision': engine_identity['source_revision'], 'run': str(self.run)}, file)
            self.environment = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'en_US.UTF-8', 'TMPDIR': '/tmp',
                'HOME': str(self.root / 'home'), 'NAC_HOME': str(self.root / 'nac-home'),
                'XDG_CONFIG_HOME': str(self.root / 'xdg'), 'NAC_NATIVE_AUTH_FIXTURE_ROOT': str(self.root),
                'NAC_NATIVE_AUTH_FIXTURE_ORIGIN': service_origin, 'MODELS_DEV_URL': service_origin + '/models-dev',
                'BROWSER': 'none', 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
                'NAC_TELEMETRY': 'disabled', 'NAC_ORCHESTRATION': '0'}
            self.workspace = self.root / 'workspace'
            self.store = self.root / 'store.db'
            subprocess.run(['/usr/bin/git', '-C', str(self.workspace), 'init', '--quiet', '--initial-branch=main'],
                           env=self.environment, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except BaseException:
            shutil.rmtree(self.root)
            raise

    def __enter__(self):
        return self

    def __exit__(self, *_):
        # Only this run's exact private root is removed; callers first retire
        # their source-qualified process/channel owner. No profile is adopted.
        if self.root.is_symlink() or self.root.parent != Path('/tmp').resolve() or self.root.name != 'nac-native-auth-fixture-' + str(self.run):
            raise AssertionError('Refusing cleanup of an unowned auth profile')
        shutil.rmtree(self.root)
