#!/usr/bin/env python3
"""Actual LOCAL_APP/system WK lifecycle, with programmatic AppKit sheet replies.

Reuses the instance owner's LaunchServices/identity/focus fixture and the real
Quit workspace fixture. It never sends OS input events or claims visible paint.
Run only through the coordinated Mac/browser lease with an exact lifecycle app.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

from instance_contract import OwnedEngine, digest
from instance_smoke import AppJourney, engine_settled, verify_embedded_assets, wait_for
from quit_fixture import QuitWorkspaceFixture, TRANSCRIPT, request
from smoke import session_lock_state


def run_contract(bundle, destination, observer):
    bundle, destination, observer = map(lambda path: Path(path).resolve(), (bundle, destination, observer))
    destination.mkdir(parents=True, exist_ok=True)
    receipt = json.loads((bundle / 'Contents/Resources/build-receipt.json').read_text())
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    assert receipt['source_head'] == head and receipt['engine_identity']['source_revision'] == head
    assert receipt['lifecycle_smoke_instrumentation'] and receipt['normal_startup']
    assert receipt['engine_sha256'] == digest(bundle / 'Contents/Resources/nac-web')
    assert receipt['native_sha256'] == digest(bundle / 'Contents/MacOS/NACPreview')
    evidence = dict(source_head=head, build_receipt=receipt, console_lock=session_lock_state(),
                    visible_paint_acceptance=False, trusted_input_acceptance=False,
                    actual_local_app=True, system_wk=True, sheet_completion='programmatic AppKit; no OS input events', cases=[])
    root = Path(tempfile.mkdtemp(prefix='nac-lifecycle-app-', dir=destination)).resolve()
    moved = root / 'Relocated app folder with spaces' / bundle.name
    shutil.copytree(bundle, moved)
    summary = destination / 'summary.json'
    try:
        for scenario in os.environ.get('NAC_LIFECYCLE_SCENARIOS', 'run,approval,terminal').split(','):
            assert scenario in ('run', 'approval', 'terminal'), scenario
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
            try:
                subprocess.run(['/usr/bin/git', 'init', '--quiet', '--initial-branch=main', str(profile)],
                               env=environment, check=True, timeout=5)
                journey = AppJourney(moved, case / 'native.json', profile, environment, store, observer)
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
                fixture.retire_streams() # The real WK document now owns the interactive observer.
                fixture.assert_work_running()
                journey.command_file('close')
                closed = journey.stage('closed')
                assert closed['close_retained_owners'] and not engine_settled(moved, ready_pid)
                fixture.assert_work_running()
                assert request(ready['base_url'], '/sessions/' + fixture.approval_session + '/permissions')['requests']
                # LaunchServices sends the app's real reopen event to this same
                # bundle. It does not create or adopt another engine instance.
                journey.launch()
                reopened = journey.stage('reopened')
                assert reopened['reopen_retained_usable_workspace']
                fixture.assert_work_running()
                journey.command_file('quit')
                journey.stage('confirming')
                fixture.assert_work_running()
                journey.command_file('duplicate-quit')
                # Preserve the original immediate duplicate/Cancel race in the
                # run case; the other cases prove a duplicate reached the real
                # delegate while its first confirmation was still outstanding.
                if scenario != 'run':
                    journey.stage('duplicate-confirming')
                journey.command_file('cancel')
                cancelled = journey.stage('cancelled')
                assert cancelled['cancel_retained_owners']
                fixture.assert_work_running()
                journey.command_file('quit-again')
                journey.stage('reconfirming')
                started = time.monotonic()
                journey.command_file('stop')
                stopped = wait_for('Actual native Stop and Quit cleanup',
                                   lambda: (value if (value := journey.read()).get('stopped') else None), timeout=30)
                assert stopped['passed'] and stopped['document_released'] and stopped['commands_retired'], stopped
                wait_for('App exited after Stop and Quit', lambda: not journey.observe()['apps'], timeout=6)
                stopped = journey.read() # Includes the final willTerminate snapshot/reply counters.
                assert stopped['application_class'] == 'NACApplication', stopped
                assert stopped['quit_delegate_requests'] == stopped['quit_sheet_presentations'] == 2, stopped
                assert stopped['quit_cancel_replies'] == stopped['quit_stop_replies'] == 1, stopped
                assert stopped['suppressed_termination_entries'] >= 1 and stopped['termination_entries'] >= 3, stopped
                assert engine_settled(moved, ready_pid)
                after = fixture.verify_store(store)
                replacement = OwnedEngine(moved / 'Contents/Resources/nac-web', profile, store, environment, desktop=True)
                replacement.ready()
                messages = request(replacement.endpoint, '/sessions/' + fixture.session + '/messages?include_system=true&limit=200')
                assert TRANSCRIPT in json.dumps(messages)
                fixture.verify_store(store)
                replacement.stop()
                evidence['cases'].append(dict(scenario=scenario, native=stopped, **after,
                    shutdown_seconds=round(time.monotonic() - started, 3),
                    store_reacquired=True, durable_transcript_preserved=True, assets=assets))
                journey.restore_prior()
                journey.log.close()
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
