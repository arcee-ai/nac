"""Complete bounded fixture receipts; never compute or override acceptance."""
import hashlib
import json
from pathlib import Path

MAX_FILE = 256 * 1024  # Existing harness non-image limit; not a new allowance.
PHASES = ('initial_readiness', 'readiness', 'after_snapshot_readiness')
CAPTURE_FIELDS = ('source_identity', 'expected_answer_sha256', 'png_sha256', 'png_width',
                  'png_height', 'settled_answer_sha256_before', 'settled_answer_sha256_after', 'semantic_ready', 'animation_frame_observed', 'window_visible',
                  'window_occlusion_visible', 'window_visible_after_snapshot', 'readiness_elapsed_ms')
OBSERVATION_FIELDS = ('ready', 'reason', 'expected', 'hash', 'visibility', 'loadingConversation',
                      'message_identity', 'message_page', 'full_answer', 'fonts_ready',
                      'settled_predicates', 'approval_predicates', 'resource_predicates',
                      'approval_values', 'message_observations', 'message_observations_truncated',
                      'session_owner_observation', 'message_page_observation')


def _bytes(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True) + '\n').encode()


def _write(output, name, value):
    data = _bytes(value)
    oversized = len(data) > MAX_FILE
    if oversized:
        data = _bytes({'complete': False, 'result': 'failed',
                       'reason': 'Essential receipt exceeds unchanged non-image cap',
                       'unretained_json_bytes': len(data),
                       'unretained_json_sha256': hashlib.sha256(data).hexdigest()})
    with (output / name).open('xb') as stream:
        stream.write(data)
    if oversized:
        raise RuntimeError(f'Complete essential receipt unavailable: {name}')
    return {'file': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def _typed(record, key, kind):
    value = record.get(key)
    if type(value) is kind:
        return {'type': kind.__name__, 'value': value, 'observed': True}
    return {'type': 'unknown', 'value': None, 'observed': False,
            'reason': 'Field absent or not the required exact type'}


def write_critical_receipts(output, scenario, record, provenance):
    """Read a completed/failed source record; leave it and all PNGs untouched."""
    if scenario not in ('workspace-direct', 'workspace-legacy', 'workspace-manual'):
        raise RuntimeError('Unknown owned workspace scenario')
    output = Path(output)
    identity = {key: provenance.get(key) for key in
                ('source_head', 'source_status', 'engine_sha256', 'native_sha256',
                 'os', 'os_build', 'execution_os', 'execution_os_build', 'runner_sha256')}
    cleanup = {key: _typed(record, key, kind) for key, kind in
               (('engine_reaped', bool), ('profile_removed', bool), ('launcher_exit_code', int))}
    checks = {key: {field: item[field] for field in ('status', 'blocked_by', 'executed') if field in item}
              for key, item in record.get('checks', {}).items()}
    # Retain typed cleanup first, independently of verbose capture/canonical data.
    _write(output, f'{scenario}-episode-critical.json',
           {'complete': True, 'scenario': scenario, 'source_identity': identity,
            'identity_fields': {key: _typed(provenance, key, str) for key in identity},
            'passed_observation': _typed(record, 'passed', bool), 'checks': checks,
            'cleanup': cleanup, 'runner_error': record.get('runner_error'),
            'scope': 'Essential evidence only; original record controls acceptance',
            'omitted': ['DOM text', 'verbose paint ancestors', 'unrelated fixture metadata']})
    if scenario != 'workspace-direct':
        return
    for label, capture_name in (('rich', 'rich-chat.png'), ('approval', 'approval.png')):
        capture = record.get('paint_diagnostics', {}).get(capture_name, {})
        for phase in PHASES:
            observation = capture.get(phase)
            found = isinstance(observation, dict)
            fields = {key: observation[key] for key in OBSERVATION_FIELDS if key in observation} if found else {}
            if found and 'surfaces' in observation:
                fields['surfaces'] = [{key: surface.get(key) for key in ('visible', 'within_frame', 'geometry')}
                                      for surface in observation['surfaces']]
            common = {key: capture.get(key) for key in CAPTURE_FIELDS}
            prefix = f'{scenario}-{label}-{phase}'
            _write(output, prefix + '-critical.json',
                   {'complete': True, 'scenario': scenario, 'phase': phase,
                    'source_identity': identity, 'capture': common,
                    'observation_present': found, 'observation': fields,
                    'missing_observation_reason': None if found else 'Not produced before failure',
                    'omitted': ['surface ancestors/content', 'full document diagnostics'],
                    'acceptance_overridden': False})
            if found and 'canonical_snapshot' in observation:
                # Preserve the fetched canonical fixture snapshot unfiltered;
                # do not reconstruct it from the visible page or lost old data.
                _write(output, prefix + '-canonical-critical.json',
                       {'complete': True, 'scenario': scenario, 'phase': phase,
                        'source_identity': identity,
                        'canonical_snapshot': observation['canonical_snapshot'],
                        'acceptance_source': 'Separate explicit visible page, not canonical cardinality'})
