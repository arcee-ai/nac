#!/usr/bin/env python3
"""One admitted port-program episode; no import-time native operations.

Directory descriptors stay owned across child failure and cleanup. The helper
only removes the UUID derived by the production profile constructor. Filesystem
deletion uses retained descriptors and never traverses a symlink or replacement.
"""
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import uuid

sys.dont_write_bytecode = True
from attention_feed_build import source_binding
from instance_contract import digest


def fingerprint(fd):
    info = os.fstat(fd)
    assert info.st_uid == os.getuid() and stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700
    return info.st_dev, info.st_ino


def open_directory(path):
    path = Path(path)
    assert path.is_absolute() and path.resolve() == path, 'Noncanonical/symlink fixture path'
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fingerprint(fd)
        return fd
    except BaseException:
        os.close(fd)
        raise


class PortOwner:
    def __init__(self, destination):
        self.parent = Path(tempfile.mkdtemp(prefix='nac-notification-port-owner-', dir=destination)).resolve()
        self.tmp = self.parent / 'tmp'
        self.tmp.mkdir(mode=0o700)
        self.root = self.tmp / ('nac-notification-port-' + str(uuid.uuid4()))
        self.root.mkdir(mode=0o700)
        self.parent_fd = open_directory(self.parent)
        self.tmp_fd = open_directory(self.tmp)
        self.fd = open_directory(self.root)
        self.bindings = [(self.parent, self.parent_fd, fingerprint(self.parent_fd)),
                         (self.tmp, self.tmp_fd, fingerprint(self.tmp_fd)),
                         (self.root, self.fd, fingerprint(self.fd))]
        self.closed = False

    def validate(self):
        for path, fd, expected in self.bindings:
            assert path.resolve() == path, 'Fixture symlink appeared'
            info = path.lstat()
            assert fingerprint(fd) == expected == (info.st_dev, info.st_ino), 'Fixture root replaced'
            assert stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            assert stat.S_IMODE(info.st_mode) == 0o700
        assert os.listdir(self.tmp_fd) == [self.root.name], 'Unexpected temporary root'

    def cleanup(self, child, remove_webkit):
        assert child is not None and child.poll() is not None, 'Port child still live/unknown'
        child.wait()  # Own Popen, reaped before invoking WebKit cleanup.
        self.validate()
        receipt = remove_webkit(self)
        self.validate()  # A late callback cannot authorize a replacement root.
        assert receipt['root'] == str(self.root) and receipt['initialization_ephemeral'] is True
        assert re.fullmatch('[0-9a-f]{64}', receipt['profile']) and uuid.UUID(receipt['website_store_removed'])
        self._remove_contents(self.fd)
        self.validate()
        os.rmdir(self.root.name, dir_fd=self.tmp_fd)
        os.rmdir('tmp', dir_fd=self.parent_fd)
        # Parent descriptor remains pinned; reject replacement before rmdir.
        info = self.parent.lstat()
        assert (info.st_dev, info.st_ino) == fingerprint(self.parent_fd)
        self.parent.rmdir()
        return receipt

    def _remove_contents(self, fd):
        # Relative descriptor operations retain the original tree if renamed;
        # no replacement pathname ever becomes a recursive deletion root.
        for name in os.listdir(fd):
            self.validate()
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            assert info.st_uid == os.getuid() and not stat.S_ISLNK(info.st_mode), 'Foreign/symlink fixture entry'
            if stat.S_ISDIR(info.st_mode):
                nested = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                try:
                    expected = os.fstat(nested)
                    assert (expected.st_dev, expected.st_ino) == (info.st_dev, info.st_ino)
                    self._remove_contents(nested)
                    current = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    assert (current.st_dev, current.st_ino) == (expected.st_dev, expected.st_ino)
                    os.rmdir(name, dir_fd=fd)
                finally:
                    os.close(nested)
            else:
                assert stat.S_ISREG(info.st_mode), 'Unexpected fixture special file'
                os.unlink(name, dir_fd=fd)

    def close(self):
        if not self.closed:
            self.closed = True
            for fd in (self.fd, self.tmp_fd, self.parent_fd):
                os.close(fd)


def run_contract(program, helper, destination, source_ref):
    binding = source_binding(Path(__file__).resolve().parents[2], source_ref)
    destination = Path(destination)
    destination.mkdir(mode=0o700, parents=False, exist_ok=False)
    assert destination.resolve() == destination
    owner = PortOwner(destination)
    child = None
    evidence = dict(root=str(owner.root), source_binding=binding, actual_webkit=True, passed=False,
        program_sha256=digest(program), cleanup_helper_sha256=digest(helper))
    try:
        owner.validate()
        env = dict(os.environ, TMPDIR=str(owner.tmp) + '/', HOME=str(owner.root))
        with (destination / 'program.stdout').open('wb') as out, (destination / 'program.stderr').open('wb') as err:
            child = subprocess.Popen([str(program), str(owner.root), str(owner.fd)], env=env,
                pass_fds=(owner.fd,), stdin=subprocess.DEVNULL, stdout=out, stderr=err)
            try:
                evidence['exit_code'] = child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                evidence['timeout'] = True
                child.terminate()  # Only this controller's unreaped standalone child.
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill(); child.wait(timeout=5)
        evidence['passed'] = evidence.get('exit_code') == 0 and not evidence.get('timeout')
    finally:
        try:
            def remove_webkit(owned):
                result = subprocess.run([str(helper), str(owned.root), str(owned.fd)],
                    env=env, pass_fds=(owned.fd,), capture_output=True, timeout=15, check=False)
                (destination / 'cleanup.stdout').write_bytes(result.stdout)
                (destination / 'cleanup.stderr').write_bytes(result.stderr)
                assert result.returncode == 0, 'WebKit cleanup companion failed'
                return json.loads(result.stdout)
            evidence['cleanup'] = owner.cleanup(child, remove_webkit)
            evidence['private_root_removed'] = not owner.parent.exists()
        except BaseException as error:
            evidence.update(passed=False, cleanup_error=str(error), fixture_retained=True)
        finally:
            owner.close()
            try:
                assert source_binding(Path(__file__).resolve().parents[2], source_ref) == binding
            except Exception as error:
                evidence.update(passed=False, source_binding_error=str(error))
            (destination / 'summary.json').write_text(json.dumps(evidence, indent=2) + '\n')
    assert evidence['passed'], evidence
    return evidence


if __name__ == '__main__':
    assert len(sys.argv) == 5, 'notification_port_fixture.py PORT_PROGRAM CLEANUP_HELPER FRESH_OUTPUT FULL_SOURCE_REF'
    run_contract(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(), Path(sys.argv[3]).absolute(), sys.argv[4])
