"""The existing ten-phase command fixture, driven by the public XCTest actor."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time
import uuid

PHASES = ('type-fixture', 'copy', 'cut', 'paste', 'undo', 'redo', 'settings',
          'close-settings', 'new-session', 'close-new-session')
IDENTITY = ('episode', 'pid', 'window', 'launch', 'view', 'document',
            'source', 'native_sha256', 'engine_sha256')
FIELDS = {'version', 'sequence', 'phase', 'kind', 'verified_phases', *IDENTITY}


def require_command_evidence(record, final, driver, binding, configuration_sha256):
    """An acknowledgment is an attempted operation; app verification is separate."""
    def need(value):
        if not value:
            raise RuntimeError('Required public-XCTest command evidence is incomplete or differs')
    need(all(isinstance(value, dict) for value in (record, final, driver, binding)))
    need(set(binding) == {'source', 'native_sha256', 'engine_sha256'})
    for name, width in (('source', 40), ('native_sha256', 64), ('engine_sha256', 64)):
        need(isinstance(binding[name], str) and re.fullmatch('[0-9a-f]{' + str(width) + '}', binding[name]))
    need(set(final) == FIELDS | {'accepted'} and final['version'] == 1
         and type(final['version']) is int and final['kind'] == 'finished' and final['accepted'] is True
         and type(final['sequence']) is int and final['sequence'] == len(PHASES)
         and final['phase'] == PHASES[-1] and final['verified_phases'] == list(PHASES))
    for name in ('episode', 'launch', 'view', 'document'):
        need(isinstance(final[name], str))
        try:
            need(uuid.UUID(final[name]).int > 0)
        except ValueError as error:
            raise RuntimeError('Invalid command fixture incarnation') from error
    need(all(type(final[name]) is int and final[name] > 0 for name in ('pid', 'window')))
    need(all(final[name] == value for name, value in binding.items()))
    need(set(driver) == {'version', 'configuration_sha256', 'attempts'} and driver['version'] == 1
         and type(driver['version']) is int and driver['configuration_sha256'] == configuration_sha256
         and isinstance(configuration_sha256, str) and re.fullmatch('[0-9a-f]{64}', configuration_sha256))
    attempts = driver['attempts']
    need(isinstance(attempts, list) and len(attempts) == len(PHASES))
    for index, attempt in enumerate(attempts):
        need(isinstance(attempt, dict) and set(attempt) == FIELDS and attempt['kind'] == 'attempted'
             and type(attempt['version']) is int and attempt['version'] == 1
             and type(attempt['sequence']) is int and attempt['sequence'] == index + 1
             and attempt['phase'] == PHASES[index] and attempt['verified_phases'] == list(PHASES[:index])
             and all(type(attempt[name]) is int for name in ('pid', 'window'))
             and all(attempt[name] == final[name] for name in IDENTITY))
    need(record.get('scenario') == 'commands-input' and record.get('passed') is True
         and all(record.get(key) is True for key in
                 ('engine_reaped', 'profile_removed', 'identity_retired', 'commands_retired'))
         and type(record.get('app_pid')) is int and record['app_pid'] == final['pid']
         and type(record.get('engine_pid')) is int and record['engine_pid'] > 0
         and record['engine_pid'] != record['app_pid'] and record.get('ready_source') == binding['source'])
    commands = record.get('commands', {})
    need(isinstance(commands, dict))
    need(all(commands.get(key) is True for key in ('settings_once', 'new_session_once',
         'shared_focus_restored', 'projects_once_same_document', 'foreign_window_rejected',
         'navigation_popup_restricted', 'document_replaced', 'retired', 'trusted_keyboard_edit_qualified')))
    need(commands.get('initial_bridge', {}).get('binding') ==
         {name: final[name] for name in ('launch', 'view', 'document')})
    evidence = commands.get('input', {})
    need(isinstance(evidence, dict))
    need(evidence.get('source') == 'external-public-OS-driver'
         and evidence.get('app_event_post_access_required') is False
         and type(evidence.get('target_pid')) is int and evidence['target_pid'] == final['pid']
         and type(evidence.get('target_window')) is int and evidence['target_window'] == final['window']
         and all(evidence.get(name) is True for name in ('copy_cut_paste_select_undo_redo',
             'keyboard_settings_once', 'keyboard_new_session_once', 'keyboard_focus_restored')))
    events = evidence.get('trusted_events')
    need(isinstance(events, list) and events and all(isinstance(event, dict)
         and event.get('trusted') is True for event in events)
         and {'paste', 'input'} <= {event.get('type') for event in events})
    return {'scenario': 'commands-input', 'phases': list(PHASES),
            'source': 'external-public-OS-driver', 'binding': binding,
            'all_attempted_once_and_independently_verified': True}


def accepted_case(path, binding):
    # One bounded, regular, owned evidence file; never follow a substituted link.
    from ci_support import MAX_FILE
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid()
                or before.st_nlink != 1 or not 0 < before.st_size <= MAX_FILE):
            raise RuntimeError('Invalid accepted command evidence file')
        data = b''
        while len(data) <= before.st_size:
            block = os.read(fd, before.st_size + 1 - len(data))
            if not block: break
            data += block
        after = os.fstat(fd)
        if (len(data) != before.st_size or before.st_size != after.st_size
                or before.st_mtime_ns != after.st_mtime_ns or before.st_ctime_ns != after.st_ctime_ns):
            raise RuntimeError('Command evidence changed during read')
    finally:
        os.close(fd)
    value = json.loads(data)
    if value.get('binding') != binding or value.get('persistent_authorization_policy_unchanged') is not True:
        raise RuntimeError('Command XCTest source or persistent authorization differs')
    require_command_evidence(value['record'], value['final'], value['driver'], binding,
                             value['configuration_sha256'])
    return value['record']


def qualify(raw, run, command, source):
    """Keep the original 800s smoke-phase and enclosing ci.run deadline clamps."""
    from ci_xctest import run_terminal
    deadline = time.monotonic() + 800
    def bounded(args, log, timeout, **kwargs):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Original smoke-phase allowance exhausted')
        return run(args, log, min(timeout, remaining), **kwargs)
    bounded(['bash', 'desktop/macos/preview.sh', 'smoke-prepare'], raw / 'app-journeys.log', 800)
    app = raw / 'NAC Development Preview Smoke.app'
    receipt = json.loads((app / 'Contents/Resources/build-receipt.json').read_text())
    binding = {'source': source, 'native_sha256': receipt['native_sha256'],
               'engine_sha256': receipt['engine_sha256']}
    if (receipt.get('source_head') != source or receipt.get('source_dirty') is not False
            or receipt.get('mode') != 'smoke-prepare' or receipt.get('smoke_instrumentation') is not True):
        raise RuntimeError('Command fixture requires the exact clean smoke preparation')
    case = raw / 'commands-xctest'
    case.mkdir(mode=0o700)
    (case / 'evidence').mkdir(mode=0o700)
    evidence = case / 'evidence'
    def validate(record):
        return require_command_evidence(record,
            json.loads((evidence / 'commands-input-phase.json').read_text()),
            json.loads((evidence / 'commands-xctest-driver.json').read_text()), binding,
            hashlib.sha256((case / 'xctest-fixture.json').read_bytes()).hexdigest())
    result = run_terminal(case, bounded, command, app_path=app, scenario='commands-input',
                          test_name='testTrustedCommands', fixture_binding=binding, validate=validate)
    value = {'binding': binding,
             'record': json.loads((evidence / 'commands-input.json').read_text()),
             'final': json.loads((evidence / 'commands-input-phase.json').read_text()),
             'driver': json.loads((evidence / 'commands-xctest-driver.json').read_text()),
             'configuration_sha256': result['runner']['fixture_sha256'],
             'persistent_authorization_policy_unchanged': json.loads(
                 (case / 'xctest-policy-comparison.json').read_text())['persistent_authorization_policy_unchanged']}
    accepted = case / 'accepted.json'
    accepted.write_text(json.dumps(value, indent=2) + '\n')
    accepted_case(accepted, binding)  # Required independently of summary selection.
    bounded(['python3', '-B', 'desktop/macos/smoke.py', str(app), str(raw / 'evidence'),
             '--commands-xctest-evidence', str(accepted)], raw / 'smoke-journeys.log', 800)
    summary = json.loads((raw / 'evidence/summary.json').read_text())
    from smoke import SCENARIOS
    if (summary.get('full_scenario_run') is not True
            or [row.get('scenario') for row in summary.get('scenarios', [])] != list(SCENARIOS)
            or any(row.get('passed') is not True for row in summary['scenarios'])):
        raise RuntimeError('Command routing did not retain the complete named smoke suite')
    rows = [row for row in summary.get('scenarios', []) if row.get('scenario') == 'commands-input']
    if len(rows) != 1 or rows[0].get('public_xctest_verified') is not True or rows[0].get('passed') is not True:
        raise RuntimeError('Complete smoke aggregate lacks required public command XCTest')
    return result
