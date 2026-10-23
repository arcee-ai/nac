#!/usr/bin/env python3
"""ALL-417 NONSHIPPING qualification oracle. Never call from launch/runtime.

Operates only on disposable fixtures created by run.py/tests. Sequential scans
are an experimental observation protocol, not an atomic filesystem snapshot.
"""
import dataclasses
import hashlib
import os
from pathlib import Path, PurePosixPath
import signal
import stat
import subprocess
import time


class Rejected(Exception):
    pass


@dataclasses.dataclass(frozen=True)
class Limits:
    candidates: int = 10000
    per_file: int = 16 * 1024 * 1024
    aggregate: int = 128 * 1024 * 1024
    seconds: float = 30.0


class Probe:
    def __init__(self, root, limits=Limits(), clock=time.monotonic):
        self.root = Path(root)
        self.limits = limits
        self.clock = clock
        self.started = clock()
        self.commands = []
        self.bytes_read = 0
        self.cancelled = False
        self.visited_directories = []

    def check(self):
        if self.cancelled:
            raise Rejected('cancelled')
        if self.clock() - self.started > self.limits.seconds:
            raise Rejected('limit:elapsed')

    def git(self, *args, data=None, env=None, allow_codes=(0,)):
        self.check()
        # Fixtures ignore machine configuration. Never run git add on a fixture
        # with a declared unsupported filter; inspect() must reject it first.
        process_env = dict(os.environ, GIT_CONFIG_GLOBAL='/dev/null',
                           GIT_CONFIG_NOSYSTEM='1', GIT_OPTIONAL_LOCKS='0')
        process_env.update(env or {})
        self.commands.append(list(args))
        p = subprocess.Popen(['git', *args], cwd=self.root, env=process_env,
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, start_new_session=True)
        try:
            result, error = p.communicate(data, timeout=max(
                .001, self.limits.seconds - (self.clock() - self.started)))
        except subprocess.TimeoutExpired:
            os.killpg(p.pid, signal.SIGKILL)
            p.communicate()
            raise Rejected('limit:elapsed') from None
        self.check()
        if p.returncode not in allow_codes:
            raise Rejected('git:' + args[0] + ':' + error.decode(errors='replace').splitlines()[0])
        return result

    def selected(self):
        sparse = self.git('config', '--type=bool', '--get', 'core.sparseCheckout') if self.configured('core.sparseCheckout') else b''
        if sparse.strip() == b'true':
            raise Rejected('unsupported:sparse-checkout')
        if self.git('ls-files', '-u', '-z'):
            raise Rejected('unsupported:unmerged-index')
        staged = self.git('ls-files', '--stage', '-z').split(b'\0')
        tracked = []
        for entry in filter(None, staged):
            info, name = entry.split(b'\t', 1)
            if info.startswith(b'160000 '):
                raise Rejected('unsupported:gitlink:' + os.fsdecode(name))
            tracked.append(name)
        # Git ls-files omits untracked sockets/FIFOs. A pruned no-follow
        # inventory is required to NOTICE unsupported selected entries.
        names = set(tracked)
        def walk(directory, prefix=''):
            self.check()
            self.visited_directories.append(prefix or '.')
            with os.scandir(directory) as scan:
                children = [entry for entry in scan if entry.name != '.git']
            rels = [(prefix + entry.name).encode(errors='surrogateescape') for entry in children]
            if not rels:
                return
            raw = self.git('check-ignore', '--no-index', '--non-matching', '-v', '-z', '--stdin',
                           data=b'\0'.join(rels) + b'\0', allow_codes=(0, 1)).split(b'\0')[:-1]
            ignored = {raw[i+3] for i in range(0, len(raw), 4) if raw[i+2] and not raw[i+2].startswith(b'!')}
            for entry, name in zip(children, rels):
                self.check()
                tracked_here = name in tracked or any(t.startswith(name + b'/') for t in tracked)
                if name in ignored and not tracked_here:
                    continue
                if entry.is_dir(follow_symlinks=False):
                    if os.path.lexists(Path(entry.path) / '.git'):
                        raise Rejected('unsupported:nested-repository:' + os.fsdecode(name))
                    walk(entry.path, os.fsdecode(name) + '/')
                else:
                    names.add(name)
                    if len(names) > self.limits.candidates:
                        raise Rejected('limit:candidates')
        if len(names) > self.limits.candidates:
            raise Rejected('limit:candidates')
        walk(self.root)
        return sorted(names)

    def configured(self, key):
        return key.lower().encode() in self.git('config', '--name-only', '--list').lower().splitlines()

    def attributes(self, names):
        if self.configured('core.autocrlf'):
            if self.git('config', '--get', 'core.autocrlf').strip() not in (b'false', b'0'):
                raise Rejected('unsupported:core.autocrlf')
        raw = self.git('check-attr', '-z', '--stdin', 'filter', 'text', 'eol',
                       'working-tree-encoding', 'ident', data=b'\0'.join(names) + b'\0')
        fields = raw.split(b'\0')[:-1]
        for name, attr, value in zip(fields[::3], fields[1::3], fields[2::3]):
            if value not in (b'unspecified', b'unset'):
                raise Rejected('unsupported:attribute:' + os.fsdecode(name) + ':' + attr.decode())

    def read_entry(self, raw):
        name = os.fsdecode(raw)
        parts = PurePosixPath(name).parts
        if not parts or name.startswith('/') or any(x in ('..', '.git') for x in parts):
            raise Rejected('unsupported:path:' + name)
        # Descriptor-relative no-follow parents, including path replacement.
        fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            for part in parts[:-1]:
                try:
                    child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                except FileNotFoundError:
                    return None  # tracked deletion may remove its whole parent
                os.close(fd)
                fd = child
                try:
                    os.stat('.git', dir_fd=fd, follow_symlinks=False)
                except FileNotFoundError:
                    pass
                else:
                    raise Rejected('unsupported:nested-repository:' + name)
            self.check()
            try:
                before = os.stat(parts[-1], dir_fd=fd, follow_symlinks=False)
            except FileNotFoundError:
                return None  # deleted tracked entry
            if stat.S_ISLNK(before.st_mode):
                target = os.readlink(os.fsencode(parts[-1]), dir_fd=fd)
                lexical = list(parts[:-1])
                if target.startswith(b'/'):
                    raise Rejected('unsupported:absolute-link:' + name)
                for component in os.fsdecode(target).split('/'):
                    if component == '..':
                        if not lexical:
                            raise Rejected('unsupported:escaping-link:' + name)
                        lexical.pop()
                    elif component not in ('', '.'):
                        lexical.append(component)
                        # Inspect BEFORE normalization can erase a component:
                        # alias/.. must never hide a link chain. lstat only.
                        probe = self.root.joinpath(*lexical)
                        if probe.is_symlink():
                            raise Rejected('unsupported:link-chain:' + name)
                data, mode = target, '120000'
            elif stat.S_ISREG(before.st_mode):
                if not before.st_mode & 0o444:
                    raise Rejected('unsupported:unreadable:' + name)
                if before.st_size > self.limits.per_file:
                    raise Rejected('limit:per-file:' + name)
                handle = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
                try:
                    opened = os.fstat(handle)
                    if (opened.st_dev, opened.st_ino, opened.st_mode) != (before.st_dev, before.st_ino, before.st_mode):
                        raise Rejected('conflict:type:' + name)
                    chunks = []
                    size = 0
                    while True:
                        self.check()
                        chunk = os.read(handle, 65536)
                        if not chunk:
                            break
                        size += len(chunk)
                        self.bytes_read += len(chunk)
                        if size > self.limits.per_file:
                            raise Rejected('limit:per-file:' + name)
                        if self.bytes_read > self.limits.aggregate:
                            raise Rejected('limit:aggregate')
                        chunks.append(chunk)
                    data = b''.join(chunks)
                    after = os.fstat(handle)
                    if (before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                            after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                        raise Rejected('conflict:content:' + name)
                finally:
                    os.close(handle)
                mode = '100755' if before.st_mode & 0o111 else '100644'
            else:
                raise Rejected('unsupported:type:' + name)
            if len(data) > self.limits.per_file:
                raise Rejected('limit:per-file:' + name)
            if mode == '120000':
                self.bytes_read += len(data)
            if self.bytes_read > self.limits.aggregate:
                raise Rejected('limit:aggregate')
            return {'mode': mode, 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)}
        except OSError as error:
            raise Rejected('unsupported:path-or-read:' + name) from error
        finally:
            os.close(fd)

    def inspect(self):
        head = self.git('rev-parse', '--verify', 'HEAD').strip().decode()
        names = self.selected()
        self.attributes(names)
        entries = {os.fsdecode(name): self.read_entry(name) for name in names}
        return {'head': head, 'entries': entries}


