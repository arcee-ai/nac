import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from ci_terminal import CONTRACT, require_contract, require_dispatches, require_episode


class TerminalContractTests(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads(CONTRACT.read_text())
        self.target = {'source_sha': self.contract['terminal_source_head'], 'phase_count': 6, 'scenario_count': 1}
        self.assets = {'/assets/dist/app.js': 'a' * 64, '/assets/dist/app.css': 'b' * 64}

    def episode(self):
        identity = {'schema': 1, 'app_pid': 101, 'engine_pid': 102, 'target_window_number': 17,
                    'app_launch_epoch': 1234.5, 'bundle_path': '/private/owned/NAC Development Preview.app',
                    'session_id': 'session', 'terminal_id': 'terminal', 'controller_revision': 'revision',
                    'unfocused_guard_rejected': True, 'total_seconds_limit': 240,
                    'app_event_post_access': False}
        record = {'scenario': 'terminal-xctest', 'passed': True, 'engine_reaped': True, 'profile_removed': True,
                  'app_pid': 101, 'session_id': 'session', 'terminal_id': 'terminal',
                  'terminal_xctest_identity': identity,
                  'terminal_xctest_phase': {'schema': 1, 'sequence': 6, 'state': 'finished'},
                  'terminal_xctest_phases': [], 'embedded_assets': [{'path': k, 'sha256': v} for k, v in self.assets.items()],
                  'checks': {name: {'status': 'pass'} for name in
                             ('trusted-mac-keyboard-unicode', 'xctest-ctrl-c-recovery', 'resize-pty-readback')}}
        for expected in self.contract['phases']:
            count = expected['expected_input_bytes']
            phase = {key: copy.deepcopy(value) for key, value in expected.items() if key != 'expected_input_bytes'}
            phase.update(schema=1, state='verified', **{key: identity[key] for key in
                         ('app_pid', 'target_window_number', 'session_id', 'terminal_id')})
            phase['proof'] = {'input_bytes': count, 'input_posts': int(count > 0), 'written_receipts': int(count > 0),
                              'trusted_keydowns': int(count > 0), 'synthetic_events': 0, 'terminal_alive': True,
                              'controller_revision': 'revision', 'elapsed_ms': 50}
            record['terminal_xctest_phases'].append(phase)
        for name in ('xctest-unicode', 'xctest-completed'):
            record['paint_' + name] = {'animation_frame': True, 'occlusion_visible': True, 'visible_acceptance': True}
        return record

    def test_source_hashes_and_fixed_operation_limits_are_required(self):
        contract = copy.deepcopy(self.contract)
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary)
            for name in contract['source_files']:
                file = source / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(name)
                contract['source_files'][name] = hashlib.sha256(file.read_bytes()).hexdigest()
            self.assertEqual(require_contract(contract, self.target, source), contract)
            for path, value in [('phase_count', 5), ('source_sha', 'f' * 40)]:
                with self.assertRaises(RuntimeError):
                    require_contract(contract, {**self.target, path: value}, source)
            for field, value in [('sequence', 2), ('seconds_limit', 99), ('expected_input_bytes', 0)]:
                changed = copy.deepcopy(contract)
                changed['phases'][0][field] = value
                with self.assertRaises(RuntimeError):
                    require_contract(changed, self.target, source)
            file.write_text('changed')
            with self.assertRaisesRegex(RuntimeError, 'source differs'):
                require_contract(contract, self.target, source)

    def test_positive_named_episode_remains_explicitly_partial(self):
        result = require_episode(self.episode(), self.contract, self.assets)
        self.assertFalse(result['full_terminal_acceptance'])
        self.assertIn('independent review', result['visible_paint_acceptance'])

    def test_driver_must_record_each_literal_once_after_its_public_operation(self):
        rows = [{**copy.deepcopy(phase), 'state': 'dispatched-once', 'elapsed_ms': 50}
                for phase in self.contract['phases']]
        self.assertEqual(require_dispatches(rows, self.contract), rows)
        for mutate in (lambda r: r.pop(), lambda r: r.append(copy.deepcopy(r[0])),
                       lambda r: r[0].update(state='dispatching-once'),
                       lambda r: r[0]['operation'].update(text='changed'),
                       lambda r: r[2].update(elapsed_ms=10001)):
            changed = copy.deepcopy(rows)
            mutate(changed)
            with self.assertRaises(RuntimeError):
                require_dispatches(changed, self.contract)

    def test_live_operation_or_phase_proof_cannot_replace_nominated_literal(self):
        for mutate in (
            lambda r: r['terminal_xctest_phases'][0]['operation'].update(text='printf arbitrary'),
            lambda r: r['terminal_xctest_phases'].reverse(),
            lambda r: r['terminal_xctest_phases'].pop(),
            lambda r: r['terminal_xctest_phases'][2]['proof'].update(input_bytes=2),
            lambda r: r['terminal_xctest_phases'][2]['proof'].update(input_bytes=True),
            lambda r: r['terminal_xctest_phases'][2]['proof'].update(elapsed_ms=10001),
            lambda r: r['terminal_xctest_phases'][0]['proof'].update(written_receipts=0),
            lambda r: r['terminal_xctest_phases'][0]['proof'].update(synthetic_events=1),
            lambda r: r['terminal_xctest_phases'][0]['proof'].update(trusted_keydowns=0),
            lambda r: r['terminal_xctest_phases'][4]['proof'].update(input_bytes=1),
            lambda r: r['terminal_xctest_phases'][4]['proof'].update(trusted_keydowns=1),
            lambda r: r['terminal_xctest_phases'][0]['proof'].update(controller_revision='other'),
            lambda r: r['terminal_xctest_phases'][0].update(terminal_id='other'),
        ):
            with self.subTest(mutation=mutate):
                record = self.episode()
                mutate(record)
                with self.assertRaisesRegex(RuntimeError, 'proof|completion'):
                    require_episode(record, self.contract, self.assets)

    def test_cleanup_identity_assets_and_visible_frame_fail_closed(self):
        for mutate in (
            lambda r: r.update(passed=False), lambda r: r.update(engine_reaped=False),
            lambda r: r.update(profile_removed=False), lambda r: r.update(error='failure'),
            lambda r: r['terminal_xctest_identity'].update(unfocused_guard_rejected=False),
            lambda r: r['terminal_xctest_identity'].update(session_id='other'),
            lambda r: r['terminal_xctest_identity'].update(engine_pid=0),
            lambda r: r['terminal_xctest_phase'].update(state='ready'),
            lambda r: r.update(embedded_assets=[]),
            lambda r: r['embedded_assets'][0].update(sha256='c' * 64),
            lambda r: r['paint_xctest-completed'].update(animation_frame=False),
            lambda r: r['checks']['resize-pty-readback'].update(status='unavailable'),
        ):
            with self.subTest(mutation=mutate):
                record = self.episode()
                mutate(record)
                with self.assertRaises(RuntimeError):
                    require_episode(record, self.contract, self.assets)


if __name__ == '__main__':
    unittest.main()
