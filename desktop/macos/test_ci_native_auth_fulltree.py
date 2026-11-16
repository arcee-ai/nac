"""Authenticated service-shape controls; no network, app, browser or real Actions."""
import copy
import inspect
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
import ci_native_auth as auth


class PreparedParentControls(unittest.TestCase):
    shapes = {
        633: ('062dfe33a4251b50adcd6703fef9b4fadcfde448', 'f092dd7999456b3a4500535f1b00f3822c66c560',
              '246a67445e89335ec56bf5c01874f483aaefb397', '0407dca46d88c57a6c8fd489f3565076d8bb1497',
              'a1cb981df49777fa78da09145ca77085a301871f', '5ec316e75c776d5ca293f0bbe33cb06678910510',
              '0b6b16aabf369347ca14f0b7b3832dcb5c7b4a25', '2e4be0c937008ac07915d4c4ddcb75eb07255ec2'),
        636: ('02b24e04b57fce7ac6291c71deb5746267f16f7e', '94c825d74bec1a0b1df73a3e5711dc98ffd8e4ae',
              'e9cffa42211ebacdeb138e49bbc71b388b6a64fd', '37423e96edbeeffd2e62fa6cd78b85585f4c3b15',
              '417f648ee9113c8ea273aea15924bb5fd72b88ee', 'e785f5a1c4886a55c1c6edb7f6cc1d61b54879c1',
              '2d1b07dc14f8b1238eca18e24a5451849444483c', '7756480f3334cba7b3d1f0434d6b58cc8f5e40bc'),
    }

    def fixture(self, number=633):
        self.number = number
        self.source, old, self.current, new, self.base, self.head, base_tree, self.tree = self.shapes[number]
        self.parents = [old, self.head]
        self.environment = dict(CANDIDATE_PR=str(number), CANDIDATE_HEAD=self.head, CANDIDATE_BASE=self.base)
        self.pull = dict(number=number, state='open', merge_commit_sha=self.current,
            head=dict(sha=self.head), base=dict(sha=self.base, ref='codex/predecessor'),
            stack=dict(id=3111918, number=620, position=14 if number == 633 else 17, size=17,
                       base=dict(ref='dev', sha='4b852f065e2200f46c194b4ad2c5ace3fbd766a8')))
        def commit(sha, tree, parents):
            return dict(sha=sha, tree=dict(sha=tree), parents=[dict(sha=p) for p in parents])
        self.objects = {self.source: commit(self.source, self.tree, self.parents),
                        self.current: commit(self.current, self.tree, [new, self.head]),
                        old: commit(old, base_tree, ['1' * 40]), new: commit(new, base_tree, ['2' * 40]),
                        self.base: commit(self.base, base_tree, ['3' * 40]),
                        self.head: commit(self.head, self.tree, [self.base])}
        def ref(name, sha): return dict(ref=name, object=dict(type='commit', sha=sha))
        self.responses = {'pulls/' + str(number): self.pull,
            'git/ref/pull/' + str(number) + '/merge': ref('refs/pull/' + str(number) + '/merge', self.current),
            'git/ref/heads/codex%2Fpredecessor': ref('refs/heads/codex/predecessor', self.base),
            'compare/' + self.base + '...' + self.head:
                dict(status='ahead', behind_by=0, ahead_by=13 if number == 633 else 2,
                     merge_base_commit=dict(sha=self.base))}
        self.read = Mock(side_effect=lambda sha: copy.deepcopy(self.objects[sha]))
        self.service = Mock(side_effect=lambda path: copy.deepcopy(self.responses[path]))

    def admit(self):
        kwargs = dict(tree=self.tree, read_commit=self.read)
        # Baseline exercises the actual old ordered-parent rejection, not a TypeError.
        if 'read_service' in inspect.signature(auth.public_candidate).parameters:
            kwargs['read_service'] = self.service
        return auth.public_candidate(self.source, self.parents, self.environment, self.pull, **kwargs)

    def test_retained_633_and_636_shapes_preserve_actual_source(self):
        for number in self.shapes:
            with self.subTest(number=number):
                self.fixture(number)
                result = self.admit()
                self.assertEqual(result['source'], self.source)
                self.assertEqual(result['parents'], self.parents)
                self.assertEqual(result['public_merge_sha'], self.current)
                self.assertTrue(result['prepared_parent_proof'])
                self.assertEqual(set(c.args[0] for c in self.read.call_args_list), set(self.objects))
                self.assertIn('compare/' + self.base + '...' + self.head,
                              [c.args[0] for c in self.service.call_args_list])

    def test_complete_tree_changes_and_requested_object_mismatch_reject(self):
        for owner in ('source', 'current', 'old', 'new', 'base', 'head'):
            for field in ('tree', 'sha', 'parents'):
                with self.subTest(owner=owner, field=field):
                    self.fixture()
                    sha = dict(source=self.source, current=self.current, old=self.parents[0],
                               new=self.objects[self.current]['parents'][0]['sha'], base=self.base, head=self.head)[owner]
                    self.objects[sha][field] = dict(sha='0' * 40) if field == 'tree' else ('0' * 40 if field == 'sha' else None)
                    with self.assertRaises(RuntimeError): self.admit()
        # Root tree identity includes mode, blob, add and delete differences equally.
        for change in ('mode', 'blob', 'addition', 'deletion'):
            self.fixture()
            self.objects[self.parents[0]]['tree']['sha'] = '0' * 40
            with self.subTest(change=change), self.assertRaises(RuntimeError): self.admit()

    def test_order_count_head_and_missing_objects_reject(self):
        for parents in ([], ['1' * 40], ['1' * 40, '2' * 40, '3' * 40], ['head', 'old'], ['old', 'foreign']):
            self.fixture()
            mapping = dict(head=self.head, old=self.parents[0], foreign='0' * 40)
            self.objects[self.current]['parents'] = [dict(sha=mapping.get(p, p)) for p in parents]
            with self.subTest(parents=parents), self.assertRaises(RuntimeError): self.admit()
        self.fixture(); self.read.side_effect = OSError('inert unavailable')
        with self.assertRaises(OSError): self.admit()

    def test_non_stack_unproven_ancestry_and_canonical_refs_reject(self):
        changes = [('stack', None), ('stack', {}), ('position', 1), ('position', 18), ('id', True),
                   ('number', 0), ('status', 'diverged'), ('behind_by', 1), ('ahead_by', 0),
                   ('merge_base_commit', dict(sha='0' * 40)), ('canonical-sha', '0' * 40),
                   ('canonical-type', 'tag'), ('canonical-ref', 'refs/pull/636/merge')]
        for field, value in changes:
            self.fixture()
            if field == 'stack': self.pull['stack'] = value
            elif field in ('position', 'id', 'number'): self.pull['stack'][field] = value
            elif field.startswith('canonical-'):
                obj = self.responses['git/ref/pull/633/merge']
                if field == 'canonical-ref': obj['ref'] = value
                else: obj['object'][field.removeprefix('canonical-')] = value
            else: self.responses['compare/' + self.base + '...' + self.head][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(RuntimeError): self.admit()
        self.fixture(); self.service.side_effect = OSError('inert API uncertain')
        with self.assertRaises(OSError): self.admit()

    def test_final_pin_recheck_rejects_movement_before_any_command(self):
        for changed in ('state', 'head', 'base', 'merge_commit_sha', 'base-ref', 'canonical', 'base-branch'):
            self.fixture(); result = self.admit(); commands = []
            if changed == 'state': self.pull['state'] = 'closed'
            elif changed in ('head', 'base'): self.pull[changed]['sha'] = '0' * 40
            elif changed == 'merge_commit_sha': self.pull[changed] = '0' * 40
            elif changed == 'base-ref': self.pull['base']['ref'] = 'codex/foreign'
            elif changed == 'canonical': self.responses['git/ref/pull/633/merge']['object']['sha'] = '0' * 40
            else: self.responses['git/ref/heads/codex%2Fpredecessor']['object']['sha'] = '0' * 40
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                auth.recheck_candidate(result, self.environment, self.service, self.read)
                commands.append('must-not-launch')
            self.assertEqual(commands, [])


    def test_invalid_pins_are_rejected_before_service_reads(self):
        for field in ('source', 'tree', 'head', 'base'):
            self.fixture()
            if field in ('source', 'tree'): setattr(self, field, '../foreign')
            else:
                self.environment['CANDIDATE_' + field.upper()] = '../foreign'
                self.pull[field]['sha'] = '../foreign'
                if field == 'head': self.parents[1] = '../foreign'
            with self.subTest(field=field), self.assertRaises(RuntimeError): self.admit()
            self.read.assert_not_called(); self.service.assert_not_called()

    def test_controller_proof_race_fails_before_process_or_browser(self):
        self.fixture(); pulls = []
        def request(request, timeout):
            endpoint = request.full_url.split('/repos/arcee-ai/nac/', 1)[1]
            if endpoint.startswith('git/commits/'):
                value = self.objects[endpoint.removeprefix('git/commits/')]
            else:
                value = copy.deepcopy(self.responses[endpoint])
                if endpoint == 'pulls/633':
                    pulls.append(endpoint)
                    if len(pulls) > 1: value['head']['sha'] = '0' * 40
            return io.BytesIO(json.dumps(value).encode())
        def local_git(arguments, **kwargs):
            if arguments == ['git', 'rev-parse', 'HEAD']: return self.source + '\n'
            if arguments == ['git', 'status', '--porcelain']: return ''
            if arguments == ['git', 'show', '-s', '--format=%P', self.source]: return ' '.join(self.parents)
            if arguments == ['git', 'rev-parse', self.source + '^{tree}']: return self.tree + '\n'
            self.fail('Unexpected child in inert controller control')
        with tempfile.TemporaryDirectory(prefix='nac-auth-inert-') as temporary:
            output = Path(temporary) / 'fresh'
            environment = dict(self.environment, GITHUB_TOKEN='inert-controller-token',
                GITHUB_RUN_ID='123', GITHUB_ACTIONS='true', RUNNER_ENVIRONMENT='github-hosted',
                RUNNER_TEMP=temporary)
            with patch.dict(os.environ, environment, clear=True), patch.object(sys, 'argv',
                    ['ci_native_auth.py', str(Path.cwd()), str(output)]), \
                    patch.object(auth, 'urlopen', side_effect=request), \
                    patch.object(auth.subprocess, 'check_output', side_effect=local_git), \
                    patch.object(auth.subprocess, 'Popen') as child, \
                    patch.object(auth, 'record_console') as browser:
                self.assertEqual(auth.main(), 1)
                child.assert_not_called(); browser.assert_not_called()
                self.assertNotIn('GITHUB_TOKEN', os.environ)
            terminal = json.loads((output / 'evidence/TERMINAL.json').read_text())
            self.assertEqual(terminal['commands'], [])
            self.assertIsNone(terminal['browser_identity'])
            self.assertEqual(terminal['failure']['message'], 'Public candidate moved during proof collection')
            self.assertEqual(len(pulls), 2)


    def test_pre_admission_snapshot_preserves_failed_pins_without_an_extra_read(self):
        for scenario in ('valid', 'stale-base', 'missing-head', 'missing-public-merge', 'missing-event-base'):
            with self.subTest(scenario=scenario):
                self.fixture(); requests = []
                self.pull['private_response'] = 'inert-response-secret'
                if scenario == 'stale-base': self.environment['CANDIDATE_BASE'] = '0' * 40
                if scenario == 'missing-head': self.pull['head'].pop('sha')
                if scenario == 'missing-public-merge': self.pull.pop('merge_commit_sha')
                if scenario == 'missing-event-base': self.environment.pop('CANDIDATE_BASE')
                def request(request, timeout):
                    endpoint = request.full_url.split('/repos/arcee-ai/nac/', 1)[1]
                    requests.append(endpoint)
                    if endpoint.startswith('actions/'):
                        raise OSError('inert stop after admission')
                    value = (self.objects[endpoint.removeprefix('git/commits/')]
                             if endpoint.startswith('git/commits/') else self.responses[endpoint])
                    return io.BytesIO(json.dumps(value).encode())
                def local_git(arguments, **kwargs):
                    if arguments == ['git', 'rev-parse', 'HEAD']: return self.source + '\n'
                    if arguments == ['git', 'status', '--porcelain']: return ''
                    if arguments == ['git', 'show', '-s', '--format=%P', self.source]: return ' '.join(self.parents)
                    if arguments == ['git', 'rev-parse', self.source + '^{tree}']: return self.tree + '\n'
                    self.fail('Unexpected child in inert admission control')
                with tempfile.TemporaryDirectory(prefix='nac-auth-inert-') as temporary:
                    output = Path(temporary) / 'fresh'
                    environment = dict(self.environment, GITHUB_TOKEN='inert-controller-secret',
                        ARCEE_API_KEY='inert-provider-secret', UNRELATED='inert-env-secret',
                        GITHUB_RUN_ID='123', GITHUB_ACTIONS='true',
                        RUNNER_ENVIRONMENT='github-hosted', RUNNER_TEMP=temporary)
                    with patch.dict(os.environ, environment, clear=True), patch.object(sys, 'argv',
                            ['ci_native_auth.py', str(Path.cwd()), str(output)]), \
                            patch.object(auth, 'urlopen', side_effect=request), \
                            patch.object(auth.subprocess, 'check_output', side_effect=local_git), \
                            patch.object(auth.subprocess, 'Popen') as child, \
                            patch.object(auth, 'record_console') as browser:
                        self.assertEqual(auth.main(), 1)
                        child.assert_not_called(); browser.assert_not_called()
                    evidence = output / 'evidence'
                    raw = (evidence / 'CANDIDATE-ADMISSION-INPUTS.json').read_text()
                    snapshot = json.loads(raw)
                    self.assertEqual(snapshot, dict(pre_admission_only=True, source=self.source,
                        parents=self.parents, tree=self.tree, expected={key: self.environment.get(key)
                            for key in ('CANDIDATE_PR', 'CANDIDATE_HEAD', 'CANDIDATE_BASE')},
                        public=auth.candidate_pins(self.pull)))
                    self.assertNotIn('secret', raw)
                    terminal = json.loads((evidence / 'TERMINAL.json').read_text())
                    self.assertEqual(terminal['commands'], [])
                    self.assertIsNone(terminal['browser_identity'])
                    if scenario == 'valid':
                        self.assertTrue((evidence / 'CANDIDATE-PROOF.json').exists())
                        self.assertEqual(terminal['failure']['message'], 'inert stop after admission')
                        # Existing final pin recheck is the second GET; snapshot adds none.
                        self.assertEqual(requests.count('pulls/633'), 2)
                    else:
                        self.assertFalse((evidence / 'CANDIDATE-PROOF.json').exists())
                        self.assertEqual(terminal['failure']['message'],
                                         'Checkout is not the current public candidate merge')
                        self.assertEqual(requests, ['pulls/633'])


if __name__ == '__main__':
    unittest.main()
