"""Inert actual-preparation controls: fake clocks/children, no compiler or app."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from ci_paths_budget import Bound, BudgetExpired, active, using
from ci_startup import run_case
from ci_startup_api import Provider
from ci_startup_environment import SOURCE, SOURCE_SHA256, resolve_environment
from ci_startup_fixture import environment


class Clock:
    def __init__(self, cutoff=20):
        self.now, self.failed = 0, []
        self.work, self.cleanup, self.retention = (Bound(self, cutoff, 'work'),
            Bound(self, cutoff + 360, 'cleanup'), Bound(self, cutoff + 480, 'retention'))

    def monotonic(self):
        return self.now

    def observe(self):
        pass

    def fail(self, reason):
        if reason not in self.failed:
            self.failed.append(reason)


class StartupClockTests(unittest.TestCase):
    def test_actual_case_preparation_expiry_refuses_profile_launch_and_preserves_cleanup(self):
        clock, scopes = Clock(), []
        provider = Mock()
        def start():
            self.assertEqual(active().kind, 'work')
            clock.now = 21
            return 'http://127.0.0.1:1234'
        def stop(**options):
            scopes.append((active().kind, active().deadline, list(clock.failed)))
            return {'scope': 'fake positively settled provider'}
        provider.start.side_effect, provider.stop.side_effect = start, stop
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            profiles = root / 'profiles'
            profiles.mkdir()
            run = Mock(side_effect=AssertionError('No preparation helper may launch after expiry'))
            with patch('ci_startup.Provider', return_value=provider), \
                    patch('ci_startup.prepare_configuration') as configuration, using(clock.cleanup):
                with self.assertRaises(RuntimeError):
                    run_case(root / 'case', profiles, 'onboarding', root, root, root, root,
                             'a' * 40, {}, root, root, run, Mock(), Mock())
            run.assert_not_called()
            configuration.assert_not_called()
            proof = json.loads((root / 'case/case.json').read_text())
            self.assertFalse(proof['passed'])
            self.assertFalse(proof['public_test_requested'])
            self.assertEqual(scopes[0][:2], ('cleanup', 380))
            self.assertTrue(scopes[0][2])
            self.assertEqual(clock.retention.deadline, 500)
            with using(clock.cleanup):
                clock.cleanup.check()
            with self.assertRaises(BudgetExpired):
                clock.work.check()

    def test_actual_environment_preparation_clamps_compiler_and_latches_before_resolver(self):
        clock, caps, effective, launches = Clock(), [], [], []
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            source = root / SOURCE
            source.parent.mkdir(parents=True)
            source.write_text('inert source-admission stub; never compiled')
            profile = dict(root=root, home=root, environment=environment(root, 'http://127.0.0.1:1234/models-dev'))
            def run(argv, log, cap, **options):
                caps.append(cap)
                effective.append(active().timeout(cap, 15))  # Actual ci.run reserve arithmetic.
                if len(caps) == 3:
                    clock.now += effective[-1]
                    clock.fail('work: helper timeout')
                    raise subprocess.TimeoutExpired(argv, effective[-1])
                launches.append(argv[5:])  # Exec adapter, not a second process supervisor.
                log.write_bytes(b'/synthetic/swiftc' if len(caps) == 1 else b'synthetic version')
                clock.now += 2
            with patch('ci_startup_environment.require_checkout'), \
                    patch('ci_startup_environment.sha', return_value=SOURCE_SHA256), self.assertRaises(subprocess.TimeoutExpired):
                with using(clock.work):
                    resolve_environment(root, profile, run=run, directory=root)
            self.assertEqual(caps, [10, 10, 16])
            self.assertEqual(effective, [5, 3, 1])
            self.assertEqual(len(launches), 2)
            self.assertTrue(clock.failed)
            with self.assertRaises(BudgetExpired):
                clock.work.check()
            with using(clock.cleanup):
                self.assertEqual(active().deadline, 380)

    def test_actual_provider_readiness_expiry_uses_original_cleanup_not_new_work(self):
        clock, scopes = Clock(1), []
        provider = Provider()
        def ready(**options):
            self.assertEqual(options['timeout'], 1)
            clock.now = 2
            return {'event': 'ready'}
        provider.lines.get = Mock(side_effect=ready)
        def stop(**options):
            scopes.append((active().kind, active().deadline, bool(clock.failed)))
        with patch('ci_startup_api.subprocess.Popen', return_value=Mock()), \
                patch('ci_startup_api.threading.Thread'), patch.object(provider, 'stop', side_effect=stop):
            with self.assertRaises(BudgetExpired):
                with using(clock.work):
                    with self.assertRaises(RuntimeError):
                        provider.start()
                    self.assertEqual(scopes, [('cleanup', 361, True)])

    def test_provider_unknown_drain_never_returns_success_or_cached_journal(self):
        clock, provider = Clock(), Provider()
        provider.process = Mock(returncode=0)
        provider.process.poll.return_value = 0
        provider.reader = Mock()
        provider.reader.is_alive.return_value = True
        provider.error_reader = Mock()
        provider.error_reader.is_alive.return_value = False
        provider.lines.get = Mock(return_value={'event': 'finished', 'valid': True})
        with using(clock.cleanup):
            with self.assertRaises(RuntimeError):
                provider.stop()
            self.assertFalse(provider.settled)
            self.assertIn('startup provider finalization unknown', clock.failed)
            with self.assertRaises(RuntimeError):
                provider.stop()
