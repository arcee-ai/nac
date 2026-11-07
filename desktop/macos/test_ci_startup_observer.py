"""Run exact production Swift probes/emitter in a Foundation-only fixture CLI.

Every process/path/exit probe is injected. No AppKit, real PID inspection,
signal, product engine, app, browser or XCTest is executed by these controls.
The resulting production-schema records enter the actual Python owner/caller.
"""
from contextlib import ExitStack
import hashlib
import json
import select
import threading
import time
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, patch

from ci_startup import run_case
from ci_startup_owner import OwnerWitness

ARGUMENT_KERNEL = r'''
// All process/AppKit entry points used by snapshot are deterministic fixture
// adapters. No live PID, window service, sysctl or signal is reached.
var argumentRoot = ""
var argumentScenario = ""
var argumentPhase = 0
var argumentHelperGone = false
var argumentHelperReused = false
var argumentReads = 0
var argumentAbsenceChecks = 0
var argumentSignals = 0
var argumentSettlementDemands = 0
var argumentReachedBarrier = false
func getuid() -> UInt32 { 501 }
func fixturePath(_ pid: Int32) -> String {
    if pid == 99 { return "/foreign/unowned" }
    return argumentRoot + "/Moved app folder with spaces/NAC.app/Contents/" +
        (pid == 10 ? "MacOS/NACPreview" : "Resources/nac-web")
}
func fixturePIDs() -> [Int32] {
    if argumentPhase == 2 { return [99] }
    let helper = argumentScenario.hasPrefix("known-") || argumentPhase == 1
    return [10, 11] + (helper ? [12] : []) + [99]
}
func proc_pidinfo(_ pid: Int32, _ flavor: Int32, _ argument: UInt64,
                  _ output: UnsafeMutableRawPointer?, _ size: Int32) -> Int32 {
    if argumentPhase == 2 || (pid == 12 && argumentHelperGone) { errno = ESRCH; return 0 }
    var value = proc_bsdinfo()
    value.pbi_pid = UInt32(pid); value.pbi_ppid = pid == 10 ? 1 : 10
    value.pbi_uid = 501; value.pbi_start_tvsec = 1234
    value.pbi_start_tvusec = pid == 12 && argumentHelperReused ? 999 : UInt64(pid)
    output!.assumingMemoryBound(to: proc_bsdinfo.self).pointee = value
    return Int32(MemoryLayout<proc_bsdinfo>.size)
}
func proc_pidpath(_ pid: Int32, _ output: UnsafeMutableRawPointer?, _ size: UInt32) -> Int32 {
    if argumentPhase == 2 && pid != 99 { errno = ESRCH; return 0 }
    let bytes = Array(fixturePath(pid).utf8) + [0]
    bytes.withUnsafeBytes { _ = memcpy(output!, $0.baseAddress!, bytes.count) }
    return Int32(bytes.count - 1)
}
func proc_listallpids(_ output: UnsafeMutableRawPointer?, _ size: Int32) -> Int32 {
    let pids = fixturePIDs()
    if let output { pids.withUnsafeBytes { _ = memcpy(output, $0.baseAddress!, $0.count) } }
    return Int32(pids.count)
}
func proc_listchildpids(_ pid: Int32, _ output: UnsafeMutableRawPointer?, _ size: Int32) -> Int32 {
    let pids: [Int32] = pid == 10 ? fixturePIDs().filter { $0 == 11 || $0 == 12 } : []
    if !pids.isEmpty { pids.withUnsafeBytes { _ = memcpy(output!, $0.baseAddress!, $0.count) } }
    errno = 0
    return Int32(pids.count)
}
func kill(_ pid: Int32, _ signal: Int32) -> Int32 {
    if signal != 0 { argumentSignals += 1; errno = EPERM; return -1 }
    argumentAbsenceChecks += 1
    if argumentPhase == 2 { errno = ESRCH; return -1 }
    if pid == 12 && argumentScenario == "known-unknown" { errno = EIO; return -1 }
    if pid == 12 && argumentHelperGone { errno = ESRCH; return -1 }
    return 0
}
func sysctl(_ mib: UnsafeMutablePointer<Int32>?, _ count: UInt32,
            _ output: UnsafeMutableRawPointer?, _ size: UnsafeMutablePointer<Int>?,
            _ replacement: UnsafeMutableRawPointer?, _ replacementSize: Int) -> Int32 {
    let pid = mib![2]
    argumentReads += 1
    if pid == 12 && argumentPhase == 1 {
        if argumentScenario.hasSuffix("exit") || argumentScenario == "known-unknown" {
            argumentHelperGone = true; errno = ESRCH; return -1
        }
        if argumentScenario == "known-denied" || argumentScenario == "known-access-denied" {
            argumentHelperGone = true
            errno = argumentScenario == "known-denied" ? EPERM : EACCES
            return -1
        }
        if argumentScenario == "known-live" || argumentScenario == "known-reused" {
            argumentHelperReused = argumentScenario == "known-reused"
            errno = EIO; return -1
        }
        if argumentScenario == "known-malformed" {
            let bytes = [UInt8](repeating: 0, count: 8)
            bytes.withUnsafeBytes { _ = memcpy(output!, $0.baseAddress!, bytes.count) }
            size!.pointee = bytes.count; argumentHelperGone = true
            return 0
        }
    }
    let executable = fixturePath(pid)
    let argv = [executable] + (pid == 10 ? [] :
        (pid == 12 ? ["__desktop-configuration"] : ["--bind", "127.0.0.1:4321"]))
    var environment = ["HOME": "/private/owned home", "NAC_HOME": "/private/owned home/nac"]
    if pid == 12 && argumentPhase == 1 && argumentScenario == "known-environment" {
        environment["GITHUB_TOKEN"] = "fixture-secret-never-emitted"
        argumentHelperGone = true
    }
    var nargs = Int32(argv.count)
    var bytes = withUnsafeBytes(of: &nargs) { Array($0) }
    bytes += Array(executable.utf8) + [0, 0]
    for word in argv { bytes += Array(word.utf8) + [0] }
    for key in environment.keys.sorted() { bytes += Array((key + "=" + environment[key]!).utf8) + [0] }
    bytes.append(0)
    bytes.withUnsafeBytes { _ = memcpy(output!, $0.baseAddress!, bytes.count) }
    size!.pointee = bytes.count
    if pid == 12 && argumentPhase == 1 && argumentScenario == "known-reused-after-arguments" {
        argumentHelperReused = true
    }
    return 0
}
struct NSRunningApplication {
    let processIdentifier: Int32 = 10
    let isTerminated = false
    var bundleURL: URL? { URL(fileURLWithPath: argumentRoot + "/Moved app folder with spaces/NAC.app") }
    var executableURL: URL? { URL(fileURLWithPath: fixturePath(10)) }
    let launchDate: Date? = Date(timeIntervalSince1970: 1234.5)
    static func runningApplications(withBundleIdentifier: String) -> [Self] {
        argumentPhase == 2 ? [] : [Self()]
    }
}
enum FixtureWindowOption { case optionOnScreenOnly, excludeDesktopElements }
let kCGNullWindowID: UInt32 = 0
let kCGWindowOwnerPID = "owner", kCGWindowLayer = "layer", kCGWindowNumber = "number"
func CGWindowListCopyWindowInfo(_ options: [FixtureWindowOption], _ window: UInt32) -> Any? {
    [[kCGWindowOwnerPID: 10, kCGWindowLayer: 0, kCGWindowNumber: 17]]
}
func runArgumentControl() throws {
    argumentScenario = String(CommandLine.arguments[1].dropFirst("argument-".count))
    argumentRoot = CommandLine.arguments[3]
    let environment = ["HOME": "/private/owned home", "NAC_HOME": "/private/owned home/nac"]
    let config: [String: Any] = ["app_path": argumentRoot + "/Moved app folder with spaces/NAC.app",
        "bundle_id": "ai.arcee.nac.dev", "environment": environment, "child_environment": environment]
    let resources = try StartupURLResources(root: argumentRoot, app: config["app_path"] as! String)
    var known: [Int32: StartupProcessIdentity] = [:]
    try StartupObserver.emit(StartupObserver.readyRecord(CommandLine.arguments[2]))
    try StartupObserver.emit(StartupObserver.snapshot(config, resources: resources, known: &known))
    argumentPhase = 1
    do {
        try StartupObserver.emit(StartupObserver.snapshot(config, resources: resources, known: &known))
        argumentReachedBarrier = true
        for _ in 0..<2 {
            // The consumer requests each fresh settlement observation first.
            guard try FileHandle.standardInput.read(upToCount: 1) == Data([1]) else {
                throw OwnershipError.invalid
            }
            argumentSettlementDemands += 1
            argumentPhase = 2
            try StartupObserver.emit(StartupObserver.snapshot(config, resources: resources, known: &known))
        }
    } catch {
        try StartupObserver.emit(StartupObserver.failureRecord(error, known: known))
    }
    let audit: [String: Any] = ["actual_arguments_reads": argumentReads,
        "independent_absence_checks": argumentAbsenceChecks, "nonzero_signals": argumentSignals,
        "all_kernel_appkit_calls_mocked": true, "settlement_demands": argumentSettlementDemands,
        "reached_settlement_barrier": argumentReachedBarrier]
    FileHandle.standardError.write(try JSONSerialization.data(withJSONObject: audit))
}
'''

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
        "environment_role": identity.pid == 10 ? "launcher" : "engine",
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
        # Compile the actual snapshot and arguments owners as well as probes.
        # AppKit metadata/kernel calls are deterministic fixture adapters only.
        prefix, body = source.split('@main\nenum StartupObserver {', 1)
        prefix = prefix.replace('import AppKit\n', '')
        body = body.split('    @MainActor\n    static func main()', 1)[0]
        text = (prefix + ARGUMENT_KERNEL + '\nenum StartupObserver {\n' + body + '\n}\n'
                + 'if CommandLine.arguments[1].hasPrefix("argument-") {\n'
                + 'try runArgumentControl()\n} else {\n' + DRIVER + '\n}\n')
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

    def argument_frames(self, scenario, root, configuration_sha='b' * 64):
        app = root / 'Moved app folder with spaces/NAC.app'
        native = app / 'Contents/MacOS/NACPreview'
        native.parent.mkdir(parents=True, exist_ok=True)
        native.write_bytes(b'inert private resource; never executed')
        result = subprocess.run([str(self.executable), 'argument-' + scenario,
                                 configuration_sha, str(root)], capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr[-4096:])
        self.assertNotIn(b'fixture-secret-never-emitted', result.stdout)
        audit = json.loads(result.stderr)
        self.assertTrue(audit['all_kernel_appkit_calls_mocked'])
        self.assertGreater(audit['actual_arguments_reads'], 0)
        self.assertEqual(audit['nonzero_signals'], 0)
        frames = [json.loads(line) for line in result.stdout.splitlines()]
        self.records['argument-' + scenario] = {'frames': frames, 'audit': audit}
        config = self.config(str(root))
        config['app_path'] = str(app)
        return frames, config, audit

    def argument_exit(self, scenario, *, previously_known):
        with tempfile.TemporaryDirectory(prefix='nac342-xctest-') as temporary:
            root = Path(temporary).resolve()
            app = root / 'Moved app folder with spaces/NAC.app'
            native = app / 'Contents/MacOS/NACPreview'
            native.parent.mkdir(parents=True)
            native.write_bytes(b'inert private resource; never executed')
            process = subprocess.Popen([str(self.executable), 'argument-' + scenario,
                'b' * 64, str(root)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, bufsize=0)
            frames, errors, demands = [], [], []
            reader = None
            def read_frame():
                self.assertTrue(select.select([process.stdout], [], [], 5)[0], 'bounded fixture frame')
                line = process.stdout.readline(65537)
                self.assertTrue(line.endswith(b'\n') and len(line) <= 65536)
                self.assertNotIn(b'fixture-secret-never-emitted', line)
                return json.loads(line)
            try:
                config = self.config(str(root))
                config['app_path'] = str(app)
                owner = OwnerWitness(config, 'b' * 64, uid=501)
                for _ in range(3):
                    frame = read_frame()
                    frames.append(frame)
                    owner.observe(frame)
                self.assertIsNone(owner.failure, 'positive helper exit must not stop the witness')
                self.assertTrue(frames[2]['complete'])
                key = 'retired' if previously_known else 'enumerated_exits'
                self.assertIn(12, [r['identity']['pid'] if previously_known else r['pid']
                                  for r in frames[2][key]])
                self.assertEqual(12 in owner.history, previously_known)
                def consume():
                    try:
                        for _ in range(2):
                            frame = read_frame()
                            frames.append(frame)
                            owner.observe(frame)
                    except BaseException as error:
                        errors.append(repr(error))
                reader = threading.Thread(target=consume)
                reader.start()
                actual_wait_empty = owner.wait_empty
                def request_fresh(after, seconds=25):
                    # Forward every real cutoff through the unchanged owner.
                    # Never substitute a boolean or rewrite a producer stamp.
                    demands.append(after)
                    process.stdin.write(bytes([1]))
                    process.stdin.flush()
                    return actual_wait_empty(after, seconds=seconds)
                owner.wait_empty = request_fresh
                with patch('ci_startup_owner.ctypes.CDLL', side_effect=AssertionError('No live PID probe')),                     patch('ci_startup_owner.os.kill', side_effect=AssertionError('No real signal')):
                    self.assertTrue(owner.settle(time.monotonic())['owned_processes_settled'])
                reader.join(timeout=5)
                self.assertFalse(reader.is_alive())
                self.assertFalse(errors)
                self.assertEqual(len(demands), 2)
                self.assertEqual(len(frames), 5)
                for frame, cutoff in zip(frames[3:], demands):
                    self.assertGreaterEqual(int(frame['observed_uptime_ns']) / 1e9, cutoff)
                self.assertEqual(process.wait(timeout=5), 0)
                audit = json.loads(process.stderr.read())
                self.assertEqual(audit['settlement_demands'], 2)
                self.assertTrue(audit['reached_settlement_barrier'])
                self.assertEqual(audit['nonzero_signals'], 0)
                self.assertGreater(audit['independent_absence_checks'], 0)
                self.assertFalse(owner.signals)
                self.records['argument-' + scenario] = {'frames': frames, 'audit': audit,
                                                       'actual_settlement_cutoffs': demands}
            finally:
                process.stdin.close()
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                if reader is not None:
                    reader.join(timeout=5)
                process.stdout.close()
                process.stderr.close()

    def test_actual_argument_known_helper_exit_retires_and_settles(self):
        self.argument_exit('known-exit', previously_known=True)

    def test_actual_argument_new_helper_exit_is_not_adopted_and_settles(self):
        self.argument_exit('new-exit', previously_known=False)

    def test_actual_argument_live_denied_unknown_reuse_and_validation_remain_fail_closed(self):
        for scenario in ('known-live', 'known-denied', 'known-access-denied', 'known-unknown',
                         'known-reused', 'known-reused-after-arguments', 'known-malformed',
                         'known-environment'):
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory(prefix='nac342-xctest-') as temporary:
                frames, config, audit = self.argument_frames(scenario, Path(temporary).resolve())
                owner = OwnerWitness(config, 'b' * 64, uid=501)
                for frame in frames:
                    owner.observe(frame)
                self.assertEqual(frames[-1]['event'], 'failed')
                self.assertFalse(audit['reached_settlement_barrier'])
                self.assertFalse(owner.failure_receipt()['positive_settlement'])
                self.assertEqual(set(owner.history), {10, 11, 12})
                with self.assertRaises(RuntimeError), patch('ci_startup_owner.ctypes.CDLL',
                        side_effect=AssertionError('No live PID probe')), patch('ci_startup_owner.os.kill',
                        side_effect=AssertionError('No real signal')):
                    owner.settle(0)
                if scenario in ('known-denied', 'known-access-denied', 'known-malformed', 'known-environment'):
                    self.assertEqual(audit['independent_absence_checks'], 0)

    def config(self, root='/private/nac342-xctest-unit'):
        return {'app_path': '/private/nac342-xctest-unit/NAC.app', 'fixture_root': root,
                'environment': {'HOME': '/private/owned home', 'NAC_HOME': '/private/owned home/nac'},
                'child_environment': {'HOME': '/private/owned home', 'NAC_HOME': '/private/owned home/nac'},
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
        self.caller_uncertainty()

    def test_actual_argument_uncertainty_reaches_caller_and_preserves_profile(self):
        self.caller_uncertainty(argument=True)

    def caller_uncertainty(self, argument=False):
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
            root = Path(temporary).resolve().resolve()
            fixture, folder = root / 'nac342-xctest-unit', root / 'evidence'
            fixture.mkdir()
            config = self.config(str(fixture))
            if argument:
                config['app_path'] = str(fixture / 'Moved app folder with spaces/NAC.app')
            config_path = fixture / 'startup-config.json'
            config_path.write_text(json.dumps(config))
            configuration_sha = hashlib.sha256(config_path.read_bytes()).hexdigest()
            frames = (self.argument_frames('known-live', fixture, configuration_sha)[0] if argument
                      else self.frames('app_exit_engine_unavailable', configuration_sha))
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
                'test_contract': MagicMock(), 'package_contract': MagicMock(), 'AttachmentTool': MagicMock(), 'OwnerWitness': Mock(return_value=owner),
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
            if not argument:
                self.assertEqual(receipt['unresolved'][0]['pid'], 11)
            self.assertEqual({row['pid'] for row in receipt['known_identities']},
                             {10, 11, 12} if argument else {10, 11})
            retained = json.loads((folder / 'retained-fixture.json').read_text())
            self.assertFalse(retained['positive_process_settlement'])


URL_DRIVER = r'''
let rows = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [[String: Any]]
let results: [[String: Any]] = rows.map { row in
    if let lexical = row["lexical"] as? String { return ["accepted": StartupURLResources.lexical(lexical)] }
    do {
        let root = row["root"] as! String, app = row["app"] as! String
        let resources = try StartupURLResources(root: root, app: app)
        let before = resources.intact()
        let paths = [root, app, app + "/Contents/MacOS/NACPreview"]
        func identities() -> [[UInt64]] {
            paths.map { path in
                var info = stat()
                guard lstat(path, &info) == 0 else { return [] }
                return [UInt64(UInt32(bitPattern: info.st_dev)), UInt64(info.st_ino), UInt64(info.st_mode & mode_t(S_IFMT))]
            }
        }
        let pinned = identities()
        if let replacement = row["replace"] as? String {
            let path = replacement == "root" ? root : replacement == "app" ? app : app + "/Contents/MacOS/NACPreview"
            try FileManager.default.moveItem(atPath: path, toPath: path + ".retained")
            if replacement == "native" {
                try Data(contentsOf: URL(fileURLWithPath: path + ".retained")).write(to: URL(fileURLWithPath: path))
            } else {
                try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
                let member = replacement == "root" ? "/Moved app folder with spaces" : "/Contents"
                // Keep the other pinned descendants' inodes unchanged. Only
                // the replaced resource identity may explain rejection.
                try FileManager.default.moveItem(atPath: path + ".retained" + member, toPath: path + member)
            }
        }
        func observation(_ key: String) -> URL? {
            guard let path = row[key] as? String else { return nil }
            if row["non_file"] as? Bool == true { return URL(string: "https://example.invalid/resource") }
            let url = URL(fileURLWithPath: path)
            return row["foundation_resolve"] as? Bool == true ? url.resolvingSymlinksInPath() : url
        }
        return ["accepted": resources.matches(bundle: observation("bundle"), executable: observation("executable")),
                "intact_before": before, "intact_after": resources.intact(),
                "identities_before": pinned, "identities_after": identities(),
                "scope": "Owned empty filesystem resources only; no app or process observations"]
    } catch { return ["accepted": false, "declaration_rejected": true] }
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: results, options: [.sortedKeys]))
'''


@unittest.skipUnless(sys.platform == 'darwin' and shutil.which('swiftc'), 'Darwin Foundation resource controls unavailable')
class FoundationURLResourceControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='nac354-url-resource-controls-')
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name).resolve()
        source = Path(__file__).with_name('CIStartupObserver.swift').read_text()
        begin, end = '// BEGIN STARTUP FOUNDATION URL RESOURCES', '// END STARTUP FOUNDATION URL RESOURCES'
        assert source.count(begin) == source.count(end) == 1
        helpers = source.split(begin, 1)[1].split('\n', 1)[1].split(end, 1)[0]
        file = cls.root / 'main.swift'
        file.write_text('import Foundation\nimport Darwin\nenum OwnershipError: Error { case invalid }\n'
                        + helpers + URL_DRIVER)
        cls.executable = cls.root / 'URLResourceControls'
        result = subprocess.run(['xcrun', 'swiftc', '-swift-version', '5', str(file), '-o', str(cls.executable)],
                                capture_output=True, text=True, timeout=45)
        if result.returncode:
            raise AssertionError(result.stderr[-8192:])
        cls.fixture_source_sha256 = hashlib.sha256(file.read_bytes()).hexdigest()
        cls.fixture_executable_sha256 = hashlib.sha256(cls.executable.read_bytes()).hexdigest()
        cls.records = []

    def fixture(self, name):
        root = self.root / ('nac342-xctest-' + name)
        app = root / 'Moved app folder with spaces/NAC.app'
        native = app / 'Contents/MacOS/NACPreview'
        native.parent.mkdir(parents=True)
        native.write_bytes(b'empty-resource-fixture-not-an-executable')
        return {'root': str(root), 'app': str(app), 'bundle': str(app), 'executable': str(native)}

    def evaluate(self, rows):
        result = subprocess.run([str(self.executable)], input=json.dumps(rows).encode(),
                                capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr[-4096:])
        self.assertLessEqual(len(result.stdout), 65536)
        values = json.loads(result.stdout)
        self.records.extend({'input': row, 'result': value} for row, value in zip(rows, values, strict=True))
        return values

    def test_observed_platform_alias_and_foundation_spellings_match_pinned_physical_resources(self):
        row = self.fixture('platform')
        self.assertTrue(row['root'].startswith('/private/var/'))
        self.assertTrue(os.path.samefile('/var', '/private/var'))
        alias = {**row, 'bundle': row['bundle'].replace('/private/var/', '/var/', 1),
                 'executable': row['executable'].replace('/private/var/', '/var/', 1)}
        values = self.evaluate([row, alias, {**row, 'foundation_resolve': True}])
        self.assertTrue(all(value['accepted'] and value['intact_after'] for value in values))
        # The same alias remains forbidden as an authoritative declaration.
        declared_alias = {key: value.replace('/private/var/', '/var/', 1) for key, value in row.items()}
        self.assertFalse(self.evaluate([declared_alias])[0]['accepted'])
        if os.path.samefile('/tmp', '/private/tmp'):
            temporary = tempfile.TemporaryDirectory(prefix='nac342-xctest-tmp-alias-', dir='/private/tmp')
            self.addCleanup(temporary.cleanup)
            physical = Path(temporary.name).resolve()
            app = physical / 'Moved app folder with spaces/NAC.app'
            native = app / 'Contents/MacOS/NACPreview'
            native.parent.mkdir(parents=True)
            native.write_bytes(b'empty-resource-fixture-not-an-executable')
            row = {'root': str(physical), 'app': str(app), 'bundle': str(app).replace('/private/tmp/', '/tmp/', 1),
                   'executable': str(native).replace('/private/tmp/', '/tmp/', 1)}
            self.assertTrue(self.evaluate([row])[0]['accepted'])

    def test_lexical_declarations_remain_bounded_absolute_and_component_clean(self):
        bad = ['', '/', 'relative', '/a/', '//a', '/a//b', '/a/./b', '/a/../b',
               '/a\0b', '/a\nb', '/a\tb', '/a\x7fb', '/a\u0085b', '/' + 'x' * 4096]
        values = self.evaluate([{'lexical': value} for value in bad] + [{'lexical': '/owned space/a'}])
        self.assertEqual([v['accepted'] for v in values], [False] * len(bad) + [True])

    def test_foreign_wrong_layout_missing_and_non_file_observations_reject(self):
        row, foreign = self.fixture('owned'), self.fixture('foreign')
        bundle_link, native_link = self.root / 'foreign-bundle-link', self.root / 'foreign-native-link'
        bundle_link.symlink_to(foreign['bundle'], target_is_directory=True)
        native_link.symlink_to(foreign['executable'])
        values = self.evaluate([{**row, 'app': foreign['app']},
            {**row, 'app': row['app'].replace('NAC.app', 'Other.app')},
            {**row, 'root': row['root'] + '/..'}, {**row, 'bundle': foreign['bundle']},
            {**row, 'executable': foreign['executable']}, {**row, 'bundle': None},
            {**row, 'executable': None}, {**row, 'non_file': True},
            {**row, 'bundle': str(bundle_link)}, {**row, 'executable': str(native_link)}])
        self.assertTrue(all(not value['accepted'] for value in values))

    def test_root_interior_bundle_and_native_symlink_declarations_reject(self):
        rows = []
        for member in ['root', 'interior', 'app', 'native']:
            row = self.fixture('link-' + member)
            path = Path(row['root'] if member == 'root' else row['app'] if member == 'app' else
                        row['executable'] if member == 'native' else str(Path(row['app']).parent))
            retained = path.with_name(path.name + '.retained')
            path.rename(retained)
            path.symlink_to(retained, target_is_directory=member != 'native')
            rows.append(row)
        self.assertTrue(all(not value['accepted'] for value in self.evaluate(rows)))

    def test_missing_wrong_type_and_pinned_resource_replacement_reject(self):
        rows = []
        for member in ['root', 'app', 'executable']:
            for wrong_type in [False, True]:
                row = self.fixture('missing-' + member + str(wrong_type))
                path = Path(row[member])
                if path.is_dir():
                    shutil.rmtree(path)
                    if wrong_type:
                        path.write_bytes(b'wrong-type')
                else:
                    path.unlink()
                    if wrong_type:
                        path.mkdir()
                rows.append(row)
        rows += [{**self.fixture('replace-' + member), 'replace': member} for member in ['root', 'app', 'native']]
        values = self.evaluate(rows)
        self.assertTrue(all(not value['accepted'] for value in values))
        self.assertTrue(all(value['intact_before'] and not value['intact_after'] for value in values[-3:]))
        for replaced, value in enumerate(values[-3:]):
            for index, (before, after) in enumerate(zip(value['identities_before'], value['identities_after'], strict=True)):
                self.assertEqual(before[0], after[0])  # Same device and type; one inode changed.
                self.assertEqual(before[2], after[2])
                self.assertEqual(before[1] == after[1], index != replaced)


if __name__ == '__main__':
    unittest.main()
