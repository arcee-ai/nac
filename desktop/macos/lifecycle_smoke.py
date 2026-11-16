#!/usr/bin/env python3
"""Actual LOCAL_APP/system WK lifecycle, with programmatic AppKit sheet replies.

Reuses the instance owner's LaunchServices/identity/focus fixture and the real
Quit workspace fixture. It never sends OS input events or claims visible paint.
Run only through the coordinated Mac/browser lease with an exact lifecycle app.
"""
import json
import os
import plistlib
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

from instance_contract import OwnedEngine, digest
from instance_smoke import AppJourney, engine_settled, verify_embedded_assets, wait_for
from quit_fixture import QuitWorkspaceFixture, TRANSCRIPT, request
from smoke import session_lock_state
from instance_console import require_console
from lifecycle_renderer import approval_origin, exercise_hidden_renderer, verify_renderer_store


def console_state():
    """Observe both published lock fields; any locked value prevents capture."""
    session = session_lock_state()
    values = [session['locked']] if session['observed'] else []
    root = plistlib.loads(subprocess.check_output(['/usr/sbin/ioreg', '-n', 'Root', '-d', '1', '-a', '-l']))
    nodes = root if isinstance(root, list) else [root]
    for node in nodes:
        if isinstance(node, dict) and isinstance(node.get('IOConsoleLocked'), bool):
            values.append(node['IOConsoleLocked'])
    return dict(observed=bool(values), locked=any(values) if values else None)


def minimize_before_quit(journey, command, ready_pid):
    """Actual native property receipt before the existing public Quit request."""
    assert command in ('minimize-quit', 'minimize-quit-again')
    journey.guard_focus()
    journey.command_file(command)
    record = journey.stage(command + '-ready')[command]
    assert record['miniaturized'] is True and record['owners_intact'] is True, record
    assert record['termination_pending'] is False and record['sheet_window'] == 0, record
    assert record['engine_pid'] == ready_pid and record['window_number'] > 0, record
    return record


def verify_minimized_quit(stopped):
    """Programmatic AppKit evidence only; no composited/physical-input claim."""
    import math
    phases = ('minimize-quit', 'minimize-quit-again')
    bindings = ('window_number', 'document', 'engine_pid', 'launch_incarnation')
    first = stopped[phases[0]]
    assert all(first[key] for key in bindings), stopped
    assert first['window_number'] == stopped['workspace_window_number'], stopped
    assert first['engine_pid'] == stopped['owned_engine_pid'], stopped
    duplicate = stopped['native_duplicate_invocation']['before']
    assert all(first[key] == duplicate[key] for key in ('document', 'engine_pid', 'launch_incarnation')), stopped
    ordered = []
    restored = []
    for command in phases:
        before, after = stopped[command], stopped['restored-' + command]
        assert all(before[key] == after[key] == first[key] for key in bindings), stopped
        assert before['miniaturized'] is True and before['termination_pending'] is False, stopped
        assert before['sheet_window'] == 0 and before['confirmation_id'] == '', stopped
        assert after['miniaturized'] is False and after['visible'] is True and after['front'] is True, stopped
        assert after['sheet_window'] > 0 and after['confirmation_id'] and after['termination_pending'] is True, stopped
        for observation in (before, after):
            assert observation['owners_intact'] is True and observation['stop_started'] is False, stopped
        ordered.extend([before['observed_uptime'], after['observed_uptime']])
        restored.append(after)
    cancel = stopped['cancel_after_minimized_quit']
    assert all(cancel[key] == first[key] for key in bindings), stopped
    assert cancel['owners_intact'] is True and cancel['stop_started'] is False, stopped
    assert cancel['termination_pending'] is False and cancel['sheet_window'] == 0 and cancel['confirmation_id'] == '', stopped
    assert cancel['miniaturized'] is False, stopped
    ordered.insert(2, cancel['observed_uptime'])
    assert all(type(t) in (int, float) and math.isfinite(t) and t > 0 for t in ordered), stopped
    assert all(left < right for left, right in zip(ordered, ordered[1:])), stopped
    assert restored[0]['confirmation_id'] == stopped['native_duplicate_invocation']['before']['confirmation_id'], stopped
    assert restored[0]['confirmation_id'] != restored[1]['confirmation_id'], stopped


