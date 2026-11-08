#!/usr/bin/env python3
"""Private, separately admitted P12 lifecycle-role consumer. No product rebuild."""
import functools
import importlib.util
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import signal
import sys
import time

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('startup_launch', HERE.parent / 'native342-startup/launch.py')
launch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launch)
common = launch.case
require, digest = common.require, common.digest
P = '4b7a1f3e0bf6175a77c5ebf627fe965860e99976'
H = '29931101ff7ad50bfc80bf048681ab05de028ec6'
BASE = 'ec8076b99105737e7a0a0e86d61d84705a155eab'
BRANCH = 'refs/heads/codex/experimental-native-p12-lifecycle-consumer-source01'
SCOPE = 'P12-maintained-three-case-lifecycle-transactions-source01'
ROLE = 'canonical-lifecycle-fixture-v1'
MANIFEST = '1ddcf153b7dabeb82b3e662b8770ab57ea734566343e16496c4932c72391cf78'
CASES = ('run', 'approval', 'terminal')


def declaration(text):
    require(type(text) is str and 0 < len(text.encode()) <= 8192, 'bounded Root declaration')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'duplicate Root declaration key')
            result[key] = value
        return result
    return json.loads(text, object_pairs_hook=unique)


def admit(value, env, *, now=None):
    """Validate literal Root custody, never mint it or reuse the old capsule."""
    require(set(value) == {'scope', 'controller_sha', 'H', 'P', 'manifest_sha256', 'role',
        'allocation_id', 'admission_nonce', 'attempt', 'retries', 'prior_dispatch_counts', 'clock', 'producer'},
        'closed P12 lifecycle admission')
    require(value['scope'] == SCOPE and value['H'] == H and value['P'] == P
        and value['manifest_sha256'] == MANIFEST and value['role'] == ROLE,
        'fixed reviewed P12/H/artifact role')
    require(type(value['controller_sha']) is str and re.fullmatch('[0-9a-f]{40}', value['controller_sha'])
        and value['controller_sha'] == env.get('GITHUB_SHA')
        and env.get('GITHUB_REF') == BRANCH and env.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
        and env.get('GITHUB_RUN_ATTEMPT') == '1' and env.get('GITHUB_REPOSITORY') == 'arcee-ai/nac'
        and re.fullmatch('[1-9][0-9]*', env.get('GITHUB_RUN_ID', '')), 'exact first private manual job')
    require(type(value['allocation_id']) is str and re.fullmatch('[A-Za-z0-9_-]{1,100}', value['allocation_id'])
        and type(value['admission_nonce']) is str and re.fullmatch('[0-9a-f]{64}', value['admission_nonce']),
        'named original Root custody')
    require(type(value['attempt']) is int and value['attempt'] == 1
        and type(value['retries']) is int and value['retries'] == 0
        and value['prior_dispatch_counts'] == dict.fromkeys(CASES, 0)
        and all(type(v) is int for v in value['prior_dispatch_counts'].values()), 'unspent three-case allocation')
    # Share the already-reviewed queue-inclusive clock/producer validator with
    # its ORIGINAL scope and manifest; no mutation of its admission/defaults.
    shared = {k: value[k] for k in ('controller_sha', 'allocation_id', 'attempt', 'retries', 'clock', 'producer')}
    shared.update(scope=common.SCOPE, manifest_sha256=common.MANIFEST_SHA256)
    return common.admit(shared, value['controller_sha'], now=now)


def handoff(root, value):
    files = launch.outer_files(root)
    manifest = files['ff8-host-package-output/handoff/lifecycle/manifest.json']
    archive = files['ff8-host-package-output/handoff/lifecycle/NAC-lifecycle-fixture-arm64.zip']
    body = json.loads(manifest.read_bytes())
    receipt = json.loads(files['ff8-host-package-output/handoff/host-package.json'].read_bytes())
    require(digest(manifest) == MANIFEST == value['manifest_sha256']
        and body.get('role') == ROLE and body.get('source', {}).get('revision') == P
        and body.get('observer', {}).get('source_revision') == P
        and body.get('observer', {}).get('role') == 'canonical-lifecycle-observer', 'genuine distinct lifecycle role')
    require(receipt.get('status') == 'PASS' and receipt.get('scope') == launch.ARTIFACT['producer_scope']
        and receipt.get('clock_failures') == [] and receipt.get('stop_signals') == []
        and receipt.get('runtime') is False and receipt.get('SDK_actor') is False
        and receipt.get('producer_attempts') == 1 and receipt.get('retries') == 0
        and receipt.get('pair', {}).get('P') == P
        and receipt.get('admission', {}).get('controller_sha') == launch.ARTIFACT['producer_sha'],
        'successful original package-only producer')
    for name, path in [('lifecycle/manifest.json', manifest), ('lifecycle/' + archive.name, archive)]:
        row = receipt.get('handoff', {}).get(name, {})
        require(row.get('sha256') == digest(path) and row.get('bytes') == path.stat().st_size,
                'exact lifecycle producer handoff')
    require(body['container']['name'] == archive.name and body['container']['size'] == archive.stat().st_size
        and body['container']['sha256'] == digest(archive), 'original lifecycle archive')
    return manifest, archive, body


