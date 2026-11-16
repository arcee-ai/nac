#!/usr/bin/env python3
"""Finite Foundation/real-HTTP/mock-center qualification; never an app or OS test.

Run under the shared browser/Mac lease with immutable binaries copied inside a
Rust lease. Only this explicit driver mutates disposable fixture state. The
Swift consumer itself can issue only GET /attention/events.
"""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import queue
import select
import signal
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
# Local controller imports must not dirty the exact source checkout before its
# qualification guard, including callers that did not pass python -B.
sys.dont_write_bytecode = True
from attention_feed_build import (SOURCES, SWIFT_PROGRAMS, swift_commands, source_binding, build_environment,
                                  producer_receipts, completion_envelope)

OWNER = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def until(predicate, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(.02)
    raise TimeoutError('bounded fixture condition did not settle')


def cleanup(*operations):
    errors, receipts = [], []
    for operation in operations:
        try:
            receipts.append(operation())
        except Exception as error:
            errors.append(repr(error))
    assert not errors, errors
    return receipts


def request(base, path, body=None, method=None, expected=200):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    try:
        response = urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read(1024 * 1024 + 1)
        assert len(raw) <= 1024 * 1024
        value = json.loads(raw) if raw else None
        if expected is None:
            return response.code, value
        assert response.code == expected, (path, response.code, raw[:600])
        return value


class Server:
    def __init__(self, handler):
        self.active, self.active_lock = 0, threading.Lock()
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def dispatch(self):
                with owner.active_lock:
                    owner.active += 1
                try:
                    handler(self)
                finally:
                    with owner.active_lock:
                        owner.active -= 1
            do_GET = dispatch
            do_POST = dispatch
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.base = 'http://127.0.0.1:' + str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(3)
        until(lambda: self.active == 0, timeout=5)
        assert not self.thread.is_alive()
        return dict(active_handlers=0, server_thread_joined=True)


def send(handler, status, body, content_type='application/json', headers=None):
    handler.send_response(status)
    handler.send_header('Content-Type', content_type)
    if content_type != 'text/event-stream':
        handler.send_header('Content-Length', str(len(body)))
    for key, value in (headers or {}).items():
        handler.send_header(key, value)
    handler.end_headers()
    try:
        handler.wfile.write(body)
        handler.wfile.flush()
    except (BrokenPipeError, ConnectionResetError):
        pass


class Provider(Server):
    def __init__(self, kind):
        self.kind, self.calls, self.gates, self.goal = kind, [], [], ''
        self.lock = threading.Lock()
        self.failures = []
        super().__init__(self.respond)
    def respond(self, handler):
        try:
            assert handler.command == 'POST' and handler.path == '/responses'
            size = int(handler.headers['Content-Length'])
            assert size <= 1024 * 1024
            payload = json.loads(handler.rfile.read(size))
            gate = threading.Event()
            with self.lock:
                index = len(self.calls)
                self.calls.append({'index': index, 'method': handler.command, 'path': handler.path})
                self.gates.append(gate)
            assert index < 8, 'unexpected model loop'
            if index == 0 or self.kind == 'queue':
                assert gate.wait(45), 'unreleased owned provider request'
            if self.kind in ('ask', 'review') and index == 0:
                item = {'type': 'function_call', 'call_id': 'ask', 'name': 'exec_command',
                        'arguments': json.dumps({'cmd': 'pwd'})}
            elif self.kind == 'question' and index == 0:
                item = {'type': 'function_call', 'call_id': 'question', 'name': 'request_question',
                        'arguments': json.dumps({'request_id': 'choice', 'text': 'PRIVATE QUESTION CANARY',
                                                 'choices': ['JSON'], 'responder_class': 'human_decision'})}
            elif self.kind == 'question' and index == 1:
                item = {'type': 'function_call', 'call_id': 'goal', 'name': 'update_goal',
                        'arguments': json.dumps({'goal_id': self.goal, 'status': 'complete'})}
            else:
                item = {'type': 'message', 'content': [{'type': 'output_text', 'text': 'PRIVATE RESULT CANARY'}]}
            response = {'status': 'completed', 'output': [item],
                        'usage': {'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 2}}
            body = json.dumps(response).encode()
            if payload.get('stream'):
                body = b'data: ' + json.dumps({'type': 'response.completed', 'response': response}).encode() + b'\n\n'
            send(handler, 200, body, 'text/event-stream' if payload.get('stream') else 'application/json')
        except Exception as error:
            self.failures.append(repr(error))
            send(handler, 500, b'{}')
    def reached(self, index):
        until(lambda: len(self.calls) > index)
    def release(self, index):
        self.reached(index)
        self.gates[index].set()
    def close(self):
        for gate in self.gates:
            gate.set()
        closed = super().close()
        assert not self.failures, self.failures
        return dict(**closed, provider_requests=len(self.calls), failures=[])


class Engine:
    def __init__(self, binary, root, review=False):
        self.root = root.resolve()
        self.root.mkdir(exist_ok=True)
        self.workspace, self.store = self.root / 'workspace', self.root / 'store.db'
        self.workspace.mkdir(exist_ok=True)
        self.env = {k: v for k, v in os.environ.items() if k in ('PATH', 'LANG', 'TMPDIR')}
        self.env.update(HOME=str(self.root), NAC_HOME=str(self.root / 'nac'), BROWSER='none',
                        NAC_TELEMETRY='disabled', GIT_CONFIG_NOSYSTEM='1')
        subprocess.run(['git', 'init', '-q', str(self.workspace)], env=self.env, check=True)
        subprocess.run(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                        'commit', '--allow-empty', '-qm', 'Fixture'], cwd=self.workspace, env=self.env, check=True)
        self.identity = json.loads(subprocess.check_output([str(binary), '__desktop-identity'], env=self.env))
        self.incarnation = str(uuid.uuid4())
        self.profile = str(uuid.uuid4())
        self.channel, child = socket.socketpair()
        self.env['NAC_DESKTOP_CHANNEL_FD'] = str(child.fileno())
        if review:
            self.env.update(ARCEE_API_KEY='dummy-review-only', NAC_REVIEW_FIXTURE=json.dumps(
                {'reject_containing': ['pwd'], 'category': 'out_of_scope'}))
        self.log = (self.root / 'diagnostics.log').open('wb')
        self.process = subprocess.Popen([str(binary), '--bind', '127.0.0.1:0', '--directory', str(self.workspace),
                                         '--store-path', str(self.store), '--no-open'], env=self.env,
                                        pass_fds=(child.fileno(),), stdin=subprocess.DEVNULL,
                                        stdout=self.log, stderr=self.log, start_new_session=True)
        child.close()
        try:
            self.channel.sendall(json.dumps(dict(kind='hello', version=1, incarnation=self.incarnation,
                                                 identity=self.identity, store=str(self.store))).encode() + b'\n')
            raw, deadline = b'', time.monotonic() + 15
            while not raw.endswith(b'\n'):
                assert len(raw) <= 16384 and time.monotonic() < deadline
                if not select.select([self.channel], [], [], min(1, max(0, deadline-time.monotonic())))[0]:
                    continue
                byte = self.channel.recv(1)
                assert byte, 'private channel closed before ready'
                raw += byte
            self.ready = json.loads(raw)
            assert self.ready['kind'] == 'ready' and self.ready['incarnation'] == self.incarnation
            assert self.ready['identity'] == self.identity and self.ready['store'] == str(self.store)
            self.base = self.ready['endpoint']
            assert self.base.startswith('http://127.0.0.1:') and self.ready['schema'] > 0
        except Exception:
            try:
                self.channel.close()
                if self.process.poll() is None:
                    self.process.wait(timeout=23)
            finally:
                if self.process.poll() is None:
                    assert os.getpgid(self.process.pid) == self.process.pid
                    os.killpg(self.process.pid, signal.SIGKILL)
                    self.process.wait(5)
                self.log.close()
            raise
    def session(self, provider):
        config = request(self.base, '/model-configs', dict(name='Attention fixture '+self.incarnation, backend='openai-responses',
            model='gpt-5.6-sol', base_url=provider.base, api_key='fixture-dummy-only',
            reasoning_effort='high', extra_headers={}, orchestrator_compaction_threshold=0), expected=201)
        project = request(self.base, '/projects', dict(name='Attention fixture '+self.incarnation, cwd=str(self.workspace),
                          default_model_config_id=config['config_id']), expected=201)
        self.project_id = project['project_id']
        session = request(self.base, '/sessions', dict(behavior='direct', project_id=project['project_id'],
                          light_model=None), expected=201)
        return session['metadata']['session_id']
    def stop(self):
        if self.process.poll() is None:
            try:
                self.channel.sendall(json.dumps(dict(kind='stop', version=1, incarnation=self.incarnation)).encode() + b'\n')
                assert self.process.wait(timeout=23) == 0
            finally:
                if self.process.poll() is None:
                    assert os.getpgid(self.process.pid) == self.process.pid
                    os.killpg(self.process.pid, signal.SIGKILL)
                    self.process.wait(5)
        self.channel.close()
        self.log.close()
        assert self.process.returncode == 0
        rows = subprocess.check_output(['/bin/ps', '-axo', 'pgid=,stat='], text=True).splitlines()
        assert not [x for x in rows if len(x.split()) == 2 and x.split()[0] == str(self.process.pid)
                    and not x.split()[1].startswith('Z')]
        with sqlite3.connect(self.store) as db:
            assert db.execute('PRAGMA quick_check').fetchone() == ('ok',)
            db.execute('BEGIN IMMEDIATE')
            db.rollback()
        return dict(engine_pid=self.process.pid, exit_code=0, owned_descendants_absent=True, sqlite_quick_check='ok')


class Consumer:
    def __init__(self, binary, destination):
        self.events, self.pages, self.error, self.token = queue.Queue(), queue.Queue(maxsize=32), None, 0
        self.log = destination.open('w')
        self.process = subprocess.Popen([str(binary)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                         stderr=subprocess.PIPE, text=True, start_new_session=True)
        def reader():
            try:
                while line := self.process.stdout.readline(8*1024*1024+1):
                    assert line.endswith('\n') and len(line.encode()) <= 8*1024*1024
                    self.log.write(line); self.log.flush()
                    event = json.loads(line)
                    if event['type'] in ('ready', 'snapshot'):
                        self.events.put(event)
                    elif event['type'] == 'completion_page':
                        self.pages.put_nowait(event) # explicit fixture capacity, never silently drop history
            except Exception as error:
                self.error = repr(error)
        self.thread = threading.Thread(target=reader, daemon=True)
        self.thread.start()
        assert self.events.get(timeout=5)['type'] == 'ready'
    def command(self, command, **kwargs):
        self.process.stdin.write(json.dumps(dict(command=command, **kwargs)) + '\n')
        self.process.stdin.flush()
    def bind(self, engine, **policy):
        self.command('bind', profile=engine.profile, engine=engine.incarnation, endpoint=engine.base)
        self.command('policy', opted_in=True, authorized=True, **policy)
        return self.wait(lambda s: s['status']['phase'] == 'observing')
    def snapshot(self):
        self.token += 1
        token = str(self.token)
        self.command('snapshot', token=token)
        event = self.events.get(timeout=5)
        assert not self.error and event['type'] == 'snapshot' and event['token'] == token, (self.error, event)
        return event
    def wait(self, predicate, timeout=15):
        return until(lambda: (s if predicate(s) else None) if (s := self.snapshot()) else None, timeout)
    def stop(self):
        event = None
        try:
            if self.process.poll() is None:
                self.command('quit', token='final')
                event = self.events.get(timeout=8)
                assert event['token'] == 'final' and event['status']['phase'] == 'retired'
                assert event['pending_delivery_callbacks'] == 0
                assert event['pending_completion_callbacks'] == 0
                assert all(event['status'][x] == 0 for x in ('tasks', 'retries', 'draining_sessions', 'sources', 'identities', 'bytes'))
                assert self.process.wait(5) == 0
        finally:
            if self.process.poll() is None:
                assert os.getpgid(self.process.pid) == self.process.pid
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait(5)
            self.thread.join(3)
            self.log.close()
        assert not self.thread.is_alive() and self.process.returncode == 0, self.process.stderr.read()
        assert event is not None and event['active'] == 0
        return dict(swift_exit_code=0, native_retention=event['status'], mock_active=0,
                    pending_delivery_callbacks=event['pending_delivery_callbacks'], reader_joined=True)


def serializer_envelope(destination):
    api = json.loads((OWNER.parent.parent / 'crates/nac-server/web/openapi.json').read_text())
    schemas = api['components']['schemas']
    def kinds(name):
        return {x['properties']['kind']['enum'][0] for x in schemas[name]['oneOf']}
    assert kinds('AttentionFrame') == {'baseline', 'completions', 'record', 'reset'}
    assert kinds('AttentionChangeDto') == {'source_replaced', 'work_settled', 'work_cleared', 'decision_pending',
                                         'decision_resolved', 'session_deleted', 'availability', 'checkpoint'}
    assert kinds('AttentionDecisionDto') == {'permission', 'review', 'question'}
    maximum = 2**64 - 1
    source = dict(session_id='', epoch=str(uuid.uuid4()))
    availability = dict(work='unsupported', questions='unsupported', permissions='unsupported',
                        reviews='unsupported', topology='unsupported')
    work = dict(run_id='', goal=dict(id='', version=maximum), disposition='waiting_for_decision')
    snapshot = dict(source=source, revision=maximum, work=work, pending=[], availability=availability)
    decision = dict(kind='question', request_id='', run_id='', generation='', revision=maximum)
    fixed = [len(json.dumps(x, separators=(',', ':')).encode()) for x in (snapshot, decision)]
    assert max(fixed) < 640
    bound = 6 * 1024 * 1024 + 2 * 1024 * 640 + 4096
    assert bound < 8 * 1024 * 1024
    proof = dict(schema_sha256=sha(OWNER.parent.parent / 'crates/nac-server/web/openapi.json'),
                 maximum_fixed_bytes=fixed, fixed_envelope_each=640, sources=1024, identities=1024,
                 metadata_bytes=1024*1024, escaping_factor=6, frame_envelope=4096,
                 serialized_upper_bound=bound, consumer_event_cap=8*1024*1024,
                 actual_swift_maximum_escaped_baseline='Validated by AttentionFeedTests.maximumWriterEnvelope',
                 completion=completion_envelope(schemas))
    destination.write_text(json.dumps(proof, indent=2) + '\n')


def real_case(kind, binary, swift, root, artifact):
    profile = root / kind
    provider = Provider(kind)
    engine = consumer = interactive = replacement = None
    result = {}
    try:
        engine = Engine(binary, profile, review=kind == 'review')
        sid = engine.session(provider)
        target = '/sessions/' + sid
        if kind == 'review':
            request(engine.base, target + '/permissions/mode', {'mode': 'review'}, method='PUT', expected=204)
        if kind == 'ask':
            interactive = http.client.HTTPConnection('127.0.0.1', int(engine.base.rsplit(':', 1)[1]), timeout=15)
            interactive.request('GET', target + '/events/stream')
            assert interactive.getresponse().status == 200
        consumer = Consumer(swift, artifact / (kind + '-swift.jsonl'))
        initial = consumer.bind(engine)
        assert not initial['notices']
        if kind == 'quiet':
            request(engine.base, '/attention/events', expected=409)
            started, count = time.monotonic(), len(initial['requests'])
            time.sleep(61)
            quiet = consumer.snapshot()
            assert time.monotonic() - started >= 60 and len(quiet['requests']) == count == 1
            assert quiet['status']['tasks'] == 1 and quiet['status']['retries'] == 0 and not quiet['notices']
            consumer.command('policy', opted_in=False)
            off = consumer.wait(lambda s: s['status']['tasks'] == s['status']['retries'] == s['status']['draining_sessions'] == 0)
            assert off['status']['bytes'] == 0
            consumer.command('policy', opted_in=True, authorized=True)
            until(lambda: consumer.snapshot()['status']['phase'] == 'observing')
            assert not consumer.snapshot()['notices']
            result.update(case='H5-quiet-busy-seat', elapsed=time.monotonic()-started, one_quiet_connection=True)
            return result
        started = request(engine.base, target + '/runs', {'prompt': 'Complete only the fixture work'}, expected=202)
        run_a = started['run_id']
        provider.reached(0)
        if kind == 'queue':
            for name in ('B', 'C'):
                request(engine.base, target + '/inbox', {'delivery': 'queue', 'prompt': name}, expected=202)
            provider.release(0); provider.reached(1)
            provider.release(1); provider.reached(2)
            assert not consumer.snapshot()['notices']
            inbox = request(engine.base, target + '/inbox')
            run_c = inbox[-1]['delivered_run_id']
            assert run_c and run_c != run_a
            provider.release(2)
            done = consumer.wait(lambda s: len(s['notices']) == 1)
            assert done['notices'][0]['kind'] == 'completed' and run_c in done['notices'][0]['identity']
            assert len(provider.calls) == 3
        elif kind == 'replacement':
            provider.release(0)
            consumer.wait(lambda s: len(s['notices']) == 1)
            engine.stop()
            shutil.copyfile(engine.root/'diagnostics.log', artifact/'replacement-old-engine.log')
            replacement = Engine(binary, profile)
            replacement.profile = engine.profile
            assert replacement.ready['store'] == engine.ready['store'] and replacement.incarnation != engine.incarnation
            next_sid = request(replacement.base, '/sessions', dict(behavior='direct', project_id=engine.project_id, light_model=None), expected=201)['metadata']['session_id']
            rebound = consumer.bind(replacement)
            assert len(rebound['notices']) == 1
            consumer.command('click', index=0)
            assert consumer.snapshot()['navigations'] == []
            next_run = request(replacement.base, '/sessions/'+next_sid+'/runs', {'prompt': 'New incarnation work'}, expected=202)['run_id']
            provider.reached(1)
            done = consumer.wait(lambda s: len(s['notices']) == 2)
            assert next_run in done['notices'][1]['identity'] and done['notices'][1]['engine'].lower() == replacement.incarnation
            consumer.command('click', index=1)
            consumer.wait(lambda s: s['navigations'] == [next_sid])
            result.update(case='H5-actual-engine-replacement', old_ready=engine.ready, new_ready=replacement.ready,
                        old_run=run_a, new_run=next_run, old_notice_rejected=True, notices=done['notices'],
                        serving_store_reacquired=True)
            return result
        elif kind == 'question':
            goal = request(engine.base, target + '/goal', {'objective': 'Complete the chosen export'}, expected=201)
            provider.goal = goal['goal_id']; provider.release(0)
            consumer.wait(lambda s: len(s['notices']) == 1 and s['notices'][0]['kind'] == 'question')
            question = request(engine.base, target + '/questions')[0]
            q = question['request']
            request(engine.base, target + '/questions/' + q['request_id'] + '/answer',
                    dict(request_id=q['request_id'], run_id=q['run_id'], generation=q['generation'],
                         expected_revision=question['revision'], answer='JSON'))
            done = consumer.wait(lambda s: len(s['notices']) == 2)
            assert [n['kind'] for n in done['notices']] == ['question', 'completed']
            consumer.command('click', index=0)
            assert consumer.wait(lambda s: s['navigations'] == [sid])
        elif kind in ('ask', 'review'):
            before = request(engine.base, target + '/permissions')
            provider.release(0)
            pending = consumer.wait(lambda s: len(s['notices']) == 1 and s['notices'][0]['kind'] == ('permission' if kind == 'ask' else 'review'))
            state = request(engine.base, target + '/permissions')
            if kind == 'ask':
                decision = state['requests'][0]['id']
                uuid.UUID(decision)
                request(engine.base, target + '/permissions/' + decision, {'reply': 'reject'}, expected=204)
                consumer.wait(lambda s: len(s['notices']) == 2 and s['status']['pending'] == 0)
                consumer.command('click', index=0)
                consumer.wait(lambda s: s['navigations'] == [sid])
            else:
                decision = state['authorizable_review_ids'][0]
                uuid.UUID(decision)
                until(lambda: request(engine.base, target).get('active_run') is None)
                with sqlite3.connect(engine.store) as db:
                    db.execute("CREATE TRIGGER rollback_retry BEFORE INSERT ON session_inbox BEGIN SELECT RAISE(ABORT,'fixture rollback'); END")
                request(engine.base, target + '/permissions/reviews/' + decision + '/authorize-retry', {}, expected=500)
                with sqlite3.connect(engine.store) as db:
                    db.execute('DROP TRIGGER rollback_retry')
                restored = request(engine.base, target + '/permissions')
                assert decision in restored['authorizable_review_ids']
                time.sleep(.2)  # Coalescing may omit a transient remove/restore pair.
                assert len(consumer.snapshot()['notices']) == len(pending['notices']) == 1
                assert before['grants'] == restored['grants'] and before['approval_mode'] == restored['approval_mode']
                # Public creation owns the real cache sweep; observation itself
                # never attaches or pins the now-idle review service.
                request(engine.base, '/sessions', dict(behavior='direct', project_id=engine.project_id, light_model=None), expected=201)
                lost = consumer.wait(lambda s: sid in s['status']['unknown_decision_sessions'])
                assert len(lost['notices']) == 1 and lost['active'] == 0
                consumer.command('click', index=0)
                assert consumer.snapshot()['navigations'] == []
        elif kind in ('cancel', 'save-failure'):
            if kind == 'cancel':
                request(engine.base, target + '/runs/' + run_a + '/cancel', {}, expected=202)
            else:
                with sqlite3.connect(engine.store) as db:
                    db.execute("CREATE TRIGGER failed_terminal BEFORE INSERT ON session_run_outcomes BEGIN SELECT RAISE(ABORT,'fixture terminal save'); END")
            provider.release(0)
            if kind == 'save-failure':
                def failed_read():
                    status, body = request(engine.base, target, expected=None)
                    assert status in (200, 500), (status, body)
                    if status == 500:
                        assert 'fixture terminal save' in body['error']
                        return body
                    return None
                observed_failure = until(failed_read)
                (artifact/'terminal-save-failure-response.json').write_text(json.dumps(observed_failure)+'\n')
                assert not consumer.snapshot()['notices']
                with sqlite3.connect(engine.store) as db:
                    db.execute('DROP TRIGGER failed_terminal')
            until(lambda: request(engine.base, target).get('active_run') is None)
            assert not consumer.snapshot()['notices']
        else:
            provider.release(0)
            consumer.wait(lambda s: len(s['notices']) == 1)
        snapshot = consumer.snapshot()
        assert 'CANARY' not in json.dumps(snapshot) and set(snapshot['requests']) == {'GET /attention/events'}
        # Actual HTTP reopen: new silent baseline, not a retained-hub replay.
        consumer.command('policy', opted_in=False)
        consumer.wait(lambda s: s['status']['tasks'] == s['status']['draining_sessions'] == 0)
        count = len(snapshot['notices'])
        consumer.command('policy', opted_in=True, authorized=True)
        consumer.wait(lambda s: s['status']['phase'] == 'observing')
        reopened = consumer.snapshot()
        assert len(reopened['notices']) == count
        assert reopened['status']['projection_epoch'] != snapshot['status']['projection_epoch']
        result.update(case=kind, session=sid, actual_run=run_a, notices=snapshot['notices'],
                      provider_calls=len(provider.calls), requests=snapshot['requests'], actual_private_launch=engine.ready,
                      consumer_status=snapshot['status'], current_active_notifications=snapshot['active'])
        return result
    except Exception as error:
        for label, owned in [('engine', engine), ('replacement', replacement)]:
            if owned:
                if not owned.log.closed:
                    owned.log.flush()
                shutil.copyfile(owned.root/'diagnostics.log', artifact/(kind+'-failure-'+label+'.log'))
        (artifact/(kind+'-failure-before-cleanup.json')).write_text(json.dumps(dict(error=repr(error),
            engine_pid=engine.process.pid if engine else None, provider_calls=provider.calls), indent=2)+'\n')
        raise
    finally:
        for gate in provider.gates:
            gate.set()
        result['cleanup'] = cleanup(*([consumer.stop] if consumer else []), *([interactive.close] if interactive else []),
                *([replacement.stop] if replacement else []),
                *([engine.stop] if engine else []), provider.close)


def mock_frame(engine, sequence=0, decision=False, silent_review=None):
    source = dict(session_id='mock-session', epoch='30000000-0000-0000-0000-000000000003')
    boundary = dict(engine=engine, epoch='20000000-0000-0000-0000-000000000002', sequence=sequence)
    if sequence == 0:
        frame = dict(kind='baseline', boundary=boundary, reset=None, sources=[dict(source=source, revision=0,
                     work=None, pending=[], availability=dict(work='unknown', questions='available', permissions='available',
                                                             reviews='available', topology='available'))])
    else:
        frame = dict(kind='record', boundary=boundary, source=source, source_revision=sequence,
                     change=dict(kind='decision_pending' if decision or silent_review else 'decision_resolved',
                                 decision=(dict(kind='review', review_id=silent_review) if silent_review else
                                           dict(kind='permission', request_id='mock-request'))), new_attention=decision)
    return ('event: attention\nid: '+engine+':'+boundary['epoch']+':'+str(sequence)+'\ndata: '+json.dumps(frame)+'\n\n').encode()


def completion_frame(store, sequence, *, baseline=False, more=False):
    page = dict(store_id=store, cursor=sequence, high_water=sequence if not more else sequence+1,
                baseline=baseline, more=more, items=[] if baseline else [dict(sequence=sequence,
                session_id='mock-session', run_id='semantic-run-'+str(sequence), behavior='direct',
                kind='request', goal_id=None, mark_version=None)])
    return ('event: attention\ndata: '+json.dumps(dict(kind='completions', page=page))+'\n\n').encode()


def semantic_page_cases(swift, artifact):
    """Actual native URLSession/page ACK, explicit mock stream/checkpoint only."""
    results = []
    for accept in (True, False):
        incarnation, store = str(uuid.uuid4()), str(uuid.uuid4())
        ended, calls, consumer, result = threading.Event(), [], None, None
        def handler(h):
            calls.append(dict(method=h.command, path=h.path, cursor=h.headers.get('X-NAC-Completion-Cursor')))
            assert calls[-1] == dict(method='GET', path='/attention/events', cursor='new')
            payload = completion_frame(store, 0, baseline=True) + mock_frame(incarnation) + \
                completion_frame(store, 1, more=True) + completion_frame(store, 2)
            send(h, 200, payload, 'text/event-stream')
            assert ended.wait(30), 'Semantic fixture was not retired'
        server = Server(handler)
        label = 'semantic-page-'+('accept' if accept else 'reject')
        try:
            consumer = Consumer(swift, artifact/(label+'-swift.jsonl'))
            consumer.command('completions', page_mode='delayed')
            consumer.command('bind', profile=str(uuid.uuid4()), engine=incarnation, endpoint=server.base)
            consumer.command('policy', opted_in=True, authorized=True)
            cutoff = consumer.wait(lambda s: s['pending_completion_callbacks'] == 1)
            assert cutoff['completion_pages'] == 1 and cutoff['completion_cursor'] is None
            assert not cutoff['status']['projection_available']
            consumer.command('complete_page', accepted=True)
            first = consumer.wait(lambda s: s['completion_pages'] == 2 and s['pending_completion_callbacks'] == 1)
            assert first['completion_cursor'] == store+':0' and first['accepted_completion_items'] == 0
            assert first['status']['projection_available'] and first['status']['phase'] == 'accounting'
            assert first['status']['tasks'] == 1
            consumer.command('complete_page', accepted=accept)
            if accept:
                consumer.wait(lambda s: s['completion_pages'] == 3 and s['pending_completion_callbacks'] == 1)
                consumer.command('complete_page', accepted=True)
                final = consumer.wait(lambda s: s['completion_cursor'] == store+':2' and s['pending_completion_callbacks'] == 0)
                assert final['accepted_completion_items'] == 2
            else:
                final = consumer.wait(lambda s: s['status']['phase'] == 'unavailable' and s['pending_completion_callbacks'] == 0)
                assert final['completion_cursor'] == store+':0' and final['accepted_completion_items'] == 0
                assert final['status']['tasks'] == 0
            expected = 3 if accept else 2
            until(lambda: consumer.pages.qsize() == expected)
            pages = [consumer.pages.get_nowait() for _ in range(expected)]
            assert [page['cursor'] for page in pages] == [store+':'+str(n) for n in range(expected)]
            result = dict(case=label, consumer_mode='semantic_pages', actual_rust_producer=False,
                          checkpoint_ack='explicit mock; no disk or app', requests=calls, pages=pages, final=final)
            results.append(result)
        finally:
            ended.set()
            closed = cleanup(*([consumer.stop] if consumer else []), server.close)
            if result is not None: result['cleanup'] = closed
    return results


def transport_cases(swift, artifact):
    results = []
    for case in ('resolved-click', 'denied', 'muted', 'focused', 'malformed', 'oversized', 'redirect', 'late-owner', 'sink-failure', 'late-center', 'privacy', 'silent-pending-capacity'):
        incarnation, release, ended = str(uuid.uuid4()), threading.Event(), threading.Event()
        calls, redirect_calls, consumer, second, result = [], [], None, None, None
        def handler(h):
            calls.append((h.command, h.path))
            if case == 'redirect':
                send(h, 302, b'', headers={'Location': second.base+'/forbidden'})
                return
            payload = b'x' * (8*1024*1024+1) if case == 'oversized' else (
                b'event: attention\ndata: {broken}\n\n' if case == 'malformed' else mock_frame(incarnation))
            if case == 'silent-pending-capacity':
                # Faulted/out-of-contract stream: the actual Rust producer
                # independently enforces 1024 identities before serialization.
                payload += b''.join(mock_frame(incarnation, n, silent_review=f'r{n:04d}') for n in range(1, 1026))
            if case == 'late-owner':
                assert release.wait(10)
                payload += mock_frame(incarnation, 1, True)
            send(h, 200, payload, 'text/event-stream')
            if case in ('resolved-click', 'denied', 'muted', 'focused', 'sink-failure', 'late-center', 'privacy'):
                assert release.wait(10)
                try:
                    h.wfile.write(mock_frame(incarnation, 1, True) + (b'' if case in ('sink-failure', 'late-center') else mock_frame(incarnation, 2)))
                    h.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass
            ended.wait(30)
        if case == 'redirect':
            def destination(h):
                redirect_calls.append((h.command, h.path))
                send(h, 200, b'{}')
            second = Server(destination)
        server = Server(handler)
        try:
            consumer = Consumer(swift, artifact / (case + '-swift.jsonl'))
            if case in ('sink-failure', 'late-center'):
                consumer.command('delivery_mode', delivery_mode='fail' if case == 'sink-failure' else 'delayed')
            consumer.command('bind', profile=str(uuid.uuid4()), engine=incarnation, endpoint=server.base)
            consumer.command('policy', opted_in=True, authorized=case != 'denied', muted=case == 'muted', focused=case == 'focused', private_content=case != 'privacy')
            if case == 'late-owner':
                until(lambda: len(calls) == 1)
                other = str(uuid.uuid4())
                second = Server(lambda h: (send(h, 200, mock_frame(other) + mock_frame(other, 1, True), 'text/event-stream'), ended.wait(30)))
                consumer.command('bind', profile=str(uuid.uuid4()), engine=other, endpoint=second.base)
                release.set()
                done = consumer.wait(lambda s: len(s['notices']) == 1)
                assert done['notices'][0]['engine'].lower() == other
            elif case in ('malformed', 'oversized', 'redirect', 'silent-pending-capacity'):
                done = consumer.wait(lambda s: s['status']['phase'] == 'unavailable')
                assert not done['notices'] and len(calls) == 1
                if case == 'silent-pending-capacity':
                    done = consumer.wait(lambda s: s['status']['phase'] == 'unavailable' and
                                         s['status']['tasks'] == s['status']['retries'] == s['status']['draining_sessions'] == 0)
                    assert all(done['status'][key] == 0 for key in ('sources', 'identities', 'pending', 'bytes'))
                    assert done['active'] == done['pending_delivery_callbacks'] == 0
                    assert not done['notices'] and len(calls) == 1
                if case == 'redirect':
                    assert not redirect_calls and done['status']['retries'] == 0
            else:
                consumer.wait(lambda s: s['status']['phase'] == 'observing')
                release.set()
                done = consumer.wait(lambda s: s['status']['sequence'] == (1 if case in ('sink-failure', 'late-center') else 2))
                if case == 'sink-failure':
                    done = consumer.wait(lambda s: s['status']['delivery_failures'] == 1)
                    assert len(done['notices']) == 1 and done['active'] == 0
                elif case == 'late-center':
                    assert done['pending_delivery_callbacks'] == 1 and done['active'] == 0
                    consumer.command('retire', token='before-late-ack')
                    event = consumer.events.get(timeout=8)
                    assert event['token'] == 'before-late-ack'
                    consumer.command('complete_deliveries')
                    late = consumer.snapshot()
                    assert late['active'] == 0 and late['pending_delivery_callbacks'] == 0
                    assert late['status']['phase'] == 'retired' and late['status']['delivery_acknowledgments'] == 0
                elif case == 'resolved-click':
                    assert len(done['notices']) == 1 and done['active'] == 0
                    consumer.command('click', index=0)
                    consumer.wait(lambda s: s['navigations'] == ['mock-session'])
                    consumer.command('policy', opted_in=False)
                    consumer.wait(lambda s: s['status']['tasks'] == s['status']['draining_sessions'] == 0)
                    consumer.command('click', index=0)
                    assert consumer.snapshot()['navigations'] == ['mock-session']
                else:
                    assert not done['notices']
            assert all(x == ('GET', '/attention/events') for x in calls)
            result = dict(case='H6-'+case, requests=calls, redirect_destination_requests=redirect_calls, actual_rust_producer=False)
            results.append(result)
        except Exception as error:
            (artifact/(case+'-failure-before-cleanup.json')).write_text(json.dumps(dict(error=repr(error), requests=calls), indent=2)+'\n')
            raise
        finally:
            release.set(); ended.set()
            closed = cleanup(*([consumer.stop] if consumer else []), server.close, *([second.close] if second else []))
            if result is not None:
                result['cleanup'] = closed
                if case == 'silent-pending-capacity':
                    rows = [json.loads(line) for line in (artifact/(case+'-swift.jsonl')).read_text().splitlines()]
                    states = [row['status'] for row in rows if 'status' in row]
                    assert any(s['identities'] == s['pending'] == 1024 for s in states)
                    assert max(s['identities'] for s in states) == max(s['pending'] for s in states) == 1024
                    result['capacity_proof'] = dict(faulted_out_of_contract_stream=True, silent_accepted=1024,
                                                  rejected_record=1025, effects=0, terminal_unavailable=True,
                                                  drained_before_retirement=True)
    return results + source_handoff_cases(swift, artifact)


def source_handoff_cases(swift, artifact, modes=(False, True)):
    results = []
    for delayed in modes:
        case = 'source-handoff-' + ('delayed' if delayed else 'active')
        engine, old_epoch, new_epoch = str(uuid.uuid4()), '30000000-0000-0000-0000-000000000003', str(uuid.uuid4())
        gates, ended, calls, consumer, result = [threading.Event() for _ in range(5)], threading.Event(), [], None, None
        question = dict(kind='question', request_id='question', run_id='actual-run', generation='actual-generation', revision=1)
        next_question = dict(question, request_id='next-question')
        initial = json.loads(mock_frame(engine).split(b'data: ', 1)[1])['sources'][0]
        replacement = dict(initial, source=dict(session_id='mock-session', epoch=new_epoch), pending=[question])
        steps = [(old_epoch, 1, dict(kind='decision_pending', decision=question), True),
                 (new_epoch, 0, dict(kind='source_replaced', snapshot=replacement), False),
                 (new_epoch, 1, dict(kind='decision_resolved', decision=question), False),
                 (new_epoch, 2, dict(kind='decision_pending', decision=next_question), True),
                 (new_epoch, 3, dict(kind='decision_resolved', decision=next_question), False)]
        def handler(h):
            calls.append((h.command, h.path))
            send(h, 200, mock_frame(engine), 'text/event-stream')
            for sequence, (gate, (epoch, revision, change, fresh)) in enumerate(zip(gates, steps), 1):
                assert gate.wait(15), 'unreleased handoff fixture'
                frame = dict(kind='record', boundary=dict(engine=engine, epoch='20000000-0000-0000-0000-000000000002', sequence=sequence),
                             source=dict(session_id='mock-session', epoch=epoch), source_revision=revision, change=change, new_attention=fresh)
                try:
                    h.wfile.write(('event: attention\nid: '+engine+':'+frame['boundary']['epoch']+':'+str(sequence)+'\ndata: '+json.dumps(frame)+'\n\n').encode())
                    h.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    return
            ended.wait(30)
        server = Server(handler)
        try:
            consumer = Consumer(swift, artifact/(case+'-swift.jsonl'))
            consumer.command('delivery_mode', delivery_mode='delayed' if delayed else 'normal')
            consumer.command('bind', profile=str(uuid.uuid4()), engine=engine, endpoint=server.base)
            consumer.command('policy', opted_in=True, authorized=True)
            consumer.wait(lambda s: s['status']['phase'] == 'observing')
            gates[0].set()
            first = consumer.wait(lambda s: len(s['notices']) == 1 and s['status']['delivery_acknowledgments'] == (0 if delayed else 1))
            assert first['active'] == (0 if delayed else 1) and first['pending_delivery_keys'] == int(delayed)
            gates[1].set()
            handoff = consumer.wait(lambda s: s['status']['sequence'] == 2)
            assert len(handoff['notices']) == 1 and handoff['status']['pending'] == 1
            assert handoff['active'] == handoff['pending_delivery_keys'] == 0, ('F2 obsolete source delivery retained', handoff)
            consumer.command('click', index=0); consumer.command('complete_deliveries')
            late = consumer.snapshot()
            assert not late['navigations'] and late['active'] == late['pending_delivery_keys'] == late['pending_delivery_callbacks'] == 0
            assert late['status']['delivery_acknowledgments'] == first['status']['delivery_acknowledgments']
            gates[2].set()
            resolved = consumer.wait(lambda s: s['status']['sequence'] == 3)
            assert resolved['status']['pending'] == 0 and len(resolved['notices']) == 1
            consumer.command('delivery_mode', delivery_mode='normal'); gates[3].set()
            current = consumer.wait(lambda s: len(s['notices']) == 2 and s['status']['delivery_acknowledgments'] == first['status']['delivery_acknowledgments'] + 1)
            assert current['active'] == 1 and current['notices'][1]['source_epoch'].lower() == new_epoch
            consumer.command('click', index=0); consumer.command('click', index=1)
            consumer.wait(lambda s: s['navigations'] == ['mock-session'])
            gates[4].set()
            done = consumer.wait(lambda s: s['status']['sequence'] == 5)
            assert done['status']['pending'] == done['active'] == done['pending_delivery_keys'] == 0 and len(done['notices']) == 2
            assert calls == [('GET', '/attention/events')]
            result = dict(case='H7-'+case, actual_rust_producer=False, supported_question_handoff_shape=True,
                          initial=first, silent_handoff=handoff, late_callback=late, current_resolved=done, requests=calls)
            results.append(result)
        except Exception as error:
            (artifact/(case+'-failure-before-cleanup.json')).write_text(json.dumps(dict(error=repr(error), requests=calls), indent=2)+'\n')
            raise
        finally:
            for gate in gates: gate.set()
            ended.set()
            closed = cleanup(*([consumer.stop] if consumer else []), server.close)
            if result is not None: result['cleanup'] = closed
    return results


def build_producers(destination, source_ref):
    # This mode must execute INSIDE the caller's shared Rust lease. The runner
    # never installs dependencies or chooses another target directory.
    target = build_environment(os.environ)
    root = OWNER.parent.parent
    binding = source_binding(root, source_ref)
    rows = []
    for mode, features in [('ordinary', []), ('review', ['--features', 'review-fixture'])]:
        command = ['cargo', 'build', '--locked', '-p', 'nac-server', '--bin', 'nac-web'] + features
        with (destination/('build-'+mode+'.log')).open('w') as log:
            subprocess.run(command, cwd=root, stdout=log, stderr=subprocess.STDOUT, check=True)
        binary = destination/('producer-'+mode)
        if binary.exists():
            raise FileExistsError('Use a new immutable producer output directory')
        shutil.copy2(target/'debug/nac-web', binary)
        binary.chmod(0o555)
        identity = json.loads(subprocess.check_output([str(binary), '__desktop-identity']))
        assert identity['source_revision'] == source_ref
        assert source_binding(root, source_ref) == binding
        rows.append(dict(mode=mode, command=command, source_binding=binding, binary=str(binary.resolve()),
                         sha256=sha(binary), identity=identity, build_jobs=2, target_directory=str(target.resolve())))
        (destination/'producer-binaries.json').write_text(json.dumps(rows, indent=2)+'\n')
    print(json.dumps(dict(result='built', producer_receipt=str(destination/'producer-binaries.json'))))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--producer-receipt', type=Path)
    parser.add_argument('--build-producers', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--source-ref', required=True, help='Admitted exact full commit SHA; must match clean HEAD and producer receipts')
    parser.add_argument('--cases', default='all')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    assert not any(args.output.iterdir()), 'Use a fresh owned output directory; preserve earlier receipts'
    binding = source_binding(OWNER.parent.parent, args.source_ref)
    if args.build_producers:
        build_producers(args.output, args.source_ref)
        return
    assert args.producer_receipt is not None
    binaries = producer_receipts(json.loads(args.producer_receipt.read_text()), binding,
        lambda binary: json.loads(subprocess.check_output([str(binary), '__desktop-identity'])))
    compiler = subprocess.check_output(['xcrun', '--find', 'swiftc'], text=True).strip()
    sdk = subprocess.check_output(['xcrun', '--sdk', 'macosx', '--show-sdk-path'], text=True).strip()
    receipt = dict(**binding,
                   sources={x: sha(OWNER/x) for x in (*SOURCES, 'attention_feed_contract.py', 'attention_feed_build.py')},
                   producers=binaries, compiler=subprocess.check_output([compiler, '--version'], text=True).strip(),
                   sdk=sdk, target='arm64-apple-macosx14.0', cases=[], app_tested=False, os_delivery_tested=False,
                   performance_measured=False)
    with tempfile.TemporaryDirectory(prefix='nac-attention-feed-') as temp:
        root = Path(temp).resolve()
        receipt['programs'] = {}
        for name, command in swift_commands(compiler, sdk, OWNER, root).items():
            result = subprocess.run(command, capture_output=True, text=True, timeout=90)
            (args.output/(name+'-compile.log')).write_text(result.stdout + result.stderr)
            assert result.returncode == 0, result.stderr
            assert source_binding(OWNER.parent.parent, args.source_ref) == binding
            receipt['programs'][name] = dict(sources=SWIFT_PROGRAMS[name], command=command, sha256=sha(root/name))
        result = subprocess.run([str(root/'pure')], capture_output=True, text=True, timeout=60)
        (args.output/'pure.log').write_text(result.stdout + result.stderr)
        assert result.returncode == 0, result.stdout + result.stderr
        receipt['pure'] = json.loads(result.stdout)
        for name in ('completions', 'indicator'):
            result = subprocess.run([str(root/name)], capture_output=True, text=True, timeout=60)
            (args.output/(name+'.log')).write_text(result.stdout + result.stderr)
            assert result.returncode == 0, result.stdout + result.stderr
            receipt[name] = dict(result='passed', output=result.stdout)
        receipt['swift_binary_sha256'] = sha(root/'http')
        serializer_envelope(args.output/'serializer-envelope.json')
        selected = args.cases.split(',') if args.cases != 'all' else ['queue', 'question', 'ask', 'review', 'cancel', 'save-failure', 'quiet', 'replacement', 'transport', 'semantic-pages']
        allowed = {'queue', 'question', 'ask', 'review', 'cancel', 'save-failure', 'quiet', 'replacement', 'transport', 'semantic-pages'}
        assert set(selected) <= allowed and len(set(selected)) == len(selected) and selected
        try:
            for case in selected:
                print('START '+case, flush=True)
                if case == 'semantic-pages':
                    receipt['cases'].extend(semantic_page_cases(root/'http', args.output))
                else:
                    rows = transport_cases(root/'http', args.output) if case == 'transport' else [real_case(case,
                        Path(binaries['review' if case == 'review' else 'ordinary']['binary']), root/'http', root, args.output)]
                    receipt['cases'].extend(dict(row, consumer_mode='legacy_current_state') for row in rows)
                (args.output/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
                print('PASS '+case, flush=True)
        except Exception as error:
            receipt['failure'] = repr(error)
            (args.output/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
            raise
    receipt['temporary_resources_removed'] = True
    assert source_binding(OWNER.parent.parent, args.source_ref) == binding
    (args.output/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print(json.dumps(dict(result='passed', cases=len(receipt['cases']), app_tested=False, os_delivery_tested=False)))


if __name__ == '__main__':
    main()
