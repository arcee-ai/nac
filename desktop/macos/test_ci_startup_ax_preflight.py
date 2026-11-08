"""Inert parent controls. No helper, process, app, trust API or compiler runs."""
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import threading
import unittest
from unittest.mock import Mock

from ci_startup_owner import capture_ax_preflight


def sha(data):
    return hashlib.sha256(data).hexdigest()


class AXPreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.helper, self.source, self.config = (self.root / n for n in ('helper', 'source', 'config'))
        self.helper.write_bytes(b'inert binary'); self.source.write_bytes(b'inert source')
        self.config.write_text('{"schema":"fixture-only"}')
        node = dict(pid=10, parent=1, uid=501, start_seconds=1234, start_microseconds=5,
                    executable='/owned/NACPreview', kind='app', windows=[58])
        self.witness = SimpleNamespace(condition=threading.Condition(), ready=True, failure=None,
            app=node.copy(), latest=[node.copy()], configuration_sha256=sha(self.config.read_bytes()),
            config=json.loads(self.config.read_bytes()))
        self.run = Mock(side_effect=self.respond)
        self.change = lambda value: None
        self.helper_failure = False

    def respond(self, argv, log, cap, *, abort):
        self.assertEqual(cap, 10); self.assertFalse(abort())
        self.assertEqual(argv[:3], [str(self.helper), '--ax-preflight', str(self.config)])
        request = Path(argv[3]).read_bytes()
        value = dict(schema='nac342-ax-preflight-v1', acceptance=False, trusted=True,
            windows_read=True, ax_code=0, window_count=1, root_matches=1, bound=True,
            identity_rechecked=True, signing_code=0, app_sandbox_entitlement=False,
            configuration_sha256=self.witness.configuration_sha256,
            request_sha256=sha(request), binary_sha256=sha(self.helper.read_bytes()))
        self.change(value)
        log.write_text(json.dumps(value))
        if self.helper_failure:
            raise RuntimeError('original helper failure')

    def capture(self):
        return capture_ax_preflight(self.witness, self.helper, self.source, self.config, self.root,
            run=self.run, source_sha256=sha(b'inert source'), binary_sha256=sha(b'inert binary'))

    def test_bound_receipt_is_diagnostic_only(self):
        value = self.capture()
        self.assertFalse(value['acceptance']); self.assertTrue(value['bound'])
        self.assertEqual(self.run.call_count, 1)

    def test_untrusted_zero_messaging_retained_before_original_failure(self):
        self.change = lambda v: v.update(trusted=False, windows_read=False, window_count=0,
                                        root_matches=0, bound=False)
        self.helper_failure = True
        with self.assertRaisesRegex(RuntimeError, 'original helper failure'):
            self.capture()
        receipt = json.loads((self.root / 'ax-preflight.json').read_bytes())
        self.assertFalse(receipt['windows_read']); self.assertFalse(receipt['bound'])

    def test_malformed_failed_receipt_preserves_original_helper_failure(self):
        self.change = lambda v: v.update(tree='forbidden')
        self.helper_failure = True
        with self.assertRaisesRegex(RuntimeError, 'original helper failure'):
            self.capture()
        self.assertTrue((self.root / 'ax-preflight.log').exists())

    def test_rejects_untrusted_messaging(self):
        self.change = lambda v: v.update(trusted=False)
        with self.assertRaises(RuntimeError): self.capture()
        self.assertFalse((self.root / 'ax-preflight.json').exists())

    def test_rejects_arbitrary_text_field(self):
        self.change = lambda v: v.update(tree='untrusted app text')
        with self.assertRaises(RuntimeError): self.capture()

    def test_rejects_bool_as_count(self):
        self.change = lambda v: v.update(window_count=True)
        with self.assertRaises(RuntimeError): self.capture()

    def test_rejects_two_matching_roots(self):
        self.change = lambda v: v.update(window_count=2, root_matches=2)
        with self.assertRaises(RuntimeError): self.capture()

    def test_rejects_stale_configuration_before_execution(self):
        self.config.write_text('{}')
        with self.assertRaises(RuntimeError): self.capture()
        self.run.assert_not_called()

    def test_rejects_stale_owner_before_execution(self):
        self.witness.latest[0]['start_microseconds'] += 1
        with self.assertRaises(RuntimeError): self.capture()
        self.run.assert_not_called()

    def test_rejects_pid_reuse_after_execution(self):
        self.change = lambda v: self.witness.app.update(start_microseconds=99)
        with self.assertRaises(RuntimeError): self.capture()

    def test_rejects_latest_app_retirement_after_successful_helper(self):
        cached = self.witness.app.copy()
        self.change = lambda v: self.witness.latest.clear()
        with self.assertRaises(RuntimeError):
            self.capture()
        self.assertEqual(self.witness.app, cached)
        self.assertIsNone(self.witness.failure)
        self.assertEqual(self.run.call_count, 1)
        self.assertTrue(json.loads((self.root / 'ax-preflight.log').read_bytes())['bound'])
        self.assertFalse((self.root / 'ax-preflight.json').exists())

    def test_rejects_latest_window_loss_after_successful_helper(self):
        cached = self.witness.app.copy()
        self.change = lambda v: self.witness.latest[0].update(windows=[])
        with self.assertRaises(RuntimeError):
            self.capture()
        self.assertEqual(self.witness.app, cached)
        self.assertEqual(self.witness.latest[0]['windows'], [])
        self.assertIsNone(self.witness.failure)
        self.assertEqual(self.run.call_count, 1)
        self.assertTrue(json.loads((self.root / 'ax-preflight.log').read_bytes())['bound'])
        self.assertFalse((self.root / 'ax-preflight.json').exists())

    def test_latest_loss_preserves_original_failed_helper_error(self):
        self.change = lambda v: self.witness.latest.clear()
        self.helper_failure = True
        with self.assertRaisesRegex(RuntimeError, 'original helper failure'):
            self.capture()
        self.assertTrue((self.root / 'ax-preflight.log').exists())
        self.assertEqual(self.run.call_count, 1)
        self.assertFalse((self.root / 'ax-preflight.json').exists())

    def test_rejects_helper_mutation(self):
        self.change = lambda v: self.helper.write_bytes(b'changed')
        with self.assertRaises(RuntimeError): self.capture()

    def test_no_follow_source(self):
        self.source.unlink(); self.source.symlink_to(self.helper)
        with self.assertRaises(RuntimeError): self.capture()
        self.run.assert_not_called()

    def test_production_mode_plain_trust_and_single_windows_read(self):
        source = Path(__file__).with_name('CIStartupObserver.swift').read_text()
        mode = source.split('enum StartupAXPreflight {', 1)[1].split('@main', 1)[0]
        self.assertEqual(mode.count('AXIsProcessTrusted()'), 1)
        self.assertNotIn('WithOptions', mode)
        self.assertEqual(mode.count('read(element, kAXWindowsAttribute)'), 1)
        self.assertLess(mode.index('if trusted {'), mode.index('AXUIElementCreateApplication'))
        self.assertIn('defer {', mode)
        self.assertNotIn('AXUIElementPerformAction', mode)
        self.assertNotIn('AXUIElementSetAttributeValue', mode)
        self.assertNotIn('try? emit', mode)


if __name__ == '__main__':
    unittest.main()
