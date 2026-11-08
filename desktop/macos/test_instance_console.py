import copy
import json
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch, Mock

from instance_console import console_refusals, console_state, require_console
from instance_smoke import AppJourney, workspace_case, main, SCENARIOS


def unlocked():
    return dict(runner_uid=501, runner_euid=501, console_uid=501, frontmost_uid=501, errors=[],
                root=dict(IOConsoleLocked=False, CGSSessionScreenIsLocked=None),
                sessions=[dict(kCGSSessionOnConsoleKey=True, kCGSessionLoginDoneKey=True,
                               kCGSSessionUserIDKey=501, CGSSessionScreenIsLocked=None)],
                quartz=dict(session_available=True, window_list_available=True, screen_count=1,
                            session=dict(uid=501, on_console=True, login_done=True, screen_is_locked=None),
                            frontmost=dict(pid=42, bundle='com.apple.finder', name='Finder', launch_time=10.0),
                            windows=[dict(owner='Finder', pid=42, on_screen=True, layer=0)]))


class PredicateTests(unittest.TestCase):
    def test_independent_positive_facts_allow_absent_optional_lock_observations(self):
        state = unlocked()
        before = copy.deepcopy(state)
        self.assertEqual(console_refusals(state), [])
        self.assertEqual(state, before, 'Evaluation must not synthesize optional observations')
        state['root']['CGSSessionScreenIsLocked'] = False
        state['sessions'][0]['CGSSessionScreenIsLocked'] = False
        state['quartz']['session']['screen_is_locked'] = False
        self.assertEqual(console_refusals(state), [])
        del state['root']['CGSSessionScreenIsLocked']
        del state['sessions'][0]['CGSSessionScreenIsLocked']
        del state['quartz']['session']['screen_is_locked']
        self.assertEqual(console_refusals(state), [])

    def test_each_critical_fact_unknown_or_false_refuses(self):
        sample = unlocked()
        paths = [(key,) for key in ('runner_uid', 'runner_euid', 'console_uid', 'frontmost_uid', 'root', 'sessions', 'quartz')]
        paths += [('root', 'IOConsoleLocked')]
        paths += [('sessions', 0, key) for key in ('kCGSSessionOnConsoleKey', 'kCGSessionLoginDoneKey', 'kCGSSessionUserIDKey')]
        paths += [('quartz', key) for key in ('session_available', 'window_list_available', 'screen_count', 'session', 'frontmost', 'windows')]
        paths += [('quartz', 'session', key) for key in ('uid', 'on_console', 'login_done')]
        paths += [('quartz', 'frontmost', key) for key in ('pid', 'bundle', 'name')]
        paths += [('quartz', 'windows', 0, key) for key in ('owner', 'pid', 'on_screen', 'layer')]
        for path in paths:
            for value in (None, '', [], {}):
                with self.subTest(path=path, value=value):
                    state = copy.deepcopy(sample)
                    target = state
                    for key in path[:-1]:
                        target = target[key]
                    target[path[-1]] = value
                    self.assertTrue(console_refusals(state))
        for path in [('sessions', 0, 'kCGSSessionOnConsoleKey'), ('sessions', 0, 'kCGSessionLoginDoneKey'),
                     ('quartz', 'session', 'on_console'), ('quartz', 'session', 'login_done')]:
            state = unlocked()
            target = state
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = False
            self.assertTrue(console_refusals(state))

    def test_any_explicit_or_malformed_lock_refuses_even_with_root_false(self):
        for path in [('root', 'CGSSessionScreenIsLocked'), ('sessions', 0, 'CGSSessionScreenIsLocked'),
                     ('quartz', 'session', 'screen_is_locked')]:
            for value in (True, 0, 1, 'false', [], {}):
                with self.subTest(path=path, value=value):
                    state = unlocked()
                    target = state
                    for key in path[:-1]:
                        target = target[key]
                    target[path[-1]] = value
                    self.assertTrue(console_refusals(state))
        state = unlocked()
        state['root']['IOConsoleLocked'] = True
        self.assertTrue(console_refusals(state))
        state = unlocked()
        state['sessions'].append(dict(kCGSSessionOnConsoleKey=False, CGSSessionScreenIsLocked=True))
        self.assertTrue(console_refusals(state))

    def test_wrong_or_ambiguous_console_owner_refuses(self):
        for key in ('runner_euid', 'console_uid', 'frontmost_uid'):
            state = unlocked()
            state[key] = 502
            self.assertTrue(console_refusals(state))
        state = unlocked()
        state['sessions'][0]['kCGSSessionUserIDKey'] = 502
        self.assertTrue(console_refusals(state))
        state = unlocked()
        state['quartz']['session']['uid'] = 502
        self.assertTrue(console_refusals(state))
        state = unlocked()
        state['sessions'] *= 2
        self.assertTrue(console_refusals(state))

    def test_loginwindow_and_screensavers_refuse_in_front_or_any_window(self):
        for name in ('loginwindow', 'com.apple.loginwindow', 'ScreenSaverEngine', 'Screen Saver', 'LockScreen'):
            for location in ('bundle', 'name', 'window'):
                state = unlocked()
                if location == 'window':
                    state['quartz']['windows'].append(dict(owner=name, pid=99, on_screen=True, layer=1000))
                else:
                    state['quartz']['frontmost'][location] = name
                self.assertTrue(console_refusals(state), (name, location))


