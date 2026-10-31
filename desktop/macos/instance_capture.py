"""T-owned, opt-in ALL343 capture records; no actor, notifications or UI control.

H uses the immutable manifest for its own bundle, scans forwarded requests and
writes matching PROVISIONAL release records. Only exported public image/metadata
pairs can later establish capture. This module never claims that acceptance.
"""
import ctypes
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import stat
import sys

LIMIT = 32 * 1024
ENVIRONMENT = 'NAC_INSTANCE_CAPTURE_DIRECTORY'
PREPARED_ENVIRONMENT = 'NAC_INSTANCE_PREPARED_SHA256'
NATIVE_INPUTS = ('main', 'PreviewApp', 'PreviewEngine', 'EngineProtocol', 'EngineFailure',
                 'CommandEnvironment', 'DesktopStartup', 'AppInstance', 'StoreConflict',
                 'InstanceSmoke', 'InstanceCaptureFiles', 'InstanceCaptureProtocol', 'InstanceCaptureNative')
SOURCE_INPUTS = tuple(n + '.swift' for n in NATIVE_INPUTS) + ('InstanceObservation.swift',
    'instance_smoke.py', 'instance_capture.py', 'instance_console.py', 'instance_contract.py',
    'preview.sh', 'BundleIdentity.sh', 'build_receipt.py')
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


def closed(value, fields):
    if not isinstance(value, dict) or set(value) != set(fields):
        raise ValueError('Prepared fixture fields differ')
    return value


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate artifact JSON field')
        result[key] = value
    return result


def file_identity(info):
    return {key: str(value) for key, value in zip(('device', 'inode', 'mode', 'size', 'mtime_ns'),
            (info.st_dev, info.st_ino, stat.S_IMODE(info.st_mode), info.st_size, info.st_mtime_ns))}


def artifact_close(primary, *fds):
    """Close every acquired artifact descriptor, retaining the operation error."""
    first = None
    for fd in fds:
        if fd is not None:
            try:
                os.close(fd)
            except BaseException as error:
                if first is None:
                    first = error
                if primary is not None or error is not first:
                    preparation_error(primary or first, None, error, 'artifact-descriptor')
    if primary is None and first is not None:
        raise first


def artifact_open(path, directory=False):
    """Ordinary artifact modes/format, separate from private canonical Directory."""
    path = Path(path)
    if not path.is_absolute() or path != path.resolve():
        raise ValueError('Artifact path is not canonical')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    primary = None
    new = None
    try:
        for index, part in enumerate(path.parts[1:]):
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC
            if directory or index < len(path.parts) - 2:
                flags |= os.O_DIRECTORY
            new = os.open(part, flags, dir_fd=fd)
            previous, fd, new = fd, new, None
            artifact_close(None, previous)
        info = os.fstat(fd)
        if (info.st_uid != os.geteuid() or info.st_mode & 0o022
                or not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
                or (not directory and info.st_nlink != 1)
                or (info.st_dev, info.st_ino) != (path.lstat().st_dev, path.lstat().st_ino)):
            raise ValueError('Artifact is foreign, writable, replaced or not regular')
        result, fd = fd, None
        return result
    except BaseException as error:
        primary = error
        raise
    finally:
        artifact_close(primary, new, fd)


def artifact_file(fd, parent=None, name=None, output=None, metadata=False):
    before = os.fstat(fd)
    if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
            or before.st_uid != os.geteuid() or before.st_mode & 0o022
            or before.st_size <= 0 or (metadata and before.st_size > LIMIT)):
        raise ValueError('Invalid artifact file or metadata bound')
    remaining, digest, data = before.st_size, hashlib.sha256(), bytearray()
    while remaining:
        chunk = os.read(fd, min(65536, remaining))
        if not chunk:
            raise ValueError('Artifact truncated during read')
        remaining -= len(chunk)
        digest.update(chunk)
        if metadata:
            data.extend(chunk)
        if output is not None:
            offset = 0
            while offset < len(chunk):
                count = os.write(output, chunk[offset:])
                if count <= 0:
                    raise OSError('Artifact copy failed')
                offset += count
    if os.read(fd, 1) or file_identity(before) != file_identity(os.fstat(fd)):
        raise ValueError('Artifact changed during read')
    if parent is not None and file_identity(before) != file_identity(os.stat(name, dir_fd=parent, follow_symlinks=False)):
        raise ValueError('Artifact file replaced during read')
    return dict(identity=file_identity(before), sha256=digest.hexdigest()), bytes(data)


