"""One finite read-only AX companion; ci.run remains its sole process owner."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import re
import threading
import time

from ci_paths_budget import BudgetExpired, active, check, time_limit, using
from ci_startup_owner import native_identity, signature
from ci_xctest import runner_environment
from ci_xctest_attachments import bounded_file

SUPPORT = ('StartupAXGuard.swift', 'StartupAXReceipt.swift')
DIAGNOSTIC_STAGES = {'configuration', 'admission', 'initial_snapshot', 'trust', 'helper_identity',
    'waiting_publication', 'deadline', 'configuration_integrity', 'snapshot', 'lifetime',
    'app_window', 'owned_frame', 'ax_observation', 'closing_snapshot', 'closing_lifetime',
    'closing_integrity', 'receipt_publication', 'parent_lost'}
DIAGNOSTIC_CODES = {'ownership_invalid', 'ownership_arguments_unavailable', 'process_probe_unavailable',
                    'decoding_failure', 'foundation_failure', 'other'}
_COUNTER_CAUSES = {'ax_predicate_refused', 'sample_deadline', 'target_retirement'}
_READER_TERMINALS = {'application_timeout', 'windows_unavailable', 'root_matches', 'root_children',
    'root_sheet_count', 'panel_children', 'nested_sheet_count', 'owned_pid', 'foreign_window',
    'incarnation_binding', 'focus_unavailable'}
_CLOSING_BOOLS = {'complete', 'target_fields_valid', 'target_uid_matches_helper', 'process_equal',
    'windows_typed', 'original_present', 'exact_original_singleton', 'retired_inventory_typed'}


def require(value, reason):
    if not value:
        raise RuntimeError(reason)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _failure_context(row):
    """Closed passive operands only; no observation or acceptance authority."""
    fields = {'first_counter_transition', 'closing_lifetime_context'} & set(row)
    if not fields:
        return
    require(row['stage'] in ('lifetime', 'closing_lifetime') and 'pre_refusal_paired' not in row,
            'AX passive context scope')
    if 'first_counter_transition' in row:
        first = row['first_counter_transition']
        require(type(first) is dict and {'cause', 'sequence', 'generation_before'} <= set(first)
            <= {'cause', 'sequence', 'generation_before', 'reader_terminal'}
            and first['cause'] in _COUNTER_CAUSES and first['generation_before'] == '0'
            and type(first['sequence']) is str and re.fullmatch(r'0|[1-9][0-9]{0,19}', first['sequence'])
            and int(first['sequence']) <= int(row['sequence']) < 2**64
            and int(row['refusal_generation']) > 0, 'AX first counter transition')
        if 'reader_terminal' in first:
            require(first['cause'] == 'ax_predicate_refused' and first['reader_terminal'] in _READER_TERMINALS,
                    'AX reader terminal cause')
    if 'closing_lifetime_context' in row:
        require(row['stage'] == 'closing_lifetime', 'AX closing context stage')
        context = row['closing_lifetime_context']
        require(type(context) is dict
            and set(context) == _CLOSING_BOOLS | {'app_count', 'window_count', 'latched', 'retirement_matches'}
            and all(type(context[k]) is bool for k in _CLOSING_BOOLS)
            and all(type(context[k]) is int and 0 <= context[k] <= 128
                    for k in ('app_count', 'window_count', 'retirement_matches'))
            and context['latched'] in ('none', 'retiring', 'retired'), 'AX closing lifetime operands')
        require((context['app_count'] == 1 or not (context['process_equal'] or context['windows_typed']))
            and (context['windows_typed'] or (context['window_count'] == 0
                 and not context['original_present'] and not context['exact_original_singleton']))
            and (not context['original_present'] or context['window_count'] > 0)
            and (not context['exact_original_singleton'] or (context['original_present'] and context['window_count'] == 1))
            and (context['retired_inventory_typed'] or context['retirement_matches'] == 0),
            'AX closing operand consistency')


def paired_diagnostic(row):
    """Closed false-acceptance projection; no AX facts become authority."""
    import uuid
    keys = {'schema', 'acceptance', 'cg_window_count', 'cg_window_ids', 'cg_ids_truncated',
            'original_window_number', 'outcome', 'closing_valid'}
    require(type(row) is dict and keys <= set(row) <= keys | {'canonical'}
        and row['schema'] == 'nac342-ax-pre-refusal-paired-v1' and row['acceptance'] is False,
        'AX paired diagnostic fields')
    count, ids, original = row['cg_window_count'], row['cg_window_ids'], row['original_window_number']
    require(type(count) is int and 2 <= count <= 128 and type(ids) is list
        and len(ids) == min(count, 8) and all(type(n) is int and 0 < n < 2**64 for n in ids)
        and len(set(ids)) == len(ids) and type(original) is int and ids[0] == original
        and row['cg_ids_truncated'] is (count > len(ids)) and type(row['closing_valid']) is bool
        and row['outcome'] in ('observed', 'reader_refused', 'closing_refused'), 'AX paired diagnostic inventory')
    if row['outcome'] != 'observed':
        require('canonical' not in row and (row['outcome'] != 'closing_refused' or not row['closing_valid']),
                'AX paired refused projection')
        return row
    canonical = row.get('canonical')
    require(row['closing_valid'] is True and type(canonical) is dict
        and set(canonical) == {'surface', 'root_id', 'retained_root_equal', 'panel_id', 'go_to_id'}
        and canonical['surface'] in ('form', 'panel', 'goTo') and canonical['retained_root_equal'] is True,
        'AX paired canonical projection')
    for key in ('root_id', 'panel_id', 'go_to_id'):
        value = canonical[key]
        expected = key == 'root_id' or (key == 'panel_id' and canonical['surface'] != 'form') or (key == 'go_to_id' and canonical['surface'] == 'goTo')
        require((type(value) is str and len(value) == 36 and str(uuid.UUID(value)) == value.lower()) if expected else value is None,
                'AX paired opaque identity')
    return row


def declaration(profile, helper, tests):
    check()
    folder = profile['root'] / 'ax-witness'
    require(not folder.exists() and helper.is_absolute() and helper.resolve() == helper, 'AX declaration paths')
    folder.mkdir(mode=0o700)
    time_limit(300, 15)
    from ci import RUN_DEADLINE
    bound = active()
    deadline = min(bound.deadline if bound is not None else RUN_DEADLINE, RUN_DEADLINE) - 15
    require(deadline > time.monotonic(), 'AX original work allowance')
    return dict(path=str(folder / 'receipt.json'), nonce=secrets.token_hex(32), helper_path=str(helper),
        helper_sha256=digest(helper), support_sha256={name: digest(tests / 'desktop/macos/startup_xctest' / name) for name in SUPPORT},
        owner_pid=os.getpid(), deadline_ns=str(int(deadline * 1_000_000_000)))


class AXCompanion:
    def __init__(self, witness, config, config_path, helper, folder, run=None):
        self.witness, self.config, self.config_path = witness, config, config_path
        if run is None:
            from ci import run
        self.helper, self.folder, self.run = helper, folder, run
        self.phase = {}
        self.declaration = config['ax_witness']
        self.bound = active()
        self.thread = None
        self.finished = threading.Event()
        self.stopping = False
        self.error = self.ui_failure = None
        self.identity = None
        self.terminal = None
        self.settlement = None
        self.work_admitted = False

    @property
    def failure(self):
        if self.error is not None or (self.finished.is_set() and not self.stopping):
            self.ui_failure = 'ax_companion_unavailable'
        if self.ui_failure:
            return self.ui_failure
        return None

    def _abort(self):
        # ci.run invokes this before Popen. Failed work cannot acquire a helper;
        # after admission, only this read-only owner may retain its old bound.
        if not self.work_admitted:
            if self.bound is not None:
                self.bound.check()
            self.work_admitted = True
        return bool(self.witness.process_failure
                    or self.witness.ui_failure not in (None, 'app_windows'))

    def start(self):
        require(self.thread is None and self.witness.ready and not self.witness.failure and not self.witness.ui_terminal, 'AX metadata owner not ready')
        self.case_deadline_ns = min(int(self.declaration['deadline_ns']), int((time.monotonic() + time_limit(300)) * 1e9))
        def owned():
            try:
                retained = (self.bound.owner.cleanup.capped(min(self.bound.deadline, self.case_deadline_ns / 1e9))
                            if self.bound is not None else None)
                with using(retained):
                    remaining = self.case_deadline_ns / 1e9 - time.monotonic()
                    require(remaining > 0, 'AX companion original deadline')
                    self.phase = dict(started_epoch=time.time(), cap_seconds=min(300, remaining))
                    # Only this already-owned read-only diagnostic may outlive
                    # app_windows; parent input and every other UI rejection abort.
                    self.run([str(self.helper), '--ax-witness', str(self.config_path), str(self.case_deadline_ns)], self.folder / 'ax-companion.log',
                             min(300, remaining), env=runner_environment(), abort=self._abort, retain_ownership=True)
            except BaseException as error:
                self.error = error
            finally:
                self.phase['ended_epoch'] = time.time()
                if not self.stopping:
                    self.ui_failure = 'ax_companion_unavailable'
                self.finished.set()
        self.thread = threading.Thread(target=owned, daemon=True)
        self.thread.start()
        deadline = time.monotonic() + time_limit(5)
        while time.monotonic() < deadline:
            check()
            require(not self.failure, 'AX companion exited before readiness')
            try:
                row = json.loads(bounded_file(Path(self.declaration['path']), 8192))
            except FileNotFoundError:
                time.sleep(.01)
                continue
            require(row['schema'] == 'nac342-ax-witness-v1' and row['status'] == 'waiting' and row['sequence'] == '0'
                and row['nonce'] == self.declaration['nonce'] and row['trusted'] is True
                and row['case_deadline_ns'] == str(self.case_deadline_ns)
                and row['configuration_sha256'] == digest(self.config_path)
                and row['helper_sha256'] == self.declaration['helper_sha256']
                and row['support_sha256'] == self.declaration['support_sha256'], 'AX companion readiness binding')
            identity = row['helper']
            actual = native_identity(identity['pid'])
            require(actual is not None and all(actual[key] == identity[key] for key in identity)
                and identity['parent'] == os.getpid() and identity['executable'] == str(self.helper), 'AX helper kernel identity')
            self.identity = identity
            return
        raise RuntimeError('AX companion readiness cutoff')

    def stop(self):
        try:
            return self._stop()
        except BaseException as error:
            self.ui_failure = self.ui_failure or 'ax_companion_unavailable'
            if self.error is not None and error is not self.error:
                raise self.error from error
            raise

    def _stop(self):
        if self.thread is None:
            return None
        self.stopping = True
        # Share the original stop allowance with teardown; never renew it.
        stop_deadline, budget_error = time.monotonic(), None
        try:
            stop_deadline += time_limit(20)
        except BudgetExpired as error:
            budget_error = error  # Still publish stop and attempt a nonblocking join.
        path = Path(self.declaration['path'] + '.stop')
        temporary = path.with_suffix('.next')
        require(path.parent.resolve() == path.parent and not path.exists() and not temporary.exists(), 'AX stop custody')
        if (self.identity is not None and self.witness.ui_failure == 'app_windows'
                and self.witness.process_failure is None):
            # Input already failed. Give only this existing read-only owner a
            # chance to emit its fatal diagnostic, retaining 15s for teardown.
            diagnostic_deadline = min(stop_deadline - 15, self.case_deadline_ns / 1e9)
            while not self.finished.is_set() and self.witness.process_failure is None:
                remaining = diagnostic_deadline - time.monotonic()
                if remaining <= 0:
                    break
                self.finished.wait(min(.05, remaining))
        with temporary.open('xb') as stream:
            stream.write(self.declaration['nonce'].encode())
        temporary.chmod(0o400)
        os.replace(temporary, path)
        if budget_error is not None:
            self.thread.join(timeout=0)
            raise budget_error
        self.thread.join(timeout=time_limit(max(0, stop_deadline - time.monotonic())))
        require(not self.thread.is_alive(), 'AX companion process owner not settled')
        log = self.folder / 'ax-companion.log.ownership.json'
        owner = json.loads(bounded_file(log, 32768))
        require(all(owner[key] is True for key in ('accepted', 'reaped', 'drain_settled'))
            and owner['unknown'] is False and owner['teardown_error'] is None
            and type(owner['pid']) is int and owner['pid'] > 0
            and (self.identity is None or owner['pid'] == self.identity['pid']), 'AX companion positive settlement')
        self.settlement = dict(owned_processes_settled=True, helper=self.identity,
            helper_sha256=self.declaration['helper_sha256'], phase=self.phase,
            scope='Read-only AX companion only; not app/UI acceptance')
        if self.error is not None:
            raise self.error
        row = json.loads(bounded_file(Path(self.declaration['path']), 8192))
        if row.get('status') in ('retired', 'retiring'):
            require(row['schema'] == 'nac342-ax-witness-v1' and row['trusted'] is True
                and row['nonce'] == self.declaration['nonce'] and row['helper'] == self.identity
                and row['configuration_sha256'] == digest(self.config_path)
                and row['helper_sha256'] == self.declaration['helper_sha256']
                and row['support_sha256'] == self.declaration['support_sha256']
                and row['case_deadline_ns'] == str(self.case_deadline_ns)
                and row.get('observation') is None and row.get('refusal') is None
                and row['refusal_stage'] == 'target_' + row['status'], 'AX terminal receipt binding')
            self.terminal = {key: row[key] for key in ('target', 'app_launch_epoch', 'window_number', 'status')}
        return self.settlement

    def failure_diagnostic(self):
        """Read only the bounded static failure log; absence never affects custody."""
        try:
            data = bounded_file(self.folder / 'ax-companion.log', 2048)
            require(data.endswith(b'\n') and data.count(b'\n') == 1, 'AX diagnostic framing')
            def unique(pairs):
                row = {}
                for key, value in pairs:
                    require(key not in row, 'AX diagnostic duplicate field')
                    row[key] = value
                return row
            row = json.loads(data, object_pairs_hook=unique)
            required = {'schema', 'acceptance', 'stage', 'code', 'clock_basis',
                'observed_uptime_ns', 'sequence', 'refusal_generation', 'binding'}
            require(type(row) is dict and required <= set(row) <= required | {'pre_refusal_paired',
                    'first_counter_transition', 'closing_lifetime_context'}
                and row['schema'] == 'nac342-ax-failure-diagnostic-v1' and row['acceptance'] is False
                and row['stage'] in DIAGNOSTIC_STAGES and row['code'] in DIAGNOSTIC_CODES
                and row['clock_basis'] == 'DispatchTime.uptimeNanoseconds', 'AX diagnostic fields')
            for key in ('observed_uptime_ns', 'sequence', 'refusal_generation'):
                value = row[key]
                require(type(value) is str and re.fullmatch(r'0|[1-9][0-9]{0,19}', value)
                        and int(value) < 2**64, 'AX diagnostic counter')
            expected = {key: self.config[key] for key in ('source_sha', 'test_source_sha', 'harness_sha')}
            expected.update(configuration_sha256=digest(self.config_path), helper_sha256=self.declaration['helper_sha256'])
            require(type(row['binding']) is dict and row['binding'] == expected, 'AX diagnostic source binding')
            if 'pre_refusal_paired' in row:
                paired_diagnostic(row['pre_refusal_paired'])
            _failure_context(row)
            return row
        except BaseException:
            return None  # No new acceptance, stop, cleanup or failure precedence.


    def reconcile_retirement(self, settled, collection):
        if self.terminal is None:
            return {'terminal_observed': False}
        require(collection is not None and collection.get('complete') is True
            and settled.get('owned_processes_settled') is True and settled.get('complete_observation') is True,
            'AX retirement requires complete case and metadata settlement')
        app, target = settled['app'], self.terminal['target']
        require(signature(app) == signature(target) and app['windows'] == [self.terminal['window_number']]
            and app['app_launch_epoch'] == self.terminal['app_launch_epoch'], 'AX retired target differs')
        history = settled['observed_processes']
        retired = settled['retired_identities']
        require(history and signature(target) in {signature(node) for node in history}
            and len(retired) == len(history)
            and all(item['proof'] == 'kill_zero_ESRCH' for item in retired)
            and {signature(item['identity']) for item in retired} == {signature(node) for node in history}
            and any(node.get('kind') == 'engine' and node.get('serving') is True for node in history),
            'AX retirement requires exact app and engine settlement')
        return {'terminal_observed': self.terminal['status'] == 'retired', 'retiring_observed': self.terminal['status'] == 'retiring',
                'case_complete': True, 'metadata_settlement_verified': True}


def guard_phases():
    phases, current = ['form', 'form'], 'form'
    for operation in range(1, 12):
        phases.append(current)
        current = {2: 'panel', 3: 'goTo', 6: 'panel', 7: 'form'}.get(operation, current)
        phases.append(current)
    return phases + ['form', 'form']


def require_guard_proof(row, config, configuration_sha256, witness):
    """Validate the exact26 consumed receipts; never export private field values."""
    import uuid
    expected = {key: config[key] for key in ('source_sha', 'test_source_sha', 'harness_sha')}
    expected.update({key: witness[key] for key in ('app_pid', 'app_launch_epoch', 'window_number')})
    expected.update(schema='nac342-ax-guards-v1', configuration_sha256=configuration_sha256,
                    helper_sha256=config['ax_witness']['helper_sha256'], support_sha256=config['ax_witness']['support_sha256'])
    require(type(row) is dict and set(row) == set(expected) | {'rows'}
        and all(row[k] == v and type(row[k]) is type(v) for k, v in expected.items() if k != 'app_launch_epoch')
        and type(row['app_launch_epoch']) in (int, float) and row['app_launch_epoch'] == witness['app_launch_epoch'], 'AX guard header')
    require(type(row['rows']) is list and len(row['rows']) == 26, 'AX guard count')
    previous = 0
    identities = {}
    def number(text):
        require(type(text) is str and text.isdecimal() and str(int(text)) == text and 0 <= int(text) < 2**64, 'AX guard counter')
        return int(text)
    for entry, phase in zip(row['rows'], guard_phases()):
        keys = {'sequence', 'began_ns', 'ended_ns', 'entered_ns', 'consumed_ns', 'surface', 'root_id', 'focus_checked'}
        if phase != 'form': keys.add('panel_id')
        if phase == 'goTo': keys.add('go_to_id')
        require(type(entry) is dict and set(entry) == keys and entry['surface'] == phase
            and type(entry['focus_checked']) is bool and entry['focus_checked'] == (phase == 'goTo'), 'AX guard phase/fields')
        sequence, began, ended, entered, consumed = [number(entry[k]) for k in
            ('sequence', 'began_ns', 'ended_ns', 'entered_ns', 'consumed_ns')]
        require(sequence > previous and entered < began <= ended <= consumed
            and ended - began <= 1_000_000_000 and consumed - ended <= 1_000_000_000
            and consumed - entered < 30_000_000_000, 'AX guard freshness')
        previous = sequence
        for key in ('root_id', 'panel_id', 'go_to_id'):
            if key not in entry: continue
            value = entry[key]
            require(type(value) is str and len(value) == 36 and str(uuid.UUID(value)) == value.lower()
                and identities.get(key, value) == value, 'AX guard retained identity')
            identities[key] = value
    return row
