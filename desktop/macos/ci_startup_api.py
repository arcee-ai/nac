"""Fixed owned provider and P normal-settings API fixture adapters."""
from contextlib import contextmanager
from collections import deque
import hashlib
import json
import os
from pathlib import Path
import queue
import signal
import subprocess
import threading
import time
import re
import urllib.parse
import urllib.request

from ci_startup_fixture import PRODUCT, digest
from ci_paths_budget import active, using, check as budget_check, time_limit
from ci_startup_process import capture
from ci_startup_owner import native_identity, signature

ROOT = Path(__file__).resolve().parents[2]
DIAGNOSTIC_INT_LIMIT = 8 * 1024 * 1024


DIAGNOSTIC_GUARDS = frozenset('''
api_witness_unavailable ambiguous_serving_engine app_owned_serving_parent serving_engine_replaced
listener_process_generation owned_listener_observation listener_pid unique_local_listener
listener_process_changed ready_build_identity api_response_bound owned_loopback_endpoint
entry_asset_root entry_asset_prefix entry_asset_path entry_asset_source entry_asset_inventory
asset_observation_interrupted served_entry_asset_bytes onboarding_empty_store api_listener_changed
entry_document_bound entry_document_position entry_document_json entry_document_duplicate_key
entry_document_shape entry_document_identity entry_document_scope entry_document_uuid
entry_document_release live_app_api_evidence_missing owned_store_cardinality
local_project_workspace local_session_model_and_project selected_store_session_metadata
saved_dummy_model_configuration transcript_schema canonical_transcript unexpected_tool_or_message unexpected_tool_request
persisted_transcript_matches_snapshot unexpected_terminal event_schema canonical_completed_run
'''.split())


def diagnostic_facts(facts):
    result = {}
    for key, value in (facts or {}).items():
        if key in ('expected_bytes', 'actual_bytes', 'asset_ordinal', 'http_status'):
            # entry_assets reads one byte past its cap to detect overflow.
            limit = DIAGNOSTIC_INT_LIMIT + 1 if key == 'actual_bytes' else DIAGNOSTIC_INT_LIMIT
            if type(value) is int and 0 <= value <= limit:
                result[key] = value
        elif key in ('expected_sha256', 'actual_sha256'):
            if type(value) is str and re.fullmatch('[0-9a-f]{64}', value):
                result[key] = value
    return result


class FixtureFailure(RuntimeError):
    def __init__(self, reason, facts=None):
        super().__init__('Startup external fixture failed: ' + reason)
        self.code = reason if reason in DIAGNOSTIC_GUARDS else 'unclassified_fixture_guard'
        self.facts = diagnostic_facts(facts)


def failure_metadata(error):
    # Never format an arbitrary exception: messages may contain HTTP bodies,
    # credentials, paths or even a user-defined __str__ implementation.
    known = (RuntimeError, ValueError, TypeError, AttributeError, KeyError, json.JSONDecodeError)
    coded = type(error) is FixtureFailure
    return {'exception_type': 'FixtureFailure' if coded else type(error).__name__ if type(error) in known else 'unknown',
            'guard_code': error.code if coded and error.code in DIAGNOSTIC_GUARDS else 'unknown',
            'operands': diagnostic_facts(error.facts) if coded else {}}


def require(condition, reason, *, facts=None):
    if not condition:
        raise FixtureFailure(reason, facts)


def endpoint(value):
    require(isinstance(value, str), 'endpoint_type')
    try:
        url = urllib.parse.urlsplit(value)
        port = url.port
    except ValueError:
        raise RuntimeError('Startup external fixture failed: owned_loopback_endpoint') from None
    require(url.scheme == 'http' and url.hostname == '127.0.0.1' and port is not None
            and 0 < port <= 65535 and url.path in ('', '/') and not url.username
            and not url.password and not url.query and not url.fragment, 'owned_loopback_endpoint')
    return value.rstrip('/')


def request(base, path, body=None):
    base = endpoint(base)
    require(path.startswith('/') and not path.startswith('//'), 'fixed_api_path')
    data = None if body is None else json.dumps(body).encode()
    call = urllib.request.Request(base + path, data=data, headers={'Content-Type': 'application/json'})
    # An ambient HTTP proxy never receives even this fixture's requests.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(call, timeout=5) as response:
        encoded = response.read(256 * 1024 + 1)
    require(len(encoded) <= 256 * 1024, 'api_response_bound')
    return json.loads(encoded)