def verify_native_quit_completion(stopped):
    assert stopped['application_class'] == 'NACApplication', stopped
    assert stopped['quit_confirmation_decisions'] == stopped['quit_sheet_presentations'] == 2, stopped
    assert stopped['quit_cancel_choices'] == stopped['quit_stop_completions'] == 1, stopped
    invocation = stopped['native_duplicate_invocation']
    assert invocation['command'] == 'duplicate-quit' and invocation['id'], stopped
    assert invocation['issued'] and invocation['outcome'] == 'settled', stopped
    assert invocation['began_uptime'] <= invocation['returned_uptime'] < invocation['deadline_uptime'], stopped
    assert invocation['cancel_dispatched_uptime'] >= invocation['returned_uptime'], stopped
    assert invocation['prefix'] == invocation['before'], stopped
    assert invocation['began'] and invocation['returned'] and stopped['native_duplicate_returned'], stopped
    before, after = invocation['before'], invocation['after']
    assert before['confirmation_id'] and before['confirmation_id'] == after['confirmation_id'], stopped
    assert before['sheet_window'] > 0 and before['sheet_window'] == after['sheet_window'], stopped
    assert before['document'] and before['document'] == after['document'], stopped
    assert before['engine_pid'] > 0 and before['engine_pid'] == after['engine_pid'], stopped
    assert before['launch_incarnation'] and before['launch_incarnation'] == after['launch_incarnation'], stopped
    for snapshot in (before, after):
        assert snapshot['owners_intact'] and not snapshot['stop_started'], stopped
        assert snapshot['confirmation_decisions'] == snapshot['sheet_presentations'] == 1, stopped
        assert snapshot['cancel_choices'] == snapshot['stop_completions'] == 0, stopped
    assert stopped['native_duplicate_delegate_before'] == before['delegate_calls'], stopped
    assert stopped['native_duplicate_delegate_after'] == after['delegate_calls'], stopped
    # Record zero or one callbacks without assigning a general AppKit cause.
    # The actual invocation/return and unchanged live episode prove this path.
    assert after['delegate_calls'] - before['delegate_calls'] in (0, 1), stopped
    assert before['delegate_calls'] >= 1, stopped
    assert stopped['quit_delegate_requests'] >= after['delegate_calls'] + 1, stopped
    assert stopped['quit_delegate_requests'] >= stopped['quit_confirmation_decisions'], stopped
    assert stopped['application_will_terminate'], stopped
    assert stopped['termination_phase'].startswith('finished('), stopped


