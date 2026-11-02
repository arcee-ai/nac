"""Pure protocol/oracle/source controls; no listener, model, app or SDK."""
import ast
import copy
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


class ProtocolControls(unittest.TestCase):
    def goal(self, protocol, token):
        protocol.register(token, 'goal')
        protocol.bind_goal(token, 'goal-' + token, 'run-' + token)
        first = protocol.accept(body(token))
        self.assertEqual(first[1]['name'], 'read')
        read = ('read-' + token, '1: ' + MARKER)
        second = protocol.accept(body(token, [read]))
        self.assertEqual(second[1]['name'], 'update_goal')
        mark = dict(goal_id='goal-' + token, accounting_run_id='run-' + token, status='complete', version=7)
        last = protocol.accept(body(token, [read, ('mark-' + token, json.dumps(mark))]))
        self.assertEqual(last[2], [token + ':final-tail'])
        self.assertEqual(protocol.marks[token], mark)

    def test_planned_matrix_is_fourteen_real_model_steps_without_extra_goal_calls(self):
        p = Protocol('/owned/semantic-marker.txt')
        for behavior in BEHAVIORS:
            token = 'FIRST_' + behavior
            p.register(token)
            self.assertEqual(p.accept(body(token))[1]['type'], 'message')
        for behavior in BEHAVIORS[1:]:
            token = 'GOAL_' + behavior
            self.goal(p, token)
            queued = 'QUEUE_' + behavior
            p.register(queued, 'queue', parent=token)
            result = p.accept(body(queued + ' ' + token))
            self.assertEqual(result[0], queued)
            self.assertEqual(result[2], [queued + ':finish-B'])
        for behavior in BEHAVIORS:
            token = 'OFFLINE_' + behavior
            p.register(token)
            p.accept(body(token))
        self.assertEqual(len(p.requests), 14)
        self.assertEqual(len(p.marks), 2)

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
        source = ast.parse((HERE / 'attention_semantic_app_smoke.py').read_text())
        run = next(node for node in source.body if isinstance(node, ast.FunctionDef)
                   and node.name == 'run_contract')
        root = next(node for node in ast.walk(run) if isinstance(node, ast.Assign)
                    and any(isinstance(target, ast.Name) and target.id == 'root'
                            for target in node.targets))
        cleanup = next(node for node in ast.walk(run) if isinstance(node, ast.Expr)
                       and isinstance(node.value, ast.Call)
                       and 'AttentionFixtureCleanup' in ast.unparse(node))
        helper = (HERE / 'AttentionFixtureCleanup.swift').read_text()
        prefix = re.search(r'root.lastPathComponent.hasPrefix\("([^"]+)"\)', helper).group(1)
        calls = []
        with tempfile.TemporaryDirectory() as destination:
            scope = dict(Path=Path, tempfile=tempfile, destination=Path(destination),
                         observer=Path('/owned/AttentionAppObserver'), environment={},
                         subprocess=SimpleNamespace(run=lambda *args, **kwargs: calls.append((args, kwargs))))
            exec(compile(ast.Module(body=[root, cleanup], type_ignores=[]),
                         'actual semantic caller allocation and cleanup call', 'exec'), scope)
            actual = Path(calls[0][0][0][1])
            self.assertEqual(actual, scope['root'])
            self.assertEqual(calls[0][0][0][0], '/owned/AttentionFixtureCleanup')
            self.assertTrue(actual.name.startswith(prefix), 'S2_CALLER_PREFIX_EXPECTED')
            self.assertEqual(actual.stat().st_mode & 0o077, 0)
        self.assertFalse('nac-attention-semantic-foreign'.startswith(prefix))
        for guard in ['root.resolvingSymlinksInPath() == root', 'lstat(root.path, &status)',
                      'status.st_uid == getuid()', 'status.st_mode & 0o077 == 0',
                      'input.home == home.path', 'input.receipt.store == store.path',
                      'WorkspaceStorageProfile(receipt:', 'remove(forIdentifier: profile.identifier)']:
            self.assertIn(guard, helper)

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
