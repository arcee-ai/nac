#!/usr/bin/env python3
"""One separately admitted LOCAL_APP/mock-center late add callback after reset.

Import and portable tests perform no native operations. Actual execution needs
fresh source-stamped app/engine, owned Aqua admission and an outer custody gate.
This is not a crash/checkpoint-ACK, signed banner, IME or performance fixture.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import stat
import sys
import tempfile
import time
import uuid

sys.dont_write_bytecode = True
from attention_app_smoke import AttentionJourney
from attention_feed_build import source_binding
from attention_fixture_control import console_facts, require_console
from attention_reset_readout import ResetReadout
from attention_fixture_cleanup import run_helper, write_input
from attention_semantic_fixture import SemanticProvider
from instance_contract import digest
from instance_smoke import remaining, wait_for, engine_settled
from quit_fixture import request

TOKEN = 'SEMANTIC_RESET_ACK_DIRECT'


def require_fields(actual, expected):
    for key, value in expected.items():
        assert key in actual and type(actual[key]) is type(value) and actual[key] == value, 'Mismatch: ' + key


def profile_digest(home, track, store):
    return hashlib.sha256(('nac-presentation-v1\0' + str(home) + '\0' + track + '\0' + str(store)).encode()).hexdigest()


def prepare_store(owned):
    """Create only this new fixture's empty DB; never adopt or repair a store."""
    owned.validate()
    directory = os.open('profile', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                        dir_fd=owned.fd)
    descriptor = None
    try:
        expected = os.fstat(directory)
        def validate():
            owned.validate()
            held = os.fstat(directory)
            named = os.stat('profile', dir_fd=owned.fd, follow_symlinks=False)
            assert (held.st_dev, held.st_ino) == (named.st_dev, named.st_ino) == (expected.st_dev, expected.st_ino), 'Fixture profile replaced'
            assert stat.S_ISDIR(held.st_mode) and held.st_uid == os.getuid()
            assert stat.S_IMODE(held.st_mode) == stat.S_IMODE(named.st_mode) == 0o700, 'Fixture profile not private'
        validate()
        descriptor = os.open('selected store.db', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                             0o600, dir_fd=directory)
        info = os.fstat(descriptor)
        assert stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
        assert info.st_size == 0 and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600
        validate()
        named = os.stat('selected store.db', dir_fd=directory, follow_symlinks=False)
        assert (named.st_dev, named.st_ino) == (info.st_dev, info.st_ino), 'Fixture store replaced'
        assert named.st_uid == info.st_uid and named.st_mode == info.st_mode and named.st_nlink == 1 and named.st_size == 0
        return owned.root / 'profile/selected store.db'
    finally:
        try:
            if descriptor is not None:
                os.close(descriptor)
        finally:
            os.close(directory)