def artifact_record(path, plist=False):
    fd = artifact_open(path)
    primary = None
    try:
        record, raw = artifact_file(fd, metadata=True)
        value = plistlib.loads(raw) if plist else json.loads(raw, object_pairs_hook=unique_object,
                            parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite artifact JSON')))
        if not isinstance(value, dict):
            raise ValueError('Artifact metadata must be an object')
        if record['identity'] != file_identity(Path(path).lstat()):
            raise ValueError('Artifact metadata replaced')
        return value, record
    except BaseException as error:
        primary = error
        raise
    finally:
        artifact_close(primary, fd)


def artifact_tree(path, destination=None):
    """Finite bundle inventory/copy using only retained no-follow descriptors."""
    fd = artifact_open(path, directory=True)
    target = None
    entries = {}
    def walk(source, copied, prefix):
        before = os.fstat(source)
        names = sorted(os.listdir(source))
        for name in names:
            if len(entries) >= 64 or name in ('.', '..') or '/' in name:
                raise ValueError('Artifact inventory bound/name')
            relative = prefix + name
            info = os.stat(name, dir_fd=source, follow_symlinks=False)
            if info.st_uid != os.geteuid() or info.st_mode & 0o022:
                raise ValueError('Foreign/writable artifact entry')
            is_dir = stat.S_ISDIR(info.st_mode)
            if not is_dir and not stat.S_ISREG(info.st_mode):
                raise ValueError('Artifact symlink/special entry')
            child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC
                            | (os.O_DIRECTORY if is_dir else 0), dir_fd=source)
            output = None
            primary = None
            try:
                if file_identity(info) != file_identity(os.fstat(child)):
                    raise ValueError('Artifact entry replaced')
                if copied is not None:
                    if is_dir:
                        os.mkdir(name, stat.S_IMODE(info.st_mode), dir_fd=copied)
                        output = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=copied)
                    else:
                        output = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                                         stat.S_IMODE(info.st_mode), dir_fd=copied)
                if is_dir:
                    entries[relative] = dict(kind='directory', identity=file_identity(info))
                    walk(child, output, relative + '/')
                else:
                    record, _ = artifact_file(child, source, name, output)
                    entries[relative] = dict(kind='file', **record)
                if file_identity(info) != file_identity(os.stat(name, dir_fd=source, follow_symlinks=False)):
                    raise ValueError('Artifact entry changed')
            except BaseException as error:
                primary = error
                raise
            finally:
                artifact_close(primary, output, child)
        if names != sorted(os.listdir(source)) or file_identity(before) != file_identity(os.fstat(source)):
            raise ValueError('Artifact directory changed')
    primary = None
    try:
        if destination is not None:
            target = artifact_open(destination, directory=True)
        identity = file_identity(os.fstat(fd))
        walk(fd, target, '')
        if identity != file_identity(Path(path).lstat()):
            raise ValueError('Artifact root replaced')
        return dict(root=identity, entries=entries)
    except BaseException as error:
        primary = error
        raise
    finally:
        artifact_close(primary, target, fd)


def source_snapshot():
    result = {}
    for name in SOURCE_INPUTS:
        fd = artifact_open(Path(__file__).resolve().parent / name)
        primary = None
        try:
            result[name] = artifact_file(fd)[0]['sha256']
        except BaseException as error:
            primary = error
            raise
        finally:
            artifact_close(primary, fd)
    return result