class Provider:
    def __init__(self, log=None):
        self.process = None
        self.lines = queue.Queue(maxsize=4)
        self.journal = None
        self.log = log
        self.diagnostics = deque(maxlen=16)
        self.reader = self.error_reader = None
        self.settled = False

    def start(self):
        require(self.process is None, 'provider_stale_process')
        try:
            budget_check()
            self.process = subprocess.Popen(['node', str(ROOT / 'desktop/macos/ci_startup_provider.mjs')],
                cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                env={'PATH': os.environ['PATH'], 'LANG': 'en_US.UTF-8'}, start_new_session=True)
            def read():
                try:
                    for line in iter(lambda: self.process.stdout.readline(65537), ''):
                        require(len(line.encode()) <= 65536 and line.endswith('\n'), 'provider_record_bound')
                        self.lines.put_nowait(json.loads(line))
                except BaseException:
                    pass
                finally:
                    try:
                        self.lines.put_nowait({'event': 'unavailable'})
                    except queue.Full:
                        pass
            self.reader = threading.Thread(target=read, daemon=True)
            self.reader.start()
            def errors():
                while text := self.process.stderr.read(4096):
                    self.diagnostics.append(text)
            self.error_reader = threading.Thread(target=errors, daemon=True)
            self.error_reader.start()
            ready = self.lines.get(timeout=time_limit(5))
            budget_check()
            require(ready.get('event') == 'ready' and ready.get('shared_source_sha256') ==
                    digest(ROOT / 'crates/nac-server/web/e2e/scripted-provider.ts'), 'provider_source_readiness')
            self.base = endpoint(ready.get('base_url'))
            return self.base
        except BaseException:
            bound = active()
            with using(bound.owner.cleanup if bound else None):
                self.stop(require_complete=False)
            raise RuntimeError('Owned startup provider did not become ready') from None

    def stop(self, require_complete=True):
        if self.process is None:
            return None
        if self.journal is not None:
            require(self.settled, 'provider_settlement_unknown')
            require(not require_complete or self.journal.get('valid') is True, 'provider_script_completion')
            return self.journal
        try:
            if self.process.poll() is None:
                self.process.stdin.write('finish\n')
                self.process.stdin.flush()
            self.process.wait(timeout=time_limit(5))
            while True:
                record = self.lines.get(timeout=time_limit(2))
                if record.get('event') == 'finished':
                    self.journal = record
                    break
                require(record.get('event') != 'unavailable', 'provider_eof')
            if require_complete:
                require(self.process.returncode == 0 and self.journal.get('valid') is True, 'provider_script_completion')
            return self.journal
        finally:
            if self.process.poll() is None:
                os.killpg(self.process.pid, signal.SIGTERM)
                try:
                    self.process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(self.process.pid, signal.SIGKILL)
                    self.process.wait(timeout=3)
            self.process.stdin.close()
            self.process.stdout.close()
            if self.reader is not None:
                self.reader.join(timeout=3)
            if self.error_reader is not None:
                self.error_reader.join(timeout=3)
            self.settled = self.process.poll() is not None and not any(
                reader is not None and reader.is_alive() for reader in (self.reader, self.error_reader))
            if not self.settled and active() is not None:
                active().owner.fail('startup provider finalization unknown')
            require(self.settled, 'provider_settlement_unknown')
            self.process.stderr.close()
            if self.log is not None:
                self.log.write_text(''.join(self.diagnostics))


