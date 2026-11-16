"""Inert receipt/admission controls. No process, socket or native acquisition."""
import ast
import copy
from pathlib import Path
import tempfile
import unittest
import uuid

import offline_provider_smoke as offline


def receipt():
    launch, view, old, new = (str(uuid.uuid4()) for _ in range(4))
    return {'engine_pid': 42, 'launch_incarnation': launch, 'provider_responses': 1,
        'offline_provider': {
            'scope': 'ordinary-production-engine-local-API-key; DOM-driven; HTTP(S)-outage-only',
            'offline_supported_local_provider': True, 'whole_machine_offline': False,
            'physical_input_qualified': False, 'real_vendor_qualified': False,
            'setup_saved_read_back': True, 'streamed_response': True, 'persisted_transcript': True,
            'no_managed_login': True, 'external_open_attempts': 0, 'store_bound_through_reload': True,
            'binding': {'launch': launch, 'view': view, 'initial_document': old, 'document': new, 'engine_pid': 42},
            'network': {'scope': 'declared-app-engine-HTTP(S)-only', 'whole_machine_offline': False,
                'failover_allowed': False, 'literal_loopback_bypass': True,
                'baseline_local_reachable': True, 'phases': ['after', 'before'],
                'observations': {'controls': [{'control': k, 'proxy_rejections': 1, 'request_class': 'https-connect' if k.endswith('-https') else 'http-absolute-or-connect', 'authority_fresh': True, 'direct_success': False}
                                             for k in sorted(offline.controls())],
                    'key_accepted': 1, 'key_rejected': 2, 'authenticated_responses': 1,
                    'unlabelled_proxy_rejections': 0}}}}


class OfflineReceiptTests(unittest.TestCase):
    def rejects(self, mutate):
        value = receipt()
        mutate(value)
        with self.assertRaises((AssertionError, ValueError)):
            offline.require_offline(value)

    def test_complete_scoped_receipt(self):
        offline.require_offline(receipt())

    def test_each_missing_observable_and_wider_claim(self):
        value = receipt()['offline_provider']
        for key in ('offline_supported_local_provider', 'setup_saved_read_back', 'streamed_response',
                    'persisted_transcript', 'no_managed_login', 'store_bound_through_reload'):
            with self.subTest(key=key):
                self.rejects(lambda r: r['offline_provider'].__setitem__(key, False))
        for key in ('whole_machine_offline', 'physical_input_qualified', 'real_vendor_qualified'):
            self.rejects(lambda r: r['offline_provider'].__setitem__(key, True))
        self.assertGreater(len(value), 0)

    def test_each_transport_phase_and_scheme_required(self):
        for label in offline.controls():
            self.rejects(lambda r: r['offline_provider']['network']['observations'].__setitem__(
                'controls', [v for v in r['offline_provider']['network']['observations']['controls'] if v['control'] != label]))

    def test_duplicate_or_foreign_control_and_fake_count(self):
        for replacement in ({'control': 'not-a-control', 'proxy_rejections': 1, 'request_class': 'http-absolute-or-connect', 'authority_fresh': True, 'direct_success': False},
                            {'control': sorted(offline.controls())[0], 'proxy_rejections': True, 'request_class': 'http-absolute-or-connect', 'authority_fresh': True, 'direct_success': False}):
            self.rejects(lambda r: r['offline_provider']['network']['observations']['controls'].__setitem__(0, replacement))
        self.rejects(lambda r: r['offline_provider']['network']['observations']['controls'].__setitem__(
            0, copy.deepcopy(r['offline_provider']['network']['observations']['controls'][1])))

    def test_no_observation_overflow_direct_fallback_or_payload(self):
        for key, value in [('proxy_rejections', 0), ('proxy_rejections', 9),
                           ('direct_success', True), ('request_class', 'absolute-https'), ('authority_fresh', False), ('authorization', 'must-not-export')]:
            self.rejects(lambda r: r['offline_provider']['network']['observations']['controls'][0].__setitem__(key, value))
        self.rejects(lambda r: r['offline_provider']['network']['observations'].__setitem__('headers', 'must-not-export'))

    def test_identity_reload_and_opener_scope(self):
        self.rejects(lambda r: r['offline_provider']['binding'].__setitem__('launch', str(uuid.uuid4())))
        self.rejects(lambda r: r['offline_provider']['binding'].__setitem__('engine_pid', 99))
        self.rejects(lambda r: r['offline_provider']['binding'].__setitem__('document', r['offline_provider']['binding']['initial_document']))
        self.rejects(lambda r: r['offline_provider'].__setitem__('external_open_attempts', 1))

    def test_key_usage_receipts_cannot_be_empty_or_bools(self):
        for key, value in [('key_rejected', 1), ('key_accepted', 0), ('authenticated_responses', 0),
                           ('authenticated_responses', True)]:
            self.rejects(lambda r: r['offline_provider']['network']['observations'].__setitem__(key, value))
        self.rejects(lambda r: r.__setitem__('provider_responses', 2))

    def test_boundary_and_privacy_refusals(self):
        for key, value in [('failover_allowed', True), ('literal_loopback_bypass', False),
                           ('baseline_local_reachable', False), ('phases', ['before'])]:
            self.rejects(lambda r: r['offline_provider']['network'].__setitem__(key, value))
        for key in ('engine_log', 'engine_log_after_shutdown', 'dom'):
            self.rejects(lambda r: r.__setitem__(key, 'must-not-export'))


class NormalBuildExclusionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Execute the actual existing finish-owner exclusion arm with inert file
        # bytes, without its Git/SDK/process acquisition. No production rewrite.
        source = (Path(__file__).parent / 'build_receipt.py').read_text()
        tree = ast.parse(source)
        cls.arm = next(n for n in ast.walk(tree) if isinstance(n, ast.If)
                       and ast.unparse(n.test) == "receipt['normal_startup']")
        cls.code = compile(ast.fix_missing_locations(ast.Module(body=[cls.arm], type_ignores=[])),
                           'actual-build-receipt-exclusion-arm', 'exec')

    def check(self, name, smoke, payload=b'ordinary'):
        with tempfile.TemporaryDirectory(prefix='offline-receipt-inert-') as directory:
            app = Path(directory)
            binary = app / 'Contents/MacOS/NACPreview'
            binary.parent.mkdir(parents=True)
            binary.write_bytes(payload)
            facts = {'normal_startup': True, 'smoke_instrumentation': smoke,
                     'native_source_files': {name: 'inert'}}
            exec(self.code, {'Path': Path, 'receipt': facts, 'app': app})
            return facts

    def test_normal_app_and_auth_inputs_reject_every_offline_source(self):
        for name in ('OfflineProviderPolicy.swift', 'OfflineNetworkFence.swift',
                     'OfflineWebProbe.swift', 'OfflineProviderSmoke.swift', 'OfflineHTTPControlTarget.swift'):
            for smoke in (False, True):
                with self.subTest(name=name, smoke=smoke), self.assertRaises(SystemExit):
                    self.check(name, smoke)

    def test_normal_binary_marker_refusal_and_ordinary_positive(self):
        for marker in (b'OfflineNetworkFence', b'offline-dummy-local-only'):
            with self.assertRaises(SystemExit):
                self.check('main.swift', False, marker)
        self.assertTrue(self.check('main.swift', False)['preview_definitions_excluded'])
        self.assertTrue(self.check('DeviceAuthSmoke.swift', True)['preview_definitions_excluded'])


if __name__ == '__main__':
    unittest.main()
