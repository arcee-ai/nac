#!/usr/bin/env python3
"""Measured native process/credential acceptance; no retries or external services."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
# Exact harness names: a rename/removal must fail selection, never silently run zero.
CORE_TESTS = [
    'terminal::manager::user::tests::native::natural_exit_settles_ordinary_and_disowned_separate_groups',
    'terminal::manager::user::tests::native::explicit_close_and_manager_drop_settle_separate_groups',
    'terminal::manager::user::tests::native::immediate_exit_remains_owned_until_cleanup_and_output_settle',
    'terminal::manager::user::tests::native::failed_cleanup_preserves_capacity_leases_and_responsive_cached_observation',
    'terminal::manager::user::tests::native::close_is_prompt_but_output_drain_retains_entry_and_leases_until_final_append',
    'terminal::manager::user::tests::native::concurrent_admission_never_holds_observation_map_while_waiting_for_history',
    'terminal::manager::tests::successful_one_shot_kills_background_descendants',
    'terminal::manager::tests::worker_one_shot_does_not_hang_on_descendant_inherited_pipes',
    'terminal::manager::tests::explicit_cancellation_is_structured_and_stops_late_side_effects',
    'terminal::manager::tests::pty_cancellation_stops_waiting_and_late_side_effects',
    'terminal::session::tests::kill_removes_background_jobs_from_pty_shell',
    'terminal::session::tests::completed_pty_root_kills_surviving_process_group',
]
SEED_TEST = 'native_pty::platform::macos::tests::pending_fork_is_live_and_unknown_status_never_proves_death'


def run(command, output, env):
    started = time.monotonic()
    result = subprocess.run(command, cwd=ROOT, env=env, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
    output.write_text(result.stdout)
    print(result.stdout, end='', flush=True)
    return result, round(time.monotonic() - started, 3)


def checked(command, output, env):
    result, elapsed = run(command, output, env)
    if result.returncode:
        raise RuntimeError(f'{output.name}: command failed ({result.returncode})')
    return result.stdout, elapsed


def require_selected(log, names, suffix):
    missing = [name for name in names if f'{name}{suffix}' not in log.splitlines()]
    if missing:
        raise RuntimeError(f'missing exact native tests: {missing}')


def seed_macos(output, env):
    """Safe Darwin-only mutant: no spawning/signaling; restore even on failure."""
    source = ROOT / 'crates/nac-process/src/native_pty/platform/macos.rs'
    original = source.read_bytes()
    before = hashlib.sha256(original).hexdigest()
    needle = b'1..=4 => Ok(true),'
    if original.count(needle) != 1:
        raise RuntimeError('Darwin seed seam changed; inspect before updating qualification')
    try:
        source.write_bytes(original.replace(needle, b'1..=4 => Ok(false),'))
        result, elapsed = run(['cargo', 'test', '--locked', '-p', 'nac-process', '--lib',
                               SEED_TEST, '--', '--exact'], output / 'seed-macos.log', env)
        if result.returncode != 101 or f'test {SEED_TEST} ... FAILED' not in result.stdout:
            raise RuntimeError('seeded Darwin behavioral failure was not detected')
        return {'seconds': elapsed, 'detected': SEED_TEST, 'source_sha256': before}
    finally:
        source.write_bytes(original)
        if hashlib.sha256(source.read_bytes()).hexdigest() != before:
            raise RuntimeError('failed to restore Darwin source')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--require-macos-arm', action='store_true')
    parser.add_argument('--seed-macos', action='store_true')
    args = parser.parse_args()
    if args.require_macos_arm and (platform.system(), platform.machine()) != ('Darwin', 'arm64'):
        parser.error('this lane requires actual native ARM macOS')
    if args.seed_macos and platform.system() != 'Darwin':
        parser.error('the Darwin seed must execute on macOS')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, CARGO_PROFILE_TEST_DEBUG='0')
    report = {'platform': platform.platform(), 'architecture': platform.machine(),
              'runner_image': os.environ.get('ImageVersion'),
              'cache_hit': os.environ.get('NATIVE_CACHE_HIT', 'local/unknown'),
              'core_tests': CORE_TESTS, 'phases': {}}
    try:
        report['rustc'], _ = checked(['rustc', '-Vv'], output / 'rustc.log', env)
        report['cargo'], _ = checked(['cargo', '-V'], output / 'cargo.log', env)
        report['candidate'], _ = checked(['git', 'rev-parse', 'HEAD'], output / 'candidate.log', env)
        # Canonical TMPDIR avoids macOS /var -> /private/var alias mismatches.
        # A dedicated fixture root makes residual files observable before removal.
        with tempfile.TemporaryDirectory(prefix='nac-native-regressions-') as directory:
            fixture = Path(directory).resolve()
            env.update(TMPDIR=str(fixture), TMP=str(fixture), TEMP=str(fixture))
            packages = ['cargo', 'test', '--locked', '-p', 'nac-process', '-p', 'nac-credential-store']
            core = ['cargo', 'test', '--locked', '-p', 'nac-core', '--lib']
            for label, command in [('packages-build', packages), ('core-build', core)]:
                _, elapsed = checked(command + ['--no-run'], output / f'{label}.log', env)
                report['phases'][label] = elapsed
            listing, _ = checked(core + ['--', '--list'], output / 'core-list.log', env)
            require_selected(listing, CORE_TESTS, ': test')
            # First test pass and one fixed warm measurement, never retry a failure.
            for temperature in ['first', 'warm']:
                _, elapsed = checked(packages, output / f'packages-{temperature}.log', env)
                report['phases'][f'packages-{temperature}'] = elapsed
                log, elapsed = checked(core + ['--', '--exact', *CORE_TESTS],
                                       output / f'core-{temperature}.log', env)
                require_selected(log, [f'test {name}' for name in CORE_TESTS], ' ... ok')
                report['phases'][f'core-{temperature}'] = elapsed
            # No test process may retain this fixture directory in its command.
            processes = subprocess.run(['ps', '-axo', 'pid=,command='], text=True,
                                       stdout=subprocess.PIPE, check=True).stdout
            leftovers = [line for line in processes.splitlines() if str(fixture) in line]
            report['fixture_processes_remaining'] = leftovers
            if leftovers:
                raise RuntimeError(f'fixture processes remain: {leftovers}')
            remaining = sorted(str(p.relative_to(fixture)) for p in fixture.rglob('*'))
            report['fixture_files_remaining'] = remaining
            if remaining:
                raise RuntimeError(f'fixture files remain: {remaining}')
            if args.seed_macos:
                report['seed'] = seed_macos(output, env)
                log, elapsed = checked(
                    ['cargo', 'test', '--locked', '-p', 'nac-process', '--lib', SEED_TEST, '--', '--exact'],
                    output / 'seed-restored.log', env)
                require_selected(log, [f'test {SEED_TEST}'], ' ... ok')
                report['phases']['seed-restored'] = elapsed
        report['result'] = 'passed'
    finally:
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
