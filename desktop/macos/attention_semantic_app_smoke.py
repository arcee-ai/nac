#!/usr/bin/env python3
"""Real producer -> one native observer semantic matrix; separately admitted.

Inert on import. This does not replay Q2's chat/Quit criteria or claim exact
native Idle-publication/crash/ACK timing. All controls retain existing custody.
"""
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True
import attention_app_smoke as attention_owner
from attention_app_smoke import AttentionJourney
from attention_feed_build import source_binding
from attention_fixture_control import console_facts, require_console
from attention_semantic_fixture import BEHAVIORS, MARKER, SemanticProvider
from instance_contract import digest
from attention_reset_readout import ResetReadout
from attention_fixture_cleanup import cleanup_fixture, write_input
from instance_smoke import verify_embedded_assets


def audit_matches(items, expected):
    """Exact identities, ordering and mark version, never count-only success."""
    assert len(items) == len(expected)
    identities = set()
    stores = set()
    generations = set()
    previous_unread = -1
    for item, want in zip(items, expected):
        assert set(item) == {'store', 'sequence', 'session', 'run', 'behavior', 'kind', 'goal', 'mark_version',
                             'native_generation', 'transport_generation', 'accepted_frontier', 'unread'}
        stores.add(item['store'])
        generations.add(item['native_generation'])
        assert type(item['unread']) is int and item['unread'] > previous_unread
        previous_unread = item['unread']
        for key in ('store', 'session', 'run', 'behavior', 'kind', 'goal', 'mark_version'):
            assert item[key] == want[key], (key, item, want)
        if 'sequence' in want:
            assert item['sequence'] == want['sequence']
        identity = item['store'] + ':' + str(item['sequence'])
        assert identity not in identities and item['accepted_frontier'] == identity
        identities.add(identity)
        assert type(item['sequence']) is int and item['sequence'] > 0
        assert type(item['native_generation']) is int and type(item['transport_generation']) is int
    assert len(stores) <= 1 and len(generations) <= 1
    assert [item['sequence'] for item in items] == sorted(item['sequence'] for item in items)


def backup(store, destination, expected):
    """Only AFTER exact engine exit: read-only source and immutable artifact."""
    assert not store.is_symlink()
    with sqlite3.connect(store.as_uri() + '?mode=ro', uri=True) as source, sqlite3.connect(destination) as target:
        source.backup(target)
    with sqlite3.connect(destination.as_uri() + '?mode=ro&immutable=1', uri=True) as db:
        db.execute('PRAGMA query_only=ON')
        assert db.execute('PRAGMA quick_check').fetchall() == [('ok',)]
        db.row_factory = sqlite3.Row
        rows = [dict(row) for row in db.execute('SELECT * FROM session_completion_occurrences ORDER BY sequence')]
        counts = {table: db.execute('SELECT count(*) FROM ' + table).fetchone()[0]
                  for table in ('sessions', 'session_goals', 'session_run_outcomes')}
        assert counts == dict(sessions=8, session_goals=2, session_run_outcomes=10), counts
        assert len(rows) == len(expected) == 10
        feed_store = db.execute('SELECT store_id FROM session_completion_feed WHERE singleton=1').fetchone()[0]
        assert all(want['store'] == feed_store for want in expected)
        for row, want in zip(rows, expected):
            if 'sequence' in want:
                assert row['sequence'] == want['sequence']
            for column, key in [('session_id', 'session'), ('run_id', 'run'), ('behavior', 'behavior'),
                                ('kind', 'kind'), ('goal_id', 'goal'), ('mark_version', 'mark_version')]:
                assert row[column] == want[key], (row, want)
        assert sum(row['kind'] == 'goal' for row in rows) == 2
        assert sum(row['kind'] == 'request' for row in rows) == 8
        assert db.execute("SELECT count(*) FROM session_run_outcomes WHERE disposition='completed'").fetchone()[0] == 10
        assert db.execute("SELECT count(*) FROM session_goals WHERE status='complete'").fetchone()[0] == 2
        return dict(store=feed_store, rows=rows, counts=counts, sha256=digest(destination))


def deliveries_match(state, expected):
    audit = state['attention']['accepted_items']
    audit_matches(audit, expected)
    deliveries = state['center']['deliveries']
    assert len(deliveries) == state['center']['adds'] == len(expected)
    identifiers = set()
    for delivery, item in zip(deliveries, audit):
        assert set(delivery) == {'session', 'occurrence', 'identifier', 'title'}
        assert delivery['session'] == item['session']
        assert delivery['occurrence'] == item['store'] + ':' + str(item['sequence'])
        assert delivery['title'] == ('Goal completed' if item['kind'] == 'goal' else 'Request completed')
        identifier = delivery['identifier']
        assert identifier.startswith('nac-attention-') and len(identifier) == len('nac-attention-') + 64
        assert all(c in '0123456789abcdef' for c in identifier[len('nac-attention-'):])
        assert identifier not in identifiers
        identifiers.add(identifier)


