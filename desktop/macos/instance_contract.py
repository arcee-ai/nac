#!/usr/bin/env python3
"""Real CLI/desktop store contention; does not establish AppKit acceptance.

Every process is a child of this fixture. Cleanup signals only its unreaped
Popen handle; no PID/discovery file grants cleanup or serving authority.
Failed fixture data and diagnostics remain beside the requested receipt.
"""
import hashlib
from contextlib import closing
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.request
import urllib.error
from urllib.parse import urlparse
import uuid

from engine_contract import record


def digest(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def snapshot(store):
    # No writable pager, migration, checkpoint or app configuration changes.
    with closing(sqlite3.connect(store.as_uri() + '?mode=ro', uri=True)) as connection:
        schema = connection.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name').fetchall()
        version = connection.execute('PRAGMA user_version').fetchone()[0]
        # Compare logical fixture data without printing rows or depending on
        # WAL/SHM bookkeeping bytes. A rejected opener must not mutate records.
        content = hashlib.sha256('\n'.join(connection.iterdump()).encode()).hexdigest()
    lock = store.with_name(store.name + '.run-locks') / (b'store-owner'.hex() + '.lock')
    sidecars = {str(lock.relative_to(store.parent)): (lock.stat().st_ino, digest(lock))}
    return dict(schema=schema, version=version, sidecars=sidecars, content_sha256=content)


class OwnedEngine:
    def __init__(self, binary, root, store, environment, desktop=False):
        self.channel = None
        self.process = None
        self.diagnostics = root / (str(uuid.uuid4()) + '.log')
        self.store = store
        self.incarnation = str(uuid.uuid4())
        self.identity = json.loads(subprocess.check_output([str(binary), '__desktop-identity'], env=environment))
        env = dict(environment)
        child = None
        if desktop:
            self.channel, child = socket.socketpair()
            env['NAC_DESKTOP_CHANNEL_FD'] = str(child.fileno())
        try:
            with self.diagnostics.open('wb') as output:
                self.process = subprocess.Popen(
                    [str(binary), '--bind', '127.0.0.1:0', '--directory', str(root),
                     '--store-path', str(store), '--worker-executable', str(binary), '--no-open'],
                    env=env, cwd=root, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                    pass_fds=(child.fileno(),) if child else (), start_new_session=True)
            if self.channel:
                self.channel.sendall(json.dumps(dict(kind='hello', version=1, incarnation=self.incarnation,
                                                     identity=self.identity, store=str(store.resolve()))).encode() + b'\n')
        except BaseException:
            self.close()
            raise
        finally:
            if child:
                child.close()

    def ready(self, receipt=None):
        if self.channel:
            receipt = receipt or record(self.channel)
            assert receipt['kind'] == 'ready', receipt
            assert receipt['identity'] == self.identity and receipt['incarnation'] == self.incarnation
            assert receipt['store'] == str(self.store.resolve())
            endpoint = receipt['endpoint']
        else:
            deadline = time.monotonic() + 15
            while True:
                assert self.process.poll() is None, self.diagnostics.read_text()
                match = re.search(r'listening on (http://127\.0\.0\.1:\d+)', self.diagnostics.read_text())
                if match:
                    endpoint = match[1]
                    break
                assert time.monotonic() < deadline, 'CLI listener did not become ready'
                time.sleep(.025)
        with urllib.request.urlopen(endpoint + '/store', timeout=3) as response:
            store = json.load(response)
        assert store['store_path'] == str(self.store.resolve()), store
        self.endpoint = endpoint
        return endpoint

    def rejected(self, receipt=None):
        receipt = receipt or record(self.channel)
        assert receipt['kind'] == 'failed' and receipt['incarnation'] == self.incarnation, receipt
        assert receipt['version'] == 1 and not receipt.get('endpoint'), receipt
        assert self.process.wait(timeout=5) != 0, 'Conflicting desktop launch reported success'
        return receipt

    def stop(self, crash=False):
        if self.process.poll() is None:
            if crash:
                self.process.kill()
            elif self.channel:
                self.channel.sendall(json.dumps(dict(kind='stop', version=1,
                                                     incarnation=self.incarnation)).encode() + b'\n')
            else:
                self.process.send_signal(signal.SIGTERM)
        code = self.process.wait(timeout=24)
        if not crash:
            assert code == 0, (code, self.diagnostics.read_text())
        return code

    def close(self):
        if self.channel:
            self.channel.close()
            self.channel = None
        if self.process and self.process.poll() is None:
            # Only this fixture's unreaped child, never an observed peer PID.
            self.process.terminate()
            try:
                self.process.wait(timeout=24)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=3)


