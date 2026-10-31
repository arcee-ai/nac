"""Run exact production Swift probes/emitter in a Foundation-only fixture CLI.

Every process/path/exit probe is injected. No AppKit, real PID inspection,
signal, product engine, app, browser or XCTest is executed by these controls.
The resulting production-schema records enter the actual Python owner/caller.
"""
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, patch

from ci_startup import run_case
from ci_startup_owner import OwnerWitness

DRIVER = r'''
let fixturePath = "/private/nac342-xctest-unit/NAC.app"
let fixtureEnvironment = ["HOME": "/private/owned home", "NAC_HOME": "/private/owned home/nac"]
func stamp(_ pid: Int32) -> proc_bsdinfo {
    var value = proc_bsdinfo()
    value.pbi_pid = UInt32(pid); value.pbi_ppid = pid == 10 ? 1 : (pid == 11 ? 10 : 11)
    value.pbi_uid = 501; value.pbi_start_tvsec = 1234; value.pbi_start_tvusec = UInt64(pid)
    return value
}
func executable(_ pid: Int32) -> String {
    fixturePath + (pid == 10 ? "/Contents/MacOS/NACPreview" : "/Contents/Resources/nac-web")
}
func node(_ identity: StartupProcessIdentity) -> [String: Any] {
    var value = identity.record
    value.merge(["kind": identity.pid == 10 ? "app" : "engine", "environment": fixtureEnvironment,
        "arguments_sha256": String(repeating: "c", count: 64), "serving": identity.pid == 11,
        "configuration_helper": false]) { _, new in new }
    if identity.pid == 10 { value["app_launch_epoch"] = 1234.5; value["windows"] = [17] }
    return value
}
func injected(_ pid: Int32, previous: StartupProcessIdentity?, scope: String, mode: String) throws -> StartupProcessIdentity? {
    var reads = 0
    return try StartupProcessProbe.observe(pid, previous: previous, scope: scope, uid: 501,
        readBSD: { requested in
            if mode == "gone" || mode == "bsd_denied" || mode == "bsd_unavailable" {
                try StartupProcessProbe.checked(false, pid: requested, stage: "bsd", error: mode == "bsd_denied" ? EPERM : EIO)
            }
            var value = stamp(requested)
            reads += 1
            if mode == "reuse" || (mode == "bookend_reuse" && reads == 2) { value.pbi_start_tvusec = 999 }
            return value
        }, readPath: { requested in
            if mode == "path_denied" || mode == "path_unavailable" || mode == "existence_unavailable" {
                try StartupProcessProbe.checked(false, pid: requested, stage: "path", error: mode == "path_denied" ? EACCES : EIO)
            }
            return executable(requested)
        }, isAbsent: { requested in
            if mode == "existence_unavailable" {
                try StartupProcessProbe.checked(false, pid: requested, stage: "existence", error: EIO)
            }
            return mode == "gone"
        })
}
let scenario = CommandLine.arguments[1], configurationSHA = CommandLine.arguments[2]
var known: [Int32: StartupProcessIdentity] = [:]
for pid: Int32 in [10, 11] { known[pid] = try injected(pid, previous: nil, scope: "candidate", mode: "live")! }
try StartupObserver.emit(StartupObserver.readyRecord(configurationSHA))
try StartupObserver.emit(StartupObserver.record(nodes: known.values.map(node), retired: [], enumeratedExits: []))
do {
    if scenario == "genuine_exit" {
        for pid in known.keys {
            guard try injected(pid, previous: known[pid], scope: "known", mode: "gone") == nil else { throw OwnershipError.invalid }
        }
        try StartupObserver.emit(StartupObserver.record(nodes: [], retired: known.values.map { $0.retirement }, enumeratedExits: []))
    } else if scenario == "new_child_exit" {
        guard try injected(12, previous: nil, scope: "enumerated_child", mode: "gone") == nil else { throw OwnershipError.invalid }
        try StartupObserver.emit(StartupObserver.record(nodes: known.values.map(node), retired: [],
            enumeratedExits: [["pid": 12, "parent": 11, "proof": "kill_zero_ESRCH"]]))
    } else {
        let child = scenario == "new_child_unavailable"
        if scenario == "app_exit_engine_unavailable" {
            guard try injected(10, previous: known[10], scope: "known", mode: "gone") == nil else { throw OwnershipError.invalid }
        }
        let mode = ["new_child_unavailable", "app_exit_engine_unavailable"].contains(scenario) ? "path_unavailable" : scenario
        _ = try injected(child ? 12 : 11, previous: child ? nil : known[11], scope: child ? "enumerated_child" : "known", mode: mode)
        throw OwnershipError.invalid // Every other declared scenario must reject.
    }
} catch {
    try StartupObserver.emit(StartupObserver.failureRecord(error, known: known))
}
'''


