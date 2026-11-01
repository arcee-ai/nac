"""Actual admission/retirement paths, using only symbolic kernel/child adapters."""
import array
import importlib.util
import json
import os
from pathlib import Path
import socket
import select
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import namespace_custody as custody
import owned_process as owned
spec = importlib.util.spec_from_file_location('heartbeat_runner', Path(__file__).with_name('run.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def audit(event, args):
    if (event.startswith(('subprocess.', 'ctypes.', 'socket.')) or
            event in ('os.kill', 'os.killpg', 'os.fork') or
            event == 'open' and str(args[0]).startswith('/proc/')):
        raise AssertionError('REAL_RUNTIME_OPERATION_FORBIDDEN')


sys.addaudithook(audit)


CONTEXT = {'uid': 1001, 'gid': 1001, 'host_namespaces': {'net': 10, 'pid': 11},
           'lifeline_socket': '/synthetic/lifeline.sock', 'lifeline_nonce': 'private-nonce',
           'controller_pid': 80, 'control': 'a'*40}
CHALLENGE = {'version': 1, 'nonce': CONTEXT['lifeline_nonce']}
ACK = {**CHALLENGE, 'controller_pid': 80}


class Kernel:
    """Symbolic handles only: 40 is namespace PID1, 50 is the controller."""
    def __init__(self, dead=False, kill_works=True):
        self.dead, self.kill_works = dead, kill_works
        self.signals, self.proofs = [], []

    def ready(self, fd, milliseconds=0):
        return self.dead if fd == 40 else False

    def own_pidfd(self):
        return 50

    def peer(self, channel):
        return (301, 1001, 1001)

    def prove_pid1(self, fd, peer, wrapper, context):
        self.proofs.append((fd, peer, wrapper))
        return {'namespace_pid': 1, 'retained_wrapper_pid': wrapper.pid}

    def kill(self, fd):
        self.signals.append(fd)
        self.dead = self.kill_works


class ImmediateThread:
    """Run mocked watcher synchronously, without starting a native thread."""
    def __init__(self, *, target, daemon):
        self.target = target

    def start(self):
        self.target()

    def join(self, timeout):
        pass

    def is_alive(self):
        return False


class CustodyControls(unittest.TestCase):
    def test_actual_bootstrap_arms_after_final_drop_even_when_pdeath_is_cleared(self):
        for failure in (None, 'missing', 'parent-dead', 'bad-proof'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                path = Path(directory)/'context.json'
                path.write_text(json.dumps(CONTEXT))
                state = {'uid': 0, 'gid': 0, 'pdeath': True}
                calls, life = [], Mock(proof={'state': 'VERIFIED_POST_DROP'})

                def drop(key, value):
                    state[key], state['pdeath'] = value, False
                    calls.append(key)

                def arm(context):
                    self.assertEqual(state, {'uid': 1001, 'gid': 1001, 'pdeath': False})
                    self.assertEqual(calls, ['groups', 'gid', 'uid'])
                    calls.append('verified-lifeline')
                    if failure in ('missing', 'parent-dead'):
                        raise RuntimeError('LIFELINE_UNAVAILABLE')
                    if failure == 'bad-proof':
                        life.proof = {'state': 'UNRESOLVED'}
                    return life

                child = Mock()
                child.wait.return_value, child.poll.return_value = 0, 0
                with patch.object(runner.os, 'getpid', return_value=1), \
                     patch.object(runner.os, 'geteuid', side_effect=lambda: state['uid']), \
                     patch.object(runner.os, 'getegid', side_effect=lambda: state['gid']), \
                     patch.object(runner.os, 'stat', return_value=SimpleNamespace(st_ino=99)), \
                     patch.object(runner.os, 'setgroups', side_effect=lambda groups: calls.append('groups')), \
                     patch.object(runner.os, 'setgid', side_effect=lambda gid: drop('gid', gid)), \
                     patch.object(runner.os, 'setuid', side_effect=lambda uid: drop('uid', uid)), \
                     patch.object(runner.subprocess, 'Popen', return_value=child), \
                     patch.object(runner.socket, 'if_nameindex', return_value=[(1, 'lo')]), \
                     patch.object(runner, 'Lifeline', side_effect=arm), \
                     patch.object(runner, 'workload', return_value=0) as work:
                    if failure:
                        with self.assertRaises(RuntimeError):
                            runner.inside(path, Path(directory))
                        work.assert_not_called()
                    else:
                        self.assertEqual(runner.inside(path, Path(directory)), 0)
                        self.assertEqual(work.call_args.args[2]['lifeline']['state'], 'VERIFIED_POST_DROP')
                        life.close.assert_called_once()
                    child.wait.assert_called_once_with(timeout=5)

    def test_actual_parent_proof_binds_pidfd_peer_private_pid1_and_owned_parent_chain(self):
        def stat(parent, birth):
            return '301 (symbolic task) S '+str(parent)+' '+' '.join(['0']*17)+' '+str(birth)

        for failure in (None, 'pidfd', 'peer', 'namespace', 'parent', 'birth', 'wrapper'):
            with self.subTest(failure=failure):
                kernel, wrapper = custody.Kernel(), Mock(pid=200)
                wrapper.poll.side_effect = [None, 0 if failure == 'wrapper' else None]
                records = {'/proc/301/status': 'Name:\tfixture\nNSpid:\t301\t'+('2' if failure == 'namespace' else '1')+'\n',
                           '/proc/301/stat': stat(1 if failure == 'parent' else 200, 44)}
                reads = []

                def read(path):
                    key = str(path)
                    reads.append(key)
                    if failure == 'birth' and reads.count(key) == 2:
                        return stat(200, 45)
                    return records[key]

                with patch.object(kernel, 'ready', return_value=False), \
                     patch.object(kernel, 'pid', return_value=999 if failure == 'pidfd' else 301), \
                     patch.object(Path, 'read_text', read):
                    peer = (301, 0 if failure == 'peer' else 1001, 1001)
                    if failure:
                        with self.assertRaises(RuntimeError):
                            kernel.prove_pid1(40, peer, wrapper, CONTEXT)
                    else:
                        proof = kernel.prove_pid1(40, peer, wrapper, CONTEXT)
                        self.assertTrue(proof['parent_chain_bookended'])
                        self.assertEqual(proof['namespace_pid'], 1)

    def test_actual_pidfd_parser_and_poll_reject_invalid_or_error_handles(self):
        for text, expected in [('pos:\t0\nPid:\t301\nNSpid:\t301\t1\n', 301),
                               ('Pid:\t0\n', 0), ('Pid:\t-1\n', -1), ('regular file', None)]:
            with patch.object(Path, 'read_text', return_value=text):
                if expected is None:
                    with self.assertRaisesRegex(RuntimeError, 'NOT_A_PIDFD'):
                        custody.Kernel.pid(40)
                else:
                    self.assertEqual(custody.Kernel.pid(40), expected)
        for bits in (None, select.POLLIN, select.POLLHUP, select.POLLERR, select.POLLNVAL):
            poller = Mock()
            poller.poll.return_value = [] if bits is None else [(40, bits)]
            with patch.object(custody.select, 'poll', return_value=poller, create=True):
                if bits in (select.POLLERR, select.POLLNVAL):
                    with self.assertRaisesRegex(RuntimeError, 'PIDFD_INVALID'):
                        custody.Kernel.ready(40)
                else:
                    self.assertEqual(custody.Kernel.ready(40), bits is not None)

    def test_outer_retains_verified_pid1_before_ack_and_rejects_bad_handshake(self):
        for failure in (None, 'nonce', 'identity', 'ack'):
            kernel, channel, listener, wrapper = Kernel(), Mock(), Mock(), Mock(pid=200)
            listener.accept.return_value = (channel, None)
            owner = custody.NamespaceCustody(CONTEXT, kernel=kernel, listener=listener)

            def send(*args):
                self.assertEqual(owner.pidfd, 40)  # ACK cannot precede custody.
                if failure == 'ack':
                    raise OSError('synthetic disconnected controller')

            if failure == 'identity':
                kernel.prove_pid1 = Mock(side_effect=RuntimeError('PID1_PARENT_RACE'))
            with patch.object(custody, 'receive_fd', return_value=({} if failure == 'nonce' else CHALLENGE, 40)), \
                 patch.object(custody, 'send_fd', side_effect=send), patch.object(custody.os, 'close') as close:
                if failure:
                    with self.assertRaises((RuntimeError, OSError)):
                        owner.bind(wrapper)
                    self.assertEqual(owner.pidfd, 40 if failure == 'ack' else None)
                else:
                    owner.bind(wrapper)
                    self.assertEqual(owner.pidfd, 40)
                if failure != 'ack' and failure is not None:
                    close.assert_called_once_with(40)

    def test_actual_lifeline_rejects_dead_parent_and_unarmed_watch_before_admission(self):
        for failure in (None, 'peer', 'nonce', 'dead-parent', 'death-after-watch', 'not-armed'):
            with self.subTest(failure=failure):
                kernel, channel = Mock(), Mock()
                kernel.peer.return_value = (999 if failure == 'peer' else 0, 1001, 1001)
                kernel.own_pidfd.return_value = 40
                kernel.pid.side_effect = lambda fd: 1 if fd == 40 else 0
                checks = []

                def ready(fd):
                    checks.append(fd)
                    return fd == 50 and (failure == 'dead-parent' or
                        failure == 'death-after-watch' and checks.count(50) == 2)

                kernel.ready.side_effect = ready

                def watch(life):
                    if failure != 'not-armed':
                        life.started.set()

                answer = {} if failure == 'nonce' else ACK
                with patch.object(custody, 'send_fd'), \
                     patch.object(custody, 'receive_fd', return_value=(answer, 50)), \
                     patch.object(custody.os, 'close'), patch.object(custody.Lifeline, 'watch', watch):
                    if failure:
                        with self.assertRaises(RuntimeError):
                            custody.Lifeline(CONTEXT, kernel=kernel, channel=channel,
                                             thread_factory=ImmediateThread, die=Mock())
                    else:
                        life = custody.Lifeline(CONTEXT, kernel=kernel, channel=channel,
                                                thread_factory=ImmediateThread, die=Mock())
                        self.assertEqual(life.proof['state'], 'VERIFIED_POST_DROP')
                        life.close()

    def test_actual_watcher_fails_closed_on_early_death_later_death_or_poll_error(self):
        for events, stop in [([[ (50, 1) ]], False), ([[], [(50, 1)]], False),
                             ([RuntimeError('symbolic poll error')], False), ([[], []], False),
                             ([[], [(50, 1)]], True)]:
            life = object.__new__(custody.Lifeline)
            life.controller_fd, life.channel, life.die = 50, Mock(), Mock()
            life.started, life.stopping = Mock(), Mock()
            life.stopping.is_set.return_value = stop
            poller = Mock()
            poller.poll.side_effect = events
            with patch.object(custody.select, 'poll', return_value=poller, create=True):
                life.watch()
            self.assertEqual(life.die.call_count, 0 if stop else 1)
            if len(events) == 1:
                life.started.set.assert_not_called()

    def test_cancellation_of_wrapper_never_implies_namespace_closure(self):
        for bound, kill_works in [(True, True), (True, False), (False, False)]:
            with self.subTest(bound=bound, kill_works=kill_works), tempfile.TemporaryDirectory() as directory:
                kernel, listener = Kernel(kill_works=kill_works), Mock()
                context = {**CONTEXT, 'lifeline_socket': str(Path(directory)/'lifeline.sock')}
                owner = custody.NamespaceCustody(context, kernel=kernel, listener=listener)
                owner.pidfd, owner.channel = 40 if bound else None, Mock()
                child = Mock(pid=200)
                child.poll.return_value = None
                child.wait.side_effect = owned.Interrupted('synthetic cancellation')
                child.terminate.side_effect = lambda: setattr(child.poll, 'return_value', -15)

                def run(*args, **kwargs):
                    # Execute actual run_owned and callback, but fake every child.
                    return owned.run_owned(*args, **kwargs, factory=lambda *a, **k: child)

                with patch.object(owner, 'bind') as bind, patch.object(custody.os, 'close'), \
                     patch.object(runner, 'NamespaceCustody', return_value=owner), \
                     patch.object(runner, 'run_owned', side_effect=run), \
                     patch.object(runner, 'artifact_manifest', return_value={'files': []}) as manifest, \
                     patch.object(owned, 'sha256', side_effect=AssertionError('NO_PRE_RETIREMENT_HASH')):
                    with self.assertRaises(RuntimeError):
                        runner.finalize_namespace(['symbolic'], {}, Path(directory), Path(directory), context)
                    bind.assert_called_once_with(child)
                    child.terminate.assert_called_once()
                    result = json.loads((Path(directory)/'terminal.json').read_text())
                    retired = bound and kill_works
                    self.assertEqual(result['state'], 'FAIL' if retired else 'UNRESOLVED')
                    self.assertEqual(result['artifacts_stable'], retired)
                    self.assertEqual(manifest.call_count, int(retired))
                    self.assertEqual(kernel.signals, [40] if bound else [])
                    self.assertEqual(result['namespace_retirement'].get('pid1_death_verified'), retired)

    def test_normal_wrapper_exit_with_live_pid1_is_failure_even_after_verified_retirement(self):
        kernel = Kernel()
        owner = custody.NamespaceCustody(CONTEXT, kernel=kernel, listener=Mock())
        owner.pidfd, owner.channel = 40, Mock()
        first, proof = custody.execute_namespace([], None, {}, None, owner, Mock())
        self.assertEqual(first, 'PID1_OUTLIVED_WRAPPER')
        self.assertEqual(proof['state'], 'RETIRED')
        self.assertTrue(proof['pid1_death_verified'])

    def test_received_fd_is_bounded_and_extra_or_truncated_handles_are_closed(self):
        for fds, flags, valid in [([40], 0, True), ([40, 41], 0, False),
                                  ([40], socket.MSG_CTRUNC, False), ([], 0, False)]:
            channel = Mock()
            channel.recvmsg.return_value = (b'{}', [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                array.array('i', fds).tobytes())], flags, None)
            with patch.object(custody.os, 'close') as close, patch.object(custody.os, 'set_inheritable'):
                if valid:
                    self.assertEqual(custody.receive_fd(channel), ({}, 40))
                    close.assert_not_called()
                else:
                    with self.assertRaises(RuntimeError):
                        custody.receive_fd(channel)
                    self.assertEqual([call.args[0] for call in close.call_args_list], fds)


if __name__ == '__main__':
    unittest.main()
