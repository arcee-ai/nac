from pathlib import Path
import subprocess
import tempfile
import unittest

from ci_qualifications import require_checkout, require_full_preview, require_workspace, select_target


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
        self.assertEqual(terminal['source_sha'], 'dd87b0e97f7e5f5bfcbfcbf5b2bee2fe30b88b3a')
        self.assertEqual(terminal['suite'], 'terminal')
        self.assertEqual(terminal['phase_count'], 6)
        older = select_target('all-351-macos14')
        self.assertEqual(older['runner'], 'macos-14')
        self.assertEqual(older['source_sha'], 'fa94a859b648cb36fbdcb251bfe4bc9541de3f48')
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


if __name__ == '__main__':
    unittest.main()
