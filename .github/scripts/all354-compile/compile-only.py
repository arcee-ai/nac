#!/usr/bin/env python3
"""One frozen H/T compile control. No app, XCTest or input execution."""
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import signal
import sys
import time
import traceback

STOP = []
for sig in (signal.SIGTERM, signal.SIGINT):
    signal.signal(sig, lambda number, frame: STOP.append(number))


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def write(path, value):
    encoded = (json.dumps(value, indent=2) + '\n').encode()
    require(len(encoded) <= 256 * 1024, 'bounded evidence JSON')
    path.write_bytes(encoded)


def clock_inputs(environment, *, now=None):
    values = [float(environment['COMPILE_' + key + '_EPOCH'])
              for key in ('STARTED', 'WORK_DEADLINE', 'CLEANUP_DEADLINE', 'HARD_DEADLINE')]
    require(all(math.isfinite(x) for x in values), 'finite original clock')
    start, work, cleanup, hard = values
    stamp = time.time() if now is None else now
    require(start <= stamp < work < cleanup < hard and hard - start <= 2400
            and work <= hard - 600 and cleanup <= hard - 120,
            'original queue-inclusive <=40m clock, >=10m cleanup/upload and >=2m upload reserve')
    return values


def bootstrap_minutes(environment, cap, *, now=None):
    stamp = time.time() if now is None else now
    _, work, _, _ = clock_inputs(environment, now=stamp)
    require(type(cap) is int and 1 <= cap <= 3, 'fixed bootstrap step cap')
    # Whole-minute Actions timeout; leave a declared 60s controller margin.
    # This is conservative budget arithmetic, not a measured scheduler-latency bound.
    minutes = min(cap, math.floor((work - stamp - 60) / 60))
    require(minutes >= 1, 'insufficient original work budget for bootstrap step')
    return minutes


def bootstrap_gate(phase):
    caps = {'rust': 3, 'node': 2, 'checkout-H': 2, 'checkout-T': 2}
    require(phase in caps, 'fixed bootstrap phase')
    evidence = Path(os.environ['RUNNER_TEMP']) / 'nac-compile-gate'
    require(evidence.is_dir() and evidence.resolve() == evidence, 'existing canonical gate evidence')
    report = dict(phase=phase, status='FAIL', observed_epoch=time.time(),
                  original_clock={key: os.environ.get('COMPILE_' + key + '_EPOCH')
                                  for key in ('STARTED', 'WORK_DEADLINE', 'CLEANUP_DEADLINE', 'HARD_DEADLINE')})
    try:
        require(not STOP, 'bootstrap stop requested')
        minutes = bootstrap_minutes(os.environ, caps[phase])
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            stream.write('minutes=' + str(minutes) + '\n')
        report.update(status='PASS', timeout_minutes=minutes, controller_margin_seconds=60)
    except BaseException as error:
        report['error'] = type(error).__name__ + ': ' + str(error)
        raise
    finally:
        write(evidence / ('clock-' + phase + '.json'), report)


