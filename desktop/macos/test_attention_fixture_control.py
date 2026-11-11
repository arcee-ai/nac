"""Inert custody/envelope tests: no console query, native helper or app launch."""
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from attention_fixture_control import AttentionControl, console_facts


class CustodyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.facts = dict(uid=501, console_uid=501, aqua=True, root_locked=False, cgs_locked=None)
        self.identity = dict(pid=123, bundle='fixture.attention', launch_time=123.5)
        self.state = dict(apps=[self.identity.copy()], frontmost=self.identity.copy())
        self.record = dict(app_pid=123, workspace_window_count=1, window_number=4,
                           app_active=True, control_nonce='10000000-0000-0000-0000-000000000001')
        self.journey = SimpleNamespace(identity=self.identity.copy(), control=Path(self.temporary.name).resolve(),
            observe=lambda: self.state, read=lambda: self.record, prior=dict(pid=456))
        self.control = AttentionControl(probe=lambda: self.facts, clock=lambda: 100)
        self.addCleanup(self.control.close)

    def test_root_fallback_envelope_and_exact_window_generation(self):
        self.control.publish(self.journey, 'attention-0001', 'click')
        envelope = json.loads((self.journey.control / 'attention-0001.json').read_text())
        self.assertEqual(envelope, dict(action='click', control_nonce=self.record['control_nonce'],
            app_pid='123', window_number='4', expires='102'))
        self.record['control_nonce'] = '20000000-0000-0000-0000-000000000002'
        with self.assertRaisesRegex(AssertionError, 'generation'):
            self.control.publish(self.journey, 'attention-0002', 'enable')
        self.assertFalse((self.journey.control / 'attention-0002.json').exists())

    def test_unknown_locked_wrong_uid_or_missing_aqua_fail_before_publication(self):
        for key, value in [('root_locked', None), ('root_locked', True), ('cgs_locked', True),
                           ('console_uid', 0), ('aqua', False)]:
            with self.subTest(key=key, value=value):
                facts = dict(self.facts, **{key: value})
                control = AttentionControl(probe=lambda: facts)
                with self.assertRaises(AssertionError): control.publish(self.journey, 'denied', 'click')
                self.assertTrue(control.retired)
                self.assertFalse((self.journey.control / 'denied.json').exists())

    def test_focus_loss_latches_and_cleanup_cannot_adopt_successor(self):
        self.control.check(self.journey)
        self.state['frontmost'] = dict(pid=999)
        with self.assertRaises(AssertionError): self.control.publish(self.journey, 'denied', 'click')
        self.state['frontmost'] = self.identity
        with self.assertRaisesRegex(AssertionError, 'retired'):
            self.control.publish(self.journey, 'late', 'click')
        self.control.cleanup(self.journey, 'cleanup')
        result = json.loads((self.journey.control / 'cleanup.json').read_text())
        self.assertEqual(set(result), {'action', 'app_pid', 'control_nonce'})
        self.assertEqual(result['action'], 'cleanup')
        self.state['apps'] = [dict(self.identity, launch_time=999)]
        with self.assertRaises(AssertionError): self.control.cleanup(self.journey, 'successor')
        self.assertFalse((self.journey.control / 'successor.json').exists())

    def test_initial_launch_requires_unchanged_prior_and_no_fixture_peer(self):
        self.journey.identity = None
        self.state.update(apps=[], frontmost=self.journey.prior)
        self.control.check(self.journey, launch=True)
        self.state['frontmost'] = dict(pid=999)
        with self.assertRaises(AssertionError): self.control.check(self.journey, launch=True)

    def test_exclusive_nofollow_control_write_and_bad_window_fail_closed(self):
        foreign = self.journey.control / 'foreign'; foreign.write_text('unchanged')
        (self.journey.control / 'attention-0001.json').symlink_to(foreign)
        with self.assertRaises(FileExistsError): self.control.publish(self.journey, 'attention-0001', 'click')
        self.assertTrue(self.control.retired)
        self.assertEqual(foreign.read_text(), 'unchanged')
        self.record['window_number'] = 0
        with self.assertRaises(AssertionError): AttentionControl(probe=lambda: self.facts).check(self.journey)

    def test_replaced_window_retires_controls(self):
        self.control.check(self.journey)
        self.record['window_number'] = 5
        with self.assertRaisesRegex(AssertionError, 'window replaced'):
            self.control.publish(self.journey, 'late', 'click')
        self.assertTrue(self.control.retired)

    def test_cleanup_binding_does_not_grant_locked_console_actuation(self):
        self.facts['root_locked'] = True
        self.control.bind(self.journey, self.record)
        with self.assertRaises(AssertionError): self.control.publish(self.journey, 'denied', 'click')
        self.control.cleanup(self.journey, 'cleanup')
        self.assertEqual(json.loads((self.journey.control / 'cleanup.json').read_text())['action'], 'cleanup')

    def test_console_probe_preserves_root_fallback_and_conflicting_cgs_provenance(self):
        import plistlib
        from unittest.mock import patch
        with patch('attention_fixture_control.os.getuid', return_value=501), \
             patch('attention_fixture_control.os.stat', return_value=SimpleNamespace(st_uid=501)), \
             patch('attention_fixture_control.subprocess.run', return_value=SimpleNamespace(returncode=0)), \
             patch('attention_fixture_control.subprocess.check_output', return_value=plistlib.dumps([
                 dict(IOConsoleLocked=False, IOConsoleUsers=[dict(CGSSessionScreenIsLocked=True)])])):
            facts = console_facts()
        self.assertFalse(facts['root_locked'])
        self.assertTrue(facts['cgs_locked'])
        control = AttentionControl(probe=lambda: facts)
        with self.assertRaises(AssertionError): control.publish(self.journey, 'denied', 'click')

    def test_source_guard_precedes_any_app_or_provider_operation(self):
        from unittest.mock import patch
        import attention_app_smoke
        with patch.object(attention_app_smoke, 'source_binding', side_effect=AssertionError('source mismatch')), \
             patch.object(attention_app_smoke, 'console_facts') as console, \
             patch.object(attention_app_smoke, 'QuitProvider') as provider:
            with self.assertRaisesRegex(AssertionError, 'source mismatch'):
                attention_app_smoke.run_contract('/unused', '/unused', '/unused', 'a'*40)
        console.assert_not_called()
        provider.assert_not_called()

    def test_replaced_control_directory_cannot_receive_late_cleanup(self):
        self.control.check(self.journey)
        moved = self.journey.control.with_name(self.journey.control.name + '-retained')
        self.journey.control.rename(moved)
        self.journey.control.mkdir(mode=0o700)
        try:
            with self.assertRaisesRegex(AssertionError, 'directory replaced'):
                self.control.cleanup(self.journey, 'late')
            self.assertEqual(list(self.journey.control.iterdir()), [])
        finally:
            self.journey.control.rmdir()
            moved.rename(self.journey.control)


if __name__ == '__main__':
    unittest.main()
