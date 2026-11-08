"""Preinstalled OS witness and generation-checked cleanup for owned startup apps."""
import ctypes
import hashlib
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


def identity(node):
    return {key: node[key] for key in ('pid', 'parent', 'uid', 'start_seconds', 'start_microseconds', 'executable')}


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
    def absent():
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        return False
    def sample():
        info = BSDInfo()
        count = library.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
        if count != ctypes.sizeof(info):
            require(absent())
            return None
        require(info.pid == pid and info.uid == os.getuid() and info.start_seconds > 0
                and 0 <= info.start_microseconds < 1000000)
        path = ctypes.create_string_buffer(4096)
        if library.proc_pidpath(pid, path, len(path)) <= 0:
            require(absent())
            return None
        require(path.value.startswith(b'/'))
        return {'pid': info.pid, 'parent': info.parent, 'uid': info.uid, 'start_seconds': info.start_seconds,
                'start_microseconds': info.start_microseconds, 'executable': os.fsdecode(path.value)}
    before = sample()
    if before is None:
        return None
    after = sample()
    if after is None:
        return None
    require(signature(before) == signature(after) and after['parent'] in (before['parent'], 1))
    return after


class OwnerWitness:
    def __init__(self, config, configuration_sha256, *, uid=None, clock=time.monotonic):
        self.config, self.configuration_sha256 = config, configuration_sha256
        self.uid, self.clock = os.getuid() if uid is None else uid, clock
        self.ready = False
        self.history, self.latest, self.app = {}, [], None
        self.retired, self.unresolved, self.retained_diagnostics = {}, [], []
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
            if record.get('event') == 'failed':
                require(set(record) == {'schema', 'event', 'complete', 'reason', 'retained_identities',
                                        'unresolved', 'observed_uptime_ns'}
                        and record['complete'] is False and record['reason'] == 'ownership_observation_unavailable')
                retained, unresolved = record['retained_identities'], record['unresolved']
                require(isinstance(retained, list) and len(retained) <= 128
                        and isinstance(unresolved, list) and len(unresolved) <= 128)
                for item in retained:
                    require(isinstance(item, dict) and set(item) == {'pid', 'uid', 'start_seconds',
                            'start_microseconds', 'executable_sha256'}
                            and all(type(item[key]) is int for key in ('pid', 'uid', 'start_seconds', 'start_microseconds'))
                            and item['pid'] > 0 and item['uid'] == self.uid and item['start_seconds'] > 0
                            and 0 <= item['start_microseconds'] < 1000000
                            and re.fullmatch('[0-9a-f]{64}', str(item['executable_sha256'])))
                    if item['pid'] in self.history:
                        prior = self.history[item['pid']]
                        require(all(item[key] == prior[key] for key in ('pid', 'uid', 'start_seconds', 'start_microseconds'))
                                and item['executable_sha256'] == hashlib.sha256(prior['executable'].encode()).hexdigest())
                for item in unresolved:
                    require(isinstance(item, dict) and set(item) == {'pid', 'scope', 'reason'}
                            and type(item['pid']) is int and item['pid'] > 0
                            and item['scope'] in ('known', 'app', 'candidate', 'enumerated_child', 'detail', 'children', 'existence')
                            and re.fullmatch(r'(?:(?:bsd|path|existence|children)_(?:denied|unavailable)|identity_changed)',
                                             str(item['reason'])))
                self.retained_diagnostics, self.unresolved = retained, unresolved
                self.failure = 'ownership_observation_unavailable'
                self.condition.notify_all()
                return  # Never erase latest/history or manufacture an empty observation.
            if record.get('event') == 'ready':
                require(not self.ready and not self.history and not self.failure and record.get('nodes') == []
                        and record.get('complete') is True and record.get('retired') == []
                        and record.get('enumerated_exits') == []
                        and record.get('configuration_sha256') == self.configuration_sha256)
                self.ready = True
                self.last_empty = self.last_observation = observed
                self.condition.notify_all()
                return
            require(self.ready and not self.failure and set(record) == {'schema', 'complete', 'nodes', 'retired',
                    'enumerated_exits', 'observed_uptime_ns'} and record['complete'] is True)
            nodes = record.get('nodes')
            require(isinstance(nodes, list) and len(nodes) <= 128)
            current = {}
            new_app, serving_observed = self.app, self.serving_observed
            native = self.config['app_path'] + '/Contents/MacOS/NACPreview'
            engine = self.config['app_path'] + '/Contents/Resources/nac-web'
            for node in nodes:
                require(isinstance(node, dict) and all(type(node.get(key)) is int for key in
                        ('pid', 'parent', 'uid', 'start_seconds', 'start_microseconds')))
                common = {'pid', 'parent', 'uid', 'start_seconds', 'start_microseconds', 'executable',
                          'kind', 'environment', 'environment_role', 'arguments_sha256', 'serving', 'configuration_helper'}
                require(set(node) == common | ({'app_launch_epoch', 'windows'} if node.get('kind') == 'app' else set())
                        and re.fullmatch('[0-9a-f]{64}', str(node.get('arguments_sha256', ''))))
                require(node['pid'] > 0 and node['parent'] > 0 and node['uid'] == self.uid
                        and node['start_seconds'] > 0 and 0 <= node['start_microseconds'] < 1000000
                        and node['pid'] not in current and type(node.get('executable')) is str
                        and Path(node['executable']).is_absolute())
                require(node.get('kind') in ('app', 'engine', 'descendant')
                        and type(node.get('serving')) is bool and type(node.get('configuration_helper')) is bool)
                if node['pid'] in self.history:
                    require(signature(node) == signature(self.history[node['pid']])
                            and node['parent'] in (self.history[node['pid']]['parent'], 1))
                if node['kind'] == 'app':
                    require(node['executable'] == native and type(node.get('app_launch_epoch')) in (int, float)
                            and node['app_launch_epoch'] > 0 and isinstance(node.get('windows'), list)
                            and len(node['windows']) <= 1 and all(type(n) is int and n > 0 for n in node['windows']))
                    if new_app:
                        require(signature(node) == signature(new_app)
                                and node['app_launch_epoch'] == new_app['app_launch_epoch'])
                    new_app = {**node, 'windows': node['windows'] or (new_app or {}).get('windows', [])}
                elif node['kind'] == 'engine':
                    require(node['executable'] == engine)
                else:
                    require(node['executable'] not in (native, engine))
                launcher, child = self.config['environment'], self.config['child_environment']
                require(set(launcher) == set(child) and bool(launcher)
                        and all(child[key] == value for key, value in launcher.items() if key != 'PATH'))
                role = ('launcher' if node['kind'] == 'app' else
                        'descendant' if node['kind'] == 'descendant' else
                        'configuration_helper' if node['configuration_helper'] else 'engine')
                require(node['environment_role'] == role
                        and node['environment'] == (launcher if role == 'launcher' else child)
                        and not any(key.endswith(('_TOKEN', '_API_KEY')) or key == 'NAC_MANAGED_CONFIG'
                                    for key in node['environment'])
                        and (node['configuration_helper'] != node['serving'] if node['kind'] == 'engine'
                             else not node['configuration_helper'] and not node['serving']))
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
                    require(new_app is not None)
                    serving_observed = True
            retired = {}
            require(isinstance(record['retired'], list) and len(record['retired']) <= 128)
            for item in record['retired']:
                require(isinstance(item, dict) and set(item) == {'identity', 'proof'}
                        and item['proof'] == 'kill_zero_ESRCH')
                previous = item['identity']
                require(isinstance(previous, dict) and set(previous) == {'pid', 'parent', 'uid', 'start_seconds',
                        'start_microseconds', 'executable'} and all(type(previous[key]) is int for key in
                        ('pid', 'parent', 'uid', 'start_seconds', 'start_microseconds')))
                pid = previous['pid']
                require(pid in self.history and pid not in current and pid not in retired
                        and signature(previous) == signature(self.history[pid])
                        and previous['parent'] in (self.history[pid]['parent'], 1))
                retired[pid] = item
            require(set(self.history).difference(current) == set(retired))
            exits = record['enumerated_exits']
            require(isinstance(exits, list) and len(exits) <= 128)
            exit_pids = set()
            for item in exits:
                require(isinstance(item, dict) and set(item) == {'pid', 'parent', 'proof'}
                        and type(item['pid']) is int and item['pid'] > 0 and type(item['parent']) is int
                        and item['parent'] in set(self.history) | set(current) and item['proof'] == 'kill_zero_ESRCH'
                        and item['pid'] not in set(self.history) | set(current) | exit_pids)
                exit_pids.add(item['pid'])
            for node in nodes:
                self.history[node['pid']] = node
            self.app, self.serving_observed, self.retired = new_app, serving_observed, retired
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
                        self.failure = self.failure or 'owner_stream_unavailable'
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
                if (self.last_empty is not None and self.last_empty >= after and not self.latest
                        and set(self.retired) == set(self.history)):
                    return True
                self.condition.wait(.05)
        return False

    def signal_owned(self, node, signum, *, inspect=native_identity, send=os.kill):
        require(not self.failure and node['pid'] in self.history and node['pid'] not in self.retired
                and signature(node) == signature(self.history[node['pid']]))
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
        require(self.ready and not self.failure)
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
        require(self.wait_empty(self.clock(), seconds=2) and self.ready and not self.failure
                and not self.latest and set(self.retired) == set(self.history))
        if self.config['scenario'] in ('onboarding', 'configuredLocal'):
            require(self.serving_observed)
        require(self.app is not None)
        return {'root': self.config['fixture_root'], 'owned_processes_settled': True,
                'preinstalled': True, 'app': self.app, 'observed_processes': list(self.history.values()),
                'complete_observation': True, 'retired_identities': list(self.retired.values()),
                'fallback_signals': self.signals, 'scope': 'Actual OS ownership/settlement; not public UI or image acceptance'}

    def failure_receipt(self):
        with self.condition:
            return {'ready': self.ready, 'failure': self.failure, 'known_identities': [identity(node) for node in self.history.values()],
                    'latest_pids': [node['pid'] for node in self.latest], 'retired': list(self.retired.values()),
                    'unresolved': self.unresolved, 'retained_diagnostics': self.retained_diagnostics,
                    'positive_settlement': bool(self.history) and not self.failure and not self.latest
                        and set(self.retired) == set(self.history)}

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


