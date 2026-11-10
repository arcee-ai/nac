"""Bounded failure-log admission only; no companion, AX or process operation."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from ci_startup_ax import AXCompanion, DIAGNOSTIC_CODES, DIAGNOSTIC_STAGES


class AXFailureDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='nac-ax-diagnostic-inert-')
        self.addCleanup(self.temp.cleanup)
        self.folder=Path(self.temp.name).resolve()
        self.config_path=self.folder/'config.json';self.config_path.write_bytes(b'inert configuration bytes')
        self.owner=AXCompanion.__new__(AXCompanion)
        self.owner.folder=self.folder;self.owner.config_path=self.config_path
        self.owner.config=dict(source_sha='a'*40,test_source_sha='b'*40,harness_sha='c'*40)
        self.owner.declaration=dict(helper_sha256='d'*64)
        self.row=dict(schema='nac342-ax-failure-diagnostic-v1',acceptance=False,stage='owned_frame',
            code='ownership_invalid',clock_basis='DispatchTime.uptimeNanoseconds',
            observed_uptime_ns='100000000000',sequence='4',refusal_generation='2',
            binding=dict(self.owner.config,configuration_sha256=hashlib.sha256(self.config_path.read_bytes()).hexdigest(),
                         helper_sha256='d'*64))

    def read(self,row=None,data=None):
        log=self.folder/'ax-companion.log'
        log.write_bytes(data if data is not None else (json.dumps(row or self.row)+'\n').encode())
        with patch('ci_startup_ax.native_identity',side_effect=AssertionError('no OS probe')), \
                patch('ci_startup_ax.os.kill',side_effect=AssertionError('no signal')):
            return self.owner.failure_diagnostic()

    def test_every_static_stage_and_typed_code_is_failure_only_and_source_bound(self):
        for stage in DIAGNOSTIC_STAGES:
            for code in DIAGNOSTIC_CODES:
                row=dict(self.row,stage=stage,code=code)
                self.assertEqual(self.read(row),row)
                self.assertFalse(self.read(row)['acceptance'])

    def test_absent_malformed_overflow_duplicate_or_secret_fields_never_export(self):
        self.assertIsNone(self.owner.failure_diagnostic())
        for data in (b'{',b'[]\n',b'\xff\n',b'{}',b'{}\n{}\n',b'SECRET-CANARY'*300,
                b'{"stage":"SECRET-CANARY","stage":"snapshot"}\n'):
            with self.subTest(data=data[:40]): self.assertIsNone(self.read(data=data))
        for change in (dict(stage='SECRET-CANARY'),dict(code='SECRET-CANARY'),dict(acceptance=True),
                dict(extra='SECRET-CANARY'),dict(clock_basis='wall'),dict(observed_uptime_ns='1e9'),
                dict(sequence=True),dict(sequence='01'),dict(sequence=str(2**64)),
                dict(refusal_generation='-1'),dict(binding=dict(self.row['binding'],path='SECRET-CANARY')),
                dict(binding=dict(self.row['binding'],harness_sha='f'*40))):
            with self.subTest(change=change): self.assertIsNone(self.read(dict(self.row,**change)))

    def test_diagnostic_read_failure_does_not_touch_original_companion_failure(self):
        primary=RuntimeError('SECRET-CANARY')
        self.owner.error=primary
        with patch('ci_startup_ax.bounded_file',side_effect=primary):
            self.assertIsNone(self.owner.failure_diagnostic())
        self.assertIs(self.owner.error,primary)

    def test_Swift_allowlists_and_existing_terminal_catch_are_fenced(self):
        source=Path(__file__).with_name('CIStartupAXWitness.swift').read_text()
        block=source.split('enum StartupAXDiagnosticStage:',1)[1].split('enum StartupAXFailureDiagnostic',1)[0]
        stages=set()
        for line in block.splitlines():
            if line.strip().startswith('case '): stages.update(v.strip() for v in line.strip()[5:].split(','))
        self.assertEqual(stages,DIAGNOSTIC_STAGES)
        mapper=source.split('// BEGIN AX FAILURE DIAGNOSTICS',1)[1].split('// END AX FAILURE DIAGNOSTICS',1)[0]
        for forbidden in ('localizedDescription','userInfo','String(describing:','AXUIElement','AppKit','FileHandle','CommandLine'):
            self.assertNotIn(forbidden,mapper)
        self.assertIn('$0.count < 2048',source)
        self.assertIn('exit(1)',source)

    def preflight(self, change=None, data=None):
        directory = self.folder / 'owned-port'
        directory.mkdir(mode=0o700, exist_ok=True)
        path = directory / 'receipt.json.failure'
        self.owner.declaration.update(path=str(directory / 'receipt.json'), nonce='a'*64)
        row = dict(schema='nac342-first-preflight-failure-v1', acceptance=False, nonce='a'*64,
                   configuration_sha256=hashlib.sha256(self.config_path.read_bytes()).hexdigest(),
                   step='prepare_interaction', operation_index=1, error_family='receipt_invalid')
        if change: row.update(change)
        if path.exists(): path.chmod(0o600)
        path.write_bytes(data if data is not None else json.dumps(row).encode())
        path.chmod(0o400)
        return row, path

    def test_first_local_throw_survives_teardown_and_later_listener_absence_without_authority(self):
        from ci_startup_api import FixtureFailure, failure_metadata, owned_listener
        primary = RuntimeError('PRIVATE-CANARY')
        self.owner.error = primary
        row, path = self.preflight()
        order = ['local_throw_retained', 'teardown']
        expected = dict(pid=123, start_seconds=1, start_microseconds=2, uid=501, executable='/PRIVATE-CANARY')
        with patch('ci_startup_api.native_identity', return_value=None) as query, \
                patch('ci_startup_api.subprocess.run') as command:
            with self.assertRaises(FixtureFailure) as caught: owned_listener(123, expected)
            query.assert_called_once_with(123); command.assert_not_called()
        order.append('api_absent')
        self.assertEqual(self.owner.preflight_diagnostic(), row)
        self.assertIs(self.owner.error, primary)
        self.assertEqual(failure_metadata(caught.exception)['operands']['actual_absent'], True)
        self.assertEqual(order, ['local_throw_retained', 'teardown', 'api_absent'])
        self.assertIs(row['acceptance'], False)
        self.assertNotIn('PRIVATE-CANARY', json.dumps(row))
        self.assertEqual(self.owner.failure, 'ax_companion_unavailable')

    def test_malformed_private_unbound_or_duplicate_first_failure_is_dropped(self):
        for change in [dict(acceptance=True), dict(step='PRIVATE-CANARY'), dict(operation_index=True),
                       dict(operation_index=12), dict(error_family='PRIVATE-CANARY'), dict(nonce='b'*64),
                       dict(configuration_sha256='f'*64), dict(raw='PRIVATE-CANARY')]:
            with self.subTest(change=change):
                self.preflight(change)
                self.assertIsNone(self.owner.preflight_diagnostic())
        for data in [b'{', b'[]', b'\xff', b'{"schema":1,"schema":2}', b'x'*2049]:
            self.preflight(data=data)
            self.assertIsNone(self.owner.preflight_diagnostic())
        _, path = self.preflight()
        path.chmod(0o600)
        self.assertIsNone(self.owner.preflight_diagnostic())


@unittest.skipUnless(sys.platform == 'darwin' and shutil.which('swiftc'), 'Darwin Swift Foundation controls unavailable')
class ProductionFailureClassifierTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='nac-failure-classifier-inert-')
        cls.addClassCleanup(cls.temp.cleanup)
        folder = Path(cls.temp.name).resolve()
        observer = Path(__file__).with_name('CIStartupObserver.swift').read_text()
        companion = Path(__file__).with_name('CIStartupAXWitness.swift').read_text()
        def section(source, name):
            begin, end = '// BEGIN ' + name, '// END ' + name
            assert source.count(begin) == source.count(end) == 1
            return source.split(begin, 1)[1].split('\n', 1)[1].split(end, 1)[0]
        # Compile the real validator and both real classifiers. No AppKit/kernel
        # adapters or copied predicate/mapping stand-ins enter this fixture.
        ownership = observer.split('enum OwnershipError:', 1)[1].split('\n', 1)[0]
        probe = observer.split('struct StartupProbeFailure:', 1)[1].split('struct StartupProcessIdentity', 1)[0]
        metadata = observer.split('    static func failureKind(', 1)[1].split('    static func record(', 1)[0]
        source = ('import Foundation\nenum OwnershipError:' + ownership + '\nstruct StartupProbeFailure:' + probe
                  + section(observer, 'STARTUP ENVIRONMENT CHECKS')
                  + '\nenum StartupObserver { static func failureKind(' + metadata + '\n}\n'
                  + section(companion, 'AX FAILURE DIAGNOSTICS') + r'''
let requests = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [[String: Any]]
var results: [[String: Any]] = []
for request in requests {
    do {
        _ = try StartupEnvironmentCheck.record(executable: request["executable"] as! String,
            nativePath: request["native"] as! String, enginePath: request["engine"] as! String,
            argv: request["argv"] as! [String], environment: request["observed"] as! [String: String],
            launcher: request["launcher"] as! [String: String], child: request["child"] as! [String: String])
        fatalError("Validator unexpectedly accepted rejection fixture")
    } catch {
        guard let rejection = error as? StartupEnvironmentRejection else { throw error }
        results.append(["predicate": rejection.detail["predicate"]!, "metadata": StartupObserver.failureKind(error),
            "companion": StartupAXFailureDiagnostic.record(stage: .initial_snapshot, error: error,
                observed: 100, sequence: 0, refusals: 0, binding: [:])])
    }
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: results, options: [.sortedKeys]))
''')
        file = folder / 'main.swift'
        file.write_text(source)
        cls.executable = folder / 'FailureClassifierControls'
        result = subprocess.run(['swiftc', '-swift-version', '5', str(file), '-o', str(cls.executable)],
                                capture_output=True, timeout=45)
        if result.returncode: raise AssertionError(result.stderr[-8192:].decode())

    def test_real_validator_rejection_families_keep_both_production_error_codes(self):
        requests = []
        native, engine = '/PRIVATE-CANARY/native', '/PRIVATE-CANARY/engine'
        for predicate in ('contract', 'prohibited', 'native_argv', 'engine_argv', 'controlled_value'):
            executable = engine if predicate == 'engine_argv' else native
            request = dict(native=native, engine=engine, executable=executable, argv=[executable],
                           launcher={'HOME': '/PRIVATE-CANARY/home'}, child={'HOME': '/PRIVATE-CANARY/home'},
                           observed={'HOME': '/PRIVATE-CANARY/home'})
            if predicate == 'contract': request['child'] = {}
            elif predicate == 'prohibited': request['observed']['PRIVATE-CANARY_TOKEN'] = 'PRIVATE-CANARY'
            elif predicate == 'native_argv': request['argv'] = ['PRIVATE-CANARY']
            elif predicate == 'engine_argv': request['argv'] += ['__desktop-configuration', '--bind']
            else: request['observed']['HOME'] = 'PRIVATE-CANARY'
            requests.append(request)
        result = subprocess.run([str(self.executable)], input=json.dumps(requests).encode(),
                                capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr[-4096:])
        self.assertNotIn(b'PRIVATE-CANARY', result.stdout)
        rows = json.loads(result.stdout)
        self.assertEqual([row['predicate'] for row in rows],
                         ['contract', 'prohibited', 'native_argv', 'engine_argv', 'controlled_value'])
        for row in rows:
            self.assertEqual(row['metadata'], 'ownership_invalid')
            self.assertEqual(row['companion'], dict(schema='nac342-ax-failure-diagnostic-v1', acceptance=False,
                stage='initial_snapshot', code='ownership_invalid', clock_basis='DispatchTime.uptimeNanoseconds',
                observed_uptime_ns='100', sequence='0', refusal_generation='0', binding={}))


if __name__=='__main__': unittest.main()
