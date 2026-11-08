"""Closed ALL-344 source, admission and durable three-case contracts.

The root coordinator owns cross-host admission. This job-local ledger refuses
reentry; it is not an unattended global exactly-once service.
"""
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import uuid

from ci_qualifications import require_checkout

SOURCE = '7d8322f1d8cad25cc1aa79dc5a7a025a6719065b'
TREE = '89a58b792f4b181a6d64af5dfcb5bc4d6bb24053'
ALLOCATION = 'nac344-ordering-7e-one'
CASES = ('run', 'approval', 'terminal')
MODES = {'app-build': 'NAC.app', 'lifecycle-build': 'NAC Lifecycle Smoke.app',
         'startup-build': 'NAC Startup Smoke.app', 'instance-build': 'NAC Instance Smoke.app',
         'smoke-build': 'NAC Development Preview Smoke.app'}
TARGET = {'source_sha': SOURCE, 'source_tree': TREE, 'profile': 'macos26', 'suite': 'lifecycle',
          'scenario_count': 3, 'scenarios': list(CASES), 'allocation_id': ALLOCATION, 'retry_budget': 0}
FRAMES = ('work-ready-workspace.png', 'reopened-workspace.png', 'confirming-workspace.png',
          'confirming-sheet.png', 'cancelled-workspace.png')
DIRECTORY = Path(__file__).resolve().parent


def contract():
    value = json.loads((DIRECTORY / 'ci-lifecycle-source.json').read_text())
    if (value.get('version') != 1 or value.get('source_sha') != SOURCE
            or value.get('source_tree') != TREE or value.get('allocation_id') != ALLOCATION
            or len(value.get('normal_sources', {})) != 15 or set(value.get('build_modes', {})) != set(MODES)):
        raise RuntimeError('Lifecycle immutable source contract differs')
    return value


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def canonical(path, *, parent=None, exists=True):
    path = Path(path)
    if (not path.is_absolute() or path.is_symlink() or path.resolve() != path
            or (exists and not path.exists()) or (parent is not None and not path.is_relative_to(parent))):
        raise RuntimeError('Lifecycle path is missing, overlapping or not canonical')
    return path


def require_source(source, harness):
    canonical(source)
    canonical(harness)
    if source == harness or source.is_relative_to(harness) or harness.is_relative_to(source):
        raise RuntimeError('Lifecycle supplier and harness overlap')
    require_checkout(source, SOURCE)
    tree = subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=source, text=True, timeout=15).strip()
    if tree != TREE:
        raise RuntimeError('Lifecycle supplier tree differs')
    value = contract()
    for name, expected in value['files'].items():
        path = canonical(source / name, parent=source)
        if not path.is_file() or digest(path) != expected:
            raise RuntimeError('Lifecycle supplier source changed: ' + name)
    for name, expected in value['preserved_blobs'].items():
        actual = subprocess.check_output(['git', 'hash-object', name], cwd=source, text=True, timeout=15).strip()
        if actual != expected:
            raise RuntimeError('Lifecycle production blob changed: ' + name)
    return value