def bundle_snapshot(path, track, target, sources):
    tree = artifact_tree(path)
    members = {'Contents/Info.plist', 'Contents/MacOS/NACPreview', 'Contents/Resources/nac-web',
               'Contents/Resources/engine-identity.json', 'Contents/Resources/build-receipt.json'}
    if (set(tree['entries']) != members | {'Contents', 'Contents/MacOS', 'Contents/Resources'}
            or Path(path).name != 'NAC Instance Smoke.app'):
        raise ValueError('Unexpected instance artifact inventory/layout')
    identity, identity_file = artifact_record(path / 'Contents/Resources/engine-identity.json')
    closed(identity, ('product_version', 'build_id', 'source_revision', 'track'))
    plist, plist_file = artifact_record(path / 'Contents/Info.plist', plist=True)
    receipt, receipt_file = artifact_record(path / 'Contents/Resources/build-receipt.json')
    closed(receipt, ('version', 'phase', 'mode', 'normal_startup', 'smoke_instrumentation',
        'instance_smoke_instrumentation', 'bundle_identifier', 'bundle_name', 'source_head', 'source_dirty',
        'compiler_flags', 'native_source_files', 'build_support_files', 'engine_identity', 'engine_sha256',
        'info_plist_sha256', 'sdk_version', 'os_qualification', 'preview_definitions_excluded', 'native_sha256'))
    identifier = ('ai.arcee.nac.dev' if track == 'dev' else 'ai.arcee.nac') + '.instance-smoke'
    expected_native = {'desktop/macos/' + name + '.swift': sources[name + '.swift'] for name in NATIVE_INPUTS}
    native = tree['entries']['Contents/MacOS/NACPreview']['sha256']
    engine = tree['entries']['Contents/Resources/nac-web']['sha256']
    if (any(not isinstance(v, str) or not v for v in identity.values()) or identity['track'] != track
            or identity['source_revision'] != target or plist.get('CFBundleIdentifier') != identifier
            or type(receipt.get('version')) is not int or receipt['version'] != 1
            or receipt.get('source_head') != target or receipt.get('source_dirty') is not False
            or receipt.get('mode') != 'instance-build' or receipt.get('phase') != 'unsigned-build'
            or any(receipt.get(k) is not True for k in ('normal_startup', 'smoke_instrumentation',
                                                       'instance_smoke_instrumentation', 'preview_definitions_excluded'))
            or receipt.get('engine_identity') != identity or receipt.get('native_source_files') != expected_native
            or receipt.get('build_support_files') != {'desktop/macos/' + name: sources[name] for name in
                                                      ('preview.sh', 'BundleIdentity.sh', 'build_receipt.py')}
            or receipt.get('bundle_identifier') != identifier
            or receipt.get('native_sha256') != native or receipt.get('engine_sha256') != engine
            or receipt.get('info_plist_sha256') != plist_file['sha256']):
        raise ValueError('Instance artifact source/track/build binding differs')
    for name, record in [('Contents/Info.plist', plist_file),
                         ('Contents/Resources/engine-identity.json', identity_file),
                         ('Contents/Resources/build-receipt.json', receipt_file)]:
        if tree['entries'][name] != dict(kind='file', **record):
            raise ValueError('Artifact metadata changed during validation')
    if tree != artifact_tree(path):
        raise ValueError('Instance artifact changed during validation')
    return dict(path=str(path), tree=tree, summary=dict(path=str(path), identity=identity,
                bundle_id=identifier, native_sha256=native, engine_sha256=engine))


def observer_snapshot(path):
    fd = artifact_open(path)
    primary = None
    try:
        record = artifact_file(fd)[0]
        if record['identity'] != file_identity(Path(path).lstat()):
            raise ValueError('Observer replaced during read')
        return dict(path=str(path), **record)
    except BaseException as error:
        primary = error
        raise
    finally:
        artifact_close(primary, fd)


def directory_identity(path):
    with prepared_directory(path) as files:
        return file_identity(os.fstat(files.fd))


@contextmanager
def prepared_directory(path):
    """Keep Directory admission unchanged; prepared owners preserve close errors."""
    files, primary = Directory(path), None
    try:
        yield files
    except BaseException as error:
        primary = error
        raise
    finally:
        fd, files.fd = files.fd, None
        artifact_close(primary, fd)


def content_inventory(tree):
    return {name: dict(kind=entry['kind'], mode=entry['identity']['mode'],
                      sha256=entry.get('sha256')) for name, entry in tree['entries'].items()}


