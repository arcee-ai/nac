"""The test provider must release its input/listener after the owning run ends."""
import json
from pathlib import Path
import subprocess
import unittest


class StartupProviderLifetime(unittest.TestCase):
    def test_finish_reaps_provider_without_waiting_for_parent_pipe_close(self):
        process = subprocess.Popen(['node', str(Path(__file__).with_name('startup_provider.mjs'))],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            process.stdin.write('{"kind":"finish"}\n')
            process.stdin.flush()
            process.wait(timeout=5)
            output, errors = process.stdout.read(), process.stderr.read()
            self.assertEqual(process.returncode, 0, errors)
            records = [json.loads(line) for line in output.splitlines()]
            self.assertTrue(records[0]['base_url'].startswith('http://127.0.0.1:'))
            self.assertEqual(records[-1], {'passed': True, 'requests': []})
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
            for stream in (process.stdin, process.stdout, process.stderr):
                stream.close()
