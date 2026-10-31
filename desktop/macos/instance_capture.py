"""T-owned, opt-in ALL343 capture records; no actor, notifications or UI control.

H uses the immutable manifest for its own bundle, scans forwarded requests and
writes matching PROVISIONAL release records. Only exported public image/metadata
pairs can later establish capture. This module never claims that acceptance.
"""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys

LIMIT = 32 * 1024
ENVIRONMENT = 'NAC_INSTANCE_CAPTURE_DIRECTORY'
STATE_FIELDS = {'root', 'store', 'bundle', 'track', 'app_pid', 'app_incarnation', 'app_launch_epoch',
                'window_number', 'engine_pid', 'window_frame', 'content_bounds', 'receipt_incarnation',
                'receipt_store', 'receipt_schema', 'origin', 'receipt_kind', 'receipt_version', 'engine_build',
                'engine_source', 'engine_version', 'endpoint', 'document_url', 'conflict_episode', 'reopen_count', 'loading'}
KEYS = ('simultaneous/workspace', 'simultaneous/reopened', 'cli/conflict', 'cli/retry-workspace',
        'symlink/conflict', 'symlink/retry-workspace', 'directory-symlink/conflict',
        'directory-symlink/retry-workspace', 'crash/conflict', 'crash/retry-workspace',
        'shutdown/conflict', 'shutdown/retry-workspace', 'app-crash/initial/workspace',
        'app-crash/replacement/workspace', 'app-crash/replacement/reopened',
        'coexist/dev/workspace', 'coexist/stable/workspace', 'coexist/stable/reopened', 'coexist/dev/reopened')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    data = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
    if not 0 < len(data) <= LIMIT:
        raise ValueError('Capture record exceeds32KiB')
    return data


def hex_value(value, length):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{%d}' % length, value) is not None


class Directory:
    """Retain only a private owned descriptor; deny symlinks, special files and replacement."""
    def __init__(self, path):
        self.path = Path(path)
        self.fd = None
        if not self.path.is_absolute() or str(self.path) != str(self.path.resolve()):
            raise ValueError('Capture directory must be canonical')
        fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        try:
            for part in self.path.parts[1:]:
                new = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
                os.close(fd)
                fd = new
            info = os.fstat(fd)
            if info.st_uid != os.geteuid() or info.st_mode & 0o077:
                raise ValueError('Capture directory must be private and owned')
            self.identity = info.st_dev, info.st_ino
            self.fd, fd = fd, None
        finally:
            if fd is not None:
                os.close(fd)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def check(self, name):
        if self.fd is None or not re.fullmatch('[a-zA-Z0-9_.-]{1,99}', name) or name in ('.', '..'):
            raise ValueError('Capture descriptor closed or invalid name')
        info = os.stat(self.path, follow_symlinks=False)
        if (self.path != self.path.resolve() or not stat.S_ISDIR(info.st_mode) or (info.st_dev, info.st_ino) != self.identity
                or info.st_uid != os.geteuid() or info.st_mode & 0o077):
            raise ValueError('Capture directory retired or replaced')

    def read(self, name, optional=False):
        self.check(name)
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=self.fd)
        except FileNotFoundError:
            if optional:
                return None
            raise
        try:
            info = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077
                    or info.st_nlink != 1 or not 0 < info.st_size <= LIMIT):
                raise ValueError('Capture record must be bounded, regular, private and owned')
            data = b''
            while len(data) <= LIMIT:
                chunk = os.read(fd, LIMIT + 1 - len(data))
                if not chunk:
                    break
                data += chunk
            after = os.fstat(fd)
            named = os.stat(name, dir_fd=self.fd, follow_symlinks=False)
            if (len(data) != info.st_size or after.st_mtime_ns != info.st_mtime_ns or after.st_size != info.st_size
                    or (named.st_dev, named.st_ino) != (info.st_dev, info.st_ino)):
                raise ValueError('Capture record changed while reading')
            value = json.loads(data)
            if encoded(value) != data:
                raise ValueError('Capture record must be canonical JSON without duplicate fields')
            return value, data
        finally:
            os.close(fd)

    def write(self, name, value):
        self.check(name)
        data = encoded(value)
        temporary = 'pending-' + secrets.token_hex(16) + '.json'
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                     0o600, dir_fd=self.fd)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            # Darwin RENAME_EXCL publishes a complete immutable record atomically,
            # refusing existing files/links. No overwrite or actor filesystem grant.
            rename = ctypes.CDLL(None, use_errno=True).renameatx_np
            rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
            rename.restype = ctypes.c_int
            if rename(self.fd, temporary.encode(), self.fd, name.encode(), 4) != 0:
                code = ctypes.get_errno()
                raise OSError(code, os.strerror(code))
        finally:
            try:
                os.unlink(temporary, dir_fd=self.fd)
            except FileNotFoundError:
                pass


