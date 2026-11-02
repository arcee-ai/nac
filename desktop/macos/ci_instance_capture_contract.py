"""Pure ALL-343 T34 record join and public resource projection.

Inputs are bytes retained by an independently admitted H owner, never paths to
T's live files. Digests bind records; they do not authenticate their producer.
No launch, SDK, notification, image decoder or private-file access lives here.
"""
import hashlib
import json
import math
from pathlib import PurePosixPath
import re
import uuid

TARGET = '34f8ed0d4f82d4df50553f8faa27765e61f03e57'
MAX_RECORD = 32 * 1024
MAX_TEXT = 256 * 1024
MAX_PNG = 2 * 1024 * 1024
MAX_IMAGES = 12 * 1024 * 1024
CASES = ('simultaneous', 'cli', 'symlink', 'directory-symlink', 'crash', 'shutdown', 'app-crash', 'coexist')
KEYS = ('simultaneous/workspace', 'simultaneous/reopened', 'cli/conflict', 'cli/retry-workspace',
        'symlink/conflict', 'symlink/retry-workspace', 'directory-symlink/conflict',
        'directory-symlink/retry-workspace', 'crash/conflict', 'crash/retry-workspace',
        'shutdown/conflict', 'shutdown/retry-workspace', 'app-crash/initial/workspace',
        'app-crash/replacement/workspace', 'app-crash/replacement/reopened',
        'coexist/dev/workspace', 'coexist/stable/workspace', 'coexist/stable/reopened', 'coexist/dev/reopened')
STATE_FIELDS = {'root', 'store', 'bundle', 'track', 'app_pid', 'app_incarnation', 'app_launch_epoch',
                'window_number', 'engine_pid', 'window_frame', 'content_bounds', 'receipt_incarnation',
                'receipt_store', 'receipt_schema', 'origin', 'receipt_kind', 'receipt_version', 'engine_build',
                'engine_source', 'engine_version', 'endpoint', 'document_url', 'conflict_episode', 'reopen_count', 'loading'}
PIN_FIELDS = {'target_sha', 'harness_sha', 'manifest_sha256', 'prepared_sha256'}
APP_FIELDS = {'track', 'bundle_path', 'bundle_id', 'native_sha256', 'engine_sha256'}
RESOURCE_FIELDS = PIN_FIELDS | {'schema', 'run_nonce', 'preparation_nonce', 'frames', 'apps'}
PUBLIC_FIELDS = {'schema', 'run_nonce', 'request_nonce', 'ordinal', 'key', 'configuration_sha256',
                 'manifest_sha256', 'request_sha256', 'track', 'app_pid', 'app_incarnation',
                 'app_launch_epoch', 'window_number'}


def require(condition, reason):
    if not condition:
        raise ValueError('Instance capture: ' + reason)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value, limit=MAX_RECORD):
    data = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
    require(0 < len(data) <= limit, 'encoded record bound')
    return data


def decode(data, limit=MAX_RECORD):
    require(type(data) is bytes and 0 < len(data) <= limit, 'record byte bound')
    def unique(pairs):
        require(len(pairs) == len(dict(pairs)), 'duplicate JSON field')
        return dict(pairs)
    return json.loads(data, object_pairs_hook=unique,
                      parse_constant=lambda _: require(False, 'nonfinite JSON'))


def closed(value, fields):
    require(type(value) is dict and set(value) == set(fields), 'closed fields')
    return value


def hex_text(value, length):
    return type(value) is str and re.fullmatch('[0-9a-f]{%d}' % length, value) is not None


def path_text(value):
    """Lexical spelling only: never resolve, stat, open or adopt an app/store."""
    return (type(value) is str and 0 < len(value.encode()) <= 4096 and value.startswith('/')
            and '\0' not in value and str(PurePosixPath(value)) == value
            and all(part not in ('.', '..') for part in value.split('/')[1:]))


def frames():
    return [dict(ordinal=i, key=key, track='stable' if key.startswith('coexist/stable/') else 'dev')
            for i, key in enumerate(KEYS, 1)]


def require_pins(pins):
    closed(pins, PIN_FIELDS)
    require(pins['target_sha'] == TARGET and all(hex_text(pins[k], 40 if k.endswith('_sha') else 64)
                                               for k in PIN_FIELDS), 'nominated source/digest pins')


def require_manifest(raw, pins):
    require_pins(pins)
    value = closed(decode(raw), {'schema', 'run_nonce', 'target_sha', 'harness_sha', 'frames'})
    require(digest(raw) == pins['manifest_sha256'] and value['schema'] == 'nac343-capture-manifest-v1'
            and hex_text(value['run_nonce'], 32)
            and all(value[k] == pins[k] for k in ('target_sha', 'harness_sha'))
            and encoded(value['frames']) == encoded(frames()), 'full nineteen-frame manifest binding')
    return value


