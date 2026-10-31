#!/usr/bin/env python3
"""Real marked-engine auth/Origin/restart contracts with HTTP approval doubles.

No app, system browser, OS input, real credential or vendor acceptance. Uses
only exact private normal/fixture binaries supplied by the leased build owner.
"""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import uuid
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from device_auth_profile import DeviceProfile, identity
from engine_contract import record
from external_auth_fixture import AuthFixture


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


def http(url, method='GET', body=None, origin=None):
    headers = {'Content-Type': 'application/json'}
    if origin:
        headers['Origin'] = origin
    request = Request(url, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
    try:
        response = build_opener(NoRedirect).open(request, timeout=4)
    except HTTPError as error:
        response = error
    with response:
        data = response.read()
        try:
            value = json.loads(data)
        except ValueError:
            value = None
        return response.code, value


class OwnedDesktop:
    def __init__(self, binary, build, profile, log):
        self.parent, child = socket.socketpair()
        self.incarnation = str(uuid.uuid4())
        self.log = log.open('wb')
        environment = {**profile.environment, 'NAC_DESKTOP_CHANNEL_FD': str(child.fileno())}
        self.process = subprocess.Popen([str(binary), '--bind', '127.0.0.1:0', '--directory', str(profile.workspace),
            '--store-path', str(profile.store), '--no-open'], env=environment, pass_fds=(child.fileno(),),
            cwd=profile.workspace, stdin=subprocess.DEVNULL, stdout=self.log, stderr=self.log, start_new_session=True)
        child.close()
        try:
            self.parent.sendall(json.dumps({'kind': 'hello', 'version': 1, 'incarnation': self.incarnation,
                'identity': build, 'store': str(profile.store)}).encode() + b'\n')
            ready = record(self.parent, timeout=15)
            assert ready['kind'] == 'ready' and ready['identity'] == build
            assert ready['incarnation'] == self.incarnation and ready['store'] == str(profile.store)
            assert ready['endpoint'].startswith('http://127.0.0.1:')
            self.origin = ready['endpoint']
        except BaseException:
            self.close()
            raise

    def close(self):
        try:
            if self.process.poll() is None:
                self.parent.sendall(json.dumps({'kind': 'stop', 'version': 1, 'incarnation': self.incarnation}).encode() + b'\n')
                try:
                    self.process.wait(timeout=25)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=3)
                    raise AssertionError('Owned fixture engine failed its shutdown bound')
        finally:
            self.parent.close()
            self.log.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def poll(engine, handle):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        status, state = http(engine.origin + '/auth/arcee/login/' + handle)
        assert status == 200, 'Actual login poll unexpectedly failed'
        if state['state'] != 'pending':
            return state
        time.sleep(.05)
    raise TimeoutError('Actual provider owner did not settle')


def start(engine, fixture):
    status, prompt = http(engine.origin + '/auth/arcee/login', 'POST', {}, engine.origin)
    assert status == 200, 'Actual provider start rejected'
    assert prompt['provider'] == 'arcee' and prompt['verification_uri'].startswith(fixture.origin + '/device/verify?')
    return prompt


def approve(prompt):
    status, _ = http(prompt['verification_uri'])
    assert status == 200, 'HTTP approval double failed'


