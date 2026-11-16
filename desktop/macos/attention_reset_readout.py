"""Private reset-case readouts. No DB, native query or file IO on import.

The retained fixture root descriptor is the only read/delete authority. SQLite
opens only copied fixture bytes, after the caller proves exact engine exit.
"""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import time


def identity(info):
    return info.st_dev, info.st_ino


def stamp(info):
    return (info.st_dev, info.st_ino, info.st_uid, info.st_mode, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result, 'Duplicate JSON field'
        result[key] = value
    return result


class ResetReadout:
    def __init__(self, root):
        self.root = Path(root)
        assert self.root.is_absolute() and self.root.resolve() == self.root
        assert self.root.name.startswith('nac-attention-app-')
        self.fd = self.parent_fd = None
        try:
            self.parent_fd = os.open(self.root.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            self.parent_identity = identity(os.fstat(self.parent_fd))
            self.fd = os.open(self.root.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self.parent_fd)
            self.expected = identity(os.fstat(self.fd))
            self.validate()
        except BaseException:
            self.close()
            raise

    def validate(self):
        named, held = self.root.lstat(), os.fstat(self.fd)
        assert self.root.resolve() == self.root, 'Fixture root symlink'
        assert identity(self.root.parent.lstat()) == identity(os.fstat(self.parent_fd)) == self.parent_identity, 'Fixture parent replaced'
        assert identity(named) == identity(held) == self.expected, 'Fixture root replaced'
        assert identity(os.stat(self.root.name, dir_fd=self.parent_fd, follow_symlinks=False)) == self.expected
        assert stat.S_ISDIR(held.st_mode) and held.st_uid == os.getuid()
        assert stat.S_IMODE(held.st_mode) == 0o700, 'Fixture root not private'

    def close(self):
        for name in ('fd', 'parent_fd'):
            descriptor = getattr(self, name)
            if descriptor is not None:
                os.close(descriptor)
                setattr(self, name, None)

    def read(self, relative, limit=8 * 1024 * 1024, *, deadline=None):
        assert deadline is None or time.monotonic() < deadline, 'Readout deadline'
        self.validate()
        parts = Path(relative).parts
        assert parts and not Path(relative).is_absolute() and all(p not in ('.', '..', '') for p in parts)
        parent = os.dup(self.fd)
        directories = []
        descriptor = None
        try:
            for part in parts[:-1]:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
                info = os.fstat(child)
                directories.append((parent, part, identity(info)))
                parent = child
                assert stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
                assert info.st_mode & 0o022 == 0, 'Writable readout ancestor'
            descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
            before = os.fstat(descriptor)
            assert stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid(), 'Not an owned regular file'
            assert before.st_mode & 0o077 == 0 and before.st_nlink == 1, 'Readout not private/singly owned'
            assert 0 <= before.st_size <= limit, 'Readout exceeds bound'
            data = bytearray()
            while True:
                assert deadline is None or time.monotonic() < deadline, 'Readout deadline'
                chunk = os.read(descriptor, min(65536, limit + 1 - len(data)))
                if not chunk:
                    break
                data.extend(chunk)
                assert len(data) <= limit, 'Readout grew beyond bound'
            assert stamp(before) == stamp(os.fstat(descriptor)) == stamp(
                os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)), 'Unstable readout'
            for ancestor, name, expected in directories:
                assert identity(os.stat(name, dir_fd=ancestor, follow_symlinks=False)) == expected, 'Readout ancestor replaced'
            self.validate()
            assert deadline is None or time.monotonic() < deadline, 'Late readout'
            return bytes(data), dict(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data),
                                    device=before.st_dev, inode=before.st_ino,
                                    mtime_ns=before.st_mtime_ns, ctime_ns=before.st_ctime_ns)
        finally:
            if descriptor is not None:
                os.close(descriptor)
            os.close(parent)
            for ancestor, _, _ in reversed(directories):
                os.close(ancestor)

    def checkpoint(self, home, track, digest, *, deadline=None):
        assert Path(home) == self.root / 'profile' and track in ('dev', 'beta', 'stable')
        assert re.fullmatch('[0-9a-f]{64}', digest)
        path = Path('profile/Library/Application Support/NAC/Presentation') / track / digest / 'checkpoint.json'
        data, receipt = self.read(path, deadline=deadline)
        value = json.loads(data, object_pairs_hook=unique_object,
                           parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        assert value['profile'] == digest
        assert type(value['version']) is int and value['version'] in (1, 2)
        assert set(value) == ({'version', 'profile', 'values'} if value['version'] == 1
                              else {'version', 'profile', 'values', 'native'})
        assert set(value['values']) == {'preferences', 'drafts'}
        assert all(isinstance(entries, dict) and len(entries) <= 256 and
                   all(isinstance(k, str) and isinstance(v, str) for k, v in entries.items())
                   for entries in value['values'].values())
        return value, data, receipt

    def canonical(self, output, expected, *, owners_exited, deadline):
        assert owners_exited is True, 'Exact app/engine exit not proved'
        assert time.monotonic() < deadline
        output = Path(output)
        output.mkdir(mode=0o700, exist_ok=False)
        copied = {}
        for suffix in ('', '-wal', '-shm'):
            try:
                data, receipt = self.read('profile/selected store.db' + suffix, 64 * 1024 * 1024, deadline=deadline)
            except FileNotFoundError:
                assert suffix, 'Canonical store absent'
                copied[suffix] = None
                continue
            target = output / ('source.sqlite' + suffix)
            with target.open('xb') as stream:
                os.chmod(target, 0o600)
                stream.write(data)
            copied[suffix] = receipt
        for suffix, receipt in copied.items():
            try:
                _, current = self.read('profile/selected store.db' + suffix, 64 * 1024 * 1024, deadline=deadline)
            except FileNotFoundError:
                assert receipt is None, 'Canonical file disappeared'
            else:
                assert current == receipt, 'Canonical source changed during copy'
        backup = output / 'canonical.sqlite'
        fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        os.close(fd)
        with closing(sqlite3.connect((output / 'source.sqlite').as_uri() + '?mode=ro', uri=True)) as source, \
                closing(sqlite3.connect(backup)) as destination:
            source.execute('PRAGMA query_only=ON')
            def progress(*_):
                assert time.monotonic() < deadline, 'Canonical backup deadline'
            source.backup(destination, pages=128, progress=progress, sleep=0.01)
        with closing(sqlite3.connect(backup.as_uri() + '?mode=ro&immutable=1', uri=True)) as db:
            db.execute('PRAGMA query_only=ON')
            db.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
            assert db.execute('PRAGMA quick_check').fetchall() == [('ok',)]
            db.row_factory = sqlite3.Row
            rows = [dict(row) for row in db.execute('SELECT * FROM session_completion_occurrences ORDER BY sequence')]
            outcomes = [dict(row) for row in db.execute('SELECT session_id,run_id,disposition FROM session_run_outcomes')]
            stores = [row[0] for row in db.execute('SELECT store_id FROM session_completion_feed WHERE singleton=1')]
            counts = {name: db.execute('SELECT count(*) FROM ' + name).fetchone()[0]
                      for name in ('sessions', 'session_goals', 'session_run_outcomes')}
        canonical_matches(rows, outcomes, stores, counts, expected)
        assert time.monotonic() < deadline
        self.validate()
        return dict(rows=rows, outcomes=outcomes, stores=stores, counts=counts, copied=copied,
                    backup_sha256=hashlib.sha256(backup.read_bytes()).hexdigest())

    def remove(self, settlement):
        """Only after positive native/provider/website settlement by the caller."""
        assert set(settlement) == {'native', 'provider', 'website'}
        assert all(value is True for value in settlement.values()), 'Cleanup ownership UNKNOWN'
        def contents(fd):
            for name in os.listdir(fd):
                self.validate()
                info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                assert info.st_uid == os.getuid() and not stat.S_ISLNK(info.st_mode)
                if stat.S_ISDIR(info.st_mode):
                    nested = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                    try:
                        assert identity(os.fstat(nested)) == identity(info)
                        contents(nested)
                        assert identity(os.stat(name, dir_fd=fd, follow_symlinks=False)) == identity(info)
                        os.rmdir(name, dir_fd=fd)
                    finally:
                        os.close(nested)
                else:
                    assert stat.S_ISREG(info.st_mode)
                    os.unlink(name, dir_fd=fd)
        self.validate()
        contents(self.fd)
        self.validate()
        os.rmdir(self.root.name, dir_fd=self.parent_fd)


def canonical_matches(rows, outcomes, stores, counts, expected):
    assert counts == dict(sessions=1, session_goals=0, session_run_outcomes=1), 'Extra canonical work'
    assert stores == [expected['store']] and len(rows) == 1
    row = rows[0]
    for column, key in [('session_id', 'session'), ('run_id', 'run'), ('behavior', 'behavior'),
                        ('kind', 'kind'), ('goal_id', 'goal'), ('mark_version', 'mark_version')]:
        assert row[column] == expected[key], 'Canonical identity: ' + column
    assert type(row['sequence']) is int and row['sequence'] == 1
    assert outcomes == [dict(session_id=expected['session'], run_id=expected['run'], disposition='completed')]
