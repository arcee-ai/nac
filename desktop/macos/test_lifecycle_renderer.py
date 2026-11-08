"""Renderer-only outcome controls; no real engine, app, input or policy mutation."""
from pathlib import Path
import sqlite3
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from lifecycle_renderer import approval_origin, approval_state, DISCONNECTED_DENIAL, PROVIDER_PREFIX, verify_renderer_store


class RendererApprovalEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.origin = dict(request=dict(id='original-request', session_id='approval-session',
            call_id='quit-unapproved-command', tool='exec_command'), run_id='original-run',
            run_count=1, model_run_id='independent-model-run')
        self.permissions = dict(approval_mode='manual', grants=[], requests=[self.origin['request']])
        self.snapshot = dict(metadata=dict(session_id='approval-session'),
                             active_run=dict(run_id='original-run'))

    def state(self, permissions=None, snapshot=None, requests=None, outputs=None, run_count=1):
        return approval_state(self.origin, self.permissions if permissions is None else permissions,
            self.snapshot if snapshot is None else snapshot,
            PROVIDER_PREFIX if requests is None else requests, [] if outputs is None else outputs, run_count)

    def test_origin_reads_run_counter_from_public_summary_not_snapshot_metadata(self):
        fixture = SimpleNamespace(endpoint='http://inert', session='model',
                                  approval_session='approval-session', assert_work_running=Mock())
        rows = {'/sessions/approval-session/permissions': self.permissions,
                '/sessions/approval-session': self.snapshot,
                '/sessions': [{'summary': {'session_id': 'approval-session', 'run_count': 1}}],
                '/sessions/model': {'active_run': {'run_id': 'independent-model-run'}}}
        with patch('lifecycle_renderer.request', side_effect=lambda endpoint, path: rows[path]):
            self.assertEqual(approval_origin(fixture), self.origin)

    def denied(self):
        permissions = {**self.permissions, 'requests': []}
        snapshot = {**self.snapshot, 'active_run': None}
        return self.state(permissions, snapshot, PROVIDER_PREFIX + ['approval-denied'], [DISCONNECTED_DENIAL])

    def test_exact_original_pending_ask_has_no_disconnected_denial_claim(self):
        result = self.state()
        self.assertEqual(result['kind'], 'original-pending')
        self.assertFalse(result['disconnected_denial_observed'])

    def test_exact_once_same_run_disconnect_denial_is_a_distinct_outcome(self):
        result = self.denied()
        self.assertEqual(result['kind'], 'disconnected-denied')
        self.assertEqual(result['run_id'], self.origin['run_id'])
        self.assertEqual(result['request_id'], self.origin['request']['id'])

    def test_disappearance_and_mixed_transition_reads_do_not_prove_an_outcome(self):
        self.assertIsNone(self.state({**self.permissions, 'requests': []}))
        self.assertIsNone(self.state(self.permissions, {**self.snapshot, 'active_run': None}))
        self.assertIsNone(self.state(self.permissions, self.snapshot,
            PROVIDER_PREFIX + ['approval-denied'], [DISCONNECTED_DENIAL]))
        self.assertIsNone(self.state({**self.permissions, 'requests': []}, self.snapshot,
            PROVIDER_PREFIX + ['approval-denied'], [DISCONNECTED_DENIAL]))

    def test_foreign_request_run_session_or_admission_is_rejected(self):
        for permissions, snapshot in [
            ({**self.permissions, 'requests': [{**self.origin['request'], 'id': 'new-request'}]}, self.snapshot),
            (self.permissions, {**self.snapshot, 'active_run': {'run_id': 'new-run'}}),
            (self.permissions, {**self.snapshot, 'metadata': {'session_id': 'other', 'run_count': 1}}),
        ]:
            with self.subTest(permissions=permissions, snapshot=snapshot), self.assertRaises(AssertionError):
                self.state(permissions, snapshot)
        for count in (2, True, None):
            with self.subTest(count=count), self.assertRaises(AssertionError):
                self.state(run_count=count)

    def test_unknown_denial_repetition_new_provider_work_or_grants_are_rejected(self):
        for outputs in [['approved'], ['Error: permission denied by user'], [DISCONNECTED_DENIAL] * 2]:
            with self.subTest(outputs=outputs), self.assertRaises(AssertionError):
                self.state(outputs=outputs)
        for requests in [PROVIDER_PREFIX + ['approval'], PROVIDER_PREFIX + ['approval-denied'] * 2]:
            with self.subTest(requests=requests), self.assertRaises(AssertionError):
                self.state(requests=requests)
        for key, value in [('approval_mode', 'automatic'), ('grants', ['unexpected'])]:
            with self.subTest(key=key), self.assertRaises(AssertionError):
                self.state({**self.permissions, key: value})

    def test_durable_denial_requires_one_completed_original_run(self):
        with tempfile.TemporaryDirectory() as raw:
            store = Path(raw) / 'store.db'
            with sqlite3.connect(store) as connection:
                connection.execute('CREATE TABLE session_run_outcomes(session_id TEXT,run_id TEXT,disposition TEXT)')
                connection.execute('INSERT INTO session_run_outcomes VALUES (?,?,?)',
                    ('approval-session', 'original-run', 'completed'))
            observation = dict(approval=self.denied())
            self.assertTrue(verify_renderer_store(store, self.origin, observation)['no_new_admission'])
            for column, value in [('run_id', 'replacement'), ('disposition', 'failed'), ('disposition', 'cancelled')]:
                with sqlite3.connect(store) as connection:
                    connection.execute('UPDATE session_run_outcomes SET run_id=?,disposition=?', ('original-run', 'completed'))
                    connection.execute('UPDATE session_run_outcomes SET ' + column + '=?', [value])
                with self.subTest(column=column, value=value), self.assertRaises(AssertionError):
                    verify_renderer_store(store, self.origin, observation)


if __name__ == '__main__':
    unittest.main()
