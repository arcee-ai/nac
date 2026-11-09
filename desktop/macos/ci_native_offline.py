#!/usr/bin/env python3
"""UNAPPLIED proposal: one separately admitted genuine hosted offline episode.

Import is inert. Publishing/reviewing this file is not runtime admission.
Uses the existing source proof, console and exact-owned relocation owners.
"""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from urllib.request import Request, urlopen

from ci_native_auth import (require, clean_environment, isolate_subprocess_environment,
                            public_candidate, recheck_candidate)
from external_auth_smoke import require_isolated_host
from instance_console import require_console, record_console
from smoke import session_lock_state


def hosted_job(environment, jobs, source, event):
    """Bind genuine service job metadata as well as the observed runner environment."""
    require(environment.get('GITHUB_ACTIONS') == 'true' and environment.get('RUNNER_OS') == 'macOS' and
            environment.get('RUNNER_ENVIRONMENT') == 'github-hosted' and
            environment.get('GITHUB_REPOSITORY') == 'arcee-ai/nac' and
            environment.get('GITHUB_SHA') == source and environment.get('GITHUB_JOB') == 'native-offline',
            'Requires the real dedicated GitHub-hosted offline-provider job')
    require(environment.get('GITHUB_EVENT_NAME') == 'pull_request' and
            environment.get('GITHUB_RUN_ATTEMPT') == '1' and environment.get('CANDIDATE_PR') == '636' and
            event.get('action') == 'synchronize' and event.get('number') == 636 and
            event.get('pull_request', {}).get('head', {}).get('sha') == environment.get('CANDIDATE_HEAD') and
            event.get('pull_request', {}).get('base', {}).get('sha') == environment.get('CANDIDATE_BASE'),
            'Temporary qualification admits only designated public PR636 synchronize attempt1')
    matches = [job for job in jobs if job.get('name') == 'Hosted macOS26 offline local provider' and
               job.get('status') == 'in_progress' and job.get('head_sha') == environment.get('CANDIDATE_HEAD') and
               job.get('runner_name') == environment.get('RUNNER_NAME') and
               'self-hosted' not in job.get('labels', []) and
               'macos-26' in [label.lower() for label in job.get('labels', [])]]
    require(len(matches) == 1 and environment.get('RUNNER_NAME'), 'No unique matching live hosted job')
    return {key: matches[0].get(key) for key in ('id', 'name', 'head_sha', 'runner_name', 'labels', 'status')}


def error_record(error, phase):
    return dict(phase=phase, type=type(error).__name__, message=str(error)[:512])


def run_command(label, arguments, *, environment, deadline, cleanup_end, started,
                commands, log_path, save, spawn=subprocess.Popen,
                clock=time.monotonic, signal_group=os.killpg, preflight=lambda: None):
    """Settle this caller's one original child; ports are inert in unit controls."""
    row = dict(label=label, argv=arguments, started=clock()-started,
               exit=None, state='attempted', child_reaped=False, unresolved=False,
               secondary_cleanup=[], secondary_overflow=0)
    commands.append(row)
    child = stream = None
    primary = None

    def remember(error, phase):
        nonlocal primary
        if primary is None:
            primary = (error, error.__traceback__)
            row['primary_error'] = error_record(error, phase)
        elif len(row['secondary_cleanup']) < 8:
            row['secondary_cleanup'].append(error_record(error, phase))
        else:
            row['secondary_overflow'] += 1

    def poll():
        try:
            code = child.poll()
            if code is not None:
                row.update(exit=code, child_reaped=True)
            return code
        except BaseException as error:
            remember(error, 'poll-owned-child')
            row['poll_uncertain'] = True
            return None

    def settle(signum, maximum):
        # Every signal AND wait consumes strictly the original cleanup clock.
        # No positive floor, scanned PID, new process or renewed deadline.
        if clock() >= cleanup_end or row.get('poll_uncertain'):
            return
        try:
            signal_group(child.pid, signum)
        except BaseException as error:
            remember(error, 'signal-owned-child')
        if poll() is not None:
            return
        remaining = cleanup_end-clock()
        if remaining <= 0:
            return
        try:
            code = child.wait(timeout=min(maximum, remaining))
            row.update(exit=code, child_reaped=True)
        except BaseException as error:
            remember(error, 'wait-owned-child')

    try:
        save('COMMANDS.json', commands)  # An attempted command exists before acquisition.
        require(clock() < min(deadline, cleanup_end), 'Original offline command deadline')
        preflight()
        require(clock() < min(deadline, cleanup_end), 'Original offline command deadline after proof')
        stream = log_path.open('wb')
        require(clock() < min(deadline, cleanup_end), 'Original offline command deadline after log open')
        child = spawn(arguments, env=environment, stdout=stream,
                      stderr=subprocess.STDOUT, start_new_session=True)
        row.update(pid=child.pid, state='acquired')
        remaining = deadline-clock()
        require(remaining > 0, 'Original offline command deadline after acquisition')
        code = child.wait(timeout=remaining)
        row.update(exit=code, child_reaped=True)
        require(code == 0 and clock() <= deadline, label + ' failed or expired; raw evidence retained')
    except BaseException as error:
        remember(error, 'command')
    finally:
        if child is not None:
            if not row['child_reaped'] and poll() is None:
                settle(signal.SIGINT, 30)
                if not row['child_reaped'] and poll() is None:
                    settle(signal.SIGKILL, 5)
            if not row['child_reaped']:
                poll()
            row['unresolved'] = not row['child_reaped']
            if row['unresolved']:
                remember(RuntimeError('Original child unresolved at cleanup cutoff; retain custody'), 'custody')
        if stream is not None:
            try:
                stream.close()
            except BaseException as error:
                remember(error, 'close-command-log')
        row.update(state='failed' if primary else 'completed', ended=clock()-started)
        try:
            save('COMMANDS.json', commands)
        except BaseException as error:
            remember(error, 'retain-final-command')
            row['state'] = 'failed'
            # The in-memory final/unresolved row remains in terminal evidence,
            # even if this particular command-receipt file cannot be written.
    if primary is not None:
        raise primary[0].with_traceback(primary[1])
    return row