def preparation_error(error, status, secondary=None, owner='prepared-failure-record'):
    if status is not None:
        error.instance_preparation_status = status
    if secondary is not None:
        raw = str(secondary).encode('utf-8', errors='replace')
        records = getattr(error, 'instance_cleanup_errors', [])
        error.instance_cleanup_errors = (records + [dict(owner=owner,
            type=type(secondary).__name__, message=str(secondary)[:512], message_bytes=len(raw),
            message_sha256=sha(raw))])[:32]
        error.instance_cleanup_error_count = getattr(error, 'instance_cleanup_error_count', len(records)) + 1


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

    def _current_manifest(self, files):
        current, raw = files.read('manifest.json')
        if sha(raw) != self.digest or encoded(current) != encoded(self.manifest):
            raise ValueError('Preparation manifest changed')

    def prepare_fixture(self, app, stable, destination, observer):
        """Filesystem only. Caller has already verified its exact clean H/T sources.

        Failure quarantines partial files; never runs or signals anything. The
        manifest/source strings are not authority without actual file validation.
        """
        destination, app, stable, observer = map(Path, (destination, app, stable, observer))
        status = dict(schema='nac343-prepared-runtime-status-v1', stage='preparation',
                      registration='unproved', consumption='not_attempted', unknown_resources=True, retention_required=True)
        with prepared_directory(self.directory) as files:
            self._current_manifest(files)
            if files.read('admission.json', optional=True) is not None:
                raise ValueError('Runtime admission already consumed')
            nonce = secrets.token_hex(16)
            claim = dict(schema='nac343-preparation-admission-v1', run_nonce=self.manifest['run_nonce'],
                         preparation_nonce=nonce, manifest_sha256=self.digest, destination=str(destination))
            files.write('preparation-admission.json', claim)
            try:
                if (any(not p.is_absolute() or p != p.resolve() for p in (destination, app, stable, observer))
                        or destination == self.directory or self.directory.is_relative_to(destination)
                        or any(p.is_relative_to(destination) or destination.is_relative_to(p) for p in (app, stable))
                        or observer.is_relative_to(destination)):
                    raise ValueError('Prepared destination must be fresh, canonical and separate')
                # Parent descriptor precedes creation; no arbitrary existing root
                # can be adopted. A failed/interrupted gap stays unproved/retained.
                with prepared_directory(destination.parent) as parent:
                    parent.check('destination-binding')
                    os.mkdir(destination.name, 0o700, dir_fd=parent.fd)
                root = destination / ('nac-instance-app-' + nonce)
                with prepared_directory(destination) as parent:
                    os.mkdir(root.name, 0o700, dir_fd=parent.fd)
                registered = dict(destination=dict(path=str(destination), identity=directory_identity(destination)),
                                  root=dict(path=str(root), identity=directory_identity(root)))
                files.write('preparation-resources.json', dict(schema='nac343-preparation-resources-v1',
                            **{k: claim[k] for k in ('run_nonce', 'preparation_nonce', 'manifest_sha256')}, **registered))
                status['registration'] = 'registered'
                status['unknown_resources'] = False
                sources = source_snapshot()
                apps = []
                for index, (track, original) in enumerate((('dev', app), ('stable', stable))):
                    source = bundle_snapshot(original, track, self.manifest['target_sha'], sources)
                    folder = root / ('Moved app with spaces ' + str(index))
                    with prepared_directory(root) as parent:
                        os.mkdir(folder.name, 0o700, dir_fd=parent.fd)
                    moved = folder / original.name
                    with prepared_directory(folder) as parent:
                        os.mkdir(moved.name, int(source['tree']['root']['mode']), dir_fd=parent.fd)
                    copied_source = artifact_tree(original, moved)
                    copied = bundle_snapshot(moved, track, self.manifest['target_sha'], sources)
                    if copied_source != source['tree'] or content_inventory(copied['tree']) != content_inventory(source['tree']):
                        raise ValueError('Copied artifact content differs')
                    apps.append(dict(track=track, source=source, moved=copied))
                # Directory mtimes are recorded after the final copy, not before.
                registered['root']['identity'] = directory_identity(root)
                registered['destination']['identity'] = directory_identity(destination)
                value = dict(schema='nac343-prepared-fixture-v1', **{k: claim[k] for k in
                    ('run_nonce', 'preparation_nonce', 'manifest_sha256')}, target_sha=self.manifest['target_sha'],
                    harness_sha=self.manifest['harness_sha'], state='prepared-files-only', source_files=sources,
                    observer=observer_snapshot(observer), apps=apps, **registered)
                self._current_manifest(files)
                files.write('prepared-fixture.json', value)
                return dict(receipt=value, sha256=sha(encoded(value)))
            except BaseException as error:
                preparation_error(error, status)
                try:
                    files.write('preparation-failure.json', status)
                except BaseException as secondary:
                    preparation_error(error, status, secondary)
                raise

    def consume_prepared(self, expected, app, stable, destination, observer):
        if not hex_value(expected, 64):
            raise ValueError('Prepared digest must be64lowercasehex')
        with prepared_directory(self.directory) as files:
            self._current_manifest(files)
            if files.read('preparation-failure.json', optional=True) is not None:
                raise ValueError('Preparation failed; no retry or fallback')
            claim, _ = files.read('preparation-admission.json')
            closed(claim, ('schema', 'run_nonce', 'preparation_nonce', 'manifest_sha256', 'destination'))
            value, raw = files.read('prepared-fixture.json')
            closed(value, ('schema', 'run_nonce', 'preparation_nonce', 'manifest_sha256', 'target_sha', 'harness_sha',
                           'state', 'source_files', 'observer', 'apps', 'destination', 'root'))
            registered, _ = files.read('preparation-resources.json')
            closed(registered, ('schema', 'run_nonce', 'preparation_nonce', 'manifest_sha256', 'destination', 'root'))
            nonce = claim['preparation_nonce']
            if (claim['schema'] != 'nac343-preparation-admission-v1' or not hex_value(nonce, 32)
                    or value['schema'] != 'nac343-prepared-fixture-v1' or sha(raw) != expected
                    or any(value[k] != claim[k] for k in ('run_nonce', 'preparation_nonce', 'manifest_sha256'))
                    or value['run_nonce'] != self.manifest['run_nonce'] or value['manifest_sha256'] != self.digest
                    or value['target_sha'] != self.manifest['target_sha'] or value['harness_sha'] != self.manifest['harness_sha']
                    or value['state'] != 'prepared-files-only' or claim['destination'] != str(destination)
                    or encoded(value['source_files']) != encoded(source_snapshot())
                    or registered['schema'] != 'nac343-preparation-resources-v1'
                    or any(registered[k] != claim[k] for k in ('run_nonce', 'preparation_nonce', 'manifest_sha256'))):
                raise ValueError('Prepared source/manifest/receipt binding differs')
            closed(value['destination'], ('path', 'identity')); closed(value['root'], ('path', 'identity'))
            for name in ('destination', 'root'):
                closed(registered[name], ('path', 'identity'))
                closed(registered[name]['identity'], ('device', 'inode', 'mode', 'size', 'mtime_ns'))
                if (registered[name]['path'] != value[name]['path'] or any(
                        registered[name]['identity'][k] != value[name]['identity'][k] for k in ('device', 'inode', 'mode'))
                        or any(not isinstance(v, str) or re.fullmatch('[0-9]+', v) is None
                               for v in registered[name]['identity'].values())):
                    raise ValueError('Prepared resource registration differs')
            root = Path(destination) / ('nac-instance-app-' + nonce)
            if (value['destination']['path'] != str(destination) or value['root']['path'] != str(root)
                    or directory_identity(destination) != value['destination']['identity']
                    or directory_identity(root) != value['root']['identity']
                    or encoded(value['observer']) != encoded(observer_snapshot(Path(observer)))
                    or not isinstance(value['apps'], list) or len(value['apps']) != 2):
                raise ValueError('Prepared destination/root/observer replaced')
            for index, (track, original) in enumerate((('dev', app), ('stable', stable))):
                row = closed(value['apps'][index], ('track', 'source', 'moved'))
                actual_source = bundle_snapshot(Path(original), track, self.manifest['target_sha'], value['source_files'])
                moved = root / ('Moved app with spaces ' + str(index)) / Path(original).name
                actual_moved = bundle_snapshot(moved, track, self.manifest['target_sha'], value['source_files'])
                if encoded(row) != encoded(dict(track=track, source=actual_source, moved=actual_moved)):
                    raise ValueError('Prepared app resource changed')
            self._current_manifest(files)
            files.write('preparation-consumption.json', dict(schema='nac343-preparation-consumption-v1',
                        run_nonce=value['run_nonce'], preparation_nonce=nonce, manifest_sha256=self.digest,
                        prepared_sha256=expected))
            self.admit()  # Both exclusive claims precede all product/SDK operations.
            return value

    def require_inline(self):
        with Directory(self.directory) as files:
            if files.read('preparation-admission.json', optional=True) is not None:
                raise ValueError('Prepared attempt requires exact consumption; no inline fallback')

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
