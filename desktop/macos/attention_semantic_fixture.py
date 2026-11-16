"""Bounded scripted Responses protocol for the semantic native matrix.

Inert on import. Only SemanticProvider construction opens a loopback listener;
pure protocol controls never construct it. No canonical outcome is synthesized.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from collections import Counter
import hashlib
import json
import re
from pathlib import Path
import threading
import time

MARKER = 'NAC_SEMANTIC_FINITE_MARKER'
BEHAVIORS = ('orchestrator', 'direct', 'direct-with-orchestrator')


def _string_values(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from _string_values(child)
    elif isinstance(value, list):
        for child in value:
            yield from _string_values(child)


class Protocol:
    def __init__(self, marker):
        self.marker = str(marker)
        self.scripts = {}
        self.requests = []
        self.marks = {}
        self.lock = threading.Lock()
        self.events = {}

    def register(self, token, mode='request', parent=None):
        with self.lock:
            assert mode in ('request', 'goal', 'queue') and token not in self.scripts and len(self.scripts) < 16
            assert mode != 'queue' or (parent in self.scripts and self.scripts[parent]['mode'] == 'goal')
            self.scripts[token] = dict(mode=mode, calls=0, goal=None, run=None, parent=parent)
            for step in range(3):
                self.events[token, step] = threading.Event()

    def bind_goal(self, token, goal, run):
        assert goal and run and self.scripts[token]['mode'] == 'goal'
        with self.lock:
            state = self.scripts[token]
            assert state['goal'] is None
            state.update(goal=goal, run=run)

    @staticmethod
    def output(body, call):
        rows = [row for row in body.get('input', [])
                if isinstance(row, dict) and row.get('type') == 'function_call_output'
                and row.get('call_id') == call]
        assert len(rows) == 1 and isinstance(rows[0].get('output'), str), 'Missing/duplicate exact tool result'
        return rows[0]['output']

    def marker_output(self, body, call):
        text = self.output(body, call)
        assert MARKER in text and not text.lstrip().startswith('Error:'), 'Marker read did not succeed'
        try:
            decoded = json.loads(text)
        except json.JSONDecodeError:
            decoded = None
        if isinstance(decoded, dict):
            assert not decoded.get('error') and not decoded.get('is_error'), 'Read returned an error'
        return text

    def _matches(self, body):
        return [token for token in self.scripts if any(re.search(
            r'(?<![A-Za-z0-9_-])' + re.escape(token) + r'(?![A-Za-z0-9_-])', text)
            for text in _string_values(body))]

    def discrimination(self, body, wire=None):
        """Read-only bounded metadata, never prompt/header/tool-result text."""
        with self.lock:
            matches = self._matches(body)
            steps = {token[:96]: self.scripts[token]['calls'] for token in matches}
        rows = body.get('input', []) if isinstance(body, dict) else []
        rows = rows if isinstance(rows, list) else []
        roles = {'user', 'assistant', 'system', 'developer', 'tool'}
        types = {'message', 'input_text', 'output_text', 'function_call', 'function_call_output', 'input_image'}
        def counts(field, known):
            return dict(Counter(row.get(field) if isinstance(row.get(field), str) and row.get(field) in known else 'other'
                                for row in rows if isinstance(row, dict)))
        tools = body.get('tools', []) if isinstance(body, dict) else []
        names = set()
        for row in tools if isinstance(tools, list) else []:
            if isinstance(row, dict):
                nested = row.get('function')
                name = row.get('name', nested.get('name') if isinstance(nested, dict) else None)
                if isinstance(name, str):
                    names.add(name)
        raw = wire if wire is not None else json.dumps(body, sort_keys=True, separators=(',', ':')).encode()
        return dict(matched_tokens=[token[:96] for token in matches], matched_token_count=len(matches),
                    expected_steps=steps, input_count=len(rows), input_roles=counts('role', roles),
                    input_types=counts('type', types),
                    tool_names=sorted({name if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.-]{0,63}', name)
                                       else '<invalid-name>' for name in names})[:32],
                    tool_name_count=len(names), tool_names_truncated=len(names) > 32 or any(len(n) > 64 for n in names),
                    body_bytes=len(raw), body_sha256=hashlib.sha256(raw).hexdigest(),
                    body_encoding='wire' if wire is not None else 'canonical-json')

    def accept(self, body):
        with self.lock:
            matches = self._matches(body)
            # A queued B request includes A's retained transcript. B wins only
            # when exactly one registered queue token is actually present.
            queued = [token for token in matches if self.scripts[token]['mode'] == 'queue']
            assert len(queued) <= 1
            if queued:
                token = queued[0]
                parent = self.scripts[token]['parent']
                assert set(matches) <= {token, parent} and parent in self.marks, 'Wrong queued-goal context'
            else:
                assert len(matches) == 1, 'Unknown/ambiguous model request'
                token = matches[0]
            assert len(self.requests) < 14, 'Matrix model call bound exceeded'
            state = self.scripts[token]
            step = state['calls']
            assert step < (3 if state['mode'] == 'goal' else 1), 'Unexpected model retry/call'
            names = {row.get('name', row.get('function', {}).get('name')) for row in body.get('tools', [])}
            gates = []
            if state['mode'] == 'goal' and step == 0:
                assert {'read', 'update_goal'} <= names, 'Real goal tools not advertised'
                item = self.function('read', 'read-' + token, dict(path=self.marker))
                gates = [token + ':allow-read']
            elif state['mode'] == 'goal' and step == 1:
                self.marker_output(body, 'read-' + token)
                assert state['goal'] and state['run'] and 'update_goal' in names
                item = self.function('update_goal', 'mark-' + token, dict(goal_id=state['goal'], status='complete'))
            elif state['mode'] == 'goal':
                # Actual tool reply is the mark receipt BEFORE terminal A.
                self.marker_output(body, 'read-' + token)
                mark = json.loads(self.output(body, 'mark-' + token))
                assert mark['goal_id'] == state['goal'] and mark['status'] == 'complete'
                assert mark['accounting_run_id'] == state['run']
                assert type(mark['version']) is int and mark['version'] >= 0
                self.marks[token] = mark
                item = self.message(token)
                gates = [token + ':final-tail']
            else:
                item = self.message(token)
                if state['mode'] == 'queue':
                    gates = [token + ':finish-B']
            state['calls'] += 1
            record = dict(epoch=time.time(), token=token, step=step, body=body, reply_item=item, gates=gates)
            self.requests.append(record)
            self.events[token, step].set()
            return token, item, gates, record

    @staticmethod
    def function(name, call, arguments):
        return dict(id='fc-' + call, type='function_call', status='completed',
                    call_id=call, name=name, arguments=json.dumps(arguments))

    @staticmethod
    def message(token):
        return dict(id='msg-' + token, type='message', status='completed', role='assistant',
                    content=[dict(type='output_text', text='Completed ' + token, annotations=[])])


class SemanticProvider:
    def __init__(self, workspace, evidence):
        self.workspace = Path(workspace)
        self.evidence = Path(evidence)
        self.protocol = Protocol(self.workspace / 'semantic-marker.txt')
        self.errors = []
        self.requests = self.protocol.requests
        self.stop = threading.Event()
        self.gates = {}
        self.handlers = set()
        self.lock = threading.Lock()
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def setup(self):
                super().setup()
                self.connection.settimeout(3)
                with owner.lock:
                    owner.handlers.add(threading.current_thread())

            def log_message(self, *args):
                pass

            def do_GET(self):
                if self.path != '/models-dev':
                    self.send_error(404)
                    return
                # Preserve the checked-in catalog; no synthetic model overlay.
                self.send_response(304)
                self.end_headers()

            def do_POST(self):
                discrimination = None
                try:
                    self.connection.settimeout(3)
                    assert self.path.rstrip('/') in ('/responses', '/v1/responses')
                    assert self.headers.get('Authorization') == 'Bearer attention-semantic-dummy-only'
                    length = int(self.headers.get('Content-Length', '0'))
                    assert 0 < length <= 1024 * 1024
                    wire = self.rfile.read(length)
                    body = json.loads(wire)
                    discrimination = owner.protocol.discrimination(body, wire)
                    token, item, gates, record = owner.protocol.accept(body)
                    owner.save('model-request', record)
                    for gate in gates:
                        owner.await_gate(gate)
                    response = dict(id='resp-' + token, object='response', status='completed',
                                    model='gpt-5.6-sol', output=[item],
                                    usage=dict(input_tokens=7, output_tokens=3, total_tokens=10))
                    if body.get('stream') is True:
                        frames = [dict(type='response.output_item.done', output_index=0, item=item),
                                  dict(type='response.completed', response=response)]
                        data = ''.join('data: ' + json.dumps(frame) + '\n\n' for frame in frames).encode()
                        content_type = 'text/event-stream'
                    else:
                        data = json.dumps(response).encode()
                        content_type = 'application/json'
                    self.send_response(200)
                    self.send_header('Content-Type', content_type)
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    owner.save('model-response', dict(token=token, response=response))
                except Exception as error:
                    owner.errors.append(repr(error))
                    owner.save('model-error', dict(error=repr(error), error_class=type(error).__name__,
                                                   discrimination=discrimination))
                    self.send_error(500)

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.endpoint = 'http://127.0.0.1:' + str(self.server.server_address[1])
        self.thread = threading.Thread(target=self.server.serve_forever, name='semantic-provider', daemon=True)
        try:
            self.thread.start()
        except BaseException:
            if self.thread.is_alive():
                self.server.shutdown()
                self.thread.join(timeout=3)
            self.server.server_close()
            raise

    def save(self, operation, value):
        with self.lock:
            with self.evidence.open('a') as output:
                output.write(json.dumps(dict(value, observed_epoch=time.time(), operation=operation)) + '\n')

    def await_gate(self, name):
        with self.lock:
            assert not self.stop.is_set(), 'Provider retired'
            event = self.gates.setdefault(name, threading.Event())
        assert event.wait(30) and not self.stop.is_set(), 'Provider gate expired/retired: ' + name

    def release(self, name):
        with self.lock:
            self.gates.setdefault(name, threading.Event()).set()

    def entered(self, token, step=0, timeout=15):
        assert self.protocol.events[token, step].wait(timeout), 'Provider stage not reached: ' + token

    def close(self):
        self.stop.set()
        with self.lock:
            for event in self.gates.values():
                event.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        with self.lock:
            handlers = list(self.handlers)
        for thread in handlers:
            thread.join(timeout=4)
        assert not self.thread.is_alive() and not any(t.is_alive() for t in handlers), 'Provider did not settle'
        self.save('closed', dict(request_count=len(self.requests), errors=self.errors,
                                 thread_alive=self.thread.is_alive(), handlers_alive=0))