def run_contract(bundle, destination, observer):
    bundle, destination, observer = map(lambda path: Path(path).resolve(), (bundle, destination, observer))
    destination.mkdir(parents=True, exist_ok=True)
    receipt = json.loads((bundle / 'Contents/Resources/build-receipt.json').read_text())
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    assert receipt['source_head'] == head and receipt['engine_identity']['source_revision'] == head
    assert receipt['lifecycle_smoke_instrumentation'] and receipt['normal_startup']
    assert receipt['engine_sha256'] == digest(bundle / 'Contents/Resources/nac-web')
    assert receipt['native_sha256'] == digest(bundle / 'Contents/MacOS/NACPreview')
    console_checks = []
    require_console(observer, console_checks, "lifecycle-preflight")
    evidence = dict(source_head=head, build_receipt=receipt, console_lock=console_state(),
                    console_checks=console_checks,
                    console_lock_sources='CGSSessionScreenIsLocked and Root.IOConsoleLocked when present',
                    os=subprocess.check_output(['/usr/bin/sw_vers', '-productVersion'], text=True).strip(),
                    visible_paint_acceptance=False, trusted_input_acceptance=False,
                    actual_local_app=True, system_wk=True, sheet_completion='programmatic AppKit; no OS input events', cases=[])
    with Path('/System/Library/Frameworks/WebKit.framework/Resources/Info.plist').open('rb') as stream:
        evidence['system_webkit_version'] = plistlib.load(stream)['CFBundleVersion']
    root = Path(tempfile.mkdtemp(prefix='nac-lifecycle-app-', dir=destination)).resolve()
    moved = root / 'Relocated app folder with spaces' / bundle.name
    shutil.copytree(bundle, moved)
    summary = destination / 'summary.json'
    try:
        for scenario in os.environ.get('NAC_LIFECYCLE_SCENARIOS', 'run,approval,terminal').split(','):
            assert scenario in ('run', 'approval', 'terminal', 'renderer-hidden'), scenario
            profile = root / scenario
            profile.mkdir(mode=0o700)
            case = destination / scenario
            case.mkdir(exist_ok=True)
            fixture = QuitWorkspaceFixture(profile)
            environment = dict(HOME=str(profile), NAC_HOME=str(profile / 'nac-home'),
                PATH='/usr/bin:/bin:/usr/sbin:/sbin', LANG='en_US.UTF-8', BROWSER='none',
                NAC_TELEMETRY='disabled', NAC_ORCHESTRATION='0', GIT_CONFIG_NOSYSTEM='1',
                GIT_CONFIG_GLOBAL='/dev/null', MODELS_DEV_URL=fixture.provider.endpoint + '/models-dev',
                OPENAI_API_KEY='quit-fixture-dummy-only')
            store = profile / 'selected store.db'
            journey, replacement = None, None
            os_requests = []
            try:
                subprocess.run(['/usr/bin/git', 'init', '--quiet', '--initial-branch=main', str(profile)],
                               env=environment, check=True, timeout=5)
                journey = AppJourney(moved, case / 'native.json', profile, environment, store, observer, console_checks)
                journey.command[journey.command.index('--instance-scenario') + 1] = scenario
                journey.launch()
                ready = journey.stage('ready')
                assert ready['ready_source'] == head and Path(ready['ready_store']) == store
                ready_pid = ready['engine_pid']
                assets = verify_embedded_assets(ready['base_url'])
                prepared = fixture.prepare(ready['base_url'])
                (journey.control / 'fixture.json').write_text(json.dumps(prepared))
                journey.command_file('prepare')
                journey.stage('work-ready')
                def capture(name):
                    if console_state() == dict(observed=True, locked=False):
                        journey.guard_focus()
                        journey.command_file('capture-' + name)
                        wait_for('Lifecycle render capture ' + name,
                                 lambda: name in journey.read().get('render_captures', []), timeout=10)
                        return True
                    return False

                capture('work-ready')
                fixture.retire_streams() # The real WK document now owns the interactive observer.
                fixture.assert_work_running()
                origin = approval_origin(fixture) if scenario == 'renderer-hidden' else None
                journey.command_file('close')
                closed = journey.stage('closed')
                assert closed['close_retained_owners'] and not engine_settled(moved, ready_pid)
                fixture.assert_work_running()
                assert request(ready['base_url'], '/sessions/' + fixture.approval_session + '/permissions')['requests']
                if scenario == 'renderer-hidden':
                    stopped, started, renderer_observations = exercise_hidden_renderer(journey, fixture, origin)
                else:
                    # LaunchServices sends the app's real reopen event to this same
                    # bundle. It does not create or adopt another engine instance.
                    journey.launch()
                    reopened = journey.stage('reopened')
                    assert reopened['reopen_retained_usable_workspace']
                    capture('reopened')
                    fixture.assert_work_running()
                    def os_quit():
                        result = json.loads(subprocess.check_output([str(observer), 'terminate', str(moved),
                                                                    json.dumps(journey.identity)], text=True, timeout=4))
                        assert result.get('termination_requested'), result
                        os_requests.append(result)

                    minimize_before_quit(journey, 'minimize-quit', ready_pid)
                    fixture.assert_work_running()
                    if scenario == 'terminal':
                        os_quit() # First Quit originates from the public OS application API.
                    else:
                        journey.command_file('quit')
                    confirming = journey.stage('confirming')
                    assert confirming['quit_delegate_requests'] == confirming['quit_confirmation_decisions'] == 1, confirming
                    capture('confirming')
                    fixture.assert_work_running()
                    if scenario == 'terminal':
                        os_quit() # Reentrant requests may coalesce before reaching native entry.
                    journey.command_file('duplicate-quit')
                    # Preserve the original immediate duplicate/Cancel race in the
                    # run case; the other cases prove a duplicate reached the real
                    # delegate while its first confirmation was still outstanding.
                    if scenario != 'run':
                        journey.stage('duplicate-confirming')
                        fixture.assert_work_running()
                    journey.command_file('cancel')
                    cancelled = journey.stage('cancelled')
                    assert cancelled['cancel_retained_owners']
                    capture('cancelled')
                    fixture.assert_work_running()
                    minimize_before_quit(journey, 'minimize-quit-again', ready_pid)
                    fixture.assert_work_running()
                    journey.command_file('quit-again')
                    journey.stage('reconfirming')
                    started = time.monotonic()
                    journey.command_file('stop')
                    stopped = wait_for('Actual native Stop and Quit cleanup',
                                       lambda: (value if (value := journey.read()).get('stopped') else None), timeout=30)
                    assert stopped['passed'] and stopped['document_released'] and stopped['commands_retired'], stopped
                    wait_for('App exited after Stop and Quit', lambda: not journey.observe()['apps'], timeout=6)
                    stopped = journey.read() # Includes the final settled-termination snapshot.
                    verify_native_quit_completion(stopped)
                    verify_minimized_quit(stopped)
                assert engine_settled(moved, ready_pid)
                after = fixture.verify_store(store)
                if scenario == 'renderer-hidden':
                    after['renderer_work_observations'] = renderer_observations
                    after['renderer_approval_outcome'] = verify_renderer_store(store, origin, renderer_observations[-1])
                replacement = OwnedEngine(moved / 'Contents/Resources/nac-web', profile, store, environment, desktop=True)
                replacement.ready()
                messages = request(replacement.endpoint, '/sessions/' + fixture.session + '/messages?include_system=true&limit=200')
                assert TRANSCRIPT in json.dumps(messages)
                fixture.verify_store(store)
                replacement.stop()
                evidence['cases'].append(dict(scenario=scenario, native=stopped, **after,
                    initial_quit_origin='owned OS application request' if os_requests else 'native app action',
                    os_termination_requests=os_requests,
                    shutdown_seconds=round(time.monotonic() - started, 3),
                    store_reacquired=True, durable_transcript_preserved=True, assets=assets))
                journey.restore_prior()
                journey.log.close()
            except BaseException as error:
                native = json.loads(journey.output.read_text()) if journey and journey.output.exists() else {}
                evidence['failed_case_before_cleanup'] = dict(scenario=scenario, failure=str(error),
                                                              native=native, os_termination_requests=os_requests)
                raise
            finally:
                try:
                    fixture.retire_streams()
                    if replacement:
                        replacement.close()
                    if journey:
                        # Existing exact-incarnation cleanup only. A failed
                        # fixture can settle its own native sheet without input.
                        if journey.observe()['apps']:
                            (journey.control / 'quit-again').touch(exist_ok=True)
                            (journey.control / 'stop').touch(exist_ok=True)
                            try:
                                journey.cleanup()
                            except TimeoutError:
                                for identity in journey.observe()['apps']:
                                    if identity == journey.identity:
                                        subprocess.run([str(observer), 'crash', str(moved), json.dumps(identity)],
                                                       check=True, capture_output=True, timeout=4)
                                wait_for('Failed fixture parent-loss engine cleanup',
                                         lambda: engine_settled(moved, json.loads(journey.output.read_text()).get('engine_pid') or
                                                               json.loads(journey.output.read_text()).get('owned_engine_pid')), timeout=25)
                        elif not journey.log.closed:
                            journey.log.close()
                        raw = json.loads(journey.output.read_text()) if journey.output.exists() else {}
                        wait_for('Owned engine cleanup even after unexpected app exit',
                                 lambda: engine_settled(moved, raw.get('owned_engine_pid') or raw.get('engine_pid')), timeout=25)
                finally:
                    fixture.close()
        evidence['passed'] = True
    except BaseException as error:
        evidence.update(passed=False, failure=str(error), fixture_retained=str(root))
        raise
    finally:
        summary.write_text(json.dumps(evidence, indent=2) + '\n')
        if evidence.get('passed'):
            shutil.rmtree(root)
    return evidence


if __name__ == '__main__':
    import sys
    print(json.dumps(run_contract(*sys.argv[1:]), indent=2))
