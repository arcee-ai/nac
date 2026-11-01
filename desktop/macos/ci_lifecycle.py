"""Fixed hosted ALL-344 composition; the immutable supplier owns native cleanup."""
import json
import os
from pathlib import Path
import runpy
import shutil
import signal
import subprocess
import sys
import time

from ci_lifecycle_contract import (ALLOCATION, CASES, MODES, SOURCE, TARGET, Ledger, canonical, digest,
                                   persist, require_build, require_capsule, require_case,
                                   require_console, require_source)
from ci_lifecycle_evidence import export_plan, images
import ci_lifecycle_ownership as ownership
from ci_qualifications import require_checkout
from ci_support import redact_values

ROOT = Path(__file__).resolve().parents[2]
CASE_SECONDS = 240
CASE_ENVELOPE = 360  # Guards, driver, five bounded image reads and residual audit.
CLEANUP_SECONDS = 150
UPLOAD_SECONDS = 120


class DriverFailure(RuntimeError):
    """The owned target driver returned a known nonzero exit status."""


def child_command(action, source, *arguments):
    if action not in ('console', 'driver'):
        raise RuntimeError('Unknown lifecycle adapter phase')
    return [sys.executable, '-B', str(Path(__file__).resolve()), action, str(source), *map(str, arguments)]


def run_case(command, log, environment, *, spawn=subprocess.Popen):
    """Own the driver handle, and allow unchanged target finally blocks to run.

    No app/engine PID from JSON is ever signal authority. A forced driver exit
    is a failure/unknown result, never successful native cleanup evidence.
    """
    with log.open('w') as stream:
        process = None
        status = {'command': command, 'scenario': environment.get('NAC_LIFECYCLE_SCENARIOS'),
                  'source_sha': SOURCE, 'state': 'spawn_pending'}
        status_path = log.parent / 'driver-status.json'
        try:
            # Defer cancellation across creation/assignment of the direct
            # handle. The child installs its handler and unblocks these before
            # entering the unchanged supplier. No native work starts masked.
            previous = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM, signal.SIGINT})
            try:
                process = spawn(command, env=environment, cwd=environment['NAC_LIFECYCLE_SOURCE'],
                                stdout=stream, stderr=subprocess.STDOUT)
                status.update(state='started', owned_driver_pid=process.pid)
                persist(status_path, status)
            finally:
                signal.pthread_sigmask(signal.SIG_SETMASK, previous)
            end = time.monotonic() + CASE_SECONDS
            while True:
                ownership.retain(log.parent, environment['NAC_LIFECYCLE_SCENARIOS'])
                remaining = end - time.monotonic()
                if remaining <= 0:
                    raise subprocess.TimeoutExpired(command, CASE_SECONDS)
                try:
                    code = process.wait(timeout=min(.1, remaining))
                    break
                except subprocess.TimeoutExpired:
                    continue
            ownership.retain(log.parent, environment['NAC_LIFECYCLE_SCENARIOS'])
            if code:
                raise DriverFailure('Lifecycle driver failed: ' + str(code))
            status.update(state='exited', exit_code=code)
            persist(status_path, status)
            return status
        except BaseException as primary:
            errors = []
            try:
                if process is not None and process.poll() is None:
                    process.terminate()  # One SIGTERM to our direct driver handle.
                    process.wait(timeout=CLEANUP_SECONDS)
            except BaseException as error:
                errors.append(type(error).__name__)
            finally:
                try:
                    if process is not None and process.poll() is None:
                        process.kill()  # Only the Popen-owned driver, never native/PID JSON.
                        process.wait(timeout=5)
                        errors.append('forced_driver_exit_native_cleanup_unknown')
                except BaseException as error:
                    errors.append(type(error).__name__)
            if errors and hasattr(primary, 'add_note'):
                primary.add_note('Driver settlement uncertainty: ' + ','.join(errors))
            try:
                status.update(state='failed_or_unknown', error_type=type(primary).__name__, settlement_errors=errors)
                persist(status_path, status)
            except BaseException as error:
                if hasattr(primary, 'add_note'):
                    primary.add_note('Driver receipt unavailable: ' + type(error).__name__)
            raise


