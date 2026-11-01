"""Post-drop controller lifeline and retained PID1 identity; Linux runtime only."""
import array
import json
import os
from pathlib import Path
import re
import select
import signal
import socket
import struct
import threading

from contract import require


def send_fd(channel, value, fd):
    payload = json.dumps(value).encode()
    require(len(payload) <= 1024, 'LIFELINE_PACKET_BOUND')
    require(channel.sendmsg([payload], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
            array.array('i', [fd]))]) == len(payload), 'LIFELINE_SEND')


def receive_fd(channel):
    descriptors = []
    try:
        payload, ancillary, flags, _ = channel.recvmsg(1024, socket.CMSG_SPACE(4*4),
                                                      getattr(socket, 'MSG_CMSG_CLOEXEC', 0))
        for level, kind, data in ancillary:
            require(level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS, 'LIFELINE_ANCILLARY')
            values = array.array('i')
            values.frombytes(data[:len(data)-(len(data) % values.itemsize)])
            descriptors.extend(values)
        require(not flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC) and
                len(descriptors) == 1 and payload, 'LIFELINE_PACKET')
        value = json.loads(payload)
        os.set_inheritable(descriptors[0], False)
        return value, descriptors.pop()
    finally:
        for fd in descriptors:
            os.close(fd)


class Kernel:
    @staticmethod
    def ready(fd, milliseconds=0):
        poller = select.poll()
        poller.register(fd, select.POLLIN)
        events = poller.poll(milliseconds)
        require(all(not bits & (select.POLLNVAL | select.POLLERR) for _, bits in events), 'PIDFD_INVALID')
        return any(bits & (select.POLLIN | select.POLLHUP) for _, bits in events)

    @staticmethod
    def own_pidfd():
        return os.pidfd_open(os.getpid())

    @staticmethod
    def pid(fd):
        # A real pidfd has a kernel-generated Pid field; arbitrary passed files
        # cannot qualify. Poll bookends bind proc reads to the still-live task.
        text = Path('/proc/self/fdinfo/'+str(fd)).read_text()
        match = re.search(r'^Pid:[ \t]+(-?\d+)$', text, re.M)
        require(match is not None, 'NOT_A_PIDFD')
        return int(match[1])

    @staticmethod
    def peer(channel):
        return struct.unpack('3i', channel.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))

    def prove_pid1(self, fd, peer, wrapper, context):
        pid, uid, gid = peer
        require((uid, gid) == (context['uid'], context['gid']) and pid > 1, 'PID1_PEER_IDENTITY')
        require(not self.ready(fd) and self.pid(fd) == pid, 'PID1_HANDLE_IDENTITY')
        status = Path(f'/proc/{pid}/status').read_text()
        nspid = re.search(r'^NSpid:[ \t]+([0-9 \t]+)$', status, re.M)
        require(nspid is not None and len(nspid[1].split()) > 1 and
                int(nspid[1].split()[-1]) == 1, 'PEER_NOT_NAMESPACE_INIT')
        # Namespace symlinks can be unreadable after setuid resets dumpability.
        # NSpid proves private PID1 here; bootstrap separately proves net/pid
        # inode separation before sending this handle. Never relax credentials.
        # Only the supplied peer and its bounded parent chain are inspected.
        # The retained, unreaped wrapper is the ownership anchor, not getppid()
        # inside PID1 (where a parent in an ancestor namespace appears as zero).
        require(wrapper.poll() is None, 'WRAPPER_DIED_DURING_BIND')
        chain, current = [], pid
        for _ in range(12):
            if current == wrapper.pid:
                break
            stat = Path(f'/proc/{current}/stat').read_text().rsplit(')', 1)[1].split()
            chain.append((current, int(stat[1]), int(stat[19])))
            current = int(stat[1])
            require(current > 1, 'PID1_NOT_OWNED_DESCENDANT')
        require(current == wrapper.pid, 'PID1_NOT_OWNED_DESCENDANT')
        for member, parent, birth in chain:
            stat = Path(f'/proc/{member}/stat').read_text().rsplit(')', 1)[1].split()
            require((int(stat[1]), int(stat[19])) == (parent, birth), 'PID1_PARENT_RACE')
        require(wrapper.poll() is None and not self.ready(fd), 'PID1_PARENT_RACE')
        return {'peer_host_pid': pid, 'peer_uid': uid, 'peer_gid': gid,
                'namespace_pid': 1, 'nspid': nspid[1].split(),
                'retained_wrapper_pid': wrapper.pid, 'parent_chain_bookended': True}

    @staticmethod
    def kill(fd):
        signal.pidfd_send_signal(fd, signal.SIGKILL)


