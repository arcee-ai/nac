"""Portable synthetic lifecycle controls; no Mac, compiler, app or process probe."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import sys
import unittest
from unittest import mock

import ci_lifecycle_contract as c

HEAD = 'a' * 40


def environment():
    return {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_RUN_ATTEMPT': '1',
            'GITHUB_REPOSITORY': 'arcee-ai/nac', 'GITHUB_REF': 'refs/heads/codex/all-344-hosted-lifecycle-qualification',
            'GITHUB_SHA': HEAD, 'GITHUB_RUN_ID': '123'}


def capsule():
    return {'version': 1, 'allocation_id': c.ALLOCATION, 'supplier': c.SOURCE, 'supplier_tree': c.TREE,
            'harness': HEAD, 'repository': 'arcee-ai/nac', 'workflow': 'stable-release.yml',
            'branch': 'codex/all-344-hosted-lifecycle-qualification', 'run_attempt': 1,
            'scenarios': list(c.CASES), 'prior_dispatch_counts': dict.fromkeys(c.CASES, 0),
            'retry_budget': 0, 'production_repair_budget_added': 0,
            'custody_sha256': c.contract()['custody_sha256'], 'admission_nonce': 'f' * 64}


def reservation(name, output):
    return {'source_sha': c.SOURCE, 'harness_sha': HEAD, 'builds_sha256': 'a' * 64,
            'observer_sha256': 'b' * 64, 'command': [sys.executable, '-B', '/MOCK/wrapper', 'driver',
                '/MOCK/supplier', name, '/MOCK/Lifecycle.app', str(output), '/MOCK/observer']}


def build(mode='lifecycle-build'):
    return {**copy.deepcopy(c.contract()['build_modes'][mode]), 'version': 1, 'phase': 'unsigned-build',
            'mode': mode, 'source_head': c.SOURCE, 'source_dirty': False,
            'engine_identity': {'source_revision': c.SOURCE, 'track': 'dev',
                                'build_id': 'dev-ci-lifecycle-' + c.SOURCE},
            'native_sha256': 'native', 'engine_sha256': 'engine', 'info_plist_sha256': 'plist',
            'preview_definitions_excluded': True, 'fixture_markers_absent': ['LifecycleSmoke']}


def case(name='run', receipt=None, assets=None, destination=None, delta=0):
    receipt = receipt or build()
    before = {'confirmation_id': 'FIXTURE-SCHEMA-ONLY', 'sheet_window': 41, 'document': 'DOCUMENT',
              'engine_pid': 12, 'launch_incarnation': 'INCARNATION', 'owners_intact': True,
              'stop_started': False, 'delegate_calls': 1, 'confirmation_decisions': 1,
              'sheet_presentations': 1, 'cancel_choices': 0, 'stop_completions': 0}
    after = dict(before, delegate_calls=1 + delta)
    native = dict.fromkeys(('passed', 'stopped', 'document_released', 'commands_retired', 'close_retained_owners',
                           'reopen_retained_usable_workspace', 'cancel_retained_owners', 'application_will_terminate'), True)
    native.update(instrumentation='LIFECYCLE_SMOKE', application_class='NSApplication', termination_phase='finished(true)',
                  ready_source=c.SOURCE, ready_build=receipt['engine_identity']['build_id'], owned_engine_pid=12,
                  launch_incarnation='INCARNATION', engine_pid=0, workspace_window_count=1,
                  quit_confirmation_decisions=2, quit_sheet_presentations=2, quit_cancel_choices=1,
                  quit_stop_completions=1, quit_delegate_requests=2 + delta,
                  render_captures=['work-ready', 'reopened', 'confirming', 'cancelled'], native_duplicate_returned=True,
                  native_duplicate_delegate_before=1, native_duplicate_delegate_after=1 + delta,
                  native_duplicate_invocation=dict(command='duplicate-quit', id='SYNTHETIC-NOT-RUNTIME',
                      issued=True, began=True, returned=True, outcome='settled', prefix=copy.deepcopy(before),
                      before=before, after=after, began_uptime=100., returned_uptime=100.1,
                      deadline_uptime=105., cancel_dispatched_uptime=100.2))
    if destination:
        native['ready_store'] = str(destination / 'nac-lifecycle-app-fixture' / name / 'selected store.db')
    item = dict.fromkeys(('store_reacquired', 'durable_transcript_preserved', 'durable_goal_preserved',
                         'no_remembered_grants', 'approval_mode_preserved', 'terminal_descendant_stopped',
                         'no_input_or_mutation_replay'), True)
    item.update(scenario=name, native=native, integrity='ok', assets=assets or {}, shutdown_seconds=1.,
                initial_quit_origin='owned OS application request' if name == 'terminal' else 'native app action',
                os_termination_requests=[{'termination_requested': True}] * 2 if name == 'terminal' else [])
    return dict(source_head=c.SOURCE, passed=True, build_receipt=receipt, actual_local_app=True, system_wk=True,
                visible_paint_acceptance=False, trusted_input_acceptance=False,
                console_lock={'observed': True, 'locked': False}, cases=[item])


class CustodyTests(unittest.TestCase):
    def test_exact_capsule_and_closed_negative_controls(self):
        self.assertEqual(c.require_capsule(json.dumps(capsule()), HEAD, environment()), capsule())
        mutations = [('supplier', 'b' * 40), ('supplier_tree', 'b' * 40), ('harness', 'b' * 40),
                     ('allocation_id', 'other'), ('scenarios', ['approval', 'run', 'terminal']),
                     ('scenarios', ['run', 'run', 'terminal']), ('scenarios', ['run']),
                     ('scenarios', list(c.CASES) + ['extra']), ('run_attempt', 2), ('version', True),
                     ('retry_budget', 1), ('production_repair_budget_added', 1), ('admission_nonce', 'not-a-nonce'),
                     ('branch', 'dev'), ('workflow', 'other.yml'), ('repository', 'other/repo'),
                     ('prior_dispatch_counts', {'run': 1, 'approval': 0, 'terminal': 0}),
                     ('prior_dispatch_counts', dict.fromkeys(c.CASES, False)), ('custody_sha256', {})]
        for key, value in mutations:
            with self.subTest(key=key, value=value):
                invalid = capsule()
                invalid[key] = value
                with self.assertRaises(RuntimeError):
                    c.require_capsule(json.dumps(invalid), HEAD, environment())
        for raw in ('', '{}', '[]', 'x' * 8193, json.dumps(capsule())[:-1] + ',"version":1}'):
            with self.subTest(raw=raw[:40]), self.assertRaises(RuntimeError):
                c.require_capsule(raw, HEAD, environment())
        for key in environment():
            invalid = environment()
            invalid[key] = 'wrong'
            with self.subTest(environment=key), self.assertRaises(RuntimeError):
                c.require_capsule(json.dumps(capsule()), HEAD, invalid)

    def test_extra_capsule_keys_and_console_unknown_are_rejected(self):
        invalid = dict(capsule(), command=['arbitrary'])
        with self.assertRaises(RuntimeError):
            c.require_capsule(json.dumps(invalid), HEAD, environment())
        for state in ({}, {'observed': False, 'locked': False}, {'observed': True, 'locked': None},
                      {'observed': True, 'locked': True}, {'observed': 1, 'locked': 0}):
            with self.subTest(state=state), self.assertRaises(RuntimeError):
                c.require_console(state)


class LedgerTests(unittest.TestCase):
    def test_fsync_reservation_precedes_fake_spawn_and_order_never_repeats(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            with mock.patch.object(c.os, 'fsync', wraps=c.os.fsync) as flushed:
                ledger = c.Ledger(root, capsule(), '123')
                try:
                    for name in c.CASES:
                        ledger.reserve(name, root / name, {'observed': True, 'locked': False}, reservation(name, root / name))
                        durable = json.loads((root / 'ledger.json').read_text())
                        self.assertEqual(durable['active_case'], name)
                        self.assertEqual(durable['cases'][name]['dispatches'], 1)
                        self.assertGreaterEqual(flushed.call_count, 4)  # data+rename directory flushed
                        with self.assertRaises(RuntimeError):
                            ledger.reserve(name, root / (name + '-again'), {'observed': True, 'locked': False}, reservation(name, root / (name + '-again')))
                        ledger.finish(name, 'passed', {'synthetic': True})
                    with self.assertRaises((FileExistsError, RuntimeError)):
                        c.Ledger(root, capsule(), '123')
                finally:
                    ledger.close()

    def test_failure_unknown_reorder_existing_output_and_tamper_stop(self):
        for state in ('failed', 'unknown'):
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp).resolve()
                ledger = c.Ledger(root, capsule(), '123')
                try:
                    with self.assertRaises(RuntimeError):
                        ledger.reserve('approval', root / 'approval', {'observed': True, 'locked': False}, reservation('approval', root / 'approval'))
                    ledger.reserve('run', root / 'run', {'observed': True, 'locked': False}, reservation('run', root / 'run'))
                    ledger.finish('run', state, {})
                    for name in ('run', 'approval', 'terminal', 'extra'):
                        with self.subTest(state=state, next=name), self.assertRaises(RuntimeError):
                            ledger.reserve(name, root / (name + '-next'), {'observed': True, 'locked': False}, reservation(name, root / (name + '-next')))
                finally:
                    ledger.close()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            ledger = c.Ledger(root, capsule(), '123')
            try:
                (root / 'run').mkdir()
                with self.assertRaises(RuntimeError):
                    ledger.reserve('run', root / 'run', {'observed': True, 'locked': False}, reservation('run', root / 'run'))
                self.assertEqual(ledger.value['cases']['run']['dispatches'], 0)
                (root / 'ledger.json').write_text('{}')
                with self.assertRaises(RuntimeError):
                    ledger.save()
            finally:
                ledger.close()


class SourceAndBuildTests(unittest.TestCase):
    def test_source_dirty_tree_hash_symlink_and_overlap(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            source, harness = root / 'supplier', root / 'harness'
            source.mkdir()
            harness.mkdir()
            path = source / 'owned.py'
            path.write_bytes(b'fixture-source-only')
            spec = {'files': {'owned.py': c.digest(path)}, 'preserved_blobs': {'owned.py': 'c' * 40}}
            def git(args, **_kwargs):
                return (c.TREE if args[1] == 'rev-parse' else 'c' * 40) + '\n'
            with mock.patch.object(c, 'contract', return_value=spec), mock.patch.object(c, 'require_checkout') as clean, \
                    mock.patch.object(c.subprocess, 'check_output', side_effect=git):
                c.require_source(source, harness)
                clean.side_effect = RuntimeError('dirty')
                with self.assertRaises(RuntimeError):
                    c.require_source(source, harness)
                clean.side_effect = None
                path.write_text('changed')
                with self.assertRaises(RuntimeError):
                    c.require_source(source, harness)
                with self.assertRaises(RuntimeError):
                    c.require_source(source, source)
            alias = root / 'alias'
            alias.symlink_to(source)
            with self.assertRaises(RuntimeError):
                c.require_source(alias, harness)
            with mock.patch.object(c, 'require_checkout'), mock.patch.object(c.subprocess, 'check_output', return_value='0' * 40):
                with self.assertRaises(RuntimeError):
                    c.require_source(source, harness)

    def test_all_five_build_receipts_bind_bytes_and_reject_instrumentation_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            for mode, name in c.MODES.items():
                app = root / name
                for member, data in [('MacOS/NACPreview', b'fake native'), ('Resources/nac-web', b'fake engine'),
                                     ('Info.plist', b'fake plist')]:
                    path = app / 'Contents' / member
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(data)
                value = build(mode)
                for key, member in [('native_sha256', 'MacOS/NACPreview'), ('engine_sha256', 'Resources/nac-web'),
                                    ('info_plist_sha256', 'Info.plist')]:
                    value[key] = c.digest(app / 'Contents' / member)
                receipt = app / 'Contents/Resources/build-receipt.json'
                receipt.write_text(json.dumps(value))
                c.require_build(mode, app, root, value['engine_sha256'])
                for key, bad in [('source_dirty', True), ('source_head', 'b' * 40), ('mode', 'other'),
                                 ('lifecycle_smoke_instrumentation', not value['lifecycle_smoke_instrumentation']),
                                 ('native_source_files', {}), ('compiler_flags', [])]:
                    changed = dict(value, **{key: bad})
                    receipt.write_text(json.dumps(changed))
                    with self.subTest(mode=mode, key=key), self.assertRaises(RuntimeError):
                        c.require_build(mode, app, root, value['engine_sha256'])
                receipt.write_text(json.dumps(value))
                (app / 'Contents/Resources/nac-web').write_text('different engine')
                with self.assertRaises(RuntimeError):
                    c.require_build(mode, app, root, value['engine_sha256'])


class SemanticTests(unittest.TestCase):
    def test_positive_callback_counts_are_observations_and_three_origins(self):
        for name in c.CASES:
            for delta in (0, 1):
                c.require_case(case(name, delta=delta), name, build(), {})

    def test_negative_semantics_cannot_be_passed_by_a_boolean(self):
        changes = [(['passed'], False), (['source_head'], 'b' * 40), (['cases'], []),
                   (['console_lock', 'locked'], None), (['cases', 0, 'scenario'], 'extra'),
                   (['cases', 0, 'store_reacquired'], False), (['cases', 0, 'no_remembered_grants'], False),
                   (['cases', 0, 'terminal_descendant_stopped'], False), (['cases', 0, 'no_input_or_mutation_replay'], False),
                   (['cases', 0, 'native', 'document_released'], False), (['cases', 0, 'native', 'quit_stop_completions'], 2),
                   (['cases', 0, 'native', 'ready_source'], 'b' * 40), (['cases', 0, 'native', 'owned_engine_pid'], 999),
                   (['cases', 0, 'native', 'application_will_terminate'], False),
                   (['cases', 0, 'native', 'native_duplicate_invocation', 'outcome'], 'unknown'),
                   (['cases', 0, 'native', 'native_duplicate_invocation', 'returned'], False),
                   (['cases', 0, 'native', 'native_duplicate_invocation', 'cancel_dispatched_uptime'], 99.),
                   (['cases', 0, 'native', 'native_duplicate_invocation', 'returned_uptime'], 106.),
                   (['cases', 0, 'native', 'native_duplicate_invocation', 'returned_uptime'], float('nan')),
                   (['cases', 0, 'native', 'native_duplicate_invocation', 'after', 'confirmation_id'], 'other'),
                   (['cases', 0, 'native', 'native_duplicate_invocation', 'before', 'sheet_window'], -1),
                   (['cases', 0, 'native', 'native_duplicate_invocation', 'after', 'owners_intact'], False)]
        for path, value in changes:
            invalid = case()
            node = invalid
            for key in path[:-1]:
                node = node[key]
            node[path[-1]] = value
            with self.subTest(path=path), self.assertRaises(RuntimeError):
                c.require_case(invalid, 'run', build(), {})
        value = case('terminal')
        value['cases'][0]['os_termination_requests'] = []
        with self.assertRaises(RuntimeError):
            c.require_case(value, 'terminal', build(), {})


if __name__ == '__main__':
    unittest.main()
