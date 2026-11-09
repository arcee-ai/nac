"""Drive the actual preinstalled reader with inert framed bytes, never an OS helper."""
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from ci_startup_owner import OwnerWitness


class InlineThread:
    def __init__(self, target, **_): self.target = target
    def start(self): self.target()
    def is_alive(self): return False
    def join(self, **_): pass


class StreamDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='nac-owner-stream-inert-')
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name).resolve()
        app = root / 'NAC.app'
        for member in ('MacOS/NACPreview', 'Resources/nac-web'):
            file = app / 'Contents' / member
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b'inert fixture, never executed')
        self.config = dict(app_path=str(app), fixture_root=str(root), scenario='configuredLocal',
            environment={'HOME': '/inert/home'}, child_environment={'HOME': '/inert/home'},
            native_sha256=hashlib.sha256(b'inert fixture, never executed').hexdigest(),
            engine_sha256=hashlib.sha256(b'inert fixture, never executed').hexdigest())
        self.path = root / 'configuration.json'
        self.path.write_text(json.dumps(self.config))
        self.digest = hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.owner = OwnerWitness(self.config, self.digest, uid=501, clock=lambda: 100.)
        self.ready = dict(schema='nac342-owner-v1', event='ready', complete=True,
            nodes=[], retired=[], enumerated_exits=[], observed_uptime_ns='99000000000',
            configuration_sha256=self.digest)
        def node(kind, pid, parent):
            value = dict(kind=kind, pid=pid, parent=parent, uid=501, start_seconds=5,
                start_microseconds=pid, arguments_sha256='c'*64,
                executable=str(app / 'Contents' / ('MacOS/NACPreview' if kind=='app' else 'Resources/nac-web')),
                environment={'HOME':'/inert/home'}, environment_role='launcher' if kind=='app' else 'engine',
                configuration_helper=False, serving=kind=='engine')
            if kind=='app': value.update(windows=[17], app_launch_epoch=5.5)
            return value
        self.record = dict(schema='nac342-owner-v1', complete=True,
            nodes=[node('app',10,1),node('engine',11,10)], retired=[], enumerated_exits=[],
            observed_uptime_ns='99500000000')

    def read(self, suffix=b'', *, healthy=False, stream_error=None, expect_failure=None):
        payload = b''.join((json.dumps(v)+'\n').encode() for v in (self.ready,self.record))+suffix
        owner = self.owner
        class Stream(io.BytesIO):
            def readline(self, limit):
                line=super().readline(limit)
                if not line:
                    if healthy: owner.stopping=True
                    if stream_error: raise stream_error
                return line
        child=SimpleNamespace(stdout=Stream(payload),poll=lambda:0,wait=lambda **_:0)
        with patch('ci_startup_owner.subprocess.Popen',return_value=child) as launch, \
                patch('ci_startup_owner.threading.Thread',InlineThread), \
                patch('ci_startup_owner.os.kill') as signal:
            if expect_failure is None: expect_failure = not healthy
            if not expect_failure: self.owner.start('/inert/helper',self.path)
            else:
                with self.assertRaises(RuntimeError): self.owner.start('/inert/helper',self.path)
            launch.assert_called_once()
            signal.assert_not_called()
        return self.owner.failure_receipt()

    def assert_failure(self, suffix, stage, code, **options):
        result=self.read(suffix,**options)
        self.assertEqual(result['failure'],'owner_stream_unavailable')
        self.assertEqual(result['latest_pids'],[10,11])
        self.assertEqual(len(result['known_identities']),2)
        self.assertEqual(result['retired'],[])
        self.assertFalse(result['positive_settlement'])
        diagnostic=result.get('stream_diagnostic')
        self.assertIsNotNone(diagnostic,'actual reader discarded the failure stage')
        self.assertEqual((diagnostic['stage'],diagnostic['code']),(stage,code))
        self.assertEqual(diagnostic['clock_basis'],'time.monotonic')
        self.assertEqual(diagnostic['last_accepted_uptime_ns'],'99500000000')
        self.assertEqual(diagnostic['observed_uptime_ns'],'100000000000')
        self.assertLess(len(json.dumps(diagnostic)),1024)
        with self.assertRaises(RuntimeError): self.owner.signal_owned(self.owner.latest[0],15)
        self.assertEqual(self.owner.signals,[])
        return diagnostic

    def test_actual_reader_eof_preserves_history_and_identifies_loss(self):
        diagnostic=self.assert_failure(b'','eof','unexpected_eof')
        self.assertEqual(diagnostic['byte_count'],0)

    def test_framing_json_and_read_errors_have_static_codes_and_no_payload(self):
        for payload,stage,code in [(b'SECRET-CANARY','framing','missing_newline'),
                (b'SECRET-CANARY'*6000+b'\n','framing','oversize'),
                (b'{"SECRET-CANARY":\n','json','invalid_json'),(b'\xff\n','json','invalid_json')]:
            with self.subTest(stage=stage,code=code):
                self.setUp()
                diagnostic=self.assert_failure(payload,stage,code)
                self.assertNotIn('SECRET-CANARY',json.dumps(diagnostic))
        self.setUp()
        diagnostic=self.assert_failure(b'','read','io_error',stream_error=OSError('SECRET-CANARY'))
        self.assertNotIn('SECRET-CANARY',json.dumps(diagnostic))

    def test_two_window_failure_has_safe_shape_counts_without_new_ui_authority(self):
        row=copy.deepcopy(self.record);row['observed_uptime_ns']='99700000000'
        row['nodes'][0]['windows']=[17,18]
        result=self.read((json.dumps(row)+'\n').encode(),healthy=True,expect_failure=True)
        self.assertEqual(result['failure'],'app_windows')
        self.assertIsNone(result['process_failure'])
        self.assertEqual(result['stream_diagnostic']['shape'],dict(app_count=1,window_count=2,original_window_present=True))
        self.assertEqual(self.owner.app['windows'],[17])
        self.assertEqual(self.owner.latest[0]['windows'],[17,18])
        self.assertEqual(self.owner.last_accepted_uptime_ns,99700000000)
        self.assertFalse(result['positive_process_settlement'])

    def test_malformed_record_cannot_supply_counts_or_leak_fields(self):
        row=dict(schema='nac342-owner-v1',nodes=[{'kind':'app','windows':['SECRET-CANARY']}])
        diagnostic=self.assert_failure((json.dumps(row)+'\n').encode(),'record_validation','invalid_record')
        self.assertIsNone(diagnostic['shape'])
        self.assertNotIn('SECRET-CANARY',json.dumps(diagnostic))

    def test_valid_typed_failure_retains_its_existing_failure_and_first_diagnostic(self):
        row=dict(schema='nac342-owner-v1',event='failed',complete=False,
            reason='ownership_observation_unavailable',retained_identities=[],unresolved=[],
            observed_uptime_ns='99700000000')
        result=self.read((json.dumps(row)+'\n').encode())
        self.assertEqual(result['failure'],'ownership_observation_unavailable')
        self.assertEqual(result['stream_diagnostic']['code'],'typed_failure')
        self.assertEqual(result['latest_pids'],[10,11])
        self.assertFalse(result['positive_settlement'])

    def test_static_producer_failure_is_retained_without_new_authority(self):
        row = dict(schema='nac342-owner-v1', event='failed', complete=False,
            reason='ownership_observation_unavailable', retained_identities=[], unresolved=[],
            observed_uptime_ns='99700000000',
            producer_failure=dict(stage='environment', kind='ownership_invalid'))
        result = self.read((json.dumps(row)+'\n').encode())
        self.assertEqual(result['failure'], 'ownership_observation_unavailable')
        self.assertEqual(result['stream_diagnostic']['producer_failure'], row['producer_failure'])
        self.assertEqual(result['latest_pids'], [10, 11])
        self.assertFalse(result['positive_process_settlement'])
        with self.assertRaises(RuntimeError): self.owner.signal_owned(self.owner.latest[0], 15)
        self.assertEqual(self.owner.signals, [])

    def test_malformed_optional_projection_does_not_replace_original_failure(self):
        for value in [None, [], 'SECRET-CANARY', dict(stage=['SECRET-CANARY'], kind='other'),
                dict(stage='environment', kind='SECRET-CANARY'),
                dict(stage='environment', kind='other', raw='SECRET-CANARY'),
                dict(stage='include_probe', kind='process_probe')]:
            with self.subTest(value=value):
                self.setUp()
                row = dict(schema='nac342-owner-v1', event='failed', complete=False,
                    reason='ownership_observation_unavailable', retained_identities=[], unresolved=[],
                    observed_uptime_ns='99700000000', producer_failure=value)
                result = self.read((json.dumps(row)+'\n').encode())
                self.assertEqual(result['failure'], 'ownership_observation_unavailable')
                self.assertNotIn('producer_failure', result['stream_diagnostic'])
                self.assertNotIn('SECRET-CANARY', json.dumps(result))
                self.assertFalse(result['positive_settlement'])

    def test_probe_details_are_preserved_alongside_static_stage(self):
        row = dict(schema='nac342-owner-v1', event='failed', complete=False,
            reason='ownership_observation_unavailable', retained_identities=[],
            unresolved=[dict(pid=11, scope='known', reason='path_denied')],
            observed_uptime_ns='99700000000',
            producer_failure=dict(stage='include_probe', kind='process_probe'))
        result = self.read((json.dumps(row)+'\n').encode())
        self.assertEqual(result['unresolved'], row['unresolved'])
        self.assertEqual(result['stream_diagnostic']['producer_failure'], row['producer_failure'])
        self.assertFalse(result['positive_settlement'])

    def test_optional_projection_rejects_unknown_stage_types_and_probe_mismatch(self):
        annotations = [
            dict(stage='PRIVATE-CANARY', kind='other'),
            dict(stage=1, kind='other'), dict(stage='environment', kind=False),
            dict(stage='environment'), dict(kind='other'),
            dict(stage='include_probe', kind='other'),
        ]
        for annotation in annotations:
            with self.subTest(annotation=annotation):
                self.setUp()
                row = dict(schema='nac342-owner-v1', event='failed', complete=False,
                    reason='ownership_observation_unavailable', retained_identities=[],
                    unresolved=[dict(pid=11, scope='known', reason='path_denied')],
                    observed_uptime_ns='99700000000', producer_failure=annotation)
                result = self.read((json.dumps(row) + '\n').encode())
                self.assertEqual(result['failure'], 'ownership_observation_unavailable')
                self.assertEqual(result['unresolved'], row['unresolved'])
                self.assertNotIn('producer_failure', result['stream_diagnostic'])
                self.assertNotIn('PRIVATE-CANARY', json.dumps(result))
                self.assertFalse(result['positive_process_settlement'])
                self.assertEqual(self.owner.last_accepted_uptime_ns, 99500000000)
                self.assertEqual(self.owner.last_observation, 99.5)
                self.assertFalse(self.owner.retired)
                self.assertFalse(self.owner.signals)

    def test_first_producer_annotation_is_retained_without_new_freshness_or_authority(self):
        first = dict(schema='nac342-owner-v1', event='failed', complete=False,
            reason='ownership_observation_unavailable', retained_identities=[], unresolved=[],
            observed_uptime_ns='99700000000',
            producer_failure=dict(stage='environment', kind='ownership_invalid'))
        later = dict(first, observed_uptime_ns='99800000000',
                     producer_failure=dict(stage='snapshot_emit', kind='other'))
        result = self.read(b''.join((json.dumps(row) + '\n').encode() for row in (first, later)))
        self.assertEqual(result['stream_diagnostic']['producer_failure'], first['producer_failure'])
        self.assertEqual(result['failure'], 'ownership_observation_unavailable')
        self.assertEqual(result['latest_pids'], [10, 11])
        self.assertEqual(self.owner.last_accepted_uptime_ns, 99500000000)
        self.assertEqual(self.owner.last_observation, 99.5)
        self.assertFalse(result['positive_settlement'])
        self.assertFalse(result['positive_process_settlement'])
        with patch('ci_startup_owner.ctypes.CDLL') as inspect, \
                patch('ci_startup_owner.os.kill') as send:
            with self.assertRaises(RuntimeError): self.owner.settle(0)
            with self.assertRaises(RuntimeError): self.owner.attachment_binding()
            with self.assertRaises(RuntimeError): self.owner.signal_owned(self.owner.latest[0], 15)
            inspect.assert_not_called()
            send.assert_not_called()
        self.assertEqual(self.owner.signals, [])

    def test_unknown_outer_field_cannot_relax_failed_record_validation(self):
        row = dict(schema='nac342-owner-v1', event='failed', complete=False,
            reason='ownership_observation_unavailable', retained_identities=[], unresolved=[],
            observed_uptime_ns='99700000000', private='PRIVATE-CANARY',
            producer_failure=dict(stage='environment', kind='ownership_invalid'))
        diagnostic = self.assert_failure((json.dumps(row) + '\n').encode(),
                                         'record_validation', 'invalid_record')
        self.assertNotIn('producer_failure', diagnostic)
        self.assertNotIn('PRIVATE-CANARY', json.dumps(diagnostic))

    def test_healthy_stream_and_expected_stop_gain_no_failure_or_settlement(self):
        result=self.read(healthy=True)
        self.assertIsNone(result['failure'])
        self.assertIsNone(result.get('stream_diagnostic'))
        self.assertEqual(result['latest_pids'],[10,11])
        self.assertFalse(result['positive_settlement'])


if __name__=='__main__': unittest.main()
