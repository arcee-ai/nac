"""Passive attention observation fixture; inert on import.

Not part of the app or a native test entrypoint. Its OS boundaries are mocked
by sibling source-contract tests; actual use still requires native admission.
"""
import hashlib, json, os, shutil, sqlite3, stat, subprocess, threading, time
from pathlib import Path

def install(root, head, tree):
    import attention_app_smoke as app
    from attention_feed_build import source_binding
    from instance_smoke import remaining
    R = root
    O = R / 'observations'
    O.mkdir(mode=448)
    lock = threading.Lock()
    seen = set()
    providers = []
    exited = set()
    actions = {}

    def emit(name, **value):
        with lock:
            with (O / (name + '.jsonl')).open('a') as f:
                f.write(json.dumps(dict(epoch=time.time(), **value)) + '\n')

    def binding(deadline=None):
        if deadline is None:
            assert source_binding(Path.cwd(), head) == dict(source_revision=head, source_tree=tree)
            return

        def git(*args):
            value = subprocess.check_output(['git', *args], text=True, timeout=remaining(deadline, 3)).strip()
            remaining(deadline, 3)
            return value
        assert git('rev-parse', head + '^{commit}') == head
        assert git('rev-parse', 'HEAD') == head and (not git('status', '--porcelain'))
        assert not git('diff', head, '--') and git('rev-parse', head + '^{tree}') == tree
    oldread = app.AttentionJourney.read

    def read(journey, *, deadline=None):
        remaining(deadline, 3)
        value = oldread(journey) if deadline is None else oldread(journey, deadline=deadline)
        remaining(deadline, 3)
        if value:
            fingerprint = hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()
            if fingerprint not in seen:
                seen.add(fingerprint)
                emit('native-records', output=str(journey.output), state=value)
                pid = value.get('engine_pid')
                for role, p in [('app', value.get('app_pid')), ('engine', pid)]:
                    if p:
                        state = subprocess.run(['/bin/ps', '-ww', '-p', str(p), '-o', 'pid=,ppid=,uid=,lstart=,stat=,command='], capture_output=True, text=True, timeout=remaining(deadline, 3))
                        remaining(deadline, 3)
                        emit('processes', role=role, pid=p, state=state.stdout, exit_code=state.returncode)
                base = journey.root / 'Library/Application Support/NAC/Presentation'
                if base.exists():
                    for p in base.rglob('checkpoint.json'):
                        remaining(deadline, 3)
                        assert not p.is_symlink() and p.resolve().is_relative_to(journey.root)
                        fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
                        with os.fdopen(fd, 'rb') as f:
                            data = f.read(8 * 1024 * 1024 + 1)
                        assert len(data) <= 8 * 1024 * 1024
                        digest = hashlib.sha256(data).hexdigest()
                        target = O / ('checkpoint-' + digest + '.json')
                        if not target.exists():
                            target.write_bytes(data)
                        emit('checkpoint-records', source=str(p), sha256=digest, native_state=fingerprint)
        remaining(deadline, 3)
        return value
    app.AttentionJourney.read = read
    oldstage = app.AttentionJourney.stage

    def stage(journey, label, timeout=None, *, deadline=None):
        value = oldstage(journey, label, timeout=timeout, deadline=deadline)
        remaining(deadline, 2)
        binding(deadline)
        observed = journey.observe() if deadline is None else journey.observe(deadline=deadline)
        remaining(deadline, 2)
        emit('milestones', label=label, state=value, observed=observed)
        action = actions.get(label)
        sample = value.get('chat_readiness', {})
        chat_frame = action == 'inspect-chat' and sample.get('ready') is True and (sample.get('sample') == label)
        capture_allowed = action not in ('click', 'inspect-chat') or chat_frame
        if capture_allowed and value.get('window_visible') and (not value.get('stopped')):
            capture_deadline = deadline
            if chat_frame:
                capture_deadline = journey.chat_deadline if deadline is None else min(deadline, journey.chat_deadline)
                assert not sample.get('error') and sample['route'] == app.canonical_chat_route(sample['session'])

            def current_custody():
                if capture_deadline is None:
                    journey.custody.check(journey)
                else:
                    journey.custody.check(journey, deadline=capture_deadline)
                remaining(capture_deadline, 5)
                if chat_frame:
                    current = journey.read(deadline=capture_deadline)
                    remaining(capture_deadline, 5)
                    assert current.get('document_binding') == sample['document'] and current['attention']['generation'] == sample['generation']
                    assert current.get('route') == sample['route'] and current.get('chat_readiness', {}).get('sample') == label
            current_custody()
            target = O / (journey.output.parent.name + '-' + label + '.png')
            capture = subprocess.run(['/usr/sbin/screencapture', '-x', '-o', '-l', str(value['window_number']), str(target)], capture_output=True, timeout=remaining(capture_deadline, 5))
            current_custody()
            emit('frames', label=label, path=str(target), window_number=value['window_number'], app_pid=value['app_pid'], exit_code=capture.returncode, stderr=capture.stderr.decode(errors='replace'))
            assert capture.returncode == 0 and target.exists(), 'Owned window milestone capture failed'
        remaining(deadline, 2)
        return value
    app.AttentionJourney.stage = stage
    oldlaunch = app.AttentionJourney.launch

    def launch(journey):
        binding()
        receipt = json.loads((journey.bundle / 'Contents/Resources/build-receipt.json').read_text())
        copied = {}
        for relative in ['Contents/MacOS/NACPreview', 'Contents/Resources/nac-web']:
            with (journey.bundle / relative).open('rb') as stream:
                copied[relative] = hashlib.file_digest(stream, 'sha256').hexdigest()
        assert copied['Contents/MacOS/NACPreview'] == receipt['native_sha256']
        assert copied['Contents/Resources/nac-web'] == receipt['engine_sha256']
        emit('launches', bundle=str(journey.bundle), command=journey.command, prior=journey.prior, console=app.console_facts(), copied_sha256=copied)
        return oldlaunch(journey)
    app.AttentionJourney.launch = launch
    oldpublish = app.AttentionControl.publish

    def publish(custody, journey, name, action, *, deadline=None, **payload):
        actions[name] = action
        binding(deadline)
        console = app.console_facts() if deadline is None else app.console_facts(deadline=deadline)
        remaining(deadline, 2)
        emit('controls', control_name=name, action=action, payload=payload, identity=custody.identity, console=console)
        if deadline is None:
            return oldpublish(custody, journey, name, action, **payload)
        return oldpublish(custody, journey, name, action, deadline=deadline, **payload)
    app.AttentionControl.publish = publish
    oldrequest = app.request

    def request(endpoint, path, body=None, method=None):
        answer = oldrequest(endpoint, path, body, method)
        emit('canonical-http', endpoint=endpoint, path=path, body=body, method=method or ('POST' if body is not None else 'GET'), response=answer)
        return answer
    app.request = request
    oldprovider = app.QuitProvider

    class ObservedProvider(oldprovider):

        def __init__(self, *args):
            super().__init__(*args)
            providers.append(self)
            emit('provider', operation='start', endpoint=self.endpoint, workspace=str(self.workspace), listener=self.server.server_address)

        def close(self):
            emit('provider', operation='before-close', requests=self.requests, errors=self.errors, denied_outputs=self.denied_outputs)
            super().close()
            emit('provider', operation='closed', requests=self.requests, errors=self.errors, thread_alive=self.thread.is_alive())
    app.QuitProvider = ObservedProvider
    oldsettled = app.engine_settled

    def settled(bundle, pid):
        result = oldsettled(bundle, pid)
        state = subprocess.run(['/bin/ps', '-ww', '-p', str(pid), '-o', 'pid=,ppid=,uid=,lstart=,stat=,command='], capture_output=True, text=True, timeout=3)
        emit('engine-exit-observations', bundle=str(bundle), pid=pid, settled=result, process_state=state.stdout, ps_exit=state.returncode)
        if result and pid not in exited:
            exited.add(pid)
            profile = Path(bundle).parent.parent / 'profile'
            store = profile / 'selected store.db'
            if store.exists():
                assert not store.is_symlink() and store.resolve().is_relative_to(R)
                database = O / ('canonical-after-engine-' + str(pid) + '.sqlite')
                with sqlite3.connect(store.as_uri() + '?mode=ro', uri=True) as source, sqlite3.connect(database) as dest:
                    source.backup(dest)
                    tables = source.execute("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
                    facts = {'quick_check': source.execute('PRAGMA quick_check').fetchall(), 'schema': tables}
                    for table, _ in tables:
                        if any((x in table for x in ('completion', 'goal', 'session', 'permission'))):
                            facts[table] = source.execute('SELECT * FROM "' + table.replace('"', '""') + '"').fetchall()

                    def default(value):
                        return {'bytes_hex': value.hex()} if isinstance(value, bytes) else str(value)
                    (O / ('canonical-after-engine-' + str(pid) + '.json')).write_text(json.dumps(facts, indent=2, default=default))
                emit('sqlite', path=str(database), source=str(store), engine_pid=pid, read_only=True)
        return result
    app.engine_settled = settled
    oldremove = app.shutil.rmtree

    def remove(path, *args, **kwargs):
        path = Path(path)
        if path.name.startswith('nac-attention-app-') and path.resolve().is_relative_to(R / 'app-evidence'):
            for name in ['cleanup-input.json', 'cleanup-result.json']:
                if (path / name).exists():
                    (O / name).write_bytes((path / name).read_bytes())
            emit('profile-removal', root=str(path), files=[str(p.relative_to(path)) for p in path.rglob('*') if p.is_file()])
        return oldremove(path, *args, **kwargs)
    app.shutil.rmtree = remove
