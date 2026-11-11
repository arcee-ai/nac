"""Real private directory/fd tests; child and WebKit callbacks are inert fakes.

No Swift program, helper, WebKit initialization, process signal or GUI operation.
"""
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from notification_port_fixture import PortOwner, open_directory


class PortOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.owner = PortOwner(Path(self.temporary.name))
        self.addCleanup(self.owner.close)
        self.calls = []
        self.child = SimpleNamespace(poll=lambda: 1, wait=lambda: self.calls.append('reaped'))

    def removed(self, owner):
        self.calls.append('webkit-fake')
        return dict(root=str(owner.root), profile='a'*64, initialization_ephemeral=True,
                    website_store_removed='10000000-0000-0000-0000-000000000001')

    def test_failed_child_reaped_before_exact_cleanup_and_owned_tree_removal(self):
        nested = self.owner.root / 'Library'; nested.mkdir(mode=0o700)
        (nested / 'inert-checkpoint').write_text('fixture')
        self.owner.cleanup(self.child, self.removed)
        self.assertEqual(self.calls, ['reaped', 'webkit-fake'])
        self.assertFalse(self.owner.parent.exists())

    def test_live_or_unknown_child_never_invokes_cleanup(self):
        for child in (None, SimpleNamespace(poll=lambda: None)):
            with self.assertRaises(AssertionError): self.owner.cleanup(child, self.removed)
        self.assertEqual(self.calls, [])
        self.assertTrue(self.owner.root.exists())

    def test_symlink_root_foreign_mode_and_extra_root_are_rejected(self):
        alias = Path(self.temporary.name) / 'alias'; alias.symlink_to(self.owner.root)
        with self.assertRaises(AssertionError): open_directory(alias)
        self.owner.root.chmod(0o755)
        with self.assertRaises(AssertionError): self.owner.cleanup(self.child, self.removed)
        self.owner.root.chmod(0o700)
        (self.owner.tmp / 'foreign').mkdir(mode=0o700)
        with self.assertRaises(AssertionError): self.owner.cleanup(self.child, self.removed)
        self.assertNotIn('webkit-fake', self.calls)

    def test_replaced_root_and_late_callback_do_not_delete_successor(self):
        original = self.owner.root
        moved = original.with_name('retained-original')
        def late(owner):
            original.rename(moved)
            original.mkdir(mode=0o700)
            (original / 'foreign').write_text('preserve')
            return self.removed(owner)
        with self.assertRaises(AssertionError): self.owner.cleanup(self.child, late)
        self.assertEqual((original / 'foreign').read_text(), 'preserve')
        self.assertTrue(moved.exists())

    def test_replacement_before_cleanup_never_invokes_webkit(self):
        self.owner.root.rename(self.owner.root.with_name('retained-original'))
        self.owner.root.mkdir(mode=0o700)
        with self.assertRaises(AssertionError): self.owner.cleanup(self.child, self.removed)
        self.assertNotIn('webkit-fake', self.calls)

    def test_helper_failure_wrong_receipt_and_nested_symlink_retain_evidence(self):
        sentinel = Path(self.temporary.name) / 'foreign'; sentinel.write_text('preserve')
        link = self.owner.root / 'foreign-link'; link.symlink_to(sentinel)
        with self.assertRaises(AssertionError): self.owner.cleanup(self.child, self.removed)
        self.assertEqual(sentinel.read_text(), 'preserve')
        self.assertTrue(link.is_symlink())
        link.unlink()
        with self.assertRaises(AssertionError):
            self.owner.cleanup(self.child, lambda owner: dict(self.removed(owner), root='/foreign'))
        def failed(owner): raise RuntimeError('inert helper failure')
        with self.assertRaisesRegex(RuntimeError, 'inert helper failure'):
            self.owner.cleanup(self.child, failed)
        self.assertTrue(self.owner.root.exists())

    def test_foreign_uid_is_symbolic_not_kernel_impersonation(self):
        from unittest.mock import patch
        with patch('notification_port_fixture.os.getuid', return_value=os.getuid() + 1):
            with self.assertRaises(AssertionError): self.owner.validate()
        self.assertTrue(self.owner.root.exists())

    def test_source_guard_precedes_output_creation_and_native_launch(self):
        from unittest.mock import patch
        import notification_port_fixture
        output = Path(self.temporary.name) / 'not-created'
        with patch.object(notification_port_fixture, 'source_binding', side_effect=AssertionError('source mismatch')), \
             patch.object(notification_port_fixture.subprocess, 'Popen') as launch:
            with self.assertRaisesRegex(AssertionError, 'source mismatch'):
                notification_port_fixture.run_contract(Path('/unused'), Path('/unused'), output, 'a'*40)
        launch.assert_not_called()
        self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