def shutdown_contention(binary, root, children):
    profile = root / 'shutdown'
    profile.mkdir()
    environment = dict(HOME=str(profile), NAC_HOME=str(profile / 'nac-home'),
                       PATH='/usr/bin:/bin:/usr/sbin:/sbin', BROWSER='none', NAC_TELEMETRY='disabled',
                       MODELS_DEV_URL='http://127.0.0.1:1/models-dev',
                       OPENAI_API_KEY='instance-fixture-dummy-only')
    store = profile / 'selected store.db'
    owner = OwnedEngine(binary, profile, store, environment)
    children.append(owner)
    owner.ready()

    def post(path, body):
        request = urllib.request.Request(owner.endpoint + path, json.dumps(body).encode(),
                                         {'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise AssertionError(f'Fixture setup {path}: {error.code}: {error.read(4096).decode()}') from error

    project = post('/projects', dict(name='Instance shutdown fixture', cwd=str(profile)))
    session = post('/sessions', dict(behavior='direct', project_id=project['project_id'],
                                    model='gpt-5.6-sol', backend='openai-responses',
                                    base_url='http://127.0.0.1:1/v1', api_key_env='OPENAI_API_KEY'))
    endpoint = urlparse(owner.endpoint)
    address = (endpoint.hostname, endpoint.port)
    # An acknowledged real SSE response is the deterministic delivery-drain
    # barrier used by the existing shutdown tests, not a timing-only sleep.
    with socket.create_connection(address, timeout=3) as stream:
        stream.sendall((f"GET /sessions/{session['metadata']['session_id']}/events/stream HTTP/1.1\r\n"
                        'Host: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n').encode())
        response = b''
        while b'\r\n\r\n' not in response:
            data = stream.recv(4096)
            assert data, 'SSE closed before shutdown barrier'
            response += data
            assert len(response) <= 65536
        assert response.startswith(b'HTTP/1.1 200'), response[:100]
        before = snapshot(store)
        owner.process.send_signal(signal.SIGTERM)
        deadline = time.monotonic() + 4
        while True:
            assert owner.process.poll() is None, 'CLI exited before its delivery barrier drained'
            with socket.socket() as probe:
                if probe.connect_ex(address) != 0:
                    break
            assert time.monotonic() < deadline, 'CLI listener did not enter shutdown'
            time.sleep(.025)
        contender = OwnedEngine(binary, profile, store, environment, desktop=True)
        children.append(contender)
        failure = contender.rejected()
        assert owner.process.poll() is None, 'Conflicting app attempt interfered with CLI drain'
        assert snapshot(store) == before
    assert owner.process.wait(timeout=24) == 0
    replacement = OwnedEngine(binary, profile, store, environment, desktop=True)
    children.append(replacement)
    replacement.ready()
    replacement.stop()
    return dict(scenario='shutdown-in-progress', cli_survived_drain_conflict=True,
                failure_code=failure['code'], schema_and_lock_unchanged=True,
                retry_after_delivery_drain=True, canonical_store=str(store))


def run_contract(binary, destination):
    binary, destination = Path(binary).resolve(), Path(destination).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix='nac-instance-contract-', dir=destination.parent)).resolve()
    results, children = [], []
    evidence = dict(binary=str(binary), binary_sha256=digest(binary), fixture=str(root), cases=results,
                    actual_app_acceptance=False)
    try:
        profile = root / 'simultaneous'
        profile.mkdir()
        environment = dict(HOME=str(profile), NAC_HOME=str(profile / 'nac-home'),
                           PATH='/usr/bin:/bin:/usr/sbin:/sbin', BROWSER='none', NAC_TELEMETRY='disabled',
                           MODELS_DEV_URL='http://127.0.0.1:1/models-dev')
        store = profile / 'selected store.db'
        contenders = []
        for _ in range(2):
            child = OwnedEngine(binary, profile, store, environment, desktop=True)
            children.append(child)
            contenders.append(child)
        receipts = [record(child.channel) for child in contenders]
        assert sorted(receipt['kind'] for receipt in receipts) == ['failed', 'ready'], receipts
        for child, receipt in zip(contenders, receipts):
            if receipt['kind'] == 'ready':
                child.ready(receipt)
            else:
                child.rejected(receipt)
        winner = next(child for child, receipt in zip(contenders, receipts) if receipt['kind'] == 'ready')
        assert winner.process.poll() is None
        results.append(dict(scenario='simultaneous-engine-launch', serving_owners=1,
                            canonical_store=str(store), owner_pid=winner.process.pid,
                            loser_failed_before_ready=True, actual_app_acceptance=False))
        winner.stop()
        for exit_mode in ('graceful', 'crash'):
            profile = root / exit_mode
            profile.mkdir()
            environment = dict(HOME=str(profile), NAC_HOME=str(profile / 'nac-home'),
                               PATH='/usr/bin:/bin:/usr/sbin:/sbin', BROWSER='none', NAC_TELEMETRY='disabled',
                               MODELS_DEV_URL='http://127.0.0.1:1/models-dev')
            store = profile / 'selected store.db'
            owner = OwnedEngine(binary, profile, store, environment)
            children.append(owner)
            owner.ready()
            evidence['engine_identity'] = owner.identity
            before = snapshot(store)
            alias = profile / 'symlink store.db'
            alias.symlink_to(store)
            directory_alias = profile / 'directory alias'
            directory_alias.symlink_to(profile, target_is_directory=True)
            for selected in (store, alias, directory_alias / store.name):
                contender = OwnedEngine(binary, profile, selected, environment, desktop=True)
                children.append(contender)
                failure = contender.rejected()
                assert owner.process.poll() is None, 'App attempt terminated the real CLI'
                owner.ready()
                assert snapshot(store) == before, 'Rejected launch changed schema or lock identity/content'
                assert set(profile.rglob('*.db')) == {store, alias}, 'Rejected launch selected another store'
                results.append(dict(scenario=exit_mode + '-contention', selected=str(selected),
                                    canonical_store=str(store), cli_pid=owner.process.pid,
                                    contender_pid=contender.process.pid, failure_code=failure['code'],
                                    cli_survives=True, schema_and_lock_unchanged=True))
                contender.close()
            # Separate explicit profiles may serve concurrently. Build track
            # isolation is supplied by342; this checks the lease's store scope.
            separate = OwnedEngine(binary, profile, profile / 'explicit profile.db', environment, desktop=True)
            children.append(separate)
            separate.ready()
            assert owner.process.poll() is None
            separate.stop()
            owner.stop(crash=exit_mode == 'crash')
            stale = snapshot(store)
            assert stale['sidecars'] == before['sidecars'], 'Owner exit must not delete the lock file'
            replacement = OwnedEngine(binary, profile, alias, environment, desktop=True)
            children.append(replacement)
            replacement.ready()
            assert snapshot(store)['sidecars'] == before['sidecars'], 'Restart replaced a stale lock sidecar'
            replacement.stop()
            results.append(dict(scenario=exit_mode + '-retry', original_owner_exited=True,
                                ordinary_lease_acquired=True, stale_lock_retained=True,
                                separate_explicit_profile=True))
        results.append(shutdown_contention(binary, root, children))
        evidence['passed'] = True
    except BaseException as error:
        evidence.update(passed=False, failure=str(error), fixture_retained=True)
        raise
    finally:
        for child in reversed(children):
            child.close()
        destination.write_text(json.dumps(evidence, indent=2) + '\n')
        if evidence.get('passed'):
            shutil.rmtree(root)
    return evidence


if __name__ == '__main__':
    import sys
    run_contract(*sys.argv[1:])
