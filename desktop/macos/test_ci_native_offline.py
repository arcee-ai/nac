"""Inert actual proposed-caller controls; synthetic job fixtures are not run receipts."""
import copy
from pathlib import Path
import signal
import subprocess
import unittest
from unittest.mock import patch

import ci_native_offline as caller


POST_OPEN_OBSERVATIONS = []


class Clock:
    now = 0.0
    def __call__(self): return self.now


class Child:
    pid = 42
    def __init__(self, actions):
        self.actions = list(actions); self.returncode = None; self.waits = []; self.poll_error = None
    def wait(self, timeout):
        assert timeout > 0
        self.waits.append(timeout)
        action = self.actions.pop(0)
        if callable(action): action = action()
        if isinstance(action, BaseException): raise action
        self.returncode = action
        return action
    def poll(self):
        if self.poll_error is not None:
            error, self.poll_error = self.poll_error, None
            raise error
        return self.returncode


class Log:
    def __init__(self, error=None): self.error = error; self.closed = False
    def close(self):
        self.closed = True
        if self.error is not None: raise self.error


class CommandTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock(); self.rows = []; self.saves = []; self.signals = []; self.spawned = []
        self.log = Log(); self.retain_errors = {}; self.signal_action = None
        self.preflight = lambda: None
        self.open_action = lambda: None
    def save(self, name, rows):
        self.saves.append(copy.deepcopy(rows))
        if len(self.saves) in self.retain_errors: raise self.retain_errors[len(self.saves)]
    def run_child(self, child, cleanup=100):
        def spawn(*arguments, **keywords):
            self.spawned.append((arguments, keywords)); return child
        def send(pid, signum):
            self.assertLess(self.clock(), cleanup)
            self.assertEqual(pid, child.pid)
            self.signals.append((pid, signum, self.clock()))
            if self.signal_action is not None: self.signal_action(signum)
        def opened(*args, **kwargs):
            self.open_action()
            return self.log
        with patch.object(Path, 'open', side_effect=opened):
            return caller.run_command('inert-command', ['not-executed'], environment={},
                deadline=10, cleanup_end=cleanup, started=0, commands=self.rows,
                log_path=Path('inert-log'), save=self.save, spawn=spawn,
                clock=self.clock, signal_group=send, preflight=self.preflight)
    def timeout(self, at):
        error = subprocess.TimeoutExpired(['not-executed'], 10)
        def action(): self.clock.now = at; return error
        return error, action
    def assert_post_open_deadline_refuses_acquisition(self, at, cleanup):
        self.open_action = lambda: setattr(self.clock, 'now', at)
        error = None
        try: self.run_child(Child([0]), cleanup=cleanup)
        except BaseException as caught: error = caught
        POST_OPEN_OBSERVATIONS.append(dict(at=at, action_deadline=10, cleanup_deadline=cleanup,
            spawned=len(self.spawned), signals=len(self.signals), log_closed=self.log.closed,
            final_rows=copy.deepcopy(self.rows), saves=copy.deepcopy(self.saves),
            error=None if error is None else dict(type=type(error).__name__,message=str(error))))
        self.assertIsInstance(error, RuntimeError)
        self.assertIn('after log open', str(error))
        self.assertFalse(self.spawned); self.assertFalse(self.signals)
        self.assertTrue(self.log.closed); self.assertEqual(len(self.saves), 2)
        row = self.rows[0]
        self.assertEqual(row['state'], 'failed'); self.assertIsNone(row['exit'])
        self.assertFalse(row['child_reaped']); self.assertFalse(row['unresolved'])
        self.assertNotIn('pid', row); self.assertEqual(row['primary_error']['phase'], 'command')
        self.assertEqual(self.saves[-1][0], row)
    def test_log_open_consuming_action_deadline_never_spawns(self):
        self.assert_post_open_deadline_refuses_acquisition(at=10, cleanup=100)
    def test_log_open_consuming_cleanup_deadline_never_spawns(self):
        self.assert_post_open_deadline_refuses_acquisition(at=5, cleanup=5)
    def test_success_records_final_owned_child(self):
        child = Child([0]); row = self.run_child(child)
        self.assertEqual(row['state'], 'completed'); self.assertTrue(row['child_reaped'])
        self.assertFalse(row['unresolved']); self.assertEqual(row['exit'], 0)
        self.assertEqual(len(self.spawned), 1); self.assertEqual(len(self.saves), 2)
        self.assertEqual(self.saves[-1][0], row); self.assertFalse(self.signals); self.assertTrue(self.log.closed)
    def test_timeout_exit_signal_race_keeps_first_exception(self):
        error, action = self.timeout(10); child = Child([action])
        def race(signum): child.returncode = 0; raise ProcessLookupError('exited between poll and signal')
        self.signal_action = race
        with self.assertRaises(subprocess.TimeoutExpired) as caught: self.run_child(child)
        self.assertIs(caught.exception, error)
        self.assertEqual(self.rows[0]['primary_error']['type'], 'TimeoutExpired')
        self.assertEqual(self.rows[0]['secondary_cleanup'][0]['type'], 'ProcessLookupError')
        self.assertTrue(self.rows[0]['child_reaped']); self.assertEqual(len(child.waits), 1)
        self.assertEqual(self.saves[-1][0], self.rows[0])
    def test_cleanup_log_and_retention_errors_do_not_replace_timeout(self):
        error, action = self.timeout(10); child = Child([action, 0])
        def fail(signum): raise PermissionError('inert signal refusal')
        self.signal_action = fail; self.log = Log(OSError('inert close failure'))
        self.retain_errors[2] = OSError('inert final receipt failure')
        with self.assertRaises(subprocess.TimeoutExpired) as caught: self.run_child(child)
        self.assertIs(caught.exception, error)
        self.assertEqual([e['phase'] for e in self.rows[0]['secondary_cleanup']],
                         ['signal-owned-child', 'close-command-log', 'retain-final-command'])
        self.assertEqual(self.rows[0]['state'], 'failed'); self.assertTrue(self.rows[0]['child_reaped'])
        self.assertEqual(len(self.saves), 2)
    def test_expired_cleanup_has_no_signal_or_positive_wait(self):
        error, action = self.timeout(100); child = Child([action])
        with self.assertRaises(subprocess.TimeoutExpired) as caught: self.run_child(child)
        self.assertIs(caught.exception, error); self.assertFalse(self.signals)
        self.assertEqual(len(child.waits), 1); self.assertTrue(self.rows[0]['unresolved'])
        self.assertEqual(self.saves[-1][0], self.rows[0])
    def test_signal_crossing_cutoff_cannot_start_wait_or_second_signal(self):
        error, action = self.timeout(10); child = Child([action])
        self.signal_action = lambda signum: setattr(self.clock, 'now', 20)
        with self.assertRaises(subprocess.TimeoutExpired): self.run_child(child, cleanup=20)
        self.assertEqual(len(self.signals), 1); self.assertEqual(len(child.waits), 1)
        self.assertTrue(self.rows[0]['unresolved'])
    def test_cleanup_wait_consumes_remaining_not_floor(self):
        error, first = self.timeout(10); _, second = self.timeout(20); child = Child([first, second])
        with self.assertRaises(subprocess.TimeoutExpired) as caught: self.run_child(child, cleanup=20)
        self.assertIs(caught.exception, error); self.assertEqual(child.waits, [10, 10])
        self.assertEqual(len(self.signals), 1); self.assertTrue(self.rows[0]['unresolved'])
    def test_two_stage_cleanup_within_original_clock(self):
        error, first = self.timeout(1); _, second = self.timeout(31); child = Child([first, second, 0])
        with self.assertRaises(subprocess.TimeoutExpired) as caught: self.run_child(child)
        self.assertIs(caught.exception, error)
        self.assertEqual([s[1] for s in self.signals], [signal.SIGINT, signal.SIGKILL])
        self.assertEqual(child.waits, [10, 30, 5]); self.assertTrue(self.rows[0]['child_reaped'])
    def test_nonzero_exit_is_first_and_no_cleanup_signal(self):
        with self.assertRaises(RuntimeError): self.run_child(Child([7]))
        self.assertEqual(self.rows[0]['exit'], 7); self.assertTrue(self.rows[0]['child_reaped'])
        self.assertFalse(self.signals); self.assertEqual(len(self.saves), 2)
    def test_initial_retention_error_never_acquires_child(self):
        error = OSError('inert initial receipt failure'); self.retain_errors[1] = error
        with self.assertRaises(OSError) as caught: self.run_child(Child([]))
        self.assertIs(caught.exception, error); self.assertFalse(self.spawned)
        self.assertEqual(len(self.saves), 2); self.assertEqual(self.saves[-1][0], self.rows[0])
    def test_preflight_error_retains_attempt_without_child(self):
        error = RuntimeError('inert moved public pin')
        def fail(): raise error
        self.preflight = fail
        with self.assertRaises(RuntimeError) as caught: self.run_child(Child([]))
        self.assertIs(caught.exception, error); self.assertFalse(self.spawned)
        self.assertEqual(self.rows[0]['state'], 'failed'); self.assertEqual(len(self.saves), 2)
    def test_poll_failure_does_not_signal_uncertain_child(self):
        error, action = self.timeout(10); child = Child([action]); child.poll_error = OSError('inert unknown poll')
        with self.assertRaises(subprocess.TimeoutExpired) as caught: self.run_child(child)
        self.assertIs(caught.exception, error); self.assertFalse(self.signals)
        self.assertTrue(self.rows[0]['unresolved']); self.assertEqual(len(self.saves), 2)
    def test_log_close_primary_retains_successful_child_facts(self):
        error = OSError('inert close'); self.log = Log(error)
        with self.assertRaises(OSError) as caught: self.run_child(Child([0]))
        self.assertIs(caught.exception, error); self.assertTrue(self.rows[0]['child_reaped'])
        self.assertEqual(self.rows[0]['primary_error']['phase'], 'close-command-log')


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.source = 'a'*40
        self.env = dict(GITHUB_ACTIONS='true', RUNNER_OS='macOS', RUNNER_ENVIRONMENT='github-hosted',
            GITHUB_REPOSITORY='arcee-ai/nac', GITHUB_SHA=self.source, GITHUB_JOB='native-offline',
            GITHUB_EVENT_NAME='pull_request', GITHUB_RUN_ATTEMPT='1', CANDIDATE_PR='636',
            CANDIDATE_HEAD='b'*40, CANDIDATE_BASE='c'*40, RUNNER_NAME='synthetic-runner')
        self.event = dict(action='synchronize', number=636,
            pull_request=dict(head=dict(sha='b'*40), base=dict(sha='c'*40)))
        self.job = dict(id=123, name='Hosted macOS26 offline local provider', status='in_progress',
            head_sha='b'*40, runner_name='synthetic-runner', labels=['macos-26'])
    def test_designated_event_and_actual_metadata_contract(self):
        self.assertEqual(caller.hosted_job(self.env, [self.job], self.source, self.event)['id'], 123)
    def test_no_rerun_other_pr_manual_event_or_identity_override(self):
        for key, value in [('GITHUB_RUN_ATTEMPT', '2'), ('CANDIDATE_PR', '507'), ('CANDIDATE_PR', '506'),
                           ('GITHUB_EVENT_NAME', 'workflow_dispatch'), ('GITHUB_JOB', 'native-auth'),
                           ('GITHUB_SHA', 'd'*40), ('RUNNER_ENVIRONMENT', 'self-hosted')]:
            env = dict(self.env, **{key:value})
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                caller.hosted_job(env, [self.job], self.source, self.event)
        for key, value in [('action', 'opened'), ('number', 507), ('number', 506)]:
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                caller.hosted_job(self.env, [self.job], self.source, dict(self.event, **{key:value}))
    def test_no_stale_event_duplicate_job_or_selfhosted_match(self):
        event = copy.deepcopy(self.event); event['pull_request']['head']['sha'] = 'd'*40
        for jobs, event in [([self.job],event), ([self.job,self.job],self.event),
                            ([dict(self.job,labels=['self-hosted','macos-26'])],self.event)]:
            with self.assertRaises(RuntimeError): caller.hosted_job(self.env, jobs, self.source, event)


if __name__ == '__main__': unittest.main()