def main():
    fixture_binary, normal_binary, output = (Path(value).resolve() for value in sys.argv[1:])
    output.mkdir(parents=True, exist_ok=False)
    build = identity(fixture_binary)
    normal = json.loads(subprocess.check_output([str(normal_binary), '__desktop-identity'], text=True))
    assert normal['source_revision'] == build['source_revision']
    assert not normal['build_id'].startswith('native-auth-fixture-v1-')
    normal_bytes = normal_binary.read_bytes()
    assert all(marker not in normal_bytes for marker in [b'NAC_NATIVE_AUTH_FIXTURE_ROOT',
        b'NAC_NATIVE_AUTH_FIXTURE_ORIGIN', b'native-auth-fixture-model'])
    results = []
    with AuthFixture() as service, DeviceProfile(build, service.origin) as profile:
        arguments = ['__desktop-configuration', '--directory', str(profile.workspace), '--store-path', str(profile.store)]
        preflight = subprocess.run([str(fixture_binary), *arguments], env=profile.environment,
                                   cwd=profile.workspace, capture_output=True, timeout=15)
        assert preflight.returncode == 0 and json.loads(preflight.stdout)['status'] == 'selected'
        assert not profile.store.exists(), 'Configuration preflight opened the serving store'
        without_channel = subprocess.run([str(fixture_binary), '--bind', '127.0.0.1:0',
            '--directory', str(profile.workspace), '--store-path', str(profile.store), '--no-open'],
            cwd=profile.workspace, env=profile.environment, capture_output=True, timeout=15)
        assert without_channel.returncode != 0 and not profile.store.exists()
        assert b'requires an owned ephemeral desktop launch' in without_channel.stderr
        results.append({'scenario': 'serving-without-owned-channel', 'rejected_before_store': True})
        pure_identity = subprocess.run([str(fixture_binary), '__desktop-identity'], env={'PATH': '/usr/bin:/bin',
            'NAC_NATIVE_AUTH_FIXTURE_ROOT': '/invalid-not-owned', 'ARCEE_API_KEY': 'unused-canary'},
            capture_output=True, timeout=10)
        assert pure_identity.returncode == 0 and json.loads(pure_identity.stdout) == build
        for scenario, environment, options in [
            ('wrong-home', {**profile.environment, 'HOME': str(profile.root / 'other')}, arguments),
            ('implicit-store', profile.environment, arguments[:-2]),
            ('wrong-service', {**profile.environment, 'NAC_NATIVE_AUTH_FIXTURE_ORIGIN': 'https://provider.example.test'}, arguments),
        ]:
            refused = subprocess.run([str(fixture_binary), *options], env=environment,
                                     cwd=profile.workspace, capture_output=True, timeout=15)
            assert refused.returncode != 0 and not profile.store.exists(), 'Invalid preflight caused store effects'
            results.append({'scenario': scenario, 'rejected_before_store': True})

        with OwnedDesktop(fixture_binary, build, profile, output / 'engine-first.log') as engine:
            before = len(service.snapshot()['events'])
            for origin in ['https://foreign.example.test', engine.origin.replace('127.0.0.1', 'localhost')]:
                assert http(engine.origin + '/auth/arcee/login', 'POST', {}, origin)[0] == 403
            assert len(service.snapshot()['events']) == before
            assert http(engine.origin + '/sessions', 'POST', {}, engine.origin)[0] == 403
            assert http(engine.origin + '/future-effect', 'POST', {}, engine.origin)[0] == 403
            assert http(engine.origin + '/providers/models', 'POST', {'backend': 'openai-responses',
                'api_key': 'local-never-send', 'base_url': 'https://never-call.example.test'}, engine.origin)[0] == 400
            assert http(engine.origin + '/providers/models', 'POST', {'backend': 'arcee-auth',
                'api_key': 'local-never-send'}, engine.origin)[0] == 400
            prompt = start(engine, service)
            approve(prompt)
            assert poll(engine, prompt['login_id'])['state'] == 'complete'
            credential = profile.root / 'nac-home/arcee_auth.json'
            retained = credential.read_bytes()
            state = json.loads(retained)
            assert state['client_id'] == 'nac-cli' and state['auth_issuer'] == 'https://api.arcee.ai'
            assert state.get('managed_bootstrap') is None
            models_status, models = http(engine.origin + '/providers/models', 'POST', {'backend': 'arcee-auth'}, engine.origin)
            assert models_status == 200 and models['models'][0]['id'] == 'native-auth-fixture-model'
            for mode, error in [('denied', 'denied'), ('expired', 'expired'), ('timeout', 'expired')]:
                with service.lock:
                    service.device_mode = mode
                prompt = start(engine, service)
                approve(prompt)
                failed = poll(engine, prompt['login_id'])
                assert failed['state'] == 'failed' and error in failed['error'].lower()
                assert credential.read_bytes() == retained, 'Failed login changed the old credential'
                results.append({'scenario': mode, 'actual_owner_failed': True, 'old_credential_preserved': True})
            with service.lock:
                service.device_mode = 'hold'
            canceled = start(engine, service)
            approve(canceled)
            assert http(engine.origin + '/auth/arcee/login/' + canceled['login_id'], 'DELETE', origin=engine.origin)[0] == 204
            assert http(engine.origin + '/auth/arcee/login/' + canceled['login_id'])[0] == 404
            assert credential.read_bytes() == retained
        starts = sum(event['kind'] == 'device_started' for event in service.snapshot()['events'])
        with OwnedDesktop(fixture_binary, build, profile, output / 'engine-restart.log') as restarted:
            status, auth = http(restarted.origin + '/auth')
            assert status == 200 and any(value['provider'] == 'arcee' and value['signed_in'] for value in auth['providers'])
            assert http(restarted.origin + '/auth/arcee/login/' + canceled['login_id'])[0] == 404
            assert credential.read_bytes() == retained
            assert starts == sum(event['kind'] == 'device_started' for event in service.snapshot()['events'])
        for command in [('arcee-auth', 'logout'), ('upgrade',)]:
            refused = subprocess.run([str(fixture_binary), *command], env=profile.environment, capture_output=True, timeout=10)
            assert refused.returncode != 0 and b'does not admit effectful CLI commands' in refused.stderr
            assert credential.read_bytes() == retained
        profile_root = profile.root
        results.extend([{'scenario': 'success', 'actual_owner_complete': True},
                        {'scenario': 'cancel-restart', 'old_handle_404': True, 'no_start_replay': True},
                        {'scenario': 'closed-effects-and-origins', 'rejected': True}])
    assert not profile_root.exists()
    report = {'source': build['source_revision'], 'engine_identity': build,
        'fixture_engine_sha256': hashlib.file_digest(fixture_binary.open('rb'), 'sha256').hexdigest(),
        'normal_engine_sha256': hashlib.file_digest(normal_binary.open('rb'), 'sha256').hexdigest(),
        'scope': 'real marked-engine/state-owner; HTTP approval doubles only', 'native_browser_qualified': False,
        'profile_removed': True, 'results': results}
    (output / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Marked-engine owner/Origin/denial/expiry/cancel/restart/exclusion contracts passed; no browser qualification')


if __name__ == '__main__':
    main()
