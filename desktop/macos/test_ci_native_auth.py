"""No app, browser, HTTP or real Actions metadata is used by these controls."""
import copy
import json
import os
import subprocess
import sys
import unittest
from unittest.mock import patch, Mock
from ci_native_auth import clean_environment, hosted_job, isolate_subprocess_environment, public_candidate


class HostedAuthenticationAdmissionControls(unittest.TestCase):
    def test_public_stack_merge_can_have_a_composed_base_but_not_a_foreign_candidate(self):
        source, head, base, composed = (letter * 40 for letter in 'abcd')
        read_commit = Mock(return_value={})
        admit = lambda *args: public_candidate(*args, tree='f' * 40, read_commit=read_commit)
        environment = dict(CANDIDATE_PR='506', CANDIDATE_HEAD=head, CANDIDATE_BASE=base)
        pull = dict(number=506, state='open', merge_commit_sha=source, head=dict(sha=head), base=dict(sha=base))
        self.assertEqual(admit(source, [composed, head], environment, pull)['base'], base)
        for field, value in [('number', 507), ('state', 'closed'), ('merge_commit_sha', 'e' * 40),
                             ('head', dict(sha='e' * 40)), ('base', dict(sha='e' * 40))]:
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                admit(source, [composed, head], environment, {**pull, field: value})
        with self.assertRaises(RuntimeError):
            admit(source, [composed, 'e' * 40], environment, pull)

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


class SyntheticMergeMetadataControls(unittest.TestCase):
    def setUp(self):
        self.source, self.head, self.base, self.composed, self.tree, self.current = (letter * 40 for letter in 'abcdef')
        self.parents = [self.composed, self.head]
        self.environment = dict(CANDIDATE_PR='506', CANDIDATE_HEAD=self.head, CANDIDATE_BASE=self.base)
        self.pull = dict(number=506, state='open', merge_commit_sha=self.current,
                         head=dict(sha=self.head), base=dict(sha=self.base))
        self.commit = dict(sha=self.current, tree=dict(sha=self.tree),
                           parents=[dict(sha=parent) for parent in self.parents])
        self.read = Mock(return_value=self.commit)

    def admit(self, pull=None, parents=None):
        return public_candidate(self.source, self.parents if parents is None else parents,
            self.environment, self.pull if pull is None else pull, tree=self.tree, read_commit=self.read)

    def test_equal_tree_and_ordered_parents_preserve_actual_tested_source(self):
        result = self.admit()
        self.assertEqual(result['source'], self.source)
        self.assertEqual(result['public_merge_sha'], self.current)
        self.assertTrue(result['equivalent_synthetic_metadata'])
        self.assertEqual(result['base'], self.base)
        self.read.assert_called_once_with(self.current)

    def test_literal_match_uses_original_fast_path(self):
        result = self.admit(pull={**self.pull, 'merge_commit_sha': self.source})
        self.assertFalse(result['equivalent_synthetic_metadata'])
        self.read.assert_not_called()

    def test_same_head_cannot_hide_different_tree_or_composed_parent(self):
        for change in (dict(tree=dict(sha='0' * 40)),
                       dict(parents=[dict(sha='0' * 40), dict(sha=self.head)]),
                       dict(parents=[dict(sha=self.head), dict(sha=self.composed)]),
                       dict(parents=[dict(sha=self.head)]),
                       dict(parents=self.commit['parents'] + [dict(sha='0' * 40)]),
                       dict(sha='0' * 40), dict(tree=None), dict(parents=[None, None])):
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                self.read.return_value = {**self.commit, **change}
                self.admit()

    def test_live_pr_open_head_and_base_checks_precede_equivalence_lookup(self):
        for field, value in [('number', 507), ('state', 'closed'),
                             ('head', dict(sha='0' * 40)), ('base', dict(sha='0' * 40)),
                             ('merge_commit_sha', None), ('merge_commit_sha', '../foreign')]:
            self.read.reset_mock()
            with self.subTest(field=field, value=value), self.assertRaises(RuntimeError):
                self.admit(pull={**self.pull, field: value})
            self.read.assert_not_called()

    def test_local_parent_head_and_service_failure_are_not_self_attested(self):
        with self.assertRaises(RuntimeError):
            self.admit(parents=[self.composed, '0' * 40])
        self.read.assert_not_called()
        self.read.side_effect = OSError('inert service unavailable')
        with self.assertRaises(OSError):
            self.admit()


if __name__ == '__main__':
    unittest.main()
