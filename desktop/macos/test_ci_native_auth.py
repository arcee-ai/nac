"""No app, browser, HTTP or real Actions metadata is used by these controls."""
import copy
import json
import os
import subprocess
import sys
import unittest
from unittest.mock import patch
from ci_native_auth import clean_environment, hosted_job, isolate_subprocess_environment, public_candidate


class HostedAuthenticationAdmissionControls(unittest.TestCase):
    def test_public_stack_merge_can_have_a_composed_base_but_not_a_foreign_candidate(self):
        source, head, base, composed = (letter * 40 for letter in 'abcd')
        environment = dict(CANDIDATE_PR='506', CANDIDATE_HEAD=head, CANDIDATE_BASE=base)
        pull = dict(number=506, state='open', merge_commit_sha=source, head=dict(sha=head), base=dict(sha=base))
        self.assertEqual(public_candidate(source, [composed, head], environment, pull)['base'], base)
        for field, value in [('number', 507), ('state', 'closed'), ('merge_commit_sha', 'e' * 40),
                             ('head', dict(sha='e' * 40)), ('base', dict(sha='e' * 40))]:
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                public_candidate(source, [composed, head], environment, {**pull, field: value})
        with self.assertRaises(RuntimeError):
            public_candidate(source, [composed, 'e' * 40], environment, pull)

    def test_environment_flags_without_the_matching_live_service_job_cannot_admit(self):
        source = 'a' * 40
        environment = dict(GITHUB_ACTIONS='true', RUNNER_OS='macOS', RUNNER_ENVIRONMENT='github-hosted',
                           GITHUB_REPOSITORY='arcee-ai/nac', GITHUB_SHA=source,
                           GITHUB_JOB='native-auth', RUNNER_NAME='owned-ephemeral-runner', CANDIDATE_HEAD='b' * 40)
        job = dict(id=17, name='Hosted macOS26 native authentication', status='in_progress',
                   head_sha='b' * 40, runner_name=environment['RUNNER_NAME'], labels=['macos-26'])
        self.assertEqual(hosted_job(environment, [job], source)['id'], 17)
        for jobs in ([], [job, job]):
            with self.assertRaises(RuntimeError):
                hosted_job(environment, jobs, source)
        for field, value in [('status', 'completed'), ('runner_name', 'foreign'),
                             ('head_sha', 'c' * 40), ('labels', ['self-hosted', 'macos-26']),
                             ('labels', ['macos-14']), ('name', 'Another job')]:
            with self.subTest(field=field, value=value):
                other = {**job, field: value}
                with self.assertRaises(RuntimeError):
                    hosted_job(environment, [other], source)
        for field in environment:
            other = copy.deepcopy(environment); other.pop(field)
            with self.subTest(missing=field), self.assertRaises(RuntimeError):
                hosted_job(other, [job], source)

    def test_real_tokens_and_native_overrides_do_not_reach_existing_drivers(self):
        environment = dict(PATH='/inert', HOME='/Users/runner', GITHUB_ACTIONS='true', RUNNER_OS='macOS',
                           GITHUB_TOKEN='inert', GH_TOKEN='inert', ACTIONS_RUNTIME_TOKEN='inert',
                           ARCEE_API_KEY='inert', NAC_HOME='/foreign', NAC_MAC_ENGINE='/foreign')
        self.assertEqual(clean_environment(environment), dict(PATH='/inert', HOME='/Users/runner',
                                                            GITHUB_ACTIONS='true', RUNNER_OS='macOS'))

    def test_default_subprocess_inheritance_is_sanitized_before_any_child(self):
        environment = dict(PATH=os.defpath, GITHUB_TOKEN='inert-api-token', ARCEE_API_KEY='inert',
                           ACTIONS_RUNTIME_TOKEN='inert', NAC_HOME='/inert-foreign', GITHUB_ACTIONS='true')
        with patch.dict(os.environ, environment, clear=True):
            token = isolate_subprocess_environment(os.environ)
            self.assertEqual(token, 'inert-api-token')
            # No explicit env argument: exercise the Git/compiler/helper default.
            observed = json.loads(subprocess.check_output([sys.executable, '-c',
                'import os,json; print(json.dumps({k: k in os.environ for k in '
                '["GITHUB_TOKEN","ARCEE_API_KEY","ACTIONS_RUNTIME_TOKEN","NAC_HOME","GITHUB_ACTIONS"]}))'], text=True))
            self.assertEqual(observed, dict(GITHUB_TOKEN=False, ARCEE_API_KEY=False,
                ACTIONS_RUNTIME_TOKEN=False, NAC_HOME=False, GITHUB_ACTIONS=True))


if __name__ == '__main__':
    unittest.main()
