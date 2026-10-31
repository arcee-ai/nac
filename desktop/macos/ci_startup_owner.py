"""Preinstalled OS witness and generation-checked cleanup for owned startup apps."""
import ctypes
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import threading
import time

from ci_startup_fixture import digest
from ci_xctest_attachments import bounded_file
from ci_xctest_attachments import digest as data_digest


def require(condition):
    if not condition:
        raise RuntimeError('Startup process ownership unavailable or ambiguous; preserve fixture')


def signature(node):
    return tuple(node[key] for key in ('pid', 'start_seconds', 'start_microseconds', 'uid', 'executable'))


class BSDInfo(ctypes.Structure):
    # SDK sys/proc_info.h proc_bsdinfo ABI, also compiled in the Swift witness.
    _fields_ = [(name, ctypes.c_uint32) for name in
                ('flags', 'status', 'xstatus', 'pid', 'parent', 'uid', 'gid', 'ruid', 'rgid', 'svuid', 'svgid', 'reserved')]
    _fields_ += [('comm', ctypes.c_char * 16), ('name', ctypes.c_char * 32)]
    _fields_ += [(name, ctypes.c_uint32) for name in ('files', 'group', 'jobs', 'tdev', 'tpgid')]
    _fields_ += [('nice', ctypes.c_int32), ('start_seconds', ctypes.c_uint64), ('start_microseconds', ctypes.c_uint64)]


def native_identity(pid):
    """Recheck kernel start/path/UID immediately before a narrowly owned signal."""
    require(type(pid) is int and pid > 0)
    library = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    library.proc_pidinfo.argtypes = (ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int)
    library.proc_pidpath.argtypes = (ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32)
    info = BSDInfo()
    count = library.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
    if count == 0:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return None
        require(False)
    require(count == ctypes.sizeof(info) and info.pid == pid and info.uid == os.getuid())
    path = ctypes.create_string_buffer(4096)
    require(library.proc_pidpath(pid, path, len(path)) > 0)
    return {'pid': info.pid, 'parent': info.parent, 'uid': info.uid, 'start_seconds': info.start_seconds,
            'start_microseconds': info.start_microseconds, 'executable': os.fsdecode(path.value)}


