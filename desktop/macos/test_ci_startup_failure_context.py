"""Actual strict Python ingestion and source-derived inert Swift projections; no Swift execution."""
import copy
import json
from pathlib import Path
import re
import unittest

import ci_startup_ax as parent
import test_ci_startup_ax_diagnostics as fixtures

SOURCE = Path(__file__).with_name('CIStartupAXWitness.swift')
TERMINALS = {'application_timeout', 'windows_unavailable', 'root_matches', 'root_children',
    'root_sheet_count', 'panel_children', 'nested_sheet_count', 'owned_pid', 'foreign_window',
    'incarnation_binding', 'focus_unavailable'}  # Verified against immutable Qba.


def closing_projection(nodes, target, *, windows=None, latched=None, retired=None):
    """Labeled scalar snapshot port; source fences below bind fields, not a Swift runtime."""
    apps = [node for node in nodes if node.get('kind') == 'app']
    app = apps[0] if len(apps) == 1 else None
    actual = app.get('windows') if app else None
    typed = type(actual) is list and all(type(n) is int for n in actual)
    return dict(complete=True, target_fields_valid=True, target_uid_matches_helper=True,
        app_count=len(apps), process_equal=bool(app and app.get('identity') == target),
        windows_typed=typed, window_count=len(actual) if typed else 0,
        original_present=typed and 42 in actual, exact_original_singleton=typed and actual == [42],
        latched=latched or 'none', retired_inventory_typed=retired is not None,
        retirement_matches=sum(row.get('proof') == 'kill_zero_ESRCH' and row.get('identity') == target
                               for row in retired or []))


class ContextParserControls(unittest.TestCase):
    setUp = fixtures.AXFailureDiagnosticsTests.setUp
    read = fixtures.AXFailureDiagnosticsTests.read
    def context(self):
        return closing_projection([{'kind': 'app', 'identity': 'original', 'windows': [42, 43]}], 'original', retired=[])

    def value(self):
        return dict(self.row, stage='closing_lifetime',
            first_counter_transition=dict(cause='ax_predicate_refused', sequence='2', generation_before='0',
                                          reader_terminal='incarnation_binding'),
            closing_lifetime_context=self.context())

    def test_valid_context_stays_failure_only(self):
        value = self.value()
        self.assertEqual(self.read(value), value)
        self.assertFalse(self.read(value)['acceptance'])
        for field in ('first_counter_transition', 'closing_lifetime_context'):
            value = self.value(); value.pop(field)
            self.assertEqual(self.read(value), value)

    def test_lifetime_retains_only_first_counter_and_never_stale_closing_context(self):
        value = self.value(); value['stage'] = 'lifetime'
        value.pop('closing_lifetime_context')
        self.assertEqual(self.read(value), value)
        self.assertFalse(self.read(value)['acceptance'])
        self.assertIsNone(self.read(dict(value, closing_lifetime_context=self.context())))
        self.assertIsNone(self.read(dict(value, pre_refusal_paired={})))
        self.assertIsNone(self.read(dict(value, first_counter_transition={
            **value['first_counter_transition'], 'reader_terminal': 'PRIVATE-CANARY'})))
        old = dict(value); old.pop('first_counter_transition')
        self.assertEqual(self.read(old), old)  # Missing proof remains missing.

    def test_all_counter_causes_and_verified_reader_terminals(self):
        for cause in parent._COUNTER_CAUSES:
            value = self.value(); first = value['first_counter_transition']
            first['cause'] = cause; first.pop('reader_terminal')
            self.assertEqual(self.read(value), value)
        for terminal in TERMINALS:
            value = self.value(); value['first_counter_transition']['reader_terminal'] = terminal
            self.assertEqual(self.read(value), value)

    def test_unknown_private_or_wrong_typed_first_transition_never_exports(self):
        changes = [{'cause': 'SECRET-CANARY'}, {'sequence': True}, {'sequence': '01'}, {'sequence': '-1'},
                   {'sequence': str(2**64)}, {'sequence': '5'}, {'generation_before': '1'},
                   {'generation_before': False}, {'reader_terminal': 'SECRET-CANARY'},
                   {'extra': 'SECRET-CANARY'}, {'cause': 'sample_deadline'}]
        for change in changes:
            value = self.value(); value['first_counter_transition'].update(change)
            with self.subTest(change=change): self.assertIsNone(self.read(value))
        for generation in ('0',):
            self.assertIsNone(self.read(dict(self.value(), refusal_generation=generation)))
        value = self.value(); del value['first_counter_transition']['cause']
        self.assertIsNone(self.read(value))

    def test_closing_counts_types_scopes_and_unknown_fields_are_closed(self):
        changes = [{'app_count': True}, {'window_count': True}, {'retirement_matches': False},
                   {'app_count': 129}, {'window_count': -1}, {'retirement_matches': 2**64},
                   {'complete': 1}, {'process_equal': 'true'}, {'latched': 'SECRET-CANARY'},
                   {'private': 'SECRET-CANARY'}, {'windows_typed': False}, {'app_count': 0},
                   {'exact_original_singleton': True}, {'retired_inventory_typed': False, 'retirement_matches': 1}]
        for change in changes:
            value = self.value(); value['closing_lifetime_context'].update(change)
            with self.subTest(change=change): self.assertIsNone(self.read(value))
        for stage in parent.DIAGNOSTIC_STAGES - {'closing_lifetime'}:
            self.assertIsNone(self.read(dict(self.value(), stage=stage)))
        self.assertIsNone(self.read(dict(self.value(), pre_refusal_paired={})))
        value = self.value(); del value['closing_lifetime_context']['complete']
        self.assertIsNone(self.read(value))

    def test_supplied_absent_multiple_replaced_extra_window_and_retired_operands(self):
        variants = [([], None, []),
            ([{'kind': 'app', 'identity': 'other', 'windows': [42]}], None, []),
            ([{'kind': 'app', 'identity': 'original', 'windows': [42, 43]}], None, []),
            ([{'kind': 'app', 'identity': 'original', 'windows': [42]},
              {'kind': 'app', 'identity': 'other', 'windows': [43]}], None, []),
            ([], 'retired', [{'proof': 'kill_zero_ESRCH', 'identity': 'original'}]),
            ([{'kind': 'app', 'identity': 'original', 'windows': []}], 'retiring', [])]
        for nodes, latched, retired in variants:
            value = self.value(); context = closing_projection(nodes, 'original', latched=latched, retired=retired)
            value['closing_lifetime_context'] = context
            with self.subTest(context=context): self.assertEqual(self.read(value), value)
        self.assertFalse(closing_projection([], 'original')['process_equal'])
        self.assertFalse(closing_projection([{'kind': 'app', 'identity': 'other', 'windows': [42]}], 'original')['process_equal'])

    def test_malformed_optional_data_and_sink_loss_preserve_original_error(self):
        original = RuntimeError('SECRET-CANARY original error')
        self.owner.error = original
        for field in ('first_counter_transition', 'closing_lifetime_context'):
            for bad in (None, [], True, 'SECRET-CANARY'):
                value = self.value(); value[field] = bad
                self.assertIsNone(self.read(value)); self.assertIs(self.owner.error, original)
        self.assertIsNone(self.read(data=b'PRIVATE-CANARY' * 200))
        self.assertIs(self.owner.error, original)


