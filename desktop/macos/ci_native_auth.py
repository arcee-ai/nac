#!/usr/bin/env python3
"""One genuine hosted-Mac integration of the existing browser/auth drivers.

No local opt-in, vendor credentials, browser configuration, OS settings or TCC
changes. The Actions job itself supplies the disposable machine/account/profile.
"""
import json
import hashlib
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from urllib.request import Request, urlopen

from external_auth_smoke import require_isolated_host
from instance_console import require_console, record_console
from smoke import session_lock_state


def require(value, message):
    if not value:
        raise RuntimeError(message)


def hosted_job(environment, jobs, source):
    """Bind genuine service job metadata as well as the observed runner environment."""
    require(environment.get('GITHUB_ACTIONS') == 'true' and environment.get('RUNNER_OS') == 'macOS' and
            environment.get('RUNNER_ENVIRONMENT') == 'github-hosted' and
            environment.get('GITHUB_REPOSITORY') == 'arcee-ai/nac' and
            environment.get('GITHUB_SHA') == source and environment.get('GITHUB_JOB') == 'native-auth',
            'Requires the real dedicated GitHub-hosted authentication job')
    matches = [job for job in jobs if job.get('name') == 'Hosted macOS26 native authentication' and
               job.get('status') == 'in_progress' and job.get('head_sha') == environment.get('CANDIDATE_HEAD') and
               job.get('runner_name') == environment.get('RUNNER_NAME') and
               'self-hosted' not in job.get('labels', []) and
               'macos-26' in [label.lower() for label in job.get('labels', [])]]
    require(len(matches) == 1 and environment.get('RUNNER_NAME'), 'No unique matching live hosted job')
    return {key: matches[0].get(key) for key in ('id', 'name', 'head_sha', 'runner_name', 'labels', 'status')}


def clean_environment(environment):
    return {key: value for key, value in environment.items() if not
            (key.endswith('_API_KEY') or key.endswith('_TOKEN') or key.startswith('NAC_'))}


def isolate_subprocess_environment(environment):
    """Retain the API token only in controller memory, before even Git children."""
    token = environment.get('GITHUB_TOKEN')
    safe = clean_environment(environment)
    environment.clear()
    environment.update(safe)
    environment['PYTHONDONTWRITEBYTECODE'] = '1'
    return token


def public_candidate(source, parents, environment, pull):
    """Native GitHub stacks compose the base through prior synthetic merges."""
    require(pull.get('number') == int(environment['CANDIDATE_PR']) and pull.get('state') == 'open' and
            pull.get('merge_commit_sha') == source and pull.get('head', {}).get('sha') == environment.get('CANDIDATE_HEAD') and
            pull.get('base', {}).get('sha') == environment.get('CANDIDATE_BASE') and
            len(parents) == 2 and parents[1] == environment.get('CANDIDATE_HEAD'),
            'Checkout is not the current public candidate merge')
    return dict(source=source, parents=parents, head=pull['head']['sha'], base=pull['base']['sha'])