@unittest.skipUnless(sys.platform == 'darwin' and shutil.which('swiftc'), 'Darwin Swift Foundation probe controls unavailable')
class ProductionObserverControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='nac354-observer-source-controls-')
        cls.addClassCleanup(cls.temporary.cleanup)
        folder = Path(cls.temporary.name).resolve()
        source = (Path(__file__).parent / 'CIStartupObserver.swift').read_text()
        cls.production_source_sha256 = hashlib.sha256(source.encode()).hexdigest()
        cls.records = {}
        def section(name):
            begin, end = '// BEGIN ' + name, '// END ' + name
            assert source.count(begin) == source.count(end) == 1
            return source.split(begin, 1)[1].split('\n', 1)[1].split(end, 1)[0]
        need = '    static func need' + source.split('    static func need', 1)[1].split('    static func arguments', 1)[0]
        text = ('import Foundation\nimport Darwin\nimport CryptoKit\n'
                + 'enum OwnershipError: Error { case invalid }\n' + section('STARTUP PROCESS PROBES')
                + '\nenum StartupObserver {\n' + need + section('STARTUP OBSERVER RECORDS') + '\n}\n' + DRIVER)
        file = folder / 'main.swift'
        file.write_text(text)
        cls.executable = folder / 'ObserverControls'
        result = subprocess.run(['swiftc', '-swift-version', '5', str(file), '-o', str(cls.executable)],
                                capture_output=True, text=True, timeout=45)
        if result.returncode:
            raise AssertionError('Production probe fixture compilation failed: ' + result.stderr[-8192:])
        cls.fixture_executable_sha256 = hashlib.sha256(cls.executable.read_bytes()).hexdigest()

    def frames(self, scenario, configuration_sha='b' * 64):
        result = subprocess.run([str(self.executable), scenario, configuration_sha], capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr[-4096:])
        self.assertLess(len(result.stdout), 64 * 1024)
        frames = [json.loads(line) for line in result.stdout.splitlines()]
        self.records[scenario + '-' + configuration_sha[:12]] = frames
        return frames

    def config(self, root='/private/nac342-xctest-unit'):
        return {'app_path': '/private/nac342-xctest-unit/NAC.app', 'fixture_root': root,
                'environment': {'HOME': '/private/owned home', 'NAC_HOME': '/private/owned home/nac'},
                'scenario': 'onboarding', 'native_sha256': 'a' * 64}

    def owner(self, frames):
        owner = OwnerWitness(self.config(), 'b' * 64, uid=501)
        for record in frames:
            owner.observe(record)
        return owner

    def test_app_exit_and_surviving_engine_unknown_path_never_emit_settled_empty(self):
        frames = self.frames('app_exit_engine_unavailable')
        self.assertEqual(frames[-1]['event'], 'failed')
        self.assertNotIn('nodes', frames[-1])
        owner = self.owner(frames)
        self.assertEqual({node['pid'] for node in owner.latest}, {10, 11})
        self.assertEqual(owner.unresolved, [{'pid': 11, 'scope': 'known', 'reason': 'path_unavailable'}])
        self.assertFalse(owner.failure_receipt()['positive_settlement'])
        with self.assertRaises(RuntimeError):
            owner.settle(0)

    def test_new_enumerated_child_unknown_path_never_becomes_ignored_or_signal_authority(self):
        owner = self.owner(self.frames('new_child_unavailable'))
        self.assertEqual(set(owner.history), {10, 11})
        self.assertEqual(owner.unresolved, [{'pid': 12, 'scope': 'enumerated_child', 'reason': 'path_unavailable'}])
        inspect, send = Mock(), Mock()
        with self.assertRaises(RuntimeError):
            owner.signal_owned(owner.history[11], 15, inspect=inspect, send=send)
        inspect.assert_not_called()
        send.assert_not_called()

    def test_denied_other_errors_and_pid_reuse_keep_known_identity_and_failure(self):
        for scenario, reason in [('path_denied', 'path_denied'), ('path_unavailable', 'path_unavailable'),
                                 ('bsd_denied', 'bsd_denied'), ('bsd_unavailable', 'bsd_unavailable'),
                                 ('existence_unavailable', 'existence_unavailable'), ('reuse', 'identity_changed'),
                                 ('bookend_reuse', 'identity_changed')]:
            with self.subTest(scenario=scenario):
                owner = self.owner(self.frames(scenario))
                self.assertEqual(owner.unresolved[0]['reason'], reason)
                self.assertEqual(owner.history[11]['start_microseconds'], 11)
                self.assertTrue(owner.retained_diagnostics)
                self.assertFalse(owner.failure_receipt()['positive_settlement'])
                with self.assertRaises(RuntimeError):
                    owner.settle(0)

    def test_genuine_exit_requires_explicit_positive_retirement_and_never_signals(self):
        owner = self.owner(self.frames('genuine_exit'))
        self.assertIsNone(owner.failure)
        self.assertEqual(owner.latest, [])
        self.assertEqual(set(owner.retired), {10, 11})
        owner.wait_empty = Mock(return_value=True)
        proof = owner.settle(0)
        self.assertTrue(proof['complete_observation'])
        self.assertEqual(len(proof['retired_identities']), 2)
        self.assertEqual(proof['fallback_signals'], [])
        with self.assertRaises(RuntimeError):
            owner.signal_owned(owner.history[11], 15, inspect=Mock(), send=Mock())

    def test_positive_exit_of_new_child_has_no_adoption_or_signal_authority(self):
        owner = self.owner(self.frames('new_child_exit'))
        self.assertIsNone(owner.failure)
        self.assertEqual(set(owner.history), {10, 11})
        self.assertNotIn(12, owner.retired)
        self.assertFalse(owner.failure_receipt()['positive_settlement'])

    def test_actual_emitted_uncertainty_reaches_caller_and_preserves_profile(self):
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
            root = Path(temporary).resolve()
            fixture, folder = root / 'nac342-xctest-unit', root / 'evidence'
            fixture.mkdir()
            config = self.config(str(fixture))
            config_path = fixture / 'startup-config.json'
            config_path.write_text(json.dumps(config))
            configuration_sha = hashlib.sha256(config_path.read_bytes()).hexdigest()
            frames = self.frames('app_exit_engine_unavailable', configuration_sha)
            owner = OwnerWitness(config, configuration_sha, uid=501)
            owner.start = lambda *args: [owner.observe(record) for record in frames[:2]]
            owner.stop = lambda: None
            runner = root / 'synthetic.xctestrun'
            runner.write_bytes(b'unit-only runner; never passed to xcodebuild')
            def test_request(*args, **options):
                owner.observe(frames[2])
                self.assertTrue(options['abort']())
                raise RuntimeError('Synthetic native request aborted on actual owner uncertainty')
            provider = MagicMock()
            provider.start.return_value = 'http://127.0.0.1:4321'
            provider.stop.return_value = {'scope': 'synthetic provider'}
            audit = MagicMock(failure=None)
            audit.stop.return_value = {'scope': 'synthetic API'}
            remove = Mock()
            values = {'Provider': Mock(return_value=provider), 'prepare_profile': Mock(return_value={'root': fixture}),
                'prepare_configuration': Mock(return_value=(config, config_path, {})),
                'configuration_selection': Mock(return_value={}), 'immutable_snapshot': Mock(return_value={}),
                'generated_runner': Mock(return_value=(runner, {'xctestrun_sha256': hashlib.sha256(runner.read_bytes()).hexdigest()})),
                'observe_prerequisites': Mock(return_value={}), 'authorization_policy': Mock(return_value={}),
                'test_contract': MagicMock(), 'AttachmentTool': MagicMock(), 'OwnerWitness': Mock(return_value=owner),
                'LiveAudit': Mock(return_value=audit), 'require_integrity': Mock(return_value={}), 'remove_profile': remove}
            for name, value in values.items():
                stack.enter_context(patch('ci_startup.' + name, value))
            inspect = stack.enter_context(patch('ci_startup_owner.ctypes.CDLL', side_effect=AssertionError('No live PID probe in fixture')))
            signal = stack.enter_context(patch('ci_startup_owner.os.kill', side_effect=AssertionError('No OS signal in fixture')))
            with self.assertRaises(RuntimeError):
                run_case(folder, root, 'onboarding', root, root, root, root, 'a' * 40, {}, root, root,
                         test_request, Mock(), Mock())
            remove.assert_not_called()
            inspect.assert_not_called()
            signal.assert_not_called()
            self.assertTrue(fixture.is_dir())
            receipt = json.loads((folder / 'owner-observation.json').read_text())
            self.assertFalse(receipt['positive_settlement'])
            self.assertEqual(receipt['unresolved'][0]['pid'], 11)
            self.assertEqual({row['pid'] for row in receipt['known_identities']}, {10, 11})
            retained = json.loads((folder / 'retained-fixture.json').read_text())
            self.assertFalse(retained['positive_process_settlement'])


if __name__ == '__main__':
    unittest.main()
