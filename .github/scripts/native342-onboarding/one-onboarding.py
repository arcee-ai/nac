#!/usr/bin/env python3
"""NEVERMERGE experiment. Root must separately admit exactly one real case."""
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import plistlib
import re
import signal
import sys
import time

STOP = []
BRANCH = 'refs/heads/codex/experimental-native342-onboarding-post648-p9'
SCOPE = 'Q04c-on-final-post648-P-onboarding-only'


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write(path, value):
    data = (json.dumps(value, indent=2) + '\n').encode()
    require(len(data) <= 256 * 1024, 'bounded controller evidence')
    path.write_bytes(data)


def admit(value, controller_sha, *, now=None):
    """Validate a declaration; this function never issues execution authority."""
    require(set(value) == {'scope', 'controller_sha', 'allocation_id', 'attempt', 'retries',
                          'manifest_sha256', 'clock', 'producer'}, 'exact admission fields')
    require(value['scope'] == SCOPE and value['controller_sha'] == controller_sha
            and re.fullmatch('[0-9a-f]{40}', controller_sha), 'frozen controller binding')
    require(type(value['attempt']) is int and value['attempt'] == 1
            and type(value['retries']) is int and value['retries'] == 0, 'one attempt, no retries')
    require(isinstance(value['allocation_id'], str)
            and re.fullmatch('[A-Za-z0-9_-]{1,100}', value['allocation_id']), 'named Root allocation')
    require(re.fullmatch('[0-9a-f]{64}', str(value['manifest_sha256'])), 'exact retained package manifest')
    producer = value['producer']
    require(set(producer) == {'run_id', 'artifact_id', 'controller_sha', 'branch', 'artifact_name'}
            and all(type(producer[k]) is int and producer[k] > 0 for k in ('run_id', 'artifact_id'))
            and re.fullmatch('[0-9a-f]{40}', str(producer['controller_sha']))
            and re.fullmatch('codex/[A-Za-z0-9_./-]{1,150}', str(producer['branch']))
            and re.fullmatch('[A-Za-z0-9_.-]{1,200}', str(producer['artifact_name'])), 'exact named producer run/artifact/source')
    clock = value['clock']
    keys = ('STARTED', 'WORK_DEADLINE', 'CLEANUP_DEADLINE', 'HARD_DEADLINE')
    require(set(clock) == set(keys) and all(type(clock[k]) in (int, float) for k in keys),
            'exact original numeric clock')
    start, work, cleanup, hard = [clock[k] for k in keys]
    stamp = time.time() if now is None else now
    require(all(math.isfinite(x) for x in (start, work, cleanup, hard, stamp))
            and start <= stamp < work < cleanup < hard
            and 0 < hard - start <= 1380 and work - start <= 900
            and cleanup - work >= 360 and hard - cleanup >= 120,
            'original queue-inclusive <=23m clock, <=15m work, >=6m cleanup, >=2m retention')
    return start, work, cleanup, hard


def selected_case(startup, *, folder, profiles, app, manifest, product, tests, harness_sha,
                  selection, observer, image_reader, run, command, native_report):
    # No qualify(), protocol executable, CASES loop, or other scenario admission.
    proof = startup.run_case(folder=folder, profiles=profiles, scenario='onboarding', app=app,
        manifest=manifest, product=product, tests=tests, harness_sha=harness_sha,
        selection=selection, observer=observer, image_reader=image_reader,
        run=run, command=command, native_report=native_report)
    require(proof.get('scenario') == 'onboarding' and proof.get('passed') is True
            and proof.get('public_test_requested') is True
            and proof.get('input_completion_unknown') is False
            and proof.get('attachments_complete') is True
            and all(key in proof for key in ('live_api', 'image', 'actual_result'))
            and proof.get('cleanup', {}).get('owned_processes_settled') is True
            and proof.get('profile_removed') is True
            and proof.get('persistent_authorization_policy_unchanged') is True,
            'one actual onboarding case with positive cleanup and unchanged policy')
    return proof


