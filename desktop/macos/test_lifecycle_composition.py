"""Run the real lifecycle entry and AppJourney API using inert OS boundaries."""
import io
import json
import os
from pathlib import Path
import plistlib
import shutil
import socket
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

OWNER = Path(__file__).parent

class ReachedLaunch(Exception):
    pass

def module(name, source):
    result = types.ModuleType(name)
    result.__file__ = str(OWNER / (name + '.py'))
    exec(compile(source, result.__file__, 'exec'), result.__dict__)
    return result

class LifecycleCompositionTests(unittest.TestCase):
    def exercise(self, locked=False, lock_at_launch=False):
        driver_source = Path(os.environ.get('NAC_LIFECYCLE_SOURCE', OWNER / 'lifecycle_smoke.py')).read_text()
        console = module('instance_console', (OWNER / 'instance_console.py').read_text())
        contract = types.ModuleType('instance_contract')
        contract.OwnedEngine = lambda *a, **k: self.fail('Engine construction forbidden')
        contract.digest = lambda p: 'digest'
        contract.snapshot = lambda *a: self.fail('Engine snapshot forbidden')
        fixture_module = types.ModuleType('quit_fixture')
        fixture_module.TRANSCRIPT = 'inert'
        fixture_module.request = lambda *a: self.fail('HTTP forbidden')
        events, observations, journeys = [], [], []
        class Fixture:
            def __init__(self, profile):
                events.append('fixture')
                self.provider = types.SimpleNamespace(endpoint='http://inert.invalid')
            def retire_streams(self): pass
            def close(self): pass
        fixture_module.QuitWorkspaceFixture = Fixture
        smoke = types.ModuleType('smoke')
        smoke.session_lock_state = lambda: dict(observed=True, locked=False)
        def console_state(observer):
            denied = locked or (lock_at_launch and bool(observations))
            observations.append(denied)
            return dict(unlocked=not denied, refusals=['locked'] if denied else [])
        console.console_state = console_state
        with patch.dict(sys.modules, instance_contract=contract, instance_console=console,
                        quit_fixture=fixture_module, smoke=smoke):
            instance = module('instance_smoke', (OWNER / 'instance_smoke.py').read_text())
            with patch.dict(sys.modules, instance_smoke=instance):
                driver = module('lifecycle_under_control', driver_source)
        driver.console_state = lambda: dict(observed=True, locked=False)
        real_open, real_copy, real_mkdtemp = Path.open, shutil.copytree, tempfile.mkdtemp
        def opened(path, *args, **kwargs):
            if str(path) == '/System/Library/Frameworks/WebKit.framework/Resources/Info.plist':
                return io.BytesIO(plistlib.dumps(dict(CFBundleVersion='inert')))
            return real_open(path, *args, **kwargs)
        def checked(command, **kwargs):
            if command == ['git', 'rev-parse', 'HEAD']: return 'exact-C\n'
            if command == ['/usr/bin/sw_vers', '-productVersion']: return 'inert\n'
            if len(command) == 3 and command[1] == 'state':
                return json.dumps(dict(apps=[], frontmost=None)).encode()
            self.fail('Unexpected external observation: ' + repr(command))
        def copied(*args, **kwargs):
            events.append('copy')
            return real_copy(*args, **kwargs)
        def allocated(*args, **kwargs):
            events.append('profile-allocation')
            return real_mkdtemp(*args, **kwargs)
        def launch(journey):
            journeys.append(journey)
            # Exercise the real guard with the ledger set by the actual constructor.
            journey.guard_console('launch')
            events.append('launch-admitted')
            raise ReachedLaunch('inert launch boundary reached')
        forbidden = AssertionError('Native/process/network/signal boundary forbidden')
        with tempfile.TemporaryDirectory(prefix='lifecycle-composition-control-') as directory:
            root = Path(directory)
            bundle, destination, observer = root/'app', root/'evidence', root/'observer'
            resources = bundle/'Contents/Resources'
            resources.mkdir(parents=True)
            (resources/'build-receipt.json').write_text(json.dumps(dict(source_head='exact-C',
                engine_identity=dict(source_revision='exact-C'), lifecycle_smoke_instrumentation=True,
                normal_startup=True, engine_sha256='digest', native_sha256='digest')))
            with patch.object(Path, 'open', opened), patch.object(subprocess, 'check_output', checked), \
                 patch.object(subprocess, 'run', return_value=types.SimpleNamespace(returncode=0)), \
                 patch.object(subprocess, 'Popen', side_effect=forbidden), \
                 patch.object(socket, 'socket', side_effect=forbidden), \
                 patch.object(os, 'kill', side_effect=forbidden), patch.object(os, 'killpg', side_effect=forbidden), \
                 patch.object(shutil, 'copytree', copied), patch.object(tempfile, 'mkdtemp', allocated), \
                 patch.object(instance.AppJourney, 'launch', launch), \
                 patch.dict(os.environ, NAC_LIFECYCLE_SCENARIOS='terminal'):
                try:
                    driver.run_contract(bundle, destination, observer)
                except (ReachedLaunch, AssertionError, TypeError) as error:
                    result = error
                else:
                    self.fail('Control unexpectedly completed a native journey')
            summary = destination/'summary.json'
            evidence = json.loads(summary.read_text()) if summary.exists() else None
        return result, events, observations, journeys, evidence

    def test_actual_constructor_and_launch_guard_share_retained_preflight_ledger(self):
        error, events, observations, journeys, evidence = self.exercise()
        self.assertIsInstance(error, ReachedLaunch)
        self.assertEqual(events[0], 'profile-allocation')
        self.assertLess(events.index('copy'), events.index('fixture'))
        self.assertLess(events.index('fixture'), events.index('launch-admitted'))
        self.assertEqual(observations, [False, False])
        self.assertEqual(len(journeys), 1)
        self.assertEqual([r['boundary'] for r in journeys[0].console_checks], ['lifecycle-preflight', 'launch'])
        self.assertEqual(evidence['console_checks'], journeys[0].console_checks)
        self.assertFalse(evidence['passed'])

    def test_locked_preflight_refuses_before_profile_copy_fixture_or_launch(self):
        error, events, observations, journeys, evidence = self.exercise(locked=True)
        self.assertIsInstance(error, AssertionError)
        self.assertIn('lifecycle-preflight', str(error))
        self.assertEqual(events, [])
        self.assertEqual(observations, [True])
        self.assertEqual(journeys, [])
        self.assertIsNone(evidence)

    def test_console_lock_after_preflight_is_rechecked_at_launch(self):
        error, events, observations, journeys, evidence = self.exercise(lock_at_launch=True)
        self.assertIsInstance(error, AssertionError)
        self.assertIn('at launch', str(error))
        self.assertNotIn('launch-admitted', events)
        self.assertEqual(observations, [False, True])
        self.assertEqual(evidence['console_checks'], journeys[0].console_checks)
        self.assertFalse(evidence['console_checks'][-1]['state']['unlocked'])

if __name__ == '__main__':
    unittest.main()
