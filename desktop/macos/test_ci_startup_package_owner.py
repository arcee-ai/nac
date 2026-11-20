"""The hosted startup candidate must contain its own committed package writer."""
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from ci_startup import product_package_owner


class StartupPackageOwnerTests(unittest.TestCase):
    def test_startup_deadline_reserves_ten_minutes_of_hosted_cleanup(self):
        from ci import qualification_deadline
        started = 1234.0
        self.assertEqual(qualification_deadline(started, 'startup'), started + 60 * 60)
        self.assertEqual(qualification_deadline(started, 'paths'), started + 30 * 60)
        self.assertEqual(qualification_deadline(started, None), started + 30 * 60)

    def test_exact_committed_writer_required(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()

            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL).decode().strip()

            git('init', '-q')
            git('config', 'user.name', 'Fixture')
            git('config', 'user.email', 'fixture@example.invalid')
            git('commit', '--allow-empty', '-qm', 'missing owner')
            owner = root / 'desktop/macos/packaging/package.py'
            with patch('ci_startup.PRODUCT', git('rev-parse', 'HEAD')):
                with self.assertRaisesRegex(RuntimeError, 'lacks its committed package owner'):
                    product_package_owner(root)
                owner.parent.mkdir(parents=True)
                owner.write_text('untracked writer\n')
                with self.assertRaisesRegex(RuntimeError, 'lacks its committed package owner'):
                    product_package_owner(root)

            git('add', 'desktop/macos/packaging/package.py')
            git('commit', '-qm', 'committed owner')
            with patch('ci_startup.PRODUCT', git('rev-parse', 'HEAD')):
                self.assertEqual(product_package_owner(root), owner)
                owner.write_text('changed writer\n')
                with self.assertRaisesRegex(RuntimeError, 'differs from nominated source'):
                    product_package_owner(root)
                owner.unlink()
                owner.symlink_to(root / 'other')
                with self.assertRaisesRegex(RuntimeError, 'must not use symlinks'):
                    product_package_owner(root)


if __name__ == '__main__':
    unittest.main()
