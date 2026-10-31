"""Fixture-only protocol controls. No app, engine, AX or XCTest acceptance."""
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

from instance_capture import (CaptureRun, CaptureJourney, Directory, ENVIRONMENT,
                              KEYS, LIMIT, STATE_FIELDS, encoded, manifest_frames, prepare, sha)
from instance_smoke import AppJourney


@unittest.skipUnless(sys.platform == 'darwin', 'Darwin exclusive-rename file contract')
class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.bridge = self.root / 'capture'
        prepare(self.bridge, 'a' * 40, 'b' * 40)
        self.run = CaptureRun(self.bridge)
        self.bundle = self.root / 'fixture.app'
        (self.bundle / 'Contents/Resources').mkdir(parents=True)
        (self.bundle / 'Contents/MacOS').mkdir()
        (self.bundle / 'Contents/Resources/engine-identity.json').write_text('{"track":"dev"}')
        (self.bundle / 'Contents/Resources/nac-web').write_bytes(b'NOT AN ENGINE')
        (self.bundle / 'Contents/MacOS/NACPreview').write_bytes(b'NOT AN APP')
        self.profile = self.root / 'profile'
        self.profile.mkdir(mode=0o700)
        self.store = self.profile / 'store.db'

    def journey(self, name='simultaneous'):
        return self.run.journey(self.root / name / 'result.json', self.bundle, self.profile, self.store)

    def request(self, journey, ordinal=1):
        state = dict.fromkeys(STATE_FIELDS, '')
        state.update({key: journey.configuration['context'][key] for key in ('root', 'store', 'bundle', 'track')})
        state.update(app_pid='1', window_number='2', app_incarnation='00000000-0000-4000-8000-000000000001',
                     app_launch_epoch='1.0', engine_pid='0', reopen_count='0', loading='false')
        value = dict(schema='nac343-capture-request-v1', run_nonce=self.run.manifest['run_nonce'],
                     request_nonce='%032x' % ordinal, ordinal=ordinal, key=KEYS[ordinal - 1],
                     configuration_sha256=journey.digest, manifest_sha256=self.run.digest,
                     before=state)
        with Directory(journey.path) as files:
            files.write('request-%02d.json' % ordinal, value)
        return value

    def fence(self, journey, request):
        value = dict(schema='nac343-private-fence-v1', run_nonce=request['run_nonce'],
                     request_nonce=request['request_nonce'], ordinal=request['ordinal'], key=request['key'],
                     configuration_sha256=journey.digest, request_sha256=sha(encoded(request)),
                     release='provisional', capture_verified=False, before=request['before'], after=request['before'])
        with Directory(journey.path) as files:
            files.write('fence-%02d.json' % request['ordinal'], value)
        return value

    def test_manifest_is_fresh_full_and_immutable(self):
        self.assertEqual(len(self.run.manifest['frames']), 19)
        with self.assertRaises(FileExistsError):
            prepare(self.bridge, 'a' * 40, 'b' * 40)
        other = prepare(self.root / 'second', 'a' * 40, 'b' * 40)
        self.assertNotEqual(other['run_nonce'], self.run.manifest['run_nonce'])
        self.assertEqual(manifest_frames(), self.run.manifest['frames'])
        self.run.admit()
        with self.assertRaises(FileExistsError):
            self.run.admit()
        for revision in ('main', '../foreign', 'x' * 40):
            with self.assertRaises(ValueError):
                prepare(self.root / 'bad', revision, 'b' * 40)
        with self.assertRaises(ValueError):
            self.run.require_source('a' * 40, ('simultaneous',) * 8)

    def test_disabled_mode_has_no_capture_io_or_arguments(self):
        with patch.dict(os.environ, {}, clear=True), patch('instance_capture.Directory') as directory:
            self.assertIsNone(CaptureRun.optional())
            directory.assert_not_called()
        output = self.root / 'normal/result.json'
        output.parent.mkdir()
        with patch.dict(os.environ, {}, clear=True), patch.object(AppJourney, 'observe', return_value={'apps': []}):
            app = AppJourney(self.bundle, output, self.profile, {}, self.store, self.root / 'observer', [])
        self.addCleanup(app.log.close)
        self.assertIsNone(app.capture)
        self.assertEqual(app.command, ['/usr/bin/open', '-a', str(self.bundle), '--args',
                         '--instance-scenario', 'workspace', '--instance-output', str(output),
                         '--instance-control', str(app.control), '--instance-store', str(self.store),
                         '--directory', str(self.profile), '--store-path', str(self.store)])

    def test_journey_bootstrap_binds_resources_track_and_fixed_frames(self):
        journey = self.journey()
        self.assertEqual([f['ordinal'] for f in journey.configuration['frames']], [1, 2])
        self.assertEqual(journey.digest, sha(encoded(journey.configuration)))
        self.assertEqual(journey.arguments(), ['--instance-capture-directory', str(journey.path),
                                              '--instance-capture-sha256', journey.digest])
        self.assertNotIn('evidence', journey.path.parts)
        self.assertNotIn('workspace', journey.path.parts)
        with self.assertRaises(ValueError):
            self.run.journey(self.root / 'unknown/result.json', self.bundle, self.profile, self.store)
        with self.assertRaises(ValueError):
            self.run.journey(self.root / 'cli/result.json', self.bundle, self.profile, self.root / 'foreign.db')

    def test_metadata_failure_cannot_skip_owned_app_and_engine_cleanup(self):
        output = self.root / 'normal/result.json'
        output.parent.mkdir()
        with patch.dict(os.environ, {}, clear=True), patch.object(AppJourney, 'observe', return_value={'apps': []}):
            app = AppJourney(self.bundle, output, self.profile, {}, self.store, self.root / 'observer', [])
        self.addCleanup(app.log.close)
        app.identity = {'pid': 12, 'launch': 'owned-incarnation'}
        app.capture = Mock()
        app.capture.retire.side_effect = ValueError('metadata denied')
        with patch.object(app, 'observe', side_effect=[{'apps': [app.identity]}, {'apps': []}]), \
                patch('instance_smoke.record_console'), patch('instance_smoke.subprocess.run') as run, \
                patch('instance_smoke.engine_settled', return_value=True) as settled:
            with self.assertRaisesRegex(ValueError, 'metadata denied'):
                app.cleanup()
        run.assert_called_once_with([str(self.root / 'observer'), 'terminate', str(self.bundle), json.dumps(app.identity)],
                                    check=True, capture_output=True, timeout=4)
        settled.assert_called_once_with(self.bundle, None)
        self.assertTrue(app.log.closed)

    def test_all19_keys_map_to_only_the_original_ten_native_episodes(self):
        episodes = {key.rsplit('/', 1)[0] for key in KEYS}
        self.assertEqual(len(episodes), 10)
        for episode in sorted(episodes):
            track = 'stable' if episode == 'coexist/stable' else 'dev'
            (self.bundle / 'Contents/Resources/engine-identity.json').write_text(json.dumps({'track': track}))
            journey = self.journey(episode)
            for frame in journey.configuration['frames']:
                self.assertEqual(KEYS[frame['ordinal'] - 1], frame['key'])
                self.assertEqual(journey.configuration['context']['track'], track)

    def test_complete_private_inventory_never_claims_public_image_acceptance(self):
        journeys = {}
        for frame in manifest_frames():
            episode = frame['key'].rsplit('/', 1)[0]
            if episode not in journeys:
                track = 'stable' if episode == 'coexist/stable' else 'dev'
                (self.bundle / 'Contents/Resources/engine-identity.json').write_text(json.dumps({'track': track}))
                journeys[episode] = self.journey(episode)
            journey = journeys[episode]
            request = self.request(journey, frame['ordinal'])
            self.fence(journey, request)
            journey.forward()
        receipt = self.run.final_receipt()
        self.assertEqual(receipt['provisional_releases'], 19)
        self.assertEqual(receipt['final_public_pairs_required'], 19)
        self.assertFalse(receipt['capture_verified'])
        self.assertFalse(list(self.bridge.rglob('*.png')))

    def test_omitted_duplicate_and_early_wakes_do_not_create_records(self):
        journey = self.journey()
        journey.forward()  # No request, no hint; cannot infer a capture.
        self.assertFalse(list(self.bridge.glob('forward-*')))
        request = self.request(journey)
        console = Mock()
        journey.forward(console)
        original = (self.bridge / 'forward-01.json').read_bytes()
        journey.forward(console)  # Duplicate scan cannot grow console evidence without bound.
        console.assert_called_once_with()
        self.assertEqual((self.bridge / 'forward-01.json').read_bytes(), original)
        with self.assertRaises(FileNotFoundError):
            self.run.final_receipt()
        self.fence(journey, request)  # Early provisional release is NOT image proof.
        journey.forward()
        self.assertFalse(json.loads((journey.path / 'fence-01.json').read_bytes())['capture_verified'])
        self.assertFalse(list(journey.path.glob('*.png')))
        with self.assertRaises(FileNotFoundError):
            self.run.final_receipt()  # One fence cannot replace19 or final public pairs.

    def test_out_of_order_and_wrong_run_requests_never_forward(self):
        journey = self.journey()
        self.request(journey, 2)
        with self.assertRaises(FileNotFoundError):
            journey.forward()
        self.assertFalse((self.bridge / 'forward-02.json').exists())
        for field, value in [('run_nonce', 'f' * 32), ('request_nonce', 'bad'), ('key', KEYS[1]),
                             ('configuration_sha256', '0' * 64), ('manifest_sha256', '0' * 64), ('ordinal', True)]:
            path = journey.path / 'request-01.json'
            path.unlink(missing_ok=True)
            request = self.request(journey)
            path.unlink()
            request[field] = value
            with Directory(journey.path) as files:
                files.write(path.name, request)
            with self.subTest(field=field), self.assertRaises(ValueError):
                journey.forward()
            self.assertFalse((self.bridge / 'forward-01.json').exists())

    def test_foreign_state_and_private_after_change_reject(self):
        journey = self.journey()
        request = self.request(journey)
        for field in ('root', 'store', 'track', 'bundle'):
            value = dict(request, before=dict(request['before'], **{field: 'foreign'}))
            path = journey.path / 'request-01.json'
            path.unlink()
            with Directory(journey.path) as files:
                files.write(path.name, value)
            with self.assertRaises(ValueError):
                journey.forward()
        (journey.path / 'request-01.json').unlink()
        request = self.request(journey)
        fence = self.fence(journey, request)
        fence['after'] = dict(fence['after'], store='foreign')
        (journey.path / 'fence-01.json').unlink()
        with Directory(journey.path) as files:
            files.write('fence-01.json', fence)
        with self.assertRaises(ValueError):
            journey.forward()

    def test_retirement_revokes_forwarding_and_is_idempotent(self):
        journey = self.journey()
        self.request(journey)
        journey.retire()
        original = (journey.path / 'retirement.json').read_bytes()
        journey.retire()
        self.assertEqual((journey.path / 'retirement.json').read_bytes(), original)
        with self.assertRaises(ValueError):
            journey.forward()

    def test_symlink_special_hardlink_foreign_owner_and_oversize_records(self):
        journey = self.journey()
        with Directory(journey.path) as files:
            files.write('good.json', {'owned': True})
            (journey.path / 'symlink.json').symlink_to('good.json')
            os.link(journey.path / 'good.json', journey.path / 'hard.json')
            os.mkfifo(journey.path / 'fifo.json', 0o600)
            for name in ('symlink.json', 'hard.json', 'fifo.json'):
                with self.subTest(name=name), self.assertRaises((ValueError, OSError)):
                    files.read(name)
            (journey.path / 'hard.json').unlink()
            with patch('instance_capture.os.geteuid', return_value=os.geteuid() + 1), self.assertRaises(ValueError):
                files.read('good.json')
            with self.assertRaises(ValueError):
                files.write('large.json', {'large': 'a' * LIMIT})
            files.write('at-limit.json', {'x': 'a' * (LIMIT - len(encoded({'x': ''})))})
            self.assertEqual(len(files.read('at-limit.json')[1]), LIMIT)
            for name, data in [('large.json', b'x' * (LIMIT + 1)), ('duplicate.json', b'{"x":1,"x":2}'),
                               ('bad.json', b'not json'), ('empty.json', b''), ('unknown.json', b'{ "x":1 }')]:
                path = journey.path / name
                path.write_bytes(data)
                path.chmod(0o600)
                with self.subTest(name=name), self.assertRaises((ValueError, OSError)):
                    files.read(name)
            with self.assertRaises(ValueError):
                files.read('../outside.json')
        self.assertFalse(list(journey.path.glob('pending-*')))

    def test_metadata_namespace_manifest_symlink_and_subset_are_rejected(self):
        with self.assertRaises(ValueError):
            prepare(self.root / 'evidence', 'a' * 40, 'b' * 40)
        alias = self.root / 'alias'
        alias.symlink_to(self.profile, target_is_directory=True)
        with self.assertRaises(ValueError):
            prepare(alias / 'metadata', 'a' * 40, 'b' * 40)
        manifest = self.bridge / 'manifest.json'
        original = manifest.read_bytes()
        manifest.unlink()
        elsewhere = self.root / 'manifest.json'
        elsewhere.write_bytes(original)
        elsewhere.chmod(0o600)
        manifest.symlink_to(elsewhere)
        with self.assertRaises(OSError):
            CaptureRun(self.bridge)
        manifest.unlink()
        value = json.loads(original)
        value['frames'] = value['frames'][:2]
        with Directory(self.bridge) as files:
            files.write('manifest.json', value)
        with self.assertRaises(ValueError):
            CaptureRun(self.bridge)

    def test_directory_replacement_symlink_and_handle_cleanup(self):
        journey = self.journey()
        files = Directory(journey.path)
        fd = files.fd
        journey.path.rename(journey.path.with_name('moved'))
        journey.path.mkdir(mode=0o700)
        with self.assertRaises(ValueError):
            files.write('foreign.json', {})
        files.close()
        files.close()
        with self.assertRaises(OSError):
            os.fstat(fd)
        journey.path.rmdir()
        journey.path.symlink_to(journey.path.with_name('moved'), target_is_directory=True)
        with self.assertRaises(ValueError):
            Directory(journey.path)

    @unittest.skipUnless(os.environ.get('NAC_CAPTURE_PROTOCOL_TEST_BINARY'), 'requires separately gated component compiler')
    def test_owned_swift_process_accepts_only_provisional_release_without_images(self):
        journey = self.journey()
        process = subprocess.Popen([os.environ['NAC_CAPTURE_PROTOCOL_TEST_BINARY'], 'child', str(journey.path), journey.digest],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 2
            while not (journey.path / 'request-01.json').exists():
                self.assertIsNone(process.poll())
                self.assertLess(time.monotonic(), deadline)
                time.sleep(.01)
            journey.forward()
            with Directory(journey.path) as files:
                request, raw = files.read('request-01.json')
                release = {k: request[k] for k in ('run_nonce', 'request_nonce', 'ordinal', 'key', 'configuration_sha256')}
                release.update(schema='nac343-provisional-release-v1', request_sha256=sha(raw))
                files.write('provisional-release-01.json', release)
            stdout, stderr = process.communicate(timeout=3)
            self.assertEqual(process.returncode, 0, (stdout, stderr))
            with Directory(journey.path) as files:
                journey.validate_fence(files, journey.configuration['frames'][0])
                fence, _ = files.read('fence-01.json')
            self.assertFalse(fence['capture_verified'])
            self.assertFalse(list(journey.path.glob('*.png')))
            with self.assertRaises(FileNotFoundError):
                self.run.final_receipt()
        finally:
            if process.poll() is None:
                process.terminate()  # Only our unreaped component child handle.
                process.communicate(timeout=3)

    @unittest.skipUnless(os.environ.get('NAC_CAPTURE_PROTOCOL_TEST_BINARY'), 'requires separately gated component compiler')
    def test_owned_swift_process_omitted_release_times_out_without_fence(self):
        journey = self.journey()
        result = subprocess.run([os.environ['NAC_CAPTURE_PROTOCOL_TEST_BINARY'], 'child', str(journey.path), journey.digest],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=4)
        self.assertEqual(result.returncode, 2)
        self.assertIn(b'omitted release', result.stderr)
        self.assertTrue((journey.path / 'request-01.json').exists())
        self.assertFalse((journey.path / 'fence-01.json').exists())


if __name__ == '__main__':
    unittest.main()
