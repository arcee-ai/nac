"""Synthetic OS records exercise the owner; no app/process signal is issued."""
import copy
import ctypes
import signal
import unittest
from unittest.mock import Mock

from ci_startup_owner import BSDInfo, OwnerWitness


class StartupOwnerTests(unittest.TestCase):
    def setUp(self):
        self.clock = 100.0
        self.sequence = 0
        self.config = {'app_path': '/private/nac342-xctest-unit/NAC.app', 'fixture_root': '/private/nac342-xctest-unit',
                       'environment': {'HOME': '/private/owned home', 'NAC_HOME': '/private/owned home/nac'},
                       'scenario': 'onboarding', 'native_sha256': 'a' * 64}
        self.owner = OwnerWitness(self.config, 'b' * 64, uid=501, clock=lambda: self.clock)

    def ready(self):
        self.sequence += 1
        self.owner.observe({'schema': 'nac342-owner-v1', 'event': 'ready', 'nodes': [],
                            'observed_uptime_ns': str(int(self.clock * 1e9) + self.sequence),
                            'configuration_sha256': 'b' * 64})

    def node(self, kind, pid, parent, **changes):
        executable = self.config['app_path'] + ('/Contents/MacOS/NACPreview' if kind == 'app' else '/Contents/Resources/nac-web')
        node = {'pid': pid, 'parent': parent, 'uid': 501, 'start_seconds': 1234, 'start_microseconds': pid,
                'executable': executable, 'kind': kind, 'environment': copy.deepcopy(self.config['environment']),
                'arguments_sha256': 'c' * 64, 'serving': kind == 'engine', 'configuration_helper': False}
        if kind == 'app':
            node.update(app_launch_epoch=1234.5, windows=[17])
        node.update(changes)
        return node

    def observe(self, nodes):
        self.sequence += 1
        self.owner.observe({'schema': 'nac342-owner-v1', 'nodes': nodes,
                            'observed_uptime_ns': str(int(self.clock * 1e9) + self.sequence)})

    def test_preinstall_live_parentage_incarnation_and_fresh_empty_are_distinct(self):
        app, engine = self.node('app', 10, 1), self.node('engine', 11, 10)
        with self.assertRaises(RuntimeError):
            self.observe([app, engine])
        self.ready()
        self.observe([{**app, 'windows': []}])
        with self.assertRaises(RuntimeError):
            self.owner.attachment_binding()
        self.observe([app, engine])
        binding = self.owner.attachment_binding()
        self.assertEqual(binding['app_pid'], 10)
        self.assertEqual(binding['app_launch_epoch'], 1234.5)
        self.assertEqual(binding['window_number'], 17)
        self.assertTrue(binding['preinstalled'])
        self.assertTrue(self.owner.serving_observed)
        self.clock = 101.0
        self.observe([])
        self.assertAlmostEqual(self.owner.last_empty, 101.0)
        self.assertEqual(len(self.owner.history), 2)
        self.assertEqual(self.owner.attachment_binding(), binding)

    def test_foreign_or_ambiguous_os_records_never_become_owned_history(self):
        app, engine = self.node('app', 10, 1), self.node('engine', 11, 10)
        self.ready()
        for nodes in ([{**engine, 'parent': 1}], [{**app, 'executable': '/foreign/NACPreview'}],
                      [{**app, 'uid': 999}], [app, app], [{**app, 'windows': [17, 18]}],
                      [{**app, 'pid': True}], [{**app, 'unexpected': 'FOREIGN-SECRET'}],
                      [{**app, 'environment': {'HOME': '/personal'}}]):
            with self.subTest(nodes=nodes), self.assertRaises(RuntimeError):
                self.observe(nodes)
            self.assertEqual(self.owner.history, {})

    def test_reparented_survivor_requires_prior_positive_identity(self):
        self.ready()
        app, engine = self.node('app', 10, 1), self.node('engine', 11, 10)
        self.observe([app, engine])
        self.observe([{**engine, 'parent': 1}])
        self.assertEqual(self.owner.latest[0]['pid'], 11)
        with self.assertRaises(RuntimeError):
            self.observe([{**engine, 'parent': 1, 'start_microseconds': 999}])
        with self.assertRaises(RuntimeError):
            self.observe([{**engine, 'parent': 400}])

    def test_signals_require_fresh_kernel_generation_and_path_not_just_json_pid(self):
        self.ready()
        app = self.node('app', 10, 1)
        self.observe([app])
        send = Mock()
        for actual in ({**app, 'start_microseconds': 999}, {**app, 'executable': '/foreign'},
                       {**app, 'uid': 502}, {**app, 'parent': 700}):
            with self.subTest(actual=actual), self.assertRaises(RuntimeError):
                self.owner.signal_owned(app, signal.SIGTERM, inspect=lambda pid: actual, send=send)
            send.assert_not_called()
        self.owner.signal_owned(app, signal.SIGTERM, inspect=lambda pid: None, send=send)
        send.assert_not_called()
        self.owner.signal_owned(app, signal.SIGTERM, inspect=lambda pid: app, send=send)
        send.assert_called_once_with(10, signal.SIGTERM)
        self.assertTrue(self.owner.signals[0]['kernel_identity_rechecked'])

    def test_unknown_or_failed_observer_never_proves_settlement(self):
        self.ready()
        self.owner.wait_empty = Mock(return_value=True)
        with self.assertRaises(RuntimeError):
            self.owner.settle(100)
        self.observe([self.node('app', 10, 1)])
        with self.assertRaises(RuntimeError):
            self.owner.settle(100)  # No serving-engine observation for a normal case.
        self.observe([self.node('app', 10, 1), self.node('engine', 11, 10)])
        self.observe([])
        self.assertTrue(self.owner.settle(100)['owned_processes_settled'])
        self.owner.failure = 'owner_stream_unavailable'
        with self.assertRaises(RuntimeError):
            self.owner.settle(100)

    def test_kernel_bsd_layout_matches_the_pinned_darwin_header_contract(self):
        self.assertEqual(ctypes.sizeof(BSDInfo), 136)
        self.assertEqual(BSDInfo.start_seconds.offset, 120)
        self.assertEqual(BSDInfo.start_microseconds.offset, 128)

    def test_buffered_empty_observation_does_not_gain_the_receivers_later_time(self):
        self.ready()
        self.clock = 105.0
        self.owner.observe({'schema': 'nac342-owner-v1', 'nodes': [], 'observed_uptime_ns': '100500000000'})
        self.assertEqual(self.owner.last_empty, 100.5)
        with self.assertRaises(RuntimeError):
            self.owner.observe({'schema': 'nac342-owner-v1', 'nodes': [], 'observed_uptime_ns': '100500000000'})
        with self.assertRaises(RuntimeError):
            self.owner.observe({'schema': 'nac342-owner-v1', 'nodes': [], 'observed_uptime_ns': '200000000000'})


if __name__ == '__main__':
    unittest.main()
