"""Owning ALL-344 failure-status prefix, before ALL-345 renderer recovery.

Uses the existing lifecycle fixture's real delegate callback and owned Quit.
This is callback injection, not an actual WebKit crash or OS shutdown case.
"""
from contextlib import closing
import sqlite3
import time

from instance_smoke import wait_for
from lifecycle_fixture import alive
from quit_fixture import request


DISCONNECTED_DENIAL = ('Error: permission denied for exec_command: '
                       'the interactive session client disconnected while approval was pending')
PROVIDER_PREFIX = ['transcript', 'goal', 'approval']


def approval_snapshot(fixture):
    snapshot = request(fixture.endpoint, '/sessions/' + fixture.approval_session)
    # The public session snapshot omits this counter. It belongs to the
    # published session summary inventory, not internal SessionMetadata.
    summaries = request(fixture.endpoint, '/sessions')
    matching = [entry['summary'] for entry in summaries
                if entry['summary']['session_id'] == fixture.approval_session]
    assert len(matching) == 1, 'Original approval session missing/ambiguous'
    return snapshot, matching[0]['run_count']


def approval_origin(fixture):
    """Capture the actual pending request and its admission before view loss."""
    fixture.assert_work_running()
    permissions = request(fixture.endpoint, '/sessions/' + fixture.approval_session + '/permissions')
    pending = permissions['requests']
    assert len(pending) == 1 and pending[0]['session_id'] == fixture.approval_session
    assert pending[0]['call_id'] == 'quit-unapproved-command' and pending[0]['tool'] == 'exec_command'
    snapshot, count = approval_snapshot(fixture)
    model = request(fixture.endpoint, '/sessions/' + fixture.session)
    assert snapshot['active_run'] and model['active_run']
    return dict(request=pending[0], run_id=snapshot['active_run']['run_id'],
                run_count=count, model_run_id=model['active_run']['run_id'])


def approval_state(origin, permissions, snapshot, provider_requests, denied_outputs, run_count):
    """Only the original Ask or its exact, once-only fail-closed continuation."""
    assert permissions['approval_mode'] == 'manual' and permissions['grants'] == []
    assert snapshot['metadata']['session_id'] == origin['request']['session_id']
    assert type(run_count) is int and type(origin['run_count']) is int
    assert run_count == origin['run_count'] == 1
    active = snapshot.get('active_run')
    assert active is None or active['run_id'] == origin['run_id'], 'Approval admission changed'
    assert provider_requests in (PROVIDER_PREFIX, PROVIDER_PREFIX + ['approval-denied'])
    assert denied_outputs in ([], [DISCONNECTED_DENIAL]), 'Unknown, repeated or unrelated approval result'
    if permissions['requests']:
        assert permissions['requests'] == [origin['request']], 'Original approval request changed'
        if active is None or provider_requests != PROVIDER_PREFIX or denied_outputs:
            return None  # These separate reads straddled a terminal transition.
        return dict(kind='original-pending', request_id=origin['request']['id'], run_id=origin['run_id'],
                    disconnected_denial_observed=False)
    if not denied_outputs:
        return None  # A missing Ask alone never proves denial or safe settlement.
    if provider_requests != PROVIDER_PREFIX + ['approval-denied'] or active is not None:
        return None  # Await the same run's actual completed continuation.
    return dict(kind='disconnected-denied', request_id=origin['request']['id'], run_id=origin['run_id'],
                disconnected_denial_observed=True, denial=DISCONNECTED_DENIAL)


def renderer_survival(fixture, origin):
    """View loss can remove the last approver; it must never grant the Ask."""
    def observed():
        fixture.assert_unapproved()  # Includes actual empty execution inventory.
        permissions = request(fixture.endpoint, '/sessions/' + fixture.approval_session + '/permissions')
        snapshot, count = approval_snapshot(fixture)
        return approval_state(origin, permissions, snapshot,
                              list(fixture.provider.requests), list(fixture.provider.denied_outputs), count)
    approval = wait_for('Original renderer approval or exact disconnected-denial', observed, timeout=5)
    model = request(fixture.endpoint, '/sessions/' + fixture.session)
    assert (model.get('active_run') or {}).get('run_id') == origin['model_run_id'], 'Independent work changed'
    assert alive(fixture.descendant), 'Renderer failure stopped the live terminal descendant'
    inbox = sorted((item['id'], session) for session in (fixture.session, fixture.approval_session)
                   for item in request(fixture.endpoint, '/sessions/' + session + '/inbox'))
    assert inbox == fixture.inbox_identity, 'Renderer loss admitted or replayed input'
    return dict(approval=approval, same_model_run=True, live_terminal_descendant=True,
                manual_mode_preserved=True, no_grants=True, no_execution=True, same_inbox=True)


def verify_renderer_store(store, origin, observation):
    with closing(sqlite3.connect(store.as_uri() + '?mode=ro', uri=True)) as connection:
        outcomes = connection.execute('SELECT run_id,disposition FROM session_run_outcomes WHERE session_id=?',
                                      [origin['request']['session_id']]).fetchall()
    assert len(outcomes) == 1 and outcomes[0][0] == origin['run_id'], 'Approval run was replaced/replayed'
    allowed = ('completed',) if observation['approval']['kind'] == 'disconnected-denied' else ('completed', 'cancelled')
    assert outcomes[0][1] in allowed, outcomes
    return dict(original_run_id=outcomes[0][0], disposition=outcomes[0][1], no_new_admission=True)


def exercise_hidden_renderer(journey, fixture, origin):
    journey.command_file('renderer-loss')
    failed = journey.stage('renderer-failed')
    assert failed['renderer_callback_injected'] and failed['renderer_retained_engine']
    assert failed['actual_renderer_crash'] is False
    assert 'running work continues' in failed['renderer_failure_status']
    assert 'Quit NAC' in failed['renderer_failure_status']
    observations = [renderer_survival(fixture, origin)]
    # The same existing LaunchServices reopen presents the truthful failure
    # status. No foreign surface is activated and no replacement engine starts.
    journey.launch()
    reopened = journey.stage('renderer-reopened')
    assert reopened['renderer_status_reopened']
    assert reopened['engine_pid'] == failed['engine_pid']
    assert reopened['launch_incarnation'] == failed['launch_incarnation']
    observations.append(renderer_survival(fixture, origin))
    journey.command_file('quit')
    confirming = journey.stage('renderer-confirming')
    assert confirming['renderer_confirmation_retained_engine']
    assert confirming['quit_confirmation_decisions'] == confirming['quit_sheet_presentations'] == 1
    observations.append(renderer_survival(fixture, origin))
    started = time.monotonic()
    journey.command_file('stop')
    stopped = wait_for('Renderer failure explicit Stop and Quit cleanup',
                      lambda: (value if (value := journey.read()).get('stopped') else None), timeout=30)
    assert stopped['passed'] and stopped['document_released'] and stopped['commands_retired'], stopped
    wait_for('Renderer failure app exit', lambda: not journey.observe()['apps'], timeout=6)
    stopped = journey.read()
    assert stopped['quit_confirmation_decisions'] == stopped['quit_sheet_presentations'] == 1
    assert stopped['quit_stop_completions'] == 1 and stopped['quit_cancel_choices'] == 0
    assert stopped['application_will_terminate'] and stopped['termination_phase'].startswith('finished(')
    return stopped, started, observations
