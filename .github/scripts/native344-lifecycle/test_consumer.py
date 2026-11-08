"""Inert admission and real ledger/callback tests. They grant no native acceptance."""
from contextlib import nullcontext
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import consumer as c

H_STATIC = Path(os.environ['LIFECYCLE_H_STATIC'])
contract, owner, supervisor = c.owners(H_STATIC)
from test_ci_lifecycle_contract import case, build, capsule, environment, HEAD


def admission():
    return dict(scope=c.SCOPE, controller_sha=HEAD, H=c.H, P=c.P, role=c.ROLE,
        manifest_sha256=c.MANIFEST, allocation_id='INERT-NOT-ACTUAL', admission_nonce='e' * 64,
        attempt=1, retries=0, prior_dispatch_counts=dict.fromkeys(c.CASES, 0),
        clock=dict(STARTED=1000, WORK_DEADLINE=3880, CLEANUP_DEADLINE=4480, HARD_DEADLINE=4600),
        producer=dict(run_id=c.common.PRODUCER_RUN, artifact_id=c.common.PRODUCER_ARTIFACT,
            controller_sha=c.common.PRODUCER, branch=c.common.PRODUCER_BRANCH,
            artifact_name=c.common.PRODUCER_ARTIFACT_NAME))


def env():
    return dict(environment(), GITHUB_REF=c.BRANCH)


