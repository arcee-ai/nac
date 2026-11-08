"""H54 closed supplier/context composition with inert ports; no actor or compiler."""
import ast
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import test_configured_refusal as refusal
import test_four_startup as full
import test_launch as launcher

C = full.controller
PAIR = refusal.PAIR


class ContextNominationControls(unittest.TestCase):
    setUp = full.SourceControls.setUp
    admission = full.SourceControls.admission
    proof = refusal.RefusalControls.proof
    exercise_refusal = refusal.RefusalControls.exercise_refusal

    def test_exact_H54_scope_parent_and_roster_are_closed(self):
        self.assertEqual(C.REFUSAL_H, '54c0b7db66c19c9b676e46933bfc89944c3b6f2a')
        self.assertEqual(C.REFUSAL_SCOPE, 'P12-Qba-H54-configured-lifetime-context-diagnostic01')
        self.assertEqual(C.REFUSAL_BRANCH, 'refs/heads/codex/experimental-native-p12-lifetime-context-consumer01')
        self.assertEqual(PAIR['H_preparation_parent'], '148f51f887a823bbc517e34aa607615393aa2875')
        self.assertEqual(PAIR['supplier_sha256'], C.REFUSAL_SUPPLIERS)
        self.assertEqual(set(C.REFUSAL_SUPPLIERS), {'H', 'Q'})
        self.assertEqual(sum(map(len, C.REFUSAL_SUPPLIERS.values())), 5)
        gate = next(n for n in ast.parse((full.HERE / 'four-startup.py').read_text()).body
                    if isinstance(n, ast.FunctionDef) and n.name == 'main')
        gate = next(n for n in gate.body if isinstance(n, ast.If)
                    and isinstance(n.test, ast.Name) and n.test.id == 'configured_refusal')
        code = compile(ast.Module(body=[gate], type_ignores=[]), '<actual-closed-pair-gate>', 'exec')
        for change in ({'H': '148f51f887a823bbc517e34aa607615393aa2875'}, {'H': 'bc596148c88e00a4e8e25c1ff09ec34d568913bc'}, {'supplier_sha256': {}},
                       {'supplier_sha256': {**C.REFUSAL_SUPPLIERS, 'R': {}}}):
            with self.assertRaises(RuntimeError):
                exec(code, dict(C.__dict__, configured_refusal=True, pair={**PAIR, **change}))

    def test_consumed_H148_and_Hbc_scope_and_branch_are_not_readmitted(self):
        value = self.admission(); value['scope'] = C.REFUSAL_SCOPE
        for scope in ('P12-Qba-H148-configured-context-diagnostic01', 'P12-Qba-Hbc596-configured-drain-diagnostic01'):
            with self.assertRaises(RuntimeError):
                C.admit({**value, 'scope': scope}, 'a' * 40, now=1001, configured_refusal=True)
        env = dict(ROOT_STARTUP_ADMISSION=json.dumps(value), GITHUB_SHA='a' * 40,
            GITHUB_REF='refs/heads/codex/experimental-native-p12-context-consumer01',
            GITHUB_EVENT_NAME='workflow_dispatch', GITHUB_RUN_ATTEMPT='1', GITHUB_REPOSITORY='arcee-ai/nac')
        with patch.dict(launcher.launch.os.environ, env), patch.object(launcher.launch.time, 'time', return_value=1001):
            with self.assertRaises(RuntimeError): launcher.launch.inputs(configured_refusal=True)

    def test_exact_immutable_supplier_bytes_then_each_drift_are_rejected(self):
        with tempfile.TemporaryDirectory(prefix='nac-context-suppliers-inert-') as temporary:
            roots = {key: Path(temporary).resolve() / key for key in ('H', 'Q')}
            originals = []
            for role, files in C.REFUSAL_SUPPLIERS.items():
                for name, expected in files.items():
                    data = subprocess.check_output(['git', 'show', PAIR[role] + ':' + name])
                    path = roots[role] / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
                    self.assertEqual(C.digest(path), expected); originals.append((path, data))
            self.assertEqual(C._refusal_sources(roots), C.REFUSAL_SUPPLIERS)
            for path, data in originals:
                path.write_bytes(data + b'\nsource drift')
                with self.assertRaises(RuntimeError): C._refusal_sources(roots)
                path.write_bytes(data)
            path, data = originals[0]; path.unlink()
            with self.assertRaises(RuntimeError): C._refusal_sources(roots)
            path.symlink_to(originals[1][0])
            with self.assertRaises(RuntimeError): C._refusal_sources(roots)
            path.unlink(); path.write_bytes(data)

    def test_actual_H54_optional_parser_and_unchanged_refusal_gate(self):
        source = subprocess.check_output(['git', 'show', PAIR['H'] + ':desktop/macos/ci_startup_ax.py'])
        tree = ast.parse(source)
        names = {'require', '_failure_context'}
        nodes = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in names)
                 or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in
                    {'_COUNTER_CAUSES', '_READER_TERMINALS', '_CLOSING_BOOLS'} for t in n.targets))]
        ns = {'re': re}; exec(compile(ast.Module(body=nodes, type_ignores=[]), '<actual-H54-context-parser>', 'exec'), ns)
        first = dict(cause='sample_deadline', sequence='1', generation_before='0')
        context = dict(complete=True, target_fields_valid=True, target_uid_matches_helper=True,
            app_count=1, process_equal=True, windows_typed=True, window_count=2, original_present=True,
            exact_original_singleton=False, latched='none', retired_inventory_typed=True, retirement_matches=0)
        row = dict(stage='closing_lifetime', sequence='45', refusal_generation='3',
                   first_counter_transition=first, closing_lifetime_context=context)
        ns['_failure_context'](row)
        lifetime = dict(stage='lifetime', sequence='42', refusal_generation='2', first_counter_transition=first)
        ns['_failure_context'](lifetime)
        ns['_failure_context'](dict(lifetime, first_counter_transition=first))
        with self.assertRaises(RuntimeError):
            ns['_failure_context'](dict(lifetime, closing_lifetime_context=context))
        for change in ({'stage': 'lifetime'}, {'pre_refusal_paired': {}},
                       {'closing_lifetime_context': {**context, 'window_count': True}},
                       {'first_counter_transition': {**first, 'private': 'PRIVATE-CANARY'}}):
            with self.assertRaises((RuntimeError, TypeError)):
                ns['_failure_context']({**row, **change})
        for supplied in (row, lifetime):
            def passive(proof):
                proof['ax_companion_diagnostic'] = {**proof['ax_companion_diagnostic'], **supplied}
                proof['ax_companion_diagnostic'].pop('pre_refusal_paired')
            self.clock = C.make_clock((1000, 3880, 4480, 4600), full.budget.Bound)
            progress, parsed = self.exercise_refusal(passive)
            self.assertEqual(progress[-1]['diagnostic']['status'], 'INCOMPLETE')
            self.assertEqual(parsed, [])

    def test_operator_caps_roles_and_first_CG_binding_are_preserved(self):
        contract = json.loads((full.HERE / 'configured-refusal-contract.json').read_text())
        self.assertEqual(contract['supplier_sha256'], C.REFUSAL_SUPPLIERS)
        self.assertFalse(contract['passive_failure_context']['pair_qualification_changed'])
        self.assertFalse(contract['runtime_authorized']); self.assertFalse(contract['acceptance'])
        self.assertEqual(contract['future_roles']['locked_setup_invocations'], 4)
        self.assertEqual(contract['clock']['case_remaining_seconds'], 615)
        self.assertEqual(contract['clock']['max_work_seconds'], 2880)
        self.assertEqual(contract['clock']['min_cleanup_seconds'], 600)
        self.assertEqual(contract['clock']['min_retention_seconds'], 120)
        source = (full.HERE / 'four-startup.py').read_text()
        self.assertIn("diagnostic.get('stage') == 'lifetime'", source)
        self.assertIn("diagnostic.get('refusal_generation') == '0'", source)
        self.assertIn('raise primary from evidence_error', source)
        self.assertIn("report['supplier_sources_sha256'] = _refusal_sources(roots)", source)


if __name__ == '__main__':
    unittest.main()