def configuration_selection(profile, engine, *, run=None, directory=None):
    if run is not None:
        stdout, stderr = capture([str(engine), '__desktop-configuration', '--directory', str(profile['home'])],
            directory, 'configuration-preflight', 13, run, cwd=profile['home'], env=profile['environment'], limit=16 * 1024)
        result = subprocess.CompletedProcess([], 0, stdout, stderr)
    else:
        result = subprocess.run([str(engine), '__desktop-configuration', '--directory', str(profile['home'])],
            cwd=profile['home'], env=profile['environment'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=time_limit(13))
        budget_check()
    require(result.returncode == 0 and len(result.stdout) <= 16 * 1024, 'configuration_preflight')
    row = json.loads(result.stdout)
    require(isinstance(row, dict) and type(row.get('version')) is int, 'configuration_schema')
    if profile['scenario'] == 'invalidConfig':
        require(row.get('version') == 1 and row.get('status') == 'failed'
                and row.get('code') == 'invalid_configuration', 'invalid_configuration_code')
    else:
        require(row == {'version': 1, 'status': 'selected', 'root_cwd': str(profile['home']),
                        'store': str(profile['store']), 'track': 'dev'}, 'selected_configuration')
    return {'observation': row, 'bytes': len(result.stdout), 'sha256': hashlib.sha256(result.stdout).hexdigest(),
            'scope': 'Owned standalone configuration helper; not actual app preflight observation'}


def require_readiness(row, identity):
    require(isinstance(row, dict) and row.get('status') == 'ok' and row.get('managed') is False
            and all(row.get(key) == identity[source] for key, source in
                    (('product_version', 'product_version'), ('build_id', 'build_id'),
                     ('build_track', 'track'), ('source_revision', 'source_revision'))), 'ready_build_identity')
    return row


class ListenerPending(RuntimeError):
    pass


def owned_listener(pid, expected):
    actual = native_identity(pid)
    require(actual is not None and signature(actual) == signature(expected), 'listener_process_generation')
    result = subprocess.run(['/usr/sbin/lsof', '-nP', '-a', '-p', str(pid), '-iTCP', '-sTCP:LISTEN', '-Fpn'],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3)
    if result.returncode == 1 and result.stdout == b'':
        raise ListenerPending('Owned startup listener is not available yet')
    require(result.returncode == 0 and len(result.stdout) <= 16384, 'owned_listener_observation')
    lines = result.stdout.decode('ascii').splitlines()
    require([line for line in lines if line.startswith('p')] == ['p' + str(pid)], 'listener_pid')
    addresses = [line[1:] for line in lines if line.startswith('n')]
    require(len(addresses) == 1 and re.fullmatch(r'127\.0\.0\.1:[0-9]{1,5}', addresses[0]), 'unique_local_listener')
    base = endpoint('http://' + addresses[0])
    after = native_identity(pid)
    require(after is not None and signature(after) == signature(expected), 'listener_process_changed')
    return base


@contextmanager
def setup_engine(profile, config, log):
    """Direct owned server for normal settings only; no private protocol replica.

    The separately nominated R adapter owns authentic private-failure audits.
    No projects/runs/tools are created in this preparation server.
    """
    engine = Path(config['app_path']) / 'Contents/Resources/nac-web'
    require(digest(engine) == config['engine_sha256'] and config['engine_identity']['source_revision'] == PRODUCT,
            'packaged_engine_identity')
    process, reader = None, None
    chunks = deque(maxlen=64)
    try:
        process = subprocess.Popen([str(engine), '--bind', '127.0.0.1:0', '--directory', str(profile['home']),
            '--store-path', str(profile['store']), '--worker-executable', str(engine), '--no-open'],
            cwd=profile['home'], env=profile['environment'], stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        def drain():
            while data := process.stdout.read(4096):
                chunks.append(data)
        reader = threading.Thread(target=drain, daemon=True)
        reader.start()
        identity = native_identity(process.pid)
        require(identity is not None and identity['parent'] == os.getpid()
                and identity['executable'] == str(engine), 'owned_setup_child')
        deadline = time.monotonic() + 25
        observation = None
        while process.poll() is None and time.monotonic() < deadline:
            try:
                base = owned_listener(process.pid, identity)
                ready = require_readiness(request(base, '/readyz'), config['engine_identity'])
                require(owned_listener(process.pid, identity) == base, 'setup_listener_changed')
                observation = {'base_url': base, 'readiness': ready, 'process': identity,
                    'scope': 'Directly owned standalone settings server, not app readiness or private wire evidence'}
                break
            except (OSError, ListenerPending):
                time.sleep(.05)
        require(observation is not None, 'setup_server_readiness')
        yield observation
    finally:
        if process is not None and process.poll() is None:
            process.terminate()  # Our direct unreaped child; never a JSON-provided app PID.
            try:
                process.wait(timeout=25)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
        if reader is not None:
            reader.join(timeout=3)
            process.stdout.close()
        log.write_bytes(b''.join(chunks))


def seed_model(base, provider_base):
    require(request(base, '/projects').get('projects') == [] and request(base, '/sessions') == [], 'empty_seed_store')
    saved = request(base, '/model-configs', {'name': 'Finder configured fixture', 'backend': 'openai-responses',
        'model': 'gpt-5.6-sol', 'base_url': endpoint(provider_base), 'api_key': 'preview-dummy-only',
        'extra_headers': {}, 'orchestrator_compaction_threshold': 0})
    require(isinstance(saved.get('config_id'), str) and saved['config_id'], 'configured_dummy_model')
    require(request(base, '/projects').get('projects') == [] and request(base, '/sessions') == [], 'no_seeded_project_or_run')
    return {'config_id': saved['config_id'], 'configured_dummy_only': True, 'project_seeded': False}
