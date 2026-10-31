#!/usr/bin/env python3
"""Disposable real work for Quit/restart qualification, reusable by native E2E.

The standalone contract exercises the existing private engine stop boundary.
It does not establish AppKit, Dock, system WKWebView or trusted-input acceptance.
The normal app never imports this fixture or contains its dummy provider.
"""
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse
import uuid

from instance_contract import OwnedEngine, digest
from lifecycle_fixture import alive, wait_dead

TRANSCRIPT = 'NAC_QUIT_RETAINED_TRANSCRIPT'
GOAL = 'NAC_QUIT_DURABLE_GOAL'
APPROVAL = 'NAC_QUIT_PENDING_APPROVAL'


def until(description, predicate, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(.025)
    raise TimeoutError(description)


def request(endpoint, path, body=None, method=None):
    payload = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(endpoint + path, payload, method=method,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise AssertionError(f'{path}: {error.code}: {error.read(4096).decode()}') from error


class QuitProvider:
    """One completed transcript, one slow goal, and one unapproved tool call."""
    def __init__(self, workspace):
        self.workspace = workspace
        self.release = threading.Event()
        self.goal_accepted = threading.Event()
        self.requests = []
        self.errors = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                self.send_response(304 if self.path.startswith('/models-dev') else 404)
                self.end_headers()

            def do_POST(self):
                length = int(self.headers.get('Content-Length', '0'))
                if self.path != '/responses' or not 0 < length <= 2_000_000:
                    self.send_error(400)
                    return
                body = json.loads(self.rfile.read(length))
                serialized = json.dumps(body.get('input'))
                if APPROVAL in serialized:
                    scenario = 'approval'
                    item = dict(id='fc-quit', type='function_call', status='completed',
                                call_id='quit-unapproved-command', name='exec_command',
                                arguments=json.dumps(dict(cmd='sleep 120', tty=True, yield_time_ms=20)))
                elif GOAL in serialized:
                    scenario = 'goal'
                    item = None
                elif TRANSCRIPT in serialized:
                    scenario = 'transcript'
                    item = dict(id='msg-quit', type='message', status='completed', role='assistant',
                                content=[dict(type='output_text', text=TRANSCRIPT, annotations=[])])
                else:
                    owner.errors.append('Unexpected model request')
                    self.send_error(400)
                    return
                owner.requests.append(scenario)
                self.send_response(200)
                streaming = body.get('stream') is True
                self.send_header('Content-Type', 'text/event-stream' if streaming else 'application/json')
                self.end_headers()
                self.wfile.flush()
                if scenario == 'goal':
                    # Headers acknowledge a real accepted request; shutdown
                    # must cancel its owner without a model response or retry.
                    owner.goal_accepted.set()
                    owner.release.wait(90)
                    return
                response = dict(id='resp-quit', object='response', status='completed',
                                model='gpt-5.6-sol', output=[item],
                                usage=dict(input_tokens=7, output_tokens=3, total_tokens=10))
                if streaming:
                    frames = [dict(type='response.output_item.done', output_index=0, item=item),
                              dict(type='response.completed', response=response)]
                    self.wfile.write(''.join('data: ' + json.dumps(frame) + '\n\n' for frame in frames).encode())
                else:
                    self.wfile.write(json.dumps(response).encode())

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.endpoint = f'http://127.0.0.1:{self.server.server_port}'

    def close(self):
        self.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        assert not self.thread.is_alive()


class QuitWorkspaceFixture:
    """Seed real owner state through supported APIs; never answer an approval."""
    def __init__(self, workspace):
        self.workspace = Path(workspace).resolve()
        self.provider = QuitProvider(self.workspace)
        self.session = None
        self.approval_session = None
        self.descendant = None
        self.streams = []

    def observe(self, session):
        address = urlparse(self.endpoint)
        stream = socket.create_connection((address.hostname, address.port), timeout=3)
        self.streams.append(stream)
        stream.sendall((f'GET /sessions/{session}/events/stream HTTP/1.1\r\n'
                        'Host: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n').encode())
        response = b''
        while b'\r\n\r\n' not in response:
            data = stream.recv(4096)
            assert data, 'Session observer closed before headers'
            response += data
            assert len(response) <= 65536
        assert response.startswith(b'HTTP/1.1 200'), response[:100]

    def retire_streams(self):
        for stream in self.streams:
            stream.close()
        self.streams.clear()

    def prepare(self, endpoint):
        self.endpoint = endpoint
        project = request(endpoint, '/projects', dict(name='Disposable Quit fixture', cwd=str(self.workspace)))

        def create_session():
            session = request(endpoint, '/sessions', dict(behavior='direct', project_id=project['project_id'],
                model='gpt-5.6-sol', backend='openai-responses', base_url=self.provider.endpoint,
                api_key_env='OPENAI_API_KEY'))
            return session['metadata']['session_id']

        self.session = create_session()
        base = '/sessions/' + self.session
        request(endpoint, base + '/runs', dict(prompt=TRANSCRIPT))
        until('Completed durable transcript', lambda: request(endpoint, base).get('active_run') is None)
        messages = request(endpoint, base + '/messages?include_system=true&limit=200')
        assert TRANSCRIPT in json.dumps(messages)

        goal = request(endpoint, base + '/goal', dict(objective=GOAL))
        assert self.provider.goal_accepted.wait(15), 'Goal did not reach the slow provider'
        goal = request(endpoint, base + '/goal')
        self.goal = request(endpoint, base + '/goal/' + goal['goal_id'],
                            dict(expected_version=goal['version'], status='paused'), method='PATCH')
        assert request(endpoint, base).get('active_run') is not None, 'Paused goal cancelled the active model run'
        assert self.goal['objective'] == GOAL and self.goal['status'] == 'paused'

        terminal = request(endpoint, base + '/user-terminals',
                           dict(protocol_version=1, launch_id=str(uuid.uuid4()), cols=80, rows=24))
        self.terminal_id = terminal['terminal_id']
        execution = base + '/executions/' + self.terminal_id
        control = request(endpoint, execution + '/input-control')
        command = "set +H\r/bin/sleep 120 & child=$!; printf '%s' $child > quit-descendant-pid\r"
        receipt = request(endpoint, execution + '/input', dict(protocol_version=1,
                          expected_revision=control['revision'], bytes=list(command.encode())))
        assert receipt['outcome'] == 'written'
        pid_file = self.workspace / 'quit-descendant-pid'
        until('Real terminal descendant', lambda: pid_file.exists() and pid_file.read_text().strip())
        self.descendant = int(pid_file.read_text())
        assert alive(self.descendant)

        self.approval_session = create_session()
        approval_base = '/sessions/' + self.approval_session
        # Manual approvals intentionally fail closed without a connected
        # interactive observer. Keep the real SSE client until UI retirement.
        self.observe(self.approval_session)
        request(endpoint, approval_base + '/runs', dict(prompt=APPROVAL))
        pending = until('Real pending approval', lambda: request(endpoint, approval_base + '/permissions')['requests'])
        assert len(pending) == 1
        self.assert_unapproved()
        return dict(session_id=self.session, approval_session_id=self.approval_session,
                    descendant_pid=self.descendant, goal_id=self.goal['goal_id'],
                    goal_status=self.goal['status'], terminal_id=self.terminal_id,
                    provider_requests=list(self.provider.requests))

    def assert_unapproved(self):
        permissions = request(self.endpoint, '/sessions/' + self.approval_session + '/permissions')
        assert permissions['approval_mode'] == 'manual' and not permissions['grants']
        executions = request(self.endpoint, '/sessions/' + self.approval_session + '/executions')
        assert executions['executions'] == [], executions
        assert not self.provider.errors, self.provider.errors
        assert sorted(self.provider.requests) == ['approval', 'goal', 'transcript'], self.provider.requests

    def verify_store(self, store):
        """Read-only evidence after the engine has actually released its store."""
        assert not self.provider.errors, self.provider.errors
        assert sorted(self.provider.requests) == ['approval', 'goal', 'transcript'], self.provider.requests
        with closing(sqlite3.connect(Path(store).as_uri() + '?mode=ro', uri=True)) as connection:
            assert connection.execute('PRAGMA quick_check').fetchone() == ('ok',)
            goal = connection.execute('SELECT goal_id,objective,status FROM session_goals WHERE session_id=?',
                                      [self.session]).fetchone()
            assert goal == (self.goal['goal_id'], GOAL, 'paused'), goal
            assert connection.execute('SELECT count(*) FROM permission_grants').fetchone() == (0,)
            modes = connection.execute('SELECT permission_approval_mode FROM sessions').fetchall()
            assert modes and all(mode == ('manual',) for mode in modes), modes
        wait_dead(self.descendant, timeout=3)
        return dict(durable_goal_preserved=True, no_remembered_grants=True,
                    approval_mode_preserved=True,
                    terminal_descendant_stopped=True, no_model_or_mutation_replay=True, integrity='ok')

    def close(self):
        self.retire_streams()
        self.provider.close()


def run_contract(binary, destination):
    binary, destination = Path(binary).resolve(), Path(destination).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix='nac-quit-contract-', dir=destination.parent)).resolve()
    fixture = QuitWorkspaceFixture(root)
    children = []
    evidence = dict(binary=str(binary), binary_sha256=digest(binary), fixture=str(root),
                    actual_app_acceptance=False)
    environment = dict(HOME=str(root), NAC_HOME=str(root / 'nac-home'),
                       PATH='/usr/bin:/bin:/usr/sbin:/sbin', BROWSER='none', NAC_TELEMETRY='disabled',
                       MODELS_DEV_URL=fixture.provider.endpoint + '/models-dev',
                       OPENAI_API_KEY='quit-fixture-dummy-only', GIT_CONFIG_NOSYSTEM='1',
                       GIT_CONFIG_GLOBAL='/dev/null')
    store = root / 'selected store.db'
    try:
        subprocess.run(['/usr/bin/git', 'init', '--quiet', '--initial-branch=main', str(root)],
                       env=environment, check=True, timeout=5)
        owner = OwnedEngine(binary, root, store, environment, desktop=True)
        children.append(owner)
        owner.ready()
        evidence['engine_identity'] = owner.identity
        evidence.update(fixture.prepare(owner.endpoint))
        fixture.assert_unapproved()
        fixture.retire_streams()
        started = time.monotonic()
        owner.stop()
        evidence['shutdown_seconds'] = round(time.monotonic() - started, 3)
        evidence.update(fixture.verify_store(store))
        replacement = OwnedEngine(binary, root, store, environment, desktop=True)
        children.append(replacement)
        replacement.ready()
        evidence['store_reacquired_by_new_launch'] = replacement.incarnation != owner.incarnation
        messages = request(replacement.endpoint, '/sessions/' + fixture.session + '/messages?include_system=true&limit=200')
        assert TRANSCRIPT in json.dumps(messages), 'Completed transcript lost on restart'
        evidence['durable_transcript_preserved'] = True
        evidence.update(fixture.verify_store(store))
        replacement.stop()
        evidence['passed'] = True
    except BaseException as error:
        evidence.update(passed=False, failure=str(error), fixture_retained=True)
        raise
    finally:
        fixture.retire_streams()
        for child in reversed(children):
            child.close()
        fixture.close()
        destination.write_text(json.dumps(evidence, indent=2) + '\n')
        if evidence.get('passed'):
            shutil.rmtree(root)
    return evidence


if __name__ == '__main__':
    import sys
    print(json.dumps(run_contract(*sys.argv[1:]), indent=2))
