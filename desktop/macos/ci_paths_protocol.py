"""Finite ALL-347 app phase reader and receipt verifier; no input or discovery."""
import json
import os
from pathlib import Path
import re
import stat
import uuid

PRODUCT = '528b7986f1abbf7e47228d15a48c0492af2c0669'
HELPER = 'c72c1178ba99ca82f23e264c46fb21b809934782f77060781454c42f78920e21'
CASES = ('paths-xctest', 'paths-failure-xctest')
OPERATIONS = ('select-reload-create-reveal', 'pending-engine-failure')
ORDERS = (('ready', 'document-reloaded', 'folder-moved', 'folder-restored', 'reveal-observed'),
          ('ready', 'failure-panel-observed'))
FIELDS = {'version', 'name', 'sequence', 'run', 'source', 'app_pid', 'window', 'engine_pid',
          'operation', 'launch', 'view', 'document'}
MAX_JSON = 256 * 1024


def require(value, reason):
    if not value:
        raise RuntimeError('Path qualification: ' + reason)


def decode(data):
    require(len(data) <= MAX_JSON, 'JSON bound')
    def unique(pairs):
        require(len(pairs) == len(dict(pairs)), 'duplicate JSON key')
        return dict(pairs)
    return json.loads(data, object_pairs_hook=unique,
                      parse_constant=lambda _: require(False, 'nonfinite JSON'))


def read_record(path, parent):
    """No-follow pinned parent, stable fd generation; inode replacement is valid."""
    path, parent = Path(path), Path(parent)
    require(parent.is_absolute() and parent.resolve() == parent and path.parent == parent,
            'known evidence path/parent')
    before = parent.stat()
    require(stat.S_ISDIR(before.st_mode) and before.st_uid == os.getuid()
            and before.st_mode & 0o077 == 0, 'private evidence parent')
    directory = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        require(os.fstat(directory).st_ino == before.st_ino, 'parent replacement')
        descriptor = os.open(path.name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW, dir_fd=directory)
        try:
            first = os.fstat(descriptor)
            require(stat.S_ISREG(first.st_mode) and first.st_uid == os.getuid()
                    and first.st_nlink == 1 and first.st_size <= MAX_JSON, 'regular bounded owned evidence')
            stream = os.fdopen(descriptor, 'rb')
        except BaseException:
            os.close(descriptor)
            raise
        with stream:
            data = stream.read(MAX_JSON + 1)
            last = os.fstat(stream.fileno())
            require((first.st_dev, first.st_ino, first.st_size, first.st_mtime_ns, first.st_ctime_ns) ==
                    (last.st_dev, last.st_ino, last.st_size, last.st_mtime_ns, last.st_ctime_ns)
                    and len(data) == first.st_size, 'evidence changed during read')
        after = parent.stat()
        require((before.st_dev, before.st_ino) == (after.st_dev, after.st_ino), 'parent replacement')
        return decode(data)
    finally:
        os.close(directory)


def uuid_text(value):
    try:
        return type(value) is str and str(uuid.UUID(value)) == value.lower()
    except (ValueError, AttributeError):
        return False


class Cursor:
    """Replay the actual producer history against independently witnessed scope."""
    def __init__(self, scope):
        require(type(scope) is dict and set(scope) == FIELDS - {'version', 'name', 'sequence'}, 'scope fields')
        require(scope['source'] == PRODUCT and scope['operation'] in OPERATIONS, 'source/operation')
        require(all(type(scope[key]) is int and scope[key] > 0 for key in ('app_pid', 'window', 'engine_pid')),
                'process/window identity')
        require(all(uuid_text(scope[key]) for key in ('run', 'launch', 'view', 'document')), 'UUID identity')
        self.scope, self.latest, self.history = dict(scope), None, []
        self.order = ORDERS[OPERATIONS.index(scope['operation'])]

    def accept(self, phase):
        require(type(phase) is dict and set(phase) == FIELDS, 'phase fields')
        require(type(phase['version']) is int and phase['version'] == 1
                and type(phase['sequence']) is int and 0 <= phase['sequence'] < len(self.order)
                and phase['name'] == self.order[phase['sequence']], 'phase version/order')
        require(all(type(phase[key]) is type(value) and phase[key] == value
                    for key, value in self.scope.items() if key != 'document'), 'phase incarnation')
        if self.latest and phase['sequence'] == self.latest['sequence']:
            require(phase == self.latest, 'same sequence mutation')
            return phase
        require(phase['sequence'] == (self.latest['sequence'] if self.latest else -1) + 1,
                'skipped/backward phase')
        if phase['name'] == 'document-reloaded':
            require(uuid_text(phase['document']) and phase['document'] != self.scope['document'], 'successor document')
        else:
            require(phase['document'] == (self.latest or self.scope)['document'], 'document replacement')
        self.latest = dict(phase)
        self.history.append(dict(phase))
        return phase

    def finish(self):
        require(len(self.history) == len(self.order), 'incomplete phase history')
        return self.history


def final_record(record, scenario):
    require(scenario in CASES and record.get('scenario') == scenario, 'case identity')
    require(all(record.get(key) is True for key in ('passed', 'engine_reaped', 'profile_removed')),
            'product/cleanup receipt')
    native = record.get('native_paths', {})
    if scenario == CASES[0]:
        require(native.get('finder_observation_grace_seconds') == 45
                and native.get('finder_cleanup_residual'), 'Finder residual/grace')
        require(native.get('created_session') and native.get('reveal_observation'), 'normal session/reveal proof')
    else:
        bridge = native.get('path_bridge_after_failure', {})
        require(native.get('actual_failure') and native.get('launch_identity_retired') is True
                and all(bridge.get(k) is False for k in ('installed', 'pending')), 'actual failure retirement')
    return record