class Admission(unittest.TestCase):
    def test_exact_private_and_historical_capsules(self):
        self.assertEqual(c.admit(admission(), env(), now=1001), (1000, 3880, 4480, 4600))
        self.assertEqual(contract.require_capsule(json.dumps(capsule()), HEAD, environment()), capsule())
        with self.assertRaises(RuntimeError):
            contract.require_capsule(json.dumps(admission()), HEAD, env())
        with self.assertRaises(RuntimeError):
            c.admit(capsule(), env(), now=1001)

    def test_all_identity_attempt_and_authority_refusals(self):
        for field, value in [('H', 'b' * 40), ('P', 'b' * 40), ('controller_sha', 'b' * 40),
            ('role', 'normal-app-preparation'), ('manifest_sha256', c.common.MANIFEST_SHA256),
            ('scope', c.common.SCOPE), ('attempt', True), ('attempt', 2), ('retries', 1),
            ('prior_dispatch_counts', dict.fromkeys(c.CASES, False)), ('admission_nonce', 'x')]:
            invalid = admission(); invalid[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(RuntimeError):
                c.admit(invalid, env(), now=1001)
        for field in env():
            invalid = env(); invalid[field] = 'WRONG'
            with self.subTest(environment=field), self.assertRaises(RuntimeError):
                c.admit(admission(), invalid, now=1001)

    def test_original_clock_not_renewed(self):
        for now in (999, 3880, 4500, float('nan')):
            with self.subTest(now=now), self.assertRaises(RuntimeError):
                c.admit(admission(), env(), now=now)
        invalid = admission(); invalid['clock']['WORK_DEADLINE'] = 4000
        with self.assertRaises(RuntimeError): c.admit(invalid, env(), now=1001)
        invalid = admission(); invalid['producer']['artifact_id'] += 1
        with self.assertRaises(RuntimeError): c.admit(invalid, env(), now=1001)

    def test_bounded_duplicate_free_literal_and_phase_clocks(self):
        self.assertEqual(c.declaration(json.dumps(admission())), admission())
        for text in ('{"x":1,"x":2}', 'x' * 8193):
            with self.assertRaises(RuntimeError): c.declaration(text)
        import importlib.util
        spec = importlib.util.spec_from_file_location('lifecycle_launcher', c.HERE / 'launch.py')
        launcher = importlib.util.module_from_spec(spec); spec.loader.exec_module(launcher)
        with mock.patch.dict(os.environ, env()):
            for phase in (*launcher.CAPS, 'episode'):
                self.assertGreaterEqual(launcher.minutes(admission(), phase, now=1100), 1)
                with self.assertRaises(RuntimeError): launcher.minutes(admission(), phase, now=3880)
        self.assertEqual(admission()['clock']['WORK_DEADLINE'], 3880)

    def test_binding_is_fixed_not_caller_identity(self):
        self.assertEqual(contract.selected_source(None), contract.SOURCE)
        self.assertEqual(contract.selected_source(contract.Binding.P12), c.P)
        for unknown in (c.P, 'arbitrary', True):
            with self.assertRaises(RuntimeError): contract.selected_source(unknown)


class CaseBindings(unittest.TestCase):
    def test_default_and_p12_classes_are_distinct_and_strict(self):
        original = case()
        contract.require_case(original, 'run', build(), {})
        new = copy.deepcopy(original)
        new['source_head'] = c.P
        new['cases'][0]['native']['ready_source'] = c.P
        new['cases'][0]['native']['application_class'] = 'NACApplication'
        contract.require_case(new, 'run', build(), {}, binding=contract.Binding.P12)
        with self.assertRaises(RuntimeError): contract.require_case(new, 'run', build(), {})
        for field, value in [('application_class', 'NSApplication'), ('application_class', 'MyNACApplication'),
            ('owned_engine_pid', 0), ('commands_retired', False), ('document_released', False)]:
            invalid = copy.deepcopy(new); invalid['cases'][0]['native'][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(RuntimeError):
                contract.require_case(invalid, 'run', build(), {}, binding=contract.Binding.P12)

    def test_p12_accepted_handle_receipt_and_retained_ownership_have_exact_source(self):
        from test_ci_lifecycle import fixture_receipt
        import shutil
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder).resolve()
            path = fixture_receipt(destination)
            process = mock.Mock(pid=123)
            def wait(**kwargs):
                shutil.rmtree(path.parents[2])
                return 0
            process.wait.side_effect = wait
            with mock.patch.object(supervisor.signal, 'pthread_sigmask', return_value=set()):
                result = supervisor.run_case(['INERT-NOT-AN-ACTOR'], destination / 'runner.log',
                    dict(NAC_LIFECYCLE_SOURCE=str(destination), NAC_LIFECYCLE_SCENARIOS='run'),
                    spawn=lambda *a, **k: process, owner=owner, binding=contract.Binding.P12)
            self.assertEqual(result['source_sha'], c.P)
            self.assertEqual(owner.require(destination, 'run')['source_sha'], c.P)
            self.assertFalse(owner.require(destination, 'run')['PID_signal_authority'])
            process.terminate.assert_not_called()


class SerialCallbacks(unittest.TestCase):
    def exercise(self, fail=None, unknown=False, publish_failure=False):
        calls = []
        class Clock:
            work = object(); cleanup = object()
            def require_phase(self, label, seconds): calls.append(('budget', label, seconds))
            def fail(self, reason): calls.append(('failed', reason))
        clock = Clock()
        clock.work = mock.Mock()
        with tempfile.TemporaryDirectory() as folder:
            control = Path(folder).resolve()
            ledger = contract.Ledger(control, dict(admission(), harness=HEAD), '123', binding=contract.Binding.P12)
            def reserve(name):
                output = control / name
                ledger.reserve(name, output, dict(observed=True, locked=False), dict(
                    source_sha=c.P, harness_sha=HEAD, builds_sha256='a' * 64, observer_sha256='b' * 64,
                    command=c.driver_command(Path('/P'), name, Path('/APP'), output, Path('/OBSERVER'))))
                calls.append(('reserve', name))
            def driver(name):
                calls.append(('driver', name))
                if name == fail: raise RuntimeError('inert driver failure')
                return {'state': 'exited'}
            def cleanup(name):
                calls.append(('cleanup', name))
                return dict(complete=not unknown, retained_failure_roots=[])
            def publish(name, outcome):
                calls.append(('publish', name, outcome['status']))
                if publish_failure: raise RuntimeError('inert export failure')
                outcome['external_result_sha256'] = 'e' * 64
            try:
                c.serial(ledger, clock, lambda _: nullcontext(), reserve=reserve, driver=driver,
                    validate=lambda name: {'case': name}, cleanup=cleanup, publish=publish)
            except RuntimeError:
                if fail is None and not unknown and not publish_failure: raise
            state = json.loads(ledger.path.read_bytes())
            ledger.close()
            return calls, state

    def test_real_ledger_all_three_callbacks_once_in_order(self):
        calls, state = self.exercise()
        self.assertEqual([row[1] for row in calls if row[0] == 'driver'], list(c.CASES))
        self.assertEqual([row[1] for row in calls if row[0] == 'cleanup'], list(c.CASES))
        self.assertEqual(state['phase'], 'complete')
        self.assertTrue(all(row['dispatches'] == 1 and row['state'] == 'passed' for row in state['cases'].values()))

    def test_failure_unknown_or_export_stops_actual_callbacks(self):
        for args in ({'fail': 'run'}, {'fail': 'approval'}, {'unknown': True}, {'publish_failure': True}):
            with self.subTest(args=args):
                calls, state = self.exercise(**args)
                dispatched = [row[1] for row in calls if row[0] == 'driver']
                self.assertEqual(dispatched, ['run', 'approval'] if args.get('fail') == 'approval' else ['run'])
                self.assertEqual([row[1] for row in calls if row[0] == 'cleanup'], dispatched)
                self.assertNotEqual(state['phase'], 'complete')
                self.assertEqual(state['cases']['terminal'], dict(state='not_dispatched', dispatches=0))

    def test_p12_ledger_rejects_historical_source_and_reentry(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder).resolve()
            ledger = contract.Ledger(path, dict(admission(), harness=HEAD), '123', binding=contract.Binding.P12)
            with self.assertRaises(RuntimeError):
                from test_ci_lifecycle_contract import reservation
                ledger.reserve('run', path / 'run', dict(observed=True, locked=False), reservation('run', path / 'run'))
            self.assertEqual(ledger.value['cases']['run']['dispatches'], 0)
            ledger.close()
            with self.assertRaises(FileExistsError):
                contract.Ledger(path, dict(admission(), harness=HEAD), '123', binding=contract.Binding.P12)


class ClosedArtifact(unittest.TestCase):
    def test_genuine_original_role_readonly_and_normal_manifest_refusal(self):
        root = Path(os.environ['LIFECYCLE_ORIGINAL_OUTER'])
        manifest, archive, body = c.handoff(root, admission())
        self.assertEqual(c.digest(manifest), c.MANIFEST)
        self.assertEqual(body['observer']['name'], 'InstanceObservation')
        self.assertEqual(len(body['files']), 6)
        self.assertFalse(any(body['qualification'].values()))
        wrong = admission(); wrong['manifest_sha256'] = c.common.MANIFEST_SHA256
        with self.assertRaises(RuntimeError): c.handoff(root, wrong)


if __name__ == '__main__': unittest.main()
