"""Symbolic socket lifecycle through actual driver and file-only upload guard."""
import errno
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import artifact_upload as upload
import contract as c
spec = importlib.util.spec_from_file_location('fixture', Path(__file__).with_name('custody_check.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def audit(event, args):
    if event.startswith(('subprocess.', 'ctypes.', 'socket.')) or event in ('os.kill', 'os.killpg', 'os.fork'):
        raise AssertionError('REAL_RUNTIME_FORBIDDEN')
    if event == 'open' and str(args[0]).startswith('/proc/'):
        raise AssertionError('REAL_PROC_FORBIDDEN')


sys.addaudithook(audit)


class SymbolicEntries:
    """Regular placeholders only; model socket metadata and its open failure."""
    def __init__(self):
        self.real_stat, self.real_open, self.real_unlink = os.stat, os.open, os.unlink
        self.entries, self.directories, self.removed = {}, {}, []
        self.before_unlink = lambda: None

    def path(self, name, dir_fd=None):
        return self.directories[dir_fd]/name if dir_fd in self.directories else Path(name)

    def put(self, path, kind=stat.S_IFSOCK, uid=None):
        path.write_text('SYMBOLIC special entry; never a real socket or FIFO')
        self.entries[path] = (kind, os.getuid() if uid is None else uid)

    def stat(self, name, *args, dir_fd=None, **kwargs):
        value = self.real_stat(name, *args, dir_fd=dir_fd, **kwargs)
        path = self.path(name, dir_fd)
        if path not in self.entries or not stat.S_ISREG(value.st_mode):
            return value
        fields = {key: getattr(value, key) for key in dir(value) if key.startswith('st_')}
        kind, uid = self.entries[path]
        fields.update(st_mode=kind | stat.S_IMODE(value.st_mode), st_uid=uid)
        return SimpleNamespace(**fields)

    def open(self, name, flags, *args, dir_fd=None, **kwargs):
        path = self.path(name, dir_fd)
        if path in self.entries and not flags & os.O_DIRECTORY:
            raise OSError(errno.ENXIO, 'symbolic special entry cannot be opened as a file')
        fd = self.real_open(name, flags, *args, dir_fd=dir_fd, **kwargs)
        if flags & os.O_DIRECTORY:
            self.directories[fd] = path
        return fd

    def unlink(self, name, *, dir_fd=None):
        self.before_unlink()
        self.removed.append(self.path(name, dir_fd))
        self.real_unlink(name, dir_fd=dir_fd)

    def patches(self):
        from contextlib import ExitStack
        stack = ExitStack()
        for key in ('stat', 'open', 'unlink'):
            stack.enter_context(patch.object(os, key, getattr(self, key)))
        return stack


class EndpointControls(unittest.TestCase):
    def root(self, directory):
        root = Path(directory).resolve()/'heartbeat-evidence'
        with patch.dict(os.environ, {'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1'}):
            upload.initialize_output(root, 'a'*40)
        (root/'custody').mkdir()
        return root

    def test_controller_sigkill_keeps_path_until_verified_deaths_then_real_guard_accepts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.root(directory)
            output = root/'custody/controller'
            fs = SymbolicEntries()
            state = {'dead': False, 'exit': None, 'waited': False, 'death_handles': set()}
            child, driver, peer, kernel = Mock(pid=123), Mock(), Mock(), Mock()
            child.poll.side_effect = lambda: state['exit']
            path = output/'lifeline.sock'

            def kill():
                state.update(dead=True, exit=-9)
                self.assertTrue(path.exists(), 'SIGKILL must leave the bound pathname in this model')
                with self.assertRaises((RuntimeError, OSError)) as rejected:
                    upload.validate_upload(root, 'a'*40, '123', '1')
                if isinstance(rejected.exception, OSError):
                    self.assertEqual(rejected.exception.errno, errno.ENXIO)
                else:
                    self.assertEqual(str(rejected.exception), 'UPLOAD_UNRETIRED_ENDPOINT')

            def wait(timeout):
                state['waited'] = True
                return state['exit']

            def ready(fd, milliseconds=0):
                if state['dead']:
                    state['death_handles'].add(fd)
                return state['dead']

            def packet(channel):
                context = json.loads((output/'context.json').read_text())
                if not fs.entries:
                    fs.put(path)
                    return {'kind': 'PID1', 'controller': 123, 'nonce': context['lifeline_nonce'],
                            'proof': {'peer_host_pid': 301}, 'admitted': {'lifeline': {'state': 'VERIFIED_POST_DROP'}},
                            'endpoint': fixture.endpoint_identity(os.stat(path, follow_symlinks=False))}, 1000040
                return {'kind': 'wrapper', 'pid': 200}, 1000050

            def before_unlink():
                self.assertTrue(state['waited'])
                self.assertEqual(state['death_handles'], {1000040, 1000050})

            fs.before_unlink = before_unlink
            child.kill.side_effect, child.wait.side_effect = kill, wait
            kernel.ready.side_effect = ready
            kernel.pid.side_effect = lambda fd: 301 if fd == 1000040 else 200
            real_close = os.close
            def proc_stat(name, *args, **kwargs):
                return Mock(st_ino=10) if str(name).startswith('/proc/self/ns/') else fs.stat(name, *args, **kwargs)

            with fs.patches(), patch.object(os, 'stat', proc_stat), \
                 patch.object(os, 'close', side_effect=lambda fd: None if fd in (1000040, 1000050) else real_close(fd)), \
                 patch.dict(os.environ, {'EXPECTED_CONTROL': 'a'*40}), \
                 patch.object(fixture.socket, 'socketpair', return_value=(driver, peer)), \
                 patch.object(fixture.subprocess, 'Popen', return_value=child), \
                 patch.object(fixture, 'Kernel', return_value=kernel), \
                 patch.object(fixture, 'receive_fd', side_effect=packet):
                result = fixture.one_case('controller', output)
                exported = upload.validate_upload(root, 'a'*40, '123', '1')
            self.assertEqual(result['state'], 'PASS_REAL_CUSTODY_ONLY')  # Symbolic adapters, not kernel qualification.
            self.assertEqual(result['endpoint_retirement']['state'], 'REMOVED_OWNED_STALE_ENDPOINT')
            self.assertEqual(fs.removed, [path])
            self.assertFalse(path.exists())
            self.assertIn('custody/controller/endpoint-retirement.json', exported['files'])
            self.assertEqual(child.kill.call_count, 1)
            kernel.kill.assert_not_called()

    def test_unproven_deaths_foreign_replaced_symlink_and_unknown_special_never_unlink(self):
        for defect in ('deaths', 'foreign', 'replaced', 'symlink', 'special', 'parent-replaced'):
            with self.subTest(defect=defect), tempfile.TemporaryDirectory() as directory:
                root = self.root(directory)
                output = root/'custody/controller'
                output.mkdir(mode=0o700)
                path = output/'lifeline.sock'
                fs = SymbolicEntries()
                fs.put(path)
                with fs.patches():
                    expected = fixture.endpoint_identity(os.stat(path, follow_symlinks=False))
                    endpoint = fixture.OwnedEndpoint(output, os.getuid(), os.getgid(), expected)
                    try:
                        if defect == 'foreign':
                            fs.entries[path] = (stat.S_IFSOCK, os.getuid()+1)
                        elif defect == 'replaced':
                            replacement = output/'replacement'
                            fs.put(replacement)
                            replacement.replace(path)
                        elif defect == 'symlink':
                            fs.real_unlink(path)
                            path.symlink_to(root/'ownership.json')
                        elif defect == 'special':
                            fs.entries[path] = (stat.S_IFIFO, os.getuid())
                        elif defect == 'parent-replaced':
                            output.rename(output.with_name('old-controller'))
                            output.mkdir(mode=0o700)
                        with self.assertRaises(RuntimeError):
                            endpoint.retire(defect != 'deaths', True, True)
                    finally:
                        endpoint.close()
                self.assertEqual(fs.removed, [])

    def test_unbound_or_foreign_capture_and_unknown_special_upload_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.root(directory)
            output = root/'custody/controller'
            output.mkdir(mode=0o700)
            fs = SymbolicEntries()
            path = output/'lifeline.sock'
            fs.put(path)
            with fs.patches():
                identity = fixture.endpoint_identity(os.stat(path, follow_symlinks=False))
                for unbound in (None, {**identity, 'ino': identity['ino']+1}):
                    with self.assertRaisesRegex(RuntimeError, 'ENDPOINT_BINDING_CHANGED'):
                        fixture.OwnedEndpoint(output, os.getuid(), os.getgid(), unbound)
                fs.entries[path] = (stat.S_IFSOCK, os.getuid()+1)
                with self.assertRaisesRegex(RuntimeError, 'ENDPOINT_TYPE_OR_OWNER'):
                    fixture.OwnedEndpoint(output, os.getuid(), os.getgid(), identity)
                with self.assertRaisesRegex(RuntimeError, 'UPLOAD_UNRETIRED_ENDPOINT'):
                    upload.validate_upload(root, 'a'*40, '123', '1')
                fs.real_unlink(path)
                fs.put(output/'unknown.pipe', kind=stat.S_IFIFO)
                with self.assertRaisesRegex(RuntimeError, 'UPLOAD_REGULAR_SINGLE_LINK'):
                    upload.validate_upload(root, 'a'*40, '123', '1')
            self.assertEqual(fs.removed, [])

    def test_owner_removed_path_is_not_recreated_or_unlinked_again(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.root(directory)
            output = root/'custody/wrapper'
            output.mkdir(mode=0o700)
            path = output/'lifeline.sock'
            fs = SymbolicEntries()
            fs.put(path)
            with fs.patches():
                endpoint = fixture.OwnedEndpoint(output, os.getuid(), os.getgid(),
                                                fixture.endpoint_identity(os.stat(path, follow_symlinks=False)))
                try:
                    fs.real_unlink(path)  # Model the normal production owner.close().
                    result = endpoint.retire(True, True, True)
                finally:
                    endpoint.close()
                upload.validate_upload(root, 'a'*40, '123', '1')
            self.assertEqual(result['state'], 'ALREADY_ABSENT_AFTER_VERIFIED_DEATH')
            self.assertEqual(fs.removed, [])

    def test_controller_reports_actual_bound_path_identity_before_cancellation(self):
        for wrong_path in (False, True):
            with self.subTest(wrong_path=wrong_path), tempfile.TemporaryDirectory() as directory:
                output = Path(directory).resolve()
                context = output/'context.json'
                path = output/'lifeline.sock'
                c.write_json(context, {'controller_pid': None, 'lifeline_socket': str(path), 'lifeline_nonce': 'symbolic'})
                fs = SymbolicEntries()
                fs.put(path)
                channel = Mock()
                channel.recv.return_value = b'wrapper'
                wrapper = Mock(pid=200)
                wrapper.poll.return_value = None

                class BaseCustody:
                    def __init__(self, context):
                        self.server = Mock()
                        self.server.getsockname.return_value = 'foreign-path' if wrong_path else str(path)
                        self.pidfd, self.proof = 1000040, {'peer_host_pid': 301}
                        self.kernel = Mock()
                        self.kernel.ready.return_value = False

                    def bind(self, wrapper):
                        pass  # Kernel/handshake already characterized; no real socket here.

                def finalizer(*args):
                    fixture.owner.NamespaceCustody({}).bind(wrapper)
                    raise RuntimeError('SYMBOLIC_WRAPPER_CANCELLED')

                with fs.patches(), patch.object(fixture, 'NamespaceCustody', BaseCustody), \
                     patch.object(fixture.socket, 'socket', return_value=channel), \
                     patch.object(fixture, 'wait_admitted', return_value={'stub_started': True}), \
                     patch.object(fixture, 'send_fd') as send, patch.object(os, 'pidfd_open', return_value=1000050, create=True), \
                     patch.object(os, 'close'), patch.object(fixture.owner, 'NamespaceCustody'), \
                     patch.object(fixture.owner, 'finalize_namespace', side_effect=finalizer):
                    fixture.controller(context, output, 999)
                if wrong_path:
                    send.assert_not_called()
                    wrapper.kill.assert_not_called()
                else:
                    report = send.call_args_list[0].args[1]
                    with fs.patches():
                        expected = fixture.endpoint_identity(os.stat(path, follow_symlinks=False))
                    self.assertEqual(report['endpoint'], expected)
                    self.assertLessEqual(len(json.dumps(report).encode()), 1024)
                    wrapper.kill.assert_called_once()


if __name__ == '__main__':
    unittest.main()