class CollectionTests(unittest.TestCase):
    def outputs(self, session_lock=None):
        sample = unlocked()
        row = sample['sessions'][0]
        if session_lock is None:
            del row['CGSSessionScreenIsLocked']
        else:
            row['CGSSessionScreenIsLocked'] = session_lock
        tree = [dict(IORegistryEntryName='Root', IOConsoleLocked=False, IOConsoleUsers=[row])]
        return [plistlib.dumps(tree), json.dumps(sample['quartz']).encode(), '501\n']

    def collect(self, outputs):
        with patch('instance_console.subprocess.check_output', side_effect=outputs), \
                patch('instance_console.os.getuid', return_value=501), \
                patch('instance_console.os.geteuid', return_value=501), \
                patch('instance_console.os.stat', return_value=Mock(st_uid=501)):
            return console_state(Path('/owned/observer'))

    def test_actual_collection_retains_absent_optional_values(self):
        state = self.collect(self.outputs())
        self.assertTrue(state['unlocked'], state)
        self.assertIsNone(state['sessions'][0]['CGSSessionScreenIsLocked'])
        self.assertIsNone(state['quartz']['session']['screen_is_locked'])
        self.assertNotIn('observed', state)

    def test_local_root_false_session_true_still_refuses(self):
        state = self.collect(self.outputs(True))
        self.assertFalse(state['unlocked'])
        self.assertIs(state['root']['IOConsoleLocked'], False)
        self.assertIs(state['sessions'][0]['CGSSessionScreenIsLocked'], True)

    def test_actual_ioreg_root_dictionary_and_singleton_array_are_supported(self):
        outputs = self.outputs()
        root = plistlib.loads(outputs[0])[0]
        outputs[0] = plistlib.dumps(root)
        self.assertTrue(self.collect(outputs)['unlocked'])
        for value in ({}, [root, root], [dict(root, IORegistryEntryName='Other')]):
            outputs = self.outputs()
            outputs[0] = plistlib.dumps(value)
            self.assertFalse(self.collect(outputs)['unlocked'])

    def test_timeout_malformed_or_missing_quartz_refuses(self):
        for outputs in ([subprocess.TimeoutExpired('ioreg', 4), b'{}'],
                        [b'not a plist', b'{}'], [self.outputs()[0], b'null'],
                        [self.outputs()[0], b'{}'], [self.outputs()[0], b'not json']):
            self.assertFalse(self.collect(outputs)['unlocked'])

    def test_old_hosted_quartz_receipt_cannot_substitute_for_new_critical_facts(self):
        state = unlocked()
        state['quartz'] = dict(on_console=True, login_done=True, quartz_session_available=True,
                               screen_count=1, frontmost_bundle='com.apple.finder', screen_is_locked=None)
        del state['console_uid']
        self.assertTrue(console_refusals(state))

    def test_observation_is_repeated_and_refusal_is_retained(self):
        observations = []
        with patch('instance_console.console_state', side_effect=[dict(unlocked=True, refusals=[]),
                                                                 dict(unlocked=False, refusals=['locked'])]) as read:
            require_console('observer', observations, 'launch')
            with self.assertRaisesRegex(AssertionError, 'retry.*locked'):
                require_console('observer', observations, 'retry')
        self.assertEqual(read.call_count, 2)
        self.assertEqual([row['boundary'] for row in observations], ['launch', 'retry'])
        self.assertFalse(observations[-1]['state']['unlocked'])