def manifest_frames():
    return [dict(ordinal=index, key=key, track='stable' if key.startswith('coexist/stable/') else 'dev')
            for index, key in enumerate(KEYS, 1)]


def metadata_namespace(directory):
    if any(part.casefold() in ('evidence', 'workspace') for part in Path(directory).parts):
        raise ValueError('Capture metadata must stay outside generic PID cleanup directories')


def prepare(directory, target_sha, harness_sha):
    if not hex_value(target_sha, 40) or not hex_value(harness_sha, 40):
        raise ValueError('Capture sources must be exact revisions')
    directory = Path(directory)
    metadata_namespace(directory)
    if not directory.is_absolute() or directory.parent != directory.parent.resolve():
        raise ValueError('Capture parent must be canonical')
    # A fresh directory is mandatory. Never resume/rewrite another attempt.
    directory.mkdir(mode=0o700)
    value = dict(schema='nac343-capture-manifest-v1', run_nonce=secrets.token_hex(16),
                 target_sha=target_sha, harness_sha=harness_sha, frames=manifest_frames())
    with Directory(directory) as files:
        files.write('manifest.json', value)
    return value


class CaptureRun:
    def __init__(self, directory):
        metadata_namespace(directory)
        self.directory = Path(directory)
        with Directory(directory) as files:
            self.manifest, data = files.read('manifest.json')
        self.digest = sha(data)
        value = self.manifest
        if (set(value) != {'schema', 'run_nonce', 'target_sha', 'harness_sha', 'frames'}
                or value['schema'] != 'nac343-capture-manifest-v1' or not hex_value(value['run_nonce'], 32)
                or not hex_value(value['target_sha'], 40) or not hex_value(value['harness_sha'], 40)
                or encoded(value['frames']) != encoded(manifest_frames())):
            raise ValueError('Capture manifest is not the full fixed19-frame contract')

    @classmethod
    def optional(cls):
        value = os.environ.get(ENVIRONMENT)
        return cls(value) if value is not None else None

    def require_source(self, target_sha, scenarios):
        expected = ('simultaneous', 'cli', 'symlink', 'directory-symlink', 'crash', 'shutdown', 'app-crash', 'coexist')
        if target_sha != self.manifest['target_sha'] or tuple(scenarios) != expected:
            raise ValueError('Capture requires the exact source and all8 cases')

    def admit(self):
        with Directory(self.directory) as files:
            files.write('admission.json', dict(schema='nac343-capture-admission-v1',
                        run_nonce=self.manifest['run_nonce'], manifest_sha256=self.digest))

    def journey(self, output, bundle, root, store):
        parent = output.parent
        key = parent.name if parent.name in ('simultaneous', 'cli', 'symlink', 'directory-symlink', 'crash', 'shutdown') else parent.parent.name + '/' + parent.name
        frames = [dict(ordinal=f['ordinal'], key=f['key']) for f in self.manifest['frames'] if f['key'].rsplit('/', 1)[0] == key]
        if not frames:
            raise ValueError('Unknown capture journey')
        root, store, bundle = root.resolve(), store.resolve(), bundle.resolve()
        if not store.is_relative_to(root) or store == root:
            raise ValueError('Capture store escaped owned fixture')
        identity = json.loads((bundle / 'Contents/Resources/engine-identity.json').read_bytes())
        track = 'stable' if key == 'coexist/stable' else 'dev'
        if identity.get('track') != track:
            raise ValueError('Capture bundle track differs')
        context = dict(root=str(root), store=str(store), bundle=str(bundle), track=track, journey=key,
                       native_sha256=sha((bundle / 'Contents/MacOS/NACPreview').read_bytes()),
                       engine_sha256=sha((bundle / 'Contents/Resources/nac-web').read_bytes()))
        name = 'journey-' + key.replace('/', '-')
        # Open the root descriptor again before every creation, never mkdir through a link.
        with Directory(self.directory) as files:
            os.mkdir(name, 0o700, dir_fd=files.fd)
        path = self.directory / name
        config = dict(schema='nac343-capture-config-v1', run_nonce=self.manifest['run_nonce'],
                      manifest_sha256=self.digest, target_sha=self.manifest['target_sha'],
                      harness_sha=self.manifest['harness_sha'], context=context, frames=frames)
        with Directory(path) as files:
            files.write('configuration.json', config)
        return CaptureJourney(self, path, config, sha(encoded(config)))

    def final_receipt(self):
        for frame in self.manifest['frames']:
            key = frame['key'].rsplit('/', 1)[0]
            with Directory(self.directory / ('journey-' + key.replace('/', '-'))) as files:
                config, raw = files.read('configuration.json')
                CaptureJourney(self, files.path, config, sha(raw)).validate_fence(files, frame)
        return dict(schema='nac343-provisional-summary-v1', run_nonce=self.manifest['run_nonce'],
                    manifest_sha256=self.digest, provisional_releases=19, capture_verified=False,
                    final_public_pairs_required=19)

    def require_predecessor(self, ordinal):
        if ordinal == 1:
            return
        prior = self.manifest['frames'][ordinal - 2]
        key = prior['key'].rsplit('/', 1)[0]
        with Directory(self.directory / ('journey-' + key.replace('/', '-'))) as files:
            config, raw = files.read('configuration.json')
            if config.get('manifest_sha256') != self.digest:
                raise ValueError('Prior capture belongs to another manifest')
            CaptureJourney(self, files.path, config, sha(raw)).validate_fence(files, prior)


