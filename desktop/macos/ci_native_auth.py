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
from urllib.parse import quote

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


def git_oid(value):
    return isinstance(value, str) and len(value) == 40 and all(character in '0123456789abcdef' for character in value)


def commit_object(sha, read_commit):
    require(git_oid(sha), 'Invalid authenticated commit identity')
    value = read_commit(sha)
    require(git_oid(sha) and isinstance(value, dict) and value.get('sha') == sha and
            isinstance(value.get('tree'), dict) and git_oid(value['tree'].get('sha')) and
            isinstance(value.get('parents'), list) and
            all(isinstance(parent, dict) and git_oid(parent.get('sha')) for parent in value['parents']),
            'Incomplete authenticated commit object')
    return value


def canonical_ref(path, expected, sha, read_service):
    value = read_service('git/ref/' + path)
    require(isinstance(value, dict) and value.get('ref') == expected and
            isinstance(value.get('object'), dict) and value['object'].get('type') == 'commit' and
            git_oid(sha) and value['object'].get('sha') == sha, 'Public canonical ref moved or is uncertain')
    return value


def candidate_pins(pull):
    return dict(number=pull.get('number'), state=pull.get('state'),
                head=pull.get('head', {}).get('sha'), base=pull.get('base', {}).get('sha'),
                base_ref=pull.get('base', {}).get('ref'), public_merge_sha=pull.get('merge_commit_sha'))


def recheck_candidate(candidate, environment, read_service, read_commit):
    """Rebind mutable public pins before a command; commit objects are immutable."""
    pull = read_service('pulls/' + environment['CANDIDATE_PR'])
    require(candidate_pins(pull) == candidate['pins'], 'Public candidate moved during proof collection')
    canonical_ref('pull/' + environment['CANDIDATE_PR'] + '/merge',
                  'refs/pull/' + environment['CANDIDATE_PR'] + '/merge',
                  candidate['public_merge_sha'], read_service)
    ref = candidate['pins']['base_ref']
    require(isinstance(ref, str) and ref, 'Missing declared base ref')
    canonical_ref('heads/' + quote(ref, safe=''), 'refs/heads/' + ref, candidate['base'], read_service)
    base = commit_object(candidate['base'], read_commit)
    proof = candidate.get('prepared_parent_proof')
    if proof:
        require(base == proof['declared_base'] and pull.get('stack') == candidate['stack'],
                'Declared base or stack moved during proof collection')
    return dict(pins=candidate_pins(pull), base=base)


def public_candidate(source, parents, environment, pull, *, tree, read_commit, read_service=None):
    """Admit exact metadata or narrowly proven upper-stack prepared-parent churn."""
    public_merge = pull.get('merge_commit_sha')
    require(pull.get('number') == int(environment['CANDIDATE_PR']) and pull.get('state') == 'open' and
            pull.get('head', {}).get('sha') == environment.get('CANDIDATE_HEAD') and
            pull.get('base', {}).get('sha') == environment.get('CANDIDATE_BASE') and
            git_oid(source) and git_oid(tree) and git_oid(public_merge) and
            git_oid(pull['head']['sha']) and git_oid(pull['base']['sha']) and
            len(parents) == 2 and all(git_oid(parent) for parent in parents) and
            parents[1] == environment.get('CANDIDATE_HEAD'),
            'Checkout is not the current public candidate merge')
    proof = None
    equivalent_metadata = public_merge != source
    if equivalent_metadata:
        current = commit_object(public_merge, read_commit)
        current_parents = [parent['sha'] for parent in current['parents']]
        require(current['tree']['sha'] == tree and len(current_parents) == 2 and
                current_parents[1] == parents[1], 'Current public merge differs in source tree or ordered parents')
        if current_parents != parents:
            # No recursive parent waiver: ONLY the prepared first-parent identity
            # may differ, with authenticated full root trees and base ancestry.
            stack = pull.get('stack')
            require(read_service is not None and isinstance(stack, dict) and
                    all(type(stack.get(key)) is int and stack[key] > 0
                        for key in ('id', 'number', 'position', 'size')) and
                    1 < stack['position'] <= stack['size'] and
                    isinstance(stack.get('base'), dict) and stack['base'].get('ref') == 'dev' and
                    git_oid(stack['base'].get('sha')), 'Not an authenticated upper native-stack member')
            comparison = read_service('compare/' + pull['base']['sha'] + '...' + pull['head']['sha'])
            require(isinstance(comparison, dict) and comparison.get('status') == 'ahead' and
                    type(comparison.get('behind_by')) is int and comparison['behind_by'] == 0 and
                    type(comparison.get('ahead_by')) is int and comparison['ahead_by'] > 0 and
                    comparison.get('merge_base_commit', {}).get('sha') == pull['base']['sha'],
                    'Declared base ancestry is unproven')
            tested = commit_object(source, read_commit)
            old = commit_object(parents[0], read_commit)
            prepared = commit_object(current_parents[0], read_commit)
            base = commit_object(pull['base']['sha'], read_commit)
            head = commit_object(pull['head']['sha'], read_commit)
            require([parent['sha'] for parent in tested['parents']] == parents and
                    tested['tree']['sha'] == current['tree']['sha'] == head['tree']['sha'] == tree and
                    old['tree']['sha'] == prepared['tree']['sha'] == base['tree']['sha'],
                    'Prepared-parent full trees do not prove the exact candidate')
            proof = dict(tested_merge=tested, current_merge=current, old_prepared_base=old,
                         current_prepared_base=prepared, declared_base=base, exact_head=head,
                         ancestry=comparison)
    candidate = dict(source=source, parents=parents, tree=tree, head=pull['head']['sha'],
                    base=pull['base']['sha'], public_merge_sha=public_merge,
                    equivalent_synthetic_metadata=equivalent_metadata,
                    prepared_parent_proof=proof, pins=candidate_pins(pull), stack=pull.get('stack'))
    if read_service is not None:
        candidate['final_pin_check'] = recheck_candidate(candidate, environment, read_service, read_commit)
    return candidate


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
        # Recheck before every compiler/builder/driver. API time consumes the
        # original command/action deadline; it never renews either budget.
        candidate['final_pin_check'] = recheck_candidate(candidate, os.environ, service,
            lambda sha: service('git/commits/' + sha))
        save('CANDIDATE-PROOF.json', candidate)
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
        parents = subprocess.check_output(['git', 'show', '-s', '--format=%P', source], text=True).split()
        require(token and os.environ.get('GITHUB_RUN_ID', '').isdigit(), 'Missing live Actions identity')
        def service(path):
            with urlopen(Request('https://api.github.com/repos/arcee-ai/nac/' + path,
                    headers={'Authorization': 'Bearer ' + token,
                             'Accept': 'application/vnd.github+json'}), timeout=15) as response:
                return json.load(response)
        require(os.environ.get('CANDIDATE_PR', '').isdigit(), 'Missing public pull request identity')
        tree = subprocess.check_output(['git', 'rev-parse', source + '^{tree}'], text=True).strip()
        candidate = public_candidate(source, parents, os.environ,
            service('pulls/' + os.environ['CANDIDATE_PR']), tree=tree,
            read_commit=lambda sha: service('git/commits/' + sha), read_service=service)
        save('CANDIDATE-PROOF.json', candidate)
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
            if mode == 'auth-build':
                run('native-bootstrap-contract', [sys.executable, '-B', 'desktop/macos/device_auth_contract.py',
                    '--startup-only', str(app / 'Contents/Resources/nac-web'),
                    str(evidence / 'native-bootstrap-contract')], environment=clean_environment(os.environ), limit=90)
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