def read_residual(command):
    return subprocess.check_output(command, text=True, stderr=subprocess.STDOUT, timeout=4).strip()


def image_report(command, log):
    try:
        observed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=10)
    except subprocess.TimeoutExpired:
        log.write_text('Lifecycle native image reader timed out; completion unknown\n')
        persist(log.with_suffix('.json'), {'readable': False, 'completion_unknown': True,
                                         'error_type': 'TimeoutExpired', 'timeout_seconds': 10})
        raise
    log.write_text(observed.stderr[-65536:])
    persist(log.with_suffix('.json'), {'exit_code': observed.returncode,
        'stdout': observed.stdout[-65536:], 'stderr': observed.stderr[-65536:],
        'stdout_truncated': len(observed.stdout.encode()) > 65536,
        'stderr_truncated': len(observed.stderr.encode()) > 65536})
    if len(observed.stdout.encode()) > 65536 or len(observed.stderr.encode()) > 65536:
        raise RuntimeError('Lifecycle image observation exceeds the critical receipt bound')
    if observed.returncode:
        raise RuntimeError('Lifecycle snapshot readability failed; see ' + log.name)
    return json.loads(observed.stdout)


def audit_cleanup(destination, observer, command):
    """Read source-bound private paths; never signal an observed native PID."""
    canonical(destination)
    if destination.name in CASES:
        ownership.retain(destination, destination.name)
    roots = []
    for path in destination.glob('nac-lifecycle-app-*'):
        canonical(path, parent=destination)
        if not path.is_dir():
            raise RuntimeError('Lifecycle retained fixture is not a private directory')
        roots.append(path)
    summary_path = destination / 'summary.json'
    if summary_path.exists():
        canonical(summary_path, parent=destination)
        summary = json.loads(summary_path.read_text())
        retained = summary.get('fixture_retained')
        if retained:
            root = canonical(Path(retained), parent=destination, exists=False)
            if root.parent != destination or not root.name.startswith('nac-lifecycle-app-'):
                raise RuntimeError('Lifecycle retained fixture escaped its case')
            if root not in roots:
                roots.append(root)
        for case in summary.get('cases', []):
            store = case.get('native', {}).get('ready_store')
            if not store:
                continue
            root = canonical(Path(store).parent.parent, parent=destination, exists=False)
            if root.parent != destination or not root.name.startswith('nac-lifecycle-app-'):
                raise RuntimeError('Lifecycle selected store escaped the exact fixture')
            if root not in roots:
                roots.append(root)
    applications = []
    receipt = None
    if (destination / 'ownership.json').exists():
        receipt = ownership.require(destination, destination.name)
        root = Path(receipt['fixture_root'])
        if root not in roots:
            roots.append(root)
    if len(roots) > 1:
        raise RuntimeError('Unexpected extra lifecycle fixture; residual custody unknown')
    for root in roots:
        bundle = root / 'Relocated app folder with spaces/NAC Lifecycle Smoke.app'
        observed = json.loads(command([str(observer), 'state', str(bundle)]))
        if not isinstance(observed.get('apps'), list):
            raise RuntimeError('Lifecycle application residual observation unavailable')
        applications.extend(observed['apps'])
    # Internally inspect the process list, exporting only rows that contain the
    # exact canonical private case path. The terminal runs plain /bin/sleep;
    # its retained source-owned PID is checked separately without any signal.
    remaining = []
    descendants = []
    prefix = str(destination) + '/'
    process_rows = command(['/bin/ps', '-ww', '-axo', 'pid=,stat=,command='])
    if not process_rows.strip() or len(process_rows.encode()) > 2 * 1024 * 1024:
        raise RuntimeError('Lifecycle process residual observation unavailable or oversized')
    for line in process_rows.splitlines():
        fields = line.strip().split(None, 2)
        if (len(fields) == 3 and not fields[1].startswith('Z') and receipt is not None
                and int(fields[0]) == receipt['fixture']['descendant_pid']):
            descendants.append({'pid': int(fields[0]), 'state': fields[1]})
        if len(fields) == 3 and not fields[1].startswith('Z') and prefix in fields[2]:
            remaining.append({'pid': int(fields[0]), 'state': fields[1], 'command': fields[2][:2048]})
    result = {'complete': not applications and not remaining and not descendants, 'applications': applications,
              'recorded_descendants_still_live_or_reused': descendants,
              'private_fixture_processes': remaining, 'retained_failure_roots': [str(x) for x in roots if x.exists()],
              'fallback_signals': False, 'arbitrary_JSON_PID_signals': False}
    return result


