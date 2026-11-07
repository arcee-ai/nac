import json
import hashlib
from pathlib import Path
import plistlib
import tempfile
import sys
import time
import unittest
from unittest.mock import patch

from ci import run, settle_apps
from ci_support import (MAX_FILE, console_state, export_evidence, qualify_toolchain,
                        require_console, require_terminal_evidence)


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
        actual = {key: expected[key] for key in ('developer_directory', 'xcode', 'sdk', 'os_version', 'os_build', 'swift')}
        actual.update(image=next(iter(expected['images'])), swift='observed compiler identity')
        self.assertFalse(qualify_toolchain(actual, {**expected, 'swift': None}))
        pinned = {**expected, 'swift': actual['swift']}
        self.assertTrue(qualify_toolchain(actual, pinned))
        for field in actual:
            with self.assertRaisesRegex(RuntimeError, 'drift'):
                qualify_toolchain({**actual, field: 'unexpected'}, pinned)

    def test_current_host_pair_preserves_historical_envelopes_and_rejects_cross_pairs(self):
        # Exact environment observation: run42332629180/job128282373371; no compile or native case.
        expected = json.loads(Path(__file__).with_name('ci-toolchain.json').read_text())
        common = {key: expected[key] for key in ('developer_directory', 'xcode', 'sdk', 'swift')}
        current = {**common, 'image': '20261102.0473.1', 'os_version': '26.7.2', 'os_build': '25G332'}
        self.assertTrue(qualify_toolchain(current, expected))
        for image in ('20261026.0455.2', '20261013.0424.1', '20261021.0445.8'):
            historical = {**common, 'image': image, 'os_version': '26.6.2', 'os_build': '25G83'}
            self.assertTrue(qualify_toolchain(historical, expected))
            with self.assertRaisesRegex(RuntimeError, 'drift'):
                qualify_toolchain({**current, 'image': image}, expected)
        without_image = {**expected, 'images': {k: v for k, v in expected['images'].items() if k != current['image']}}
        with self.assertRaisesRegex(RuntimeError, 'image drift'):
            qualify_toolchain(current, without_image)  # An OS override never grants image admission.
        with self.assertRaisesRegex(RuntimeError, 'drift'):
            qualify_toolchain(current, {**expected, 'image_hosts': {}})
        for field in current:
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, 'drift'):
                qualify_toolchain({**current, field: 'foreign'}, expected)
        with self.assertRaisesRegex(RuntimeError, 'drift'):
            qualify_toolchain({**current, 'os_version': '26.6.2', 'os_build': '25G83'}, expected)

    def test_owned_fixture_environment_and_abort_do_not_change_default_launches(self):
        with tempfile.TemporaryDirectory() as temporary:
            log = Path(temporary) / 'scoped.log'
            run([sys.executable, '-c', 'import os; print(os.environ["NAC354_TEST_ENV"])'], log, 3,
                env={'NAC354_TEST_ENV': 'scoped-only'})
            self.assertEqual(log.read_text().strip(), 'scoped-only')
            with patch('ci.subprocess.Popen') as spawn, self.assertRaisesRegex(RuntimeError, 'before helper'):
                run([sys.executable, '-c', 'raise SystemExit(99)'], log, 3, abort=lambda: True)
            spawn.assert_not_called()
            start = time.monotonic()
            with self.assertRaisesRegex(RuntimeError, 'during helper'):
                run([sys.executable, '-c', 'import time; time.sleep(30)'], Path(temporary) / 'aborted.log', 3,
                    abort=lambda: time.monotonic() - start > .15)
            self.assertLess(time.monotonic() - start, 3)

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

    def test_terminal_case_cannot_skip_or_substitute_synthetic_input(self):
        terminal = {'exact_receipt': True, 'native_terminal_settled': True,
                    'unfocused_input_rejected': True, 'trusted_keydowns': 70,
                    'synthetic_keydowns': 0}
        record = {'scenario': 'ci-terminal', 'passed': True, 'trusted_terminal': terminal}
        self.assertEqual(require_terminal_evidence(record), terminal)
        for bad in ({}, {**record, 'passed': False}, {**record, 'scenario': 'normal'},
                    {**record, 'trusted_terminal': {**terminal, 'synthetic_keydowns': 1}},
                    {**record, 'trusted_terminal': {**terminal, 'trusted_keydowns': 0}},
                    {**record, 'trusted_terminal': {**terminal, 'native_terminal_settled': False}}):
            with self.assertRaisesRegex(RuntimeError, 'missing or incomplete'):
                require_terminal_evidence(bad)

    def test_startup_export_distinguishes_source_and_redacted_output_hashes(self):
        with tempfile.TemporaryDirectory() as temporary:
            raw, output = Path(temporary) / 'private', Path(temporary) / 'public'
            raw.mkdir()
            original = b'{"path":"/owned/private/home"}\n'
            (raw / 'fixture.json').write_bytes(original)
            export_evidence(raw, output, [('/owned/private/home', '<fixture-home>')], include_hashes=True)
            manifest = json.loads((output / 'export.json').read_text())[0]
            self.assertEqual(manifest['raw_source_sha256'], hashlib.sha256(original).hexdigest())
            self.assertEqual(manifest['raw_source_bytes'], len(original))
            self.assertEqual(manifest['exported_sha256'], hashlib.sha256((output / 'fixture.json').read_bytes()).hexdigest())
            self.assertNotEqual(manifest['raw_source_sha256'], manifest['exported_sha256'])
            self.assertFalse(manifest['truncated'])

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

    def test_target_owner_cleans_recorded_helper_after_app_and_engine_exit(self):
        with tempfile.TemporaryDirectory() as temporary:
            raw = Path(temporary)
            (raw / 'evidence').mkdir()
            record = raw / 'evidence/parent-loss.json'
            record.write_text(json.dumps({'app_pid': 123, 'app_helper_pid': 456}))
            remaining = {456}
            def clean(owned_record, _bundle):
                self.assertEqual(owned_record, record)
                remaining.clear()
            with patch('ci.alive', return_value=False):
                result = settle_apps(raw, cleanup=clean, extra_alive=lambda pid: pid in remaining)
            self.assertTrue(result[0]['fallback_cleanup'])
            self.assertFalse(remaining)


if __name__ == '__main__':
    unittest.main()
