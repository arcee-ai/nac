"""F1 owner-level controls: mocks only, no app/engine/provider/UI execution."""
import json
import io
from contextlib import nullcontext
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import instance_smoke
from instance_smoke import AppJourney, app_crash_case, coexist_case, conflict_case, workspace_case


class InstanceCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.case = self.root / 'case'
        self.case.mkdir()
        self.app = self.root / 'dev.app'
        self.observer = self.root / 'observer'
        self.primary = RuntimeError('primary operation failed')
        self.retirement = ValueError('capture retirement failed')

    def errors(self, error):
        records = getattr(error, 'instance_cleanup_errors', [])
        self.assertTrue(records, 'Cleanup failures need structured retained evidence')
        self.assertTrue(all(set(r) >= {'owner', 'type', 'message'} for r in records))
        return records

    def test_conflict_retirement_failure_preserves_primary_and_closes_cli(self):
        journey, owner = Mock(), Mock()
        journey.launch.side_effect = self.primary
        journey.cleanup.side_effect = self.retirement
        with patch('instance_smoke.environment', return_value={}), patch('instance_smoke.require_console'), \
                patch('instance_smoke.OwnedEngine', return_value=owner), patch('instance_smoke.snapshot', return_value={}), \
                patch('instance_smoke.AppJourney', return_value=journey):
            with self.assertRaises(RuntimeError) as caught:
                conflict_case('cli', self.app, self.case, self.root, self.observer, [])
        owner.close.assert_called_once_with()
        self.assertIs(caught.exception, self.primary)
        self.assertIn('capture retirement failed', [r['message'] for r in self.errors(caught.exception)])

    def test_conflict_barrier_and_journey_errors_do_not_skip_later_owners(self):
        journey, owner, barrier = Mock(), Mock(), Mock()
        journey.launch.side_effect = self.primary
        barrier.close.side_effect = OSError('barrier close failed')
        journey.cleanup.side_effect = self.retirement
        owner.close.side_effect = TimeoutError('CLI close unproved')
        with patch('instance_smoke.environment', return_value={}), patch('instance_smoke.require_console'), \
                patch('instance_smoke.OwnedEngine', return_value=owner), patch('instance_smoke.snapshot', return_value={}), \
                patch('instance_smoke.drain_barrier', return_value=barrier), patch('instance_smoke.AppJourney', return_value=journey):
            with self.assertRaises(RuntimeError) as caught:
                conflict_case('shutdown', self.app, self.case, self.root, self.observer, [])
        barrier.close.assert_called_once_with()
        journey.cleanup.assert_called_once_with()
        owner.close.assert_called_once_with()
        self.assertIs(caught.exception, self.primary)
        self.assertEqual([r['message'] for r in self.errors(caught.exception)],
                         ['barrier close failed', 'capture retirement failed', 'CLI close unproved'])

    def test_coexist_failure_attempts_both_journeys_in_original_reverse_order(self):
        first, second = Mock(), Mock()
        second.stage.side_effect = self.primary
        events = []
        def retire_second():
            events.append('stable')
            raise self.retirement
        second.cleanup.side_effect = retire_second
        first.cleanup.side_effect = lambda: events.append('dev')
        with patch('instance_smoke.environment', return_value={}), \
                patch('instance_smoke.subprocess.check_output', side_effect=[b'{"track":"dev"}', b'{"track":"stable"}']), \
                patch('instance_smoke.coexist_selection', side_effect=[self.root / 'dev.db', self.root / 'stable.db']), \
                patch('instance_smoke.AppJourney', side_effect=[first, second]):
            with self.assertRaises(RuntimeError) as caught:
                coexist_case(self.app, self.root / 'stable.app', self.case, self.root, self.observer, [])
        self.assertEqual(events, ['stable', 'dev'])
        self.assertIs(caught.exception, self.primary)
        self.assertIn('capture retirement failed', [r['message'] for r in self.errors(caught.exception)])

    def test_app_crash_failure_attempts_original_and_replacement_cleanup(self):
        first, second = Mock(), Mock()
        first.stage.return_value = {'engine_pid': 123, 'launch_incarnation': 'old', 'ready_store': 'owned'}
        first.prior = 'prior'
        first.identity = {'pid': 111, 'launch': 'first'}
        first.observe.return_value = {'apps': [], 'frontmost': first.prior}
        second.stage.side_effect = self.primary
        events = []
        def retire_second():
            events.append('replacement')
            raise self.retirement
        second.cleanup.side_effect = retire_second
        first.cleanup.side_effect = lambda: events.append('initial')
        with patch('instance_smoke.environment', return_value={}), \
                patch('instance_smoke.subprocess.check_output', return_value=b'{"termination_requested":true}'), \
                patch('instance_smoke.engine_settled', return_value=True), \
                patch('instance_smoke.AppJourney', side_effect=[first, second]):
            with self.assertRaises(RuntimeError) as caught:
                app_crash_case(self.app, self.case, self.root, self.observer, [])
        self.assertEqual(events, ['replacement', 'initial'])
        self.assertIs(caught.exception, self.primary)
        self.errors(caught.exception)

    def test_workspace_cleanup_failure_keeps_primary_operation(self):
        journey = Mock(command=['only-mocked-open'])
        journey.stage.side_effect = self.primary
        journey.cleanup.side_effect = self.retirement
        process = Mock()
        process.wait.return_value = 0
        process.poll.return_value = 0
        with patch('instance_smoke.environment', return_value={}), \
                patch('instance_smoke.AppJourney', return_value=journey), \
                patch('instance_smoke.subprocess.Popen', return_value=process):
            with self.assertRaises(RuntimeError) as caught:
                workspace_case(self.app, self.case, self.root, self.observer, [])
        self.assertIs(caught.exception, self.primary)
        journey.cleanup.assert_called_once_with()
        self.errors(caught.exception)

    def test_workspace_attempts_each_owned_open_handle_and_journey(self):
        journey = Mock(command=['only-mocked-open'])
        first, second = Mock(), Mock()
        first.wait.side_effect = self.primary
        first.poll.return_value = second.poll.return_value = None
        first.terminate.side_effect = OSError('first open cleanup failed')
        journey.cleanup.side_effect = self.retirement
        with patch('instance_smoke.environment', return_value={}), \
                patch('instance_smoke.AppJourney', return_value=journey), \
                patch('instance_smoke.subprocess.Popen', side_effect=[first, second]):
            with self.assertRaises(RuntimeError) as caught:
                workspace_case(self.app, self.case, self.root, self.observer, [])
        self.assertIs(caught.exception, self.primary)
        first.terminate.assert_called_once_with()
        second.terminate.assert_called_once_with()
        second.wait.assert_called_once_with(timeout=3)
        journey.cleanup.assert_called_once_with()
        self.assertEqual([r['message'] for r in self.errors(caught.exception)],
                         ['first open cleanup failed', 'capture retirement failed'])

    def test_drain_stream_close_failure_does_not_replace_primary_protocol_error(self):
        owner, stream = Mock(), Mock()
        owner.endpoint = 'http://127.0.0.1:12345'
        stream.recv.return_value = b'HTTP/1.1 500 failed\r\n\r\n'
        stream.close.side_effect = OSError('stream close failed')
        responses = [nullcontext(io.BytesIO(b'{"project_id":"owned"}')),
                     nullcontext(io.BytesIO(b'{"metadata":{"session_id":"owned"}}'))]
        with patch('instance_smoke.urllib.request.urlopen', side_effect=responses), \
                patch('instance_smoke.socket.create_connection', return_value=stream):
            with self.assertRaises(AssertionError) as caught:
                instance_smoke.drain_barrier(owner, self.root)
        stream.close.assert_called_once_with()
        owner.process.send_signal.assert_not_called()
        self.assertIn('500 failed', str(caught.exception))
        self.assertEqual([r['message'] for r in self.errors(caught.exception)], ['stream close failed'])

    def test_one_journey_attempts_engine_and_log_after_metadata_and_restore_fail(self):
        journey = object.__new__(AppJourney)
        journey.capture = Mock()
        journey.capture.retire.side_effect = self.retirement
        journey.restore_prior = Mock(side_effect=OSError('restore failed'))
        journey.observe = Mock(return_value={'apps': []})
        journey.identity, journey.bundle = None, self.app
        journey.output = self.root / 'result.json'
        journey.output.write_text(json.dumps({'engine_pid': 0}))
        journey.log = Mock()
        journey.log.close.side_effect = OSError('log close failed')
        with patch('instance_smoke.engine_settled', return_value=True) as settled:
            with self.assertRaises(ValueError) as caught:
                journey.cleanup()
        settled.assert_called_once_with(self.app, 0)
        journey.log.close.assert_called_once_with()
        self.assertIs(caught.exception, self.retirement)
        self.assertEqual([r['message'] for r in self.errors(caught.exception)],
                         ['capture retirement failed', 'restore failed', 'log close failed'])

    def test_successful_case_still_fails_cleanup_inside_callers_exception_handler(self):
        journey, owner = Mock(), Mock()
        owner.process.poll.return_value = None
        owner.process.pid = 123
        journey.stage.side_effect = [{'native_conflict': 'owned'}, {},
                                     {'ready_store': str(self.root / 'selected store.db'), 'base_url': 'unused'}]
        journey.finish.return_value = {}
        journey.cleanup.side_effect = self.retirement
        state = dict(schema=1, version=1, sidecars={})
        with patch('instance_smoke.environment', return_value={}), patch('instance_smoke.require_console'), \
                patch('instance_smoke.OwnedEngine', return_value=owner), patch('instance_smoke.snapshot', return_value=state), \
                patch('instance_smoke.verify_embedded_assets', return_value={}), patch('instance_smoke.AppJourney', return_value=journey):
            try:
                raise self.primary  # An unrelated caller exception is not this operation's primary.
            except RuntimeError:
                with self.assertRaises(ValueError) as caught:
                    conflict_case('cli', self.app, self.case, self.root, self.observer, [])
        self.assertIs(caught.exception, self.retirement)
        self.assertTrue(caught.exception.instance_cleanup_only)
        owner.close.assert_called_once_with()

    def test_summary_retains_primary_and_bounded_secondary_failures(self):
        instance_smoke.finish_instance_cleanup(self.primary, [('capture-retirement', self.retirement)])
        destination = self.root / 'summary-output'
        with patch.object(instance_smoke.sys, 'argv', ['instance_smoke.py', str(self.app), str(destination), str(self.observer)]), \
                patch.dict('os.environ', {}, clear=True), \
                patch('instance_smoke.subprocess.check_output', side_effect=['a' * 40, '']), \
                patch('instance_smoke.require_console', side_effect=self.primary):
            with self.assertRaises(RuntimeError) as caught:
                instance_smoke.main()
        self.assertIs(caught.exception, self.primary)
        summary = json.loads((destination / 'summary.json').read_text())
        self.assertFalse(summary['runtime_passed'])
        self.assertEqual(summary['operation_failure']['message'], str(self.primary))
        self.assertEqual(summary['cleanup_errors'][0]['message'], str(self.retirement))
        self.assertEqual(summary['cleanup_error_count'], 1)
        self.assertFalse(summary['cleanup_errors_truncated'])

    def test_secondary_report_bounds_retain_truthful_total_and_message_hash(self):
        failures = [('owner-' + str(index), ValueError('x' * 1000)) for index in range(40)]
        instance_smoke.finish_instance_cleanup(self.primary, failures)
        self.assertEqual(len(self.primary.instance_cleanup_errors), 32)
        self.assertEqual(self.primary.instance_cleanup_error_count, 40)
        self.assertTrue(all(len(r['message']) == 512 and r['message_bytes'] == 1000
                            and len(r['message_sha256']) == 64 for r in self.errors(self.primary)))


if __name__ == '__main__':
    unittest.main()
