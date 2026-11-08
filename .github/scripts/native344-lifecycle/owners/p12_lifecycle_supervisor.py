"""Fixed hosted ALL-344 composition; the immutable supplier owns native cleanup."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

from ci_lifecycle_contract import CASES, canonical, persist, selected_source
import ci_lifecycle_ownership as ownership

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


def run_case(command, log, environment, *, spawn=subprocess.Popen, owner=ownership, binding=None):
    """Own the driver handle, and allow unchanged target finally blocks to run.

    No app/engine PID from JSON is ever signal authority. A forced driver exit
    is a failure/unknown result, never successful native cleanup evidence.
    """
    with log.open('w') as stream:
        process = None
        status = {'command': command, 'scenario': environment.get('NAC_LIFECYCLE_SCENARIOS'),
                  'source_sha': selected_source(binding), 'state': 'spawn_pending'}
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
                owner.retain(log.parent, environment['NAC_LIFECYCLE_SCENARIOS'])
                remaining = end - time.monotonic()
                if remaining <= 0:
                    raise subprocess.TimeoutExpired(command, CASE_SECONDS)
                try:
                    code = process.wait(timeout=min(.1, remaining))
                    break
                except subprocess.TimeoutExpired:
                    continue
            owner.retain(log.parent, environment['NAC_LIFECYCLE_SCENARIOS'])
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


def image_report(command, log, *, cwd=ROOT):
    try:
        observed = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=10)
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


def audit_cleanup(destination, observer, command, *, owner=ownership):
    """Read source-bound private paths; never signal an observed native PID."""
    canonical(destination)
    if destination.name in CASES:
        owner.retain(destination, destination.name)
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
        receipt = owner.require(destination, destination.name)
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