def require_capsule(text, harness_sha, environment):
    """A fixed, bounded transfer from the root's still-unspent allocation."""
    if (not isinstance(harness_sha, str) or not re.fullmatch('[0-9a-f]{40}', harness_sha)
            or not isinstance(text, str) or not 0 < len(text.encode()) <= 8192):
        raise RuntimeError('One bounded root lifecycle custody capsule is required')
    try:
        value = json.loads(text, object_pairs_hook=unique_keys)
    except (ValueError, TypeError) as error:
        raise RuntimeError('Malformed lifecycle custody capsule') from error
    fixed = {'version': 1, 'allocation_id': ALLOCATION, 'supplier': SOURCE, 'supplier_tree': TREE,
             'harness': harness_sha, 'repository': 'arcee-ai/nac', 'workflow': 'stable-release.yml',
             'branch': 'codex/all-344-hosted-lifecycle-qualification', 'run_attempt': 1,
             'scenarios': list(CASES), 'prior_dispatch_counts': dict.fromkeys(CASES, 0),
             'retry_budget': 0, 'production_repair_budget_added': 0,
             'custody_sha256': contract()['custody_sha256']}
    if (not isinstance(value, dict) or set(value) != set(fixed) | {'admission_nonce'}
            or any(not exact(value.get(k), v) for k, v in fixed.items())
            or not isinstance(value.get('admission_nonce'), str)
            or not re.fullmatch('[0-9a-f]{64}', value['admission_nonce'])
            or environment.get('GITHUB_EVENT_NAME') != 'workflow_dispatch'
            or environment.get('GITHUB_RUN_ATTEMPT') != '1'
            or environment.get('GITHUB_REPOSITORY') != fixed['repository']
            or environment.get('GITHUB_REF') != 'refs/heads/' + fixed['branch']
            or environment.get('GITHUB_SHA') != harness_sha
            or not re.fullmatch('[1-9][0-9]*', environment.get('GITHUB_RUN_ID', ''))):
        raise RuntimeError('Lifecycle custody, fixed selector or workflow attempt differs')
    # bool is not a case count, even though Python considers False == 0.
    if any(type(value['prior_dispatch_counts'][name]) is not int for name in CASES):
        raise RuntimeError('Lifecycle custody case counts must be exact integers')
    return value


def exact(left, right):
    return json.dumps(left, sort_keys=True) == json.dumps(right, sort_keys=True)


def unique_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate custody key')
        result[key] = value
    return result


