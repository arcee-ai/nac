"""Inert receipt controls; never claim AppKit, Safari or physical cleanup."""
import copy
import json
import unittest
from external_auth_smoke import require_callback_witness


class CallbackWitnessReceiptControls(unittest.TestCase):
    def fixture(self):
        source = 'a' * 40
        build = {'source_revision': source, 'build_id': 'inert-dev'}
        uid = '00000000-0000-0000-0000-000000000001'
        runtime = {**build, 'schema_version': 50, 'scenario': 'native-external-auth',
                   'store_engine': 'sqlite', 'journal_mode': 'wal'}
        rows = [{'name': 'nac.mcp.oauth.callback.' + name, 'kind': 'diagnostic', 'outcome': outcome,
                 'timestamp_unix_ms': 1, 'export_recorder_id': uid, 'correlation': {'generation': 7},
                 'runtime': copy.deepcopy(runtime)} for name, outcome in [('listening', 'started'), ('state_rejected', 'error')]]
        proof = {'source': source, 'build': 'inert-dev', 'schema': 50, 'engine_pid': 101,
                 'engine_incarnation': uid, 'document': uid, 'view': uid, 'launch': uid,
                 'recorder_id': uid, 'owner': '7', 'rejection_observed_ns': '100', 'cancel_issued_ns': '101',
                 'token_counts_before': [1, 1], 'token_counts_after': [1, 1], 'observations': rows,
                 'state_rejection_observed': True, 'rejection_before_cancel': True, 'complete_stream_capture': False}
        final = {'process_id': 101, 'recorder_id': uid, 'runtime': copy.deepcopy(runtime), 'final_receipt': True,
                 'capacity': 1024, 'receipt_failures': 0,
                 'stats': {'accepted': 8, 'exported': 8, 'dropped': 0, 'failures': 0}}
        record = {'ready_schema': 50, 'engine_pid': 101, 'launch_incarnation': uid,
                  'engine_reaped': True, 'identity_retired': True, 'profile_removed': True, 'commands_retired': True,
                  'external_auth': {'wrong_state_rejected_then_canceled': True, 'wrong_state_callback_witness': proof},
                  'engine_log_after_shutdown': 'nac-telemetry-export ' + json.dumps(final) + '\n'}
        return record, build, final

    def test_positive_rows_and_final_allow_evicted_tail_without_full_capture_claim(self):
        record, build, _ = self.fixture()
        require_callback_witness(record, build)

    def test_binding_order_privacy_and_custody_fail_closed(self):
        failures = []
        for key, value in [('source', 'b' * 40), ('build', 'other'), ('schema', True), ('engine_pid', 102),
                           ('engine_incarnation', '00000000-0000-0000-0000-000000000002'),
                           ('recorder_id', '00000000-0000-0000-0000-000000000002'), ('owner', '07'),
                           ('cancel_issued_ns', '99'), ('token_counts_after', [2, 2]),
                           ('rejection_before_cancel', False), ('complete_stream_capture', True), ('observations', [])]:
            record, build, _ = self.fixture()
            record['external_auth']['wrong_state_callback_witness'][key] = value
            failures.append((key, record, build))
        for key in ['engine_reaped', 'identity_retired', 'profile_removed', 'commands_retired']:
            record, build, _ = self.fixture()
            record[key] = False
            failures.append((key, record, build))
        for key in ['code', 'state', 'token', 'server', 'store']:
            record, build, _ = self.fixture()
            record['external_auth']['wrong_state_callback_witness']['observations'][1][key] = 'secret-canary'
            failures.append((key, record, build))
        for key, record, build in failures:
            with self.subTest(key=key), self.assertRaises((AssertionError, ValueError)):
                require_callback_witness(record, build)

    def test_final_missing_duplicate_wrong_owner_loss_and_malformed_fail(self):
        for mode in ['missing', 'duplicate', 'pid', 'recorder', 'source', 'drop', 'failure', 'receipt', 'count', 'partial', 'bool']:
            record, build, final = self.fixture()
            if mode == 'pid': final['process_id'] = 102
            if mode == 'recorder': final['recorder_id'] = '00000000-0000-0000-0000-000000000002'
            if mode == 'source': final['runtime']['source_revision'] = 'b' * 40
            if mode == 'drop': final['stats']['dropped'] = 1
            if mode == 'failure': final['stats']['failures'] = 1
            if mode == 'receipt': final['receipt_failures'] = 1
            if mode == 'count': final['stats']['accepted'] = 9
            if mode == 'bool': final['stats']['exported'] = True
            line = 'nac-telemetry-export ' + json.dumps(final) + '\n'
            record['engine_log_after_shutdown'] = '' if mode == 'missing' else line * (2 if mode == 'duplicate' else 1)
            if mode == 'partial': record['engine_log_after_shutdown'] = line[:-4]
            with self.subTest(mode=mode), self.assertRaises((AssertionError, ValueError)):
                require_callback_witness(record, build)


if __name__ == '__main__':
    unittest.main()
