import copy
import json
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

from ci_instances import (APP_IDS, CASES, audit_cleanup, require_build, require_cases,
                          require_owner_console, retain_receipt)
from ci_qualifications import select_target


class InstanceEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.target = select_target('all-343-macos26')
        self.builds = {}
        for track in ('dev', 'stable'):
            self.builds[track] = {'instance': {
                'engine_identity': {'source_revision': self.target['source_sha'], 'track': track},
                'bundle_identifier': APP_IDS[track] + '.instance-smoke',
                'engine_sha256': track * 16, 'native_sha256': track * 16}}
        self.hashes = {'instance_smoke.py': 'a' * 64}
        self.assets = {'index.html': 'b' * 64}
        state = {'unlocked': True, 'refusals': [], 'critical_fact': True, 'optional_lock': None}
        self.summary = {'source_head': self.target['source_sha'], 'source_dirty': False,
            'runtime_passed': True, 'full_scenario_run': True, 'requested_scenarios': list(CASES),
            'instrumentation': 'INSTANCE_SMOKE + PREVIEW_SMOKE + LOCAL_APP', 'actual_app_acceptance': False,
            'fixture_sources': self.hashes, 'session': state,
            'console_observations': [{'boundary': boundary, 'state': copy.deepcopy(state)} for boundary in
                ['preflight', *['scenario-' + name for name in CASES], 'completed']],
            'bundles': [{'identity': self.builds[track]['instance']['engine_identity'],
                'bundle_id': self.builds[track]['instance']['bundle_identifier'],
                'native_sha256': self.builds[track]['instance']['native_sha256'],
                'engine_sha256': self.builds[track]['instance']['engine_sha256']} for track in ('dev', 'stable')],
            'cases': []}
        def episode(track, store):
            return {'passed': True, 'stopped': True, 'engine_cleanup_observed': True,
                'workspace_activated': True, 'workspace_window_count': 1,
                'engine_identity': self.builds[track]['instance']['engine_identity'],
                'expected_store': store, 'ready_store': store,
                'same_window_reopened': True, 'same_engine_reopened': True}
        for name in CASES:
            case = {**episode('dev', '/owned/dev.db'), 'scenario': name,
                    'canonical_store': '/owned/dev.db', 'embedded_assets': self.assets}
            if name == 'simultaneous':
                case.update(launch_callers=2, serving_owners=1)
            elif name == 'app-crash':
                # Match the real supplier: no duplicated assets field here.
                case.pop('embedded_assets')
                case.update(original_app={'pid': 1, 'launch_time': 1}, replacement_app={'pid': 1, 'launch_time': 2},
                    original_engine_settled_after_parent_death=True, stale_discovery_ignored=True,
                    ordinary_lease_after_crash=True)
            elif name == 'coexist':
                case = {'scenario': name, 'passed': True, 'stores': ['/owned/dev.db', '/owned/stable.db'],
                    'identities': [self.builds[track]['instance']['engine_identity'] for track in ('dev', 'stable')],
                    'apps': [episode('stable', '/owned/stable.db'), episode('dev', '/owned/dev.db')],
                    'embedded_assets': [self.assets, self.assets]}
            else:
                case.update(real_cli_pid=9, cli_survived_app_and_retry=True, schema_and_lock_unchanged=True,
                    no_alternative_store=True, live_owner_logical_records_unchanged=True,
                    workspace_not_activated_during_conflict=True, live_owner_retry_remained_conflict=True,
                    retry_loaded_same_store=True)
            self.summary['cases'].append(case)

    def validate(self, summary):
        return require_cases(summary, self.target, self.builds, self.hashes, self.assets,
                             lambda state: [] if state.get('critical_fact') is True else ['critical fact missing'])

    def test_eight_case_specific_contract_accepts_actual_crash_and_reverse_coexist_shape(self):
        self.assertEqual(self.validate(self.summary)['scenario_count'], 8)
        self.assertFalse(self.summary['actual_app_acceptance'])

    def test_partial_foreign_or_skipped_case_cannot_pass(self):
        for change in ({'source_head': '0' * 40}, {'source_dirty': True}, {'runtime_passed': False},
                       {'full_scenario_run': False}, {'cases': self.summary['cases'][:-1]},
                       {'requested_scenarios': list(CASES[:-1])}, {'fixture_sources': {}},
                       {'instrumentation': 'ordinary'}, {'actual_app_acceptance': True}):
            with self.assertRaises(RuntimeError):
                self.validate({**self.summary, **change})
        for number, field in [(0, 'serving_owners'), (1, 'cli_survived_app_and_retry'),
                              (1, 'real_cli_pid'), (6, 'original_engine_settled_after_parent_death')]:
            bad = copy.deepcopy(self.summary)
            bad['cases'][number][field] = False
            with self.assertRaises(RuntimeError):
                self.validate(bad)

    def test_missing_console_or_changed_store_bundle_and_assets_refuse(self):
        for mutation in ('console', 'boundary', 'store', 'bundle', 'assets', 'cleanup', 'coexist'):
            bad = copy.deepcopy(self.summary)
            if mutation == 'console': bad['console_observations'][2]['state']['critical_fact'] = None
            if mutation == 'boundary': bad['console_observations'].pop(2)
            if mutation == 'store': bad['cases'][1]['ready_store'] = '/someone-else.db'
            if mutation == 'bundle': bad['bundles'][0]['native_sha256'] = 'wrong'
            if mutation == 'assets': bad['cases'][1]['embedded_assets'] = {}
            if mutation == 'cleanup': bad['cases'][6]['engine_cleanup_observed'] = False
            if mutation == 'coexist': bad['cases'][7]['stores'][1] = '/owned/dev.db'
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                self.validate(bad)

    def test_raw_optional_value_is_preserved_and_declared_unlocked_alone_is_insufficient(self):
        state = {'unlocked': True, 'refusals': [], 'optional_lock': None}
        before = copy.deepcopy(state)
        require_owner_console(state, lambda _value: [])
        self.assertEqual(state, before)
        with self.assertRaises(RuntimeError):
            require_owner_console(state, lambda _value: ['missing actual critical fact'])

    def test_build_receipt_cannot_cross_source_track_or_instrumentation(self):
        receipt = {'source_head': self.target['source_sha'], 'source_dirty': False,
            'engine_identity': self.builds['dev']['instance']['engine_identity'],
            'normal_startup': True, 'preview_definitions_excluded': True,
            'smoke_instrumentation': False, 'instance_smoke_instrumentation': False,
            'mode': 'app-build', 'bundle_identifier': APP_IDS['dev']}
        require_build(receipt, self.target, 'dev', False)
        for change in ({'source_dirty': True}, {'smoke_instrumentation': True},
                       {'engine_identity': self.builds['stable']['instance']['engine_identity']},
                       {'source_head': '0' * 40}, {'preview_definitions_excluded': False}):
            with self.assertRaises(RuntimeError):
                require_build({**receipt, **change}, self.target, 'dev', False)

    def test_complete_receipt_projection_preserves_every_case_and_observation(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / 'instances'
            destination.mkdir()
            (destination / 'summary.json').write_text(json.dumps(self.summary))
            relative = retain_receipt(destination)
            index_path = destination.parent / relative
            index = json.loads(index_path.read_text())
            restored = index['metadata']
            for key in ('cases', 'console_observations'):
                restored[key] = [json.loads((index_path.parent / name).read_text()) for name in index[key]]
            self.assertEqual(restored, self.summary)

    def test_cleanup_audit_never_signals_and_detects_matching_private_engine(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary).resolve() / 'instances'
            root = destination / 'nac-instance-app-owned'
            root.mkdir(parents=True)
            (destination / 'summary.json').write_text(json.dumps({'fixture': str(root), 'runtime_passed': False}))
            calls = []
            def command(args):
                calls.append(args)
                return json.dumps({'apps': []}) if args[1] == 'state' else ''
            result = audit_cleanup(destination, Path('/observer'), command)
            self.assertTrue(result['failure_fixture_retained_per_target_policy'])
            self.assertTrue(all(args[1] == 'state' or args[0] == '/bin/ps' for args in calls))
            engine = root / 'Moved app with spaces 0/NAC Instance Smoke.app/Contents/Resources/nac-web'
            with self.assertRaisesRegex(RuntimeError, 'survived'):
                audit_cleanup(destination, Path('/observer'), lambda args: json.dumps({'apps': []})
                              if args[1] == 'state' else f'123 S {engine} --store-path owned.db')


class DriverInterruptionTests(unittest.TestCase):
    def test_sigterm_unwinds_the_unchanged_target_finally(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'target'
            source = root / 'desktop/macos/instance_smoke.py'
            source.parent.mkdir(parents=True)
            marker = Path(temporary) / 'closed'
            source.write_text('import pathlib,sys,time\np=pathlib.Path(sys.argv[1])\n'
                'try:\n p.with_suffix(".ready").touch()\n time.sleep(30)\nfinally:\n p.write_text("closed")\n')
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
            git('init', '-q')
            git('add', 'desktop')
            git('-c', 'user.name=NAC fixture', '-c', 'user.email=fixture@example.invalid',
                '-c', 'commit.gpgsign=false', 'commit', '-qm', 'owned fixture')
            sha = git('rev-parse', 'HEAD')
            wrapper = Path(__file__).with_name('ci_instances.py')
            process = subprocess.Popen([sys.executable, '-B', str(wrapper), 'driver', str(root), sha, str(marker)],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                deadline = time.monotonic() + 4
                while not marker.with_suffix('.ready').exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(.02)
                self.assertTrue(marker.with_suffix('.ready').exists())
                process.send_signal(signal.SIGTERM)
                self.assertNotEqual(process.wait(timeout=4), 0)
                self.assertEqual(marker.read_text(), 'closed')
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=3)


if __name__ == '__main__':
    unittest.main()