def build_resource(manifest_raw, prepared_raw, pins):
    """Project already host-validated T preparation; do not revalidate live apps.

    The expected preparation digest must come from the admitted host's retained
    receipt, not from the actor or an export. T still owns full artifact-tree
    validation and exclusive consumption. Private nested data is never copied.
    """
    manifest = require_manifest(manifest_raw, pins)
    prepared = closed(decode(prepared_raw), {'schema', 'run_nonce', 'preparation_nonce', 'manifest_sha256',
        'target_sha', 'harness_sha', 'state', 'source_files', 'observer', 'apps', 'destination', 'root'})
    require(digest(prepared_raw) == pins['prepared_sha256'] and prepared['schema'] == 'nac343-prepared-fixture-v1'
            and prepared['state'] == 'prepared-files-only' and hex_text(prepared['preparation_nonce'], 32)
            and prepared['run_nonce'] == manifest['run_nonce']
            and all(prepared[k] == pins[k] for k in ('target_sha', 'harness_sha', 'manifest_sha256')),
            'preparation source/run binding')
    for name in ('root', 'destination'):
        closed(prepared[name], {'path', 'identity'})
        require(path_text(prepared[name]['path']), 'prepared resource spelling')
    root = prepared['destination']['path'] + '/nac-instance-app-' + prepared['preparation_nonce']
    require(prepared['root']['path'] == root and type(prepared['apps']) is list
            and len(prepared['apps']) == 2, 'prepared root/apps')
    apps = []
    for index, track in enumerate(('dev', 'stable')):
        row = closed(prepared['apps'][index], {'track', 'source', 'moved'})
        require(row['track'] == track, 'prepared track order')
        summaries = []
        for role in ('source', 'moved'):
            bundle = closed(row[role], {'path', 'tree', 'summary'})
            summary = closed(bundle['summary'], {'path', 'identity', 'bundle_id', 'native_sha256', 'engine_sha256'})
            identity = closed(summary['identity'], {'product_version', 'build_id', 'source_revision', 'track'})
            require(path_text(bundle['path']) and summary['path'] == bundle['path']
                    and identity['source_revision'] == pins['target_sha'] and identity['track'] == track
                    and all(type(v) is str and 0 < len(v) <= 256 for v in identity.values())
                    and all(hex_text(summary[k], 64) for k in ('native_sha256', 'engine_sha256')),
                    'prepared public app identity')
            summaries.append(summary)
        source, moved = summaries
        identifier = ('ai.arcee.nac.dev' if track == 'dev' else 'ai.arcee.nac') + '.instance-smoke'
        require(moved['path'] == root + '/Moved app with spaces %d/NAC Instance Smoke.app' % index
                and source['path'] != moved['path'] and moved['bundle_id'] == identifier
                and {k: v for k, v in source.items() if k != 'path'} ==
                    {k: v for k, v in moved.items() if k != 'path'}, 'prepared moved app binding')
        apps.append(dict(track=track, bundle_path=moved['path'], bundle_id=identifier,
                         **{k: moved[k] for k in ('native_sha256', 'engine_sha256')}))
    return encoded(dict(pins, schema='nac343-public-resource-v1', run_nonce=manifest['run_nonce'],
                        preparation_nonce=prepared['preparation_nonce'], frames=frames(), apps=apps))


def require_resource(raw, pins):
    require_pins(pins)
    value = closed(decode(raw), RESOURCE_FIELDS)
    require(value['schema'] == 'nac343-public-resource-v1' and all(value[k] == pins[k] for k in PIN_FIELDS)
            and hex_text(value['run_nonce'], 32) and hex_text(value['preparation_nonce'], 32)
            and encoded(value['frames']) == encoded(frames()) and type(value['apps']) is list
            and len(value['apps']) == 2, 'public resource binding')
    for index, track in enumerate(('dev', 'stable')):
        app = closed(value['apps'][index], APP_FIELDS)
        identifier = ('ai.arcee.nac.dev' if track == 'dev' else 'ai.arcee.nac') + '.instance-smoke'
        require(app['track'] == track and app['bundle_id'] == identifier and path_text(app['bundle_path'])
                and all(hex_text(app[k], 64) for k in ('native_sha256', 'engine_sha256')), 'public app binding')
    require(value['apps'][0]['bundle_path'] != value['apps'][1]['bundle_path'], 'separate track bundles')
    require(encoded(value) == raw, 'canonical immutable public resource')
    return value


def positive_decimal(value, zero=False):
    return (type(value) is str and re.fullmatch('0|[1-9][0-9]*', value) is not None
            and len(value) <= 20 and (zero or value != '0'))


def finite_positive(value):
    return type(value) in (int, float) and math.isfinite(value) and value > 0


