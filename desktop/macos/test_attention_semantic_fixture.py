"""Pure protocol/oracle/source controls; no listener, model, app or SDK."""
import ast
import copy
import hashlib
import io
import json
import re
import tempfile
from types import SimpleNamespace
from pathlib import Path
import unittest

from attention_semantic_fixture import BEHAVIORS, MARKER, Protocol

HERE = Path(__file__).resolve().parent


def body(token, outputs=()):
    return dict(input=[dict(role='user', content=token),
                       *[dict(type='function_call_output', call_id=call, output=value) for call, value in outputs]],
                tools=[dict(type='function', name=name) for name in ('read', 'update_goal')], stream=True)


def goal_prompt(token):
    owner = (HERE.parent.parent / 'crates/nac-core/src/session_service.rs').read_text()
    literal = re.search(r'format!\(\s*("(?:\\.|[^"\\])*"),\s*goal\.goal_id, goal\.objective, budget',
                        owner).group(1)
    return json.loads(literal).format('fixture-goal', token + ': read semantic-marker.txt before completing.',
                                      'No token budget was set.')


class ProtocolControls(unittest.TestCase):
    def test_actual_goal_continuation_wrapper_selects_real_caller_token(self):
        caller = (HERE / 'attention_semantic_app_smoke.py').read_text()
        self.assertIn("token = 'SEMANTIC_GOAL_' + behavior", caller)
        token = 'SEMANTIC_GOAL_direct'
        prompt = goal_prompt(token)
        self.assertIn('\n' + token + ':', prompt)
        protocol = Protocol('/owned/semantic-marker.txt')
        protocol.register(token, 'goal')
        selected, item, gates, _ = protocol.accept(body(prompt))
        self.assertEqual(selected, token)
        self.assertEqual(item['name'], 'read')
        self.assertEqual(gates, [token + ':allow-read'])

    def goal(self, protocol, token):
        protocol.register(token, 'goal')
        prompt = goal_prompt(token)
        first = protocol.accept(body(prompt))
        self.assertEqual(first[1]['name'], 'read')
        self.assertEqual(first[2], [token + ':allow-read'])
        protocol.bind_goal(token, 'goal-' + token, 'run-' + token)
        read = ('read-' + token, '1: ' + MARKER)
        second = protocol.accept(body(prompt, [read]))
        self.assertEqual(second[1]['name'], 'update_goal')
        self.assertEqual(json.loads(second[1]['arguments']), dict(goal_id='goal-' + token, status='complete'))
        mark = dict(goal_id='goal-' + token, accounting_run_id='run-' + token, status='complete', version=7)
        last = protocol.accept(body(prompt, [read, ('mark-' + token, json.dumps(mark))]))
        self.assertEqual(last[2], [token + ':final-tail'])
        self.assertEqual(protocol.marks[token], mark)

    def test_planned_matrix_is_fourteen_real_model_steps_without_extra_goal_calls(self):
        p = Protocol('/owned/semantic-marker.txt')
        caller = (HERE / 'attention_semantic_app_smoke.py').read_text()
        for label in ['FIRST', 'OFFLINE']:
            self.assertIn("request_case(behavior, '" + label + "')", caller)
        self.assertIn("token = 'SEMANTIC_' + label + '_' + behavior", caller)
        self.assertIn("queued = 'SEMANTIC_QUEUE_' + behavior", caller)
        for behavior in BEHAVIORS:
            token = 'SEMANTIC_FIRST_' + behavior
            p.register(token)
            self.assertEqual(p.accept(body(token))[1]['type'], 'message')
        for behavior in BEHAVIORS[1:]:
            token = 'SEMANTIC_GOAL_' + behavior
            self.goal(p, token)
            queued = 'SEMANTIC_QUEUE_' + behavior
            p.register(queued, 'queue', parent=token)
            result = p.accept(dict(body(queued), input=[dict(role='user', content=goal_prompt(token)),
                                                       dict(role='user', content=queued)]))
            self.assertEqual(result[0], queued)
            self.assertEqual(result[2], [queued + ':finish-B'])
        for behavior in BEHAVIORS:
            token = 'SEMANTIC_OFFLINE_' + behavior
            p.register(token)
            p.accept(body(token))
        self.assertEqual(len(p.requests), 14)
        self.assertEqual(len(p.marks), 2)
        p.register('SEMANTIC_EXTRA')
        with self.assertRaisesRegex(AssertionError, 'Matrix model call bound exceeded'):
            p.accept(body('SEMANTIC_EXTRA'))

    def test_decoded_leaf_boundaries_and_direct_suffixes(self):
        direct = 'SEMANTIC_GOAL_direct'
        dwo = direct + '-with-orchestrator'
        for prefix in ['\n', '\r\n', '\t', '"', "'"]:
            for token in [direct, dwo]:
                with self.subTest(prefix=repr(prefix), token=token):
                    p = Protocol('/owned/marker')
                    p.register(direct, 'goal');p.register(dwo, 'goal')
                    request = body(prefix + token + ': objective')
                    request['input'][0]['content'] = [dict(type='input_text', text=prefix + token + ': objective')]
                    self.assertEqual(p.accept(request)[0], token)
        p = Protocol('/owned/marker');p.register(direct, 'goal')
        request = body('unused');request['input'][0]['content'] = ['n', direct]
        self.assertEqual(p.accept(request)[0], direct, 'Individual leaves must not be concatenated')

    def test_embedded_unknown_ambiguous_key_only_and_split_tokens_fail_closed(self):
        token = 'SEMANTIC_GOAL_direct'
        other = 'SEMANTIC_GOAL_direct-with-orchestrator'
        for text in [r'\n' + token, 'a' + token, token + 'a', '0' + token, token + '0',
                     '_' + token, token + '_', '-' + token, token + '-', 'unknown', token + ' ' + other]:
            p = Protocol('/owned/marker');p.register(token, 'goal');p.register(other, 'goal')
            with self.subTest(text=text), self.assertRaisesRegex(AssertionError, 'Unknown/ambiguous'):
                p.accept(body(text))
            self.assertEqual(p.requests, [])
        for request in [dict(body('unknown'), **{token: 'unknown'}),
                        dict(body('unknown'), input=[dict(content=[token[:12], token[12:]])])]:
            p = Protocol('/owned/marker');p.register(token, 'goal')
            with self.assertRaisesRegex(AssertionError, 'Unknown/ambiguous'):
                p.accept(request)

    def test_marked_queue_cannot_claim_an_unrelated_parent(self):
        p = Protocol('/owned/marker')
        direct = 'SEMANTIC_GOAL_direct';dwo = direct + '-with-orchestrator'
        self.goal(p, direct);p.register(dwo, 'goal')
        queued = 'SEMANTIC_QUEUE_direct';p.register(queued, 'queue', parent=direct)
        with self.assertRaisesRegex(AssertionError, 'Wrong queued-goal context'):
            p.accept(body(queued + ' ' + dwo))

    def test_discrimination_is_bounded_read_only_and_does_not_double_decode(self):
        token = 'SEMANTIC_GOAL_direct';p = Protocol('/owned/marker');p.register(token, 'goal')
        request = body(goal_prompt(token))
        request.update(credentials='PRIVATE_SENTINEL_' * 1000, headers=dict(Authorization='PRIVATE_HEADER'))
        request['input'].append(dict(role=['unexpected'], type=dict(unexpected=True), content='PRIVATE_CONTENT'))
        request['tools'].extend(dict(name='invalid tool name ' * 100) for _ in range(40))
        before = copy.deepcopy(p.scripts)
        wire = json.dumps(request, indent=2).encode()
        diagnostic = p.discrimination(request, wire)
        self.assertEqual(p.scripts, before);self.assertEqual(p.requests, []);self.assertEqual(p.marks, {})
        self.assertFalse(any(event.is_set() for event in p.events.values()))
        self.assertEqual(diagnostic['matched_tokens'], [token])
        self.assertEqual(diagnostic['expected_steps'], {token: 0})
        self.assertEqual(diagnostic['body_bytes'], len(wire))
        self.assertEqual(diagnostic['body_sha256'], hashlib.sha256(wire).hexdigest())
        self.assertEqual(diagnostic['body_encoding'], 'wire')
        self.assertEqual(diagnostic['input_roles'], dict(user=1, other=1))
        self.assertIn('read', diagnostic['tool_names']);self.assertIn('update_goal', diagnostic['tool_names'])
        encoded = json.dumps(diagnostic)
        self.assertLess(len(encoded), 8192)
        for private in ['PRIVATE_SENTINEL', 'PRIVATE_HEADER', 'PRIVATE_CONTENT', 'invalid tool name']:
            self.assertNotIn(private, encoded)
        self.assertEqual(p.discrimination(body(r'\n' + token))['matched_token_count'], 0)
        other = Protocol('/owned/marker');other.register(token, 'goal')
        # Diagnostics may not change the acceptance of the same decoded request.
        clean = body(goal_prompt(token));p.discrimination(clean)
        self.assertEqual(p.accept(clean)[:3], other.accept(clean)[:3])

    def test_actual_rejection_handler_records_metadata_without_listener_or_body(self):
        token = 'SEMANTIC_GOAL_direct';p = Protocol('/owned/marker');p.register(token, 'goal')
        request = body('PRIVATE_REJECTED_PROMPT');wire = json.dumps(request).encode();saved = []
        owner = SimpleNamespace(protocol=p, errors=['prior error'], save=lambda op, value: saved.append((op, value)))
        tree = ast.parse((HERE / 'attention_semantic_fixture.py').read_text())
        handler = next(node for node in ast.walk(tree) if isinstance(node, ast.ClassDef) and node.name == 'Handler')
        method = next(node for node in handler.body if isinstance(node, ast.FunctionDef) and node.name == 'do_POST')
        scope = dict(json=json, owner=owner)
        exec(compile(ast.Module(body=[method], type_ignores=[]), 'actual rejection handler only', 'exec'), scope)
        errors = []
        actor = SimpleNamespace(connection=SimpleNamespace(settimeout=lambda value: None), path='/responses',
                                headers={'Authorization': 'Bearer attention-semantic-dummy-only', 'Content-Length': str(len(wire))},
                                rfile=io.BytesIO(wire), send_error=errors.append)
        scope['do_POST'](actor)
        self.assertEqual(errors, [500]);self.assertEqual(len(owner.errors), 2)
        self.assertEqual(owner.errors[0], 'prior error')
        self.assertEqual(saved[0][0], 'model-error')
        logged = saved[0][1]
        self.assertEqual(logged['error_class'], 'AssertionError')
        self.assertEqual(logged['discrimination']['matched_token_count'], 0)
        self.assertEqual(logged['discrimination']['body_sha256'], hashlib.sha256(wire).hexdigest())
        self.assertNotIn('PRIVATE_REJECTED_PROMPT', json.dumps(logged))
        self.assertEqual(p.requests, []);self.assertEqual(p.scripts[token]['calls'], 0)
        self.assertEqual(p.marks, {});self.assertFalse(any(e.is_set() for e in p.events.values()))

    def test_read_error_missing_or_duplicate_call_cannot_mark_goal(self):
        for outputs in [[], [('wrong', MARKER)], [('read-A', 'Error: ' + MARKER)],
                        [('read-A', json.dumps(dict(error=MARKER)))],
                        [('read-A', MARKER), ('read-A', MARKER)]]:
            p = Protocol('/owned/marker');p.register('A', 'goal');p.bind_goal('A', 'g', 'r')
            p.accept(body('A'))
            with self.assertRaises(AssertionError):p.accept(body('A', outputs))
            self.assertEqual(p.marks, {})

    def test_exact_goal_accounting_run_status_version_and_result_call_are_required(self):
        good = dict(goal_id='g', accounting_run_id='r', status='complete', version=9)
        for key, bad in [('goal_id', 'other'), ('accounting_run_id', 'newer'),
                         ('status', 'active'), ('version', True), ('version', -1)]:
            p = Protocol('/owned/marker');p.register('A', 'goal');p.bind_goal('A', 'g', 'r')
            p.accept(body('A'));p.accept(body('A', [('read-A', MARKER)]))
            mark = dict(good);mark[key] = bad
            with self.assertRaises(AssertionError):
                p.accept(body('A', [('read-A', MARKER), ('mark-A', json.dumps(mark))]))

    def test_unknown_repeated_wrong_queue_and_missing_tools_fail_closed(self):
        p = Protocol('/owned/marker');p.register('A')
        with self.assertRaises(AssertionError):p.accept(body('unknown'))
        p.accept(body('A'))
        with self.assertRaises(AssertionError):p.accept(body('A'))
        p = Protocol('/owned/marker');p.register('G', 'goal')
        with self.assertRaises(AssertionError):p.accept(dict(input=[dict(content='G')], tools=[]))
        p.register('B', 'queue', parent='G')
        with self.assertRaises(AssertionError):p.accept(body('G B'))
        with self.assertRaises(AssertionError):p.register('other', 'queue', parent='absent')


