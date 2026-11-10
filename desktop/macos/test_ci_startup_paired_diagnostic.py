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

    def interaction_sources(self):
        directory = SOURCE.with_name('startup_xctest')
        return (directory.joinpath('StartupJourneys.swift').read_text(),
                directory.joinpath('StartupAXGuard.swift').read_text())

    def assert_coordinate_path(self, journey, actor):
        # Scoped lexical fences for the reviewed integration, not a Swift parser
        # or a substitute for the existing inert/SDK/native behavior checks.
        dispatch = journey.split('func dispatch(', 1)[1].split('func text(', 1)[0]
        selection = ('let center = target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))\n'
                     '                let (selected, point) = try StartupInteractionPolicy.selectCoordinate(anchor: anchor, center: center,\n'
                     '                    screenPoint: { $0.screenPoint }, offset: { $0.withOffset($1) })')
        fences = ('let ticket = guardTicket',
                  'let target = try XCTUnwrap(target), ticket = try XCTUnwrap(ticket)', selection,
                  'let request = try client.prepareInteraction(ticket, point: point, anchor: anchor,',
                  'try guardWindow(ui, running: running, paths: paths, launch: launch, number: number, record: false)',
                  'StartupInteractionPolicy.unchanged(point: selected.screenPoint, expected: point,',
                  'try client.finishInteraction(request)', 'coordinate = selected', 'try action(coordinate)')
        for fence in fences:
            self.assertEqual(dispatch.count(fence), 1, fence)
        positions = [dispatch.index(fence) for fence in fences]
        self.assertEqual(positions, sorted(positions))
        guards = [match.start() for match in re.finditer(r'try guardTarget\(\)', dispatch)]
        self.assertEqual(len(guards), 2)
        self.assertLess(guards[0], positions[0])
        self.assertGreater(guards[1], positions[-1])
        self.assertEqual(re.findall(r'(?m)^\s*coordinate\s*=\s*(.*)$', dispatch), ['selected'])
        self.assertEqual(dispatch.count('try action('), 1)
        self.assertEqual(dispatch.count('client.prepareInteraction('), 1)
        self.assertEqual(dispatch.count('client.finishInteraction('), 1)
        semantic_fences = ('try StartupAXFiles.need(namedTargetMatches(semanticName))',
                           'kind: kind, label: semanticName,', 'namedTargetMatches(request.label)')
        semantic_positions = []
        for fence in semantic_fences:
            self.assertEqual(dispatch.count(fence), 1)
            semantic_positions.append(dispatch.index(fence))
        self.assertEqual(semantic_positions, sorted(semantic_positions))
        self.assertGreater(semantic_positions[0], dispatch.index(selection))
        self.assertLess(semantic_positions[-1], dispatch.index('try client.finishInteraction(request)'))
        for fence in ('semantic.query.count == 1', 'semantic.query.firstMatch.frame == anchor',
                      'title: target.title, label: target.label',
                      'placeholder: kind == "message" ? target.placeholderValue : nil'):
            self.assertIn(fence, dispatch)

        self.assertIn('try client.finishInteraction(request)\n                coordinate = selected', dispatch)

        adapter = actor.split('static func selectCoordinate<Coordinate>(', 1)[1].split('struct Binding<Token:', 1)[0]
        offset = ('let selected = selectedPoint == original ? center\n'
                  '            : offset(center, CGVector(dx: selectedPoint.x - original.x, dy: selectedPoint.y - original.y))')
        readback = ('let actual = screenPoint(selected)\n'
                    '        try StartupAXFiles.need(actual == selectedPoint && anchor.contains(actual)\n'
                    '            && actual.x > anchor.minX && actual.y > anchor.minY\n'
                    '            && [actual.x, actual.y].allSatisfy { $0.isFinite && Double(Float($0)) == Double($0) })\n'
                    '        return (selected, actual)')
        self.assertEqual(adapter.count(offset), 1)
        self.assertEqual(adapter.count(readback), 1)
        self.assertLess(adapter.index(offset), adapter.index(readback))
        self.assertEqual(adapter.count('return ('), 1)

    def test_same_public_coordinate_and_original_ticket_are_used_before_dispatch(self):
        journey, actor = self.interaction_sources()
        self.assert_coordinate_path(journey, actor)
        self.assertIn('coordinate.click()', journey)

    def test_removed_bypassed_or_old_center_dispatch_and_late_finish_are_rejected(self):
        journey, actor = self.interaction_sources()
        selection = ('let (selected, point) = try StartupInteractionPolicy.selectCoordinate(anchor: anchor, center: center,\n'
                     '                    screenPoint: { $0.screenPoint }, offset: { $0.withOffset($1) })')
        bypass = ('var (selected, point) = (center, center.screenPoint)\n'
                  '                if false {\n'
                  '                    (selected, point) = try StartupInteractionPolicy.selectCoordinate(anchor: anchor, center: center,\n'
                  '                        screenPoint: { $0.screenPoint }, offset: { $0.withOffset($1) })\n'
                  '                }')
        finish = 'try client.finishInteraction(request)'
        mutations = {
            'removed-adapter': (selection, 'let (selected, point) = (center, center.screenPoint)'),
            'removed-initial-name': ('try StartupAXFiles.need(namedTargetMatches(semanticName))', 'try StartupAXFiles.need(true)'),
            'label-only-request': ('kind: kind, label: semanticName,', 'kind: kind, label: target.label,'),
            'removed-final-name': ('namedTargetMatches(request.label)', 'true'),
            'identifier-only-name': ('title: target.title, label: target.label', 'title: target.identifier, label: target.label'),

            'bypassed-adapter': (selection, bypass),
            'wrong-readback-port': ('screenPoint: { $0.screenPoint }', 'screenPoint: { _ in center.screenPoint }'),
            'bypassed-public-offset': ('offset: { $0.withOffset($1) }', 'offset: { coordinate, _ in coordinate }'),
            'renewed-ticket': ('client.prepareInteraction(ticket,', 'client.prepareInteraction(try client.begin(),'),
            'old-center-final-fence': ('unchanged(point: selected.screenPoint,', 'unchanged(point: center.screenPoint,'),
            'old-center-dispatch': ('coordinate = selected', 'coordinate = center'),
            'overwritten-dispatch': ('coordinate = selected', 'coordinate = selected\n                coordinate = center'),
            'late-finalization': (finish, 'finalize = { try client.finishInteraction(request) }'),
        }
        for name, (before, after) in mutations.items():
            self.assertEqual(journey.count(before), 1, name)
            changed = journey.replace(before, after, 1)
            if name == 'late-finalization':
                changed = changed.replace('var coordinate: XCUICoordinate?',
                    'var finalize: (() throws -> Void)?\n            var coordinate: XCUICoordinate?', 1)
                changed = changed.replace('try action(coordinate)', 'try action(coordinate)\n            try finalize?()', 1)
            with self.subTest(mutation=name), self.assertRaises(AssertionError):
                self.assert_coordinate_path(changed, actor)

    def test_missing_or_bypassed_actual_adapter_readback_is_rejected(self):
        journey, actor = self.interaction_sources()
        mutations = {
            'missing-actual-readback': ('let actual = screenPoint(selected)', 'let actual = selectedPoint'),
            'wrong-coordinate-readback': ('let actual = screenPoint(selected)', 'let actual = screenPoint(center)'),
            'bypassed-readback-validation': ('need(actual == selectedPoint &&', 'need(true || actual == selectedPoint &&'),
            'wrong-returned-coordinate': ('return (selected, actual)', 'return (center, actual)'),
            'wrong-returned-point': ('return (selected, actual)', 'return (selected, original)'),
        }
        for name, (before, after) in mutations.items():
            self.assertEqual(actor.count(before), 1, name)
            with self.subTest(mutation=name), self.assertRaises(AssertionError):
                self.assert_coordinate_path(journey, actor.replace(before, after, 1))

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
