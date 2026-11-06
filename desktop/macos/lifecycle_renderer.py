"""Owning ALL-344 failure-status prefix, before ALL-345 renderer recovery.

Uses the existing lifecycle fixture's real delegate callback and owned Quit.
This is callback injection, not an actual WebKit crash or OS shutdown case.
"""
import time

from instance_smoke import wait_for


def exercise_hidden_renderer(journey, fixture):
    journey.command_file('renderer-loss')
    failed = journey.stage('renderer-failed')
    assert failed['renderer_callback_injected'] and failed['renderer_retained_engine']
    assert failed['actual_renderer_crash'] is False
    assert 'running work continues' in failed['renderer_failure_status']
    assert 'Quit NAC' in failed['renderer_failure_status']
    fixture.assert_work_running()
    # The same existing LaunchServices reopen presents the truthful failure
    # status. No foreign surface is activated and no replacement engine starts.
    journey.launch()
    reopened = journey.stage('renderer-reopened')
    assert reopened['renderer_status_reopened']
    assert reopened['engine_pid'] == failed['engine_pid']
    assert reopened['launch_incarnation'] == failed['launch_incarnation']
    fixture.assert_work_running()
    journey.command_file('quit')
    confirming = journey.stage('renderer-confirming')
    assert confirming['renderer_confirmation_retained_engine']
    assert confirming['quit_confirmation_decisions'] == confirming['quit_sheet_presentations'] == 1
    fixture.assert_work_running()
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
    return stopped, started