def run_contract(bundle, destination, observer, source_ref):
    binding = source_binding(Path(__file__).resolve().parents[2], source_ref)
    require_console(console_facts())
    bundle, destination, observer = (Path(value).resolve() for value in (bundle, destination, observer))
    destination.mkdir(mode=0o700, parents=False, exist_ok=False)
    build = json.loads((bundle / 'Contents/Resources/build-receipt.json').read_text())
    assert build['source_head'] == source_ref == build['engine_identity']['source_revision']
    assert build['source_dirty'] is False and build['attention_smoke_instrumentation'] and build['normal_startup']
    assert build['native_sha256'] == digest(bundle / 'Contents/MacOS/NACPreview')
    assert build['engine_sha256'] == digest(bundle / 'Contents/Resources/nac-web')
    for path, expected_hash in build['native_source_files'].items():
        assert digest(path) == expected_hash
    root = Path(tempfile.mkdtemp(prefix='nac-attention-app-semantic-', dir=destination)).resolve()
    owned = ResetReadout(root)
    try:
        profile = root / 'profile'
        profile.mkdir(mode=0o700)
        (profile / 'semantic-marker.txt').write_text(MARKER + '\n')
        moved = root / 'Relocated app with spaces' / bundle.name
        shutil.copytree(bundle, moved)
        store = profile / 'selected store.db'
        journeys = []
        provider = None
        sequence = 0
        evidence = dict(source_binding=binding, build_receipt=build, actual_local_app=True,
                        system_wk=True, native_os_delivery=False, trusted_input=False,
                        hidden_cpu_qualified=False, cases=[], expected=[])

    except BaseException:
        owned.close()
        raise
    def save(name, value):
        (destination / name).write_text(json.dumps(value, indent=2) + '\n')

    def http(endpoint, path, body=None):
        result = attention_owner.request(endpoint, path, body)
        with (destination / 'canonical-http.jsonl').open('a') as output:
            output.write(json.dumps(dict(epoch=time.time(), endpoint=endpoint, method='POST' if body is not None else 'GET',
                                         path=path, body=body, response=result)) + '\n')
        return result

    def command(journey, action):
        nonlocal sequence
        sequence += 1
        name = f'attention-{sequence:04d}'
        journey.custody.publish(journey, name, action)
        return None if action == 'finish' else journey.stage(name)

    def native(journey, predicate, label):
        def poll():
            journey.custody.check(journey)
            state = journey.read()
            attention = state['attention']
            assert not attention['audit_overflow'] and attention['observer_connections'] <= 1
            return state if predicate(state) else None
        result = attention_owner.wait_for(label, poll, timeout=20)
        with (destination / 'native-checkpoints.jsonl').open('a') as output:
            output.write(json.dumps(dict(epoch=time.time(), label=label, state=result)) + '\n')
        return result

    def quiescent(state):
        a = state['attention']
        return not a['saving'] and not a['work_pending'] and a['receipts'] == 0

    def finish(journey):
        pid = journey.read()['engine_pid']
        command(journey, 'finish')
        stopped = attention_owner.wait_for('Native semantic Stop', lambda: (s if (s := journey.read()).get('stopped') else None), timeout=28)
        assert stopped['passed'] and stopped['center']['retired']
        assert stopped['attention']['observer_connections'] == stopped['attention']['observer_draining'] == 0
        attention_owner.wait_for('Exact native app exited', lambda: not journey.observe()['apps'], timeout=10)
        attention_owner.wait_for('Exact native engine exited', lambda: attention_owner.engine_settled(moved, pid), timeout=25)
        return stopped

    def expected(session, run, behavior, goal=None, mark=None):
        return dict(store=store_id, session=session, run=run, behavior=behavior, kind='goal' if goal else 'request',
                    goal=goal, mark_version=mark)

    try:
        provider = SemanticProvider(profile, destination / 'provider.jsonl')
        environment = dict(HOME=str(profile), NAC_HOME=str(profile / 'nac-home'),
            PATH='/usr/bin:/bin:/usr/sbin:/sbin', LANG='en_US.UTF-8', BROWSER='none',
            NAC_TELEMETRY='disabled', NAC_ORCHESTRATION='0', GIT_CONFIG_NOSYSTEM='1',
            GIT_CONFIG_GLOBAL='/dev/null', MODELS_DEV_URL=provider.endpoint + '/models-dev',
            OPENAI_API_KEY='attention-semantic-dummy-only')
        subprocess.run(['/usr/bin/git', 'init', '--quiet', '--initial-branch=main', str(profile)],
                       env=environment, check=True, timeout=5)
        for name in ('first', 'second'):
            (destination / name).mkdir()
        first = AttentionJourney(moved, destination / 'first/native.json', profile, environment, store, observer)
        journeys.append(first)
        first.launch()
        ready = first.stage('ready')
        write_input(owned, dict(receipt=ready['ready_receipt'], home=str(profile)))
        endpoint = ready['base_url'].rstrip('/')
        evidence['embedded_assets'] = verify_embedded_assets(endpoint)
        command(first, 'enable')
        enabled = native(first, lambda s: quiescent(s) and s['attention']['enabled'] and bool(s['attention']['cutoff']), 'Enabled durable cutoff')
        store_id = enabled['attention']['cutoff'].split(':')[0]
        command(first, 'close')
        assert not first.read()['window_visible']
        project = http(endpoint, '/projects', dict(name='Semantic native matrix', cwd=str(profile)))['project_id']

        def session(behavior):
            row = http(endpoint, '/sessions', dict(behavior=behavior, project_id=project,
                       model='gpt-5.6-sol', backend='openai-responses', base_url=provider.endpoint,
                       api_key_env='OPENAI_API_KEY'))['metadata']
            assert row['behavior'] == behavior
            return row['session_id']

        def request_case(behavior, label):
            token = 'SEMANTIC_' + label + '_' + behavior
            provider.protocol.register(token)
            sid = session(behavior)
            run = http(endpoint, '/sessions/' + sid + '/runs', dict(prompt=token))['run_id']
            provider.entered(token)
            evidence['expected'].append(expected(sid, run, behavior))
            return sid, run

        for behavior in BEHAVIORS:
            request_case(behavior, 'FIRST')
            count = len(evidence['expected'])
            state = native(first, lambda s: quiescent(s) and s['attention']['unread'] == count
                           and len(s['attention']['accepted_items']) == count and s['center']['adds'] == count,
                           'Actual request completion ' + behavior)
            deliveries_match(state, evidence['expected'])
        evidence['cases'].append('three-real-behavior-requests')

        for behavior in BEHAVIORS[1:]:
            sid = session(behavior)
            token = 'SEMANTIC_GOAL_' + behavior
            queued = 'SEMANTIC_QUEUE_' + behavior
            provider.protocol.register(token, 'goal')
            provider.protocol.register(queued, 'queue', parent=token)
            goal = http(endpoint, '/sessions/' + sid + '/goal', dict(objective=token + ': read semantic-marker.txt before completing.'))
            provider.entered(token)
            active_goal = http(endpoint, '/sessions/' + sid + '/goal')
            run_a = active_goal['accounting_run_id']
            assert run_a and active_goal['goal_id'] == goal['goal_id']
            provider.protocol.bind_goal(token, goal['goal_id'], run_a)
            inbox = http(endpoint, '/sessions/' + sid + '/inbox', dict(delivery='queue', prompt=queued))
            assert inbox['delivery'] == 'queue'
            provider.release(token + ':allow-read')
            provider.entered(token, 2)
            mark = provider.protocol.marks[token]
            before = first.read()
            assert before['attention']['unread'] == len(evidence['expected']), 'Mark before terminal cannot account completion'
            assert http(endpoint, '/sessions/' + sid + '/goal')['status'] == 'complete'
            save('mark-' + behavior + '.json', dict(goal=goal, accounting=active_goal, mark=mark, before_terminal=before, inbox=inbox))
            provider.release(token + ':final-tail')
            provider.entered(queued)
            b = http(endpoint, '/sessions/' + sid + '?include_sessions=false&message_limit=1')['active_run']['run_id']
            assert b != run_a
            evidence['expected'].append(expected(sid, run_a, behavior, goal['goal_id'], mark['version']))
            count = len(evidence['expected'])
            state = native(first, lambda s: quiescent(s) and s['attention']['unread'] == count
                           and s['center']['adds'] == count, 'Exact goal A while B active ' + behavior)
            assert http(endpoint, '/sessions/' + sid + '?include_sessions=false&message_limit=1')['active_run']['run_id'] == b
            deliveries_match(state, evidence['expected'])
            provider.release(queued + ':finish-B')
            evidence['expected'].append(expected(sid, b, behavior))
            count = len(evidence['expected'])
            state = native(first, lambda s: quiescent(s) and s['attention']['unread'] == count
                           and s['center']['adds'] == count, 'Distinct queued B request ' + behavior)
            deliveries_match(state, evidence['expected'])
        evidence['cases'].append('both-direct-goals-account-before-unrelated-B-finishes')

        settled = native(first, lambda s: quiescent(s) and s['attention']['unread'] == 7, 'First seven settled')
        saved = {key: settled['attention'][key] for key in ('enabled', 'cutoff', 'frontier', 'unread')}
        command(first, 'pause-observation')
        paused = native(first, lambda s: s['attention']['observation_paused'] and quiescent(s)
                        and s['attention']['observer_connections'] == s['attention']['observer_draining'] == 0,
                        'Single observation retired without preference mutation')
        assert {key: paused['attention'][key] for key in saved} == saved
        for behavior in BEHAVIORS:
            sid, run = request_case(behavior, 'OFFLINE')
            attention_owner.wait_for('Offline canonical successful result', lambda: not http(endpoint, '/sessions/' + sid + '?include_sessions=false&message_limit=1').get('active_run'), timeout=20)
        unchanged = first.read()
        assert {key: unchanged['attention'][key] for key in saved} == saved
        assert len(unchanged['attention']['accepted_items']) == 7 and unchanged['center']['adds'] == 7
        evidence['cases'].append('three-real-offline-outcomes-not-accounted-until-cold')
        finish(first)
        evidence['first_store'] = backup(store, destination / 'canonical-first.sqlite', evidence['expected'])
        for want, row in zip(evidence['expected'], evidence['first_store']['rows']):
            want['sequence'] = row['sequence']
        audit_matches(settled['attention']['accepted_items'], evidence['expected'][:7])

        second = AttentionJourney(moved, destination / 'second/native.json', profile, environment, store, observer)
        journeys.append(second)
        second.launch()
        second.stage('ready')
        caught = native(second, lambda s: quiescent(s) and s['attention']['unread'] == 10
                        and len(s['attention']['accepted_items']) == 3, 'Cold sole-observer catch-up of exact offline three')
        audit_matches(caught['attention']['accepted_items'], evidence['expected'][-3:])
        assert caught['attention']['cutoff'] == saved['cutoff'] and caught['attention']['enabled']
        assert caught['center']['adds'] == caught['center']['permission_requests'] == 0
        command(second, 'pause-observation')
        native(second, lambda s: s['attention']['observer_connections'] == s['attention']['observer_draining'] == 0,
               'Cold observer retired before repeat')
        command(second, 'resume-observation')
        repeated = native(second, lambda s: quiescent(s) and s['attention']['observer_connections'] == 1
                          and s['attention']['projection_available'], 'Same frontier resubscribed')
        audit_matches(repeated['attention']['accepted_items'], evidence['expected'][-3:])
        assert repeated['attention']['unread'] == 10 and repeated['attention']['frontier'] == caught['attention']['frontier']
        assert repeated['center']['adds'] == 0
        finish(second)
        evidence['second_store'] = backup(store, destination / 'canonical-second.sqlite', evidence['expected'])
        assert len(provider.requests) == 14 and not provider.errors
        evidence['cases'].append('cold-three-accounted-once-and-resubscribe-no-duplicates')
        evidence['passed'] = True
    except BaseException as error:
        evidence.update(passed=False, error=repr(error), fixture_retained=str(root))
        raise
    finally:
        try:
            errors = []
            for journey in reversed(journeys):
                try:
                    if journey.observe()['apps']:
                        sequence += 1
                        journey.custody.cleanup(journey, f'attention-{sequence:04d}')
                        attention_owner.wait_for('Semantic failure cleanup app exit', lambda: not journey.observe()['apps'], timeout=28)
                    assert journey.engine_pid is not None
                    attention_owner.wait_for('Semantic failure exact engine exit', lambda: attention_owner.engine_settled(moved, journey.engine_pid), timeout=25)
                except BaseException as error:
                    errors.append(repr(error))
                finally:
                    journey.custody.close()
                    journey.log.close()
            if provider:
                try:
                    provider.close()
                    evidence['model_request_count'] = len(provider.requests)
                    evidence['provider_errors'] = provider.errors
                    assert not provider.errors, provider.errors
                except BaseException as error:
                    errors.append('Provider cleanup: ' + repr(error))
            if not errors:
                try:
                    evidence['website_cleanup'] = cleanup_fixture(
                        owned, observer.parent / 'AttentionFixtureCleanup', environment, destination)
                    evidence['private_root_removed'] = True
                except BaseException as error:
                    errors.append('Exact website/profile cleanup: ' + repr(error))
            evidence['cleanup_errors'] = errors
            if errors:
                evidence['passed'] = False
            try:
                assert source_binding(Path(__file__).resolve().parents[2], source_ref) == binding
            except BaseException as error:
                evidence['passed'] = False
                errors.append('Source changed: ' + repr(error))
            save('summary.json', evidence)
            assert not errors, errors
        finally:
            owned.close()



if __name__ == '__main__':
    assert len(sys.argv) == 5, 'APP OUTPUT INSTANCE_OBSERVER FULL_SOURCE_REF'
    run_contract(*sys.argv[1:])