def require_budget(deadline, name):
    remaining = len(CASES) - CASES.index(name)
    if deadline - time.monotonic() < remaining * CASE_ENVELOPE + CLEANUP_SECONDS + UPLOAD_SECONDS:
        raise RuntimeError('Insufficient bounded lifecycle/cleanup/upload budget; no case reserved')


def _require_builds(folder, source, engine_sha):
    return {mode: require_build(mode, folder / app, source, engine_sha) for mode, app in MODES.items()}


def qualify(raw, source, target, harness_sha, run, command, native_report, deadline, *, audit_command=read_residual):
    if any(target.get(k) != v for k, v in TARGET.items()):
        raise RuntimeError('Unexpected lifecycle target contract')
    capsule = require_capsule(os.environ.get('NAC_LIFECYCLE_CUSTODY', ''), harness_sha, os.environ)
    require_source(source, ROOT)
    control = raw / 'lifecycle'
    control.mkdir(mode=0o700)
    ledger = Ledger(control, capsule, os.environ['GITHUB_RUN_ID'])
    environment = dict(os.environ, NAC_LIFECYCLE_SOURCE=str(source), NAC_LIFECYCLE_CUSTODY=json.dumps(capsule),
                       NAC_LIFECYCLE_CONTROLLER=str(control), NAC_SOURCE_REVISION=SOURCE,
                       NAC_BUILD_TRACK='dev', NAC_BUILD_ID='dev-ci-lifecycle-' + SOURCE)
    builds = {}
    try:
        # Validate the unchanged target's own prerequisite before builds and
        # again at every reservation. No local guard override or TCC mutation.
        console = json.loads(command(child_command('console', source), cwd=source))
        persist(control / 'console-preflight.json', console)
        require_console(console)
        cargo = raw.parent / (raw.name + '-lifecycle-cargo')
        environment['CARGO_TARGET_DIR'] = str(cargo)
        run(['cargo', 'build', '--locked', '-p', 'nac-server', '--bin', 'nac-web'],
            raw / 'lifecycle-engine-build.log', 900, cwd=source, env=environment)
        folder = raw / 'lifecycle-builds'
        folder.mkdir()
        engine = folder / 'private-engine/nac-web'
        engine.parent.mkdir()
        shutil.copy2(cargo / 'debug/nac-web', engine)
        engine_sha = digest(engine)
        identity = json.loads(command([str(engine), '__desktop-identity'], cwd=source))
        if (identity.get('source_revision') != SOURCE or identity.get('track') != 'dev'
                or identity.get('build_id') != environment['NAC_BUILD_ID']):
            raise RuntimeError('Private lifecycle Rust engine identity differs')
        environment.update(NAC_MAC_ENGINE=str(engine), NAC_MAC_SKIP_ENGINE_BUILD='1', NAC_MAC_OUTPUT=str(folder))
        for mode in MODES:
            run(['bash', 'desktop/macos/preview.sh', mode], raw / ('lifecycle-' + mode + '.log'),
                120, cwd=source, env=environment)
            builds[mode] = require_build(mode, folder / MODES[mode], source, engine_sha)
        observer = folder / 'InstanceObservation'
        canonical(observer, parent=folder)
        ordinary = folder / 'NAC.app/Contents/MacOS/NACPreview'
        symbols = command(['/usr/bin/nm', str(ordinary)]) + command(['/usr/bin/strings', str(ordinary)])
        if any(marker in symbols for marker in ('LifecycleSmoke', 'QuitWebViewFixture', '__quitLifecycleObserver',
                                                'PreviewSmoke', 'StartupSmoke', 'InstanceSmoke', 'NativeCommandInput')):
            raise RuntimeError('Ordinary lifecycle bundle contains fixture instrumentation')
        manifest = {'source': SOURCE, 'engine_sha256': engine_sha, 'identity': identity,
                    'observer_sha256': digest(observer), 'builds': builds}
        persist(control / 'builds.json', manifest)
        helper = raw / 'lifecycle-image-reader'
        run(['xcrun', 'swiftc', '-swift-version', '5', 'desktop/macos/CILifecycleImages.swift', '-o', str(helper)],
            raw / 'lifecycle-image-reader-build.log', 90)
        reader_sha = digest(helper)
        persist(control / 'readers.json', {'observer_sha256': digest(observer), 'image_reader_sha256': reader_sha,
                                          'image_reader_source_sha256': digest(ROOT / 'desktop/macos/CILifecycleImages.swift')})
        assets = {str(p.relative_to(source / 'crates/nac-server/assets/dist')): digest(p)
                  for p in (source / 'crates/nac-server/assets/dist').rglob('*') if p.is_file()}
        if not assets:
            raise RuntimeError('No exact lifecycle production assets')
        results = []
        for name in CASES:
            require_budget(deadline, name)
            case_deadline = time.monotonic() + CASE_ENVELOPE
            require_checkout(ROOT, harness_sha)
            require_source(source, ROOT)
            require_capsule(environment['NAC_LIFECYCLE_CUSTODY'], harness_sha, environment)
            _require_builds(folder, source, engine_sha)
            if digest(observer) != manifest['observer_sha256'] or digest(helper) != reader_sha:
                raise RuntimeError('Lifecycle observer/image reader changed before reservation')
            console = json.loads(command(child_command('console', source), cwd=source))
            persist(control / ('console-before-' + name + '.json'), console)
            require_console(console)
            if case_deadline - time.monotonic() < CASE_SECONDS + 50 + 8:
                raise RuntimeError('Lifecycle guards exhausted the bounded case envelope; no reservation')
            destination = control / name
            case_command = child_command('driver', source, name, folder / MODES['lifecycle-build'], destination, observer)
            ledger.reserve(name, destination, console, {'source_sha': SOURCE, 'harness_sha': harness_sha,
                'builds_sha256': digest(control / 'builds.json'), 'observer_sha256': digest(observer),
                'command': case_command})
            environment['NAC_LIFECYCLE_SCENARIOS'] = name
            outcome = {'case': name, 'command': case_command, 'target_argv': ['desktop/macos/lifecycle_smoke.py',
                       str(folder / MODES['lifecycle-build']), str(destination), str(observer)],
                       'status': 'unknown', 'cleanup': {'complete': False}}
            primary = None
            driver_completed = False
            try:
                outcome['driver'] = run_case(case_command, destination / 'runner.log', environment)
                driver_completed = True
                summary = json.loads((destination / 'summary.json').read_text())
                case = require_case(summary, name, builds['lifecycle-build'], assets)
                ownership.require(destination, name, case['native'])
                outcome['ownership_sha256'] = digest(destination / 'ownership.json')
                outcome['images'] = images(destination, name, helper, native_report, raw)
                outcome['summary_sha256'] = digest(destination / 'summary.json')
                outcome['shutdown_seconds'] = case['shutdown_seconds']
                outcome['status'] = 'passed'
            except BaseException as error:
                primary = error
                outcome.update(status='failed' if driver_completed or isinstance(error, DriverFailure) else 'unknown',
                               error_type=type(error).__name__, error=str(error)[:4096])
            finally:
                try:
                    outcome['cleanup'] = audit_cleanup(destination, observer, audit_command)
                    if outcome['cleanup'].get('complete') is not True:
                        raise RuntimeError('Lifecycle target cleanup incomplete; next case prohibited')
                    if outcome['status'] == 'passed' and outcome['cleanup']['retained_failure_roots']:
                        raise RuntimeError('Passing lifecycle case retained its fixture/store')
                except BaseException as error:
                    outcome.update(status='unknown', cleanup_error={'error_type': type(error).__name__,
                                                                    'error': str(error)[:4096]})
                    if primary is None:
                        primary = error
            try:
                # Stop before another reservation if critical evidence cannot
                # be exported completely under the unchanged caps.
                export_plan(raw, [(str(source), '<target-checkout>'), *redact_values()])
            except BaseException as error:
                outcome.update(status='unknown', export_error=str(error)[:4096])
                if primary is None:
                    primary = error
            try:
                persist(destination / 'external-result.json', outcome)
                ledger.finish(name, outcome['status'], {'external_result_sha256': digest(destination / 'external-result.json')})
            except BaseException as error:
                if primary is not None:
                    if hasattr(primary, 'add_note'):
                        primary.add_note('Result publication failed: ' + type(error).__name__)
                    raise primary
                raise
            if primary is not None:
                raise primary
            results.append(outcome)
        ledger.value['phase'] = 'complete'
        ledger.save()
        return {'target_suite': {'suite': 'lifecycle', 'scenario_count': 3, 'scenarios': list(CASES),
                                'allocation_id': ALLOCATION, 'retry_budget': 0, 'passed': True,
                                'composited_paint_acceptance': False, 'trusted_input_acceptance': False},
                'lifecycle_cases': results, 'lifecycle_builds': builds}
    finally:
        ledger.close()


