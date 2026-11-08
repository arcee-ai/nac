"""Real-file controls for polling the native producer's atomic JSON publication."""
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

import storage_q1 as q1


class NativeRecordTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.path = self.root / 'native.json'
        self.path.write_text('{"generation":1}')

    def replace(self, *, retain=False):
        successor = self.root / 'next.json'
        successor.write_text('{"generation":2}')
        if retain:
            self.path.rename(self.root / 'retained.json')
        os.replace(successor, self.path)

    def during_stat(self, index, action):
        original = os.fstat
        calls = 0
        def fstat(fd):
            nonlocal calls
            calls += 1
            if calls == index:
                action()
            return original(fd)
        return patch.object(q1.os, 'fstat', side_effect=fstat)

    def test_stable_record_is_accepted(self):
        self.assertEqual(q1.read_record(self.path), {'generation': 1})

    def test_atomic_replacement_before_or_after_read_discards_original_bytes(self):
        for index in (1, 2):
            with self.subTest(index=index):
                with self.during_stat(index, self.replace):
                    with self.assertRaises(q1.RecordPublicationChanged):
                        q1.read_record(self.path, publication_changes=True)
                self.assertEqual(q1.read_record(self.path), {'generation': 2})

    def test_different_named_inode_is_unavailable_even_when_old_inode_retained(self):
        with self.during_stat(2, lambda: self.replace(retain=True)):
            with self.assertRaises(q1.RecordPublicationChanged):
                q1.read_record(self.path, publication_changes=True)

    def test_static_admission_reader_does_not_retry_replaced_record(self):
        with self.during_stat(1, self.replace):
            with self.assertRaises(ValueError):
                q1.read_record(self.path)

    def test_polling_discards_then_reads_successor_without_resetting_deadline(self):
        owner = q1.RecoveryLaunch.__new__(q1.RecoveryLaunch)
        owner.output = self.path
        owner.deadline = time.monotonic() + 1
        original_deadline = owner.deadline
        with self.during_stat(1, self.replace):
            self.assertEqual(owner.read(), {})
        self.assertEqual(owner.read(), {'generation': 2})
        self.assertEqual(owner.deadline, original_deadline)
        owner.deadline = time.monotonic() - 1
        with self.assertRaises(TimeoutError):
            owner.read()

    def test_hardlinks_symlinks_directories_and_oversize_are_not_retries(self):
        os.link(self.path, self.root / 'hardlink')
        with self.assertRaises(ValueError):
            q1.read_record(self.path, publication_changes=True)
        (self.root / 'hardlink').unlink()
        link = self.root / 'symlink'
        link.symlink_to(self.path)
        with self.assertRaises(OSError) as error:
            q1.read_record(link, publication_changes=True)
        self.assertNotIsInstance(error.exception, q1.RecordPublicationChanged)
        with self.assertRaises(ValueError):
            q1.read_record(self.root, publication_changes=True)
        with self.path.open('wb') as stream:
            stream.truncate(8 * 1024 * 1024 + 1)
        with self.assertRaises(ValueError):
            q1.read_record(self.path, publication_changes=True)

    def test_in_place_write_is_not_discarded_as_an_atomic_replacement(self):
        with self.during_stat(2, lambda: self.path.write_text('{"generation":123}')):
            with self.assertRaisesRegex(ValueError, 'record changed'):
                q1.read_record(self.path, publication_changes=True)

    def test_changed_bytes_then_replacement_still_fail(self):
        def mutate_then_replace():
            self.path.write_text('{"generation":123}')
            self.replace()
        with self.during_stat(2, mutate_then_replace):
            with self.assertRaisesRegex(ValueError, 'record changed'):
                q1.read_record(self.path, publication_changes=True)


if __name__ == '__main__':
    unittest.main()
