"""Actual direct-main lifetime tests with inert engine/listener/HTTP ports."""
from contextlib import ExitStack
import json
from pathlib import Path
import shutil
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid
from urllib.parse import urlsplit

import device_auth_contract as owner
from device_auth_profile import DeviceProfile
from external_auth_fixture import cleanup_note

BUILD = {'product_version': 'test', 'build_id': 'native-auth-fixture-v1-' + 'a' * 40,
         'source_revision': 'a' * 40, 'track': 'dev'}
STORE = b'inert store marker; no database or credential'
STATE = json.dumps({'client_id': 'nac-cli', 'auth_issuer': 'https://api.arcee.ai'}).encode()


class DirectMainCustodyTests(unittest.TestCase):
    def exercise(self, listener_error=None, construction_error=None, body_error=None):
        with tempfile.TemporaryDirectory(prefix='nac-direct-main-inert-') as temporary:
            root = Path(temporary)
            fixture_binary, normal_binary = root / 'fixture', root / 'normal'
            fixture_binary.write_bytes(b'inert fixture, never executed')
            normal_binary.write_bytes(b'inert normal, never executed')
            sentinel = root / 'unrelated'
            sentinel.write_bytes(b'unchanged unrelated bytes')
            output = root / 'evidence'
            captured = []
            closed = []

            class Service:
                origin = 'http://127.0.0.1:43123'
                lock = threading.Lock()
                device_mode = 'success'
                def __enter__(self):
                    return self
                def __exit__(self, kind, primary, traceback):
                    closed.append(primary)
                    if listener_error:
                        if primary is not None:
                            cleanup_note(primary, 'Inert listener close', listener_error)
                        else:
                            raise listener_error
                def snapshot(self):
                    return {'events': []}
            service = Service()

            def profile(build, origin):
                if construction_error:
                    raise construction_error
                result = DeviceProfile(build, origin)
                captured.append((result, (result.root / '.native-auth-fixture-owner.json').read_bytes()))
                return result

            class Engine:
                origin = 'http://127.0.0.1:43210'
                def __init__(self, binary, build, profile, log):
                    self.profile = profile
                    self.incarnation = str(uuid.uuid4())
                    profile.begin_launch()
                    profile.store.write_bytes(STORE)
                    (profile.root / 'nac-home/arcee_auth.json').write_bytes(STATE)
                def __enter__(self):
                    return self
                def __exit__(self, *args):
                    self.profile.finish_launch(self.incarnation)

            def command(argv, **kwargs):
                if argv[0] == '/usr/bin/git':
                    return SimpleNamespace(returncode=0)
                if argv[1] == '__desktop-configuration':
                    env = kwargs['env']
                    invalid = env['HOME'].endswith('/other') or '--store-path' not in argv or env['NAC_NATIVE_AUTH_FIXTURE_ORIGIN'].startswith('https:')
                    return SimpleNamespace(returncode=1 if invalid else 0, stdout=b'{"status":"selected"}')
                if argv[1] == '__desktop-identity':
                    return SimpleNamespace(returncode=0, stdout=json.dumps(BUILD).encode())
                return SimpleNamespace(returncode=1, stderr=b'requires an owned ephemeral desktop launch; does not admit effectful CLI commands')

            def http(url, method='GET', body=None, origin=None):
                path = urlsplit(url).path
                if path == '/auth' and method == 'GET':
                    return 200, {'providers': [{'provider': 'arcee', 'signed_in': True}]}
                if path == '/providers/models':
                    if body == {'backend': 'arcee-auth'}:
                        return 200, {'models': [{'id': 'native-auth-fixture-model'}]}
                    return 400, None
                if method == 'DELETE':
                    return 204, None
                if method == 'GET':
                    return 404, None
                return 403, None

            def poll(*args):
                if body_error:
                    raise body_error
                return {'state': 'complete'} if service.device_mode == 'success' else {
                    'state': 'failed', 'error': 'denied' if service.device_mode == 'denied' else 'expired'}

            failure = None
            normal = {**BUILD, 'build_id': 'ordinary'}
            with ExitStack() as stack:
                stack.enter_context(patch.object(owner, 'identity', return_value=BUILD))
                stack.enter_context(patch.object(owner.subprocess, 'check_output', return_value=json.dumps(normal)))
                stack.enter_context(patch.object(owner.subprocess, 'run', side_effect=command))
                stack.enter_context(patch.object(owner, 'AuthFixture', return_value=service))
                stack.enter_context(patch.object(owner, 'DeviceProfile', side_effect=profile))
                stack.enter_context(patch.object(owner, 'OwnedDesktop', Engine))
                stack.enter_context(patch.object(owner, 'http', side_effect=http))
                stack.enter_context(patch.object(owner, 'start', return_value={'login_id': 'inert'}))
                stack.enter_context(patch.object(owner, 'approve'))
                stack.enter_context(patch.object(owner, 'poll', side_effect=poll))
                stack.enter_context(patch('sys.argv', ['runner', str(fixture_binary), str(normal_binary), str(output)]))
                stack.enter_context(patch('builtins.print'))
                try:
                    owner.main()
                except BaseException as error:
                    failure = error
            try:
                if listener_error or body_error:
                    self.assertIs(failure, body_error or listener_error)
                    self.assertEqual(len(captured), 1)
                    actual, before = captured[0]
                    self.assertTrue(actual.root.exists(), 'Actual direct-main deleted profile before listener failure')
                    self.assertEqual((actual.root / '.native-auth-fixture-owner.json').read_bytes(), before)
                    self.assertEqual(actual.store.read_bytes(), STORE)
                    self.assertEqual((actual.root / 'nac-home/arcee_auth.json').read_bytes(), STATE)
                    self.assertFalse((output / 'results.json').exists())
                elif construction_error:
                    self.assertIs(failure, construction_error)
                    self.assertEqual(closed, [construction_error])
                    self.assertFalse(captured)
                else:
                    self.assertIsNone(failure)
                    self.assertTrue(json.loads((output / 'results.json').read_text())['profile_removed'])
                    self.assertTrue(all(not value.root.exists() for value, _ in captured))
                self.assertEqual(sentinel.read_bytes(), b'unchanged unrelated bytes')
                self.assertEqual(normal_binary.read_bytes(), b'inert normal, never executed')
            finally:
                for actual, _ in captured:
                    if actual.root.exists():
                        shutil.rmtree(actual.root)  # Inert test supervisor; no actors were spawned.
            return failure

    def test_listener_close_failure_after_success_retains_actual_direct_profile(self):
        self.exercise(listener_error=RuntimeError('listener teardown failed'))

    def test_fully_settled_success_removes_only_owned_profile(self):
        self.exercise()

    def test_profile_constructor_failure_closes_listener_with_original_error(self):
        self.exercise(construction_error=RuntimeError('profile constructor failed'))

    def test_body_error_stays_primary_when_listener_close_also_fails(self):
        primary = RuntimeError('direct body failed')
        error = self.exercise(listener_error=OSError('listener teardown failed'), body_error=primary)
        self.assertTrue(any('listener close' in note for note in error.__notes__))


if __name__ == '__main__':
    unittest.main()
