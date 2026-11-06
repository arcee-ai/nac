"""Inert clock/launcher controls for the real Q1 pre-render handshake."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import storage_q1 as q1


class Q1HandshakeTests(unittest.TestCase):
    def launch(self, *, pending_after=6, store_seconds=.25, seed_seconds=.25,
               release_guard_seconds=0, action_deadline=100, hold_expired=False,
               post_seed_discards=0, post_seed_absent=False, expired_then_missing=False,
               changed_engine=False):
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
            seeded = [False]
            discarded = [post_seed_discards]
            post_seed_reads = [0]
            identity = dict(pid=17, launch_time=1)
            state = dict(apps=[identity], frontmost=identity)

            def record(_path, *, publication_changes):
                self.assertTrue(publication_changes)
                if clock[0] < pending_after:
                    return {}
                after_seed = seeded[0] and not (root / 'storage-q1-fetch.json').exists()
                if after_seed:
                    post_seed_reads[0] += 1
                    if post_seed_absent:
                        return {}
                    if discarded[0] > 0 or (expired_then_missing and post_seed_reads[0] > 1):
                        discarded[0] -= 1
                        raise q1.RecordPublicationChanged('inert atomic replacement')
                return dict(profile_open_pending=not (root / 'profile-open-release').exists(),
                            profile_open_timeout=hold_expired or (after_seed and expired_then_missing),
                            app_pid=17, engine_pid=19 if after_seed and changed_engine else 18,
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
                seeded[0] = True
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

    def test_post_seed_publication_discards_wait_within_original_hold_budget(self):
        result = self.launch(post_seed_discards=2)
        self.assertIsNone(result['error'])
        self.assertTrue(result['released'])
        self.assertAlmostEqual(result['elapsed'], result['calls'][0][1] + .25 + .25 + .1)
        self.assertEqual(result['deadline'], 100)

    def test_missing_post_seed_record_exhausts_original_budget_without_binding_or_release(self):
        result = self.launch(post_seed_absent=True)
        self.assertIsInstance(result['error'], TimeoutError)
        seed_deadline = result['calls'][1][2]
        self.assertAlmostEqual(result['elapsed'], seed_deadline)
        self.assertEqual(result['deadline'], seed_deadline)
        self.assertFalse(result['binding'])
        self.assertFalse(result['released'])

    def test_timeout_cannot_be_hidden_by_a_second_discarded_sample(self):
        result = self.launch(expired_then_missing=True)
        self.assertIsInstance(result['error'], ValueError)
        self.assertFalse(result['binding'])
        self.assertFalse(result['released'])

    def test_post_seed_complete_record_still_requires_the_original_engine(self):
        result = self.launch(changed_engine=True)
        self.assertIsInstance(result['error'], ValueError)
        self.assertFalse(result['binding'])
        self.assertFalse(result['released'])

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
