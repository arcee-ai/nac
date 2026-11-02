"""Synthetic T34 receipts only; no app, engine, SDK or native qualification."""
import ast
import base64
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from ci_instance_capture_contract import (APP_FIELDS, CASES, KEYS, MAX_RECORD, PUBLIC_FIELDS,
    RESOURCE_FIELDS, STATE_FIELDS, TARGET, build_resource, decode, digest, encoded, frames,
    path_text, private_frame, require_resource, semantic_receipts)

# A real 1x1 PNG fixture. Signature/hash checks deliberately do not decode it.
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==')
FIXED_KEYS = (
    'simultaneous/workspace', 'simultaneous/reopened', 'cli/conflict', 'cli/retry-workspace',
    'symlink/conflict', 'symlink/retry-workspace', 'directory-symlink/conflict', 'directory-symlink/retry-workspace',
    'crash/conflict', 'crash/retry-workspace', 'shutdown/conflict', 'shutdown/retry-workspace',
    'app-crash/initial/workspace', 'app-crash/replacement/workspace', 'app-crash/replacement/reopened',
    'coexist/dev/workspace', 'coexist/stable/workspace', 'coexist/stable/reopened', 'coexist/dev/reopened')


class SyntheticRun:
    """Retained file bytes with real T34 shapes; all provenance is synthetic."""
    def __init__(self):
        self.nonce = '1' * 32
        self.preparation = '2' * 32
        self.root = '/private/nonexistent-343-fixture/nac-instance-app-' + self.preparation
        self.manifest = dict(schema='nac343-capture-manifest-v1', run_nonce=self.nonce,
                             target_sha=TARGET, harness_sha='a' * 40, frames=frames())
        self.manifest_raw = encoded(self.manifest)
        identity = dict(device='1', inode='2', mode='448', size='1', mtime_ns='1')
        self.prepared = dict(schema='nac343-prepared-fixture-v1', run_nonce=self.nonce,
            preparation_nonce=self.preparation, manifest_sha256=digest(self.manifest_raw), target_sha=TARGET,
            harness_sha='a' * 40, state='prepared-files-only', source_files={'instance_capture.py': 'b' * 64},
            observer=dict(path='/private/nonexistent-observer', identity=identity, sha256='c' * 64),
            apps=[], destination=dict(path='/private/nonexistent-343-fixture', identity=identity),
            root=dict(path=self.root, identity=identity))
        for index, track in enumerate(('dev', 'stable')):
            moved = self.root + '/Moved app with spaces %d/NAC Instance Smoke.app' % index
            source = '/private/nonexistent-build-' + track + '/NAC Instance Smoke.app'
            def bundle(path):
                return dict(path=path, tree=dict(root=identity, entries={}), summary=dict(path=path,
                    identity=dict(product_version='0.1.0', build_id='synthetic-' + track,
                                  source_revision=TARGET, track=track),
                    bundle_id=('ai.arcee.nac.dev' if track == 'dev' else 'ai.arcee.nac') + '.instance-smoke',
                    native_sha256=('d' if track == 'dev' else 'e') * 64, engine_sha256='f' * 64))
            self.prepared['apps'].append(dict(track=track, source=bundle(source), moved=bundle(moved)))
        self.prepared_raw = encoded(self.prepared)
        self.pins = dict(target_sha=TARGET, harness_sha='a' * 40, manifest_sha256=digest(self.manifest_raw),
                         prepared_sha256=digest(self.prepared_raw))
        self.resource_raw = build_resource(self.manifest_raw, self.prepared_raw, self.pins)
        self.resource = require_resource(self.resource_raw, self.pins)
        self.records, self.phases = [], []
        episodes = {}
        for frame in frames():
            journey = frame['key'].rsplit('/', 1)[0]
            if journey not in episodes:
                episodes[journey] = len(episodes) + 1
            number = episodes[journey]
            app = self.resource['apps'][1 if frame['track'] == 'stable' else 0]
            profile = self.root + '/profile-' + journey.replace('/', '-')
            context = dict(root=profile, store=profile + '/store.db', bundle=app['bundle_path'],
                track=frame['track'], journey=journey, native_sha256=app['native_sha256'], engine_sha256=app['engine_sha256'])
            config = dict(schema='nac343-capture-config-v1', run_nonce=self.nonce,
                manifest_sha256=digest(self.manifest_raw), target_sha=TARGET, harness_sha='a' * 40, context=context,
                frames=[dict(ordinal=i, key=k) for i, k in enumerate(FIXED_KEYS, 1) if k.rsplit('/', 1)[0] == journey])
            config_raw = encoded(config)
            state = dict.fromkeys(STATE_FIELDS, '')
            state.update({k: context[k] for k in ('root', 'store', 'bundle', 'track')})
            state.update(app_pid=str(100 + number), window_number=str(200 + number),
                app_incarnation='00000000-0000-4000-8000-%012d' % number, app_launch_epoch=str(1000 + number) + '.0',
                engine_pid='0' if frame['key'].endswith('/conflict') else str(300 + number),
                reopen_count='1' if frame['key'].endswith('/reopened') else '0', loading='false',
                window_frame='{{0, 0}, {1, 1}}', content_bounds='{{0, 0}, {1, 1}}')
            request = dict(schema='nac343-capture-request-v1', run_nonce=self.nonce,
                request_nonce='%032x' % frame['ordinal'], ordinal=frame['ordinal'], key=frame['key'],
                configuration_sha256=digest(config_raw), manifest_sha256=digest(self.manifest_raw), before=state)
            request_raw = encoded(request)
            fence = dict(schema='nac343-private-fence-v1', **{k: request[k] for k in
                ('run_nonce', 'request_nonce', 'ordinal', 'key', 'configuration_sha256')}, request_sha256=digest(request_raw),
                release='provisional', capture_verified=False, before=state, after=state)
            phase = dict(schema='nac343-public-phase-v1', **{k: request[k] for k in
                ('run_nonce', 'request_nonce', 'ordinal', 'key', 'configuration_sha256', 'manifest_sha256')},
                request_sha256=digest(request_raw), **{k: state[k] for k in
                ('track', 'app_pid', 'app_incarnation', 'app_launch_epoch', 'window_number')})
            self.phases.append(phase)
            self.records.append(dict(configuration=config_raw, request=request_raw, fence=encoded(fence), diagnostic=PNG))
        self.summary = dict(source_head=TARGET, source_dirty=False, runtime_passed=True, full_scenario_run=True,
            actual_app_acceptance=False, instrumentation='INSTANCE_SMOKE + PREVIEW_SMOKE + LOCAL_APP',
            requested_scenarios=list(CASES), cases=[],
            capture_fixture=dict(schema='nac343-provisional-summary-v1', run_nonce=self.nonce,
                manifest_sha256=digest(self.manifest_raw), provisional_releases=19,
                capture_verified=False, final_public_pairs_required=19))
        # Preserve complete representative case bodies, including coexist's
        # reverse app order and app-crash's intentionally absent assets field.
        # This is data, never evidence that these assertions actually occurred.
        identities = {row['track']: row['moved']['summary']['identity'] for row in self.prepared['apps']}
        assets = {'index.html': 'b' * 64}
        def episode(track, store):
            return dict(passed=True, stopped=True, engine_cleanup_observed=True,
                workspace_activated=True, workspace_window_count=1, engine_identity=identities[track],
                expected_store=store, ready_store=store, same_window_reopened=True, same_engine_reopened=True)
        for name in CASES:
            store = self.root + '/' + name + '/selected store.db'
            case = dict(episode('dev', store), scenario=name, canonical_store=store, embedded_assets=assets)
            if name == 'simultaneous':
                case.update(launch_callers=2, serving_owners=1)
            elif name == 'app-crash':
                case.pop('embedded_assets')
                case.update(original_app=dict(pid=107, launch_time=1007), replacement_app=dict(pid=108, launch_time=1008),
                    original_engine_settled_after_parent_death=True, stale_discovery_ignored=True,
                    ordinary_lease_after_crash=True)
            elif name == 'coexist':
                stores = [self.root + '/coexist/' + track + '.db' for track in ('dev', 'stable')]
                case = dict(scenario=name, passed=True, stores=stores,
                    identities=[identities[track] for track in ('dev', 'stable')],
                    apps=[episode('stable', stores[1]), episode('dev', stores[0])], embedded_assets=[assets, assets])
            else:
                case.update(real_cli_pid=999, cli_survived_app_and_retry=True, schema_and_lock_unchanged=True,
                    no_alternative_store=True, live_owner_logical_records_unchanged=True,
                    workspace_not_activated_during_conflict=True, live_owner_retry_remained_conflict=True,
                    retry_loaded_same_store=True)
            self.summary['cases'].append(case)

    def evidence(self):
        return dict(manifest=self.manifest_raw, prepared=self.prepared_raw,
                    summary=encoded(self.summary), frames=copy.deepcopy(self.records))