def capture_ax_preflight(witness, helper, source, config_path, folder, *, run,
                         source_sha256, binary_sha256):
    """Explicit one-shot diagnostic only; caller owns admission/fixture/clock.

    Never starts/selects an app, changes trust, or modifies the owner stream.
    `run` is the existing bounded process/clock owner, including failed output.
    Failure receipts are retained before propagating the original helper error.
    """
    helper, source, config_path, folder = map(Path, (helper, source, config_path, folder))
    require(all(path.is_absolute() and path.resolve(strict=True) == path and not path.is_symlink()
                for path in (helper, source, config_path, folder)) and folder.is_dir())
    require(all(re.fullmatch('[0-9a-f]{64}', value or '') for value in (source_sha256, binary_sha256)))
    source_bytes = bounded_file(source, 256 * 1024)
    helper_bytes = bounded_file(helper, 16 * 1024 * 1024)
    configuration = bounded_file(config_path, 32768)
    require(data_digest(source_bytes) == source_sha256 and data_digest(helper_bytes) == binary_sha256
            and data_digest(configuration) == witness.configuration_sha256
            and json.loads(configuration) == witness.config)
    with witness.condition:
        require(witness.ready and not witness.failure and witness.app and len(witness.app['windows']) == 1)
        apps = [node for node in witness.latest if node['kind'] == 'app']
        require(len(apps) == 1 and signature(apps[0]) == signature(witness.app)
                and apps[0]['windows'] == witness.app['windows'])
        binding = {'configuration_sha256': witness.configuration_sha256,
                   'identity': identity(apps[0]), 'window_number': apps[0]['windows'][0]}
    request_bytes = (json.dumps(binding, sort_keys=True) + '\n').encode()
    request, log, receipt = (folder / name for name in ('ax-preflight-request.json', 'ax-preflight.log', 'ax-preflight.json'))
    require(not any(path.exists() or path.is_symlink() for path in (request, log, receipt)))
    with request.open('xb') as stream:
        stream.write(request_bytes)
    request.chmod(0o400)
    original_error = None
    try:
        run([str(helper), '--ax-preflight', str(config_path), str(request)], log, 10,
            abort=lambda: bool(witness.failure))
    except Exception as error:
        original_error = error
    try:
        value = json.loads(bounded_file(log, 8192))
        mandatory = {'schema', 'acceptance', 'trusted', 'windows_read', 'ax_code', 'window_count',
                     'root_matches', 'bound', 'identity_rechecked', 'signing_code', 'app_sandbox_entitlement',
                     'configuration_sha256', 'request_sha256', 'binary_sha256'}
        require(type(value) is dict and mandatory <= set(value) <= mandatory | {'signing_flags'}
                and value['schema'] == 'nac342-ax-preflight-v1' and value['acceptance'] is False)
        require(all(type(value[key]) is bool for key in
                    ('trusted', 'windows_read', 'bound', 'identity_rechecked'))
                and all(type(value[key]) is int for key in ('ax_code', 'window_count', 'root_matches', 'signing_code'))
                and (value['app_sandbox_entitlement'] is None or type(value['app_sandbox_entitlement']) is bool)
                and ('signing_flags' not in value or type(value['signing_flags']) is int))
        require(value['configuration_sha256'] == witness.configuration_sha256
                and value['request_sha256'] == data_digest(request_bytes) and value['binary_sha256'] == binary_sha256
                and 0 <= value['window_count'] <= 128 and 0 <= value['root_matches'] <= value['window_count'])
        require((value['trusted'] or not value['windows_read'])
                and (value['windows_read'] or value['window_count'] == value['root_matches'] == 0)
                and (not value['bound'] or (value['trusted'] and value['windows_read']
                     and value['identity_rechecked'] and value['root_matches'] == 1 and value['ax_code'] == 0)))
        require(data_digest(bounded_file(helper, 16 * 1024 * 1024)) == binary_sha256
                and bounded_file(source, 256 * 1024) == source_bytes
                and bounded_file(config_path, 32768) == configuration)
        with witness.condition:
            require(witness.ready and not witness.failure and witness.app
                    and identity(witness.app) == binding['identity']
                    and witness.app['windows'] == [binding['window_number']])
            apps = [node for node in witness.latest if node['kind'] == 'app']
            require(len(apps) == 1 and identity(apps[0]) == binding['identity']
                    and apps[0]['windows'] == [binding['window_number']])
        value = {**value, 'source_sha256': source_sha256,
                 'scope': 'host AX API availability only; no focus/value/CFEqual/freshness or native acceptance'}
        with receipt.open('xb') as stream:
            stream.write((json.dumps(value, sort_keys=True) + '\n').encode())
    except Exception as capture_error:
        if original_error is not None:
            raise original_error from capture_error
        raise
    if original_error is not None:
        raise original_error
    require(value['bound'] and value['identity_rechecked'])
    return value