class OwnerWitness:
    def __init__(self, config, configuration_sha256, *, uid=None, clock=time.monotonic):
        self.config, self.configuration_sha256 = config, configuration_sha256
        self.uid, self.clock = os.getuid() if uid is None else uid, clock
        self.ready = False
        self.history, self.latest, self.app = {}, [], None
        self.serving_observed = False
        self.last_observation = self.last_empty = None
        self.last_uptime_ns = 0
        self.failure = None
        self.stopping = False
        self.process = self.reader = None
        self.condition = threading.Condition()
        self.signals = []

    def observe(self, record):
        """Validate actual helper records; portable tests supply explicit fixtures."""
        with self.condition:
            require(isinstance(record, dict) and record.get('schema') == 'nac342-owner-v1')
            stamp = record.get('observed_uptime_ns')
            require(isinstance(stamp, str) and re.fullmatch('[0-9]{1,20}', stamp)
                    and self.last_uptime_ns < int(stamp) < 2**64 and int(stamp) / 1e9 <= self.clock() + 1)
            observed = int(stamp) / 1e9
            self.last_uptime_ns = int(stamp)
            if record.get('event') == 'ready':
                require(not self.ready and not self.history and record.get('nodes') == []
                        and record.get('configuration_sha256') == self.configuration_sha256)
                self.ready = True
                self.last_empty = self.last_observation = observed
                self.condition.notify_all()
                return
            require(self.ready and 'event' not in record)
            nodes = record.get('nodes')
            require(isinstance(nodes, list) and len(nodes) <= 128)
            current = {}
            native = self.config['app_path'] + '/Contents/MacOS/NACPreview'
            engine = self.config['app_path'] + '/Contents/Resources/nac-web'
            for node in nodes:
                require(isinstance(node, dict) and all(type(node.get(key)) is int for key in
                        ('pid', 'parent', 'uid', 'start_seconds', 'start_microseconds')))
                common = {'pid', 'parent', 'uid', 'start_seconds', 'start_microseconds', 'executable',
                          'kind', 'environment', 'arguments_sha256', 'serving', 'configuration_helper'}
                require(set(node) == common | ({'app_launch_epoch', 'windows'} if node.get('kind') == 'app' else set())
                        and re.fullmatch('[0-9a-f]{64}', str(node.get('arguments_sha256', ''))))
                require(node['pid'] > 0 and node['parent'] > 0 and node['uid'] == self.uid
                        and node['start_seconds'] > 0 and 0 <= node['start_microseconds'] < 1000000
                        and node['pid'] not in current and type(node.get('executable')) is str
                        and Path(node['executable']).is_absolute()
                        and node.get('environment') == self.config['environment'])
                require(node.get('kind') in ('app', 'engine', 'descendant')
                        and type(node.get('serving')) is bool and type(node.get('configuration_helper')) is bool)
                if node['pid'] in self.history:
                    require(signature(node) == signature(self.history[node['pid']])
                            and node['parent'] in (self.history[node['pid']]['parent'], 1))
                if node['kind'] == 'app':
                    require(node['executable'] == native and type(node.get('app_launch_epoch')) in (int, float)
                            and node['app_launch_epoch'] > 0 and isinstance(node.get('windows'), list)
                            and len(node['windows']) <= 1 and all(type(n) is int and n > 0 for n in node['windows']))
                    if self.app:
                        require(signature(node) == signature(self.app)
                                and node['app_launch_epoch'] == self.app['app_launch_epoch'])
                    self.app = {**node, 'windows': node['windows'] or (self.app or {}).get('windows', [])}
                elif node['kind'] == 'engine':
                    require(node['executable'] == engine)
                else:
                    require(node['executable'] not in (native, engine))
                current[node['pid']] = node
            require(sum(node['kind'] == 'app' for node in nodes) <= 1)
            for node in nodes:
                if node['kind'] == 'app':
                    continue
                parent, visited, owned = node['parent'], set(), False
                while parent in current and parent not in visited:
                    visited.add(parent)
                    ancestor = current[parent]
                    if ancestor['kind'] == 'app':
                        owned = True
                        break
                    parent = ancestor['parent']
                require(owned or node['pid'] in self.history)
                if node['kind'] == 'engine' and node['serving']:
                    require(self.app is not None)
                    self.serving_observed = True
            for node in nodes:
                self.history[node['pid']] = node
            self.latest = nodes
            self.last_observation = observed
            if not nodes:
                self.last_empty = self.last_observation
            self.condition.notify_all()

    def start(self, helper, config_path):
        data = bounded_file(config_path, 32 * 1024)
        require(self.process is None and Path(config_path).resolve() == Path(config_path)
                and data_digest(data) == self.configuration_sha256 and json.loads(data) == self.config)
        for name, expected in (('Contents/MacOS/NACPreview', 'native_sha256'),
                               ('Contents/Resources/nac-web', 'engine_sha256')):
            file = Path(self.config['app_path']) / name
            require(not file.is_symlink() and file.resolve() == file and digest(file) == self.config[expected])
        self.process = subprocess.Popen([str(helper), str(config_path)], stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, start_new_session=True)
        def read():
            try:
                while line := self.process.stdout.readline(65537):
                    require(len(line) <= 65536 and line.endswith(b'\n'))
                    self.observe(json.loads(line))
                require(self.stopping)  # Unexpected EOF never proves application settlement.
            except BaseException:
                with self.condition:
                    if not self.stopping:
                        self.failure = 'owner_stream_unavailable'
                    self.condition.notify_all()
        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()
        deadline = self.clock() + 5
        with self.condition:
            while not self.ready and not self.failure and self.clock() < deadline:
                self.condition.wait(.05)
        if not self.ready or self.failure:
            self.stop()
            require(False)

    def attachment_binding(self):
        with self.condition:
            require(self.ready and self.app and not self.failure and len(self.app['windows']) == 1)
            return {'preinstalled': True, 'owned_incarnation_verified': True,
                    'app_pid': self.app['pid'], 'app_launch_epoch': self.app['app_launch_epoch'],
                    'window_number': self.app['windows'][0], 'app_path': self.config['app_path'],
                    'native_sha256': self.config['native_sha256']}

    def wait_empty(self, after, seconds=25):
        deadline = self.clock() + seconds
        with self.condition:
            while self.clock() < deadline and not self.failure:
                if self.last_empty is not None and self.last_empty >= after and not self.latest:
                    return True
                self.condition.wait(.05)
        return False

    def signal_owned(self, node, signum, *, inspect=native_identity, send=os.kill):
        require(node['pid'] in self.history and signature(node) == signature(self.history[node['pid']]))
        actual = inspect(node['pid'])
        if actual is None:
            return
        require(signature(actual) == signature(node)
                and (actual['parent'] == node['parent'] or actual['parent'] == 1))
        try:
            send(node['pid'], signum)
        except ProcessLookupError:
            return
        self.signals.append({'pid': node['pid'], 'signal': int(signum), 'kernel_identity_rechecked': True})

    def settle(self, after):
        if not self.wait_empty(after, seconds=2):
            # Only identities positively witnessed before failure can receive a
            # fallback signal, with a fresh kernel signature recheck each time.
            for signum in (signal.SIGTERM, signal.SIGKILL):
                with self.condition:
                    nodes = list(self.latest)
                for node in nodes:
                    self.signal_owned(node, signum)
                if self.wait_empty(self.clock(), seconds=5):
                    break
        require(self.wait_empty(self.clock(), seconds=2) and self.ready and not self.failure)
        if self.config['scenario'] in ('onboarding', 'configuredLocal'):
            require(self.serving_observed)
        require(self.app is not None)
        return {'root': self.config['fixture_root'], 'owned_processes_settled': True,
                'preinstalled': True, 'app': self.app, 'observed_processes': list(self.history.values()),
                'fallback_signals': self.signals, 'scope': 'Actual OS ownership/settlement; not public UI or image acceptance'}

    def stop(self):
        self.stopping = True
        if self.process:
            if self.process.poll() is None:
                self.process.terminate()  # Our direct read-only helper, never an app JSON PID.
                try:
                    self.process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=3)
            self.process.stdout.close()
            self.reader.join(timeout=3)