def serial(ledger, clock, using, *, reserve, driver, validate, cleanup, publish, finish_guard=None):
    """The original finite three-case order; no next case after any uncertainty."""
    results = []
    for name in CASES:
        clock.require_phase('lifecycle-' + name, 555)
        reserve(name)
        outcome = dict(case=name, status='unknown', cleanup={'complete': False})
        primary = None
        driver_completed = False
        try:
            with using(clock.work):
                outcome['driver'] = driver(name)
                driver_completed = True
                outcome['proof'] = validate(name)
            outcome['status'] = 'passed'
        except BaseException as error:
            primary = error
            outcome.update(status='failed' if driver_completed else 'unknown', error_type=type(error).__name__, error=str(error)[:4096])
        finally:
            try:
                with using(clock.cleanup):
                    outcome['cleanup'] = cleanup(name)
                require(outcome['cleanup'].get('complete') is True, 'positive native/process cleanup required')
                require(outcome['status'] != 'passed' or not outcome['cleanup']['retained_failure_roots'],
                        'passing case retained a private fixture')
            except BaseException as error:
                outcome.update(status='unknown', cleanup_error=str(error)[:4096])
                primary = primary or error
        try:
            publish(name, outcome)
            ledger.finish(name, outcome['status'], {'external_result_sha256': outcome['external_result_sha256']},
                          before_save=finish_guard)
        except BaseException:
            clock.fail('result/export/ledger incomplete')
            raise
        if primary is not None:
            clock.fail('lifecycle failed or unknown')
            raise primary
        clock.work.check()
        results.append(outcome)
    ledger.value['phase'] = 'complete'
    ledger.save()
    return results


def owners(harness):
    # These three reviewed derivative modules explicitly adapt P12 identity.
    # Evidence/finalization/budget/checkout owners remain immutable H299.
    sys.path[:0] = [str(HERE / 'owners'), str(harness / 'desktop/macos')]
    import ci_lifecycle_contract as contract
    import ci_lifecycle_ownership as ownership
    import p12_lifecycle_supervisor as supervisor
    owner = type('P12Ownership', (), {
        'retain': staticmethod(functools.partial(ownership.retain, binding=contract.Binding.P12)),
        'require': staticmethod(functools.partial(ownership.require, binding=contract.Binding.P12))})
    return contract, owner, supervisor


def child(source, scenario, app, destination, observer):
    """Only a matching durable reservation enters the unmodified P12 main."""
    value = declaration(os.environ['ROOT_LIFECYCLE_ADMISSION'])
    admit(value, os.environ)
    harness = Path(os.environ['H_ROOT']).resolve()
    contract, _, _ = owners(harness)
    from ci_qualifications import require_checkout
    require_checkout(harness, H)
    require_checkout(source, P)
    require_checkout(HERE.parents[2], value['controller_sha'])
    control = contract.canonical(Path(os.environ['LIFECYCLE_CONTROL']))
    row = json.loads((control / 'ledger.json').read_bytes())
    execution = row.get('cases', {}).get(scenario, {}).get('execution', {})
    require(scenario in CASES and row.get('phase') == 'case_dispatched' and row.get('active_case') == scenario
        and row.get('capsule') == dict(value, harness=value['controller_sha'])
        and row.get('run_id') == os.environ['GITHUB_RUN_ID']
        and row['cases'][scenario].get('dispatches') == 1
        and row['cases'][scenario].get('state') == 'dispatched'
        and row['cases'][scenario].get('output') == str(destination)
        and execution.get('command') == driver_command(source, scenario, app, destination, observer)
        and execution.get('builds_sha256') == digest(control / 'builds.json')
        and execution.get('observer_sha256') == digest(observer)
        and execution.get('source_sha') == P and execution.get('harness_sha') == value['controller_sha']
        and os.environ.get('NAC_LIFECYCLE_SCENARIOS') == scenario, 'matching original durable reservation')
    contract.canonical(destination, parent=control)
    require(destination.parent == control, 'exact case destination')
    builds = json.loads((control / 'builds.json').read_bytes())
    require(str(app) == builds['app'] and str(observer) == builds['observer'], 'reserved artifact paths')
    verify_package(source, app.parent, builds['manifest_sha256'])
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('External lifecycle supervisor interrupted')
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, interrupted)
    signal.pthread_sigmask(signal.SIG_UNBLOCK, {signal.SIGTERM, signal.SIGINT})
    sys.path.insert(0, str(source / 'desktop/macos'))
    script = source / 'desktop/macos/lifecycle_smoke.py'
    sys.argv = [str(script), str(app), str(destination), str(observer)]
    runpy.run_path(str(script), run_name='__main__')


def driver_command(source, name, app, output, observer):
    return [sys.executable, '-B', str(Path(__file__).resolve()), 'driver', str(source), name,
            str(app), str(output), str(observer)]


def verify_package(source, package, manifest_sha):
    require(manifest_sha == MANIFEST and digest(package / 'manifest.json') == MANIFEST,
            'original sealed lifecycle manifest')
    sys.path.insert(0, str(source / 'desktop/macos/packaging'))
    from lifecycle_package import verify_lifecycle_files
    body = json.loads((package / 'manifest.json').read_bytes())
    require(body.get('role') == ROLE and body.get('source', {}).get('revision') == P, 'fixed lifecycle supplier')
    return verify_lifecycle_files(body, package, source)


if __name__ == '__main__':
    action, source, *arguments = sys.argv[1:]
    source = Path(source)
    if action == 'driver' and len(arguments) == 4:
        child(source, arguments[0], *map(Path, arguments[1:]))
    elif action == 'console' and not arguments:
        value = declaration(os.environ['ROOT_LIFECYCLE_ADMISSION'])
        admit(value, os.environ)
        harness = Path(os.environ['H_ROOT'])
        owners(harness)
        from ci_qualifications import require_checkout
        require_checkout(source, P)
        require_checkout(harness, H)
        require_checkout(HERE.parents[2], value['controller_sha'])
        sys.path.insert(0, str(source / 'desktop/macos'))
        from lifecycle_smoke import console_state
        print(json.dumps(console_state()))
    else:
        raise RuntimeError('Unknown fixed lifecycle child action')
