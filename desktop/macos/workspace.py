#!/usr/bin/env python3
"""ALL-351: run isolated actual .app workspace journeys and retain failed rows."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import tempfile
import time

from smoke import cleanup_failed_case
from workspace_report import identity, sha256, write_report


def console_state():
    """Read only; never unlock, prompt for TCC, or change global preferences."""
    asn = subprocess.check_output(['/usr/bin/lsappinfo', 'front'], text=True).strip()
    info = subprocess.check_output(['/usr/bin/lsappinfo', 'info', '-only', 'pid,bundleID', asn], text=True)
    pid = re.search(r'\bpid\s*=\s*(\d+)', info)
    bundle = re.search(r'bundleID="([^"]+)"', info)
    raw = subprocess.check_output(['/usr/sbin/ioreg', '-a', '-n', 'Root', '-d', '1'])
    registry = plistlib.loads(raw)
    root = registry[0] if isinstance(registry, list) else registry
    return {'prior_pid': int(pid.group(1)) if pid else 0,
            'prior_bundle_id': bundle.group(1) if bundle else '',
            'screen_locked': any(row.get('CGSSessionScreenIsLocked') is True
                                 for row in root.get('IOConsoleUsers', []))}


def build_manifest(app):
    record = identity(app)
    if record['source_head'][:12] not in record['engine_version']:
        raise RuntimeError('Engine build identity does not match current source HEAD')
    (app / 'Contents/Resources/workspace-build.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record, indent=2))


def run_case(app, output, scenario):
    """Use the existing bounded ownership cleanup on timeout and failed launch."""
    evidence = output / f'{scenario}.json'
    if evidence.exists():
        raise RuntimeError(f'Use a fresh evidence directory; preserving {evidence}')
    # Keep the bundle if ownership cannot be established. Never delete a live,
    # unrecorded launch merely because a TemporaryDirectory scope exited.
    temporary = Path(tempfile.mkdtemp(prefix='nac-wk-workspace-'))
    relocated = temporary / 'Moved workspace fixture with spaces' / app.name
    (output / f'{scenario}-relocation.json').write_text(json.dumps({'app': str(relocated)}) + '\n')
    shutil.copytree(app, relocated)
    console = console_state()
    (output / f'{scenario}-console.json').write_text(json.dumps(console, indent=2) + '\n')
    started = time.monotonic()
    with (output / f'{scenario}-launcher.log').open('w') as log:
        process = subprocess.Popen([
            '/usr/bin/open', '-n', '-W', '-a', str(relocated),
            '--stdout', str(output / f'{scenario}-app.log'),
            '--stderr', str(output / f'{scenario}-app.log'),
            '--env', 'NAC_HOME=/DO-NOT-USE-PERSONAL-NAC',
            '--env', 'NAC_MANAGED_CONFIG=/DO-NOT-INHERIT',
            '--env', 'OPENAI_API_KEY=must-not-reach-engine',
            '--args', '--smoke-output', str(evidence), '--smoke-scenario', scenario,
            '--workspace-prior-pid', str(console['prior_pid']),
            '--workspace-prior-bundle', console['prior_bundle_id'],
            *(['--workspace-console-locked'] if console['screen_locked'] else []),
        ], cwd='/', stdout=log, stderr=log, start_new_session=True)
        try:
            code = process.wait(timeout=930 if scenario == 'workspace-manual' else 300)
            record = json.loads(evidence.read_text())
            if not record.get('engine_reaped') or not record.get('profile_removed'):
                cleanup_failed_case(evidence, relocated)
            record['launcher_exit_code'] = code
        except BaseException as error:
            if evidence.exists():
                cleanup_failed_case(evidence, relocated)
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
            record = json.loads(evidence.read_text()) if evidence.exists() else {}
            record.update(passed=False, runner_error=f'{type(error).__name__}: {error}')
            if isinstance(error, (KeyboardInterrupt, SystemExit)):
                record.update(runner_cleanup_attempted=evidence.exists(),
                              relocated_app=str(relocated))
                evidence.write_text(json.dumps(record, indent=2) + '\n')
                raise
    record['elapsed_seconds'] = round(time.monotonic() - started, 3)
    record['interaction_method'] = 'scripted DOM in actual AppKit/system WKWebView'
    record['console_before_launch'] = console
    record['relocated_app'] = str(relocated)
    if record.get('profile') and Path(record['profile']).exists():
        record.update(passed=False, runner_error='Fixture profile survived cleanup')
    pid = record.get('engine_pid', 0)
    if pid:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            pass
        else:
            record.update(passed=False, runner_error='Engine identity survived cleanup')
    evidence.write_text(json.dumps(record, indent=2) + '\n')
    if record.get('engine_reaped') and record.get('profile_removed') and process.returncode == 0:
        shutil.rmtree(temporary)
    print(json.dumps({'scenario': scenario, 'passed': record.get('passed'),
                      'checks': {k: v['status'] for k, v in record.get('checks', {}).items()}}), flush=True)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['capture-build', 'run'])
    parser.add_argument('app', type=Path)
    parser.add_argument('output', type=Path, nargs='?')
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--scenario', choices=['workspace-direct', 'workspace-legacy', 'workspace-manual'])
    args = parser.parse_args()
    app = args.app.resolve()
    if args.mode == 'capture-build':
        build_manifest(app)
        return
    if args.output is None:
        parser.error('run requires a fresh output directory')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    provenance = json.loads((app / 'Contents/Resources/workspace-build.json').read_text())
    current = identity(app)
    for field in ['source_head', 'tracked_diff_sha256', 'native_sources', 'engine_sha256', 'native_sha256']:
        if provenance[field] != current[field]:
            raise RuntimeError(f'Artifact/source identity changed at {field}; rebuild under Rust lease')
    provenance.update(runner_sha256=sha256(__file__), execution_os=current['os'], execution_os_build=current['os_build'])
    if provenance['os'] != current['os'] or provenance['os_build'] != current['os_build']:
        # The OS that executed the app is the qualification axis, not its compiler host.
        provenance['build_os'] = provenance['os']
        provenance['os'] = current['os']
        provenance['os_build'] = current['os_build']
    episodes = {}
    baseline = json.loads(args.baseline.read_text()) if args.baseline else None
    try:
        for scenario in [args.scenario] if args.scenario else ['workspace-direct', 'workspace-legacy']:
            episodes[scenario] = run_case(app, output, scenario)
            write_report(output, provenance, episodes, baseline)
    finally:
        # An interrupted case can still have useful per-feature receipts.
        for path in output.glob('workspace-*.json'):
            if path.stem in ('workspace-direct', 'workspace-legacy', 'workspace-manual') and path.stem not in episodes:
                episodes[path.stem] = json.loads(path.read_text())
        write_report(output, provenance, episodes, baseline)
    if not all(record.get('passed') for record in episodes.values()):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