class ResetOracle:
    """Ordered, identity-bound oracle; endpoint/Swift state are never simulated."""
    def __init__(self, ready, home, source):
        self.owner = {key: ready[key] for key in ('app_pid', 'engine_pid', 'control_nonce', 'window_number', 'ready_receipt')}
        receipt = self.owner['ready_receipt']
        assert receipt['kind'] == 'ready' and receipt['identity']['source_revision'] == source
        assert receipt['store'] == str(Path(home) / 'selected store.db')
        assert uuid.UUID(receipt['incarnation'])
        self.digest = profile_digest(home, receipt['identity']['track'], receipt['store'])
        self.phase = 'ready'
        self.common(ready)
        require_fields(ready['attention'], dict(loaded=True, enabled=False, saving=False, suspended=False,
                       unread=0, receipts=0, frontier='', cutoff='', observer_connections=0, observer_draining=0))
        require_fields(ready['center'], dict(adds=0, pending_ack=0, present=0, permission_requests=0, deliveries=[]))

    def common(self, state):
        require_fields(state, self.owner)
        require_fields(state, dict(native_os_delivery=False, stopped=False, same_engine=True, same_view=True))
        assert state.get('failure') is None
        require_fields(state['attention'], dict(loaded=True, retired=False, audit_overflow=False,
                                               accepted_items=[], pending_decisions=0, observation_paused=False))
        assert type(state['attention']['observer_connections']) is int and 0 <= state['attention']['observer_connections'] <= 1
        require_fields(state['center'], dict(retired=False))

    def enabled(self, state):
        assert self.phase == 'ready'
        self.common(state)
        a = state['attention']
        require_fields(a, dict(enabled=True, saving=False, suspended=False, work_pending=False,
                              unread=0, receipts=0, observer_connections=1, observer_draining=0))
        require_fields(state['center'], dict(adds=0, pending_ack=0, present=0, permission_requests=1, deliveries=[]))
        store, sequence = a['cutoff'].split(':')
        assert str(uuid.UUID(store)) == store and sequence == '0' and a['frontier'] == a['cutoff']
        assert type(a['generation']) is int and type(a['revision']) is int
        self.generation, self.baseline_revision, self.frontier = a['generation'], a['revision'], a['frontier']
        self.store = store
        self.phase = 'enabled'

    def bind_request(self, session, run):
        assert self.phase == 'enabled' and isinstance(session, str) and session and isinstance(run, str) and run
        self.expected = dict(store=self.store, session=session, run=run, behavior='direct', kind='request', goal=None, mark_version=None)
        occurrence = self.store + ':1'
        raw = 'nac-attention-v1\0' + self.digest + '\0' + session + '\0' + occurrence
        self.delivery = dict(session=session, occurrence=occurrence,
                             identifier='nac-attention-' + hashlib.sha256(raw.encode()).hexdigest(), title='Request completed')

    def held(self, state):
        assert self.phase == 'enabled' and hasattr(self, 'delivery')
        self.common(state)
        require_fields(state, dict(window_visible=False))
        require_fields(state['attention'], dict(enabled=True, saving=False, suspended=False, work_pending=True,
                       generation=self.generation, revision=self.baseline_revision + 1,
                       unread=1, receipts=1, cutoff=self.frontier, frontier=self.frontier,
                       observer_connections=1, observer_draining=0))
        require_fields(state['center'], dict(adds=1, pending_ack=1, present=1, permission_requests=1,
                                             deliveries=[self.delivery], titles=['Request completed']))
        self.phase = 'held'

    def checkpoint(self, value, *, reserved=False):
        assert value['profile'] == self.digest
        if reserved:
            assert self.phase == 'held' and value['version'] == 2 and set(value['native']) == {'notifications'}
            n = value['native']['notifications']
            require_fields(n, dict(enabled=True, muted=False, unreadCompletions=1, deliveryUncertain=False,
                                  cutoff=self.frontier, frontier=self.frontier, seenDecisions=[]))
            assert n['receipts'] == [dict(occurrence=self.delivery['occurrence'], session=self.expected['session'],
                                          cursor=self.delivery['occurrence'], phase='reserved')]
            self.reservation_read = True
        else:
            assert self.phase in ('reset', 'released', 'observed')
            assert type(value['version']) is int and value['version'] == 1
            assert set(value) == {'version', 'profile', 'values'}, 'Reset native section still present'
            if self.phase == 'reset':
                self.reset_read = True

    def reset_state(self, state, pending):
        self.common(state)
        require_fields(state, dict(dock='', window_visible=False))
        require_fields(state['attention'], dict(loaded=True, enabled=False, muted=False, saving=False,
                       suspended=False, message='Saved', work_pending=False, generation=self.generation + 1,
                       revision=self.baseline_revision + 2, unread=0, receipts=0, cutoff='', frontier='',
                       observer_connections=0, observer_draining=0))
        require_fields(state['center'], dict(adds=1, pending_ack=pending, present=0, permission_requests=1,
                       deliveries=[self.delivery], titles=['Request completed'], foreground_delivery_allowed=False))

    def reset(self, state):
        assert self.phase == 'held' and getattr(self, 'reservation_read', False), 'Missing durable reservation'
        self.reset_state(state, 1)
        self.phase = 'reset'

    def released(self, state, stage, now):
        assert self.phase == 'reset' and getattr(self, 'reset_read', False), 'Missing durable reset before release'
        assert state['stage'] == stage
        self.reset_state(state, 0)
        self.phase, self.release_time, self.last_sample, self.samples = 'released', now, now, 0

    def sample(self, state, now):
        assert self.phase == 'released' and now >= self.last_sample
        assert now - self.last_sample <= 0.25, 'Observation gap exceeds fixture cadence'
        self.reset_state(state, 0)
        self.last_sample = now
        self.samples += 1

    def observed(self, now):
        assert self.phase == 'released' and now == self.last_sample
        assert now - self.release_time >= 2 and self.samples >= 2, 'Incomplete two-second observation'
        self.phase = 'observed'

    def stopped(self, state):
        assert self.phase == 'observed'
        require_fields(state, dict(app_pid=self.owner['app_pid'], stopped=True, passed=True, dock=''))
        require_fields(state['attention'], dict(retired=True, observer_connections=0, observer_draining=0,
                                              enabled=False, unread=0, receipts=0, frontier='', cutoff=''))
        require_fields(state['center'], dict(retired=True, pending_ack=0, present=0, adds=1, deliveries=[self.delivery]))