def main():
    token = isolate_subprocess_environment(os.environ)
    source_root, output = (Path(value).resolve() for value in sys.argv[1:])
    require(source_root == Path.cwd(), 'Run from the exact candidate checkout')
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    require(not subprocess.check_output(['git', 'status', '--porcelain'], text=True).strip(), 'Dirty source')
    require(os.environ.get('GITHUB_ACTIONS') == 'true' and
            os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted', 'No local native auth execution')
    require(output.parent == Path(os.environ['RUNNER_TEMP']).resolve() and not output.exists(), 'Fresh runner-owned output required')
    output.mkdir(mode=0o700)
    evidence = output / 'evidence'; evidence.mkdir(mode=0o700)
    started = time.monotonic(); action_end = started + 1500; cleanup_end = started + 1620
    log = []; browser_identity = None; browser = observer = host_probe = None
    failure = None; browser_closed = False

    def save(name, value):
        (evidence / name).write_text(json.dumps(value, indent=2) + '\n')

    def run(label, arguments, *, environment=None, limit=600):
        deadline = min(action_end, time.monotonic() + limit)
        require(deadline > time.monotonic(), 'Original native authentication deadline')
        child = None
        with (evidence / (label + '.log')).open('wb') as stream:
            try:
                child = subprocess.Popen(arguments, env=environment, stdout=stream,
                                         stderr=subprocess.STDOUT, start_new_session=True)
                code = child.wait(timeout=max(.01, deadline - time.monotonic()))
                require(code == 0, label + ' failed; raw evidence retained')
            finally:
                if child is not None and child.poll() is None:
                    # Only this retained original child group; no scanned app/browser PID.
                    os.killpg(child.pid, signal.SIGINT)
                    try:
                        child.wait(timeout=max(.01, min(30, cleanup_end-time.monotonic())))
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL); child.wait(timeout=5)
                log.append(dict(label=label, exit=child.returncode if child else None))

    def observed(arguments):
        return json.loads(subprocess.check_output(arguments, timeout=5))

    try:
        parents = subprocess.check_output(['git', 'show', '-s', '--format=%P', 'HEAD'], text=True).split()
        require(token and os.environ.get('GITHUB_RUN_ID', '').isdigit(), 'Missing live Actions identity')
        def service(path):
            with urlopen(Request('https://api.github.com/repos/arcee-ai/nac/' + path,
                    headers={'Authorization': 'Bearer ' + token,
                             'Accept': 'application/vnd.github+json'}), timeout=15) as response:
                return json.load(response)
        require(os.environ.get('CANDIDATE_PR', '').isdigit(), 'Missing public pull request identity')
        candidate = public_candidate(source, parents, os.environ, service('pulls/' + os.environ['CANDIDATE_PR']))
        jobs = service('actions/runs/' + os.environ['GITHUB_RUN_ID'] + '/jobs?per_page=100')
        require(jobs['total_count'] <= 100, 'Incomplete job metadata')
        job = hosted_job(os.environ, jobs['jobs'], source)
        require(Path.home() == Path('/Users/runner') and Path.home().stat().st_uid == os.getuid(),
                'Expected disposable hosted runner account')
        observer, host_probe = output / 'InstanceObservation', output / 'HostedAuthBrowser'
        for name, file, frameworks in [('observer', 'InstanceObservation.swift', ['AppKit']),
                                       ('browser', 'HostedAuthBrowser.swift', ['AppKit'])]:
            destination = observer if name == 'observer' else host_probe
            run('compile-' + name, ['xcrun', 'swiftc', '-parse-as-library', '-swift-version', '5', '-O',
                '-framework', frameworks[0], str(source_root / 'desktop/macos' / file), '-o', str(destination)], limit=60)
        console_observations = []
        detailed_console = record_console(observer, console_observations, 'hosted-auth-preflight-diagnostic')
        save('HOST-PREFLIGHT.json', dict(source=source, candidate=candidate, job=job,
            legacy_lock=session_lock_state(), detailed_console=detailed_console,
            observer_sha256=hashlib.sha256(observer.read_bytes()).hexdigest(), app_or_browser_launched=False))
        # The existing detailed guard requires explicit Root=false plus agreeing
        # ownership/IOKit/Quartz evidence. An absent optional CGS bit is not a lock.
        console = require_isolated_host(observer)
        host = observed([str(host_probe)])
        require(host['os_major'] == 26 and not host['running_browsers'], 'Requires a clean macOS26 browser baseline')
        browser = host['browser']
        require_console(observer, console_observations, 'hosted-auth-before-launch')
        save('HOST.json', dict(source=source, candidate=candidate, job=job, run=os.environ['GITHUB_RUN_ID'],
            attempt=os.environ['GITHUB_RUN_ATTEMPT'], host=host, console=console,
            console_observations=console_observations,
            profile_contract='fresh dedicated GitHub-hosted VM/account; initial main browsers absent; no default/profile settings changed'))
        environment = clean_environment(os.environ)
        environment.update(NAC_MAC_OUTPUT=str(output / 'bundles'), CARGO_PROFILE_DEV_DEBUG='0',
                           CARGO_PROFILE_DEV_OPT_LEVEL='1', CARGO_INCREMENTAL='0', PYTHONDONTWRITEBYTECODE='1')
        for mode, name, driver in [('smoke-build', 'NAC Development Preview Smoke.app', 'external_auth_smoke.py'),
                                   ('auth-build', 'NAC Auth Fixture.app', 'device_auth_smoke.py')]:
            run(mode, ['bash', 'desktop/macos/preview.sh', mode], environment=environment, limit=900)
            app = output / 'bundles' / name
            receipt = json.loads((app / 'Contents/Resources/build-receipt.json').read_text())
            require(receipt['source_head'] == source and not receipt['source_dirty'], 'Producer source drift')
            save(mode + '-receipt.json', receipt)
            run(driver, [sys.executable, '-B', 'desktop/macos/' + driver, str(app), str(evidence / mode),
                '--console-observer', str(observer)],
                environment=clean_environment(os.environ), limit=600)
            state = observed([str(observer), 'state', browser])
            require(len(state['apps']) == 1, 'Missing or ambiguous created browser incarnation')
            if browser_identity is None:
                browser_identity = state['apps'][0]
            require(state['apps'] == [browser_identity], 'Browser incarnation changed between owned journeys')
            require(observed([str(host_probe)])['browser'] == browser, 'Default browser changed')
        run('device-owner-contract', [sys.executable, '-B', 'desktop/macos/device_auth_contract.py',
            str(output / 'bundles/NAC Auth Fixture.app/Contents/Resources/nac-web'),
            str(output / 'bundles/NAC Development Preview Smoke.app/Contents/Resources/nac-web'),
            str(evidence / 'device-owner-contract')], environment=clean_environment(os.environ), limit=180)
        require(not subprocess.check_output(['git', 'status', '--porcelain'], text=True).strip(), 'Source changed during qualification')
    except BaseException as error:
        failure = dict(type=type(error).__name__, message=str(error))
    finally:
        if browser and observer and observer.exists():
            try:
                state = observed([str(observer), 'state', browser])
                if browser_identity is None and len(state['apps']) == 1:
                    # The authenticated fresh job proved that exact browser was absent initially.
                    browser_identity = state['apps'][0]
                if browser_identity is not None:
                    require(state['apps'] in ([], [browser_identity]), 'Foreign browser identity; no termination')
                    if state['apps']:
                        require(observed([str(observer), 'terminate', browser, json.dumps(browser_identity)])[
                            'termination_requested'] is True, 'Browser termination not accepted')
                    browser_end = min(cleanup_end, time.monotonic() + 20)
                    while time.monotonic() < browser_end:
                        if not observed([str(observer), 'state', browser])['apps']:
                            browser_closed = True; break
                        time.sleep(.1)
                else:
                    browser_closed = not state['apps']
            except BaseException as error:
                failure = failure or dict(type=type(error).__name__, message=str(error))
        save('TERMINAL.json', dict(passed=failure is None and browser_closed, source=source,
            failure=failure, browser_identity=browser_identity, browser_closed=browser_closed, commands=log,
            elapsed=time.monotonic()-started, real_vendor_qualified=False, trusted_input_qualified=False,
            minimum_os_qualified=False))
    return 0 if failure is None and browser_closed else 1


if __name__ == '__main__':
    raise SystemExit(main())
