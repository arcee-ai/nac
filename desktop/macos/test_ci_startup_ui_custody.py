"""Actual owner/caller controls using inert records and explicit signal ports."""
import copy
import json
import signal
import unittest
from unittest.mock import Mock, patch

import test_ci_startup_owner as owner_fixtures
import test_ci_startup_stream_diagnostics as stream_fixtures
from ci_startup_audit import LiveAudit
from ci_startup_ax import AXCompanion
from ci_startup_owner import identity


class UICustodyControls(unittest.TestCase):
    setUp = owner_fixtures.StartupOwnerTests.setUp
    ready = owner_fixtures.StartupOwnerTests.ready
    node = owner_fixtures.StartupOwnerTests.node
    observe = owner_fixtures.StartupOwnerTests.observe

    def admitted(self):
        self.ready()
        app, engine = self.node('app', 10, 1), self.node('engine', 11, 10)
        self.observe([app, engine])
        return app, engine

    def test_extra_window_keeps_process_custody_but_never_restores_ui(self):
        app, engine = self.admitted()
        child = self.node('descendant', 12, 11, executable='/owned/child')
        self.observe([{**app, 'windows': [17, 18]}, engine, child])
        self.assertEqual(set(self.owner.history), {10, 11, 12})
        self.assertEqual(self.owner.failure, 'app_windows')
        self.assertIsNone(self.owner.process_failure)
        self.observe([app, engine, child])
        self.assertEqual(self.owner.failure, 'app_windows')
        self.assertEqual(self.owner.ui_root, 17)
        with self.assertRaises(RuntimeError): self.owner.attachment_binding()
        with patch('ci_startup_audit.owned_listener') as listener, patch('ci_startup_audit.request') as request:
            audit = LiveAudit(self.owner, self.config, None)
            with self.assertRaises(RuntimeError): audit.sample()
            listener.assert_not_called(); request.assert_not_called()
        # Initial AX readiness remains denied without creating its thread.
        companion = AXCompanion(self.owner, {'ax_witness': {}}, None, None, None, Mock())
        with patch('ci_startup_ax.threading.Thread') as thread, self.assertRaises(RuntimeError): companion.start()
        thread.assert_not_called()
        self.clock = 101.
        self.observe([])
        self.owner.wait_empty = Mock(return_value=True)  # Inert fresh-observation wait port.
        settled = self.owner.settle(101.)
        self.assertTrue(settled['owned_processes_settled'])
        self.assertEqual(settled['ui_failure'], 'app_windows')
        self.assertEqual(len(settled['retired_identities']), 3)
        receipt = self.owner.failure_receipt()
        self.assertTrue(receipt['positive_process_settlement'])
        self.assertFalse(receipt['positive_settlement'])
        self.assertEqual(receipt['failure'], 'app_windows')

    def test_root_is_pinned_and_later_singleton_never_rebinds(self):
        for later in ([18], [17, 18], []):
            with self.subTest(later=later):
                self.setUp(); app, engine = self.admitted()
                self.observe([{**app, 'windows': later}, engine])
                self.assertEqual(self.owner.ui_root, 17)
                self.assertEqual(self.owner.app['windows'], [17])
                self.observe([{**app, 'windows': [18]}, engine])
                self.assertIsNotNone(self.owner.failure)
                self.assertEqual(self.owner.ui_root, 17)
                with self.assertRaises(RuntimeError): self.owner.attachment_binding()

    def test_initial_nonunique_inventory_cannot_pin_a_later_root(self):
        self.ready(); app = self.node('app', 10, 1)
        self.observe([{**app, 'windows': [17, 18]}])
        self.assertIsNone(self.owner.ui_root)
        self.observe([app])
        self.assertIsNone(self.owner.ui_root)
        self.assertEqual(self.owner.failure, 'app_windows')

    def test_retirement_is_terminal_for_live_api_and_ready_even_if_root_reappears(self):
        app, engine = self.admitted()
        self.observe([{**app, 'windows': []}, engine])
        self.assertTrue(self.owner.ui_terminal)
        with patch('ci_startup_audit.owned_listener') as listener, patch('ci_startup_audit.request') as request:
            with self.assertRaises(RuntimeError): LiveAudit(self.owner, self.config, None).sample()
            listener.assert_not_called(); request.assert_not_called()
        companion = AXCompanion(self.owner, {'ax_witness': {}}, None, None, None, Mock())
        with patch('ci_startup_ax.threading.Thread') as thread, self.assertRaises(RuntimeError): companion.start()
        thread.assert_not_called()
        self.observe([app, engine])
        self.assertTrue(self.owner.ui_terminal)
        self.assertEqual(self.owner.failure, 'app_window_reappeared')
        self.assertEqual(self.owner.ui_root, 17)

    def test_unsettled_metadata_reader_never_proves_helper_custody(self):
        self.owner.process = Mock()
        self.owner.process.poll.return_value = 0
        self.owner.reader = Mock()
        self.owner.reader.is_alive.return_value = True
        with self.assertRaises(RuntimeError): self.owner.stop()
        self.assertFalse(self.owner.failure_receipt()['metadata_helper_settled'])
        self.owner.process.terminate.assert_not_called()
        self.owner.process.kill.assert_not_called()
        self.owner.reader.join.assert_called_once_with(timeout=3)

    def test_ui_failure_does_not_authorize_unknown_or_rejected_signal_targets(self):
        app, engine = self.admitted()
        self.observe([{**app, 'windows': [17, 18]}, engine])
        send, inspect = Mock(), Mock(return_value=app)
        for node in (self.node('descendant', 99, 10, executable='/owned/child'),
                     {**app, 'start_microseconds': 99}, {**app, 'parent': 800}):
            with self.subTest(node=node), self.assertRaises(RuntimeError):
                self.owner.signal_owned(node, signal.SIGTERM, inspect=inspect, send=send)
        inspect.assert_not_called(); send.assert_not_called()
        for actual in ({**app, 'start_seconds': 99}, {**app, 'start_microseconds': 99},
                       {**app, 'executable': '/foreign'}, {**app, 'uid': 999}, {**app, 'parent': 800}):
            with self.subTest(actual=actual), self.assertRaises(RuntimeError):
                self.owner.signal_owned(app, signal.SIGTERM, inspect=lambda _: actual, send=send)
            send.assert_not_called()
        with self.assertRaises(PermissionError):
            self.owner.signal_owned(app, signal.SIGTERM, inspect=Mock(side_effect=PermissionError()), send=send)
        send.assert_not_called()
        self.owner.signal_owned(app, signal.SIGTERM, inspect=lambda _: None, send=send)
        send.assert_not_called()
        self.owner.signal_owned(app, signal.SIGTERM, inspect=lambda _: app, send=send)
        send.assert_called_once_with(10, signal.SIGTERM)
        self.assertEqual(self.owner.failure, 'app_windows')
        self.owner.process_failure = 'owner_stream_unavailable'
        inspect.reset_mock(); send.reset_mock()
        with self.assertRaises(RuntimeError): self.owner.signal_owned(app, 9, inspect=inspect, send=send)
        inspect.assert_not_called(); send.assert_not_called()
        with self.assertRaises(RuntimeError): self.owner.settle(100.)