class ResourceContractTests(unittest.TestCase):
    def setUp(self):
        self.run = SyntheticRun()

    def test_literal_t34_roster_is_nineteen_points_in_ten_episodes(self):
        self.assertEqual(KEYS, FIXED_KEYS)
        self.assertEqual(len({key.rsplit('/', 1)[0] for key in FIXED_KEYS}), 10)
        self.assertEqual([f['ordinal'] for f in self.run.manifest['frames']], list(range(1, 20)))
        self.assertEqual([f['ordinal'] for f in frames() if f['track'] == 'stable'], [17, 18])

    def test_public_projection_preserves_real_moved_spelling_and_no_private_fields(self):
        result = require_resource(self.run.resource_raw, self.run.pins)
        self.assertEqual(set(result), RESOURCE_FIELDS)
        for app in result['apps']:
            self.assertEqual(set(app), APP_FIELDS)
            self.assertIn('Moved app with spaces', app['bundle_path'])
        for forbidden in ('observer', 'source_files', 'destination', 'store', 'endpoint', 'configuration', 'release'):
            self.assertNotIn(('"' + forbidden + '"').encode(), self.run.resource_raw)
        self.assertNotIn(b'nonexistent-build', self.run.resource_raw)

    def test_projection_never_reads_or_resolves_supplied_paths(self):
        with patch('builtins.open', side_effect=AssertionError('file read')), \
                patch('os.open', side_effect=AssertionError('file read')), \
                patch('os.stat', side_effect=AssertionError('stat')), \
                patch('pathlib.Path.resolve', side_effect=AssertionError('resolve')):
            self.assertEqual(build_resource(self.run.manifest_raw, self.run.prepared_raw, self.run.pins), self.run.resource_raw)

    def test_every_independent_pin_is_required_and_frozen_by_comparison(self):
        for field in self.run.pins:
            pins = dict(self.run.pins); pins[field] = '0' * len(pins[field])
            with self.subTest(field=field), self.assertRaises(ValueError):
                build_resource(self.run.manifest_raw, self.run.prepared_raw, pins)
        for value in ('f3', True, 'A' * 40, '0' * 39):
            with self.assertRaises(ValueError): require_resource(self.run.resource_raw, dict(self.run.pins, harness_sha=value))

    def test_manifest_wrong_scope_boolean_ordinal_extra_and_reorder_fail_even_with_matching_hash(self):
        mutations = [lambda v: v['frames'].pop(), lambda v: v['frames'].reverse(),
                     lambda v: v['frames'][0].update(ordinal=True), lambda v: v.update(extra='private'),
                     lambda v: v.update(run_nonce='not-a-nonce'), lambda v: v['frames'][16].update(track='dev')]
        for mutate in mutations:
            value = copy.deepcopy(self.run.manifest); mutate(value); raw = encoded(value)
            with self.subTest(mutation=mutate), self.assertRaises(ValueError):
                build_resource(raw, self.run.prepared_raw, dict(self.run.pins, manifest_sha256=digest(raw)))

    def test_prepared_wrong_app_source_track_spelling_or_fields_fail_with_matching_hash(self):
        mutations = [lambda v: v.update(state='consumed'), lambda v: v.update(store='/secret'),
            lambda v: v['apps'].reverse(), lambda v: v['apps'][0]['moved']['summary']['identity'].update(source_revision='0' * 40),
            lambda v: v['apps'][0]['moved']['summary'].update(bundle_id='foreign'),
            lambda v: v['apps'][0]['moved'].update(path='/other/App.app'),
            lambda v: v['apps'][0]['moved']['summary'].update(extra='/secret'),
            lambda v: v['root'].update(path='/foreign')]
        for mutate in mutations:
            value = copy.deepcopy(self.run.prepared); mutate(value); raw = encoded(value)
            with self.subTest(mutation=mutate), self.assertRaises(ValueError):
                build_resource(self.run.manifest_raw, raw, dict(self.run.pins, prepared_sha256=digest(raw)))

    def test_closed_canonical_resource_rejects_mailbox_private_fields_and_aliases(self):
        for mutate in (lambda v: v.update(release='/secret'), lambda v: v['apps'][0].update(store='/secret'),
                       lambda v: v['apps'][1].update(bundle_path=v['apps'][0]['bundle_path']),
                       lambda v: v['frames'][0].update(ordinal=True)):
            value = copy.deepcopy(self.run.resource); mutate(value)
            with self.assertRaises(ValueError): require_resource(encoded(value), self.run.pins)
        with self.assertRaises(ValueError): require_resource(self.run.resource_raw + b' ', self.run.pins)

    def test_malformed_duplicate_nonfinite_oversize_and_noncanonical_paths_fail(self):
        for raw in (b'{', b'{} trailing', b'{"a":1,"a":2}', b'{"a":NaN}', b' ' * (MAX_RECORD + 1)):
            with self.subTest(raw=raw[:20]), self.assertRaises(ValueError): decode(raw)
        for path in ('relative', '/tmp/../secret', '/tmp//app', '/tmp/./app', '/tmp/app/', '/tmp/\0app'):
            self.assertFalse(path_text(path), path)
        self.assertTrue(path_text('/private/spaces here/NAC Instance Smoke.app'))


