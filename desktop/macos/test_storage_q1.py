"""Draft inert Q1 controls; no actual launch or provider execution."""
import copy
from contextlib import closing, ExitStack
import json
import sqlite3
import tempfile
import uuid
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import storage_q1 as q1
import test_quit_provider_observation as provider_doubles
from storage_q1 import RecoveryLaunch, compare_launches, frame
from storage_q1_witness import TABLES, assert_durable


class Q1Controls(unittest.TestCase):
    def test_foreign_seed_configuration_is_rejected_before_any_api_write(self):
        saved = dict(backend='openai-responses', base_url='http://127.0.0.1:18080',
                     model='gpt-5.6-sol', api_key_env='service-issued-exact-selector')
        provider = SimpleNamespace(endpoint=saved['base_url'])
        for field, value in [('backend', 'managed'), ('base_url', 'http://foreign'),
                             ('model', 'foreign-model'), ('api_key_env', ''),
                             ('api_key_env', None), ('api_key_env', True)]:
            with self.subTest(field=field, value=value), patch.object(q1, 'request') as request:
                with self.assertRaises(ValueError):
                    q1.empty_pair('http://engine', Path('/inert'), provider, 100,
                                  {**saved, field: value})
                request.assert_not_called()

    def test_seed_uses_exact_saved_selector_and_rejects_changed_readback(self):
        saved = dict(backend='openai-responses', base_url='http://127.0.0.1:18080',
                     model='gpt-5.6-sol', api_key_env='service-issued-exact-selector')
        provider = SimpleNamespace(endpoint=saved['base_url'])
        calls = []
        def request(endpoint, path, body=None, **kwargs):
            calls.append((path, body))
            if path == '/projects': return dict(project_id='p')
            return dict(metadata=dict(session_id=str(len(calls)), api_key_env=body['api_key_env']))
        with patch.object(q1, 'request', request), patch.object(q1.time, 'monotonic', return_value=0):
            self.assertEqual(len(q1.empty_pair('http://engine', Path('/inert'), provider, 100, saved)), 2)
        seeds = [body for path, body in calls if path == '/sessions']
        self.assertEqual([body['api_key_env'] for body in seeds], [saved['api_key_env']] * 2)
        with patch.object(q1, 'request', side_effect=[dict(project_id='p'),
                dict(metadata=dict(session_id='s', api_key_env='OPENAI_API_KEY'))]), \
                patch.object(q1.time, 'monotonic', return_value=0):
            with self.assertRaises(ValueError):
                q1.empty_pair('http://engine', Path('/inert'), provider, 100, saved)

    def test_current_source_import_and_absolute_deadline_edges(self):
        # Current8af has engine_settled but no remaining export. Module loading
        # defines the adapter only; it must not create a provider/app or reset a clock.
        spec = importlib.util.spec_from_file_location('_q1_import_control',
                                                     Path(__file__).with_name('storage_q1.py'))
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'instance_smoke': SimpleNamespace(engine_settled=Mock())}):
            spec.loader.exec_module(module)
        self.assertEqual(module._remaining.__module__, '_q1_import_control')
        deadline = 100.0
        with patch.object(module.time, 'monotonic', side_effect=[90.0, 99.75, 100.0, 100.01]):
            self.assertEqual(module._remaining(deadline, 4.0), 4.0)
            self.assertEqual(module._remaining(deadline, 4.0), 0.25)
            with self.assertRaises(TimeoutError): module._remaining(deadline, 4.0)
            with self.assertRaises(TimeoutError): module._remaining(deadline, 4.0)
        self.assertEqual(deadline, 100.0)

    def ready(self):
        return dict(bridge=dict(ready=True, binding=dict(launch='launch-1', view='view-1', document='doc-1')),
                    profile_storage=dict(available=True, persistent=True, selected=True, profile='a'*64),
                    engine_pid=17, endpoint='http://127.0.0.1:12001', recovery=dict(generation=3))

    def summary(self, number):
        ready = self.ready()
        ready['bridge']['binding'] = dict(launch='launch-'+str(number), view='view-'+str(number), document='doc-'+str(number))
        ready['endpoint'] = 'http://127.0.0.1:' + str(12000+number)
        return dict(profile='a'*64, website_store='uuid', store='/private/fixture/store.db',
                    home='/private/fixture/home', app_identity=dict(pid=number, launch_time=number),
                    frame=frame(ready, 'nonce-'+str(number)))

    def test_two_launch_frame_and_stable_profile_new_port(self):
        first, second = self.summary(1), self.summary(2)
        self.assertTrue(compare_launches(first, second)['new_observed_port'])
        for change in (lambda x:x.update(profile='foreign'), lambda x:x.update(website_store='foreign'),
                       lambda x:x.update(store='/foreign'), lambda x:x.update(home='/foreign'),
                       lambda x:x.update(app_identity=first['app_identity']),
                       lambda x:x['frame'].update(document=first['frame']['document']),
                       lambda x:x['frame'].update(launch=first['frame']['launch']),
                       lambda x:x['frame'].update(view=first['frame']['view']),
                       lambda x:x['frame'].update(endpoint=first['frame']['endpoint'])):
            value=copy.deepcopy(second);change(value)
            with self.assertRaises(ValueError):compare_launches(first,value)
        invalid=self.ready();invalid['profile_storage']['available']=False
        with self.assertRaises(ValueError):frame(invalid,'nonce')

    def ledger(self):
        expected=self.summary(1)['frame'];facts=[]
        for sequence, present in [(1,True),(2,False),(3,None)]:
            row=dict(expected,kind='accepted',sequence=sequence,owner='owner',checkpointSHA256=str(sequence)*64)
            row['writeClass']='ordinary' if present is not None else 'native-notifications'
            if present is not None:row.update(namespace='drafts',bPresent=present)
            facts.extend([row,dict(row,kind='completed',durable=True)])
        facts.append(dict(expected,kind='flush',sequence=3,owner='owner',durable=True,terminalQuitFlush=True))
        return facts,expected

    def test_final_flush_is_after_every_completion_and_frame_is_exact(self):
        facts,expected=self.ledger()
        self.assertTrue(assert_durable(facts,expected,'3'*64)['durable'])
        for change in (lambda x:x.pop(5),lambda x:x[5].update(durable=False),
                       lambda x:x[-1].update(durable=False),lambda x:x[-1].update(sequence=2),
                       lambda x:x[4].update(nonce='prior-launch'),lambda x:x[5].update(document='old'),
                       lambda x:x[5].update(generation=2),lambda x:x[4].update(bPresent=False)):
            value=copy.deepcopy(facts);change(value)
            with self.assertRaises(ValueError):assert_durable(value,expected,'3'*64)
        value=copy.deepcopy(facts);value.insert(5,value.pop())
        with self.assertRaises(ValueError):assert_durable(value,expected,'3'*64)

    def test_unknown_or_foreign_cleanup_cannot_signal_or_claim_success(self):
        owner=RecoveryLaunch.__new__(RecoveryLaunch)
        owner.closed=False;owner.identity=None;owner.engine_pid=None;owner.log=None
        with patch('storage_q1.subprocess.run') as run:
            self.assertFalse(owner.cleanup()['known']);run.assert_not_called()
        owner.identity=dict(pid=17,launch_time=2);owner.engine_pid=18
        owner.commands=[];owner.guard=Mock(side_effect=ValueError('foreign app incarnation'))
        with patch('storage_q1.subprocess.run') as run:
            result=owner.cleanup();self.assertFalse(result['known']);self.assertFalse(result['stopped'])
            run.assert_not_called()


