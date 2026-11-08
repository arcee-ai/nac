"""Exact first-failure and original-clock regressions; all callbacks inert."""
from contextlib import nullcontext
import traceback
import unittest
from unittest import mock

import consumer as c
from test_consumer import contract
from ci_paths_budget import Bound, using


class Primary(RuntimeError): pass
class Secondary(RuntimeError): pass


class Failures(unittest.TestCase):
    def exercise(self, first_stage=None, second_stage=None):
        first, second = Primary('origin-' + str(first_stage)), Secondary('secondary-' + str(second_stage))
        events, published = [], []
        clock = mock.Mock()
        ledger = mock.Mock(value={})
        if second_stage == 'ledger': ledger.finish.side_effect = second
        def callback(stage):
            def invoke(name, *args):
                events.append((stage, name))
                if stage == first_stage: raise first
                if stage == 'publish':
                    published.append(dict(args[0]))
                    if second_stage == 'publish': raise second
                    args[0]['external_result_sha256'] = 'f' * 64
                if stage == 'cleanup': return dict(complete=True, retained_failure_roots=[])
                return {}
            return invoke
        observed = None
        try:
            c.serial(ledger, clock, lambda _: nullcontext(), reserve=callback('reserve'),
                driver=callback('driver'), validate=callback('validate'), cleanup=callback('cleanup'),
                publish=callback('publish'))
        except BaseException as error: observed = error
        return first, second, observed, events, published, ledger

    def test_each_origin_survives_each_secondary_failure_with_its_trace_and_explicit_cause(self):
        for origin in ('driver', 'validate', 'cleanup'):
            for later in ('publish', 'ledger'):
                with self.subTest(origin=origin, later=later):
                    first, second, observed, events, published, ledger = self.exercise(origin, later)
                    self.assertIs(observed, first)
                    self.assertIs(observed.__cause__, second)
                    self.assertTrue(any('Secondary: secondary-' + later in note for note in observed.__notes__))
                    self.assertIn('invoke', [frame.name for frame in traceback.extract_tb(observed.__traceback__)])
                    self.assertEqual({name for _, name in events}, {'run'})
                    self.assertEqual(events.count(('cleanup', 'run')), 1)
                    self.assertEqual(events.count(('publish', 'run')), 1)
                    self.assertNotEqual(published[0]['status'], 'passed')
                    self.assertEqual(ledger.finish.call_count, 0 if later == 'publish' else 1)

    def test_origin_only_and_secondary_only_keep_the_actual_exception(self):
        for origin in ('driver', 'validate', 'cleanup'):
            first, _, observed, events, _, _ = self.exercise(origin)
            self.assertIs(observed, first)
            self.assertIsNone(observed.__cause__)
            self.assertEqual({name for _, name in events}, {'run'})
        for later in ('publish', 'ledger'):
            _, second, observed, events, _, _ = self.exercise(second_stage=later)
            self.assertIs(observed, second)
            self.assertEqual({name for _, name in events}, {'run'})

    def test_no_failure_keeps_three_cases_in_order(self):
        _, _, observed, events, _, ledger = self.exercise()
        self.assertIsNone(observed)
        self.assertEqual([name for stage, name in events if stage == 'driver'], list(c.CASES))
        self.assertEqual(ledger.finish.call_count, 3)
        self.assertEqual(ledger.value['phase'], 'complete')


class Time:
    now = 1000.0
    def read(self): return self.now


class OriginalClock(unittest.TestCase):
    def exercise(self, guards, ledger_cost=0):
        time = Time(); events = []; original = Primary('stop after the first exact-cap inert driver')
        with mock.patch.object(c.common.time, 'time', side_effect=time.read), \
             mock.patch.object(c.common.time, 'monotonic', side_effect=time.read):
            clock = c.common.make_clock((1000, 1600, 2200, 2320), Bound)
            ledger = mock.Mock(value={})
            def reserve(name):
                time.now += guards
                clock.require_phase('actual-console-helper', 30)
                time.now += 10
                # The production callback checks immediately after all guards.
                clock.require_phase('actual-durable-reservation', 555)
                events.append(('reserved', name))
                time.now += ledger_cost
            def driver(name):
                events.append(('driver', name, clock.work.deadline - time.now))
                time.now += 240
                return {}
            def validate(name): raise original
            def publish(name, outcome): outcome['external_result_sha256'] = 'f' * 64
            observed = None
            try:
                c.serial(ledger, clock, using, reserve=reserve, driver=driver, validate=validate,
                    cleanup=lambda name: dict(complete=True, retained_failure_roots=[]), publish=publish)
            except BaseException as error: observed = error
            return events, time.now, clock, observed, original

    def test_elapsed_guard_counterexample_refuses_before_reservation(self):
        events, now, clock, observed, _ = self.exercise(400)
        self.assertIsInstance(observed, RuntimeError)
        self.assertEqual(events, [])
        self.assertEqual(now, 1410)
        self.assertLess(now, clock.work.deadline)
        self.assertEqual((clock.work.deadline, clock.cleanup.deadline, clock.retention.deadline), (1600, 2200, 2320))

    def test_durable_write_cost_consumes_reservation_but_cannot_dispatch(self):
        events, now, clock, observed, _ = self.exercise(0, ledger_cost=100)
        self.assertIsInstance(observed, RuntimeError)
        self.assertEqual(events, [('reserved', 'run')])
        self.assertEqual(now, 1110)
        self.assertLess(now, clock.work.deadline)

    def test_quick_guards_allow_original_240_second_cap_without_renewal(self):
        events, now, clock, observed, original = self.exercise(0)
        self.assertIs(observed, original)
        self.assertEqual(events, [('reserved', 'run'), ('driver', 'run', 590)])
        self.assertEqual(now, 1250)
        self.assertEqual((clock.work.deadline, clock.cleanup.deadline, clock.retention.deadline), (1600, 2200, 2320))


if __name__ == '__main__': unittest.main()