class CaptureJourney:
    def __init__(self, run, path, configuration, digest):
        self.run, self.path, self.configuration, self.digest = run, path, configuration, digest

    def arguments(self):
        return ['--instance-capture-directory', str(self.path), '--instance-capture-sha256', self.digest]

    def validate_request(self, files, frame):
        request, raw = files.read('request-%02d.json' % frame['ordinal'])
        expected = {'schema', 'run_nonce', 'request_nonce', 'ordinal', 'key', 'configuration_sha256', 'manifest_sha256', 'before'}
        state = request.get('before', {})
        context = self.configuration['context']
        if (set(request) != expected or request['schema'] != 'nac343-capture-request-v1'
                or request['run_nonce'] != self.run.manifest['run_nonce'] or not hex_value(request['request_nonce'], 32)
                or type(request['ordinal']) is not int or request['ordinal'] != frame['ordinal'] or request['key'] != frame['key']
                or request['configuration_sha256'] != self.digest or request['manifest_sha256'] != self.run.digest
                or not isinstance(state, dict) or set(state) != STATE_FIELDS or any(not isinstance(v, str) for v in state.values())
                or any(state.get(k) != context[k] for k in ('store', 'bundle', 'track', 'root'))):
            raise ValueError('Capture request binding differs')
        return request, sha(raw)

    def validate_fence(self, files, frame):
        request, digest = self.validate_request(files, frame)
        fence, _ = files.read('fence-%02d.json' % frame['ordinal'])
        expected = dict(schema='nac343-private-fence-v1', run_nonce=request['run_nonce'], request_nonce=request['request_nonce'],
                        ordinal=frame['ordinal'], key=frame['key'], configuration_sha256=self.digest, request_sha256=digest,
                        release='provisional', capture_verified=False, before=request['before'], after=request['before'])
        if encoded(fence) != encoded(expected):
            raise ValueError('Private before/after fence differs; capture remains unverified')

    def forward(self, before_forward=None):
        with Directory(self.path) as files, Directory(self.run.directory) as host:
            config, raw = files.read('configuration.json')
            if config != self.configuration or sha(raw) != self.digest:
                raise ValueError('Capture configuration changed')
            for frame in self.configuration['frames']:
                ordinal = frame['ordinal']
                if files.read('request-%02d.json' % ordinal, optional=True) is None:
                    continue
                request, digest = self.validate_request(files, frame)
                if files.read('retirement.json', optional=True) or files.read('retired-%02d.json' % ordinal, optional=True):
                    raise ValueError('Capture request retired')
                forwarded = dict(schema='nac343-forwarded-request-v1', run_nonce=request['run_nonce'],
                                 ordinal=ordinal, key=frame['key'], request_sha256=digest, configuration_sha256=self.digest,
                                 journey_directory=str(self.path), manifest_sha256=self.run.digest)
                name = 'forward-%02d.json' % ordinal
                existing = host.read(name, optional=True)
                if existing is None:
                    self.run.require_predecessor(ordinal)
                    if before_forward:
                        before_forward()
                    host.write(name, forwarded)
                elif existing[1] != encoded(forwarded):
                    raise ValueError('Capture forwarding replay or replacement')
                if files.read('fence-%02d.json' % ordinal, optional=True):
                    self.validate_fence(files, frame)

    def retire(self):
        with Directory(self.path) as files:
            if files.read('retirement.json', optional=True) is None:
                files.write('retirement.json', dict(schema='nac343-host-retirement-v1',
                            run_nonce=self.run.manifest['run_nonce'], configuration_sha256=self.digest))


if __name__ == '__main__':
    if len(sys.argv) != 5 or sys.argv[1] != 'prepare':
        raise SystemExit('usage: instance_capture.py prepare NEW_CANONICAL_DIRECTORY TARGET_SHA HARNESS_SHA')
    print(json.dumps(prepare(Path(sys.argv[2]), sys.argv[3], sys.argv[4]), sort_keys=True))
