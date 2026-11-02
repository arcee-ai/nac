import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from smoke import cleanup_failed_case


class CleanupTests(unittest.TestCase):
    def test_mismatched_process_and_profile_remain_untouched(self):
        with tempfile.TemporaryDirectory(prefix='nac-mac-preview-') as temporary:
            root = Path(temporary)
            record = root / 'ownership.json'
            unrelated = subprocess.Popen(['/bin/sleep', '60'], start_new_session=True)
            try:
                record.write_text(json.dumps({'engine_pid': unrelated.pid, 'profile': str(root)}))
                with self.assertRaisesRegex(RuntimeError, 'mismatched'):
                    cleanup_failed_case(record, root / 'Other.app')
                self.assertIsNone(unrelated.poll())
                self.assertTrue(root.exists())
            finally:
                unrelated.terminate()
                unrelated.wait()

    def test_owned_process_group_and_fixture_are_removed(self):
        with tempfile.TemporaryDirectory(prefix='nac-smoke-cleanup-test-') as temporary:
            bundle = Path(temporary) / 'Owned.app'
            engine = bundle / 'Contents/Resources/nac-web'
            engine.parent.mkdir(parents=True)
            engine.write_text('#!/bin/sh\nwhile :; do /bin/sleep 1; done\n')
            engine.chmod(0o755)
            with tempfile.TemporaryDirectory(prefix='nac-mac-preview-') as profile:
                record = Path(temporary) / 'ownership.json'
                child = subprocess.Popen([str(engine)], start_new_session=True)
                try:
                    record.write_text(json.dumps({'engine_pid': child.pid, 'profile': profile}))
                    cleanup_failed_case(record, bundle)
                    child.wait(timeout=5)
                    self.assertIsNotNone(child.returncode)
                    self.assertFalse(Path(profile).exists())
                finally:
                    if child.poll() is None:
                        child.kill()
                        child.wait()


if __name__ == '__main__':
    unittest.main()
