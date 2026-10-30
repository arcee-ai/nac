#!/usr/bin/env python3
"""Bounded native workspace coverage and exact reviewed ignored selections."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import signal
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
INVENTORY = Path(__file__).with_name('nightly-portability.json')


class Cancelled(RuntimeError):
    pass


def interrupt(signum, _frame):
    raise Cancelled(f'cancelled by signal {signum}')


def live_group_members(group):
    listing = subprocess.check_output(['ps', '-axo', 'pid=,pgid=,stat='], text=True, timeout=2)
    lines = [line.split() for line in listing.splitlines() if line.strip()]
    if not lines or any(len(row) != 3 or not row[0].isdigit() or not row[1].isdigit()
                        or not re.fullmatch(r'[A-Za-z?+<>=0-9-]+', row[2]) for row in lines):
        raise RuntimeError('invalid process-group observation')
    return [{'pid': int(pid), 'group': int(pgid), 'state': state}
            for pid, pgid, state in lines if int(pgid) == group and not state.startswith('Z')]


def signal_owned_group(group, signum):
    try:
        os.killpg(group, signum)
    except ProcessLookupError:
        pass
    except PermissionError as error:
        # Darwin can report EPERM for an existing group containing only zombies.
        # Never normalize a permission failure while any live member remains.
        try:
            members = live_group_members(group)
        except Exception as inspection:
            raise RuntimeError(f'cannot inspect owned group {group} after signal {signum} EPERM') from inspection
        if members:
            raise RuntimeError(f'cannot signal owned group {group} with {signum}; live members {members}') from error


def run(command, output, env, phases, label, timeout=2400):
    """One attempt; retain output and terminate the owned process group on abort."""
    entry = {'label': label, 'command': command, 'log': output.name}
    phases.append(entry)
    started = time.monotonic()
    process = None
    try:
        with output.open('w') as log:
            process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            entry['returncode'] = process.wait(timeout=timeout)
    finally:
        try:
            if process is not None:
                # Also settle descendants when the root exits before its children.
                try:
                    signal_owned_group(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        pass
                    signal_owned_group(process.pid, signal.SIGKILL)
                except Exception as cleanup_error:
                    try:
                        process.wait(timeout=2)
                    except Exception as reap_error:
                        raise RuntimeError(f'{cleanup_error}; owned group {process.pid} reaping failed: {reap_error}') from cleanup_error
                    raise
                else:
                    process.wait(timeout=2)
        finally:
            entry['seconds'] = round(time.monotonic() - started, 3)
    if entry['returncode']:
        raise RuntimeError(f'{label} failed ({entry["returncode"]}); see {output.name}')
    return output.read_text()


def test_names(log):
    return {line[:-6] for line in log.splitlines() if line.endswith(': test')}


def require_exact(log, name):
    if f'test {name} ... ok' not in log.splitlines():
        raise RuntimeError(f'exact test did not pass: {name}')


def verify_inventory(log, inventory):
    expected = {case['name'] for case in inventory}
    if len(expected) != len(inventory):
        raise RuntimeError('duplicate inventory name')
    actual = test_names(log)
    if actual != expected:
        raise RuntimeError(f'ignored inventory drift: added={sorted(actual - expected)}, '
                           f'removed={sorted(expected - actual)}; review capabilities before updating')


def fixture_processes(fixture):
    listing = subprocess.check_output(['ps', '-axww', '-o', 'pid=,command='], text=True)
    return [int(line.split(None, 1)[0]) for line in listing.splitlines()
            if str(fixture) in line and line.strip()]


def summary(report, output):
    lines = ['# Native portability', '',
             f'Candidate: `{report.get("candidate", "unavailable")}`',
             f'Platform: {report["platform"]} / {report["architecture"]}',
             f'Result: **{report["result"]}**',
             f'Total runner seconds: {report["seconds"]}', '']
    if 'error' in report:
        lines += [report['error'], '']
    lines += ['| Phase | Seconds | Exit | Log |', '|---|---:|---:|---|']
    for phase in report['phases']:
        lines.append(f'| {phase["label"]} | {phase.get("seconds", "interrupted")} | '
                     f'{phase.get("returncode", "interrupted")} | {phase["log"]} |')
    lines += ['', 'Owner/triage: docs/ci/nightly-portability.md. No retries. '
              'Excluded capabilities are recorded in inventory.json.']
    (output / 'summary.md').write_text('\n'.join(lines) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--expected-sha', default=os.environ.get('EXPECTED_SHA'))
    parser.add_argument('--seed-failure', action='store_true',
                        help='qualification only: fail a disposable real Rust test before suites')
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        parser.error('--output must be a new or empty evidence directory')
    output.mkdir(parents=True, exist_ok=True)
    report = {'platform': platform.platform(), 'architecture': platform.machine(),
              'runner_image': os.environ.get('ImageVersion'),
              'cache_hit': os.environ.get('PORTABILITY_CACHE_HIT', 'local/unknown'),
              'event': os.environ.get('GITHUB_EVENT_NAME', 'local/manual'),
              'run_id': os.environ.get('GITHUB_RUN_ID'), 'phases': [], 'result': 'failed'}
    started = time.monotonic()
    env = dict(os.environ, CARGO_PROFILE_TEST_DEBUG='0')
    cargo = os.environ.get('CARGO', 'cargo')
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, interrupt)
    try:
        candidate = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        report['candidate'] = candidate
        if not args.expected_sha or not re.fullmatch(r'[0-9a-f]{40}', args.expected_sha):
            raise RuntimeError('--expected-sha must be an immutable full commit SHA')
        if candidate != args.expected_sha:
            raise RuntimeError('candidate mismatch')
        if (platform.system(), platform.machine()) != ('Darwin', 'arm64'):
            raise RuntimeError('requires actual native ARM macOS')
        inventory_bytes = INVENTORY.read_bytes()
        inventory = json.loads(inventory_bytes)
        (output / 'inventory.json').write_bytes(inventory_bytes)
        report['inventory_sha256'] = hashlib.sha256(inventory_bytes).hexdigest()
        report['rustc'] = run(['rustc', '-Vv'], output / 'rustc.log', env, report['phases'], 'rustc')
        report['cargo'] = run([cargo, '-V'], output / 'cargo.log', env, report['phases'], 'cargo')
        if args.seed_failure:
            with tempfile.TemporaryDirectory(prefix='nac-portability-seed-') as directory:
                source = Path(directory) / 'seed.rs'
                binary = Path(directory) / 'seed'
                source.write_text('#[test] fn portability_seeded_failure() { assert_eq!(1, 2); }\n')
                run(['rustc', '--test', str(source), '-o', str(binary)],
                    output / 'seed-build.log', env, report['phases'], 'seed-build')
                run([str(binary), '--exact', 'portability_seeded_failure'],
                    output / 'seed-failure.log', env, report['phases'], 'portability_seeded_failure')
            raise RuntimeError('seed unexpectedly passed')
        base = [cargo, 'test', '--workspace', '--locked']
        run(base + ['--no-run'], output / 'build.log', env, report['phases'], 'workspace-build')
        listing = run(base + ['--', '--ignored', '--list'], output / 'ignored-list.log',
                      env, report['phases'], 'ignored-inventory')
        verify_inventory(listing, inventory)
        for path in ('/usr/libexec/sftp-server', '/usr/lib/openssh/sftp-server'):
            if os.access(path, os.X_OK):
                report['sftp_server'] = path
                break
        else:
            raise RuntimeError('required local OpenSSH sftp-server fixture capability unavailable')
        run([cargo, 'build', '--locked', '-p', 'nac-server', '--bin', 'nac-web'],
            output / 'worker-build.log', env, report['phases'], 'worker-build')
        worker = ROOT / os.environ.get('CARGO_TARGET_DIR', 'target') / 'debug/nac-web'
        if not worker.is_file():
            raise RuntimeError(f'managed-load worker missing: {worker}')
        # Package-isolated feature resolution can differ from workspace unification.
        # Precompile each selected harness outside the test fixture environment too.
        packages = sorted({case['package'] for case in inventory
                           if case['disposition'] == 'included'})
        for package in packages:
            run([cargo, 'test', '--locked', '-p', package, '--lib', '--no-run'],
                output / f'{package}-build.log', env, report['phases'], f'{package}-build')
        with tempfile.TemporaryDirectory(prefix='nac-portability-fixture-') as directory:
            fixture = Path(directory).resolve()
            test_env = dict(env, TMPDIR=str(fixture), TMP=str(fixture), TEMP=str(fixture),
                            NAC_MANAGED_LOAD_WORKER=str(worker))
            try:
                run(base, output / 'workspace.log', test_env, report['phases'], 'workspace-default')
                for case in inventory:
                    if case['disposition'] != 'included':
                        continue
                    label = case['name'].rsplit('::', 1)[-1]
                    command = [cargo, 'test', '--locked', '-p', case['package'], '--lib',
                               case['name'], '--', '--ignored', '--exact', '--show-output', '--test-threads=1']
                    log = run(command, output / f'{label}.log', test_env, report['phases'], case['name'])
                    require_exact(log, case['name'])
            finally:
                pids = fixture_processes(fixture)
                report['fixture_pids_remaining'] = pids
                # Only exact invocation-owned paths; never retain a host process census.
                for pid in pids:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                report['fixture_files_remaining'] = sorted(str(p.relative_to(fixture)) for p in fixture.rglob('*'))
                if pids:
                    raise RuntimeError(f'fixture processes leaked: {pids}; cleanup attempted')
        report['result'] = 'passed'
    except Cancelled as error:
        report.update(result='cancelled', error=str(error))
        return 130
    except Exception as error:
        report['error'] = str(error)
        return 1
    finally:
        report['seconds'] = round(time.monotonic() - started, 3)
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        summary(report, output)
        print((output / 'summary.md').read_text(), flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