def main():
    action, root, *arguments = sys.argv[1:]
    source = canonical(Path(root))
    require_checkout(ROOT, os.environ.get('GITHUB_SHA'))
    require_source(source, ROOT)
    require_capsule(os.environ.get('NAC_LIFECYCLE_CUSTODY', ''), os.environ.get('GITHUB_SHA'), os.environ)
    # This fresh interpreter has not imported the harness's smoke module. The
    # unchanged supplier gets only its own import path and original main argv.
    sys.path.insert(0, str(source / 'desktop/macos'))
    if action == 'console' and not arguments:
        from lifecycle_smoke import console_state
        print(json.dumps(console_state()))
    elif action == 'driver' and len(arguments) == 4:
        scenario, bundle, output, observer = arguments
        if scenario not in CASES or os.environ.get('NAC_LIFECYCLE_SCENARIOS') != scenario:
            raise RuntimeError('Lifecycle driver requires exactly one reserved case')
        control = canonical(Path(os.environ['NAC_LIFECYCLE_CONTROLLER']))
        destination = canonical(Path(output), parent=control)
        ledger = json.loads((control / 'ledger.json').read_text())
        row = ledger.get('cases', {}).get(scenario, {})
        execution = row.get('execution', {})
        if (ledger.get('active_case') != scenario or ledger.get('phase') != 'case_dispatched'
                or ledger.get('run_id') != os.environ['GITHUB_RUN_ID']
                or ledger.get('capsule') != json.loads(os.environ['NAC_LIFECYCLE_CUSTODY'])
                or row.get('state') != 'dispatched' or row.get('dispatches') != 1
                or row.get('output') != output or destination.parent != control
                or execution.get('source_sha') != SOURCE or execution.get('harness_sha') != os.environ['GITHUB_SHA']
                or execution.get('command') != child_command('driver', source, *arguments)
                or execution.get('builds_sha256') != digest(control / 'builds.json')):
            raise RuntimeError('Lifecycle child has no matching durable reservation')
        builds = json.loads((control / 'builds.json').read_text())
        app = canonical(Path(bundle))
        helper = canonical(Path(observer))
        expected_folder = control.parent / 'lifecycle-builds'
        if (app != expected_folder / MODES['lifecycle-build'] or helper != expected_folder / 'InstanceObservation'
                or digest(helper) != builds['observer_sha256'] or digest(helper) != execution.get('observer_sha256')):
            raise RuntimeError('Lifecycle child bundle/observer custody differs')
        require_build('lifecycle-build', app, source, builds['engine_sha256'])
        require_console(row['console'])
        def interrupted(_signal, _frame):
            raise KeyboardInterrupt('External lifecycle supervisor interrupted')
        for signum in (signal.SIGTERM, signal.SIGINT):
            signal.signal(signum, interrupted)
        signal.pthread_sigmask(signal.SIG_UNBLOCK, {signal.SIGTERM, signal.SIGINT})
        script = source / 'desktop/macos/lifecycle_smoke.py'
        sys.argv = [str(script), bundle, output, observer]
        runpy.run_path(str(script), run_name='__main__')
    else:
        raise RuntimeError('Unknown fixed lifecycle child action')


if __name__ == '__main__':
    main()