def validate_twice(root, mutate=lambda: None, limits=Limits()):
    first = Probe(root, limits)
    before = first.inspect()
    mutate()
    second = Probe(root, limits)
    after = second.inspect()
    if before != after:
        raise Rejected('conflict:source-changed')
    return before


def digest(data):
    return hashlib.sha256(data).hexdigest()


def source_evidence(root):
    probe = Probe(root)
    result = probe.inspect()
    # Fixture roots have ordinary .git directories; not a general worktree API.
    return {'head': result['head'], 'index_sha256': digest((Path(root) / '.git/index').read_bytes()),
            'entries': result['entries']}


def history_recipe(probe, index, trace=None):
    """Command-equivalent history candidate, only after inspect() on safe fixtures.

    This intentionally reproduces the EMPTY private index, not a repaired adapter.
    The Rust integration tests separately call the actual NAC public function.
    """
    env = {'GIT_INDEX_FILE': str(index)}
    if trace is not None:
        env['GIT_TRACE2_EVENT'] = str(trace)
    probe.git('add', '--all', env=env)
    tree = probe.git('write-tree', env=env).strip().decode()
    commit = probe.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid',
                       'commit-tree', tree, '-m', 'isolated qualification').strip().decode()
    probe.git('update-ref', 'refs/nac/qualification', commit)
    return commit


def physical(root):
    return sum(p.lstat().st_blocks * 512 for p in Path(root).rglob('*') if p.is_file())
