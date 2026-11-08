#!/usr/bin/env python3
"""PRIVATE NEVERMERGE: one ordinary app, one external read-only AX diagnostic."""
import importlib.util
import json
import os
from pathlib import Path
import platform
import signal
import sys
import time

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('retained_startup_clock', HERE.parent / 'native342-startup/four-startup.py')
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
require, digest, write, make_clock, STOP = legacy.require, legacy.digest, legacy.write, legacy.make_clock, legacy.STOP
SCOPE = 'P10-Q057-external-AX-preflight-source01'
BRANCH = 'refs/heads/codex/experimental-native-ax-observer-preflight-20261108'
PRODUCER = dict(run_id=42426305195, artifact_id=13594999645,
    controller_sha='7239e61a0ebc0ee01b28f9d3cb9c1262132a8627',
    branch='codex/experimental-native-q-host-package-post657-p10', artifact_name='ff8-host-package-42426305195-1')
MANIFEST = '57fef13a3193e0b489e7afdfc1e372c71b169e421e161b6792fc83fcbe4e39b7'


def admit(value, controller_sha, *, now=None):
    require(value.get('scope') == SCOPE and value.get('producer') == PRODUCER
            and value.get('manifest_sha256') == MANIFEST, 'exact genuine P10 diagnostic scope and custody')
    pair = json.loads((HERE / 'pair.json').read_text())
    require(pair['scope'] == SCOPE and pair['H_nomination_ready'] is True,
            'H candidate not nominated: original G1 repair/final review required before bootstrap')
    # Keep the existing absolute-clock/closed-declaration validator unchanged.
    return legacy.admit(dict(value, scope=legacy.SCOPE), controller_sha, now=now)


def wait_owned(witness, clock, *, seconds=45):
    clock.require_phase('one ordinary app ownership admission', seconds + 15)
    deadline = time.monotonic() + seconds
    with witness.condition:
        while True:
            require(not witness.failure and not STOP, 'ownership stream failed or controller stopped')
            clock.observe()
            apps = [n for n in witness.latest if n['kind'] == 'app']
            engines = [n for n in witness.latest if n['kind'] == 'engine' and n['serving']]
            if len(apps) == 1 and apps[0] == witness.app and len(apps[0]['windows']) == 1 and len(engines) == 1:
                return witness.attachment_binding()
            remaining = deadline - time.monotonic()
            require(remaining > 0, 'ordinary app/serving engine/sole window admission unavailable')
            witness.condition.wait(min(.05, remaining))


