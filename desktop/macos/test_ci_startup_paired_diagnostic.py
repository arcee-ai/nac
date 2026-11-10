"""Closed diagnostic ingestion and source controls; never executes Swift/AX."""
import itertools
from pathlib import Path
import re
import unittest

import test_ci_startup_ax_diagnostics as fixtures

SOURCE = Path(__file__).with_name('CIStartupAXWitness.swift')


class InteractionSourceControls(unittest.TestCase):
    def test_old_extra_cg_fatal_branch_is_replaced_without_loosening_initial_root_selection(self):
        source = SOURCE.read_text()
        self.assertNotIn('cgWindows.count > 1', source)
        self.assertNotIn('StartupAXPreRefusalDiagnostic', source)
        self.assertIn('try StartupObserver.need(windows.count == 1)', source)
        self.assertIn('windows.filter { $0 == window }.count == 1', source)
        self.assertIn('ownedFrame(target.pid, window) == frame', source)

    def test_global_hit_is_shared_canonical_and_rechecked_after_resource_bookend(self):
        source = SOURCE.read_text()
        actor = SOURCE.with_name('startup_xctest').joinpath('StartupAXGuard.swift').read_text()
        self.assertEqual(source.count('reader.interaction(request, pid: target.pid)'), 2)
        self.assertIn('AXUIElementCreateSystemWide()', actor)
        self.assertIn('AXUIElementCopyElementAtPosition(system,', actor)
        self.assertIn('StartupInteractionPolicy.target(', actor)
        self.assertIn('interactionBinding.accept(request.id', actor)
        self.assertIn('inputTargets.accept(key', actor)
        self.assertNotIn('AXUIElementSetAttributeValue', actor)
        self.assertNotIn('AXUIElementPerformAction', actor)

    def test_same_public_coordinate_and_original_ticket_are_used_before_dispatch(self):
        journey = SOURCE.with_name('startup_xctest').joinpath('StartupJourneys.swift').read_text()
        before = journey.split('func dispatch(', 1)[1].split('func text(', 1)[0]
        for fence in ('let ticket = guardTicket', 'let point = selected.screenPoint',
                      'client.prepareInteraction(ticket', 'StartupInteractionPolicy.unchanged(',
                      'try client.finishInteraction(request)', 'try action(coordinate)'):
            self.assertIn(fence, before)
        self.assertLess(before.index('finishInteraction'), before.index('try action(coordinate)'))
        self.assertIn('coordinate.click()', journey)

    def test_failure_emitter_preserves_original_error_and_never_exports_request_fields(self):
        source = SOURCE.read_text()
        emit = source.split('static func emit(', 1)[1].split('// END AX FAILURE DIAGNOSTICS', 1)[0]
        self.assertIn('do { try write(data) } catch {', emit)
        self.assertIn('$0.count < 2048', emit)
        outer = source.split('let record = StartupAXFailureDiagnostic.record(', 1)[1]
        self.assertLess(outer.index('StartupAXFailureDiagnostic.emit'), outer.index('exit(1)'))
        for private in ('request.value', 'request.label', 'localizedDescription'):
            self.assertNotIn(private, outer.split('exit(1)', 1)[0])


class PairedDiagnosticIngestionControls(unittest.TestCase):
    setUp = fixtures.AXFailureDiagnosticsTests.setUp
    read = fixtures.AXFailureDiagnosticsTests.read

    def paired(self, outcome='observed'):
        row = dict(schema='nac342-ax-pre-refusal-paired-v1', acceptance=False,
            cg_window_count=2, cg_window_ids=[17, 18], cg_ids_truncated=False, original_window_number=17,
            outcome=outcome, closing_valid=outcome != 'closing_refused')
        if outcome == 'observed':
            row['canonical'] = dict(surface='panel', root_id='12345678-1234-4567-8123-123456789abc',
                retained_root_equal=True, panel_id='22345678-1234-4567-8123-123456789abc', go_to_id=None)
        return row

    def record(self, paired):
        return dict(self.row, stage='lifetime', code='ownership_invalid', pre_refusal_paired=paired)

    def test_positive_and_refused_pairs_remain_false_acceptance_and_original_failure(self):
        for outcome in ('observed', 'reader_refused', 'closing_refused'):
            self.owner.error = primary = RuntimeError('inert original CG refusal')
            value = self.read(self.record(self.paired(outcome)))
            self.assertEqual(value['code'], 'ownership_invalid')
            self.assertIs(value['acceptance'], False)
            self.assertIs(value['pre_refusal_paired']['acceptance'], False)
            self.assertIs(self.owner.error, primary)
            self.assertEqual(self.owner.failure, 'ax_companion_unavailable')
            self.assertLess(len(__import__('json').dumps(value)), 2048)

    def test_unknown_private_malformed_or_unbound_pairs_are_diagnostic_unavailable(self):
        mutations = [lambda p: p.update(acceptance=True), lambda p: p.update(cg_window_count=True),
            lambda p: p.update(cg_window_count=129), lambda p: p.update(cg_window_ids=[17,17]),
            lambda p: p.update(cg_window_ids=[18,19]), lambda p: p.update(cg_ids_truncated=True),
            lambda p: p.update(outcome='ready'), lambda p: p.update(closing_valid=False),
            lambda p: p.update(title='private-canary'), lambda p: p['canonical'].update(value='private-canary'),
            lambda p: p['canonical'].update(root_id='not-a-uuid'),
            lambda p: p['canonical'].update(retained_root_equal=False),
            lambda p: p['canonical'].update(panel_id=None)]
        for mutate in mutations:
            p = self.paired(); mutate(p)
            with self.subTest(pair=p): self.assertIsNone(self.read(self.record(p)))
        p = self.paired('reader_refused'); p['canonical'] = self.paired()['canonical']
        self.assertIsNone(self.read(self.record(p)))

    def test_bounded_inventory_is_explicitly_truncated_without_membership_claim(self):
        p = self.paired();p.update(cg_window_count=128,cg_window_ids=list(range(17,25)),cg_ids_truncated=True)
        value = self.read(self.record(p))
        self.assertEqual(len(value['pre_refusal_paired']['cg_window_ids']), 8)
        self.assertNotIn('ax_windows_count', value['pre_refusal_paired'])
