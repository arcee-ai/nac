from pathlib import Path
import subprocess
import unittest


class WorkspaceCaptureTests(unittest.TestCase):
    def test_actual_capture_probe_rejects_premature_views_and_accepts_revealed_content(self):
        result = subprocess.run(['node', '--test', str(Path(__file__).with_suffix('.mjs'))],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
