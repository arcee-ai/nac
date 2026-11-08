"""Actual Provider start/stop with only fresh in-memory child/thread ports."""
from contextlib import ExitStack
import io
import json
import queue
import subprocess
import unittest
from unittest.mock import patch

from ci_paths_budget import BudgetExpired, using
from ci_startup_api import Provider, ROOT, digest
from test_ci_startup_clock import Clock


class PrivateError(Exception):
    def __str__(self):raise AssertionError('Never format private provider error')


class ProviderFailureTests(unittest.TestCase):
    def execute(self, mode='not-ready', secondary='unknown', *, primary=None):
        clock, threads, signals = Clock(), [], []
        class Stream(io.StringIO):
            def readline(self, size=-1):
                if mode == 'read':raise PrivateError()
                return super().readline(size)
            def close(self):
                if secondary == 'close' and not getattr(self,'failed_close',False):
                    self.failed_close=True
                    raise OSError('PRIVATE-CLOSE-CANARY')
                super().close()
        class Child:
            pid = 12345  # In-memory identifier, never sent to an OS port.
            returncode = None
            stdin = io.StringIO()
            stdout = Stream(('[]\n' if mode == 'malformed' else
                            json.dumps({'event':'ready' if mode=='ready' else 'not-ready',
                                'base_url':'http://127.0.0.1:4321',
                                'shared_source_sha256':digest(ROOT/'crates/nac-server/web/e2e/scripted-provider.ts')})+'\n')+
                            json.dumps({'event':'finished','valid':mode=='ready'})+'\n')
            stderr = io.StringIO()
            def poll(self):return self.returncode
            def wait(self, **kwargs):
                if secondary == 'kill':raise subprocess.TimeoutExpired(['inert'], 5)
                self.returncode = 0
                return 0
        child = Child()
        class Thread:
            def __init__(self, target, **kwargs):self.target=target;threads.append(self)
            def start(self):
                if mode == 'thread-start':raise PrivateError()
                self.target()
            def join(self, **kwargs):
                if secondary == 'join':raise OSError('PRIVATE-JOIN-CANARY')
                if secondary == 'private':raise PrivateError()
            def is_alive(self):return secondary == 'unknown'
        provider = Provider()
        class Records:
            def __init__(self):self.items=[]
            def put_nowait(self,value):
                if len(self.items)>=4:raise queue.Full()
                self.items.append(value)
            def get(self,**kwargs):
                if not self.items:raise queue.Empty()
                return self.items.pop(0)
        provider.lines=Records()
        def kill(*args):
            signals.append(args)
            if secondary == 'kill':raise OSError('PRIVATE-KILL-CANARY')
        with ExitStack() as stack:
            stack.enter_context(patch('ci_startup_api.subprocess.Popen',return_value=child))
            stack.enter_context(patch('ci_startup_api.threading.Thread',Thread))
            stack.enter_context(patch('ci_startup_api.os.killpg',side_effect=kill))
            if primary is not None:
                stack.enter_context(patch('ci_startup_api.RuntimeError',return_value=primary,create=True))
            with using(clock.cleanup):
                if mode=='ready':
                    self.assertEqual(provider.start(),'http://127.0.0.1:4321')
                    journal=provider.stop()
                    self.assertTrue(journal['valid'])
                    self.assertIs(provider.stop(),journal)
                    return child, provider, signals
                with self.assertRaises(RuntimeError) as caught:provider.start()
        self.assertIs(type(caught.exception), RuntimeError)
        self.assertEqual(str(caught.exception),'Owned startup provider did not become ready')
        if primary is not None:self.assertIs(caught.exception,primary)
        if secondary is not None:
            self.assertTrue(clock.failed)
            with self.assertRaises(BudgetExpired):clock.work.check()
            notes = '\n'.join(caught.exception.__notes__)
            self.assertLess(len(notes),1024)
            self.assertNotIn('PRIVATE-',notes)
            self.assertFalse(provider.settled if secondary in ('unknown','join','kill','close') else False)
        return child, provider, signals

    def test_not_ready_cleanup_unknown_preserves_selected_primary_object(self):
        self.execute(primary=RuntimeError('Owned startup provider did not become ready'))

    def test_malformed_read_and_thread_start_failures_cannot_be_masked_by_cleanup(self):
        for mode in ('malformed','read','thread-start'):
            with self.subTest(mode=mode):self.execute(mode)

    def test_join_close_and_kill_failures_remain_bounded_secondary_evidence(self):
        for secondary in ('join','close','kill','private'):
            with self.subTest(secondary=secondary):self.execute(secondary=secondary)

    def test_not_ready_with_settled_cleanup_keeps_existing_safe_error(self):
        child, provider, signals = self.execute(secondary=None)
        self.assertEqual(child.returncode,0)
        self.assertTrue(provider.settled)
        self.assertEqual(signals,[])

    def test_ready_and_complete_cached_journal_still_require_positive_settlement(self):
        child, provider, signals = self.execute(mode='ready',secondary=None)
        self.assertTrue(provider.settled)
        self.assertEqual(child.returncode,0)
        self.assertEqual(signals,[])


if __name__=='__main__':unittest.main()