class StreamCustodyControls(unittest.TestCase):
    setUp = stream_fixtures.StreamDiagnosticsTests.setUp
    read = stream_fixtures.StreamDiagnosticsTests.read

    def row(self, stamp, **changes):
        return {**copy.deepcopy(self.record), 'observed_uptime_ns': str(stamp), **changes}

    def payload(self, *rows):
        return b''.join((json.dumps(row) + '\n').encode() for row in rows)

    def test_same_preinstalled_reader_continues_after_ui_loss_to_full_retirement(self):
        extra = self.row(99700000000); extra['nodes'][0]['windows'] = [17, 18]
        later = self.row(99800000000)
        empty = self.row(99900000000, nodes=[], retired=[
            {'identity': identity(node), 'proof': 'kill_zero_ESRCH'} for node in later['nodes']])
        result = self.read(self.payload(extra, later, empty), healthy=True, expect_failure=True)
        self.assertIsNone(result['process_failure'])
        self.assertEqual(result['failure'], 'app_windows')
        self.assertTrue(result['positive_process_settlement'])
        self.assertFalse(result['positive_settlement'])
        self.assertEqual(result['latest_pids'], [])
        self.assertEqual(len(result['retired']), 2)
        self.assertEqual(self.owner.last_accepted_uptime_ns, 99900000000)
        self.assertTrue(result['metadata_helper_settled'])
        self.owner.wait_empty = Mock(return_value=True)
        self.assertTrue(self.owner.settle(99.9)['owned_processes_settled'])
        self.assertEqual(self.owner.ui_root, 17)
        with self.assertRaises(RuntimeError): self.owner.attachment_binding()

    def test_ui_policy_is_never_committed_from_a_rejected_process_record(self):
        rejected = self.row(99700000000)
        rejected['nodes'][0]['windows'] = [18, 19]
        rejected['nodes'][1]['uid'] = 999
        result = self.read(self.payload(rejected), healthy=True, expect_failure=True)
        self.assertEqual(result['failure'], 'owner_stream_unavailable')
        self.assertIsNone(result['ui_failure'])
        self.assertEqual(self.owner.ui_root, 17)
        self.assertEqual(self.owner.latest[0]['windows'], [17])
        self.assertEqual(self.owner.last_accepted_uptime_ns, 99500000000)

    def test_invalid_process_record_after_ui_loss_stops_custody_atomically_and_denies_all_signals(self):
        def bad_environment(row): row['nodes'][1]['environment'] = {'HOME': '/foreign'}
        def bad_generation(row): row['nodes'][1]['start_microseconds'] += 1
        def bad_uid(row): row['nodes'][1]['uid'] = 999
        def bad_path(row): row['nodes'][1]['executable'] = '/foreign/nac-web'
        def bad_ancestry(row):
            row['nodes'].append({**row['nodes'][1], 'pid': 13, 'parent': 999})
        def omitted_child(row): row['nodes'] = []
        def bad_retirement(row):
            row['nodes'] = []; row['retired'] = [{'identity': identity(n), 'proof': 'bsd_denied'} for n in self.record['nodes']]
        def duplicate_window(row): row['nodes'][0]['windows'] = [17, 17]
        def stale(row): row['observed_uptime_ns'] = '99700000000'
        def incomplete(row): row['complete'] = False
        for change in (bad_environment, bad_generation, bad_uid, bad_path, bad_ancestry,
                       omitted_child, bad_retirement, duplicate_window, stale, incomplete):
            with self.subTest(change=change.__name__):
                self.setUp()
                extra = self.row(99700000000); extra['nodes'][0]['windows'] = [17, 18]
                rejected = self.row(99800000000); change(rejected)
                # A valid fresh descendant earlier in this rejected record must
                # not leak into history when a later node fails validation.
                if rejected['nodes']:
                    child = {**self.record['nodes'][1], 'pid': 12, 'parent': 10, 'kind': 'descendant',
                        'serving': False, 'environment_role': 'descendant', 'executable': '/owned/child'}
                    rejected['nodes'].insert(0, child)
                result = self.read(self.payload(extra, rejected), healthy=True, expect_failure=True)
                self.assertEqual(result['failure'], 'app_windows')
                self.assertEqual(result['process_failure'], 'owner_stream_unavailable')
                self.assertEqual(set(self.owner.history), {10, 11})
                self.assertEqual(self.owner.last_accepted_uptime_ns, 99700000000)
                self.assertEqual(self.owner.latest[0]['windows'], [17, 18])
                self.assertFalse(result['positive_process_settlement'])
                send, inspect = Mock(), Mock()
                for node in self.owner.latest:
                    with self.assertRaises(RuntimeError): self.owner.signal_owned(node, 15, inspect=inspect, send=send)
                inspect.assert_not_called(); send.assert_not_called()
                with self.assertRaises(RuntimeError): self.owner.settle(100.)


