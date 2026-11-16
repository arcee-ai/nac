"""Separately allocated real-stub custody tests. No product/native/auth process.

Actors speak only an owned socketpair/stdin stop channel. The explicitly owned
supervisor always stops and reaps its original handles before fixture removal.
"""
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import uuid

from device_auth_contract import OwnedDesktop
from device_auth_profile import DeviceProfile
from external_auth_smoke import relocated_app, require_actor_exit, require_terminal

BUILD = {'product_version': 'test', 'build_id': 'native-auth-fixture-v1-' + 'a' * 40,
         'source_revision': 'a' * 40, 'track': 'dev'}
ACTOR = '''import json,os,socket
from pathlib import Path
channel=socket.socket(fileno=int(os.environ['NAC_DESKTOP_CHANNEL_FD']))
channel.settimeout(15)
stream=channel.makefile('rb')
hello=json.loads(stream.readline())
marker=Path(hello['store']).parent/'stub-live'
marker.write_text('owned stub, no auth state')
channel.sendall((json.dumps(dict(kind='ready',identity=hello['identity'],incarnation=hello['incarnation'],store=hello['store'],endpoint='http://127.0.0.1:1'))+'\\n').encode())
while True:
    line=stream.readline()
    if not line: break
    stop=json.loads(line)
    if stop.get('kind')=='stop' and stop.get('incarnation')==hello['incarnation']: break
marker.unlink()
stream.close()
channel.close()
'''


class RealStubCustodyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='nac-auth-real-stub-test-')
        self.root = Path(self.temporary.name)
        self.actor = self.root / 'owned-stub'
        self.actor.write_text('#!' + sys.executable + ' -I\n' + ACTOR)
        self.actor.chmod(0o700)
        self.source = self.root / 'Source.fixture'
        self.source.mkdir()
        shutil.copyfile(self.actor, self.source / 'owned-stub')
        (self.source / 'owned-stub').chmod(0o700)
        self.observations = []

    def tearDown(self):
        destination = os.environ.get('NAC_AUTH_STUB_EVIDENCE')
        if destination:
            root = Path(destination)
            root.mkdir(parents=True, exist_ok=True)
            (root / (self._testMethodName + '.json')).write_text(json.dumps({
                'scope': 'real owned stub handles/private channels/filesystem; no product/native/auth/browser',
                'observations': self.observations}, indent=2) + '\n')
        self.temporary.cleanup()

    def test_normal_stop_reaps_original_handle_before_profile_removal(self):
        with relocated_app(self.source, self.root / 'normal-evidence', 'nac-auth-stub-relocation-') as (app, custody):
            relocation = app.parent
            with DeviceProfile(BUILD, 'http://127.0.0.1:1') as profile:
                root = profile.root
                custody.update(launched=True, settled=False)
                with OwnedDesktop(app / 'owned-stub', BUILD, profile, self.root / 'normal.log') as owner:
                    self.assertIsNone(owner.process.poll())
                    self.assertTrue((root / 'stub-live').exists())
                    child = owner.process
                self.assertIsNotNone(child.returncode)
                require_actor_exit(child.pid)
                self.assertFalse((root / 'stub-live').exists())
                custody['settled'] = True
                self.observations.append({'pid': child.pid, 'original_handle_reaped': True,
                                          'profile_present_before_outer_exit': root.exists()})
            self.assertFalse(root.exists())
        self.assertFalse(relocation.exists())
        self.observations.append({'owned_profile_and_relocation_removed_after_reap': True})

    def test_failure_and_refused_live_identity_retain_until_original_owner_stop(self):
        sentinel = self.root / 'unrelated-sentinel'
        sentinel.write_bytes(b'unrelated retained bytes')
        unrelated = subprocess.Popen([sys.executable, '-I', '-c', 'import sys;sys.stdin.readline()'],
                                     stdin=subprocess.PIPE, env={'PATH': '/usr/bin:/bin'}, cwd=self.root)
        profile = DeviceProfile(BUILD, 'http://127.0.0.1:1')
        owner = None
        try:
            primary = RuntimeError('injected controller failure')
            with self.assertRaises(RuntimeError) as raised:
                with relocated_app(self.source, self.root / 'failure-evidence', 'nac-auth-stub-relocation-') as (app, custody):
                    relocation = app.parent
                    relocation_inode = relocation.stat().st_ino
                    custody.update(launched=True, settled=False)
                    owner = OwnedDesktop(app / 'owned-stub', BUILD, profile, self.root / 'failure.log')
                    before = (profile.root / '.native-auth-fixture-owner.json').read_bytes()
                    with profile:
                        raise primary
            self.assertIs(raised.exception, primary)
            self.assertIsNone(owner.process.poll())
            self.assertTrue(relocation.exists())
            self.assertEqual((app / 'owned-stub').read_bytes(), self.actor.read_bytes())
            self.assertTrue((profile.root / 'stub-live').exists())
            self.assertEqual((profile.root / '.native-auth-fixture-owner.json').read_bytes(), before)
            record = {'scenario': 'device-success', 'passed': True, 'stopped': True, 'commands_retired': True,
                      'ready_source': BUILD['source_revision'], 'ready_build': BUILD['build_id'],
                      'launch_incarnation': str(uuid.uuid4()), 'ready_store': str(profile.store),
                      'selected_store': str(profile.store), 'app_pid': unrelated.pid, 'engine_pid': owner.process.pid}
            with self.assertRaisesRegex(AssertionError, 'retirement is unproven'):
                require_terminal(record, 'device-success', BUILD, profile)
            self.assertIsNone(unrelated.poll())
            self.assertIsNone(owner.process.poll())
            self.assertEqual(sentinel.read_bytes(), b'unrelated retained bytes')
            self.observations.append({'pid': owner.process.pid, 'unrelated_pid': unrelated.pid,
                                      'primary_object_preserved': True, 'owned_actor_alive_while_retained': True,
                                      'sentinel_unchanged': True, 'relocated_actor_bytes_retained_while_live': True,
                                      'live_identity_refused_without_signals': True})
        finally:
            # These are the same retained owner/handles, never discovered PID targets.
            failure = sys.exc_info()[1]
            original = failure
            def finish_owned():
                if owner is not None:
                    owner.close()
                    self.assertIsNotNone(owner.process.returncode)
            def finish_unrelated():
                unrelated.stdin.write(b'stop\n')
                unrelated.stdin.close()
                unrelated.wait(timeout=3)
            for finish in [finish_owned, finish_unrelated]:
                try:
                    finish()
                except BaseException as error:
                    if failure is None:
                        failure = error
                    else:
                        failure.add_note('Stub supervisor teardown failed (' + type(error).__name__ + ')')
            if owner is not None and owner.closed:
                profile.__exit__(None, None, None)
                self.assertFalse(profile.root.exists())
                self.assertFalse(relocation.is_symlink())
                self.assertEqual(relocation.stat().st_ino, relocation_inode)
                shutil.rmtree(relocation)
                self.assertEqual(sentinel.read_bytes(), b'unrelated retained bytes')
                self.observations.append({'owned_actor_reaped_before_cleanup': True,
                                          'unrelated_handle_stopped_by_its_owner': True,
                                          'owned_profile_removed': True})
            if original is None and failure is not None:
                raise failure


if __name__ == '__main__':
    unittest.main()