def private_frame(configuration_raw, request_raw, fence_raw, frame, resource):
    """Join retained T records; no path or liveness observation is performed."""
    config = closed(decode(configuration_raw), {'schema', 'run_nonce', 'manifest_sha256', 'target_sha',
                                               'harness_sha', 'context', 'frames'})
    context = closed(config['context'], {'root', 'bundle', 'store', 'track', 'native_sha256', 'engine_sha256', 'journey'})
    journey = frame['key'].rsplit('/', 1)[0]
    app = resource['apps'][1 if frame['track'] == 'stable' else 0]
    prepared_root = str(PurePosixPath(app['bundle_path']).parents[1])
    expected_frames = [{k: f[k] for k in ('ordinal', 'key')} for f in frames() if f['key'].rsplit('/', 1)[0] == journey]
    require(config['schema'] == 'nac343-capture-config-v1' and config['run_nonce'] == resource['run_nonce']
            and all(config[k] == resource[k] for k in ('manifest_sha256', 'target_sha', 'harness_sha'))
            and encoded(config['frames']) == encoded(expected_frames) and context['journey'] == journey
            and context['track'] == frame['track'] and context['bundle'] == app['bundle_path']
            and all(context[k] == app[k] for k in ('native_sha256', 'engine_sha256'))
            and path_text(context['root']) and path_text(context['store'])
            and context['root'].startswith(prepared_root + '/')
            and context['store'].startswith(context['root'] + '/'), 'configuration context/roster binding')
    request = closed(decode(request_raw), {'schema', 'run_nonce', 'request_nonce', 'ordinal', 'key',
                                         'configuration_sha256', 'manifest_sha256', 'before'})
    state = closed(request['before'], STATE_FIELDS)
    require(all(type(v) is str and len(v.encode()) <= 4096 for v in state.values())
            and all(state[k] == context[k] for k in ('root', 'store', 'bundle', 'track')),
            'private state context')
    require(all(positive_decimal(state[k]) for k in ('app_pid', 'window_number'))
            and all(positive_decimal(state[k], zero=True) for k in ('engine_pid', 'reopen_count'))
            and state['loading'] in ('true', 'false'), 'private process/window types')
    try:
        incarnation = str(uuid.UUID(state['app_incarnation']))
        epoch = float(state['app_launch_epoch'])
    except (ValueError, AttributeError):
        raise ValueError('Instance capture: private incarnation/epoch') from None
    require(incarnation == state['app_incarnation'].lower() and math.isfinite(epoch) and epoch > 0,
            'private incarnation/epoch')
    require(request['schema'] == 'nac343-capture-request-v1' and request['run_nonce'] == resource['run_nonce']
            and hex_text(request['request_nonce'], 32) and type(request['ordinal']) is int
            and request['ordinal'] == frame['ordinal'] and request['key'] == frame['key']
            and request['configuration_sha256'] == digest(configuration_raw)
            and request['manifest_sha256'] == resource['manifest_sha256'], 'request binding/order')
    fence = decode(fence_raw)
    expected = dict(schema='nac343-private-fence-v1', **{k: request[k] for k in
        ('run_nonce', 'request_nonce', 'ordinal', 'key', 'configuration_sha256')},
        request_sha256=digest(request_raw), release='provisional', capture_verified=False, before=state, after=state)
    require(encoded(fence) == encoded(expected), 'private before/after fence or retirement')
    phase = dict(schema='nac343-public-phase-v1', **{k: request[k] for k in
                 ('run_nonce', 'request_nonce', 'ordinal', 'key', 'configuration_sha256', 'manifest_sha256')},
                 request_sha256=digest(request_raw), **{k: state[k] for k in
                 ('track', 'app_pid', 'app_incarnation', 'app_launch_epoch', 'window_number')})
    require(len(encoded(phase)) <= 2048, 'public phase bound')
    return phase, state


def semantic_receipts(summary_raw, resource):
    """Structural join only; existing ci_instances.require_cases remains required.

    Preserve complete opaque case records by hash. Do not duplicate or replace
    the existing engine/assets/console/cleanup semantic acceptance gate here.
    """
    summary = decode(summary_raw, MAX_TEXT)
    require(type(summary) is dict and summary.get('source_head') == resource['target_sha']
            and summary.get('source_dirty') is False and summary.get('runtime_passed') is True
            and summary.get('full_scenario_run') is True and summary.get('actual_app_acceptance') is False
            and summary.get('instrumentation') == 'INSTANCE_SMOKE + PREVIEW_SMOKE + LOCAL_APP'
            and summary.get('requested_scenarios') == list(CASES), 'semantic summary source/scope')
    provisional = dict(schema='nac343-provisional-summary-v1', run_nonce=resource['run_nonce'],
                       manifest_sha256=resource['manifest_sha256'], provisional_releases=19,
                       capture_verified=False, final_public_pairs_required=19)
    require(encoded(summary.get('capture_fixture')) == encoded(provisional), 'provisional summary binding')
    rows = summary.get('cases')
    require(type(rows) is list and len(rows) == 8, 'eight semantic receipts required')
    result = []
    for name, case in zip(CASES, rows):
        require(type(case) is dict and case.get('scenario') == name and case.get('passed') is True,
                'semantic receipt order/pass')
        result.append(dict(scenario=name, sha256=digest(encoded(case, MAX_TEXT))))
    return result