class NamespaceCustody:
    def __init__(self, context, *, kernel=None, listener=None):
        self.context, self.kernel = context, kernel or Kernel()
        self.channel, self.pidfd = None, None
        self.proof = None
        self.server = listener or socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        if listener is None:
            require(len(os.fsencode(context['lifeline_socket'])) < 108, 'LIFELINE_PATH_BOUND')
            self.server.set_inheritable(False)
            self.server.bind(context['lifeline_socket'])
            self.server.listen(1)
        self.server.settimeout(5)

    def bind(self, wrapper):
        channel, _ = self.server.accept()
        self.channel = channel
        channel.set_inheritable(False)
        channel.settimeout(5)
        value, fd = receive_fd(channel)
        try:
            require(value == {'version': 1, 'nonce': self.context['lifeline_nonce']}, 'LIFELINE_CHALLENGE')
            proof = self.kernel.prove_pid1(fd, self.kernel.peer(channel), wrapper, self.context)
            # Retain the verified handle BEFORE ACK can admit any product work.
            self.pidfd, fd, self.proof = fd, None, proof
            controller = self.kernel.own_pidfd()
            try:
                require(not self.kernel.ready(controller), 'CONTROLLER_ALREADY_DEAD')
                send_fd(channel, {'version': 1, 'nonce': self.context['lifeline_nonce'],
                                 'controller_pid': self.context['controller_pid']}, controller)
            finally:
                os.close(controller)
        finally:
            if fd is not None:
                os.close(fd)

    def retire(self):
        record = {'state': 'UNRESOLVED', 'proof': self.proof, 'signals': [],
                  'pid1_death_verified': False, 'first_error': None}
        # Closing this peer is a credential-independent cancellation request.
        if self.channel is not None:
            self.channel.close()
            self.channel = None
        if self.pidfd is None:
            record['first_error'] = 'PID1_HANDLE_UNBOUND'
            return record
        try:
            if not self.kernel.ready(self.pidfd, 3000):
                record['first_error'] = 'PID1_OUTLIVED_WRAPPER'
                self.kernel.kill(self.pidfd)
                record['signals'].append('verified PID1 pidfd SIGKILL')
            if self.kernel.ready(self.pidfd, 3000):
                record.update(state='RETIRED', pid1_death_verified=True)
            else:
                record['first_error'] = record['first_error'] or 'PID1_DEATH_UNPROVEN'
        except BaseException:
            record['first_error'] = record['first_error'] or 'PID1_RETIREMENT_UNRESOLVED'
        return record

    def close(self):
        if self.channel is not None:
            self.channel.close()
        if self.pidfd is not None:
            os.close(self.pidfd)
        self.server.close()
        path = Path(self.context['lifeline_socket'])
        if path.exists():
            path.unlink()


class Lifeline:
    """Established after final credential change; no PR_SET_PDEATHSIG dependency."""
    def __init__(self, context, *, kernel=None, channel=None, thread_factory=threading.Thread,
                 die=os._exit):
        self.kernel, self.die = kernel or Kernel(), die
        self.channel = channel or socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        self.controller_fd = None
        self.stopping, self.started = threading.Event(), threading.Event()
        self.thread = None
        try:
            self.channel.set_inheritable(False)
            self.channel.settimeout(5)
            if channel is None:
                self.channel.connect(context['lifeline_socket'])
            peer_pid, uid, gid = self.kernel.peer(self.channel)
            require(peer_pid == 0 and (uid, gid) == (context['uid'], context['gid']), 'CONTROLLER_PEER_IDENTITY')
            own = self.kernel.own_pidfd()
            try:
                require(self.kernel.pid(own) == 1 and not self.kernel.ready(own), 'NOT_LIVE_PID1')
                send_fd(self.channel, {'version': 1, 'nonce': context['lifeline_nonce']}, own)
            finally:
                os.close(own)
            answer, self.controller_fd = receive_fd(self.channel)
            require(answer == {'version': 1, 'nonce': context['lifeline_nonce'],
                               'controller_pid': context['controller_pid']}, 'CONTROLLER_ACK')
            # The held controller is in an ancestor namespace: kernel PID view0,
            # authenticated on the private peer, not a guessed visible parent PID.
            require(self.kernel.pid(self.controller_fd) == 0 and not self.kernel.ready(self.controller_fd),
                    'CONTROLLER_DIED_BEFORE_WATCH')
            self.channel.settimeout(None)
            self.thread = thread_factory(target=self.watch, daemon=True)
            self.thread.start()
            require(self.started.wait(1) and not self.kernel.ready(self.controller_fd), 'LIFELINE_NOT_ARMED')
            self.proof = {'state': 'VERIFIED_POST_DROP', 'controller_host_pid': context['controller_pid'],
                          'controller_pidfd_held': True, 'socket_eof_watch': True}
        except BaseException:
            self.close()
            raise

    def watch(self):
        try:
            poller = select.poll()
            poller.register(self.controller_fd, select.POLLIN)
            poller.register(self.channel.fileno(), select.POLLIN | select.POLLHUP | select.POLLERR)
            if poller.poll(0):
                self.die(91)
                return
            self.started.set()
            poller.poll()
            if not self.stopping.is_set():
                # Private PID1 exit invokes kernel namespace retirement, even
                # while workload I/O blocks or credential changes clear signals.
                # A watch returning unexpectedly also fails closed.
                self.die(91)
        except BaseException:
            self.die(91)

    def close(self):
        self.stopping.set()
        try:
            self.channel.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        if self.thread is not None:
            self.thread.join(timeout=1)
            if self.thread.is_alive():
                self.die(91)
        self.channel.close()
        if self.controller_fd is not None:
            os.close(self.controller_fd)


def execute_namespace(argv, cwd, environment, output, custody, run_owned):
    first = None
    try:
        run_owned(argv, cwd, environment, output, 'private-namespace', 1260,
                  on_spawn=custody.bind, hash_streams=False)
    except BaseException:
        first = 'FINITE_EVIDENCE_FAILED'
    retirement = custody.retire()
    if retirement['state'] != 'RETIRED':
        first = first or 'NAMESPACE_RETIREMENT_UNRESOLVED'
    elif retirement['first_error']:
        first = first or retirement['first_error']
    return first, retirement
