"""Fail-closed controls for focused browser acceptance receipts."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('terminal_browser', Path(__file__).with_name('terminal-browser.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class Controls(unittest.TestCase):
    def receipt(self, *, status='passed', errors=None, attempts=1, skipped=0, unexpected=0, expected=1):
        result = {'status': status, 'errors': errors or []}
        return {'suites': [{'specs': [{'title': runner.TITLE, 'tests': [
            {'status': 'expected' if status == 'passed' else 'unexpected', 'results': [result] * attempts}
        ]}]}], 'errors': [], 'stats': {'expected': expected, 'unexpected': unexpected, 'skipped': skipped, 'flaky': 0}}

    def verify(self, data, negative=False):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'result.json'
            path.write_text(json.dumps(data))
            runner.verify_result(path, negative)

    def test_only_one_actual_positive_attempt_passes(self):
        self.verify(self.receipt())
        for changed in (self.receipt(status='skipped', skipped=1, expected=0),
                        self.receipt(attempts=2), self.receipt(status='failed', unexpected=1, expected=0)):
            with self.assertRaises(RuntimeError):
                self.verify(changed)
        zero = self.receipt()
        zero['suites'] = []
        with self.assertRaises(RuntimeError):
            self.verify(zero)

    def test_negative_requires_selected_failure_and_clean_teardown(self):
        failure = self.receipt(status='failed', errors=[{'message': 'Error: native paste byte negative control\n\nexpected bytes differ'}], unexpected=1, expected=0)
        self.verify(failure, True)
        for message in ('timeout', 'missing clipboard permission', 'cleanup failed',
                        'Error: raw capture timeout\nsource context: native paste byte negative control'):
            wrong = self.receipt(status='failed', errors=[{'message': message}], unexpected=1, expected=0)
            with self.assertRaises(RuntimeError):
                self.verify(wrong, True)
        failure['suites'][0]['specs'][0]['tests'][0]['results'][0]['errors'].append({'message': 'cleanup failed'})
        with self.assertRaises(RuntimeError):
            self.verify(failure, True)
        with self.assertRaises(RuntimeError):
            self.verify(self.receipt(), True)
        infrastructure = self.receipt()
        infrastructure['errors'] = [{'message': 'worker cleanup failed'}]
        with self.assertRaises(RuntimeError):
            self.verify(infrastructure)


if __name__ == '__main__':
    unittest.main()