def main():
    # OUTPUT_ROOT belongs to this job only; source trees remain clean.
    output = Path(os.environ['OUTPUT_ROOT'])
    require(output.is_absolute() and output.resolve() == output
            and not output.exists() and output.parent.is_dir(), 'absent canonical output root')
    output.mkdir(mode=0o700)
    evidence = output / 'evidence'
    evidence.mkdir(mode=0o700)
    report = dict(status='FAIL', compile_only=True, native_acceptance=False,
                  app_started=False, tests_executed=False, input_actor_started=False,
                  allocation_consumed=False, started_epoch=time.time(), phases=[], engines={})
    budget = None
    try:
        pair_path = Path(__file__).with_name('compile-pair.json')
        pair = json.loads(pair_path.read_text())
        report.update(pair=pair, pair_sha256=digest(pair_path), wrapper_sha256=digest(__file__))
        require(all(re.fullmatch('[0-9a-f]{40}', str(pair.get(key))) for key in ('H', 'T')),
                'T is UNBOUND: exact Native handoff and Root pair admission required')
        start, work, cleanup, hard = clock_inputs(os.environ)
        report['original_clock'] = dict(start=start, work=work, cleanup=cleanup, hard=hard)
        H, T = [Path(os.environ[key + '_ROOT']) for key in ('H', 'T')]
        require(all(p.is_absolute() and p.resolve() == p for p in (H, T)), 'canonical sources')
        require(not any(a == b or a.is_relative_to(b) or b.is_relative_to(a)
                        for a, b in ((H, T), (H, output), (T, output))), 'disjoint sources/output')
        require(platform.system() == 'Darwin' and platform.machine() == 'arm64', 'Apple Silicon macOS')
        require(os.environ.get('GITHUB_RUN_ATTEMPT') == '1'
                and os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
                and os.environ.get('GITHUB_REF') == 'refs/heads/codex/all-354-xcode-environment-20261107',
                'first explicit isolated diagnostic dispatch only')
        sys.path.insert(0, str(H / 'desktop/macos'))
        import ci
        from ci_paths_budget import Bound, using
        from ci_paths_protocol import PRODUCT, HELPER
        from ci_qualifications import require_checkout
        from ci_paths import verify_build
        from ci_xctest_project import materialize_project
        from ci_xctest import runner_environment, require_generated_runner
        from ci_support import qualify_toolchain

        class CompileClock:
            # Small adapter to the maintained Bound/ci.run ownership mechanism.
            # No native allocation, timer signal or replacement process supervisor.
            monotonic = staticmethod(time.monotonic)

            def __init__(self):
                self.mono, self.epoch = time.monotonic(), time.time()
                self.failed = []
                self.work = Bound(self, min(ci.RUN_DEADLINE, self.mono + work - self.epoch), 'work')
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
                require(not self.failed, 'compile stop: ' + ', '.join(self.failed))

        budget = CompileClock()
        ci.RUN_DEADLINE = min(ci.RUN_DEADLINE, budget.work.deadline)
        report['effective_work_epoch'] = budget.epoch + budget.work.deadline - budget.mono

        def save():
            with using(budget.retention):
                write(evidence / 'compile-only-result.json', report)

        def command(argv, cwd=H):
            budget.work.check()
            result = ci.command(argv, cwd=cwd)
            budget.work.check()
            return result

        def run(label, argv, root, env, cap):
            phase = dict(label=label, argv=argv, cwd=str(root), started_epoch=time.time(), status='RUNNING')
            report['phases'].append(phase)
            save()
            try:
                with using(budget.work):
                    ci.run(argv, evidence / (label + '.log'), cap, cwd=root, env=env,
                           abort=lambda: bool(STOP))
                phase['status'] = 'PASS'
            finally:
                phase['ended_epoch'] = time.time()
                if phase['status'] != 'PASS':
                    phase['status'] = 'FAIL'
                save()

        with using(budget.work):
            require(pair['T'] == PRODUCT, 'T differs from maintained PRODUCT; explicit reviewed H binding required')
            require_checkout(H, pair['H'])
            require_checkout(T, pair['T'])
            require(digest(H / 'desktop/macos/preview.sh') == pair['h_writer_sha256'], 'H writer changed')
            require(digest(T / 'desktop/macos/NativePathJourney.swift') == HELPER, 'actual helper changed')
            expected = json.loads((H / 'desktop/macos/ci-toolchain.json').read_text())
            actual = dict(developer_directory=os.environ.get('DEVELOPER_DIR'),
                          xcode=command(['xcodebuild', '-version']),
                          sdk=command(['xcrun', '--sdk', 'macosx', '--show-sdk-version']),
                          swift=command(['xcrun', 'swiftc', '--version']),
                          image=os.environ.get('ImageVersion'),
                          os_version=command(['sw_vers', '-productVersion']),
                          os_build=command(['sw_vers', '-buildVersion']))
            report['toolchain'] = actual
            save()  # Preserve measured host even if the guard rejects it.
            require(actual['image'] == pair['host_image'], 'selected current host image changed')
            qualify_toolchain(actual, expected)
            tools = {name: command(argv) for name, argv in (
                ('rustc', ['rustc', '--version']), ('cargo', ['cargo', '--version']),
                ('node', ['node', '--version']), ('npm', ['npm', '--version']))}
            report['existing_tools'] = tools
            require(tools['rustc'].split()[1] == pair['rust_version']
                    and tools['cargo'].split()[1] == pair['rust_version']
                    and tools['node'] == pair['node_version'], 'repository-pinned Rust/Node bootstrap versions differ')
            report['host_resources'] = {name: command(argv) for name, argv in (
                ('logical_cpus', ['sysctl', '-n', 'hw.logicalcpu']),
                ('memory_bytes', ['sysctl', '-n', 'hw.memsize']), ('disk', ['df', '-k', str(output)]))}
            base = runner_environment()
            for key in tuple(base):
                if key.startswith(('NAC_', 'CARGO_', 'RUST', 'GIT_')):
                    del base[key]
            base.update(CARGO_BUILD_JOBS='2', CARGO_PROFILE_DEV_DEBUG='0',
                        CARGO_TARGET_DIR=str(output / 'shared-cargo'), GIT_OPTIONAL_LOCKS='0',
                        RUSTUP_AUTO_INSTALL='0', RUSTUP_TOOLCHAIN=pair['rust_version'])
            engines = output / 'engines'
            engines.mkdir(mode=0o700)
            # All target mutations are sequential. Cargo retains its own fingerprint decisions.
            for label, root in (('H', H), ('T', T)):
                sha = pair[label]
                env = dict(base, NAC_SOURCE_REVISION=sha, NAC_BUILD_TRACK='dev', NAC_BUILD_ID='dev-' + sha)
                run(label + '-setup', ['make', 'setup'], root, env, 600)
                require_checkout(root, sha)
                run(label + '-engine', ['cargo', 'build', '--locked', '-p', 'nac-server', '--bin', 'nac-web'],
                    root, env, 1200)
                copied = engines / (label + '-nac-web')
                shutil.copy2(output / 'shared-cargo/debug/nac-web', copied)
                copied.chmod(0o500)
                identity = json.loads(command([str(copied), '__desktop-identity'], cwd=root))
                require(identity.get('source_revision') == sha and identity.get('track') == 'dev'
                        and identity.get('build_id') == 'dev-' + sha, label + ' copied engine identity differs')
                report['engines'][label] = dict(path=str(copied), sha256=digest(copied), identity=identity)
                save()
                modes = ('build',) if label == 'H' else ('app-build', 'smoke-build')
                app_output = output / (label + '-apps')
                env.update(NAC_MAC_ENGINE=str(copied), NAC_MAC_SKIP_ENGINE_BUILD='1', NAC_MAC_OUTPUT=str(app_output))
                for mode in modes:
                    run(label + '-' + mode, ['bash', 'desktop/macos/preview.sh', mode], root, env, 300)
                for previous, engine in report['engines'].items():
                    require(digest(engine['path']) == engine['sha256'], previous + ' copied engine was mutated')

            h_native = output / 'H-apps/NAC Development Preview.app'
            h_sources = [H / 'desktop/macos' / p for p in pair['h_smoke_sources']]
            h_smoke = output / 'H-smoke-link'
            h_smoke.mkdir()
            run('H-smoke-link', ['xcrun', 'swiftc', *pair['h_smoke_flags'],
                                *[str(p) for p in h_sources], '-o', str(h_smoke / 'NACPreview')], H, base, 300)
            report['H_roles'] = dict(writer_sha256=digest(H / 'desktop/macos/preview.sh'),
                smoke_flags=pair['h_smoke_flags'], smoke_sources={str(p): digest(p) for p in h_sources},
                smoke_binary_sha256=digest(h_smoke / 'NACPreview'),
                ordinary_flags=pair['h_smoke_flags'][:5] + pair['h_smoke_flags'][7:],
                ordinary_sources={str(p): digest(p) for p in h_sources[:7]},
                ordinary={name: digest(h_native / relative) for name, relative in (
                    ('native', 'Contents/MacOS/NACPreview'), ('engine', 'Contents/Resources/nac-web'),
                    ('plist', 'Contents/Info.plist'), ('identity', 'Contents/Resources/engine-identity.json'))})
            require(report['H_roles']['ordinary']['engine'] == report['engines']['H']['sha256'], 'H bundle engine changed')
            require(json.loads((h_native / 'Contents/Resources/engine-identity.json').read_text())
                    == report['engines']['H']['identity'], 'H bundled identity changed')
            report['T_builds'] = {mode: verify_build(T, output / 'T-apps' / app, mode)
                for mode, app in (('app-build', 'NAC.app'), ('smoke-build', 'NAC Development Preview Smoke.app'))}
            require(all(row['engine_sha256'] == report['engines']['T']['sha256']
                        and row['engine_identity'] == report['engines']['T']['identity']
                        for row in report['T_builds'].values()), 'T bundled engine identity changed')
            selection = materialize_project(H, pair['H'], paths_root=T, paths_sha=pair['T'], output=output / 'path-project')
            report['selection'] = selection['receipt']
            config = output / 'compile-only-configuration.json'
            write(config, dict(version=1, scenario='compile-only-NOT-AUTHORIZED', product_sha=pair['T'],
                harness_sha=pair['H'], helper_sha256=HELPER, compiler_sources=selection['receipt']['sources']))
            config_hash = digest(config)
            derived = output / 'path-derived'
            argv = ['xcodebuild', 'build-for-testing', '-project', selection['project'], '-scheme', selection['scheme'],
                    '-destination', 'platform=macOS,arch=arm64', '-derivedDataPath', str(derived),
                    '-jobs', '2', '-parallel-testing-enabled', 'NO', 'NAC_UI_FIXTURE=' + str(config),
                    'NAC_PATH_HARNESS_SHA=' + pair['H'], 'NAC_PATH_CONFIGURATION_SHA256=' + config_hash]
            run('paths-build-for-testing', argv, H, base, 300)
            runners = list((derived / 'Build/Products').glob('*.xctestrun'))
            require(len(runners) == 1 and runners[0].stat().st_size <= 256 * 1024, 'one bounded actual xctestrun')
            encoded = runners[0].read_bytes()
            report['generated_target'] = require_generated_runner(plistlib.loads(encoded), config, 'NACPathUITests',
                project_selection=selection['receipt'], paths_binding=dict(harness_sha=pair['H'], configuration_sha256=config_hash))
            target = report['generated_target']

            def build_path(value, host=''):
                expanded = value.replace('__TESTROOT__', str(runners[0].parent)).replace('__TESTHOST__', host)
                path = Path(expanded)
                require('__' not in expanded and path.is_absolute() and path.resolve() == path
                        and path.is_relative_to(derived), 'actual XCTest output path outside DerivedData')
                return path

            host = build_path(target['TestHostPath'])
            bundle = build_path(target['TestBundlePath'], str(host))
            artifacts = {}
            for label, app in (('runner', host), ('test_bundle', bundle)):
                info = app / 'Contents/Info.plist'
                metadata = plistlib.loads(info.read_bytes())
                executable = metadata['CFBundleExecutable']
                require(Path(executable).name == executable, 'compiled output executable name')
                binary = app / 'Contents/MacOS' / executable
                require(binary.is_file() and binary.resolve() == binary and binary.stat().st_size > 0,
                        'actual full compiled XCTest output missing')
                artifacts[label] = dict(path=str(binary), binary_sha256=digest(binary), info_sha256=digest(info))
            report['compiled_xctest_outputs'] = artifacts
            project = Path(selection['project'])
            require(digest(project / 'project.pbxproj') == selection['receipt']['generated_project_sha256']
                    and digest(project / 'xcshareddata/xcschemes/NACPathUITests.xcscheme')
                    == selection['receipt']['selected_scheme_sha256'], 'generated compiler project changed')
            require(digest(config) == config_hash, 'compile-only configuration changed')
            (evidence / 'generated.xctestrun').write_bytes(encoded)
            report.update(xctestrun_sha256=digest(runners[0]), configuration_sha256=config_hash)
            for path, expected_hash in selection['receipt']['sources'].items():
                require(digest(path) == expected_hash, 'selected source changed during build')
            require_checkout(H, pair['H'])
            require_checkout(T, pair['T'])
            require(not budget.failed, 'compile clock/cleanup failed')
            report['status'] = 'PASS'
    except BaseException as error:
        report.update(status='FAIL', error_type=type(error).__name__, error=str(error), traceback=traceback.format_exc()[-8192:])
        raise
    finally:
        report.update(ended_epoch=time.time(), stop_signals=STOP,
                      clock_failures=budget.failed if budget else [])
        # Small fixed receipt only. ci.run already retains <=256KiB per log and ownership.
        # No target/apps/DerivedData upload, relabeling, deletion or unowned process cleanup.
        if budget:
            budget.retention.check()
        write(evidence / 'compile-only-result.json', report)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--bootstrap-budget':
        bootstrap_gate(sys.argv[2])
    else:
        require(len(sys.argv) == 1, 'compile control takes no arbitrary command')
        main()
