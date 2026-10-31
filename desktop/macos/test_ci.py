import json
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch

from ci import settle_apps
from ci_support import MAX_FILE, console_state, export_evidence, qualify_toolchain, require_console


class QualificationTests(unittest.TestCase):
    quartz = {'quartz_session_available': True, 'on_console': True, 'login_done': True,
              'screen_count': 1, 'screen_is_locked': None,
              'frontmost_bundle': 'com.apple.AccessibilityUIServer'}

    def console(self, **changes):
        session = {'kCGSSessionUserIDKey': 123, 'kCGSSessionOnConsoleKey': True,
                   'kCGSessionLoginDoneKey': True, 'CGSSessionScreenIsLocked': False}
        session.update(changes)
        return plistlib.dumps({'IOConsoleLocked': False, 'IOConsoleUsers': [session]})

    def test_locked_unknown_or_other_console_never_qualifies(self):
        self.assertFalse(require_console(self.console(), 123, self.quartz)['session_lock_flag'])
        for changes in ({'CGSSessionScreenIsLocked': True},
                        {'kCGSSessionOnConsoleKey': False},
                        {'kCGSessionLoginDoneKey': False}):
            with self.assertRaisesRegex(RuntimeError, 'GUI unavailable'):
                require_console(self.console(**changes), 123, self.quartz)
        with self.assertRaises(RuntimeError):
            require_console(self.console(), 456, self.quartz)
        root = plistlib.loads(self.console())
        del root['IOConsoleUsers'][0]['CGSSessionScreenIsLocked']
        self.assertIsNone(console_state(plistlib.dumps(root), 123)['locked'])
        observed = require_console(plistlib.dumps(root), 123, self.quartz)
        self.assertIsNone(observed['session_lock_flag'])
        self.assertTrue(observed['rendered_app_qualification_required'])
        for field, missing in [('quartz_session_available', False), ('on_console', False),
                               ('login_done', False), ('screen_count', 0),
                               ('frontmost_bundle', 'com.apple.loginwindow'),
                               ('frontmost_bundle', 'unavailable')]:
            with self.assertRaisesRegex(RuntimeError, 'unknown'):
                require_console(plistlib.dumps(root), 123, {**self.quartz, field: missing})
        with self.assertRaisesRegex(RuntimeError, 'locked'):
            require_console(plistlib.dumps(root), 123, {**self.quartz, 'screen_is_locked': True})
        del root['IOConsoleLocked']
        with self.assertRaisesRegex(RuntimeError, 'unknown'):
            require_console(plistlib.dumps(root), 123, self.quartz)
        root = plistlib.loads(self.console())
        root['IOConsoleLocked'] = True
        with self.assertRaisesRegex(RuntimeError, 'locked'):
            require_console(plistlib.dumps(root), 123, self.quartz)

    def test_toolchain_drift_and_unpinned_swift_cannot_pass(self):
        expected = json.loads(Path(__file__).with_name('ci-toolchain.json').read_text())
        actual = {key: value for key, value in expected.items() if key != 'images'}
        actual.update(image=next(iter(expected['images'])), swift='observed compiler identity')
        self.assertFalse(qualify_toolchain(actual, {**expected, 'swift': None}))
        pinned = {**expected, 'swift': actual['swift']}
        self.assertTrue(qualify_toolchain(actual, pinned))
        for field in actual:
            with self.assertRaisesRegex(RuntimeError, 'drift'):
                qualify_toolchain({**actual, field: 'unexpected'}, pinned)

    def test_export_bounds_redacts_and_refuses_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            raw = Path(temporary) / 'private'
            raw.mkdir()
            (raw / 'run.log').write_text('fixture-secret ' + 'x' * MAX_FILE)
            (raw / 'outside.log').symlink_to('/etc/hosts')
            output = Path(temporary) / 'public'
            export_evidence(raw, output, [('fixture-secret', '<redacted>')])
            text = (output / 'run.log').read_text()
            self.assertTrue(text.startswith('<redacted>'))
            self.assertNotIn('fixture-secret', text)
            self.assertFalse((output / 'outside.log').exists())
            manifest = json.loads((output / 'export.json').read_text())
            self.assertTrue(manifest[0]['truncated'])
            self.assertLessEqual(len(text), MAX_FILE)

    def test_orphan_engine_cleanup_uses_only_relocated_bundle_record(self):
        with tempfile.TemporaryDirectory() as temporary:
            raw = Path(temporary)
            (raw / 'evidence').mkdir()
            record = raw / 'evidence/normal.json'
            record.write_text(json.dumps({'app_pid': 123, 'engine_pid': 456}))
            bundle = Path(tempfile.gettempdir()) / 'nac-mac-relocation-owned/Moved folder with spaces/NAC Development Preview Smoke.app'
            checks = iter([False, True, False, False])
            with patch('ci.alive', side_effect=lambda _pid: next(checks)), \
                 patch('ci.command', return_value=str(bundle / 'Contents/Resources/nac-web')), \
                 patch('ci.cleanup_failed_case') as cleanup:
                result = settle_apps(raw)
            cleanup.assert_called_once_with(record, bundle)
            self.assertTrue(result[0]['fallback_cleanup'])

    def test_unrelated_reused_pid_is_never_signalled(self):
        with tempfile.TemporaryDirectory() as temporary:
            raw = Path(temporary)
            (raw / 'evidence').mkdir()
            (raw / 'evidence/normal.json').write_text(json.dumps({'app_pid': 123}))
            with patch('ci.alive', return_value=True), \
                 patch('ci.command', return_value='/Applications/Other.app/Contents/MacOS/Other'), \
                 patch('ci.cleanup_failed_case') as cleanup:
                with self.assertRaisesRegex(RuntimeError, 'refusing signal'):
                    settle_apps(raw)
            cleanup.assert_not_called()


if __name__ == '__main__':
    unittest.main()
