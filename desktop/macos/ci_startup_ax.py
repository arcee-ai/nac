"""One finite read-only AX companion; ci.run remains its sole process owner."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import threading
import time

from ci_paths_budget import active, check, time_limit, using
from ci_startup_owner import native_identity, signature
from ci_xctest import runner_environment
from ci_xctest_attachments import bounded_file

SUPPORT = ('StartupAXGuard.swift', 'StartupAXReceipt.swift')


def require(value, reason):
    if not value:
        raise RuntimeError(reason)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def declaration(profile, helper, tests):
    check()
    folder = profile['root'] / 'ax-witness'
    require(not folder.exists() and helper.is_absolute() and helper.resolve() == helper, 'AX declaration paths')
    folder.mkdir(mode=0o700)
    time_limit(300, 15)
    from ci import RUN_DEADLINE
    bound = active()
    deadline = min(bound.deadline if bound is not None else RUN_DEADLINE, RUN_DEADLINE) - 15
    require(deadline > time.monotonic(), 'AX original work allowance')
    return dict(path=str(folder / 'receipt.json'), nonce=secrets.token_hex(32), helper_path=str(helper),
        helper_sha256=digest(helper), support_sha256={name: digest(tests / 'desktop/macos/startup_xctest' / name) for name in SUPPORT},
        owner_pid=os.getpid(), deadline_ns=str(int(deadline * 1_000_000_000)))


class AXCompanion:
    def __init__(self, witness, config, config_path, helper, folder, run=None):
        self.witness, self.config, self.config_path = witness, config, config_path
        if run is None:
            from ci import run
        self.helper, self.folder, self.run = helper, folder, run
        self.phase = {}
        self.declaration = config['ax_witness']
        self.bound = active()
        self.thread = None
        self.finished = threading.Event()
        self.stopping = False
        self.error = None
        self.identity = None
        self.terminal = None

    @property
    def failure(self):
        if self.error is not None or (self.finished.is_set() and not self.stopping):
            return 'ax_companion_unavailable'
        return None

    def start(self):
        require(self.thread is None and self.witness.ready and not self.witness.failure, 'AX metadata owner not ready')
        self.case_deadline_ns = min(int(self.declaration['deadline_ns']), int((time.monotonic() + time_limit(300)) * 1e9))
        def owned():
            try:
                with using(self.bound):
                    remaining = self.case_deadline_ns / 1e9 - time.monotonic()
                    require(remaining > 0, 'AX companion original deadline')
                    self.phase = dict(started_epoch=time.time(), cap_seconds=min(300, remaining))
                    self.run([str(self.helper), '--ax-witness', str(self.config_path), str(self.case_deadline_ns)], self.folder / 'ax-companion.log',
                             min(300, remaining), env=runner_environment(), abort=lambda: bool(self.witness.failure), retain_ownership=True)
            except BaseException as error:
                self.error = error
            finally:
                self.phase['ended_epoch'] = time.time()
                self.finished.set()
        self.thread = threading.Thread(target=owned, daemon=True)
        self.thread.start()
        deadline = time.monotonic() + time_limit(5)
        while time.monotonic() < deadline:
            check()
            require(not self.failure, 'AX companion exited before readiness')
            try:
                row = json.loads(bounded_file(Path(self.declaration['path']), 8192))
            except FileNotFoundError:
                time.sleep(.01)
                continue
            require(row['schema'] == 'nac342-ax-witness-v1' and row['status'] == 'waiting' and row['sequence'] == '0'
                and row['nonce'] == self.declaration['nonce'] and row['trusted'] is True
                and row['case_deadline_ns'] == str(self.case_deadline_ns)
                and row['configuration_sha256'] == digest(self.config_path)
                and row['helper_sha256'] == self.declaration['helper_sha256']
                and row['support_sha256'] == self.declaration['support_sha256'], 'AX companion readiness binding')
            identity = row['helper']
            actual = native_identity(identity['pid'])
            require(actual is not None and all(actual[key] == identity[key] for key in identity)
                and identity['parent'] == os.getpid() and identity['executable'] == str(self.helper), 'AX helper kernel identity')
            self.identity = identity
            return
        raise RuntimeError('AX companion readiness cutoff')

    def stop(self):
        if self.thread is None:
            return None
        self.stopping = True
        path = Path(self.declaration['path'] + '.stop')
        temporary = path.with_suffix('.next')
        require(path.parent.resolve() == path.parent and not path.exists() and not temporary.exists(), 'AX stop custody')
        with temporary.open('xb') as stream:
            stream.write(self.declaration['nonce'].encode())
        temporary.chmod(0o400)
        os.replace(temporary, path)
        self.thread.join(timeout=time_limit(20))
        require(not self.thread.is_alive(), 'AX companion process owner not settled')
        if self.error is not None:
            raise self.error
        log = self.folder / 'ax-companion.log.ownership.json'
        owner = json.loads(bounded_file(log, 32768))
        require(owner['accepted'] and owner['reaped'] and owner['drain_settled']
            and not owner['unknown'] and owner['teardown_error'] is None, 'AX companion positive settlement')
        row = json.loads(bounded_file(Path(self.declaration['path']), 8192))
        if row.get('status') in ('retired', 'retiring'):
            require(row['schema'] == 'nac342-ax-witness-v1' and row['trusted'] is True
                and row['nonce'] == self.declaration['nonce'] and row['helper'] == self.identity
                and row['configuration_sha256'] == digest(self.config_path)
                and row['helper_sha256'] == self.declaration['helper_sha256']
                and row['support_sha256'] == self.declaration['support_sha256']
                and row['case_deadline_ns'] == str(self.case_deadline_ns)
                and row.get('observation') is None and row.get('refusal') is None
                and row['refusal_stage'] == 'target_' + row['status'], 'AX terminal receipt binding')
            self.terminal = {key: row[key] for key in ('target', 'app_launch_epoch', 'window_number', 'status')}
        return dict(owned_processes_settled=True, helper=self.identity, helper_sha256=self.declaration['helper_sha256'], phase=self.phase,
                    scope='Read-only AX companion only; not app/UI acceptance')


    def reconcile_retirement(self, settled, collection):
        if self.terminal is None:
            return {'terminal_observed': False}
        require(collection is not None and collection.get('complete') is True
            and settled.get('owned_processes_settled') is True and settled.get('complete_observation') is True,
            'AX retirement requires complete case and metadata settlement')
        app, target = settled['app'], self.terminal['target']
        require(signature(app) == signature(target) and app['windows'] == [self.terminal['window_number']]
            and app['app_launch_epoch'] == self.terminal['app_launch_epoch'], 'AX retired target differs')
        history = settled['observed_processes']
        retired = settled['retired_identities']
        require(history and signature(target) in {signature(node) for node in history}
            and len(retired) == len(history)
            and all(item['proof'] == 'kill_zero_ESRCH' for item in retired)
            and {signature(item['identity']) for item in retired} == {signature(node) for node in history}
            and any(node.get('kind') == 'engine' and node.get('serving') is True for node in history),
            'AX retirement requires exact app and engine settlement')
        return {'terminal_observed': self.terminal['status'] == 'retired', 'retiring_observed': self.terminal['status'] == 'retiring',
                'case_complete': True, 'metadata_settlement_verified': True}


def guard_phases():
    phases, current = ['form', 'form'], 'form'
    for operation in range(1, 12):
        phases.append(current)
        current = {2: 'panel', 3: 'goTo', 6: 'panel', 7: 'form'}.get(operation, current)
        phases.append(current)
    return phases + ['form', 'form']


def require_guard_proof(row, config, configuration_sha256, witness):
    """Validate the exact26 consumed receipts; never export private field values."""
    import uuid
    expected = {key: config[key] for key in ('source_sha', 'test_source_sha', 'harness_sha')}
    expected.update({key: witness[key] for key in ('app_pid', 'app_launch_epoch', 'window_number')})
    expected.update(schema='nac342-ax-guards-v1', configuration_sha256=configuration_sha256,
                    helper_sha256=config['ax_witness']['helper_sha256'], support_sha256=config['ax_witness']['support_sha256'])
    require(type(row) is dict and set(row) == set(expected) | {'rows'}
        and all(row[k] == v and type(row[k]) is type(v) for k, v in expected.items() if k != 'app_launch_epoch')
        and type(row['app_launch_epoch']) in (int, float) and row['app_launch_epoch'] == witness['app_launch_epoch'], 'AX guard header')
    require(type(row['rows']) is list and len(row['rows']) == 26, 'AX guard count')
    previous = 0
    identities = {}
    def number(text):
        require(type(text) is str and text.isdecimal() and str(int(text)) == text and 0 <= int(text) < 2**64, 'AX guard counter')
        return int(text)
    for entry, phase in zip(row['rows'], guard_phases()):
        keys = {'sequence', 'began_ns', 'ended_ns', 'entered_ns', 'consumed_ns', 'surface', 'root_id', 'focus_checked'}
        if phase != 'form': keys.add('panel_id')
        if phase == 'goTo': keys.add('go_to_id')
        require(type(entry) is dict and set(entry) == keys and entry['surface'] == phase
            and type(entry['focus_checked']) is bool and entry['focus_checked'] == (phase == 'goTo'), 'AX guard phase/fields')
        sequence, began, ended, entered, consumed = [number(entry[k]) for k in
            ('sequence', 'began_ns', 'ended_ns', 'entered_ns', 'consumed_ns')]
        require(sequence > previous and entered < began <= ended <= consumed
            and ended - began <= 1_000_000_000 and consumed - ended <= 1_000_000_000
            and consumed - entered < 30_000_000_000, 'AX guard freshness')
        previous = sequence
        for key in ('root_id', 'panel_id', 'go_to_id'):
            if key not in entry: continue
            value = entry[key]
            require(type(value) is str and len(value) == 36 and str(uuid.UUID(value)) == value.lower()
                and identities.get(key, value) == value, 'AX guard retained identity')
            identities[key] = value
    return row
