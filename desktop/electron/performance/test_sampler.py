"""Exercise the real counter adapter against known process CPU and lifetime."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from compare import Candidate, admitted_geometry, identities_settled, pid_census


class SamplerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='nac-perf-collector-')
        cls.binary = Path(cls.directory.name) / 'sample'
        subprocess.run(['xcrun', 'clang', '-O2', '-Wall', '-Wextra', '-Werror',
                        str(Path(__file__).with_name('process_sample.c')), '-o', str(cls.binary)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def sample(self, pid):
        return json.loads(subprocess.check_output([str(self.binary), str(pid)]))[0]

    def test_cpu_clock_matches_independent_process_time(self):
        first = self.sample(os.getpid())
        began, cpu = time.monotonic(), time.process_time()
        while time.monotonic() - began < .3:
            pass
        used = time.process_time() - cpu
        last = self.sample(os.getpid())
        self.assertTrue(first['valid'] and last['valid'])
        self.assertEqual((first['birth_sec'], first['birth_usec']), (last['birth_sec'], last['birth_usec']))
        ratio = (last['cpu_ns'] - first['cpu_ns']) / 1e9 / used
        self.assertGreater(ratio, .8)
        self.assertLess(ratio, 1.2)
        self.assertGreater(last['physical_footprint_bytes'], 0)

    def test_reaped_child_is_unavailable_not_zero_usage(self):
        child = subprocess.Popen(['/usr/bin/true'])
        child.wait()
        self.assertEqual(self.sample(child.pid), dict(pid=child.pid, valid=False))

    def test_invalid_identifier_refused(self):
        result = subprocess.run([str(self.binary), '-1'], capture_output=True)
        self.assertEqual(result.returncode, 64)

    def test_window_display_admission_refuses_unknown_or_spanning_target(self):
        display = dict(id=1, bounds=dict(x=0, y=0, width=1512, height=982), scale=2, refresh_hz=120)
        window = dict(bounds=dict(x=116, y=80, width=1280, height=832),
                      display_metadata_available=True, displays=[display])
        self.assertEqual(admitted_geometry(dict(native_windows=[window])), window)
        for windows in ([], [window, window],
                        [dict(window, displays=[])], [dict(window, displays=[display, display])],
                        [dict(window, displays=[dict(display, refresh_hz=0)])]):
            with self.assertRaises(RuntimeError):
                admitted_geometry(dict(native_windows=windows))

    def test_settled_geometry_keeps_startup_proxy_and_refuses_late_drift(self):
        window = dict(bounds=dict(x=116, y=91, width=1280, height=832),
                      display_metadata_available=True,
                      displays=[dict(id=1, scale=2, refresh_hz=120)])
        candidate = Candidate.__new__(Candidate)
        candidate.geometry = candidate.steady_geometry = None
        candidate.launch_displays = window['displays']
        candidate.observations = {'launch': {'native_windows': [dict(window, bounds=dict(width=1278))]}}
        candidate.state = lambda: dict(native_windows=[window])
        candidate.geometry_current()
        self.assertEqual(candidate.observations['launch']['native_windows'][0]['bounds']['width'], 1278)
        self.assertEqual(candidate.observations['settled']['native_windows'][0]['bounds']['width'], 1280)
        candidate.state = lambda: dict(native_windows=[dict(window, bounds=dict(width=1279))])
        with self.assertRaisesRegex(RuntimeError, 'within trial'):
            candidate.geometry_current()
        candidate.geometry = None
        with self.assertRaisesRegex(RuntimeError, 'between arm trials'):
            candidate.geometry_current()

    def test_unavailable_counter_cannot_retire_a_still_present_process(self):
        child = subprocess.Popen(['/bin/sleep', '30'])
        try:
            captured = self.sample(child.pid)
            self.assertTrue(captured['valid'])
            known = {child.pid: (captured['birth_sec'], captured['birth_usec'])}
            unavailable = [dict(pid=child.pid, valid=False)]
            self.assertFalse(identities_settled(known, unavailable, pid_census()))
            child.terminate()
            child.wait(timeout=5)
            self.assertTrue(identities_settled(known, unavailable, pid_census()))
        finally:
            if child.poll() is None:
                child.terminate(); child.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