class PrivateJoinTests(unittest.TestCase):
    def setUp(self):
        self.run = SyntheticRun()

    def test_all_nineteen_original_t_shapes_join_to_exact_closed_public_phases(self):
        for frame, record, expected in zip(frames(), self.run.records, self.run.phases):
            phase, state = private_frame(record['configuration'], record['request'], record['fence'], frame, self.run.resource)
            self.assertEqual(phase, expected)
            self.assertEqual(set(phase), PUBLIC_FIELDS)
            self.assertEqual(state, decode(record['request'])['before'])

    def test_mutated_private_fences_requests_and_configurations_never_join(self):
        changes = [('request', lambda v: v.update(ordinal=True)), ('request', lambda v: v.update(request_nonce='x' * 32)),
            ('request', lambda v: v['before'].update(app_pid=True)), ('request', lambda v: v['before'].update(app_launch_epoch='nan')),
            ('request', lambda v: v['before'].update(app_incarnation='old')), ('request', lambda v: v['before'].update(window_number='0')),
            ('request', lambda v: v['before'].update(store='/foreign')),
            ('configuration', lambda v: v['context'].update(track='stable')),
            ('configuration', lambda v: v['context'].update(root='/foreign', store='/foreign/store.db')),
            ('configuration', lambda v: v['frames'].reverse()), ('fence', lambda v: v.update(capture_verified=True)),
            ('fence', lambda v: v.update(retired=True)), ('fence', lambda v: v['after'].update(loading='true'))]
        for kind, mutate in changes:
            record = copy.deepcopy(self.run.records[0]); value = decode(record[kind]); mutate(value); record[kind] = encoded(value)
            with self.subTest(kind=kind, mutate=mutate), self.assertRaises(ValueError):
                private_frame(record['configuration'], record['request'], record['fence'], frames()[0], self.run.resource)

    def test_complete_eight_case_receipts_are_hashed_without_claiming_semantic_validation(self):
        result = semantic_receipts(encoded(self.run.summary), self.run.resource)
        self.assertEqual([v['scenario'] for v in result], list(CASES))
        self.assertEqual(result[0]['sha256'], digest(encoded(self.run.summary['cases'][0])))
        for mutate in (lambda v: v['cases'].pop(), lambda v: v['cases'].reverse(),
                       lambda v: v['cases'][4].update(passed=False), lambda v: v.update(source_dirty=True),
                       lambda v: v['capture_fixture'].update(capture_verified=True), lambda v: v['capture_fixture'].update(run_nonce='f' * 32)):
            value = copy.deepcopy(self.run.summary); mutate(value)
            with self.assertRaises(ValueError): semantic_receipts(encoded(value), self.run.resource)

    def test_production_modules_have_no_runtime_or_process_imports(self):
        allowed = {'hashlib', 'json', 'math', 'pathlib', 're', 'uuid', 'dataclasses', 'os', 'stat', 'ci_instance_capture_contract'}
        for name in ('ci_instance_capture_contract.py', 'ci_instance_capture_attachments.py'):
            tree = ast.parse((Path(__file__).parent / name).read_text())
            imports = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
            imports |= {a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
            self.assertLessEqual(imports, allowed)


if __name__ == '__main__':
    unittest.main()
