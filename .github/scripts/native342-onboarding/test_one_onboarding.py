"""Explicit inert controls only: never import H, launch a process or call main."""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('one_onboarding', Path(__file__).with_name('one-onboarding.py'))
controller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controller)


class SourceControls(unittest.TestCase):
    def admission(self):
        return dict(scope=controller.SCOPE, controller_sha='a' * 40, allocation_id='Root-named-one',
                    attempt=1, retries=0, manifest_sha256='b' * 64,
                    clock=dict(STARTED=1000, WORK_DEADLINE=1900, CLEANUP_DEADLINE=2260, HARD_DEADLINE=2380))

    def test_original_clock_includes_queue_without_renewal(self):
        value = self.admission()
        self.assertEqual(controller.admit(value, 'a' * 40, now=1800), (1000, 1900, 2260, 2380))
        for now in (999, 1900, 2380, float('nan')):
            with self.subTest(now=now), self.assertRaises(RuntimeError):
                controller.admit(value, 'a' * 40, now=now)

    def test_admission_rejects_changed_scope_retry_package_source_or_reserve(self):
        base = self.admission()
        variants = [dict(scope='configuredLocal'), dict(attempt=2), dict(retries=1),
                    dict(controller_sha='c' * 40), dict(manifest_sha256=''), dict(extra=True)]
        for key, value in [('WORK_DEADLINE', 1901), ('CLEANUP_DEADLINE', 2259),
                           ('HARD_DEADLINE', 2381), ('STARTED', True)]:
            changed = copy.deepcopy(base['clock'])
            changed[key] = value
            variants.append(dict(clock=changed))
        for changed in variants:
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                controller.admit({**base, **changed}, 'a' * 40, now=1001)

    def invocation(self, startup):
        return controller.selected_case(startup, **{key: object() for key in (
            'folder', 'profiles', 'app', 'manifest', 'product', 'tests', 'harness_sha',
            'selection', 'observer', 'image_reader', 'run', 'command', 'native_report')})

    def test_exactly_one_onboarding_call_requires_positive_cleanup_and_policy(self):
        proof = dict(scenario='onboarding', passed=True, cleanup=dict(owned_processes_settled=True),
                     profile_removed=True, persistent_authorization_policy_unchanged=True,
                     public_test_requested=True, input_completion_unknown=False, attachments_complete=True,
                     live_api={}, image={}, actual_result={})
        startup = Mock(spec=['run_case'])
        startup.run_case.return_value = proof
        self.assertIs(self.invocation(startup), proof)
        self.assertEqual(startup.run_case.call_count, 1)
        self.assertEqual(startup.run_case.call_args.kwargs['scenario'], 'onboarding')
        for changed in (dict(scenario='futureStore'), dict(passed=False), dict(cleanup={}),
                        dict(profile_removed=False), dict(persistent_authorization_policy_unchanged=False),
                        dict(input_completion_unknown=True), dict(attachments_complete=False),
                        dict(public_test_requested=False)):
            startup.reset_mock()
            startup.run_case.return_value = {**proof, **changed}
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                self.invocation(startup)
            self.assertEqual(startup.run_case.call_count, 1)


if __name__ == '__main__':
    unittest.main()