class NativeOracleControls(unittest.TestCase):
    def test_actual_caller_root_and_cleanup_argument_obey_real_helper_namespace(self):
        import os
        from attention_reset_readout import ResetReadout
        source = ast.parse((HERE / 'attention_semantic_app_smoke.py').read_text())
        run = next(node for node in source.body if isinstance(node, ast.FunctionDef)
                   and node.name == 'run_contract')
        root = next(node for node in ast.walk(run) if isinstance(node, ast.Assign)
                    and any(isinstance(target, ast.Name) and target.id == 'root' for target in node.targets))
        owned = next(node for node in ast.walk(run) if isinstance(node, ast.Assign)
                     and any(isinstance(target, ast.Name) and target.id == 'owned' for target in node.targets))
        cleanup = next(node for node in ast.walk(run) if isinstance(node, ast.Assign)
                       and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name)
                       and node.value.func.id == 'cleanup_fixture')
        helper = (HERE / 'AttentionFixtureCleanup.swift').read_text()
        capability = (HERE / 'AttentionFixtureRoot.swift').read_text()
        prefix = re.search(r'root.lastPathComponent.hasPrefix\("([^"]+)"\)', capability).group(1)
        calls = []
        with tempfile.TemporaryDirectory() as destination:
            scope = dict(Path=Path, tempfile=tempfile, destination=Path(destination), ResetReadout=ResetReadout,
                         observer=Path('/owned/AttentionAppObserver'), environment={}, evidence={},
                         cleanup_fixture=lambda *args: calls.append(args) or {})
            try:
                exec(compile(ast.Module(body=[root, owned, cleanup], type_ignores=[]),
                             'actual semantic caller allocation and cleanup call', 'exec'), scope)
                actual = calls[0][0].root
                self.assertEqual(actual, scope['root'])
                self.assertEqual(str(calls[0][1]), '/owned/AttentionFixtureCleanup')
                self.assertEqual(os.fstat(calls[0][0].fd).st_ino, actual.stat().st_ino)
                self.assertTrue(actual.name.startswith(prefix), 'S2_CALLER_PREFIX_EXPECTED')
                self.assertEqual(actual.stat().st_mode & 0o077, 0)
            finally:
                if 'owned' in scope: scope['owned'].close()
        self.assertFalse('nac-attention-semantic-foreign'.startswith(prefix))
        for guard in ['input.home == home.path', 'input.receipt.store == store.path',
                      'WorkspaceStorageProfile(receipt:', 'remove(forIdentifier: profile.identifier)',
                      'fixture.readInput()', 'fixture.complete']:
            self.assertIn(guard, helper)
        for guard in ['root.resolvingSymlinksInPath() == root', 'lstat(root.path, &named)',
                      'held.st_uid == getuid()', 'held.st_mode & 0o777 == 0o700',
                      'fstatat(parentDescriptor', 'linkat(descriptor']:
            self.assertIn(guard, capability)

    def setUp(self):
        source = ast.parse((HERE / 'attention_semantic_app_smoke.py').read_text())
        oracles = [node for node in source.body if isinstance(node, ast.FunctionDef)
                   and node.name in ('audit_matches', 'deliveries_match')]
        scope = {}
        exec(compile(ast.Module(body=oracles, type_ignores=[]), 'native audit oracle only', 'exec'), scope)
        self.check = scope['audit_matches']
        self.deliveries = scope['deliveries_match']
        self.expected = [dict(store='store', sequence=1, session='s', run='a', behavior='direct', kind='goal', goal='g', mark_version=7),
                         dict(store='store', sequence=2, session='s', run='b', behavior='direct', kind='request', goal=None, mark_version=None)]
        self.items = [dict(want, store='store', sequence=index, native_generation=1,
                          transport_generation=2, accepted_frontier='store:' + str(index), unread=index)
                      for index, want in enumerate(self.expected, 1)]

    def test_exact_mark_not_later_goal_version_and_distinct_B(self):
        self.check(self.items, self.expected)
        for index, key, value in [(0, 'mark_version', 8), (0, 'goal', 'replacement'),
                                  (0, 'run', 'b'), (1, 'kind', 'goal'), (1, 'session', 'other'),
                                  (1, 'behavior', 'orchestrator')]:
            wrong = copy.deepcopy(self.items);wrong[index][key] = value
            with self.assertRaises(AssertionError):self.check(wrong, self.expected)

    def test_duplicate_foreign_store_frontier_or_generation_is_not_count_success(self):
        for change in [dict(store='other', accepted_frontier='other:2'), dict(sequence=1, accepted_frontier='store:1'),
                       dict(accepted_frontier='store:99'), dict(native_generation=2), dict(unread=1)]:
            wrong = copy.deepcopy(self.items);wrong[1].update(change)
            with self.assertRaises(AssertionError):self.check(wrong, self.expected)
        with self.assertRaises(AssertionError):self.check(self.items[:1], self.expected)

    def test_content_free_schema_rejects_payload_extension(self):
        wrong = copy.deepcopy(self.items);wrong[0]['prompt'] = 'unexpected content'
        with self.assertRaises(AssertionError):self.check(wrong, self.expected)

    def test_mock_delivery_is_exact_target_title_and_distinct_identifier_not_just_count(self):
        deliveries = [dict(session=item['session'], occurrence=item['accepted_frontier'],
                           identifier='nac-attention-' + str(index) * 64,
                           title='Goal completed' if item['kind'] == 'goal' else 'Request completed')
                      for index, item in enumerate(self.items)]
        state = dict(attention=dict(accepted_items=self.items), center=dict(adds=2, deliveries=deliveries))
        self.deliveries(state, self.expected)
        for key, value in [('session', 'other'), ('occurrence', 'store:wrong'),
                           ('identifier', deliveries[0]['identifier']), ('title', 'Goal completed')]:
            wrong = copy.deepcopy(state);wrong['center']['deliveries'][1][key] = value
            with self.assertRaises(AssertionError):self.deliveries(wrong, self.expected)

    def test_shipping_owner_contains_no_unconditional_fixture_audit_or_pause(self):
        text = (HERE / 'NativeAttentionCoordinator.swift').read_text()
        # This owner uses only PREVIEW_SMOKE/ATTENTION_SMOKE conditionals.
        def stripped(enabled):
            keep = [True];out = []
            for line in text.splitlines():
                flag = line.strip()
                if flag.startswith('#if '):keep.append(keep[-1] and flag[4:] in enabled)
                elif flag == '#else':keep[-1] = keep[-2] and not keep[-1]
                elif flag == '#endif':keep.pop()
                elif keep[-1]:out.append(line)
            return '\n'.join(out)
        for enabled in [set(), {'PREVIEW_SMOKE'}]:
            normal = stripped(enabled)
            for name in ('observationPaused', 'acceptedItems', 'smokeObservation', 'audit(item'):
                self.assertNotIn(name, normal)
        fixture = stripped({'PREVIEW_SMOKE', 'ATTENTION_SMOKE'})
        self.assertIn('smokeObservation', fixture)
        self.assertIn('audit(item', fixture)


if __name__ == '__main__':
    unittest.main(verbosity=2)
