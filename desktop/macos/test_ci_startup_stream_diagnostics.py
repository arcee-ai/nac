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

    def bsd_failure(self):
        return dict(schema='nac342-owner-v1', event='failed', complete=False,
            reason='ownership_observation_unavailable', retained_identities=[],
            unresolved=[dict(pid=11, scope='known', reason='bsd_unavailable')], observed_uptime_ns='99700000000',
            producer_failure=dict(stage='include_probe', kind='process_probe',
                bsd_read=dict(returned_count=0, expected_count=136, errno=5)))

    def test_bsd_operands_are_passive_and_timestamp_is_later_producer_record_time(self):
        row = self.bsd_failure()
        legacy = copy.deepcopy(row); legacy['producer_failure'].pop('bsd_read')
        baseline = self.read((json.dumps(legacy)+'\n').encode())
        baseline_state = (copy.deepcopy(self.owner.history), copy.deepcopy(self.owner.latest),
                          self.owner.last_accepted_uptime_ns, self.owner.last_observation)
        self.owner = OwnerWitness(self.config, self.digest, uid=501, clock=lambda: 100.)
        result = self.read((json.dumps(row)+'\n').encode())
        detail = result['stream_diagnostic']['producer_failure']['bsd_read']
        self.assertEqual(detail, dict(row['producer_failure']['bsd_read'], failure_record_uptime_ns='99700000000'))
        self.assertNotIn('syscall', json.dumps(detail))
        self.assertEqual({k:v for k,v in result.items() if k != 'stream_diagnostic'},
                         {k:v for k,v in baseline.items() if k != 'stream_diagnostic'})
        self.assertEqual((self.owner.history, self.owner.latest, self.owner.last_accepted_uptime_ns,
                          self.owner.last_observation), baseline_state)
        with patch('ci_startup_owner.ctypes.CDLL') as query, patch('ci_startup_owner.os.kill') as signal:
            with self.assertRaises(RuntimeError): self.owner.signal_owned(self.owner.latest[0], 15)
            with self.assertRaises(RuntimeError): self.owner.attachment_binding()
            with self.assertRaises(RuntimeError): self.owner.settle(0)
            query.assert_not_called(); signal.assert_not_called()

    def test_bsd_optional_projection_is_closed_and_malformed_detail_never_replaces_failure(self):
        from ci_startup_owner import _producer_failure
        bad = [None, {}, [], dict(returned_count=0, expected_count=136, errno=5, path='PRIVATE'),
               dict(returned_count=136, expected_count=136, errno=5)]
        original = self.bsd_failure()['producer_failure']['bsd_read']
        for key in original:
            for value in (True, '0', 2**31, -(2**31)-1, None):
                bad.append(dict(original, **{key:value}))
        bad += [dict(original, expected_count=0), dict(original, expected_count=65537)]
        for detail in bad:
            with self.subTest(detail=detail):
                self.owner = OwnerWitness(self.config, self.digest, uid=501, clock=lambda: 100.)
                row = self.bsd_failure(); row['producer_failure']['bsd_read'] = detail
                self.assertIsNone(_producer_failure(row))
                result = self.read((json.dumps(row)+'\n').encode())
                self.assertEqual(result['failure'], 'ownership_observation_unavailable')
                self.assertEqual(result['unresolved'], row['unresolved'])
                self.assertNotIn('producer_failure', result['stream_diagnostic'])
                self.assertNotIn('PRIVATE', json.dumps(result))
                self.assertFalse(result['positive_process_settlement'])
                self.assertFalse(result['positive_settlement'])
                self.assertFalse(self.owner.signals)
        for stamp in (True, 1, '01', '-1', str(2**64)):
            row = self.bsd_failure(); row['observed_uptime_ns'] = stamp
            self.assertIsNone(_producer_failure(row))
        for reason in ('bsd_denied', 'bsd_unavailable'):
            row = self.bsd_failure(); row['unresolved'][0]['reason'] = reason
            row['producer_failure']['bsd_read'] = dict(returned_count=2**31-1, expected_count=65536, errno=-(2**31))
            self.assertIsNotNone(_producer_failure(row))
        for change in (dict(unresolved=[]), dict(unresolved=[dict(pid=11, scope='known', reason='path_denied')]),
                       dict(producer_failure=dict(stage='include_probe', kind='other', bsd_read=original))):
            self.assertIsNone(_producer_failure(dict(self.bsd_failure(), **change)))

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

    def environment_failure(self, detail, *, stage='environment', kind='ownership_invalid'):
        return dict(schema='nac342-owner-v1', event='failed', complete=False,
            reason='ownership_observation_unavailable', retained_identities=[], unresolved=[],
            observed_uptime_ns='99700000000', producer_failure=dict(stage=stage, kind=kind,
                                                                  environment_rejection=detail))

    def test_closed_environment_details_are_passive_and_never_admit_a_failed_subject(self):
        details = [dict(predicate='contract', contract_check=check)
                   for check in ('key_set', 'empty_launcher', 'non_path_value')]
        details += [dict(predicate='prohibited', category=category)
                    for category in ('token', 'api_key', 'managed_config')]
        details += [dict(predicate='native_argv', argv0_matches=False, helper_present=False, serving_present=False),
                    dict(predicate='engine_argv', argv0_matches=True, helper_present=True, serving_present=True)]
        details += [dict(predicate='controlled_value', field=field, difference=difference)
                    for field in ('HOME', 'NAC_HOME', 'PATH', 'LANG', 'NAC_TELEMETRY', 'NAC_ORCHESTRATION',
                                  'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'BROWSER', 'MODELS_DEV_URL', 'other')
                    for difference in ('absent', 'different')]
        for detail in details:
            for previously_known in (False, True):
                with self.subTest(detail=detail, previously_known=previously_known):
                    self.setUp()
                    executable_class = ('native' if detail['predicate'] == 'native_argv' else 'bundled_engine'
                                        if detail['predicate'] == 'engine_argv' else 'descendant')
                    row = self.environment_failure(dict(executable_class=executable_class,
                                                       previously_known=previously_known, **detail))
                    result = self.read((json.dumps(row) + '\n').encode())
                    self.assertEqual(result['stream_diagnostic']['producer_failure'], row['producer_failure'])
                    self.assertEqual(set(self.owner.history), {10, 11})
                    self.assertEqual(result['retained_diagnostics'], [])
                    self.assertEqual(result['unresolved'], [])
                    self.assertEqual(result['latest_pids'], [10, 11])
                    self.assertEqual(self.owner.last_accepted_uptime_ns, 99500000000)
                    self.assertEqual(self.owner.last_observation, 99.5)
                    self.assertFalse(result['positive_process_settlement'])
                    self.assertFalse(result['positive_settlement'])
                    with patch('ci_startup_owner.ctypes.CDLL') as inspect, patch('ci_startup_owner.os.kill') as send:
                        with self.assertRaises(RuntimeError): self.owner.settle(0)
                        with self.assertRaises(RuntimeError): self.owner.attachment_binding()
                        with self.assertRaises(RuntimeError): self.owner.signal_owned(self.owner.latest[0], 15)
                        inspect.assert_not_called()
                        send.assert_not_called()

    def test_malformed_environment_detail_is_dropped_with_original_sticky_failure(self):
        good = dict(executable_class='native', previously_known=False, predicate='controlled_value',
                    field='HOME', difference='absent')
        bad = [None, [], 'PRIVATE-CANARY', {}, dict(good, raw='PRIVATE-CANARY'), dict(good, pid=999),
               dict(good, field='PRIVATE-CANARY'), dict(good, field=[]), dict(good, difference='PRIVATE-CANARY'),
               dict(good, previously_known=1), dict(good, executable_class='PRIVATE-CANARY'),
               dict(good, predicate='PRIVATE-CANARY'), dict(good, contract_check='key_set'),
               dict(executable_class='descendant', previously_known=False, predicate='native_argv',
                    argv0_matches=False, helper_present=False, serving_present=False),
               dict(executable_class='native', previously_known=False, predicate='native_argv',
                    argv0_matches=True, helper_present=False, serving_present=False),
               dict(executable_class='bundled_engine', previously_known=False, predicate='engine_argv',
                    argv0_matches=True, helper_present=True, serving_present=False),
               dict(executable_class='native', previously_known=False, predicate='native_argv',
                    argv0_matches=0, helper_present=False, serving_present=False)]
        rows = [self.environment_failure(value) for value in bad]
        rows += [self.environment_failure(good, stage='arguments'), self.environment_failure(good, kind='other')]
        for row in rows:
            with self.subTest(row=row):
                self.setUp()
                result = self.read((json.dumps(row) + '\n').encode())
                self.assertEqual(result['failure'], 'ownership_observation_unavailable')
                self.assertNotIn('producer_failure', result['stream_diagnostic'])
                self.assertNotIn('PRIVATE-CANARY', json.dumps(result))
                self.assertEqual(set(self.owner.history), {10, 11})
                self.assertFalse(self.owner.retired)
                self.assertFalse(self.owner.signals)
                self.assertFalse(result['positive_process_settlement'])
                self.assertEqual(self.owner.last_accepted_uptime_ns, 99500000000)

    def test_legacy_new_and_unknown_resource_stages_never_grant_ownership(self):
        for stage in ('resources_candidates', 'resources_pinned', 'resources_count', 'resources_urls', 'PRIVATE-CANARY'):
            with self.subTest(stage=stage):
                self.setUp()
                row = dict(schema='nac342-owner-v1', event='failed', complete=False,
                    reason='ownership_observation_unavailable', retained_identities=[], unresolved=[],
                    observed_uptime_ns='99700000000', producer_failure=dict(stage=stage, kind='ownership_invalid'))
                result = self.read((json.dumps(row) + '\n').encode())
                self.assertEqual(result['failure'], 'ownership_observation_unavailable')
                if stage == 'PRIVATE-CANARY':
                    self.assertNotIn('producer_failure', result['stream_diagnostic'])
                else:
                    self.assertEqual(result['stream_diagnostic']['producer_failure'], row['producer_failure'])
                self.assertFalse(result['positive_process_settlement'])
                self.assertFalse(self.owner.retired); self.assertFalse(self.owner.signals)
                with patch('ci_startup_owner.os.kill') as send, patch('ci_startup_owner.ctypes.CDLL') as inspect:
                    with self.assertRaises(RuntimeError): self.owner.signal_owned(self.owner.history[11], 15)
                    send.assert_not_called(); inspect.assert_not_called()
                self.assertNotIn('PRIVATE-CANARY', json.dumps(result))

    def test_healthy_stream_and_expected_stop_gain_no_failure_or_settlement(self):
        result=self.read(healthy=True)
        self.assertIsNone(result['failure'])
        self.assertIsNone(result.get('stream_diagnostic'))
        self.assertEqual(result['latest_pids'],[10,11])
        self.assertFalse(result['positive_settlement'])


if __name__=='__main__': unittest.main()
