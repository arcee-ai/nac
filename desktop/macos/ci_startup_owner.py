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


_PRODUCER_FAILURE_STAGES = frozenset((
    'unspecified', 'configuration', 'initial_empty', 'ready_emit',
    'resources_candidates', 'include_probe', 'include_admission', 'process_list',
    'pending_limit', 'children', 'arguments', 'arguments_absence',
    'environment', 'detail_probe', 'arguments_hash', 'app_binding',
    'app_launch', 'current_app', 'ancestry', 'known_coverage',
    'known_limit', 'snapshot_record', 'snapshot_emit',
))
_PRODUCER_FAILURE_KINDS = frozenset((
    'process_probe', 'ownership_invalid', 'arguments_unavailable', 'other',
))


def _producer_failure(record):
    """Closed passive projection; malformed annotations never replace original failure."""
    value = record.get('producer_failure')
    if (type(value) is dict and set(value) == {'stage', 'kind'}
            and type(value['stage']) is str and value['stage'] in _PRODUCER_FAILURE_STAGES
            and type(value['kind']) is str and value['kind'] in _PRODUCER_FAILURE_KINDS
            and ((value['kind'] == 'process_probe') == bool(record.get('unresolved')))):
        return {'stage': value['stage'], 'kind': value['kind']}
    return None


