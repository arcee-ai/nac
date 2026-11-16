"""Retain the pinned supplier's small fixture receipt before private teardown.

Recorded PIDs are read-only evidence, never authority to signal a process.
"""
import hashlib
import json
from pathlib import Path

from ci_lifecycle_contract import CASES, SOURCE, canonical, persist


def fixture_record(value):
    fields = {'session_id', 'approval_session_id', 'descendant_pid', 'goal_id',
              'goal_status', 'terminal_id', 'provider_requests'}
    if (not isinstance(value, dict) or set(value) != fields
            or any(not isinstance(value[k], str) or not 0 < len(value[k]) <= 256
                   for k in ('session_id', 'approval_session_id', 'goal_id', 'terminal_id'))
            or type(value['descendant_pid']) is not int or value['descendant_pid'] <= 0
            or value['goal_status'] != 'paused'
            or value['provider_requests'] != ['transcript', 'goal', 'approval']):
        raise RuntimeError('Lifecycle fixture ownership receipt differs from the pinned supplier')
    return value


def retain(destination, scenario):
    """File reads only. Partial writes can be retried while the driver runs."""
    if scenario not in CASES:
        raise RuntimeError('Unknown lifecycle ownership scenario')
    canonical(destination)
    roots = list(destination.glob('nac-lifecycle-app-*'))
    if len(roots) > 1:
        raise RuntimeError('Unexpected extra lifecycle ownership root')
    if not roots:
        return False
    root = canonical(roots[0], parent=destination, exists=False)
    source = root / scenario / ('controls-' + scenario) / 'fixture.json'
    if not source.exists():
        return False
    canonical(source, parent=root, exists=False)
    try:
        with source.open('rb') as stream:
            data = stream.read(8193)
    except FileNotFoundError:
        return False  # The supplier may be deleting its settled private root.
    if len(data) > 8192:
        raise RuntimeError('Lifecycle fixture ownership receipt exceeds its bound')
    try:
        fixture = fixture_record(json.loads(data))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return False
    value = {'source_sha': SOURCE, 'scenario': scenario, 'fixture_root': str(root),
             'source_file': str(source), 'source_bytes': len(data),
             'source_sha256': hashlib.sha256(data).hexdigest(), 'fixture': fixture,
             'PID_signal_authority': False}
    output = destination / 'ownership.json'
    if output.exists():
        canonical(output, parent=destination)
        if json.loads(output.read_text()) != value:
            raise RuntimeError('Lifecycle fixture ownership changed during the case')
    else:
        persist(output, value)
    return True


def require(destination, scenario, native=None):
    output = canonical(destination / 'ownership.json', parent=destination)
    value = json.loads(output.read_text())
    root = canonical(Path(value['fixture_root']), parent=destination, exists=False)
    expected = root / scenario / ('controls-' + scenario) / 'fixture.json'
    if (root.parent != destination or not root.name.startswith('nac-lifecycle-app-')
            or value.get('source_sha') != SOURCE or value.get('scenario') != scenario
            or value.get('source_file') != str(expected) or value.get('PID_signal_authority') is not False
            or (native is not None and Path(native['ready_store']).parent.parent != root)):
        raise RuntimeError('Lifecycle retained ownership is not bound to the selected native store')
    fixture_record(value['fixture'])
    return value
