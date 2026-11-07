#!/usr/bin/env python3
"""Two-launch Q1 only. Run under an explicit native admission, never test discovery.

Uses RecoverySmoke controls, the existing provider and collector owners. A failed
or unknown cleanup retains the private root; no discovered PID is signal authority.
"""
import json
import os
from pathlib import Path
import stat
import subprocess
import time
from urllib.parse import urlparse
import uuid

from instance_console import require_console
from instance_contract import digest
from instance_smoke import engine_settled
from quit_fixture import QuitProvider, request
from storage_q1_checkpoint import decode_notifications, observe
from storage_q1_witness import assert_controlled_no_send, assert_durable, sqlite_snapshot


def require(value, message):
    if not value:
        raise ValueError(message)


def _remaining(deadline, limit):
    """Bound one operation by the caller's original absolute monotonic deadline."""
    left = deadline - time.monotonic()
    if left <= 0:
        raise TimeoutError('Q1 operation deadline exhausted')
    return min(limit, left)


class RecordPublicationChanged(FileNotFoundError):
    """An atomic producer replacement retired this sample; no bytes were accepted."""


def read_record(path, *, publication_changes=False):
    def custody(value):
        require(stat.S_ISREG(value.st_mode) and value.st_uid == os.getuid() and
                value.st_nlink in (0, 1) and value.st_size <= 8 * 1024 * 1024,
                'record custody/bound: regular=%s owned=%s links=%s bytes=%s' %
                (stat.S_ISREG(value.st_mode), value.st_uid == os.getuid(),
                 value.st_nlink, value.st_size))
        if value.st_nlink == 0:
            changed('record descriptor retired')

    def changed(message):
        if publication_changes:
            raise RecordPublicationChanged(message)
        raise ValueError(message)

    fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        custody(before)
        raw = b''
        while len(raw) <= 8 * 1024 * 1024:
            part = os.read(fd, 65536)
            if not part:
                break
            raw += part
        require(len(raw) <= 8 * 1024 * 1024, 'record grew')
        after = os.fstat(fd)
        # In-place mutation is never a publication retry, even if later unlinked.
        require(all(getattr(before, k) == getattr(after, k) for k in
                    ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns')), 'record changed')
        custody(after)
        entry = path.lstat()
        custody(entry)
        if (entry.st_dev, entry.st_ino) != (before.st_dev, before.st_ino):
            changed('record publication replaced')
        require(all(getattr(before, k) == getattr(after, k) for k in
                    ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')), 'record changed')
        return json.loads(raw)
    finally:
        os.close(fd)


def provider_no_send(snapshot, *, final=False):
    required = {'total', 'active', 'connectionsActive', 'overflow', 'closed', 'complete', 'rows'}
    require(type(snapshot) is dict and set(snapshot) == required, 'provider facts missing')
    require(all(type(snapshot[k]) is int and snapshot[k] >= 0 for k in
                ('total', 'active', 'connectionsActive')) and type(snapshot['closed']) is bool, 'provider counter types')
    require(snapshot['complete'] is True and snapshot['overflow'] is False and
            snapshot['active'] == 0 and snapshot['connectionsActive'] == 0, 'provider incomplete')
    require(not final or snapshot['closed'] is True, 'provider not closed')
    rows = snapshot['rows']
    require(type(rows) is list and type(snapshot['total']) is int and
            snapshot['total'] == len(rows) <= 256, 'provider total/overflow')
    for sequence, row in enumerate(rows, 1):
        require(row['sequence'] == sequence and row['finished'] is True and row['parsed'] is True,
                'provider unknown/unfinished ingress')
        require(row['method'] == 'GET' and ((row['recognized'] == 'catalog' and
                row['path'].startswith('/models-dev')) or
                (row['recognized'] == 'q1-model-index' and row['path'] == '/models')) and row['error'] is None,
                'provider non-catalog/inference ingress')
    # Zero follows complete recorded ingress, never the recognized-request list.
    return 0


def q1_fetch_reads(snapshot, expected, provider):
    """Validate the observed prefix, not future requests or a metadata success."""
    address = urlparse(provider)
    require(address.scheme == 'http' and address.hostname == '127.0.0.1' and address.port and
            not address.username and not address.password and address.path == '' and
            not address.query and not address.fragment, 'foreign fixture provider')
    keys = {'version', 'nonce', 'provider', 'engineOrigin', 'started', 'settled', 'errors',
            'active', 'overflow', 'rows', 'document', 'selector', 'cancelled'}
    require(type(snapshot) is dict and set(snapshot) == keys, 'missing complete fetch witness')
    require(type(snapshot['version']) is int and snapshot['version'] == 1, 'fetch witness version')
    require(snapshot['nonce'] == expected['nonce'] and snapshot['provider'] == provider and
            snapshot['selector'] == expected['selector'] and
            snapshot['engineOrigin'] == expected['endpoint'], 'foreign fetch scope')
    require(snapshot['document'] == {k: expected[k] for k in ('launch', 'view', 'document')},
            'stale fetch document')
    require(all(type(snapshot[k]) is int and snapshot[k] >= 0 for k in
                ('started', 'settled', 'errors', 'cancelled', 'active')), 'fetch counter types')
    rows = snapshot['rows']
    require(type(rows) is list and snapshot['overflow'] is False and len(rows) <= 128 and
            snapshot['started'] == snapshot['settled'] == len(rows) and
            snapshot['active'] == 0 and snapshot['errors'] == snapshot['cancelled'],
            'incomplete/error/overflow fetch witness')
    failures = []; blocked = []; cancelled_reads = []
    flags = {'canonicalJSON', 'exactKeys', 'backendFixture', 'namedFixtureKey', 'noInlineKey',
             'fixtureEndpoint', 'safeHTTPPolicy', 'exactRoute'}
    for sequence, row in enumerate(rows, 1):
        require(type(row) is dict and set(row) == {'sequence', 'method', 'origin', 'path', 'state',
                'status', 'error', 'metadata', 'cancellation'}, 'fetch row shape')
        require(type(row['sequence']) is int and row['sequence'] == sequence and
                row['origin'] == expected['endpoint'] and
                type(row['path']) is str and row['path'].startswith('/'), 'unknown/foreign/error fetch')
        if row['state'] == 'cancelled':
            require(row['method'] == 'GET' and row['error'] is True and row['status'] is None and
                    row['metadata'] is None and row['cancellation'] == dict(name='AbortError',
                        signalObserved=True, signalAborted=True) and
                    all(type(row['cancellation'][key]) is bool for key in ('signalObserved', 'signalAborted')),
                    'unproven or non-read cancellation')
            cancelled_reads.append(dict(sequence=sequence, path=row['path']))
            continue
        require(row['state'] == 'settled' and row['error'] is False and row['cancellation'] is None and
                type(row['status']) is int and 100 <= row['status'] <= 599, 'unqualified fetch outcome')
        if row['method'] == 'GET':
            require(row['metadata'] is None, 'foreign GET classification')
        else:
            metadata = row['metadata']
            require(row['method'] == 'POST' and row['path'] == '/providers/models' and
                    type(metadata) is dict, 'unproven metadata or executable write')
            if metadata.get('kind') == 'locally-blocked-provider-models':
                blocked_flags = {'canonicalJSON', 'exactKeys', 'noInlineKey', 'exactRoute', 'notForwarded'}
                require(set(metadata) == blocked_flags | {'kind'} and
                        all(metadata[k] is True for k in blocked_flags) and row['status'] == 503,
                        'unproven local metadata refusal')
                blocked.append(dict(sequence=sequence, status=503))
            else:
                require(set(metadata) == flags | {'kind'} and metadata['kind'] == 'fixture-provider-models' and
                        all(metadata[k] is True for k in flags), 'unproven metadata or executable write')
            if row['status'] >= 400: failures.append(dict(sequence=sequence, status=row['status']))
    require(len(cancelled_reads) == snapshot['cancelled'], 'inconsistent cancelled/error counters')
    return dict(scope='complete observed fetch prefix at capture', metadataFailures=failures,
                metadataSuccessClaimed=False, locallyBlockedMetadata=blocked, overflow=False,
                cancelledReads=cancelled_reads, cancelledReadSuccessClaimed=False, unexpectedErrors=0)


def frame(record, nonce):
    binding = record['bridge']['binding']
    profile = record['profile_storage']
    require(all(type(binding.get(k)) is str and 0 < len(binding[k]) <= 4096
                for k in ('launch', 'view', 'document')), 'partial runtime binding')
    require(type(record['recovery']['generation']) is int and record['recovery']['generation'] >= 0,
            'invalid generation')
    require(record['bridge']['ready'] is True and profile['available'] is True and
            profile['persistent'] is True and profile['selected'] is True, 'workspace not ready')
    require(type(record['engine_pid']) is int and record['engine_pid'] > 0, 'unknown engine')
    endpoint = urlparse(record['endpoint'])
    require(endpoint.scheme == 'http' and endpoint.hostname == '127.0.0.1' and
            endpoint.port and not endpoint.username and not endpoint.password, 'unqualified endpoint')
    return dict(profile=profile['profile'], nonce=nonce, launch=binding['launch'],
                view=binding['view'], document=binding['document'],
                generation=record['recovery']['generation'], enginePID=record['engine_pid'],
                endpoint=record['endpoint'])


def compare_launches(first, second):
    require(first['profile'] == second['profile'] and
            first['website_store'] == second['website_store'] and
            first['store'] == second['store'] and first['home'] == second['home'], 'profile changed')
    require(first['app_identity'] != second['app_identity'], 'same app incarnation')
    for key in ('launch', 'document', 'view'):
        require(first['frame'][key] != second['frame'][key], 'reused runtime ' + key)
    old, new = urlparse(first['frame']['endpoint']), urlparse(second['frame']['endpoint'])
    require(old.port != new.port, 'same port: no new-port credit; no retry authorized')
    return dict(same_profile=True, new_observed_port=True, automatic_retry=False)


def q1_ui_result(record):
    phase = record.get('storage_q1', {})
    if phase.get('status') in ('failed', 'retired'):
        reason = phase.get('error', 'Q1 document was retired')
        raise ValueError('Q1 native phase rejected: ' + str(reason)[:512])
    return record if phase.get('status') == 'ui-passed-awaiting-durability' else None


def seed_q1_configuration(endpoint, provider, environment, deadline, existing=None, nonce=None):
    """Supported saved-config API only; no discovery, raw SQL or generated-name allowance."""
    name = existing['name'] if existing else 'Disposable Q1 ' + str(nonce or uuid.uuid4())
    if existing is None:
        record = request(endpoint, '/model-configs', dict(name=name, backend='openai-responses',
            model='gpt-5.6-sol', base_url=provider, allow_insecure_http=False,
            api_key=environment['OPENAI_API_KEY']), timeout=_remaining(deadline, 8))
    else:
        record = existing
    require(type(record) is dict and record.get('name') == name and
            record.get('backend') == 'openai-responses' and record.get('base_url') == provider and
            record.get('model') == 'gpt-5.6-sol' and record.get('allow_insecure_http') is False and
            type(record.get('config_id')) is str and record['config_id'] and
            type(record.get('api_key_env')) is str and record['api_key_env'] and
            len(record['api_key_env']) <= 256 and 'api_key' not in record, 'foreign saved fixture configuration')
    rows = request(endpoint, '/model-configs', timeout=_remaining(deadline, 8))['configurations']
    require(type(rows) is list and len(rows) == 1 and rows[0] == record, 'saved fixture readback changed')
    return record


class RecoveryLaunch:
    """Concrete RecoverySmoke adapter; does not inherit instance stage assumptions."""
    def __init__(self, bundle, root, environment, store, observer, number, deadline, checks, saved_configuration=None):
        self.bundle, self.root, self.environment, self.store = bundle, root, environment, store
        self.observer, self.deadline, self.checks = observer, deadline, checks
        self.control = root / ('q1-controls-' + str(number)); self.control.mkdir(mode=0o700)
        self.output = self.control / 'native.json'
        self.identity = None
        self.engine_pid = None
        self.commands = []
        self.launch_helper = None
        self.log = None
        self.closed = False
        self.saved_configuration = saved_configuration
        (self.control / 'profile-open-hold').touch(mode=0o600)
        self.fetch_nonce = str(uuid.uuid4())
        require(not self.state()['apps'], 'bundle already running')

    def state(self):
        return json.loads(subprocess.check_output([str(self.observer), 'state', str(self.bundle)],
                                                 timeout=_remaining(self.deadline, 4)))

    def read(self):
        _remaining(self.deadline, 1)
        try:
            return read_record(self.output, publication_changes=True)
        except FileNotFoundError:
            return {}

    def wait(self, label, predicate, limit=30):
        end = min(self.deadline, time.monotonic() + limit)
        while time.monotonic() < end:
            value = predicate()
            _remaining(end, 1)
            if value:
                return value
            time.sleep(min(.05, _remaining(end, .05)))
        raise TimeoutError(label)

    def guard(self):
        require_console(self.observer, self.checks, 'q1-control')
        state = self.state()
        require(self.identity is not None and state['apps'] == [self.identity] and
                state['frontmost'] == self.identity, 'app/focus custody changed')

    def launch(self):
        require_console(self.observer, self.checks, 'q1-launch')
        command = ['/usr/bin/open', '-a', str(self.bundle), '--args', '--directory', str(self.root / 'workspace'),
                   '--store-path', str(self.store), '--recovery-output', str(self.output),
                   '--recovery-control', str(self.control),
                   '--storage-q1-fetch-provider', self.environment['MODELS_DEV_URL'].removesuffix('/models-dev'),
                   '--storage-q1-fetch-nonce', self.fetch_nonce]
        self.log = (self.control / 'launch.log').open('wb')
        self.launch_helper = subprocess.Popen(command, env=self.environment, cwd='/',
                                             stdout=self.log, stderr=self.log)
        try:
            require(self.launch_helper.wait(timeout=_remaining(self.deadline, 12)) == 0, 'LaunchServices failed')
        finally:
            if self.launch_helper.poll() is None:
                self.launch_helper.terminate()  # Only the unreaped helper handle, not an observed app PID.
                self.launch_helper.wait(timeout=3)
        original_action_deadline = self.deadline
        startup_deadline = min(self.deadline, time.monotonic() + 30)
        self.deadline = startup_deadline  # Pending and ready share the original 30 seconds.
        pending = self.wait('Q1 pre-render hold', lambda: (r if (r := self.read()).get('profile_open_pending')
                              and r.get('endpoint') else None), limit=30)
        require(not pending.get('profile_open_timeout'), 'original profile hold expired')
        held_deadline = min(startup_deadline, time.monotonic() + 4)
        self.deadline = held_deadline  # One seed/release budget, never another four seconds.
        observed = self.state()
        require(len(observed['apps']) == 1 and observed['apps'][0]['pid'] == pending['app_pid'], 'unknown held app')
        self.identity = observed['apps'][0]; self.engine_pid = pending['engine_pid']
        self.guard()
        require(request(pending['endpoint'], '/store', timeout=_remaining(held_deadline, 4))['store_path'] == str(self.store),
                'foreign held store')
        provider = self.environment['MODELS_DEV_URL'].removesuffix('/models-dev')
        self.saved_configuration = seed_q1_configuration(pending['endpoint'], provider, self.environment,
                                                        held_deadline, self.saved_configuration, nonce=self.fetch_nonce)
        # One complete publication proves both facts. A discarded atomic sample
        # cannot mean either "expired" or "not timed out". self.deadline is still
        # the original held_deadline shared by store lookup, seed and release.
        held = self.wait('Q1 held record after seed', self.read, limit=4)
        require(held.get('profile_open_pending') is True and
                not held.get('profile_open_timeout') and
                all(held.get(key) == pending[key] for key in ('app_pid', 'engine_pid', 'endpoint')),
                'original profile hold expired or changed during seed')
        with (self.control / 'storage-q1-fetch.json').open('x') as binding:
            os.chmod(binding.name, 0o600)
            json.dump(dict(nonce=self.fetch_nonce, provider=provider,
                           selector=self.saved_configuration['api_key_env'],
                           config_id=self.saved_configuration['config_id'], name=self.saved_configuration['name']), binding)
        self.command('profile-open-release')
        self.deadline = startup_deadline
        ready = self.wait('RecoverySmoke readiness', lambda: (r if (r := self.read()).get('bridge', {}).get('ready') else None))
        require(not ready.get('profile_open_timeout'), 'initial page escaped original hold')
        state = self.state()
        require(len(state['apps']) == 1 and state['apps'][0]['pid'] == ready['app_pid'], 'unknown app identity')
        self.identity = state['apps'][0]
        self.engine_pid = ready['engine_pid']
        require(type(self.engine_pid) is int and self.engine_pid > 0 and
                not engine_settled(self.bundle, self.engine_pid), 'owned engine not observed')
        self.guard()
        self.deadline = original_action_deadline
        return ready

    def command(self, name):
        require(name in ('storage-q1-seed', 'storage-q1-restore', 'capture', 'stop', 'profile-open-release'), 'unsupported Q1 control')
        self.guard()
        if name == 'profile-open-release':
            _remaining(self.deadline, 1)  # Custody checks cannot spend past the shared seed budget.
        require(name not in self.commands, 'control already consumed')
        (self.control / name).touch(mode=0o600, exist_ok=False)
        self.commands.append(name)

    def stop(self):
        if 'stop' not in self.commands:
            self.command('stop')
        self.wait('exact app exit', lambda: not self.state()['apps'], limit=32)
        record = self.read()
        require(self.engine_pid is not None and record.get('engine_reaped') is True and
                record.get('identity_retired') is True and record.get('workspace_released') is True,
                'unknown cleanup/reap outcome')
        require(engine_settled(self.bundle, self.engine_pid), 'owned engine still present')
        self.closed = True
        if self.log:
            self.log.close()
        return record

    def cleanup(self):
        # Never signal guessed PIDs or terminate a successor. Custody loss stays unknown.
        if self.closed:
            return dict(known=True, stopped=True)
        if self.identity is None or self.engine_pid is None:
            if self.log:
                self.log.close()
            return dict(known=False, stopped=False, reason='launch ownership unknown')
        try:
            self.stop()
            return dict(known=True, stopped=True)
        except Exception as error:
            return dict(known=False, stopped=False, reason=str(error))
        finally:
            if self.log:
                self.log.close()


def empty_pair(endpoint, workspace, provider, deadline, saved_configuration):
    require(saved_configuration['backend'] == 'openai-responses' and
            saved_configuration['base_url'] == provider.endpoint and
            saved_configuration['model'] == 'gpt-5.6-sol' and
            type(saved_configuration['api_key_env']) is str and
            bool(saved_configuration['api_key_env']), 'foreign session seed configuration')
    def call(path, body):
        return request(endpoint, path, body, timeout=_remaining(deadline, 8))
    project = call('/projects', dict(name='Disposable storage Q1', cwd=str(workspace)))
    pair = []
    for _ in range(2):
        result = call('/sessions', dict(behavior='direct', project_id=project['project_id'],
                      model='gpt-5.6-sol', backend='openai-responses', base_url=provider.endpoint,
                      api_key_env=saved_configuration['api_key_env']))
        require(result['metadata'].get('api_key_env') == saved_configuration['api_key_env'],
                'seeded session selector changed')
        pair.append(result['metadata']['session_id'])
    return pair


def run_contract(bundle, observer, root, destination, admission):
    """An actual Root allocation must supply the admission; defaults never grant it."""
    bundle, observer, root = map(lambda p: Path(p).resolve(strict=True), (bundle, observer, root))
    destination = Path(destination).absolute()
    require(destination.parent.resolve(strict=True) == destination.parent and
            destination.is_relative_to(root) and not destination.exists(), 'fresh private destination required')
    require(admission['exclusive_actor'] is True and admission['only_q1_actions'] is True,
            'exclusive Q1 custody not admitted')
    require(admission['root'] == str(root) and admission['bundle'] == str(bundle), 'foreign admission')
    require(root.name.startswith('nac-all349-q1-') and bundle.is_relative_to(root), 'external private fixture only')
    st = root.lstat(); root_pin = (st.st_dev, st.st_ino)
    require(st.st_uid == os.getuid() and not st.st_mode & 0o077, 'root custody')
    native_baseline = admission['native_baseline']  # Required actual external read, never synthesized here.
    if native_baseline is not None:
        require(decode_notifications(native_baseline)['enabled'] is False, 'Q1 requires actual default-off native state')
    require(type(admission['native_baseline_evidence']) is str and admission['native_baseline_evidence'],
            'actual native baseline evidence missing')
    seconds = admission['seconds']
    require(type(seconds) is int and 120 < seconds <= 600, 'case cap')
    deadline = time.monotonic() + seconds
    action_deadline = deadline - 120  # Original cleanup reserve, never a clock reset.
    receipt = read_record(bundle / 'Contents/Resources/build-receipt.json')
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    require(subprocess.check_output(['git', 'status', '--porcelain=v1'], text=True) == '',
            'qualification source must be committed and clean')
    require(receipt['source_head'] == source == admission['source_head'] and
            receipt['engine_identity']['source_revision'] == source and
            receipt['lifecycle_smoke_instrumentation'] and receipt['normal_startup'], 'source/role mismatch')
    require(receipt['engine_sha256'] == digest(bundle / 'Contents/Resources/nac-web') and
            receipt['native_sha256'] == digest(bundle / 'Contents/MacOS/NACPreview'), 'binary mismatch')
    require(digest(observer) == admission['observer_sha256'], 'observer mismatch')
    for name in ('home', 'workspace'):
        (root / name).mkdir(mode=0o700)
    home, workspace = root / 'home', root / 'workspace'
    store = root / 'store.db'
    provider = QuitProvider(workspace, q1_metadata=True)
    launches, summaries = [], []
    checks = []
    result = dict(passed=False, root=str(root), source_head=source, cleanup=[], launches=summaries,
                  trusted_input=False, actual_crash=False, rerun_authorized=False)
    environment = dict(HOME=str(home), NAC_HOME=str(home / 'nac-home'), PATH='/usr/bin:/bin:/usr/sbin:/sbin',
        LANG='en_US.UTF-8', BROWSER='none', NAC_TELEMETRY='disabled', NAC_ORCHESTRATION='0',
        GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', MODELS_DEV_URL=provider.endpoint + '/models-dev',
        OPENAI_API_KEY='quit-fixture-dummy-only')
    try:
        require_console(observer, checks, 'q1-preflight')
        subprocess.run(['/usr/bin/git', 'init', '--quiet', '--initial-branch=main', str(workspace)],
                       env=environment, check=True, timeout=_remaining(action_deadline, 5))
        pair = None
        saved_configuration = None
        for number, phase in enumerate(('seed', 'restore'), 1):
            launch = RecoveryLaunch(bundle, root, environment, store, observer, number, action_deadline, checks, saved_configuration)
            launches.append(launch)
            ready = launch.launch()
            saved_configuration = launch.saved_configuration
            require(request(ready['endpoint'], '/store', timeout=_remaining(action_deadline, 8))['store_path'] == str(store),
                    'foreign canonical store')
            if pair is None:
                pair = empty_pair(ready['endpoint'], workspace, provider, action_deadline, saved_configuration)
                db_st = store.stat(); db_pin = (db_st.st_dev, db_st.st_ino)
                baseline = sqlite_snapshot(store, db_pin, pair)
            require(sqlite_snapshot(store, db_pin, pair) == baseline, 'prelaunch durable facts changed')
            provider_no_send(provider.ingress_snapshot())
            nonce = launch.fetch_nonce; expected = frame(ready, nonce)
            expected['selector'] = saved_configuration['api_key_env']
            plan = dict(version=1, nonce=nonce, a=pair[0], b=pair[1],
                        aText='  雪🙂\n\n!echo inert\n', bText='/not-a-command\nB inert')
            plan_path = launch.control / 'storage-q1.json'
            with plan_path.open('x', encoding='utf-8') as out:
                os.chmod(plan_path, 0o600); json.dump(plan, out, ensure_ascii=False)
            launch.command('storage-q1-' + phase)
            ui = launch.wait('Q1 UI', lambda: q1_ui_result(launch.read()), limit=20)
            require(frame(ui, nonce) == {k:v for k,v in expected.items() if k != 'selector'}, 'changed launch frame')
            launch.command('capture')
            capture = launch.wait('Q1 request capture', lambda: (r if (r := launch.read()).get('document') else None))
            fetch = q1_fetch_reads(capture['document'].get('fetch'), expected, provider.endpoint)
            overflow = fetch['overflow']
            launch.deadline = deadline  # Same absolute case clock, original reserve for cleanup only.
            terminal = launch.stop()
            require(terminal.get('storage_q1_overflow') is not True, 'native ledger overflow')
            # Actual externally pinned default-off state only; never invent or persist native JSON.
            disk = observe(root, root_pin, expected['profile'], ui['storage_q1']['binding'],
                           pair[0], pair[1], plan['aText'], expected_native=native_baseline)
            durable = assert_durable(terminal['storage_q1_native_writes'], {k:v for k,v in expected.items() if k != 'selector'}, disk['checkpointSHA256'],
                                     require_b_clear=phase == 'seed')
            require(sqlite_snapshot(store, db_pin, pair) == baseline, 'post-Quit durable facts changed')
            summaries.append(dict(frame=expected, profile=expected['profile'],
                website_store=ready['profile_storage']['website_store'], store=str(store), home=str(home),
                app_identity=launch.identity, disk=disk, durable=durable, native=terminal,
                request_log_overflow=overflow, fetch=fetch))
            if number == 2:
                result.update(compare_launches(*summaries))
        provider.close()
        census = provider.ingress_snapshot()
        count = provider_no_send(census, final=True)
        result['provider'] = census
        result['no_send'] = assert_controlled_no_send(baseline, sqlite_snapshot(store, db_pin, pair),
            provider_dispatches=count, exclusive_actor=admission['exclusive_actor'],
            only_q1_actions=admission['only_q1_actions'],
            request_log_overflow=any(item['request_log_overflow'] for item in summaries))
        require(all(launch.closed for launch in launches), 'unknown cleanup')
        _remaining(deadline, 1)
        result['passed'] = True
        return result
    except Exception as error:
        result['failure'] = str(error)
        raise
    finally:
        for launch in reversed(launches):
            launch.deadline = deadline
            result['cleanup'].append(launch.cleanup())
        provider_cleanup = dict(known=True)
        try:
            if not provider.ingress_snapshot()['closed']:
                provider.close()
        except Exception as error:
            provider_cleanup = dict(known=False, error=str(error))
        result['saved_configurations'] = [launch.saved_configuration for launch in launches
                                          if launch.saved_configuration is not None]
        result['provider_cleanup'] = provider_cleanup
        result['provider_final'] = provider.ingress_snapshot()
        cleanup_known = all(item['known'] and item['stopped'] for item in result['cleanup']) and provider_cleanup['known']
        success_before_cleanup = result['passed']
        if not cleanup_known:
            result['passed'] = False
            result['failure'] = result.get('failure', 'unknown cleanup outcome')
        result['console_checks'] = checks
        result['retained_fixture'] = str(root)  # Cleanup/deletion is a separate exact-owner action.
        output_fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(output_fd, 'w') as output:
            output.write(json.dumps(result, indent=2) + '\n')
        if success_before_cleanup and not cleanup_known:
            raise ValueError('unknown cleanup outcome')


if __name__ == '__main__':
    import sys
    # Root writes this admission only after the concrete source/artifact/native allocation.
    print(json.dumps(run_contract(*sys.argv[1:5], read_record(Path(sys.argv[5]))), indent=2))