def episode(startup, owner, clock, using, *, folder, profiles, app, manifest, roots, pair, helper, run):
    """Small LaunchServices adapter; existing owners retain all OS/process work."""
    result = dict(status='NO_GO', acceptance=False, launch_attempts=0, capture_attempts=0,
                  cleanup=False, profile_removed=False, errors={})
    profile = witness = protected = None
    proof = None
    try:
        with using(clock.work):
            # No provider or settings engine: a normal onboarding fixture only.
            profile = startup.prepare_profile(profiles, 'onboarding', 'http://127.0.0.1:1/models-dev',
                                              run=run, directory=folder)
            contract = startup.test_contract(roots['Q'])
            result['package_before'] = startup.package_contract(contract, 'inspect_normal_package',
                [str(manifest), str(app), str(roots['P'])], dict(product_sha=pair['P']),
                tests=roots['Q'], directory=folder, name='package-original-before', run=run)
            config, config_path, package = startup.prepare_configuration(profile, app, manifest,
                roots['P'], roots['Q'], pair['H'], run=run, directory=folder)
            result['configuration_admission'] = package
            startup.package_contract(contract, 'validate_normal_package', [config, str(manifest), str(roots['P'])],
                dict(product_sha=pair['P'], test_sha=pair['Q'], harness_sha=pair['H']),
                tests=roots['Q'], directory=folder, name='package-before-launch', run=run)
            protected = startup.immutable_snapshot(profile)
            witness = owner.OwnerWitness(config, digest(config_path))
            witness.start(helper, config_path)  # Preinstalled; initially no owned app.
            require(witness.ready and not witness.history and not witness.failure, 'empty preinstalled owner')
            result['launch_attempts'] = 1
            run(['/usr/bin/open', '-a', config['app_path'], '--args', '--directory', config['home']],
                folder / 'ordinary-launch.log', 15, cwd=Path('/'), env=config['environment'],
                abort=lambda: bool(witness.failure))
            result['binding'] = wait_owned(witness, clock)
            result['capture_attempts'] = 1
            result['AX'] = owner.capture_ax_preflight(witness, helper,
                roots['H'] / 'desktop/macos/CIStartupObserver.swift', config_path, folder, run=run,
                source_sha256=digest(roots['H'] / 'desktop/macos/CIStartupObserver.swift'),
                binary_sha256=digest(helper))
            result['status'] = 'GO'
    except BaseException as error:
        result['errors']['primary'] = type(error).__name__
        result['status'] = 'NO_GO'
        clock.fail('diagnostic failed/unknown')
    finally:
        clock.cleaning = True
        with using(clock.cleanup):
            if witness is not None:
                try:
                    proof = witness.settle(time.monotonic())
                    result['settlement'] = startup.cleanup_receipt(proof)
                    result['cleanup'] = True
                except BaseException as error:
                    result['errors']['cleanup'] = type(error).__name__
                    result['owner_failure'] = witness.failure_receipt()
                finally:
                    try:
                        witness.stop()
                    except BaseException as error:
                        result['errors']['observer_stop'] = type(error).__name__
            if profile is not None and protected is not None:
                try:
                    startup.require_integrity(profile, protected)
                    result['package_after'] = startup.package_contract(contract, 'inspect_normal_package',
                        [str(manifest), str(app), str(roots['P'])], dict(product_sha=pair['P']),
                        tests=roots['Q'], directory=folder, name='package-after-cleanup', run=run)
                    require(result['package_before'] == result['package_after'], 'original package changed')
                    if proof is not None and not result['errors'].get('observer_stop'):
                        startup.remove_profile(profile, proof)
                        result['profile_removed'] = True
                except BaseException as error:
                    result['errors']['integrity'] = type(error).__name__
            if result['errors'] or not result['cleanup'] or not result['profile_removed']:
                result['status'] = 'NO_GO'
            # Unknown ownership/integrity preserves the private profile in place.
            if profile is not None and not result['profile_removed']:
                result['retained_profile'] = str(profile['root'])
    return result


