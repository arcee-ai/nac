from pathlib import Path
import copy
import hashlib
import json
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from ci_qualifications import require_checkout, require_full_preview, require_workspace, require_rich_capture, select_target


class ExactSourceTests(unittest.TestCase):
    def test_only_named_immutable_standard_runner_targets_resolve(self):
        target = select_target('all-341-macos26')
        self.assertEqual(target['source_sha'], '1a4f9c31f27b4656897673084f3440e05373393d')
        self.assertEqual(target['runner'], 'macos-26')
        self.assertEqual(target['scenario_count'], 29)
        instance = select_target('all-343-macos26')
        self.assertEqual(instance['source_sha'], 'f4832ed44f948a88170f5d3bc25322852dbce347')
        self.assertEqual(instance['suite'], 'instances')
        self.assertEqual(instance['scenario_count'], 8)
        terminal = select_target('all-352-macos26')
        self.assertEqual(terminal['source_sha'], 'a02f0c06b3c75c8f8fd62b6c233d1cfd923be6e1')
        startup = select_target('all-342-startup-macos26')
        self.assertEqual(startup['source_sha'], '4b7a1f3e0bf6175a77c5ebf627fe965860e99976')
        self.assertEqual(startup['test_source_sha'], '95a34b063ab1ec321f775bcfe14983d52dd97b2a')
        self.assertEqual(startup['protocol_source_sha'], '7325c48b3c9ec7036e255a6bd92f31c1a98c1607')
        self.assertEqual(startup['scenarios'], ['onboarding', 'configuredLocal', 'invalidConfig', 'futureStore'])
        self.assertEqual(terminal['suite'], 'terminal')
        self.assertEqual(terminal['phase_count'], 6)
        older = select_target('all-351-macos14')
        self.assertEqual(older['runner'], 'macos-14')
        self.assertEqual(older['source_sha'], '8e8f18d7f479b3514d19b2754fee53ea47c6115c')
        self.assertEqual(older['developer_directory'], '/Applications/Xcode_16.2.app/Contents/Developer')
        for unknown in ('', 'all-341-macos14', 'macos-26-xlarge', '../ci-toolchain.json'):
            with self.assertRaisesRegex(RuntimeError, 'Unknown/unapproved'):
                select_target(unknown)

    def test_actual_source_mismatch_dirty_or_subdirectory_never_qualifies(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
            git('init', '-q')
            git('-c', 'user.name=NAC fixture', '-c', 'user.email=fixture@example.invalid',
                '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'fixture')
            sha = git('rev-parse', 'HEAD')
            self.assertEqual(require_checkout(root, sha)['source_sha'], sha)
            with self.assertRaisesRegex(RuntimeError, 'immutable source'):
                require_checkout(root, '0' * 40)
            (root / 'dirty').write_text('untouched fixture\n')
            with self.assertRaisesRegex(RuntimeError, 'dirty=True'):
                require_checkout(root, sha)
            self.assertEqual((root / 'dirty').read_text(), 'untouched fixture\n')
            (root / 'subdirectory').mkdir()
            with self.assertRaisesRegex(RuntimeError, 'exact repository root'):
                require_checkout(root / 'subdirectory', sha)

    def test_startup_contract_cannot_substitute_sources_cases_or_file_rosters(self):
        selected = select_target('all-342-startup-macos26')
        target = {key: value for key, value in selected.items()
                  if key not in ('runner', 'envelope', 'developer_directory')}
        for changed in ({'source_sha': '9ec88bd3397ccca192b2e9a95b6bd9a80b4067e3'},
                        {'source_sha': '6c578a2c18050e218b83daf80f46731040e4b3e4'},
                        {'source_sha': 'ff8c9609abf7bf7ddabe983c96ff31cf80362956'},
                        {'source_sha': 'd443a2aca506def2817b9afc0c9a20a75f5c4b5d'},
                        {'test_source_sha': '04c073bbbead6f4077da0199bacd542e45cf4e57'},
                        {'test_source_sha': '55cbda6b5b626408dc822d90b8fecab0d5828434'},
                        {'source_sha': 'f' * 40}, {'test_source_sha': 'f' * 40},
                        {'protocol_source_sha': 'f' * 40}, {'test_files': {}}, {'protocol_files': {}},
                        {'scenarios': list(reversed(target['scenarios']))}, {'scenario_count': 5}):
            with self.subTest(changed=changed), patch.object(Path, 'read_text', return_value=json.dumps({
                    'all-342-startup-macos26': {**target, **changed}})), self.assertRaisesRegex(RuntimeError, 'P/Q/R'):
                select_target('all-342-startup-macos26')

    def test_partial_wrong_source_or_failed_target_driver_is_not_acceptance(self):
        target = select_target('all-341-macos26')
        cases = [{'scenario': str(n), 'passed': True} for n in range(29)]
        summary = {'source_head': target['source_sha'], 'source_dirty': False,
                   'engine_sha256': 'a' * 64, 'native_sha256': 'b' * 64,
                   'engine_identity': {'source_revision': target['source_sha']},
                   'full_scenario_run': True, 'scenarios': cases, 'visible_paint_qualified': False}
        result = require_full_preview(summary, target, 'a' * 64)
        self.assertEqual(result['scenario_count'], 29)
        self.assertFalse(result['target_report_visible_paint_qualified'])
        for changed in ({'source_head': '0' * 40}, {'source_dirty': True},
                        {'full_scenario_run': False}, {'scenarios': cases[:-1]},
                        {'engine_sha256': 'c' * 64}, {'native_sha256': ''}, {'engine_identity': {}},
                        {'scenarios': [*cases[:-1], {'scenario': '0', 'passed': True}]},
                        {'scenarios': [*cases[:-1], {'scenario': '28', 'passed': False}]}):
            with self.assertRaisesRegex(RuntimeError, 'exact full source scenario'):
                require_full_preview({**summary, **changed}, target, 'a' * 64)

    def test_workspace_cannot_mix_baseline_binary_or_hide_failed_rows(self):
        target = select_target('all-351-macos14')
        provenance = {'source_head': target['source_sha'], 'source_status': '',
                      'engine_sha256': 'a' * 64, 'native_sha256': 'b' * 64}
        matrix = {'provenance': provenance, 'minimum_selected': None, 'full_acceptance': False}
        baseline = {'source_head': target['source_sha'], 'source_dirty': False,
                    'engine_sha256': 'a' * 64, 'native_sha256': 'b' * 64,
                    'scenarios': [{'scenario': name, 'passed': True} for name in
                        ('normal', 'engine-exit', 'missing', 'exit', 'close-startup', 'timeout')]}
        case = {'passed': True, 'engine_reaped': True, 'profile_removed': True,
                'launcher_exit_code': 0, 'checks': {'visible-paint': {'status': 'pass'}}}
        episodes = {name: case for name in ('workspace-direct', 'workspace-legacy')}
        self.assertIsNone(require_workspace(matrix, episodes, baseline, target)['target_minimum_selected'])
        separate_links = {**case, 'checks': {**case['checks'], 'links': {'status': 'unavailable'}}}
        disposition = require_workspace(matrix, {**episodes, 'workspace-direct': separate_links}, baseline, target)
        self.assertEqual(disposition['workspace_checks']['workspace-direct']['links'], 'unavailable')
        with self.assertRaisesRegex(RuntimeError, 'identity'):
            require_workspace(matrix, episodes, {**baseline, 'native_sha256': 'c' * 64}, target)
        with self.assertRaisesRegex(RuntimeError, 'failed'):
            require_workspace(matrix, {**episodes, 'workspace-direct': {**case, 'checks': {
                'visible-paint': {'status': 'unavailable'}}}}, baseline, target)


class RichCaptureTests(unittest.TestCase):
    def test_exact_fixture_receipt_and_affected_negative_controls(self):
        # Source/receipt contract only. The native OCR/painting gate is separate.
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            fixture, png = directory / 'WorkspaceFixture.swift', directory / 'rich.png'
            fixture.write_text('    static let rich = #"""\n    fixture full answer Ω\n    """#\n')
            expected = 'fixture full answer Ω'
            png.write_bytes(b'fixture PNG bytes; not an image qualification')
            digest = hashlib.sha256(expected.encode()).hexdigest()
            identity = dict(source_head='1' * 40, engine_sha256='a' * 64, native_sha256='b' * 64)
            observation = dict(ready=True, reason='ready', expected=dict(kind='rich', id='owned'),
                hash='#/session/owned/insights', full_answer=expected, loadingConversation=False,
                fonts_ready=True, visibility='visible', sentinel_observation=dict(visible=False),
                message_identity=dict(session_id='owned', visible_index=1, created_at='fixture', message_count=2),
                surfaces=[dict(visible=True, within_frame=True) for _ in range(5)])
            capture = dict(source_identity=identity, expected_answer_sha256=digest,
                settled_answer_sha256_before=digest, settled_answer_sha256_after=digest,
                png_sha256=hashlib.sha256(png.read_bytes()).hexdigest(), semantic_ready=True,
                animation_frame_observed=True, window_visible=True, window_occlusion_visible=True,
                window_visible_after_snapshot=True, readiness=copy.deepcopy(observation),
                after_snapshot_readiness=copy.deepcopy(observation))
            def qualify(value):
                return require_rich_capture(dict(paint_diagnostics={'rich-chat.png': value}), identity, png, fixture)
            self.assertEqual(qualify(capture)['settled_answer_sha256'], digest)
            variants = []
            for field in ('source_head', 'engine_sha256', 'native_sha256'):
                value = copy.deepcopy(capture); value['source_identity'][field] = 'different'; variants.append((field, value))
            for field in ('expected_answer_sha256', 'settled_answer_sha256_after', 'png_sha256'):
                value = copy.deepcopy(capture); value[field] = 'different'; variants.append((field, value))
            for field in ('animation_frame_observed', 'window_visible', 'window_occlusion_visible', 'window_visible_after_snapshot'):
                value = copy.deepcopy(capture); value[field] = False; variants.append((field, value))
            for field, replacement in (('full_answer', 'marker only'), ('hash', '#/session/other/insights'),
                                       ('ready', False), ('loadingConversation', True), ('fonts_ready', False)):
                value = copy.deepcopy(capture); value['after_snapshot_readiness'][field] = replacement
                variants.append((field, value))
            value = copy.deepcopy(capture); value['after_snapshot_readiness']['message_identity']['created_at'] = 'other'
            variants.append(('changed message identity', value))
            value = copy.deepcopy(capture); value['readiness']['surfaces'][0]['within_frame'] = False
            variants.append(('clipped actual target', value))
            variants.append(('old receipt with no new binding', {}))
            for name, value in variants:
                with self.subTest(name=name), self.assertRaises(RuntimeError):
                    qualify(value)


if __name__ == '__main__':
    unittest.main()
