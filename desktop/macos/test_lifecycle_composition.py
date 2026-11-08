"""Run the real lifecycle entry and AppJourney API using inert OS boundaries."""
import ast
import copy
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

class MinimizedQuitJourneyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = (OWNER / 'lifecycle_smoke.py').read_text()
        selected = [node for node in ast.parse(source).body if isinstance(node, ast.FunctionDef)
                    and node.name in ('minimize_before_quit', 'verify_minimized_quit')]
        cls.functions = {}
        exec(compile(ast.Module(body=selected, type_ignores=[]), str(OWNER/'lifecycle_smoke.py'), 'exec'), cls.functions)

    def sample(self):
        before = dict(window_number=17, document='original-document', engine_pid=42, launch_incarnation='launch',
                      miniaturized=True, visible=False, front=False, sheet_window=0, confirmation_id='',
                      termination_pending=False, owners_intact=True, stop_started=False, observed_uptime=1)
        restored = {**before, 'miniaturized': False, 'visible': True, 'front': True,
                    'sheet_window': 23, 'confirmation_id': 'first', 'termination_pending': True, 'observed_uptime': 2}
        return {'workspace_window_number': 17, 'owned_engine_pid': 42,
                'minimize-quit': before, 'restored-minimize-quit': restored,
                'cancel_after_minimized_quit': {**before, 'miniaturized': False, 'observed_uptime': 3},
                'minimize-quit-again': {**before, 'observed_uptime': 4},
                'restored-minimize-quit-again': {**restored, 'confirmation_id': 'second', 'observed_uptime': 5},
                'native_duplicate_invocation': {'before': {**restored}}}

    def test_legacy_missing_minimization_is_red_and_two_owned_cycles_are_green(self):
        verify = self.functions['verify_minimized_quit']
        legacy = {'workspace_window_number': 17, 'owned_engine_pid': 42}
        with self.assertRaises(KeyError):
            verify(legacy)  # Old journey has no observed minimized-window coverage.
        verify(self.sample())
        for key, field, value in [('minimize-quit', 'miniaturized', False),
                ('minimize-quit-again', 'miniaturized', False), ('restored-minimize-quit', 'window_number', 18),
                ('restored-minimize-quit-again', 'document', 'replacement'),
                ('restored-minimize-quit', 'visible', False), ('restored-minimize-quit', 'front', False),
                ('restored-minimize-quit', 'sheet_window', 0), ('restored-minimize-quit', 'miniaturized', True),
                ('cancel_after_minimized_quit', 'termination_pending', True),
                ('cancel_after_minimized_quit', 'engine_pid', 99), ('cancel_after_minimized_quit', 'stop_started', True),
                ('minimize-quit-again', 'observed_uptime', 2),
                ('restored-minimize-quit-again', 'confirmation_id', 'first')]:
            row = copy.deepcopy(self.sample()); row[key][field] = value
            with self.subTest(key=key, field=field), self.assertRaises(AssertionError):
                verify(row)

    def test_actual_driver_prefix_waits_for_each_native_minimization_receipt(self):
        events, sample = [], self.sample()
        class Journey:
            def guard_focus(self): events.append('focus')
            def command_file(self, name): events.append(('command', name))
            def stage(self, name):
                events.append(('stage', name)); return sample
        for command in ('minimize-quit', 'minimize-quit-again'):
            self.functions['minimize_before_quit'](Journey(), command, 42)
        self.assertEqual(events, ['focus', ('command', 'minimize-quit'), ('stage', 'minimize-quit-ready'),
                                  'focus', ('command', 'minimize-quit-again'), ('stage', 'minimize-quit-again-ready')])
        sample['minimize-quit']['miniaturized'] = False
        with self.assertRaises(AssertionError):
            self.functions['minimize_before_quit'](Journey(), 'minimize-quit', 42)

    def test_actual_swift_minimization_observations_with_inert_native_boundaries(self):
        source = (OWNER / 'LifecycleSmoke.swift').read_text()
        poll = source[source.index('    private func poll() {'):source.index('    // BEGIN MINIMIZED QUIT JOURNEY')]
        identity = source[source.index('    private func sameEngine()'):source.index('    private func pollRendererFailure()')]
        identity += source[source.index('    private func intact()'):source.index('    /// Read the actual current episode')]
        source = source.split('// BEGIN MINIMIZED QUIT JOURNEY', 1)[1].split('// END MINIMIZED QUIT JOURNEY', 1)[0]
        source = source[source.index('\n') + 1:]
        boundary = r"""
import Foundation
final class NSWindow {
    var windowNumber = 17, isMiniaturized = false, isVisible = true, isKeyWindow = true
    var attachedSheet: NSWindow?
    var supportsMinimization = true
    var onAnswer: (() -> Void)?
    func performClose(_ sender: Any?) { isVisible = false }
    func endSheet(_ sheet: NSWindow, returnCode: ModalResponse) { attachedSheet = nil; onAnswer?() }
    func miniaturize(_ sender: Any?) { if supportsMinimization { isMiniaturized = true } }
}
enum ModalResponse { case alertFirstButtonReturn, alertSecondButtonReturn }
enum DesktopStartupError: Error { case message(String) }
final class View { var isHidden = false }
struct Receipt { let incarnation = "launch", endpoint = "inert", store = "owned" }
final class Engine { var pid = 42; var receipt: Receipt? = Receipt() }
struct Episode: Equatable { let id = UUID() }
final class Lifecycle { enum Phase: Equatable { case running, confirming(Episode) }; var phase = Phase.running }
final class Quit { let lifecycle = Lifecycle(); var terminationPending = false }
final class App {
    var window: NSWindow! = NSWindow(), webView: View! = View()
    let engine = Engine(), quit = Quit(); var stopping = false
    var failure: String?, baseURL: URL? = nil
    var commands = Commands(), lifecycleFailureStatus = "inert"
    func webViewWebContentProcessDidTerminate(_ view: View) {}
}
final class Commands { var smokeSnapshot: [String: Any] = ["installed": true] }
final class Application {
    var isActive = true, onTerminate: (() -> Void)?
    func terminate(_ sender: Any?) { onTerminate?() }
}
let NSApp = Application()
final class Probe {
    let app = App()
    weak var originalNativeWindow: NSWindow?
    var pendingMinimization: String?, stage = "reopened", evidence = [String: Any]()
    var commands: Set<String> = ["minimize-quit"], ownersStable = true
    var published = [String](), seen = Set<String>(), scenario = "run"
    var duplicateDeadline: TimeInterval?
    var originalView: View?, originalPID: Int = 42, originalReceipt: Receipt?, originalWindow = 17
    init() { originalNativeWindow = app.window; originalView = app.webView; originalReceipt = app.engine.receipt }
    func take(_ name: String) -> Bool {
        if commands.remove(name) != nil { seen.insert(name); return true }; return false
    }
    func capture(_ name: String) async throws {}
    func prepare() async throws {}
    func js(_ text: String) async throws -> Any { true }
    func duplicateUnknown(_ text: String) { fail(text) }
    func invokeDuplicate() {}
    func pollRendererFailure() {}
    func publish(_ next: String) { stage = next; published.append(next) }
    func fail(_ message: String) { stage = "failed" }
// METHODS
    func fullCycle() -> [String: Any] {
        var stages = [String]()
        NSApp.onTerminate = { [self] in
            app.window.isMiniaturized = false
            let sheet = NSWindow(); sheet.windowNumber = 23
            app.window.attachedSheet = sheet; app.quit.terminationPending = true
            app.quit.lifecycle.phase = .confirming(Episode())
            app.window.onAnswer = { [self] in app.quit.lifecycle.phase = .running }
        }
        poll(); stages.append(stage)
        commands.insert("quit"); poll()
        RunLoop.main.run(until: Date().addingTimeInterval(0.01)); poll(); stages.append(stage)
        commands.insert("cancel"); poll(); stages.append(stage)
        app.quit.terminationPending = false; poll(); stages.append(stage)
        commands.insert("minimize-quit-again"); poll(); stages.append(stage)
        commands.insert("quit-again"); poll()
        RunLoop.main.run(until: Date().addingTimeInterval(0.01)); poll(); stages.append(stage)
        var result = evidence
        result["stages"] = stages; result["workspace_window_number"] = 17; result["owned_engine_pid"] = 42
        result["native_duplicate_invocation"] = ["before": evidence["restored-minimize-quit"]!]
        NSApp.onTerminate = nil
        return result
    }
    func run(_ mode: String) -> [String: Any] {
        if mode == "full-cycle" { return fullCycle() }
        if mode == "unobserved" { app.window.supportsMinimization = false }
        if mode == "foreign" { app.window = NSWindow() }
        if mode == "second" { stage = "cancelled"; commands = ["minimize-quit-again"] }
        pollMinimizedQuit()
        let command = mode == "second" ? "minimize-quit-again" : "minimize-quit"
        let observed = evidence[command] as? [String: Any]
        var restored = false
        if ["restored", "still-miniaturized", "not-front", "foreign-sheet"].contains(mode) {
            let sheet = NSWindow(); sheet.windowNumber = 23
            app.window.attachedSheet = sheet; app.quit.terminationPending = true
            app.quit.lifecycle.phase = .confirming(Episode())
            if mode != "still-miniaturized" { app.window.isMiniaturized = false }
            if mode == "not-front" { app.window.isKeyWindow = false; sheet.isKeyWindow = false }
            restored = recordRestoredQuit(mode == "foreign-sheet" ? NSWindow() : sheet, command: command)
        }
        return ["stage": stage, "published": published, "observed": observed as Any? ?? NSNull(),
                "restored": restored, "record": evidence["restored-" + command] as Any? ?? NSNull()]
    }
}
let modes = ["minimized", "unobserved", "foreign", "second", "restored", "still-miniaturized", "not-front", "foreign-sheet", "full-cycle"]
let rows = modes.map { Probe().run($0) }
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: rows))
"""
        with tempfile.TemporaryDirectory(prefix='lifecycle-minimized-source-') as temporary:
            root = Path(temporary); swift = root/'main.swift'; binary = root/'proof'
            swift.write_text(boundary.replace('// METHODS', poll + identity + source))
            result = subprocess.run(['swiftc', '-swift-version', '5', str(swift), '-o', str(binary)],
                                    capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stderr)
            rows = json.loads(subprocess.check_output([str(binary)], text=True, timeout=5))
        self.assertTrue(rows[0]['observed']['miniaturized'])
        self.assertEqual(rows[0]['published'], ['minimize-quit-ready'])
        self.assertIsNone(rows[1]['observed'])
        self.assertEqual(rows[1]['published'], [])  # Issued action alone never supplies proof.
        self.assertEqual(rows[2]['stage'], 'failed')
        self.assertEqual(rows[3]['published'], ['minimize-quit-again-ready'])
        self.assertTrue(rows[4]['restored'])
        self.assertFalse(rows[4]['record']['miniaturized'])
        for row in rows[5:8]:
            self.assertFalse(row['restored']); self.assertIsNone(row['record'])
        self.assertEqual(rows[7]['stage'], 'failed')
        self.assertEqual(rows[8]['stages'], ['minimize-quit-ready', 'confirming', 'confirming',
                                           'cancelled', 'minimize-quit-again-ready', 'reconfirming'])
        self.functions['verify_minimized_quit'](rows[8])


if __name__ == '__main__':
    unittest.main()
