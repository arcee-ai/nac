"""Closed diagnostic ingestion and source controls; never executes Swift/AX."""
import itertools
from pathlib import Path
import re
import unittest

import test_ci_startup_ax_diagnostics as fixtures

SOURCE = Path(__file__).with_name('CIStartupAXWitness.swift')


class PairedDiagnosticSourceControls(unittest.TestCase):
    def setUp(self):
        self.source = SOURCE.read_text()
        self.policy = self.source.split('// BEGIN PRE-REFUSAL PAIRED DIAGNOSTIC', 1)[1].split('// END PRE-REFUSAL PAIRED DIAGNOSTIC', 1)[0]
        self.branch = self.source.split('if apps.count == 1, target.pid != 0,', 1)[1].split('if target.pid != 0 { if try terminal', 1)[0]

    def test_actual_boolean_eligibility_expression_denies_every_missing_precondition(self):
        # Evaluate the production expression itself, restricted to six Boolean
        # names/operators; this does not emulate an AX or Swift runtime.
        expression = re.search(r'withinSample: Bool\) -> Bool \{\s*([^}]+)', self.policy).group(1).strip()
        names = ('complete', 'exactProcess', 'originalRoot', 'retainedRoot', 'pristine', 'withinSample')
        self.assertEqual(set(re.findall(r'[A-Za-z]+', expression)), set(names))
        self.assertNotIn('||', expression)
        for values in itertools.product((False, True), repeat=6):
            result = eval(expression.replace('&&', ' and '), {'__builtins__': {}}, dict(zip(names, values)))
            self.assertEqual(result, all(values))
        for guard in ('current == target && target.valid', 'cgWindows.contains(window)',
                      'retainedRoot != nil', 'refusals == 0 && retired == nil && !pairedAttempted && reader.failureData == nil',
                      'process(getpid()) == me', 'declaration.helper_sha256', '== digest',
                      'readAt - began < 1_000_000_000'):
            self.assertIn(guard, self.branch)
        self.assertIn('cgWindows.count > 1', self.branch)
        self.assertNotIn('target =', self.branch)
        self.assertNotIn('window =', self.branch)

    def test_only_one_canonical_read_precedes_original_fatal_refusal_without_ready_or_retry(self):
        self.assertEqual(self.branch.count('try reader.observe('), 1)
        self.assertEqual(self.branch.count('StartupAXPreRefusalDiagnostic.capture('), 1)
        self.assertLess(self.branch.index('pairedAttempted = true'), self.branch.index('try reader.observe('))
        self.assertLess(self.branch.index('try reader.observe('), self.branch.index('throw OwnershipError.invalid'))
        self.assertNotIn('publish(', self.branch)
        self.assertNotIn('continue', self.branch)
        self.assertNotIn('RunLoop', self.branch)
        self.assertNotIn('AXUIElement', self.policy)
        self.assertNotIn('while ', self.policy)
        self.assertNotIn('for ', self.policy)
        self.assertEqual(self.policy.count('try read()'), 1)
        self.assertEqual(self.policy.count('try close()'), 1)
        self.assertLess(self.policy.index('try read()'), self.policy.index('try close()'))
        self.assertIn('catch { /* Original CG refusal stays primary. */ }', self.policy)
        self.assertIn('catch { result["outcome"] = "closing_refused"; return result }', self.policy)
        self.assertIn('"acceptance": false', self.policy)
        self.assertIn('snapshot(config, resources: resources, known: &known)', self.branch)
        self.assertIn('(latest[0]["windows"] as? [Int])?.contains(window) == true', self.branch)
        self.assertIn('decodedProcess(latest[0]) == target', self.branch)
        self.assertIn('ownedFrame(target.pid, window) == frame', self.branch)
        self.assertIn('ended - began <= 1_000_000_000', self.branch)

    def test_every_optional_opening_fault_is_contained_before_original_refusal(self):
        # Trace actual source block boundaries. This is not executed Swift:
        # every opening throw must exit to the optional catch, then encounter
        # the original CG refusal without reaching the canonical read.
        code = re.sub(r'//[^\n]*|"(?:\\.|[^"\\])*"', lambda m: ' ' * len(m[0]), self.branch)
        opening = re.search(r'\bdo\s*\{', code)
        self.assertIsNotNone(opening, 'Optional opening rechecks have no containing catch')
        start = code.index('{', opening.start())
        def end_of_block(begin):
            depth = 1
            for index in range(begin + 1, len(code)):
                depth += (code[index] == '{') - (code[index] == '}')
                if depth == 0: return index
            self.fail('Unclosed production block')
        end = end_of_block(start)
        catch = re.match(r'\s*catch\s*\{', code[end + 1:])
        self.assertIsNotNone(catch, 'Opening checks must have an unfiltered catch')
        catch_start = code.index('{', end + 1)
        catch_end = end_of_block(catch_start)
        self.assertNotIn('throw', code[catch_start:catch_end])
        self.assertNotIn('reader.observe', code[catch_start:catch_end])
        self.assertRegex(code[catch_end + 1:], r'^\s*throw OwnershipError.invalid')
        read = code.index('try reader.observe(')
        capture = code.index('StartupAXPreRefusalDiagnostic.capture(')
        for fault in ('try decodedProcess(apps[0])', 'resources.intact()', 'process(getpid()) == me',
                      'StartupAXPreflight.file(binary,', 'StartupAXPreflight.file(configPath,',
                      'try ownedFrame(target.pid, window)', 'try StartupObserver.need(readAt'):
            with self.subTest(opening_fault=fault):
                at = code.index(fault)
                self.assertLess(start, at)
                self.assertLess(at, capture)
                self.assertLess(capture, read)
                self.assertLess(read, end)
        self.assertNotIn('continue', code[start:catch_end])
        self.assertNotIn('return', code[start:catch_end])
        self.assertNotIn('publish(', code[start:catch_end])

    def test_publication_fault_cannot_replace_original_error_or_issue_ready(self):
        emit = self.source.split('static func emit(', 1)[1].split('// END AX FAILURE DIAGNOSTICS', 1)[0]
        self.assertIn('do { try write(data) } catch {', emit)
        self.assertEqual(emit.count('try write(data)'), 1)
        self.assertNotIn('throw ', emit)
        self.assertIn('$0.count < 2048', emit)
        outer = self.source.split('var record = StartupAXFailureDiagnostic.record(', 1)[1]
        self.assertIn('error: error', outer)
        self.assertIn('record["pre_refusal_paired"] = pairedDiagnostic', outer)
        self.assertLess(outer.index('StartupAXFailureDiagnostic.emit'), outer.index('exit(1)'))
        self.assertNotIn('"ready"', outer.split('exit(1)', 1)[0])

    def test_projection_is_explicit_and_never_exports_focus_or_invents_association(self):
        self.assertIn('Array(windows.filter { $0 != original }.prefix(7))', self.policy)
        self.assertIn('observed.root_id == retained', self.policy)
        self.assertIn('"retained_root_equal": true', self.policy)
        for private in ('observed.focus', 'observed.root_frame', 'AXTitle', 'AXValue', 'localizedDescription'):
            self.assertNotIn(private, self.policy)
        self.assertNotIn('ax_windows_count', self.policy)
        self.assertNotIn('cg_to_ax', self.policy)


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
