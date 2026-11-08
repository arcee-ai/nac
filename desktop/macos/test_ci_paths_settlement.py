"""Actual adapter settlement characterization with entirely injected processes."""
from functools import partial
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ci import settle_apps
from ci_paths import settle_case
from ci_paths_protocol import CASES, OPERATIONS
import test_ci_paths_protocol as phase_fixtures


class ReapedEngineControls(unittest.TestCase):
    def test_current_zero_retains_historical_actor_engine_for_independent_settlement(self):
        with tempfile.TemporaryDirectory(prefix='nac-mac-relocation-') as temporary:
            root = Path(temporary).resolve()
            parent = root / 'app-evidence'; parent.mkdir(mode=0o700)
            profile = root / 'owned-profile'; profile.mkdir()
            relocated = root / 'Moved folder with spaces' / 'NAC Development Preview Smoke.app'
            fixture = phase_fixtures.PhaseControls()
            scope = fixture.scope(OPERATIONS[1]); history = fixture.phases(OPERATIONS[1])
            engine_identity = [scope['engine_pid'], 1000, 25]
            collection = dict(scope=scope, history=history, inputs=[dict(engine_start=engine_identity)])
            record = dict(scenario=CASES[1], app_pid=scope['app_pid'], engine_pid=0,
                          paths_phase=history[-1], profile=str(profile), engine_reaped=True)
            evidence = parent / 'app.json'; evidence.write_text(json.dumps(record))
            original = evidence.read_bytes()
            live = {scope['app_pid']: True, scope['engine_pid']: False}
            cleaner_calls, observed = [], []
            def status(pid):
                observed.append(pid)
                return 'S' if live[pid] else ''
            def cleaner(path, bundle):
                cleaner_calls.append((path, bundle))
                derived = json.loads(path.read_text())
                self.assertEqual(derived['engine_pid'], 0)
                self.assertEqual(derived['historical_engine_identity'], engine_identity)
                self.assertEqual(bundle, relocated)
                self.assertEqual(observed, [scope['engine_pid']])
                live[scope['app_pid']] = False
                profile.rmdir()
            owner = partial(settle_apps, cleanup=cleaner, extra_alive=lambda pid: live.get(pid, False))
            with patch('ci.alive', side_effect=lambda pid: live.get(pid, False)), \
                    patch('ci.command', return_value=str(relocated / 'Contents/MacOS/NACPreview')), \
                    patch('ci_xctest.subprocess.run', side_effect=lambda args, **_: type('Status', (), {
                        'returncode': 0 if live[int(args[2])] else 1, 'stderr': '', 'stdout': status(int(args[2]))})()):
                result = settle_case(evidence, relocated, collection, owner)
            self.assertTrue(result['app_engine_settled'])
            self.assertEqual(observed, [scope['engine_pid'], scope['app_pid'], scope['engine_pid']])
            self.assertEqual(len(cleaner_calls), 1)
            self.assertFalse(profile.exists())
            self.assertEqual(evidence.read_bytes(), original)