class CompanionCustodyControls(unittest.TestCase):
    def exercise(self, owner_change=None):
        from pathlib import Path
        from types import SimpleNamespace
        import tempfile
        with tempfile.TemporaryDirectory(prefix='nac-ui-custody-inert-') as temporary:
            root = Path(temporary).resolve()
            declaration = {'path': str(root / 'receipt.json'), 'nonce': 'a' * 64, 'helper_sha256': 'b' * 64}
            owner = AXCompanion(SimpleNamespace(ui_failure=None, process_failure=None), {'ax_witness': declaration}, root / 'config', root / 'helper', root, Mock())
            owner.thread = Mock()
            owner.thread.is_alive.return_value = False
            owner.identity = {'pid': 12, 'parent': 1, 'uid': 501, 'start_seconds': 1,
                'start_microseconds': 2, 'executable': '/inert/helper'}
            primary = RuntimeError('inert primary UI companion error')
            owner.error = primary
            row = dict(accepted=True, pid=12, reaped=True, drain_settled=True, unknown=False, teardown_error=None)
            if owner_change: row.update(owner_change)
            (root / 'ax-companion.log.ownership.json').write_text(json.dumps(row))
            with self.assertRaises(RuntimeError) as raised: owner.stop()
            self.assertIs(raised.exception, primary)
            owner.thread.join.assert_called_once()
            self.assertEqual(owner.failure, 'ax_companion_unavailable')
            return owner.settlement

    def test_helper_error_and_positive_handle_custody_remain_separate(self):
        self.assertTrue(self.exercise()['owned_processes_settled'])

    def test_helper_unknown_denied_or_unreaped_handle_never_gains_custody_from_ui_error(self):
        for change in ({'accepted': False}, {'reaped': False}, {'drain_settled': False},
                       {'unknown': True}, {'teardown_error': 'inert failure'}, {'pid': 999}, {'pid': True},
                       {'accepted': 'true'}, {'reaped': 1}, {'drain_settled': 1}, {'unknown': 0}):
            with self.subTest(change=change): self.assertIsNone(self.exercise(change))


