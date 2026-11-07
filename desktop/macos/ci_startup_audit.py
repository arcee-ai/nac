"""Read-only ordinary-app API observations, separate from public UI evidence."""
import hashlib
from html.parser import HTMLParser
import re
import threading
import urllib.request

from ci_startup_api import ListenerPending, endpoint, owned_listener, request, require, require_readiness
from ci_startup_owner import signature

PROMPT = 'FINDER_CONFIGURED_LOCAL_startup-home'
RESPONSE = 'Finder configured local response.'


def transcript(messages):
    require(isinstance(messages, list), 'transcript_schema')
    visible = []
    for row in messages:
        require(isinstance(row, dict) and row.get('role') in ('system', 'user', 'assistant'), 'unexpected_tool_or_message')
        if row['role'] != 'system':
            require(not row.get('tool_calls'), 'unexpected_tool_request')
            visible.append({'role': row['role'], 'content': row.get('content')})
    require(visible == [{'role': 'user', 'content': PROMPT}, {'role': 'assistant', 'content': RESPONSE}],
            'canonical_transcript')
    return visible


def session_facts(base, config, model_config, *, live):
    projects = request(base, '/projects').get('projects')
    sessions = request(base, '/sessions')
    require(isinstance(projects, list) and isinstance(sessions, list)
            and len(projects) <= 1 and len(sessions) <= 1, 'owned_store_cardinality')
    if not projects or not sessions:
        return None
    project, session = projects[0], sessions[0]
    require(project.get('cwd') == config['workspace'] and project.get('ssh_host') is None,
            'local_project_workspace')
    summary = session.get('summary', {})
    sid = summary.get('session_id')
    require(isinstance(sid, str) and re.fullmatch('[A-Za-z0-9-]{1,80}', sid)
            and summary.get('cwd') == config['workspace'] and summary.get('project_id') == project.get('project_id')
            and summary.get('ssh_host') is None and summary.get('sandboxed') is False
            and summary.get('backend') == 'openai-responses' and summary.get('model') == 'gpt-5.6-sol',
            'local_session_model_and_project')
    # Do not hydrate a recovering/pending session merely to manufacture a
    # settled observation after app shutdown. A live receipt is mandatory first.
    if 'active_run' not in session or session['active_run'] is not None:
        return None
    path = '/sessions/' + sid
    snapshot = request(base, path)
    metadata = snapshot.get('metadata', {})
    require(all(metadata.get(key) == value for key, value in {
        'session_id': sid, 'project_id': project['project_id'], 'cwd': config['workspace'],
        'store_path': config['expected_store'], 'backend': 'openai-responses', 'model': 'gpt-5.6-sol',
        'base_url': config['provider_base'], 'sandbox_status': 'off'}.items()), 'selected_store_session_metadata')
    configurations = request(base, '/model-configs').get('configurations')
    require(isinstance(configurations, list) and len(configurations) == 1
            and all(configurations[0].get(key) == value for key, value in {
                'config_id': model_config['config_id'], 'backend': 'openai-responses', 'model': 'gpt-5.6-sol',
                'base_url': config['provider_base'], 'extra_headers': {}}.items()), 'saved_dummy_model_configuration')
    # The snapshot omits None active_run; the list above serializes it
    # explicitly. Both observations must agree, and recovery warnings fail.
    if (snapshot.get('active_run') is not None or snapshot.get('active_compaction') is not None
            or snapshot.get('run_failure') is not None or snapshot.get('transcript_recovery_warning') is not None):
        return None
    messages = snapshot.get('messages', [])
    if not any(row.get('role') == 'assistant' and row.get('content') == RESPONSE for row in messages):
        return None
    visible = transcript(messages)
    persisted = transcript(request(base, path + '/messages').get('messages'))
    require(visible == persisted, 'persisted_transcript_matches_snapshot')
    terminals = request(base, path + '/user-terminals')
    require(terminals.get('terminals') == [], 'unexpected_terminal')
    run_id = None
    if live:
        events = request(base, path + '/events').get('events')
        require(isinstance(events, list), 'event_schema')
        completed = [row for row in events if row.get('event', {}).get('type') == 'run_completed']
        if not completed:
            return None
        require(len(completed) == 1 and completed[0].get('session_id') == sid
                and completed[0].get('event', {}).get('response') == RESPONSE
                and isinstance(completed[0].get('run_id'), str), 'canonical_completed_run')
        run_id = completed[0]['run_id']
    return {'session_id': sid, 'project_id': project['project_id'], 'workspace': config['workspace'],
            'selected_store': config['expected_store'], 'model_config_id': model_config['config_id'],
            'model': 'gpt-5.6-sol', 'provider_backend': 'openai-responses',
            'execution': {'ssh_host': None, 'sandboxed': False, 'sandbox_status': 'off'},
            'active_run': None, 'run_failure': None, 'transcript': visible, 'completed_run_id': run_id,
            'scope': 'Live ordinary-app API' if live else 'Restarted owned server persisted read; no UI reload'}


class EntryAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        value = attrs.get('src') if tag == 'script' else attrs.get('href') if tag == 'link' else None
        if value:
            self.paths.add(value)


def entry_asset_source(dist, url):
    """The server mounts dist at /assets/dist/; no alternate URL resolution."""
    require(dist.is_absolute() and dist.resolve() == dist and dist.is_dir(), 'entry_asset_root')
    if url == '/':
        parts = ['index.html']
    else:
        require(isinstance(url, str) and url.startswith('/assets/dist/'), 'entry_asset_prefix')
        parts = url[len('/assets/dist/'):].split('/')
        require(parts and all(re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*', part)
                              and part not in ('.', '..') for part in parts), 'entry_asset_path')
    expected = dist.joinpath(*parts)
    require(expected.is_relative_to(dist) and expected.resolve() == expected
            and not expected.is_symlink() and expected.is_file(), 'entry_asset_source')
    return expected


def entry_assets(base, source, stop=None):
    """Check actual served index and its initial JS/CSS/modulepreload inputs."""
    source = source / 'crates/nac-server/assets/dist'
    parser = EntryAssets()
    parser.feed((source / 'index.html').read_text())
    require(parser.paths and len(parser.paths) <= 32, 'entry_asset_inventory')
    files = [(path, entry_asset_source(source, path)) for path in ['/', *sorted(parser.paths)]]
    observed = []
    for path, expected in files:
        require(stop is None or not stop.is_set(), 'asset_observation_interrupted')
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(endpoint(base) + path, timeout=5) as response:
            data = response.read(8 * 1024 * 1024 + 1)
        require(len(data) <= 8 * 1024 * 1024 and data == expected.read_bytes(), 'served_entry_asset_bytes')
        observed.append({'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    return {'observations': observed, 'scope': 'Served production index and initial entry references; not all lazy chunks'}


class LiveAudit:
    def __init__(self, witness, config, source, model_config=None):
        self.witness, self.config, self.source, self.model_config = witness, config, source, model_config
        self.stop_event = threading.Event()
        self.thread = None
        self.failure = self.proof = self.process = self.assets = None
        self.ready = None

    def sample(self):
        with self.witness.condition:
            require(self.witness.ready and not self.witness.failure, 'api_witness_unavailable')
            nodes = [node.copy() for node in self.witness.latest if node['kind'] == 'engine' and node['serving']]
            app = self.witness.app
        require(len(nodes) <= 1, 'ambiguous_serving_engine')
        if not nodes:
            return
        node = nodes[0]
        require(app and node['parent'] == app['pid'], 'app_owned_serving_parent')
        if self.process:
            require(signature(node) == signature(self.process), 'serving_engine_replaced')
        base = owned_listener(node['pid'], node)
        self.ready = require_readiness(request(base, '/readyz'), self.config['engine_identity'])
        self.process = node
        if self.assets is None:
            self.assets = entry_assets(base, self.source, self.stop_event)
        if self.config['scenario'] == 'onboarding':
            require(request(base, '/projects').get('projects') == [] and request(base, '/sessions') == [],
                    'onboarding_empty_store')
            found = {'onboarding_empty_store': True, 'scope': 'Actual app-owned ordinary engine API'}
        else:
            found = session_facts(base, self.config, self.model_config, live=True)
        require(owned_listener(node['pid'], node) == base, 'api_listener_changed')
        if found:
            self.proof = found

    def start(self):
        require(self.thread is None and self.config['scenario'] in ('onboarding', 'configuredLocal'), 'api_audit_selection')
        def read():
            while not self.stop_event.is_set() and self.proof is None:
                try:
                    self.sample()
                except (OSError, ListenerPending):
                    pass  # A newly witnessed engine may not have bound yet.
                except BaseException:
                    self.failure = 'ordinary_api_audit_rejected'
                    break
                self.stop_event.wait(.05)
        self.thread = threading.Thread(target=read, daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=55)
        require(self.thread is not None and not self.thread.is_alive() and not self.failure
                and self.proof is not None and self.process is not None and self.assets is not None,
                'live_app_api_evidence_missing')
        return {'process': self.process, 'readiness': self.ready, 'entry_assets': self.assets, 'facts': self.proof,
                'rendered_UI_reload_observed': False}


def persisted_audit(base, config, model_config, live):
    require(live.get('facts') is not None and live['facts'].get('completed_run_id'), 'live_settlement_required')
    facts = session_facts(base, config, model_config, live=False)
    require(facts is not None and all(facts[key] == live['facts'][key] for key in
            ('session_id', 'project_id', 'workspace', 'selected_store', 'model_config_id', 'model',
             'provider_backend', 'execution', 'active_run', 'run_failure', 'transcript')), 'persisted_facts_changed')
    return facts