class BoundaryTests(unittest.TestCase):
    def test_failed_strict_preflight_retains_raw_refusal_before_any_fixture_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            state = unlocked()
            state['sessions'][0]['CGSSessionScreenIsLocked'] = True
            state.update(unlocked=False, refusals=console_refusals(state))
            with patch('instance_smoke.sys.argv', ['instance_smoke.py', '/unused.app', directory, '/observer']), \
                    patch('instance_console.console_state', return_value=state), \
                    patch('instance_smoke.shutil.copytree') as relocate, \
                    patch('instance_smoke.AppJourney') as launch, patch('instance_smoke.OwnedEngine') as engine:
                with self.assertRaisesRegex(AssertionError, 'preflight'):
                    main()
            relocate.assert_not_called()
            launch.assert_not_called()
            engine.assert_not_called()
            receipt = json.loads((Path(directory) / 'summary.json').read_text())
            self.assertFalse(receipt['runtime_passed'])
            self.assertFalse(receipt['actual_app_acceptance'])
            self.assertFalse(receipt['fixture_retained'])
            self.assertEqual(receipt['console_observations'][0]['state'], state)

    def journey(self, root):
        with patch.object(AppJourney, 'observe', return_value=dict(apps=[], frontmost=dict(pid=1))):
            return AppJourney(root / 'Own.app', root / 'result.json', root, {}, root / 'store',
                              root / 'observer', [])

    def test_unsafe_launch_and_native_control_have_no_side_effects(self):
        with tempfile.TemporaryDirectory() as directory:
            journey = self.journey(Path(directory))
            try:
                with patch('instance_smoke.require_console', side_effect=AssertionError('locked')), \
                        patch('instance_smoke.subprocess.Popen') as launch:
                    with self.assertRaisesRegex(AssertionError, 'locked'):
                        journey.launch()
                    with self.assertRaisesRegex(AssertionError, 'locked'):
                        journey.command_file('retry-live')
                launch.assert_not_called()
                self.assertFalse((journey.control / 'retry-live').exists())
            finally:
                journey.log.close()

    def test_unsafe_cleanup_never_restores_focus(self):
        with tempfile.TemporaryDirectory() as directory:
            journey = self.journey(Path(directory))
            journey.identity = dict(pid=2)
            try:
                with patch('instance_smoke.record_console', return_value=dict(unlocked=False)), \
                        patch('instance_smoke.subprocess.run') as activate:
                    journey.restore_prior()
                activate.assert_not_called()
            finally:
                journey.log.close()

    def test_second_simultaneous_launch_refusal_reaps_first_owned_open_handle(self):
        journey = Mock()
        journey.guard_console.side_effect = [None, AssertionError('locked')]
        process = Mock()
        process.poll.return_value = None
        with patch('instance_smoke.environment', return_value={}), \
                patch('instance_smoke.AppJourney', return_value=journey), \
                patch('instance_smoke.subprocess.Popen', return_value=process) as launch:
            with self.assertRaisesRegex(AssertionError, 'locked'):
                workspace_case(Path('/app'), Path('/case'), Path('/root'), Path('/observer'), [])
        self.assertEqual(launch.call_count, 1)
        process.terminate.assert_called_once()
        process.wait.assert_called_once_with(timeout=3)
        journey.cleanup.assert_called_once()

    def test_eight_cases_remain_explicit(self):
        self.assertEqual(SCENARIOS, ('simultaneous', 'cli', 'symlink', 'directory-symlink',
                                     'crash', 'shutdown', 'app-crash', 'coexist'))


if __name__ == '__main__':
    unittest.main()
