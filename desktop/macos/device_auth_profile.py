"""External disposable-profile ownership for the marked fixture engine only."""
from contextlib import AbstractContextManager
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid

from external_auth_fixture import cleanup_note


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
        self.engine_identity = dict(engine_identity)
        self.pending_launch = False
        self.last_incarnation = None
        self.root = Path('/tmp').resolve() / ('nac-native-auth-fixture-' + str(self.run))
        self.root.mkdir(mode=0o700)
        self.root_inode = self.root.stat().st_ino
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
        except BaseException as primary:
            try:
                shutil.rmtree(self.root)
            except BaseException as error:
                cleanup_note(primary, 'Auth profile construction cleanup', error)
            raise

    def __enter__(self):
        return self

    def begin_launch(self):
        # Set before Popen: even a spawn exception cannot prove no actor exists.
        if self.pending_launch:
            raise RuntimeError('Previous auth actor custody is unresolved')
        self.pending_launch = True

    def finish_launch(self, incarnation):
        # Callers must first validate terminal facts and reap their original handle.
        if not self.pending_launch:
            raise RuntimeError('Auth launch has no pending owner')
        if incarnation == self.last_incarnation:
            raise AssertionError('Auth launch reused a retired incarnation')
        self.last_incarnation = incarnation
        self.pending_launch = False

    def __exit__(self, kind, primary, traceback):
        if primary is not None or self.pending_launch:
            notice = f'Auth custody unresolved; retained private profile {self.root}'
            if primary is not None:
                primary.add_note(notice)
                return
            raise RuntimeError(notice)
        try:
            if (self.root.is_symlink() or self.root.stat().st_ino != self.root_inode
                    or self.root.parent != Path('/tmp').resolve()
                    or self.root.name != 'nac-native-auth-fixture-' + str(self.run)):
                raise AssertionError('Refusing cleanup of an unowned auth profile')
            sentinel = self.root / '.native-auth-fixture-owner.json'
            if sentinel.is_symlink() or json.loads(sentinel.read_text()) != {
                    'version': 1, 'source_revision': self.engine_identity['source_revision'], 'run': str(self.run)}:
                raise AssertionError('Refusing cleanup of a changed auth profile owner')
            shutil.rmtree(self.root)
        except BaseException as error:
            error.add_note(f'Auth profile removal unproven; retained root {self.root}')
            raise