def make_clock(epochs, Bound):
    _, work, cleanup, hard = epochs
    class Clock:
        # The SDK2cee adapter, using the same maintained Bound/ci.run owner.
        # Convert once; phases and cleanup never create a replacement clock.
        monotonic = staticmethod(time.monotonic)

        def __init__(self):
            self.mono, self.epoch = time.monotonic(), time.time()
            self.failed, self.cleaning = [], False
            self.work = Bound(self, self.mono + work - self.epoch, 'work')
            self.cleanup = Bound(self, self.mono + cleanup - self.epoch, 'cleanup')
            self.retention = Bound(self, self.mono + hard - self.epoch, 'retention')

        def fail(self, reason):
            if reason not in self.failed:
                self.failed.append(reason)

        def observe(self):
            before, epoch, after = time.monotonic(), time.time(), time.monotonic()
            if not self.epoch + before - self.mono - 1 <= epoch <= self.epoch + after - self.mono + 1:
                self.fail('clock discontinuity')
            if STOP:
                self.fail('signal requested stop')
            require(not self.failed, 'original clock stopped: ' + ', '.join(self.failed))

    return Clock()


def main():
    require(len(sys.argv) == 1, 'no arbitrary commands or scenarios')
    require(platform.system() == 'Darwin' and platform.machine() == 'arm64', 'actual arm64 macOS host')
    require(os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
            and os.environ.get('GITHUB_REF') == BRANCH
            and os.environ.get('GITHUB_RUN_ATTEMPT') == '1', 'one explicit experimental dispatch')
    controller = Path(__file__).resolve().parents[3]
    pair_path = Path(__file__).with_name('pair.json')
    pair = json.loads(pair_path.read_text())
    require(pair['scope'] == SCOPE, 'fixed source scope')
    admission = json.loads(os.environ['ROOT_ONBOARDING_ADMISSION'])
    start, work, cleanup, hard = admit(admission, os.environ['GITHUB_SHA'])
    roots = {key: Path(os.environ[key + '_ROOT']) for key in ('H', 'P', 'Q')}
    package, output = Path(os.environ['PACKAGE_ROOT']), Path(os.environ['OUTPUT_ROOT'])
    paths = [controller, *roots.values(), package, output]
    require(all(p.is_absolute() and p.resolve() == p for p in paths), 'canonical explicit roots')
    require(all(a != b and not a.is_relative_to(b) and not b.is_relative_to(a)
                for i, a in enumerate(paths) for b in paths[i + 1:]), 'disjoint source/package/output roots')
    require(package.is_dir() and not output.exists() and output.parent.is_dir(), 'retained package and absent owned output')
    manifest, app = package / 'manifest.json', package / 'NAC.app'
    require(digest(manifest) == admission['manifest_sha256'], 'Root-bound retained manifest differs')
    output.mkdir(mode=0o700)
    evidence = output / 'raw'
    evidence.mkdir(mode=0o700)
    exported = output / 'evidence'
    exported.mkdir(mode=0o700)
    report = dict(status='FAIL', scope=SCOPE, pair=pair, pair_sha256=digest(pair_path),
        wrapper_sha256=digest(__file__), admission=admission, controller_sha=os.environ['GITHUB_SHA'],
        runtime_attempts=0, retries=0, full_four_case_run=False, protocol_executed=False,
        prefix_binary_acceptance=False, final_integrated_native_acceptance=False,
        historical_four_Q_failures_preserved=True, prior_SDK_actual_allocation_consumed=True,
        lifecycle531_spent=1, allocation_consumed=True, phases=[])
    write(evidence / 'one-onboarding.json', report)
    write(exported / 'one-onboarding.json', report)  # Initial FAIL survives an import/preflight failure.
    sys.path.insert(0, str(roots['H'] / 'desktop/macos'))
    import ci
    import ci_startup as startup
    from ci_paths_budget import Bound, active, using
    from ci_qualifications import require_checkout
    from ci_support import export_evidence, qualify_toolchain, redact_values, require_console
    from ci_xctest import require_generated_runner, runner_environment
    from ci_xctest_project import materialize_project

    clock = make_clock((start, work, cleanup, hard), Bound)
    # Each work callback is independently clamped below; permit the maintained
    # case's result/owner cleanup callbacks to use the original cleanup reserve.
    ci.RUN_DEADLINE = min(ci.RUN_DEADLINE, clock.cleanup.deadline)

    def save():
        with using(clock.retention):
            write(evidence / 'one-onboarding.json', report)

    def bound():
        current = active()
        return clock.cleanup if (current is not None and current.kind == 'cleanup') or clock.cleaning else clock.work

    def command(argv, cwd=roots['H']):
        with using(bound()):
            return ci.command(argv, cwd=cwd)

    def native_report(argv, log):
        with using(bound()):
            return ci.native_report(argv, log)

    def console(label):
        quartz = native_report([str(gui_reader)], evidence / (label + '-gui.log'))
        registry = command(['/usr/sbin/ioreg', '-a', '-n', 'Root', '-d', '1']).encode()
        return dict(quartz=quartz, console=require_console(registry, os.getuid(), quartz))

    def runtime_build_receipt(argv):
        # Reuse SDK2cee's actual output inspection; never reuse its invalid
        # configuration or compiled-output hashes for this runtime binding.
        derived = Path(argv[argv.index('-derivedDataPath') + 1])
        config = Path(next(x.split('=', 1)[1] for x in argv if x.startswith('NAC_UI_FIXTURE=')))
        binding = {key: next(x.split('=', 1)[1] for x in argv if x.startswith('NAC_STARTUP_' + key.upper() + '='))
                   for key in ('product_sha', 'test_sha', 'harness_sha', 'configuration_sha256')}
        runners = list((derived / 'Build/Products').glob('*.xctestrun'))
        require(len(runners) == 1 and runners[0].stat().st_size <= 256 * 1024, 'one bounded actual runtime xctestrun')
        target = require_generated_runner(plistlib.loads(runners[0].read_bytes()), config, 'NACStartupUITests',
            project_selection=selection['receipt'], startup_binding=binding)

        def build_path(value, host=''):
            expanded = value.replace('__TESTROOT__', str(runners[0].parent)).replace('__TESTHOST__', host)
            path = Path(expanded)
            require('__' not in expanded and path.is_absolute() and path.resolve() == path
                    and path.is_relative_to(derived), 'actual runtime output outside DerivedData')
            return path

        host = build_path(target['TestHostPath'])
        bundle = build_path(target['TestBundlePath'], str(host))
        outputs = {}
        for label, app in [('runner', host), ('test_bundle', bundle)]:
            info = app / 'Contents/Info.plist'
            executable = plistlib.loads(info.read_bytes())['CFBundleExecutable']
            require(Path(executable).name == executable, 'runtime output executable name')
            binary = app / 'Contents/MacOS' / executable
            require(binary.is_file() and binary.resolve() == binary and binary.stat().st_size > 0,
                    'actual runtime compiled binary absent')
            outputs[label] = dict(binary_sha256=digest(binary), info_sha256=digest(info))
        require(digest(config) == binding['configuration_sha256'], 'runtime configuration changed')
        report['runtime_build'] = dict(outputs=outputs, binding=binding, xctestrun_sha256=digest(runners[0]))
        write(evidence / 'runtime-build.json', report['runtime_build'])

    def run(argv, log, cap, cwd=roots['H'], *, env=None, abort=None):
        phase = dict(argv=argv, cap_seconds=cap, started_epoch=time.time(), status='RUNNING')
        report['phases'].append(phase)
        save()
        try:
            operation = clock.work if any(x in argv for x in ('build-for-testing', 'test-without-building')) else bound()
            with using(operation):
                ci.run(argv, log, cap, cwd=cwd, env=env,
                       abort=lambda: bool(STOP) or (abort is not None and abort()))
                if 'build-for-testing' in argv:
                    runtime_build_receipt(argv)
            phase['status'] = 'PASS'
        except BaseException:
            clock.cleaning = True
            phase['status'] = 'FAIL'
            raise
        finally:
            if 'test-without-building' in argv:
                clock.cleaning = True
            phase['ended_epoch'] = time.time()
            save()

    try:
        with using(clock.work):
            require_checkout(controller, admission['controller_sha'])
            for key, root in roots.items():
                require_checkout(root, pair[key])
            require(startup.PRODUCT == pair['P'] and startup.TEST_SOURCE == pair['Q']
                    and startup.TEST_FILES['StartupJourneys.swift'] == pair['q_swift_sha256'], 'actual H/P/Q pins')
            expected = json.loads((roots['H'] / 'desktop/macos/ci-toolchain.json').read_text())
            actual = dict(developer_directory=os.environ.get('DEVELOPER_DIR'),
                xcode=command(['xcodebuild', '-version']), sdk=command(['xcrun', '--sdk', 'macosx', '--show-sdk-version']),
                swift=command(['xcrun', 'swiftc', '--version']), image=os.environ.get('ImageVersion'),
                os_version=command(['sw_vers', '-productVersion']), os_build=command(['sw_vers', '-buildVersion']))
            report['toolchain'] = actual
            save()
            require(actual['image'] == pair['host_image'], 'reviewed actual host image changed')
            qualify_toolchain(actual, expected)
            # Same locked source setup as SDK2cee; no Rust engine/app build.
            setup_env = runner_environment()
            setup_env.update(RUSTUP_AUTO_INSTALL='0', GIT_OPTIONAL_LOCKS='0')
            for key, root in [('controller', controller), *roots.items()]:
                run(['make', 'setup'], evidence / (key + '-setup.log'), 600,
                    cwd=root, env=setup_env)
            for key, root in roots.items():
                require_checkout(root, pair[key])
            # A reused genuine package is inspected, never built or re-signed.
            contract = startup.test_contract(roots['Q'])
            report['package_before'] = startup.package_contract(contract, 'inspect_normal_package',
                [str(manifest), str(app), str(roots['P'])], dict(product_sha=pair['P']),
                tests=roots['Q'], directory=evidence, name='package-before', run=run)
            selection = materialize_project(roots['H'], pair['H'], startup_root=roots['Q'], startup_sha=pair['Q'],
                startup_source_sha256=pair['q_swift_sha256'], output=output / 'startup-project')
            report['selection'] = selection['receipt']
            observer, image_reader = output / 'startup-owner-observer', output / 'startup-image-reader'
            gui_reader = output / 'native-gui-reader'
            for source, target, extra in [('CIStartupObserver.swift', observer, ['-parse-as-library']),
                                          ('CIEvidence.swift', image_reader, []), ('CIGUI.swift', gui_reader, [])]:
                run(['xcrun', 'swiftc', '-swift-version', '5', *extra, 'desktop/macos/' + source, '-o', str(target)],
                    evidence / (source + '.log'), 90, env=runner_environment())
            report['compiled_helpers'] = {name: digest(path) for name, path in
                [('owner_observer', observer), ('image_reader', image_reader), ('gui_reader', gui_reader)]}
            report['console_before'] = console('before')
        profiles = output / 'profiles'
        profiles.mkdir(mode=0o700)
        report['runtime_attempts'] = 1
        save()
        with using(clock.cleanup):
            report['case'] = selected_case(startup, folder=evidence / 'onboarding', profiles=profiles,
                app=app, manifest=manifest, product=roots['P'], tests=roots['Q'], harness_sha=pair['H'],
                selection=selection, observer=observer, image_reader=image_reader,
                run=run, command=command, native_report=native_report)
            clock.cleaning = True
            report['console_after'] = console('after')
            report['package_after'] = startup.package_contract(contract, 'inspect_normal_package',
                [str(manifest), str(app), str(roots['P'])], dict(product_sha=pair['P']),
                tests=roots['Q'], directory=evidence, name='package-after', run=run)
            require(report['package_before'] == report['package_after'], 'package admission changed')
            require(not any(profiles.iterdir()), 'unknown/retained owned profile; stop')
            profiles.rmdir()
            for key, root in roots.items():
                require_checkout(root, pair[key])
            require_checkout(controller, admission['controller_sha'])
            require(not clock.failed and not STOP, 'clock/ownership failure remains latched')
            report['status'] = 'PASS'
    except BaseException as error:
        report.update(error_type=type(error).__name__, error='selected experiment failed; retain stage evidence')
        raise
    finally:
        report.update(ended_epoch=time.time(), clock_failures=clock.failed, stop_signals=STOP)
        try:
            save()
        finally:
            with using(clock.retention):
                export_evidence(evidence, exported, [*redact_values(),
                    *((str(root), '<' + key + '-checkout>') for key, root in roots.items()),
                    (str(package), '<retained-package>'), (str(output), '<owned-output>')],
                    include_hashes=True, strict_json=True, essential_first=True)


if __name__ == '__main__':
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda number, frame: STOP.append(number))
    main()