def observe_release(oracle, sample, record, deadline, clock=time.monotonic, pause=time.sleep):
    """Every sample, including the final one, must finish inside the original clock."""
    while True:
        remaining(deadline, 2)
        state = sample()
        now = clock()
        assert now < deadline, 'Late truthy release sample'
        oracle.sample(state, now)
        record(state, now)
        assert clock() < deadline, 'Late release sample receipt'
        if now - oracle.release_time >= 2:
            oracle.observed(now)
            return
        pause(min(0.05, deadline - now))


def run_contract(bundle, destination, observer, source_ref, deadline):
    """Runtime entry point only. Outer admission retains all original process gates."""
    root_source = Path(__file__).resolve().parents[2]
    binding = source_binding(root_source, source_ref)
    assert math.isfinite(deadline) and time.monotonic() + 180 < deadline, 'Insufficient scenario/cleanup reserve'
    require_console(console_facts(deadline=deadline))
    bundle, destination, observer = map(lambda p: Path(p).absolute(), (bundle, destination, observer))
    assert all(p.resolve() == p for p in (bundle, destination, observer))
    build = json.loads((bundle / 'Contents/Resources/build-receipt.json').read_text())
    assert build['source_head'] == source_ref == build['engine_identity']['source_revision']
    assert build['source_dirty'] is False and build['normal_startup'] and build['attention_smoke_instrumentation']
    require_fields(build['engine_identity'], dict(track='dev', build_id='dev-' + source_ref))
    assert all(flag in build['compiler_flags'] for flag in ('LOCAL_APP', 'PREVIEW_SMOKE', 'ATTENTION_SMOKE'))
    assert build['native_sha256'] == digest(bundle / 'Contents/MacOS/NACPreview')
    assert build['engine_sha256'] == digest(bundle / 'Contents/Resources/nac-web')
    assert build['native_source_files'], 'Missing native construction bindings'
    assert all(digest(path) == expected for path, expected in build['native_source_files'].items())
    observer_hash = digest(observer)
    cleanup_hash = digest(observer.parent / 'AttentionFixtureCleanup')
    destination.mkdir(mode=0o700, parents=False, exist_ok=False)
    root = Path(tempfile.mkdtemp(prefix='nac-attention-app-reset-', dir=destination)).resolve()
    owned = ResetReadout(root)
    provider = journey = helper = None
    evidence = dict(source_binding=binding, build_receipt=build, native_os_delivery=False,
                    observer_sha256=observer_hash, cleanup_helper_sha256=cleanup_hash,
                    exact_crash_ack=False, trusted_input=False, hidden_cpu_qualified=False, passed=False)
    sequence = 0
    cleanup_sent = False
    native_settled = False
    errors = []
    def save(name, value):
        (destination / name).write_text(json.dumps(value, indent=2) + '\n')
    def checkpoint(label, reserved=False):
        value, data, receipt = owned.checkpoint(profile, 'dev', oracle.digest, deadline=deadline if native_settled else case_end)
        oracle.checkpoint(value, reserved=reserved)
        (destination / (label + '-checkpoint.json')).write_bytes(data)
        save(label + '-checkpoint-receipt.json', receipt)
    def state():
        remaining(case_end, 2)
        journey.custody.check(journey, deadline=case_end)
        value = journey.read(deadline=case_end)
        remaining(case_end, 2)
        try:
            oracle.common(value)
        except BaseException:
            try:
                save('invalid-native.json', value)
            except BaseException:
                pass
            raise
        return value
    def command(action):
        nonlocal sequence
        remaining(case_end, 2)
        sequence += 1
        name = f'attention-{sequence:04d}'
        end = min(case_end, time.monotonic() + 2)
        journey.custody.publish(journey, name, action, deadline=end)
        if action == 'finish':
            return name, None
        value = journey.stage(name, timeout=remaining(end, 2), deadline=end)
        save(name + '-' + action + '.json', value)
        return name, value
    def native(label, check):
        last = None
        def poll():
            nonlocal last
            last = state()
            try:
                check(last)
                return last
            except AssertionError:
                return None
        try:
            value = wait_for(label, poll, timeout=20, deadline=case_end)
        finally:
            save(label + '-last.json', last)
        save(label + '.json', value)
        return value
    try:
        profile = root / 'profile'
        profile.mkdir(mode=0o700)
        store = prepare_store(owned)
        moved = root / 'Relocated app with spaces' / bundle.name
        shutil.copytree(bundle, moved)
        provider = SemanticProvider(profile, destination / 'provider.jsonl')
        provider.protocol.register(TOKEN)
        environment = dict(HOME=str(profile), NAC_HOME=str(profile / 'nac-home'),
                           PATH='/usr/bin:/bin:/usr/sbin:/sbin', LANG='en_US.UTF-8', BROWSER='none',
                           NAC_TELEMETRY='disabled', NAC_ORCHESTRATION='0', GIT_CONFIG_NOSYSTEM='1',
                           GIT_CONFIG_GLOBAL='/dev/null', MODELS_DEV_URL=provider.endpoint + '/models-dev',
                           OPENAI_API_KEY='attention-semantic-dummy-only')
        subprocess.run(['/usr/bin/git', 'init', '--quiet', '--initial-branch=main', str(profile)],
                       env=environment, check=True, timeout=remaining(deadline - 120, 5))
        case_end = min(deadline - 120, time.monotonic() + 180)
        (destination / 'native').mkdir()
        journey = AttentionJourney(moved, destination / 'native/state.json', profile, environment, store, observer)
        journey.launch()
        ready = journey.stage('ready', deadline=case_end)
        oracle = ResetOracle(ready, profile, source_ref)
        assert ready['ready_receipt']['identity'] == build['engine_identity']
        write_input(owned, dict(receipt=ready['ready_receipt'], home=str(profile)))
        save('ready.json', ready)
        command('enable')
        native('enabled', oracle.enabled)
        command('hold')
        command('close')
        endpoint = ready['base_url'].rstrip('/')
        assert endpoint.rstrip('/') == ready['ready_receipt']['endpoint'].rstrip('/')
        def http(path, body):
            remaining(case_end, 8)
            value = request(endpoint, path, body)
            remaining(case_end, 8)
            with (destination / 'http.jsonl').open('a') as stream:
                stream.write(json.dumps(dict(path=path, body=body, response=value, epoch=time.time())) + '\n')
            return value
        project = http('/projects', dict(name='Pending ACK reset fixture', cwd=str(profile)))['project_id']
        session = http('/sessions', dict(behavior='direct', project_id=project, model='gpt-5.6-sol',
                       backend='openai-responses', base_url=provider.endpoint, api_key_env='OPENAI_API_KEY'))['metadata']
        assert session['behavior'] == 'direct'
        sid = session['session_id']
        run = http('/sessions/' + sid + '/runs', dict(prompt=TOKEN))['run_id']
        oracle.bind_request(sid, run)
        native('held', oracle.held)
        checkpoint('held', reserved=True)
        command('reset')
        native('reset', oracle.reset)
        checkpoint('reset-before-release')
        name, released = command('release')
        oracle.released(released, name, time.monotonic())
        def retain_sample(value, now):
            with (destination / 'release-samples.jsonl').open('a') as stream:
                stream.write(json.dumps(dict(monotonic=now, epoch=time.time(), state=value)) + '\n')
        observe_release(oracle, state, retain_sample, case_end)
        checkpoint('after-release')
        command('finish')
        stopped = wait_for('Normal Stop', lambda: (s if (s := journey.read()).get('stopped') else None),
                           timeout=28, deadline=deadline)
        oracle.stopped(stopped)
        save('normal-stop.json', stopped)
        wait_for('Exact app exit', lambda: journey.observe()['apps'] == [], timeout=10, deadline=deadline)
        wait_for('Exact engine exit', lambda: engine_settled(moved, journey.engine_pid), timeout=25, deadline=deadline)
        assert journey.engine_pid is not None
        native_settled = True
        checkpoint('post-exit')
        evidence['canonical'] = owned.canonical(destination / 'canonical', oracle.expected,
                                                owners_exited=native_settled, deadline=deadline)
        assert len(provider.requests) == 1 and not provider.errors
        model_log = [json.loads(line) for line in (destination / 'provider.jsonl').read_text().splitlines()]
        assert [row['token'] for row in model_log if row['operation'] == 'model-request'] == [TOKEN]
        assert [row['token'] for row in model_log if row['operation'] == 'model-response'] == [TOKEN]
        assert not any(row['operation'] == 'model-error' for row in model_log)
        evidence['passed'] = True
    except BaseException as error:
        evidence['error'] = repr(error)
    finally:
        # A receipt exception never unwinds live/unknown app ownership. No new
        # normal control or successor is admitted here, even after the deadline.
        while journey is not None and not native_settled:
            try:
                apps = journey.observe()['apps']
                if apps and not cleanup_sent:
                    cleanup_sent = True
                    journey.custody.cleanup(journey, 'attention-cleanup')
                assert journey.engine_pid is not None, 'Exact engine owner UNKNOWN'
                native_settled = not apps and engine_settled(moved, journey.engine_pid)
            except BaseException as error:
                if len(errors) < 32:
                    errors.append('Native custody: ' + repr(error))
            if not native_settled:
                try:
                    save('custody-pending.json', dict(errors=errors[-16:], cleanup_sent=cleanup_sent))
                except BaseException:
                    pass
                try:
                    time.sleep(0.25)
                except BaseException:
                    pass  # Interruption is not proof of original-owner exit.
        provider_settled = provider is None
        if provider is not None:
            try:
                provider.close()
                evidence['provider_requests'] = len(provider.requests)
                evidence['provider_errors'] = list(provider.errors)
                assert not provider.errors
            except BaseException as error:
                errors.append('Provider cleanup: ' + repr(error))
            # Even a failed final log write cannot abandon live handlers. Only
            # observe/join the original owners; never restart a provider.
            while not provider_settled:
                with provider.lock:
                    handlers = list(provider.handlers)
                provider_settled = not provider.thread.is_alive() and not any(t.is_alive() for t in handlers)
                if not provider_settled:
                    for thread in [provider.thread, *handlers]:
                        try:
                            thread.join(timeout=0.25)
                        except BaseException:
                            pass
        if journey is not None:
            for label, close in [('control', journey.custody.close), ('log', journey.log.close)]:
                try:
                    close()
                except BaseException as error:
                    errors.append(label + ' close: ' + repr(error))
        try:
            if native_settled and not errors:
                owned.validate()
                result = run_helper(owned, observer.parent / 'AttentionFixtureCleanup', environment,
                                    lambda record: evidence.update(cleanup_helper=record))
                assert result['root'] == str(root) and result['profile'] == oracle.digest
                assert result['initialization_ephemeral'] is True
                expected_uuid = uuid.UUID(bytes=bytes.fromhex(oracle.digest)[:16], version=5)
                assert uuid.UUID(result['website_store_removed']) == expected_uuid
                save('website-cleanup.json', result)
                if evidence['passed']:
                    owned.remove(dict(native=native_settled, provider=provider_settled, website=True))
                    evidence['private_root_removed'] = True
        except BaseException as error:
            errors.append('Website cleanup: ' + repr(error))
        finally:
            owned.close()
        evidence['cleanup_errors'] = errors
        evidence['fixture_root'] = str(root)
        evidence['native_settled'] = native_settled
        evidence['passed'] = evidence['passed'] and native_settled and not errors
        try:
            assert source_binding(root_source, source_ref) == binding
        except BaseException as error:
            evidence.update(passed=False, source_error=repr(error))
        save('summary.json', evidence)
    assert evidence['passed'], evidence
    return evidence


if __name__ == '__main__':
    assert len(sys.argv) == 6, 'APP FRESH_OUTPUT INSTANCE_OBSERVER FULL_SOURCE_REF ABSOLUTE_MONOTONIC_DEADLINE'
    run_contract(*sys.argv[1:5], float(sys.argv[5]))
