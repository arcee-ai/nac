"""Synthetic OS records exercise the owner; no app/process signal is issued."""
import copy
import ctypes
import errno
import signal
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from ci_startup_owner import BSDInfo, OwnerWitness, identity, native_identity


class StartupOwnerTests(unittest.TestCase):
    def setUp(self):
        self.clock = 100.0
        self.sequence = 0
        self.config = {'app_path': '/private/nac342-xctest-unit/NAC.app', 'fixture_root': '/private/nac342-xctest-unit',
                       'environment': {'HOME': '/private/owned home', 'NAC_HOME': '/private/owned home/nac'},
                       'child_environment': {'HOME': '/private/owned home', 'NAC_HOME': '/private/owned home/nac'},
                       'scenario': 'onboarding', 'native_sha256': 'a' * 64}
        self.owner = OwnerWitness(self.config, 'b' * 64, uid=501, clock=lambda: self.clock)

    def ready(self):
        self.sequence += 1
        self.owner.observe({'schema': 'nac342-owner-v1', 'event': 'ready', 'nodes': [],
                            'complete': True, 'retired': [], 'enumerated_exits': [],
                            'observed_uptime_ns': str(int(self.clock * 1e9) + self.sequence),
                            'configuration_sha256': 'b' * 64})

    def node(self, kind, pid, parent, **changes):
        executable = self.config['app_path'] + ('/Contents/MacOS/NACPreview' if kind == 'app' else '/Contents/Resources/nac-web')
        node = {'pid': pid, 'parent': parent, 'uid': 501, 'start_seconds': 1234, 'start_microseconds': pid,
                'executable': executable, 'kind': kind, 'environment': copy.deepcopy(self.config['environment']),
                'arguments_sha256': 'c' * 64, 'serving': kind == 'engine', 'configuration_helper': False,
                'environment_role': 'launcher' if kind == 'app' else kind}
        if kind == 'app':
            node.update(app_launch_epoch=1234.5, windows=[17])
        node.update(changes)
        return node

    def observe(self, nodes):
        self.sequence += 1
        # These synthetic fixtures explicitly assert positive exit for omitted
        # prior identities. Missing/ambiguous retirement is tested separately.
        retired = [{'identity': identity(node), 'proof': 'kill_zero_ESRCH'}
                   for pid, node in self.owner.history.items() if pid not in {row['pid'] for row in nodes}]
        self.owner.observe({'schema': 'nac342-owner-v1', 'nodes': nodes, 'complete': True,
                            'retired': retired, 'enumerated_exits': [],
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
        record = {'schema': 'nac342-owner-v1', 'nodes': [], 'complete': True, 'retired': [], 'enumerated_exits': []}
        self.owner.observe({**record, 'observed_uptime_ns': '100500000000'})
        self.assertEqual(self.owner.last_empty, 100.5)
        with self.assertRaises(RuntimeError):
            self.owner.observe({**record, 'observed_uptime_ns': '100500000000'})
        with self.assertRaises(RuntimeError):
            self.owner.observe({**record, 'observed_uptime_ns': '200000000000'})

    def test_empty_or_retired_identity_mismatch_does_not_erase_known_owners(self):
        self.ready()
        self.observe([self.node('app', 10, 1), self.node('engine', 11, 10)])
        prior = copy.deepcopy(self.owner.latest)
        for retired in ([], [{'identity': {**identity(prior[0]), 'start_microseconds': 999}, 'proof': 'kill_zero_ESRCH'}],
                        [{'identity': identity(node), 'proof': 'path_lookup_failed'} for node in prior]):
            self.sequence += 1
            with self.assertRaises(RuntimeError):
                self.owner.observe({'schema': 'nac342-owner-v1', 'complete': True, 'nodes': [], 'retired': retired,
                    'enumerated_exits': [], 'observed_uptime_ns': str(int(self.clock * 1e9) + self.sequence)})
            self.assertEqual(self.owner.latest, prior)
            self.assertFalse(self.owner.failure_receipt()['positive_settlement'])
        self.owner.wait_empty = Mock(return_value=True)
        with self.assertRaises(RuntimeError):
            self.owner.settle(100)

    def libc(self, *, failure=None, changed=None):
        calls = {'bsd': 0, 'path': 0}
        def bsd(pid, flavor, argument, pointer, size):
            calls['bsd'] += 1
            if failure and failure[0] == 'bsd':
                ctypes.set_errno(failure[1])
                return 0
            value = ctypes.cast(pointer, ctypes.POINTER(BSDInfo)).contents
            value.pid, value.parent, value.uid = pid, 50, 501
            value.start_seconds, value.start_microseconds = 1234, 1
            if changed and calls['bsd'] == 2:
                for key, item in changed.items():
                    if key != 'executable':
                        setattr(value, key, item)
            return size
        def path(pid, buffer, size):
            calls['path'] += 1
            if failure and failure[0] == 'path':
                ctypes.set_errno(failure[1])
                return 0
            value = changed.get('executable') if changed and calls['path'] == 2 else None
            buffer.value = value or b'/private/owned/NAC.app/Contents/Resources/nac-web'
            return len(buffer.value)
        return SimpleNamespace(proc_pidinfo=Mock(side_effect=bsd), proc_pidpath=Mock(side_effect=path))

    def test_python_kernel_probe_never_maps_denied_or_other_lookup_errors_to_exit(self):
        for stage in ('bsd', 'path'):
            for error in (errno.EACCES, errno.EPERM, errno.EIO, errno.ESRCH):
                with self.subTest(stage=stage, error=error), \
                        patch('ci_startup_owner.ctypes.CDLL', return_value=self.libc(failure=(stage, error))), \
                        patch('ci_startup_owner.os.getuid', return_value=501), \
                        patch('ci_startup_owner.os.kill', return_value=None) as probe, self.assertRaises(RuntimeError):
                    native_identity(123)
                probe.assert_called_once_with(123, 0)
        with patch('ci_startup_owner.ctypes.CDLL', return_value=self.libc(failure=('path', errno.EIO))), \
                patch('ci_startup_owner.os.getuid', return_value=501), \
                patch('ci_startup_owner.os.kill', side_effect=PermissionError()), self.assertRaises(PermissionError):
            native_identity(123)

    def test_python_kernel_probe_retires_only_after_independent_positive_absence(self):
        for stage in ('bsd', 'path'):
            with self.subTest(stage=stage), \
                    patch('ci_startup_owner.ctypes.CDLL', return_value=self.libc(failure=(stage, errno.EIO))), \
                    patch('ci_startup_owner.os.getuid', return_value=501), \
                    patch('ci_startup_owner.os.kill', side_effect=ProcessLookupError()) as probe:
                self.assertIsNone(native_identity(123))
            probe.assert_called_once_with(123, 0)

    def test_python_kernel_probe_bookends_start_path_uid_and_parent_before_signaling(self):
        for changed in ({'start_microseconds': 999}, {'executable': b'/foreign'}, {'uid': 999}, {'parent': 700},
                        {'start_seconds': 0}, {'start_microseconds': 1000000}):
            with self.subTest(changed=changed), \
                    patch('ci_startup_owner.ctypes.CDLL', return_value=self.libc(changed=changed)), \
                    patch('ci_startup_owner.os.getuid', return_value=501), \
                    patch('ci_startup_owner.os.kill') as probe, self.assertRaises(RuntimeError):
                native_identity(123)
            probe.assert_not_called()
        with patch('ci_startup_owner.ctypes.CDLL', return_value=self.libc()), \
                patch('ci_startup_owner.os.getuid', return_value=501), patch('ci_startup_owner.os.kill') as probe:
            self.assertEqual(native_identity(123)['start_microseconds'], 1)
        probe.assert_not_called()


if __name__ == '__main__':
    unittest.main()