class SentinelRejectionControls(unittest.TestCase):
    def fixture(self, root, *, current=0):
        parent = root / 'app-evidence'; parent.mkdir(mode=0o700)
        profile = root / 'owned-profile'; profile.mkdir()
        fixture = phase_fixtures.PhaseControls()
        scope = fixture.scope(OPERATIONS[1]); history = fixture.phases(OPERATIONS[1])
        collection = dict(scope=scope, history=history, inputs=[dict(engine_start=[scope['engine_pid'], 1000, 25])])
        record = dict(scenario=CASES[1], app_pid=scope['app_pid'], engine_pid=current,
                      paths_phase=history[-1], profile=str(profile), engine_reaped=True)
        return parent / 'app.json', profile, collection, record

    def rejected(self, *, record_changes=None, collection_change=None, collection_missing=False,
                 observer_value='', observer_error=None):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            evidence, profile, collection, record = self.fixture(root)
            if record_changes:
                record_changes(record)
            if collection_change:
                collection_change(collection)
            if collection_missing:
                collection = None
            evidence.write_text(json.dumps(record)); original = evidence.read_bytes()
            with patch('ci_paths.observe_process_status', return_value=observer_value, side_effect=observer_error) as observer, \
                    patch('ci_paths.require_settled') as final:
                called = []
                with self.assertRaises(RuntimeError):
                    settle_case(evidence, root / 'app', collection, called.append)
                self.assertEqual(called, [])
                final.assert_not_called()
            self.assertTrue(profile.exists()); self.assertFalse((root / 'cleanup').exists())
            self.assertEqual(evidence.read_bytes(), original)
            return observer.call_count

    def test_foreign_positive_malformed_and_missing_current_pid_never_reach_observer_or_owner(self):
        for value in (31, -1, True, '0', None):
            with self.subTest(value=value):
                count = self.rejected(record_changes=lambda row: row.update(engine_pid=value))
                self.assertEqual(count, 0)
        self.assertEqual(self.rejected(record_changes=lambda row: row.pop('engine_pid')), 0)

    def test_zero_live_or_unknown_original_engine_never_reaches_cleanup(self):
        for value in ('S', 'R', 'T', None, 0):
            with self.subTest(value=value):
                self.assertEqual(self.rejected(observer_value=value), 1)
        self.assertEqual(self.rejected(observer_error=RuntimeError('Injected unknown process observation')), 1)

    def test_zero_requires_verified_original_positive_engine_start_identity(self):
        for identity in (None, [], [31,1000,25], [30,0,25], [30,1000,1_000_000], [30,True,25], ['30',1000,25]):
            with self.subTest(identity=identity):
                self.assertEqual(self.rejected(collection_change=lambda value: value['inputs'][0].update(engine_start=identity)), 0)
        self.assertEqual(self.rejected(collection_change=lambda value: value['inputs'].append(dict(engine_start=[31,1000,25]))), 0)

    def test_changed_app_source_operation_run_document_or_phase_never_reaches_cleanup(self):
        self.assertEqual(self.rejected(record_changes=lambda row: row.update(app_pid=99)), 0)
        for field, value in (('source','f'*40), ('operation',OPERATIONS[0]), ('run','foreign'),
                             ('document','foreign'), ('sequence',0), ('version',True)):
            def change(row):
                row['paths_phase'] = {**row['paths_phase'], field:value}
            with self.subTest(field=field):self.assertEqual(self.rejected(record_changes=change), 0)
        self.assertEqual(self.rejected(record_changes=lambda row: row.update(scenario=CASES[0])), 0)
        self.assertEqual(self.rejected(collection_change=lambda value: value['scope'].update(source='f'*40)), 0)

    def test_missing_actor_proof_or_incomplete_failure_history_remains_closed(self):
        self.assertEqual(self.rejected(collection_missing=True), 0)
        for field in ('scope','inputs','history'):
            with self.subTest(field=field):
                self.assertEqual(self.rejected(collection_change=lambda value: value.update({field:None})), 0)
        self.assertEqual(self.rejected(collection_change=lambda value: value.update(history=value['history'][:1])), 0)

    def test_current_positive_path_remains_with_existing_owner_and_original_record(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            evidence, profile, collection, record = self.fixture(root,current=30)
            evidence.write_text(json.dumps(record));original=evidence.read_bytes()
            derived=[]
            def owner(folder):
                context=json.loads((folder/'evidence/app.json').read_text())
                self.assertEqual(context['engine_pid'],30)
                self.assertNotIn('historical_engine_identity',context)
                derived.append(context);profile.rmdir()
            with patch('ci_paths.observe_process_status') as observer, \
                    patch('ci_xctest.subprocess.run',return_value=type('Status',(),{'returncode':1,'stdout':'','stderr':''})()):
                result=settle_case(evidence,root/'app',collection,owner)
                observer.assert_not_called()
            self.assertTrue(result['app_engine_settled']);self.assertEqual(result['historical_engine_observations'],[])
            self.assertEqual(len(derived),1);self.assertEqual(evidence.read_bytes(),original)

    def test_original_engine_is_rechecked_after_owner_and_unknown_or_live_cannot_pass(self):
        for second in ('S',None,RuntimeError('Injected unknown after cleanup')):
            with self.subTest(second=second),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary).resolve();evidence,profile,collection,record=self.fixture(root)
                evidence.write_text(json.dumps(record));original=evidence.read_bytes()
                owner_calls=[]
                def owner(folder):
                    owner_calls.append(folder);profile.rmdir()
                states=['',second]
                with patch('ci_paths.observe_process_status',side_effect=states) as observer, \
                        patch('ci_xctest.subprocess.run',return_value=type('Status',(),{'returncode':1,'stdout':'','stderr':''})()):
                    with self.assertRaises(RuntimeError):settle_case(evidence,root/'app',collection,owner)
                self.assertEqual(observer.call_count,2);self.assertEqual(len(owner_calls),1)
                self.assertEqual(evidence.read_bytes(),original)
                self.assertTrue((root/'cleanup').exists())

    def test_strict_read_observation_rejects_diagnostics_errors_empty_success_or_multiple_rows(self):
        results=[dict(returncode=1,stdout='',stderr='permission denied'),dict(returncode=2,stdout='',stderr=''),
                 dict(returncode=0,stdout='',stderr=''),dict(returncode=0,stdout='Z\nS\n',stderr=''),
                 dict(returncode=1,stdout='Z',stderr=''),dict(returncode=0,stdout=None,stderr='')]
        for values in results:
            with self.subTest(values=values),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary).resolve();evidence,profile,collection,record=self.fixture(root)
                evidence.write_text(json.dumps(record));calls=[]
                with patch('ci_xctest.subprocess.run',return_value=type('Status',(),values)()) as query:
                    with self.assertRaises(RuntimeError):settle_case(evidence,root/'app',collection,calls.append)
                self.assertEqual(query.call_count,1);self.assertEqual(calls,[]);self.assertTrue(profile.exists())
                self.assertEqual(query.call_args.args[0],['/bin/ps','-p','30','-o','stat='])


if __name__ == '__main__':
    unittest.main()
