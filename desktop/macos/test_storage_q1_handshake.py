"""Inert clock/launcher controls for the real Q1 pre-render handshake."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import storage_q1 as q1


class Q1HandshakeTests(unittest.TestCase):
    def launch(self, *, pending_after=6, store_seconds=.25, seed_seconds=.25,
               release_guard_seconds=0, action_deadline=100, hold_expired=False):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            owner = q1.RecoveryLaunch.__new__(q1.RecoveryLaunch)
            owner.root = owner.control = root
            owner.bundle = root / 'inert.app'
            owner.store = root / 'store.db'
            owner.output = root / 'native.json'
            owner.environment = dict(MODELS_DEV_URL='http://fixture/models-dev')
            owner.observer = root / 'inert-observer'
            owner.fetch_nonce = 'inert-nonce'
            owner.checks, owner.commands = [], []
            owner.saved_configuration = None
            owner.deadline = action_deadline
            owner.identity = owner.engine_pid = None
            clock = [0.0]
            calls = []
            identity = dict(pid=17, launch_time=1)
            state = dict(apps=[identity], frontmost=identity)

            def record(_path):
                if clock[0] < pending_after:
                    return {}
                return dict(profile_open_pending=not (root / 'profile-open-release').exists(),
                            profile_open_timeout=hold_expired, app_pid=17, engine_pid=18,
                            endpoint='http://engine', bridge=dict(ready=True))

            def request(endpoint, route, *, timeout):
                calls.append(('store', clock[0], timeout))
                self.assertEqual((endpoint, route), ('http://engine', '/store'))
                clock[0] += store_seconds
                return dict(store_path=str(owner.store))

            def seed(endpoint, provider, environment, deadline, existing, *, nonce):
                calls.append(('seed', clock[0], deadline))
                q1._remaining(deadline, 4)
                clock[0] += seed_seconds
                q1._remaining(deadline, 4)
                return dict(api_key_env='saved-selector', config_id='fixture-id', name='fixture')

            original_guard = owner.guard
            def guard():
                original_guard()
                if (root / 'storage-q1-fetch.json').exists():
                    clock[0] += release_guard_seconds

            launcher = Mock()
            launcher.wait.return_value = 0
            launcher.poll.return_value = 0
            ready = error = None
            with patch.object(q1.time, 'monotonic', side_effect=lambda: clock[0]), \
                    patch.object(q1.time, 'sleep', side_effect=lambda seconds: clock.__setitem__(0, clock[0] + seconds)), \
                    patch.object(q1, 'require_console'), \
                    patch.object(q1.subprocess, 'Popen', return_value=launcher), \
                    patch.object(owner, 'state', return_value=state), \
                    patch.object(owner, 'guard', side_effect=guard), \
                    patch.object(q1, 'read_record', side_effect=record), \
                    patch.object(q1, 'request', side_effect=request), \
                    patch.object(q1, 'seed_q1_configuration', side_effect=seed), \
                    patch.object(q1, 'engine_settled', return_value=False):
                try:
                    ready = owner.launch()
                except (TimeoutError, ValueError) as caught:
                    error = caught
                finally:
                    if owner.log is not None:
                        owner.log.close()
            launcher.terminate.assert_not_called()
            return dict(ready=ready, error=error, calls=calls, elapsed=clock[0],
                        released=(root / 'profile-open-release').exists(),
                        binding=(root / 'storage-q1-fetch.json').exists(),
                        deadline=owner.deadline)

    def test_engine_readiness_after_five_seconds_uses_original_startup_budget(self):
        result = self.launch()
        self.assertIsNone(result['error'])
        self.assertTrue(result['ready']['bridge']['ready'])
        self.assertTrue(result['released'])
        self.assertGreaterEqual(result['elapsed'], 6)
        self.assertLess(result['elapsed'], 30)
        self.assertEqual(result['deadline'], 100)

    def test_store_and_seed_share_one_four_second_budget(self):
        result = self.launch(store_seconds=3, seed_seconds=2)
        self.assertIsInstance(result['error'], TimeoutError)
        self.assertFalse(result['binding'])
        self.assertFalse(result['released'])
        store, seed = result['calls']
        self.assertAlmostEqual(seed[2], store[1] + 4)

    def test_slow_release_guard_cannot_publish_after_the_seed_deadline(self):
        result = self.launch(release_guard_seconds=4)
        self.assertIsInstance(result['error'], TimeoutError)
        self.assertTrue(result['binding'])
        self.assertFalse(result['released'])

    def test_startup_and_original_action_deadlines_are_not_reset(self):
        for options in (dict(pending_after=31), dict(action_deadline=6.1)):
            with self.subTest(options=options):
                result = self.launch(**options)
                self.assertIsInstance(result['error'], TimeoutError)
                self.assertFalse(result['released'])

    def test_native_expiry_is_rejected_before_store_or_configuration_requests(self):
        result = self.launch(hold_expired=True)
        self.assertIsInstance(result['error'], ValueError)
        self.assertEqual(result['calls'], [])
        self.assertFalse(result['released'])


if __name__ == '__main__':
    unittest.main()
