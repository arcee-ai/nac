from pathlib import Path
import subprocess
import tempfile
import unittest

from ci_qualifications import require_checkout, require_full_preview, select_target


class ExactSourceTests(unittest.TestCase):
    def test_only_named_immutable_standard_runner_targets_resolve(self):
        target = select_target('all-341-macos26')
        self.assertEqual(target['source_sha'], '1a4f9c31f27b4656897673084f3440e05373393d')
        self.assertEqual(target['runner'], 'macos-26')
        self.assertEqual(target['scenario_count'], 29)
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
                   'full_scenario_run': True, 'scenarios': cases, 'visible_paint_qualified': False}
        result = require_full_preview(summary, target)
        self.assertEqual(result['scenario_count'], 29)
        self.assertFalse(result['target_report_visible_paint_qualified'])
        for changed in ({'source_head': '0' * 40}, {'source_dirty': True},
                        {'full_scenario_run': False}, {'scenarios': cases[:-1]},
                        {'scenarios': [*cases[:-1], {'scenario': '0', 'passed': True}]},
                        {'scenarios': [*cases[:-1], {'scenario': '28', 'passed': False}]}):
            with self.assertRaisesRegex(RuntimeError, 'exact full source scenario'):
                require_full_preview({**summary, **changed}, target)


if __name__ == '__main__':
    unittest.main()