def main():
    token = isolate_subprocess_environment(os.environ)
    source_root, output = (Path(value).resolve() for value in sys.argv[1:])
    require(source_root == Path.cwd(), 'Run from the exact candidate checkout')
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    require(not subprocess.check_output(['git', 'status', '--porcelain'], text=True).strip(), 'Dirty source')
    require(os.environ.get('GITHUB_ACTIONS') == 'true' and
            os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted', 'No local offline execution')
    require(output.parent == Path(os.environ['RUNNER_TEMP']).resolve() and not output.exists(),
            'Fresh runner-owned output required')
    output.mkdir(mode=0o700)
    evidence = output / 'evidence'; evidence.mkdir(mode=0o700)
    started = time.monotonic(); action_end = started + 1500; cleanup_end = started + 1620
    commands = []; console_observations = []; candidate = None
    failure = None; secondary_cleanup = []; host_probe = None; host = None; after = None

    def save(name, value):
        (evidence / name).write_text(json.dumps(value, indent=2) + '\n')

    def service(path):
        remaining = action_end - time.monotonic()
        require(remaining > 0, 'Original offline action deadline')
        with urlopen(Request('https://api.github.com/repos/arcee-ai/nac/' + path,
                headers={'Authorization': 'Bearer ' + token,
                         'Accept': 'application/vnd.github+json'}),
                timeout=min(15, remaining)) as response:
            return json.load(response)

    def run(label, arguments, *, environment=None, limit=600):
        deadline = min(action_end, time.monotonic() + limit)
        def preflight():
            candidate['final_pin_check'] = recheck_candidate(candidate, os.environ, service,
                lambda sha: service('git/commits/' + sha))
            save('CANDIDATE-PROOF.json', candidate)
        return run_command(label, arguments, environment=environment, deadline=deadline,
            cleanup_end=cleanup_end, started=started, commands=commands,
            log_path=evidence / (label + '.log'), save=save, preflight=preflight)

    def observe_host():
        remaining = cleanup_end - time.monotonic()
        require(remaining > 0, 'Original offline cleanup deadline')
        return json.loads(subprocess.check_output([str(host_probe)], timeout=min(5, remaining)))

    try:
        require(token and os.environ.get('GITHUB_RUN_ID', '').isdigit(), 'Missing actual Actions identity')
        require(os.environ.get('CANDIDATE_PR', '').isdigit(), 'Missing public PR identity')
        parents = subprocess.check_output(['git', 'show', '-s', '--format=%P', source], text=True).split()
        tree = subprocess.check_output(['git', 'rev-parse', source + '^{tree}'], text=True).strip()
        candidate = public_candidate(source, parents, os.environ,
            service('pulls/' + os.environ['CANDIDATE_PR']), tree=tree,
            read_commit=lambda sha: service('git/commits/' + sha), read_service=service)
        save('CANDIDATE-PROOF.json', candidate)
        jobs = service('actions/runs/' + os.environ['GITHUB_RUN_ID'] + '/jobs?per_page=100')
        require(jobs['total_count'] <= 100, 'Incomplete actual job metadata')
        job = hosted_job(os.environ, jobs['jobs'], source, json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text()))
        require(Path.home() == Path('/Users/runner') and Path.home().stat().st_uid == os.getuid(),
                'Expected disposable hosted account')
        observer = output / 'InstanceObservation'; host_probe = output / 'HostedAuthBrowser'
        for label, file, destination in [('observer', 'InstanceObservation.swift', observer),
                                         ('browser-observer', 'HostedAuthBrowser.swift', host_probe)]:
            run('compile-' + label, ['xcrun', 'swiftc', '-parse-as-library', '-swift-version', '5', '-O',
                '-framework', 'AppKit', str(source_root / 'desktop/macos' / file), '-o', str(destination)],
                limit=60)
        detailed = record_console(observer, console_observations, 'hosted-offline-preflight')
        save('HOST-PREFLIGHT.json', dict(source=source, candidate=candidate, job=job,
            legacy_lock=session_lock_state(), detailed_console=detailed,
            observer_sha256=hashlib.sha256(observer.read_bytes()).hexdigest(), app_launched=False))
        console = require_isolated_host(observer)
        host = observe_host()
        require(host['os_major'] == 26 and not host['running_browsers'], 'Clean macOS26 baseline required')
        require_console(observer, console_observations, 'hosted-offline-before-launch')
        save('HOST.json', dict(source=source, candidate=candidate, job=job,
            run=os.environ['GITHUB_RUN_ID'], attempt=os.environ['GITHUB_RUN_ATTEMPT'],
            host=host, console=console, console_observations=console_observations,
            profile_contract='fresh hosted VM/account; no host network/browser settings changed'))
        environment = clean_environment(os.environ)
        environment.update(NAC_MAC_OUTPUT=str(output / 'bundles'), CARGO_PROFILE_DEV_DEBUG='0',
            CARGO_PROFILE_DEV_OPT_LEVEL='1', CARGO_INCREMENTAL='0', PYTHONDONTWRITEBYTECODE='1')
        run('offline-retirement-controls', [sys.executable, '-B',
            'desktop/macos/test_offline_retirement.py', '--artifacts',
            str(evidence / 'offline-retirement-controls')], environment=environment, limit=120)
        run('smoke-build', ['bash', 'desktop/macos/preview.sh', 'smoke-build'],
            environment=environment, limit=900)
        app = output / 'bundles/NAC Development Preview Smoke.app'
        receipt = json.loads((app / 'Contents/Resources/build-receipt.json').read_text())
        require(receipt['source_head'] == source and not receipt['source_dirty'], 'Producer source drift')
        save('smoke-build-receipt.json', receipt)
        run('offline-api-key', [sys.executable, '-B', 'desktop/macos/offline_provider_smoke.py',
            str(app), str(evidence / 'offline-api-key'), '--console-observer', str(observer)],
            environment=clean_environment(os.environ), limit=300)
        candidate['final_pin_check'] = recheck_candidate(candidate, os.environ, service,
            lambda sha: service('git/commits/' + sha))
        save('CANDIDATE-PROOF.json', candidate)
        require(not subprocess.check_output(['git', 'status', '--porcelain'], text=True).strip(),
                'Source changed during qualification')
    except BaseException as error:
        failure = error_record(error, 'controller')
    finally:
        if host is not None and host_probe is not None and host_probe.exists():
            try:
                after = observe_host()
                require(after['browser'] == host['browser'] and
                        after['identifier'] == host['identifier'] and not after['running_browsers'],
                        'Unexpected browser/default drift; no browser custody or termination')
            except BaseException as error:
                if failure is None:
                    failure = error_record(error, 'final-host-observation')
                else:
                    secondary_cleanup.append(error_record(error, 'final-host-observation'))
        passed = failure is None and after is not None
        terminal = dict(passed=passed, source=source, candidate=candidate,
            failure=failure, secondary_cleanup=secondary_cleanup[:8], initial_host=host, final_host=after, commands=commands,
            elapsed=time.monotonic()-started, whole_machine_offline=False,
            real_vendor_qualified=False, physical_input_qualified=False, minimum_os_qualified=False,
            unexpected_custody='retain evidence; no retry or scanned app/browser termination')
        try:
            save('TERMINAL.json', terminal)
        except BaseException as error:
            passed = False
            terminal['passed'] = False
            if terminal['failure'] is None:
                terminal['failure'] = error_record(error, 'retain-terminal')
            else:
                terminal['secondary_cleanup'] = (terminal['secondary_cleanup'] + [error_record(error, 'retain-terminal')])[:8]
            # Actions console is the final retention fallback; never overwrite
            # a primary command/host failure with a secondary artifact failure.
            print(json.dumps(terminal), file=sys.stderr)
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
