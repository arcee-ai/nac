"""Attention fixture custody only; no import-time queries or product policy.

The native consumer independently checks this short-lived envelope. A failed
check permanently retires this controller's normal controls; cleanup can only
stop the exact already-bound fixture incarnation, without activation.
"""
import json
import os
from pathlib import Path
import plistlib
import stat
import subprocess
import time
import uuid
from instance_smoke import remaining


def console_facts(*, deadline=None):
    remaining(deadline, 3)
    uid = os.getuid()
    facts = dict(uid=uid, console_uid=None, aqua=False, root_locked=None, cgs_locked=None)
    try:
        facts['console_uid'] = os.stat('/dev/console').st_uid
        facts['aqua'] = subprocess.run(['/bin/launchctl', 'print', f'gui/{uid}'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=remaining(deadline, 3)).returncode == 0
        tree = plistlib.loads(subprocess.check_output(
            ['/usr/sbin/ioreg', '-n', 'Root', '-d1', '-a'], timeout=remaining(deadline, 3)))
        roots = tree if isinstance(tree, list) else [tree]
        bits = [node['IOConsoleLocked'] for node in roots
                if isinstance(node, dict) and type(node.get('IOConsoleLocked')) is bool]
        if bits:
            facts['root_locked'] = any(bits)
        cgs = [row['CGSSessionScreenIsLocked'] for node in roots if isinstance(node, dict)
               for row in node.get('IOConsoleUsers', []) if isinstance(row, dict)
               and type(row.get('CGSSessionScreenIsLocked')) is bool]
        if cgs:
            facts['cgs_locked'] = any(cgs)
    except (OSError, subprocess.SubprocessError, plistlib.InvalidFileException):
        facts['aqua'] = False
    remaining(deadline, 3)
    return facts


def require_console(facts):
    assert facts['uid'] > 0 and facts['console_uid'] == facts['uid'], 'Console UID is not owned'
    assert facts['aqua'] is True, 'Owned Aqua domain unavailable'
    assert facts['root_locked'] is False, 'Root console lock unknown or locked'
    assert facts['cgs_locked'] in (None, False), 'CGS console locked'


class AttentionControl:
    def __init__(self, probe=console_facts, clock=time.time):
        self.probe, self.clock = probe, clock
        self.retired = False
        self.identity = None
        self.nonce = None
        self.window = None
        self.directory = None
        self.directory_fd = None

    def bind(self, journey, record, *, deadline=None):
        """Capture an already-launched owner for cleanup, never permission to act."""
        identity = journey.identity
        observed = journey.observe() if deadline is None else journey.observe(deadline=deadline)
        assert identity and observed['apps'] == [identity], 'Owned app incarnation changed'
        assert record['app_pid'] == identity['pid'] and record['workspace_window_count'] == 1
        assert type(record['window_number']) is int and record['window_number'] > 0
        nonce = record['control_nonce']
        assert isinstance(nonce, str) and str(uuid.UUID(nonce)).upper() == nonce.upper()
        if self.identity is None:
            self.identity, self.nonce, self.window = identity.copy(), nonce, record['window_number']
        assert self.identity == identity and self.nonce == nonce, 'Fixture generation changed'
        assert self.window == record['window_number'], 'Owned window replaced'
        if self.directory_fd is None:
            self.directory = Path(journey.control)
            assert self.directory.resolve() == self.directory, 'Control directory symlink'
            self.directory_fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        self._validate_directory()
        remaining(deadline, 2)

    def _validate_directory(self):
        held, named = os.fstat(self.directory_fd), self.directory.lstat()
        assert self.directory.resolve() == self.directory
        assert (held.st_dev, held.st_ino) == (named.st_dev, named.st_ino), 'Control directory replaced'
        assert held.st_uid == os.getuid() and stat.S_ISDIR(held.st_mode) and stat.S_IMODE(held.st_mode) == 0o700

    def close(self):
        self.retired = True
        if self.directory_fd is not None:
            os.close(self.directory_fd)
            self.directory_fd = None

    def check(self, journey, *, launch=False, deadline=None):
        assert not self.retired, 'Attention controls retired'
        try:
            remaining(deadline, 2)
            require_console(self.probe() if deadline is None else self.probe(deadline=deadline))
            observed = journey.observe() if deadline is None else journey.observe(deadline=deadline)
            if launch and journey.identity is None:
                assert not observed['apps'], 'Fixture already running before launch'
                assert observed.get('frontmost') == journey.prior, 'Prior focus changed before launch'
                remaining(deadline, 2)
                return
            record = journey.read() if deadline is None else journey.read(deadline=deadline)
            identity = journey.identity
            assert identity and observed['apps'] == [identity], 'Owned app incarnation changed'
            assert observed.get('frontmost') == identity, 'User focus changed'
            assert record['app_active'] is True
            self.bind(journey, record, deadline=deadline)
            remaining(deadline, 2)
            return record
        except BaseException:
            self.retired = True
            raise

    def publish(self, journey, name, action, *, deadline=None, **payload):
        try:
            record = self.check(journey, deadline=deadline)
            envelope = dict(action=action, **payload, control_nonce=self.nonce,
                app_pid=str(self.identity['pid']), window_number=str(record['window_number']),
                expires=str(self.clock() + remaining(deadline, 2)))
            if deadline is None:
                self._write(journey.control / (name + '.json'), envelope)
            else:
                self._write(journey.control / (name + '.json'), envelope, deadline=deadline)
                remaining(deadline, 2)
        except BaseException:
            self.retired = True
            raise

    def cleanup(self, journey, name):
        # No focus restoration, activation, foreign identity adoption or normal
        # action after retirement. Native cleanup accepts only this stop verb.
        self.retired = True
        assert self.identity is not None and self.nonce is not None, 'No bound cleanup owner'
        assert journey.observe()['apps'] == [self.identity], 'Cleanup owner changed'
        self._write(journey.control / (name + '.json'), dict(action='cleanup',
            control_nonce=self.nonce, app_pid=str(self.identity['pid'])))

    def _write(self, path, value, *, deadline=None):
        # Publish complete JSON atomically. The native poller ignores the hidden
        # staging name; link is exclusive and never replaces/follows a target.
        self._validate_directory()
        assert path.parent == self.directory
        temporary = '.attention-control-' + uuid.uuid4().hex
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.directory_fd)
        try:
            with os.fdopen(descriptor, 'w') as output:
                json.dump(value, output)
            self._validate_directory()
            remaining(deadline, 2)  # Last check before atomic publication.
            os.link(temporary, path.name, src_dir_fd=self.directory_fd, dst_dir_fd=self.directory_fd, follow_symlinks=False)
        finally:
            os.unlink(temporary, dir_fd=self.directory_fd)