class Q1CompositionControls(unittest.TestCase):
    def composition(self, fault):
        """Run the maintained composition/launch/cleanup against inert I/O ports."""
        temporary = tempfile.TemporaryDirectory(prefix='nac-all349-q1-')
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name).resolve()
        bundle = root / 'Q1.app'
        resources = bundle / 'Contents/Resources'; resources.mkdir(parents=True)
        binary = bundle / 'Contents/MacOS/NACPreview'; binary.parent.mkdir()
        binary.write_bytes(b'inert native')
        (resources / 'nac-web').write_bytes(b'inert engine')
        observer = root / 'observer'; observer.write_bytes(b'inert observer')
        source = 'a' * 40
        receipt = dict(source_head=source, engine_identity=dict(source_revision=source),
                       lifecycle_smoke_instrumentation=True, normal_startup=True,
                       engine_sha256=q1.digest(resources / 'nac-web'), native_sha256=q1.digest(binary))
        (resources / 'build-receipt.json').write_text(json.dumps(receipt))
        destination = root / 'summary.json'
        admission = dict(root=str(root), bundle=str(bundle), source_head=source,
                         observer_sha256=q1.digest(observer), seconds=600, exclusive_actor=True,
                         only_q1_actions=True, native_baseline=None, native_baseline_evidence='inert absent checkpoint')
        clock = [10.0]
        state = dict(launches=[], current=None, requests=[], signals=[], console=[], stopped=0, snapshot_calls=0, configurations=[])
        store = root / 'store.db'
        profile = 'b' * 64
        stable = dict(owner='desktop-' + profile, profile=profile, organization='local',
                      host='local', store=profile, track='dev')

        def request(endpoint, path, body=None, **_kwargs):
            state['requests'].append((path, body))
            if path == '/store':
                return dict(store_path=str(store))
            if path == '/model-configs':
                if body is not None:
                    store.touch(exist_ok=True)
                    state['configurations'] = [dict(config_id='saved-q1', name=body['name'],
                        backend=body['backend'], model=body['model'], base_url=body['base_url'],
                        allow_insecure_http=False, api_key_env='exact-private-selector')]
                    return state['configurations'][0]
                return dict(configurations=state['configurations'])
            if path == '/projects':
                with closing(sqlite3.connect(store)) as db, db:
                    db.execute('CREATE TABLE sessions(session_id TEXT PRIMARY KEY, behavior TEXT, run_count INTEGER, '
                               'messages_json TEXT, permission_approval_revision INTEGER)')
                    for table in TABLES: db.execute('CREATE TABLE ' + table + '(session_id TEXT)')
                return dict(project_id='project')
            if path == '/sessions':
                count = sum(path == '/sessions' for path, _ in state['requests'])
                session = str(uuid.UUID(int=count))
                with closing(sqlite3.connect(store)) as db, db:
                    db.execute('INSERT INTO sessions VALUES (?,"direct",0,"[]",0)', [session])
                return dict(metadata=dict(session_id=session, api_key_env=body['api_key_env']))
            raise AssertionError('Unexpected API action: ' + path)

        def pump(owner=None):
            current = state['current']
            if current is None: return
            control, output, record = current['control'], current['output'], current['record']
            if (control / 'profile-open-release').exists():
                record['profile_open_pending'] = False; record['bridge']['ready'] = True
            plan_path = control / 'storage-q1.json'
            if plan_path.exists():
                plan = json.loads(plan_path.read_text())
                if 'expected' not in current:
                    current['expected'] = q1.frame(record, plan['nonce'])
                if fault == 'native-guard-rejection' and (control / 'storage-q1-seed').exists():
                    record['storage_q1'] = dict(phase='seed', status='failed',
                                               error='Q1 fixture lost its ready binding')
                elif any((control / ('storage-q1-' + phase)).exists() for phase in ('seed', 'restore')):
                    phase = 'seed' if current['number'] == 1 else 'restore'
                    record['storage_q1'] = dict(status='ui-passed-awaiting-durability', binding=stable, phase=phase)
                    directory = root / 'home/Library/Application Support/NAC/Presentation/dev' / profile
                    directory.mkdir(parents=True, exist_ok=True)
                    for part in [directory, *directory.parents]:
                        if part.is_relative_to(root): part.chmod(0o700)
                    binding = [stable[k] for k in ('owner', 'profile', 'organization', 'host', 'store', 'track')]
                    key = 'nac:prompt-drafts:v2:' + json.dumps(binding, separators=(',', ':'))
                    draft = json.dumps(dict(version=2, binding=binding, drafts=[[plan['a'], plan['aText']]]))
                    raw = json.dumps(dict(version=1, profile=profile,
                        values=dict(preferences={'nac.sidebar.open':'0'}, drafts={key:draft}))).encode()
                    checkpoint = directory / 'checkpoint.json'; checkpoint.write_bytes(raw); checkpoint.chmod(0o600)
                    final_sha = q1.digest(checkpoint)
                    ledger = []
                    for sequence, present in [(1, phase == 'seed'), (2, False)]:
                        fact = dict(current['expected'], kind='accepted', owner='owner-' + str(current['number']),
                                    sequence=sequence, writeClass='ordinary', namespace='drafts', bPresent=present,
                                    checkpointSHA256=final_sha if sequence == 2 else '1'*64)
                        ledger.extend([fact, dict(fact, kind='completed', durable=True)])
                    record['storage_q1_native_writes'] = ledger
            if (control / 'capture').exists():
                record['document'] = dict(requests=[dict(method='GET', path='/sessions/a', status=200)],
                    fetch=dict(version=1, nonce=current['fetch_nonce'], provider=current['fetch_provider'],
                        selector=json.loads((control / 'storage-q1-fetch.json').read_text())['selector'],
                        engineOrigin=record['endpoint'], started=1, settled=1, errors=0, cancelled=0, active=0, overflow=False,
                        document=record['bridge']['binding'], rows=[dict(sequence=1, method='GET',
                            origin=record['endpoint'], path='/sessions/a', state='settled', status=200,
                            error=False, metadata=None, cancellation=None)]))
            if (control / 'stop').exists():
                if not current['stopped']:
                    current['stopped'] = True; state['stopped'] += 1
                record.update(engine_reaped=fault != 'unknown-cleanup', identity_retired=True,
                              workspace_released=True, engine_pid=0)
                if record.get('storage_q1_native_writes'):
                    record['storage_q1_native_writes'].append(dict(current['expected'], kind='flush',
                        owner='owner-' + str(current['number']), sequence=2, durable=True, terminalQuitFlush=True))
            output.write_text(json.dumps(record))

        class LaunchHelper:
            def __init__(self, command, **_kwargs):
                if command[:2] != ['/usr/bin/open', '-a']:
                    raise AssertionError('Unexpected process')
                number = len(state['launches']) + 1
                output = Path(command[command.index('--recovery-output') + 1])
                control = Path(command[command.index('--recovery-control') + 1])
                identity = dict(pid=100+number, launch_time=number, bundle='inert')
                record = dict(app_pid=identity['pid'], engine_pid=200+number, profile_open_pending=True,
                    endpoint='http://127.0.0.1:' + str(12000+number),
                    bridge=dict(ready=False, binding=dict(launch='launch-'+str(number),
                                view='view-'+str(number), document='doc-'+str(number))),
                    recovery=dict(generation=3), profile_storage=dict(profile=profile,
                                website_store='persistent-uuid', available=True, persistent=True, selected=True))
                current = dict(number=number, output=output, control=control, record=record,
                               identity=identity, stopped=False, observations=0,
                               fetch_nonce=command[command.index('--storage-q1-fetch-nonce')+1],
                               fetch_provider=command[command.index('--storage-q1-fetch-provider')+1])
                state['current'] = current; state['launches'].append(current)
                output.write_text(json.dumps(record))

            def wait(self, **_kwargs): return 0
            def poll(self): return 0
            def terminate(self): state['signals'].append('terminate-helper')

        def check_output(command, **kwargs):
            if command == ['git', 'rev-parse', 'HEAD']: return source
            if command == ['git', 'status', '--porcelain=v1']: return ''
            if command[:2] != [str(observer), 'state']:
                raise AssertionError('Unexpected observation: ' + str(command))
            pump()
            current = state['current']
            if current is None or current['stopped']:
                value = dict(apps=[], frontmost=None)
            else:
                current['observations'] += 1
                identity = current['identity']
                drift = fault in ('observer-drift', 'identity-drift') and current['observations'] >= 2
                value = dict(apps=[dict(identity, pid=999)] if drift and fault == 'identity-drift' else [identity],
                             frontmost=dict(identity, pid=999) if drift else identity)
            return json.dumps(value).encode()

        original_snapshot = q1.sqlite_snapshot
        def snapshot(*args):
            value = original_snapshot(*args)
            state['snapshot_calls'] += 1
            # Advance only after the first Stop/reap, disk/ledger reduction and
            # post-Quit SQL read have succeeded. The next launch must still use
            # ORIGINAL action deadline490, not a fresh now+duration deadline.
            if fault == 'expired-action' and state['snapshot_calls'] == 3:
                clock[0] = 490.0
            return value

        original_read = RecoveryLaunch.read
        def read(owner):
            pump(owner)
            return original_read(owner)

        def run(command, **_kwargs):
            if command[:3] != ['/usr/bin/git', 'init', '--quiet']:
                raise AssertionError('Unexpected process action: ' + str(command))
            return SimpleNamespace(returncode=0)

        result, error = None, None
        with ExitStack() as patches:
            patches.enter_context(patch('quit_fixture.ThreadingHTTPServer', provider_doubles.InertServer))
            patches.enter_context(patch('quit_fixture.threading.Thread', provider_doubles.InertThread))
            patches.enter_context(patch('storage_q1.subprocess.Popen', LaunchHelper))
            patches.enter_context(patch('storage_q1.subprocess.check_output', check_output))
            patches.enter_context(patch('storage_q1.subprocess.run', run))
            patches.enter_context(patch('storage_q1.require_console', lambda *args: state['console'].append(args[-1])))
            patches.enter_context(patch('storage_q1.engine_settled', lambda *args: state['current']['stopped']))
            patches.enter_context(patch('storage_q1.request', request))
            patches.enter_context(patch('storage_q1.sqlite_snapshot', snapshot))
            patches.enter_context(patch('storage_q1.time.monotonic', lambda: clock[0]))
            patches.enter_context(patch.object(RecoveryLaunch, 'read', read))
            patches.enter_context(patch('socket.socket', side_effect=AssertionError('Live socket forbidden')))
            try:
                result = q1.run_contract(bundle, observer, root, destination, admission)
            except Exception as caught:
                error = caught
        report = json.loads(destination.read_text())
        self.assertEqual(state['signals'], [])
        self.assertEqual(sum(path == '/projects' for path, _ in state['requests']), 1 if state['requests'] else 0)
        self.assertFalse(any('/runs' in path or '/goal' in path or '/permissions' in path for path, _ in state['requests']))
        return result, error, report, state

    def test_whole_composition_two_launch_positive_control(self):
        result, error, report, state = self.composition('none')
        self.assertIsNone(error)
        self.assertTrue(result['passed']); self.assertTrue(report['new_observed_port'])
        self.assertEqual(len(state['launches']), 2)
        self.assertTrue(all(item['known'] and item['stopped'] for item in report['cleanup']))
        self.assertEqual(sum(path == '/sessions' for path, _ in state['requests']), 2)

    def test_whole_composition_observer_or_identity_drift_fails_closed(self):
        for fault in ('observer-drift', 'identity-drift'):
            with self.subTest(fault=fault):
                result, error, report, state = self.composition(fault)
                self.assertIsNone(result); self.assertIsInstance(error, ValueError)
                self.assertIn('custody changed', str(error))
                self.assertFalse(report['passed']); self.assertFalse(report['cleanup'][0]['known'])
                self.assertEqual(len(state['launches']), 1)
                self.assertEqual(state['requests'], [])

    def test_whole_composition_expired_original_action_deadline_never_relaunches(self):
        result, error, report, state = self.composition('expired-action')
        self.assertIsNone(result); self.assertIsInstance(error, TimeoutError)
        self.assertFalse(report['passed']); self.assertEqual(len(state['launches']), 1)
        self.assertTrue(report['cleanup'][0]['known'])
        self.assertEqual(state['snapshot_calls'], 3)
        self.assertEqual(len(report['launches']), 1)
        self.assertTrue(report['launches'][0]['durable']['durable'])
        self.assertFalse(report['rerun_authorized'])

    def test_whole_composition_unknown_reap_keeps_failure_and_original_root(self):
        result, error, report, state = self.composition('unknown-cleanup')
        self.assertIsNone(result); self.assertIsInstance(error, ValueError)
        self.assertIn('unknown cleanup', str(error))
        self.assertFalse(report['passed']); self.assertFalse(report['cleanup'][0]['known'])
        self.assertEqual(report['retained_fixture'], str(Path(report['root'])))
        self.assertEqual(len(state['launches']), 1)

    def test_whole_composition_native_guard_rejection_fails_without_polling_or_retry(self):
        with patch('storage_q1.time.sleep', side_effect=AssertionError('Rejected control was polled again')):
            result, error, report, state = self.composition('native-guard-rejection')
        self.assertIsNone(result); self.assertIsInstance(error, ValueError)
        self.assertIn('Q1 native phase rejected: Q1 fixture lost its ready binding', str(error))
        self.assertFalse(report['passed']); self.assertEqual(len(state['launches']), 1)
        self.assertTrue(report['cleanup'][0]['known']); self.assertTrue(report['cleanup'][0]['stopped'])
        self.assertFalse(report['rerun_authorized'])


if __name__ == '__main__': unittest.main()