def require(condition, code='invalid_record'):
    if not condition:
        error = RuntimeError('Startup process ownership unavailable or ambiguous; preserve fixture')
        error.owner_guard = code  # Static tags only; never exception text or rejected input.
        raise error


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
        self.last_accepted_uptime_ns = 0
        self.stream_diagnostic = None
        self.process_failure = self.ui_failure = None
        self.ui_root = None
        self.ui_terminal = False
        self.stopping = False
        self.process = self.reader = None
        self.helper_settled = False
        self.condition = threading.Condition()
        self.signals = []

    @property
    def failure(self):
        """Sticky UI rejection remains visible to every existing abort caller."""
        return self.ui_failure or self.process_failure

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
                require({'schema', 'event', 'complete', 'reason', 'retained_identities',
                         'unresolved', 'observed_uptime_ns'} <= set(record)
                        <= {'schema', 'event', 'complete', 'reason', 'retained_identities',
                            'unresolved', 'observed_uptime_ns', 'producer_failure'}
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
                self.process_failure = self.process_failure or 'ownership_observation_unavailable'
                self.condition.notify_all()
                return  # Never erase latest/history or manufacture an empty observation.
            if record.get('event') == 'ready':
                require(not self.ready and not self.history and not self.failure and record.get('nodes') == []
                        and record.get('complete') is True and record.get('retired') == []
                        and record.get('enumerated_exits') == []
                        and record.get('configuration_sha256') == self.configuration_sha256)
                self.ready = True
                self.last_accepted_uptime_ns = int(stamp)
                self.last_empty = self.last_observation = observed
                self.condition.notify_all()
                return
            require(self.ready and not self.process_failure and set(record) == {'schema', 'complete', 'nodes', 'retired',
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
                            and node['app_launch_epoch'] > 0)
                    require(isinstance(node.get('windows'), list) and len(node['windows']) <= 128
                            and all(type(n) is int and 0 < n < 2**64 for n in node['windows'])
                            and len(set(node['windows'])) == len(node['windows']),
                            'app_windows')
                    if new_app:
                        require(signature(node) == signature(new_app)
                                and node['app_launch_epoch'] == new_app['app_launch_epoch'])
                    new_app = node
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
            # Only a wholly valid process record can update either custody or
            # UI state. CG cardinality is UI policy, never signal authority.
            apps = [node for node in nodes if node['kind'] == 'app']
            if apps:
                windows = apps[0]['windows']
                if self.ui_root is None and not self.ui_failure and not self.ui_terminal and len(windows) == 1:
                    self.ui_root = windows[0]
                interaction_contract = (self.config.get('scenario') == 'configuredLocal'
                                        and type(self.config.get('ax_witness')) is dict)
                invalid_inventory = (self.ui_root is None and len(windows) > 1) or (
                    self.ui_root is not None and windows and (
                        self.ui_root not in windows if interaction_contract else windows != [self.ui_root]))
                if invalid_inventory:
                    self.ui_failure = self.ui_failure or 'app_windows'
                if self.ui_root is not None and not windows:
                    self.ui_terminal = True
                if self.ui_terminal and windows:
                    self.ui_failure = self.ui_failure or 'app_window_reappeared'
                # Historical binding for read-only attachment/retirement checks;
                # never replace the original root with a later singleton.
                new_app = {**new_app, 'windows': [self.ui_root] if self.ui_root is not None else []}
            elif self.app is not None:
                self.ui_terminal = True
            for node in nodes:
                self.history[node['pid']] = node
            self.app, self.serving_observed, self.retired = new_app, serving_observed, retired
            self.latest = nodes
            self.last_observation = observed
            self.last_accepted_uptime_ns = int(stamp)
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
        self.reader = threading.Thread(target=lambda: self._read_stream(self.process.stdout), daemon=True)
        self.reader.start()
        deadline = self.clock() + 5
        with self.condition:
            while not self.ready and not self.failure and self.clock() < deadline:
                self.condition.wait(.05)
        if not self.ready or self.failure:
            self.stop()
            require(False)

    def _read_stream(self, stream):
        """The existing reader owns framing; diagnostics never grant ownership."""
        stage, line, record = 'read', b'', None
        try:
            while True:
                stage, line, record = 'read', b'', None
                line = stream.readline(65537)
                if not line:
                    stage = 'eof'
                    require(self.stopping)  # EOF never proves application settlement.
                    break
                stage = 'framing'
                require(len(line) <= 65536, 'oversize')
                require(line.endswith(b'\n'), 'missing_newline')
                stage = 'json'
                record = json.loads(line)
                stage = 'record_validation'
                self.observe(record)
                if self.failure:
                    self._retain_stream_diagnostic(stage, 'typed_failure' if self.process_failure else 'app_windows', len(line), record)
        except BaseException as error:
            with self.condition:
                if not self.stopping:
                    self.process_failure = self.process_failure or 'owner_stream_unavailable'
                    code = ('unexpected_eof' if stage == 'eof' else
                            'invalid_json' if stage == 'json' else
                            'io_error' if stage == 'read' and isinstance(error, OSError) else
                            getattr(error, 'owner_guard', 'other'))
                    self._retain_stream_diagnostic(stage, code, len(line), record)
                self.condition.notify_all()

    def _retain_stream_diagnostic(self, stage, code, byte_count, record):
        # Failure-side best effort. No rejected bytes, paths, environments,
        # exception strings or AX values cross this boundary.
        try:
            with self.condition:
                if self.stream_diagnostic is not None:
                    return
                stages = {'read', 'framing', 'json', 'record_validation', 'eof'}
                codes = {'unexpected_eof', 'invalid_json', 'io_error', 'oversize',
                         'missing_newline', 'app_windows', 'invalid_record', 'typed_failure'}
                shape = None
                if (type(record) is dict and set(record) == {'schema', 'complete', 'nodes', 'retired',
                        'enumerated_exits', 'observed_uptime_ns'} and record['schema'] == 'nac342-owner-v1'
                        and record['complete'] is True and type(record['nodes']) is list
                        and len(record['nodes']) <= 128):
                    common = {'pid', 'parent', 'uid', 'start_seconds', 'start_microseconds', 'executable',
                              'kind', 'environment', 'environment_role', 'arguments_sha256', 'serving', 'configuration_helper'}
                    nodes = record['nodes']
                    if all(type(n) is dict and n.get('kind') in ('app', 'engine', 'descendant')
                           and set(n) == common | ({'windows', 'app_launch_epoch'} if n['kind'] == 'app' else set())
                           for n in nodes):
                        apps = [n for n in nodes if n['kind'] == 'app']
                        if len(apps) == 1:
                            windows = apps[0]['windows']
                            if (type(windows) is list and len(windows) <= 128
                                    and all(type(n) is int and 0 < n < 2**64 for n in windows)):
                                original = (self.app or {}).get('windows', [])
                                shape = dict(app_count=1, window_count=len(windows),
                                    original_window_present=bool(original) and original[0] in windows)
                        elif not apps:
                            shape = dict(app_count=0, window_count=0, original_window_present=False)
                        else:
                            shape = dict(app_count=len(apps))
                observed = int(self.clock() * 1e9)
                if not 0 <= observed < 2**64:
                    return
                self.stream_diagnostic = dict(schema='nac342-owner-stream-diagnostic-v1', acceptance=False,
                    stage=stage if stage in stages else 'read', code=code if code in codes else 'other',
                    clock_basis='time.monotonic', observed_uptime_ns=str(observed),
                    last_accepted_uptime_ns=str(self.last_accepted_uptime_ns),
                    byte_count=min(byte_count, 65537), shape=shape)
                if code == 'typed_failure' and type(record) is dict and record.get('event') == 'failed':
                    projection = _producer_failure(record)
                    if projection is not None:
                        self.stream_diagnostic['producer_failure'] = projection
        except BaseException:
            pass  # Missing diagnostics cannot change the original failure/custody.

    def attachment_binding(self):
        with self.condition:
            require(self.ready and self.app and not self.failure and self.ui_root is not None)
            # Historical export only: this binding does not grant live input.
            return {'preinstalled': True, 'owned_incarnation_verified': True,
                    'app_pid': self.app['pid'], 'app_launch_epoch': self.app['app_launch_epoch'],
                    'window_number': self.app['windows'][0], 'app_path': self.config['app_path'],
                    'native_sha256': self.config['native_sha256']}

    def wait_empty(self, after, seconds=25):
        deadline = self.clock() + seconds
        with self.condition:
            while self.clock() < deadline and not self.process_failure:
                if (self.last_empty is not None and self.last_empty >= after and not self.latest
                        and set(self.retired) == set(self.history)):
                    return True
                self.condition.wait(.05)
        return False

    def signal_owned(self, node, signum, *, inspect=native_identity, send=os.kill):
        with self.condition:
            require(not self.process_failure and node['pid'] in self.history and node['pid'] not in self.retired
                    and signature(node) == signature(self.history[node['pid']])
                    and node['parent'] in (self.history[node['pid']]['parent'], 1))
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
        require(self.ready and not self.process_failure)
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
        require(self.wait_empty(self.clock(), seconds=2) and self.ready and not self.process_failure
                and not self.latest and set(self.retired) == set(self.history))
        if self.config['scenario'] in ('onboarding', 'configuredLocal'):
            require(self.serving_observed)
        require(self.app is not None)
        return {'root': self.config['fixture_root'], 'owned_processes_settled': True,
                'preinstalled': True, 'ui_failure': self.ui_failure, 'app': self.app, 'observed_processes': list(self.history.values()),
                'complete_observation': True, 'retired_identities': list(self.retired.values()),
                'fallback_signals': self.signals, 'scope': 'Actual OS ownership/settlement; not public UI or image acceptance'}

    def failure_receipt(self):
        with self.condition:
            return {'ready': self.ready, 'failure': self.failure, 'known_identities': [identity(node) for node in self.history.values()],
                    'process_failure': self.process_failure, 'ui_failure': self.ui_failure,
                    'original_window_number': self.ui_root, 'ui_terminal': self.ui_terminal,
                    'latest_pids': [node['pid'] for node in self.latest], 'retired': list(self.retired.values()),
                    'unresolved': self.unresolved, 'retained_diagnostics': self.retained_diagnostics,
                    'stream_diagnostic': self.stream_diagnostic,
                    'metadata_helper_settled': self.helper_settled,
                    'positive_process_settlement': bool(self.history) and not self.process_failure and not self.latest
                        and set(self.retired) == set(self.history),
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
            require(self.process.poll() is not None and not self.reader.is_alive())
            self.helper_settled = True


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
        require(witness.ready and not witness.failure and not witness.ui_terminal and witness.app and len(witness.app['windows']) == 1)
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
            require(witness.ready and not witness.failure and not witness.ui_terminal and witness.app
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