def main():
    require(len(sys.argv) == 1 and platform.system() == 'Darwin' and platform.machine() == 'arm64',
            'one fixed diagnostic on arm64 macOS')
    require(os.environ.get('GITHUB_REF') == BRANCH and os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
            and os.environ.get('GITHUB_RUN_ATTEMPT') == '1'
            and os.environ.get('GITHUB_REPOSITORY') == 'arcee-ai/nac', 'one exact first manual diagnostic')
    admission = json.loads(os.environ['ROOT_STARTUP_ADMISSION'])
    epochs = admit(admission, os.environ['GITHUB_SHA'])
    pair = json.loads((HERE / 'pair.json').read_text())
    controller = HERE.parents[2]
    roots = {k: Path(os.environ[k + '_ROOT']) for k in ('H', 'P', 'Q')}
    package, output = Path(os.environ['PACKAGE_ROOT']), Path(os.environ['OUTPUT_ROOT'])
    paths = [controller, *roots.values(), package, output]
    require(all(p.is_absolute() and p.resolve() == p for p in paths)
        and all(a != b and not a.is_relative_to(b) and not b.is_relative_to(a)
                for i, a in enumerate(paths) for b in paths[i + 1:]), 'canonical disjoint explicit roots')
    require(package.is_dir() and not output.exists() and output.parent.is_dir(), 'retained package and absent owned output')
    output.mkdir(mode=0o700)
    raw, exported = output / 'raw', output / 'evidence'
    raw.mkdir(mode=0o700); exported.mkdir(mode=0o700)
    report = dict(status='NO_GO', acceptance=False, scope=SCOPE, controller_sha=os.environ['GITHUB_SHA'],
                  pair=pair, pair_sha256=digest(HERE / 'pair.json'), wrapper_sha256=digest(__file__),
                  retries=0, runtime_attempts=0, phases=[])
    write(raw / 'preflight.json', report)
    write(exported / 'preflight.json', report)  # Survives import/qualification failure.
    sys.path.insert(0, str(roots['H'] / 'desktop/macos'))
    import ci
    import ci_startup as startup
    import ci_startup_owner as owner
    from ci_paths_budget import Bound, using
    from ci_qualifications import require_checkout
    from ci_support import export_evidence, qualify_toolchain, redact_values
    clock = make_clock(epochs, Bound)
    ci.RUN_DEADLINE = clock.cleanup.deadline

    def run(argv, log, cap, cwd=roots['H'], *, env=None, abort=None):
        bound = clock.cleanup if clock.cleaning else clock.work
        if not clock.cleaning:
            clock.require_phase('owned helper', cap + 15)
        phase = dict(argv=argv, cap_seconds=cap, started_epoch=time.time(), status='FAIL')
        report['phases'].append(phase)
        write(raw / 'preflight.json', report)
        try:
            with using(bound):
                ci.run(argv, log, cap, cwd=cwd, env=env, abort=lambda: bool(STOP) or (abort is not None and abort()))
                proof = json.loads(log.with_name(log.name + '.ownership.json').read_bytes())
                require(proof['accepted'] and proof['reaped'] and proof['drain_settled']
                    and not proof['unknown'] and proof['teardown_error'] is None, 'positive helper ownership')
                phase['status'] = 'PASS'
        finally:
            phase['ended_epoch'] = time.time()
            write(raw / 'preflight.json', report)

    try:
        with using(clock.work):
            require_checkout(controller, admission['controller_sha'])
            for k, root in roots.items():
                require_checkout(root, pair[k])
            require(startup.PRODUCT == pair['P'] and startup.TEST_SOURCE == pair['Q'], 'actual H/P/Q contract')
            actual = dict(developer_directory=os.environ.get('DEVELOPER_DIR'),
                xcode=ci.command(['xcodebuild', '-version']), sdk=ci.command(['xcrun', '--sdk', 'macosx', '--show-sdk-version']),
                swift=ci.command(['xcrun', 'swiftc', '--version']), image=os.environ.get('ImageVersion'),
                os_version=ci.command(['sw_vers', '-productVersion']), os_build=ci.command(['sw_vers', '-buildVersion']))
            require(actual['image'] == pair['host_image'], 'exact admitted fleet image')
            qualify_toolchain(actual, json.loads((roots['H'] / 'desktop/macos/ci-toolchain.json').read_text()))
            report['toolchain'] = actual
            from ci_xctest import runner_environment
            env = runner_environment()
            env.update(RUSTUP_AUTO_INSTALL='0', GIT_OPTIONAL_LOCKS='0')
            for k, root in [('controller', controller), *roots.items()]:
                run(['make', 'setup'], raw / (k + '-setup.log'), 600, cwd=root, env=env)
                require_checkout(root, admission['controller_sha'] if k == 'controller' else pair[k])
            require(digest(package / 'manifest.json') == MANIFEST, 'retained P10 manifest')
            helper = output / 'startup-owner-observer'
            run(['xcrun', 'swiftc', '-swift-version', '5', '-parse-as-library',
                 'desktop/macos/CIStartupObserver.swift', '-o', str(helper)], raw / 'observer-compile.log', 40, env=env)
            profiles = output / 'profiles'
            profiles.mkdir(mode=0o700)
            report['runtime_attempts'] = 1
            report['diagnostic'] = episode(startup, owner, clock, using, folder=raw, profiles=profiles,
                app=package / 'NAC.app', manifest=package / 'manifest.json', roots=roots, pair=pair, helper=helper, run=run)
            with using(clock.cleanup):
                require_checkout(controller, admission['controller_sha'])
                for k, root in roots.items():
                    require_checkout(root, pair[k])
            require(report['diagnostic']['status'] == 'GO' and not clock.failed and not STOP, 'diagnostic NO_GO')
            report['status'] = 'GO'
    except BaseException as error:
        report['error_type'] = type(error).__name__
        clock.fail('diagnostic failed/unknown')
        raise
    finally:
        report.update(ended_epoch=time.time(), clock_failures=clock.failed, stop_signals=STOP)
        with using(clock.retention):
            write(raw / 'preflight.json', report)
            export_evidence(raw, exported, [*redact_values(),
                *((str(root), '<' + k + '-checkout>') for k, root in roots.items()),
                (str(package), '<retained-package>'), (str(output), '<owned-output>')],
                include_hashes=True, strict_json=True, essential_first=True)


if __name__ == '__main__':
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda number, frame: STOP.append(number))
    main()