def persist(path, value):
    """Acknowledge both file data and the containing rename before spawn."""
    path = Path(path)
    if path.is_symlink():
        raise RuntimeError('Refusing symlink lifecycle receipt')
    temporary = path.with_name(path.name + '-' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x') as stream:
            os.chmod(temporary, 0o600)
            json.dump(value, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        temporary.unlink(missing_ok=True)


class Ledger:
    def __init__(self, directory, capsule, run_id):
        canonical(directory)
        self.path = directory / 'ledger.json'
        # The root must reject reuse on another host. Locally no completed or
        # interrupted ledger is ever permission to run again.
        self.lock = (directory / 'controller.lock').open('x')
        fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if self.path.exists():
            self.lock.close()
            raise RuntimeError('Lifecycle capsule already admitted in this job')
        self.value = {'allocation_id': ALLOCATION, 'capsule': json.loads(json.dumps(capsule)), 'run_id': run_id,
                      'phase': 'preflight', 'active_case': None,
                      'cases': {name: {'state': 'not_dispatched', 'dispatches': 0} for name in CASES}}
        persist(self.path, self.value)
        self.previous = digest(self.path)
        self.identity = {k: self.value[k] for k in ('allocation_id', 'capsule', 'run_id')}
        self.identity = json.dumps(self.identity, sort_keys=True)

    def save(self):
        if (self.path.is_symlink() or digest(self.path) != self.previous
                or json.dumps({k: self.value[k] for k in ('allocation_id', 'capsule', 'run_id')}, sort_keys=True) != self.identity):
            raise RuntimeError('Lifecycle ledger changed outside its single writer')
        persist(self.path, self.value)
        self.previous = digest(self.path)

    def reserve(self, name, output, console, execution):
        if name not in CASES or self.value['active_case'] is not None:
            raise RuntimeError('Unexpected lifecycle scenario or concurrent reservation')
        index = CASES.index(name)
        if (any(self.value['cases'][prior]['state'] != 'passed' for prior in CASES[:index])
                or self.value['cases'][name] != {'state': 'not_dispatched', 'dispatches': 0}
                or self.value['phase'] not in ('preflight', 'case_passed')):
            raise RuntimeError('Repeated, reordered or previously uncertain lifecycle case')
        require_console(console)
        if (not isinstance(execution, dict)
                or set(execution) != {'builds_sha256', 'observer_sha256', 'source_sha', 'harness_sha', 'command'}
                or execution['source_sha'] != SOURCE or execution['harness_sha'] != self.value['capsule']['harness']
                or any(not isinstance(execution[k], str) or not re.fullmatch('[0-9a-f]{64}', execution[k])
                       for k in ('builds_sha256', 'observer_sha256'))
                or not isinstance(execution['command'], list) or len(execution['command']) != 9
                or execution['command'][3] != 'driver' or execution['command'][5] != name
                or execution['command'][7] != str(output)):
            raise RuntimeError('Lifecycle reservation command/build custody differs')
        canonical(output, parent=self.path.parent, exists=False)
        if output.exists():
            raise RuntimeError('Existing lifecycle output is not permission to retry')
        output.mkdir()
        self.value['cases'][name] = {'state': 'dispatched', 'dispatches': 1,
                                     'console': console, 'output': str(output), 'execution': execution}
        self.value.update(phase='case_dispatched', active_case=name)
        self.save()  # Must return, including directory fsync, before Popen.

    def finish(self, name, state, receipt, *, before_save=None):
        if (state not in ('passed', 'failed', 'unknown') or self.value['active_case'] != name
                or self.value['cases'][name]['state'] != 'dispatched'):
            raise RuntimeError('Unexpected lifecycle result transition')
        self.value['cases'][name].update(state=state, receipt=receipt)
        self.value.update(phase='case_passed' if state == 'passed' else 'stopped_' + state, active_case=None)
        if before_save is not None:
            before_save(self.value)
        self.save()

    def close(self):
        self.lock.close()


def require_console(value):
    if (not isinstance(value, dict) or set(value) != {'observed', 'locked'}
            or value.get('observed') is not True or value.get('locked') is not False):
        raise RuntimeError('Lifecycle target console unknown/locked; no case reserved')


def require_build(mode, app, source, engine_sha):
    expected = contract()['build_modes'][mode]
    canonical(app)
    receipt_path = canonical(app / 'Contents/Resources/build-receipt.json', parent=app)
    receipt = json.loads(receipt_path.read_text())
    identity = receipt.get('engine_identity', {})
    if (receipt.get('version') != 1 or receipt.get('phase') != 'unsigned-build'
            or receipt.get('mode') != mode or receipt.get('source_head') != SOURCE
            or receipt.get('source_dirty') is not False or identity.get('source_revision') != SOURCE
            or identity.get('track') != 'dev' or identity.get('build_id') != 'dev-ci-lifecycle-' + SOURCE
            or any(not exact(receipt.get(k), v) for k, v in expected.items())):
        raise RuntimeError('Lifecycle five-bundle source, mode or instrumentation differs: ' + mode)
    for key, member in (('native_sha256', 'MacOS/NACPreview'), ('engine_sha256', 'Resources/nac-web'),
                        ('info_plist_sha256', 'Info.plist')):
        path = canonical(app / 'Contents' / member, parent=app)
        if not path.is_file() or digest(path) != receipt.get(key):
            raise RuntimeError('Lifecycle build digest differs: ' + key)
    if receipt['engine_sha256'] != engine_sha:
        raise RuntimeError('Lifecycle bundle does not contain the private exact engine')
    if mode == 'app-build' and (receipt.get('preview_definitions_excluded') is not True
                               or 'LifecycleSmoke' not in receipt.get('fixture_markers_absent', [])):
        raise RuntimeError('Ordinary lifecycle app instrumentation exclusion missing')
    return receipt


def require_case(summary, name, build, assets):
    cases = summary.get('cases', [])
    if (summary.get('source_head') != SOURCE or summary.get('passed') is not True
            or summary.get('build_receipt') != build or summary.get('actual_local_app') is not True
            or summary.get('system_wk') is not True or summary.get('visible_paint_acceptance') is not False
            or summary.get('trusted_input_acceptance') is not False
            or len(cases) != 1 or cases[0].get('scenario') != name):
        raise RuntimeError('Lifecycle case/receipt/source differs')
    require_console(summary.get('console_lock'))
    case = cases[0]
    for key in ('store_reacquired', 'durable_transcript_preserved', 'durable_goal_preserved',
                'no_remembered_grants', 'approval_mode_preserved', 'terminal_descendant_stopped',
                'no_input_or_mutation_replay'):
        if case.get(key) is not True:
            raise RuntimeError('Lifecycle store/descendant semantic evidence missing: ' + key)
    if case.get('integrity') != 'ok' or case.get('assets') != assets:
        raise RuntimeError('Lifecycle store integrity or served assets differ')
    native = case.get('native', {})
    if (native.get('ready_source') != SOURCE or native.get('ready_build') != build['engine_identity']['build_id']
            or type(native.get('owned_engine_pid')) is not int or native['owned_engine_pid'] <= 0
            or not native.get('launch_incarnation') or native.get('engine_pid') != 0):
        raise RuntimeError('Lifecycle actual engine/source/window binding differs')
    for key in ('passed', 'stopped', 'document_released', 'commands_retired', 'close_retained_owners',
                'reopen_retained_usable_workspace', 'cancel_retained_owners', 'application_will_terminate'):
        if native.get(key) is not True:
            raise RuntimeError('Lifecycle native ownership assertion missing: ' + key)
    if (native.get('instrumentation') != 'LIFECYCLE_SMOKE' or native.get('application_class') != 'NSApplication'
            or not native.get('termination_phase', '').startswith('finished(')
            or native.get('quit_confirmation_decisions') != 2 or native.get('quit_sheet_presentations') != 2
            or native.get('quit_cancel_choices') != 1 or native.get('quit_stop_completions') != 1
            or native.get('render_captures') != ['work-ready', 'reopened', 'confirming', 'cancelled']):
        raise RuntimeError('Lifecycle final native/PNG sequence incomplete')
    invocation = native.get('native_duplicate_invocation', {})
    before, after = invocation.get('before', {}), invocation.get('after', {})
    times = [invocation.get(k) for k in ('began_uptime', 'returned_uptime', 'deadline_uptime', 'cancel_dispatched_uptime')]
    if (invocation.get('command') != 'duplicate-quit' or not invocation.get('id')
            or any(invocation.get(k) is not True for k in ('issued', 'began', 'returned'))
            or invocation.get('outcome') != 'settled' or native.get('native_duplicate_returned') is not True
            or invocation.get('prefix') != before
            or any(type(t) not in (int, float) or not math.isfinite(t) for t in times)
            or not (times[0] <= times[1] < times[2] and times[3] >= times[1])):
        raise RuntimeError('Lifecycle duplicate/Cancel ordering is unknown or invalid')
    for key in ('confirmation_id', 'sheet_window', 'document', 'engine_pid', 'launch_incarnation'):
        if not before.get(key) or before.get(key) != after.get(key):
            raise RuntimeError('Lifecycle duplicate replaced an owner: ' + key)
    if (any(type(before[k]) is not int or before[k] <= 0 for k in ('sheet_window', 'engine_pid'))
            or before['engine_pid'] != native['owned_engine_pid']
            or before['launch_incarnation'] != native['launch_incarnation']):
        raise RuntimeError('Lifecycle duplicate is not bound to the actual app engine')
    for snapshot in (before, after):
        if (snapshot.get('owners_intact') is not True or snapshot.get('stop_started') is not False
                or snapshot.get('confirmation_decisions') != 1 or snapshot.get('sheet_presentations') != 1
                or snapshot.get('cancel_choices') != 0 or snapshot.get('stop_completions') != 0):
            raise RuntimeError('Lifecycle duplicate changed the outstanding confirmation')
    delta = after.get('delegate_calls', -999) - before.get('delegate_calls', 999)
    if (delta not in (0, 1) or before.get('delegate_calls', 0) < 1
            or native.get('native_duplicate_delegate_before') != before.get('delegate_calls')
            or native.get('native_duplicate_delegate_after') != after.get('delegate_calls')
            or native.get('quit_delegate_requests', 0) < after['delegate_calls'] + 1):
        raise RuntimeError('Lifecycle observed duplicate counters differ')
    os_requests = case.get('os_termination_requests', [])
    if name == 'terminal':
        if (case.get('initial_quit_origin') != 'owned OS application request' or len(os_requests) != 2
                or any(x.get('termination_requested') is not True for x in os_requests)):
            raise RuntimeError('Lifecycle terminal case lacks actual OS termination admission')
    elif os_requests or case.get('initial_quit_origin') != 'native app action':
        raise RuntimeError('Lifecycle case has the wrong Quit origin')
    return case