class QualificationFailureControls(unittest.TestCase):
    def test_failed_case_never_advances_and_keeps_primary_through_final_verification_fault(self):
        from contextlib import ExitStack
        from pathlib import Path
        import tempfile
        from ci_startup import qualify
        primary = RuntimeError('inert failed UI case after positive cleanup')
        with tempfile.TemporaryDirectory(prefix='nac-ui-qualification-inert-') as temporary, ExitStack() as stack:
            root = Path(temporary).resolve()
            profiles = root / 'owned-profiles'; profiles.mkdir()
            final_error = OSError('inert final package verification fault')
            calls = []
            def run(argv, log, *args, **kwargs):
                calls.append(log.name)
                if log.name == 'startup-package-after-ui.log': raise final_error
            replacements = {'require_checkout': Mock(), 'test_contract': Mock(), 'protocol_sources': Mock(),
                'build_protocol': Mock(return_value=(root, {})), 'verify_protocol': Mock(return_value={}),
                'materialize_project': Mock(return_value={}), 'observer_sources': Mock(return_value=[]),
                'digest': Mock(return_value='a' * 64), 'run_case': Mock(side_effect=primary)}
            for name, value in replacements.items(): stack.enter_context(patch('ci_startup.' + name, value))
            stack.enter_context(patch('ci_startup.tempfile.mkdtemp', return_value=str(profiles)))
            with self.assertRaises(RuntimeError) as raised:
                qualify(root, root, root, root, 'b' * 40, run, Mock(), Mock())
            self.assertIs(raised.exception, primary)
            self.assertIs(raised.exception.__cause__, final_error)
            replacements['run_case'].assert_called_once()
            self.assertEqual(replacements['run_case'].call_args.args[2], 'onboarding')
            self.assertEqual(calls[-1], 'startup-package-after-ui.log')
            self.assertFalse(profiles.exists())