class PassiveSwiftSourceControls(unittest.TestCase):
    def setUp(self):
        self.source = SOURCE.read_text()
        self.block = self.source.split('// BEGIN PASSIVE FAILURE CONTEXT', 1)[1].split('// END PASSIVE FAILURE CONTEXT', 1)[0]

    def test_allowlists_exact_and_no_new_observation_ports(self):
        reader = self.block.split('static let readerTerminals:', 1)[1].split('static func first', 1)[0]
        self.assertEqual(set(re.findall(r'"([a-z_]+)"', reader)), TERMINALS)
        self.assertEqual(TERMINALS, parent._READER_TERMINALS)
        for call in ('getuid(', 'process(', 'ownedFrame(', 'StartupObserver.snapshot(', 'reader.observe(',
                     'AXUIElement', 'CGWindow', 'FileHandle', 'CommandLine', 'RunLoop', 'Thread', 'publish('):
            self.assertNotIn(call, self.block)
        self.assertNotIn('throw ', self.block)
        self.assertNotIn('localizedDescription', self.block)

    def test_first_transition_freeze_and_all_three_unchanged_increment_sites(self):
        first = self.block.split('static func first(', 1)[1].split('private static func identity', 1)[0]
        self.assertIn('guard stored == nil, causes.contains(cause) else { return }', first)
        self.assertIn('failure.count <= 8192', first)
        self.assertIn('readerTerminals.contains(stage)', first)
        self.assertEqual(first.count('stored = value'), 1)
        self.assertNotIn('first_observed_refusal', first)
        self.assertNotIn('value["failure"]', first)
        increments = [m.start() for m in re.finditer(re.escape('refusals += 1'), self.source)]
        self.assertEqual(len(increments), 3)
        for cause in parent._COUNTER_CAUSES:
            call = self.source.index('StartupAXFailureContext.first(&firstCounter, cause: "' + cause + '"')
            next_increment = self.source.index('refusals += 1', call)
            self.assertLess(next_increment - call, 230)
        # Inert freeze trace, with source guard/increment sites fenced above.
        for first_cause in parent._COUNTER_CAUSES:
            stored = None
            for cause in [first_cause, *parent._COUNTER_CAUSES]:
                if stored is None: stored = cause
            self.assertEqual(stored, first_cause)

    def test_existing_reader_data_projection_omits_unknown_private_and_oversize(self):
        # Pure data model, fenced to the actual Swift allowlist and guards above.
        def first(stored, cause, data):
            if stored is not None or cause not in parent._COUNTER_CAUSES: return stored
            value = dict(cause=cause, sequence='0', generation_before='0')
            if cause == 'ax_predicate_refused' and data is not None and len(data) <= 8192:
                try:
                    stage = json.loads(data)['terminal_refusal']['stage']
                    if stage in TERMINALS: value['reader_terminal'] = stage
                except (ValueError, KeyError, TypeError): pass
            return value
        data = json.dumps({'terminal_refusal': {'stage': 'foreign_window', 'value': 'PRIVATE-CANARY'},
                           'first_observed_refusal': {'private': 'PRIVATE-CANARY'}}).encode()
        value = first(None, 'ax_predicate_refused', data)
        self.assertEqual(value['reader_terminal'], 'foreign_window')
        self.assertNotIn('PRIVATE-CANARY', json.dumps(value))
        for bad in (b'{', b'x' * 8193, b'{"terminal_refusal":{"stage":"PRIVATE-CANARY"}}'):
            self.assertNotIn('reader_terminal', first(None, 'ax_predicate_refused', bad))
        self.assertNotIn('reader_terminal', first(None, 'sample_deadline', data))
        self.assertNotIn('reader_terminal', first(None, 'target_retirement', data))
        self.assertIs(first(value, 'sample_deadline', data), value)
        self.assertIsNone(first(None, 'PRIVATE-CANARY', data))

    def test_same_closing_snapshot_precedes_unchanged_outcome_without_stale_context(self):
        terminal = self.source.split('func terminal(', 1)[1].split('let start =', 1)[0]
        self.assertIn('if diagnosticStage == .closing_lifetime', terminal)
        self.assertIn('closingContext = StartupAXFailureContext.closing(snapshot, target: target, window: window,', terminal)
        self.assertIn('latched: retired, helperUID: me.uid)', terminal)
        self.assertLess(terminal.index('closingContext ='), terminal.index('let state = try StartupAXLifetime.outcome'))
        self.assertIn('latched: &retired)', terminal)
        self.assertNotIn('snapshot(config', terminal)
        self.assertIn('target.uid == helperUID', self.block)
        self.assertIn('let matches = (retired ?? []).filter', self.block)
        self.assertIn('(windows?.count ?? 0) <= 128', self.block)

    def test_pair_and_stage_omit_context_and_overflow_cannot_replace_fatal(self):
        attach = self.block.split('static func attach(', 1)[1]
        self.assertIn('stage == "lifetime" || stage == "closing_lifetime"', attach)
        self.assertIn('record["pre_refusal_paired"] == nil', attach)
        self.assertIn('if stage == "closing_lifetime", let closing', attach)
        self.assertIn('bytes.count < 2048 else { return record }', attach)
        self.assertNotIn('pairedDiagnostic =', self.block)
        self.assertNotIn('"ready"', self.block)
        def projected(record, optional):
            if record['stage'] not in ('lifetime', 'closing_lifetime') or 'pre_refusal_paired' in record: return record
            permitted = dict(optional)
            if record['stage'] != 'closing_lifetime': permitted.pop('closing_lifetime_context', None)
            candidate = dict(record, **permitted)
            try: fits = len(json.dumps(candidate, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()) < 2048
            except (ValueError, TypeError): fits = False
            return candidate if fits else record
        base = {'stage': 'closing_lifetime', 'acceptance': False}
        self.assertIs(projected(base, {'first_counter_transition': 'x' * 2048}), base)
        self.assertIs(projected(base, {'closing_lifetime_context': float('nan')}), base)
        overhead = len(json.dumps(dict(base, first_counter_transition=''),
                                  sort_keys=True, separators=(',', ':')).encode())
        self.assertIsNot(projected(base, {'first_counter_transition': 'x' * (2047 - overhead)}), base)
        self.assertIs(projected(base, {'first_counter_transition': 'x' * (2048 - overhead)}), base)
        for record in [dict(base, stage='snapshot'), dict(base, pre_refusal_paired={'acceptance': False})]:
            self.assertIs(projected(record, {'first_counter_transition': 'ignored'}), record)
        lifetime = dict(base, stage='lifetime')
        observed = projected(lifetime, {'first_counter_transition': {'cause': 'sample_deadline'},
                                        'closing_lifetime_context': {'stale': True}})
        self.assertIn('first_counter_transition', observed)
        self.assertNotIn('closing_lifetime_context', observed)
        self.assertIn('record = StartupAXFailureContext.attach(record, first: firstCounter, closing: closingContext)', self.source)
        self.assertIn('StartupAXFailureDiagnostic.emit(record, write: { try FileHandle.standardError.write(contentsOf: $0) })\n            exit(1)', self.source)


if __name__ == '__main__':
    unittest.main()
