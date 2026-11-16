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
            for code in DIAGNOSTIC_CODES - {'sample_refused'}:
                row=dict(self.row,stage=stage,code=code)
                self.assertEqual(self.read(row),row)
                self.assertFalse(self.read(row)['acceptance'])

    def sample(self):
        return dict(capture='first_published_refusal_not_client_consumption', began_ns='10', ended_ns='20',
            sequence='1', refusal_generation='1', refusal_stage='ax_predicate_refused', request_present=True,
            request=dict(id='12345678-1234-1234-1234-123456789abc', entered_ns='9', deadline_ns='21',
                         baseline_sequence='0', refusal_generation='0'),
            first_api_failure=dict(attribute='AXWindows', api_code=-25204))

    def test_new_sample_code_has_separate_closed_stage_counter_matrix(self):
        for stage in DIAGNOSTIC_STAGES:
            row = dict(self.row, code='sample_refused', stage=stage, sequence='1', refusal_generation='1',
                       first_refused_sample=self.sample())
            with self.subTest(stage=stage):
                self.assertEqual(self.read(row), row if stage == 'ax_observation' else None)
        row = dict(self.row, first_refused_sample=self.sample())
        self.assertEqual(self.read(row), row)
        row.update(code='sample_refused', stage='ax_observation')
        self.assertIsNone(self.read(row))  # Sample-only counters must agree exactly.
        row.pop('first_refused_sample')
        self.assertIsNone(self.read(row))

    def test_optional_sample_rejects_private_malformed_overflow_and_duplicate_fields(self):
        changes = [dict(capture='PRIVATE'), dict(label='PRIVATE'), dict(request_present=1),
            dict(request_present=False), dict(began_ns='21'), dict(ended_ns=str(10**12)),
            dict(sequence='0'), dict(sequence='5'), dict(refusal_generation='3'),
            dict(refusal_stage='PRIVATE'), dict(request=None), dict(first_api_failure=None)]
        for key in ('began_ns', 'ended_ns', 'sequence', 'refusal_generation'):
            changes += [{key: value} for value in (True, 1, '-1', '01', str(2**64), '1e2')]
        for change in changes:
            with self.subTest(change=change):
                self.assertIsNone(self.read(dict(self.row, first_refused_sample=dict(self.sample(), **change))))
        for key, value in [('id', 'PRIVATE'), ('entered_ns', '10'), ('deadline_ns', '10'),
                           ('baseline_sequence', '2'), ('refusal_generation', '2'), ('path', 'PRIVATE')]:
            sample = self.sample(); sample['request'][key] = value
            self.assertIsNone(self.read(dict(self.row, first_refused_sample=sample)))
        for change in [dict(attribute='PRIVATE'), dict(api_code=True), dict(api_code=2**31),
                       dict(api_code=-(2**31)-1), dict(raw='PRIVATE')]:
            sample = self.sample(); sample['first_api_failure'].update(change)
            self.assertIsNone(self.read(dict(self.row, first_refused_sample=sample)))
        row = dict(self.row, first_refused_sample=self.sample())
        data = (json.dumps(row).replace('"began_ns": "10"', '"began_ns": "10", "began_ns": "10"')+'\n').encode()
        self.assertIsNone(self.read(data=data))
        for boundary in (-(2**31), 2**31-1):
            sample = self.sample(); sample['first_api_failure']['api_code'] = boundary
            self.assertIsNotNone(self.read(dict(self.row, first_refused_sample=sample)))
        sample = self.sample(); sample.pop('request'); sample['request_present'] = False
        sample.pop('first_api_failure')
        self.assertIsNotNone(self.read(dict(self.row, first_refused_sample=sample)))

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
        import re
        source = Path(__file__).with_name('startup_xctest') / 'StartupAXReceipt.swift'
        enumeration = source.read_text().split('enum StartupFailureStep:', 1)[1].split('\n}', 1)[0]
        steps = re.findall(r'\b[a-z][a-z_]+\b', '\n'.join(
            line.split('case ', 1)[1] for line in enumeration.splitlines() if 'case ' in line))
        self.assertEqual(len(steps), len(set(steps)))
        for step in steps:
            with self.subTest(step=step):
                expected, _ = self.preflight(dict(step=step))
                self.assertEqual(self.owner.preflight_diagnostic(), expected)


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
        # Execute the actual publication/capture, deferred emission and fatal
        # emission blocks. Only the existing publication/write/exit ports are
        # inert adapters; there is no app, AX call, process query or input actor.
        lifecycle = 'var firstRefusedSample:' + companion.split('var firstRefusedSample:', 1)[1].split('        do {', 1)[0]
        publish_start = '                diagnosticStage = .receipt_publication\n                try StartupAXFiles.publish(receipt(observed'
        publication_end = '                if let request {\n                    try StartupObserver.need(observed?.interaction != nil)'
        assert companion.count(publish_start) == 1
        publication_tail = companion.split(publish_start, 1)[1]
        assert publication_tail.count(publication_end) == 1
        publication = publish_start + publication_tail.split(publication_end, 1)[0]
        fatal = companion.split('            // Unexpected ownership/deadline/stream failure', 1)[1].split('            exit(1)', 1)[0]
        fatal = '// Unexpected ownership/deadline/stream failure' + fatal + 'exitCode = 1'
        write = 'try FileHandle.standardError.write(contentsOf: $0)'
        adapter = 'try fixtureWrite($0)'
        lifecycle, fatal = lifecycle.replace(write, adapter), fatal.replace(write, adapter)
        passive = r'''
enum StartupAXReceiptError: Error { case refused }
struct InertRequest {
    let id = "12345678-1234-1234-1234-123456789abc"
    let entered_ns = "9", deadline_ns = "100", baseline_sequence = "0", refusal_generation = "0"
}
enum StartupAXFiles {
    static var mode = "", trace: [String] = []
    static func publish(_ status: String, to: String) throws {
        trace.append("publish:" + status)
        if mode == "publicationFailure" { throw OwnershipError.invalid }
    }
}
func passiveFlow(_ spec: [String: Any]) -> [String: Any] {
    let mode = spec["passive"] as! String
    StartupAXFiles.mode = mode; StartupAXFiles.trace = []
    var output: [String] = [], exitCode = 0
    func fixtureWrite(_ data: Data) throws {
        if mode == "writeFailure" { throw OwnershipError.invalid }
        output.append(String(decoding: data, as: UTF8.self))
    }
    func run() {
        var diagnosticStage = StartupAXDiagnosticStage.configuration
        let diagnosticBinding = spec["binding"] as! [String: String]
        var sequence: UInt64 = 0, refusals: UInt64 = 0
''' + lifecycle + r'''
        do {
            if mode == "earlyFatal" { throw OwnershipError.invalid }
            for index in 0..<2 {
                let began: UInt64 = index == 0 ? 10 : 30, ended = began + 1
                sequence += 1
                let observed: Int? = mode == "absent" || (mode == "late" && index == 0) ? 1 : nil
                if observed == nil { refusals += 1 }
                let stage: String? = observed == nil ? "ax_predicate_refused" : nil
                let request: InertRequest? = mode == "noRequest" ? nil : InertRequest()
                let failure = try JSONSerialization.data(withJSONObject:
                    ["first_observed_refusal": ["attribute": "AXWindows", "api_code": -25204, "private": "PRIVATE"]])
                let declaration = (path: "/inert/never-opened", other: 0)
                func receipt(_ status: String, began: UInt64, ended: UInt64,
                             observed: Int?, stage: String?, failure: Data?) -> String { status }
''' + publication + r'''
            }
            if mode == "fatal" { diagnosticStage = .snapshot; throw OwnershipError.invalid }
        } catch {
''' + fatal + r'''
        }
    }
    run()
    return ["records": output, "exit": exitCode, "trace": StartupAXFiles.trace]
}
'''
        source = ('import Foundation\nenum OwnershipError:' + ownership + '\nstruct StartupProbeFailure:' + probe
                  + section(observer, 'STARTUP ENVIRONMENT CHECKS')
                  + '\nenum StartupObserver { static func failureKind(' + metadata + '\n}\n'
                  + section(companion, 'AX FAILURE DIAGNOSTICS') + passive + r'''
let requests = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [[String: Any]]
var results: [[String: Any]] = []
for request in requests {
    if request["passive"] != nil { results.append(passiveFlow(request)); continue }
    if let record = request["emit"] as? [String: Any] {
        var output: [String] = []
        StartupAXFailureDiagnostic.emit(record) {
            if request["writeFailure"] as? Bool == true { throw OwnershipError.invalid }
            output.append(String(decoding: $0, as: UTF8.self))
        }
        results.append(["records": output, "raw_size": try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]).count])
        continue
    }
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

    def test_original_capture_defer_and_fatal_blocks_emit_once_without_new_authority(self):
        binding = dict(source_sha='a'*40, test_source_sha='b'*40, harness_sha='c'*40,
                       configuration_sha256='d'*64, helper_sha256='e'*64)
        modes = ['normal', 'fatal', 'absent', 'earlyFatal', 'publicationFailure', 'late', 'noRequest', 'writeFailure']
        result = subprocess.run([str(self.executable)], input=json.dumps(
            [dict(passive=mode, binding=binding) for mode in modes]).encode(), capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = dict(zip(modes, json.loads(result.stdout)))
        for mode, row in rows.items():
            self.assertLessEqual(len(row['records']), 1, mode)
            self.assertEqual(row['exit'], int(mode in ('fatal', 'earlyFatal', 'publicationFailure')), mode)
            self.assertNotIn('PRIVATE', json.dumps(row))
            if row['records']:
                record = json.loads(row['records'][0])
                self.assertFalse(record['acceptance'])
                self.assertEqual(record['code'], 'ownership_invalid' if row['exit'] else 'sample_refused')
                if mode in ('earlyFatal', 'publicationFailure'):
                    self.assertNotIn('first_refused_sample', record)
                else:
                    sample = record['first_refused_sample']
                    self.assertEqual(sample['sequence'], '2' if mode == 'late' else '1')
                    self.assertEqual(sample['began_ns'], '30' if mode == 'late' else '10')
                    self.assertEqual(sample['request_present'], mode != 'noRequest')
                    self.assertEqual(sample['first_api_failure'], dict(attribute='AXWindows', api_code=-25204))
        self.assertEqual(rows['normal']['trace'], ['publish:refused', 'publish:refused'])
        self.assertEqual(rows['late']['trace'], ['publish:ready', 'publish:refused'])
        self.assertEqual(rows['publicationFailure']['trace'], ['publish:refused'])
        self.assertEqual(rows['absent']['records'], [])
        self.assertEqual(rows['writeFailure']['records'], [])

    def test_maximum_combined_sample_paired_fatal_record_and_original_size_fallback(self):
        maximum = 2**64-1
        sample = AXFailureDiagnosticsTests.sample(self)
        sample.update(began_ns=str(maximum-2), ended_ns=str(maximum-1),
                      sequence=str(maximum), refusal_generation=str(maximum))
        sample['request'].update(entered_ns=str(maximum-3), deadline_ns=str(maximum),
                                 baseline_sequence=str(maximum), refusal_generation=str(maximum))
        sample['first_api_failure'] = dict(attribute='AXFocusedUIElement', api_code=-(2**31))
        identifier = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
        paired = dict(schema='nac342-ax-pre-refusal-paired-v1', acceptance=False, cg_window_count=128,
            cg_window_ids=list(range(maximum-7, maximum+1)), cg_ids_truncated=True,
            original_window_number=maximum-7, outcome='observed', closing_valid=True,
            canonical=dict(surface='goTo', root_id=identifier, panel_id=identifier, go_to_id=identifier,
                           retained_root_equal=True))
        record = dict(schema='nac342-ax-failure-diagnostic-v1', acceptance=False,
            code='ownership_arguments_unavailable', stage='configuration_integrity',
            clock_basis='DispatchTime.uptimeNanoseconds', observed_uptime_ns=str(maximum),
            sequence=str(maximum), refusal_generation=str(maximum), first_refused_sample=sample,
            pre_refusal_paired=paired, binding=dict(source_sha='a'*40, test_source_sha='b'*40,
                harness_sha='c'*40, configuration_sha256='d'*64, helper_sha256='e'*64))
        from ci_startup_ax import paired_diagnostic, sample_diagnostic
        self.assertEqual(paired_diagnostic(paired), paired)
        self.assertEqual(sample_diagnostic(sample), sample)
        requests = [dict(emit=record), dict(emit=dict(record, padding='PRIVATE'*400)),
                    dict(emit=record, writeFailure=True)]
        result = subprocess.run([str(self.executable)], input=json.dumps(requests).encode(),
                                capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = json.loads(result.stdout)
        for row in rows[:2]:
            self.assertEqual(len(row['records']), 1)
            data = row['records'][0].encode()
            self.assertLessEqual(len(data), 2048)
            self.assertNotIn(b'PRIVATE', data)
            if row['raw_size'] >= 2048:
                self.assertEqual(data, b'AX companion failed; no acceptance\n')
            else:
                self.assertEqual(json.loads(data), record)
        self.assertGreaterEqual(rows[1]['raw_size'], 2048)
        self.assertEqual(rows[2]['records'], [])

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
