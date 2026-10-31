#!/usr/bin/env python3
"""ALL-352 actual .app/WK output evidence; never promotes scripted input to trusted input."""
import argparse
import json
from pathlib import Path
import subprocess

from workspace import build_manifest, run_case
from workspace_report import identity, sha256


REQUIRED = {
    'embedded-asset-source': 'terminal-output',
    'unicode-osc': 'terminal-output',
    'osc-response-authority': 'terminal-output',
    'partial-frame-parser-completion': 'terminal-output',
    'exact-value-masking': 'terminal-output',
    'synthetic-input-denied': 'terminal-output',
    'alternate-screen-output': 'terminal-output',
    'alternate-parser-completion': 'terminal-output',
    'view-lifetime-retention': 'terminal-output',
    'controller-replacement': 'terminal-output',
    'controller-revision-source-fence': None,
    'overflow-gap-reset': 'terminal-output',
    'parser-completion-backpressure': 'terminal-output',
    'renderer-crash': 'terminal-renderer-failure',
    'trusted-mac-keyboard-unicode': None,
    'real-cjk-ime': None,
    'edit-menu-bracketed-paste': None,
    'ctrl-c-job-control': None,
    'physical-selection-attachment-provenance': None,
    'live-noise-input-cancel-bounds': None,
    'ambiguous-accepted-write-explicit-recovery': None,
    'history-readonly': None,
    'resize-pty-readback': None,
    'visible-paint': None,
}


def matrix(episodes):
    """Explicit unavailable rows cannot be omitted or inferred from nearby tests."""
    rows = []
    for name, scenario in REQUIRED.items():
        episode = episodes.get(scenario, {})
        check = episode.get('checks', {}).get(name)
        row = {'id': name, 'status': 'unavailable', 'scenario': scenario,
               'reason': 'Required real-input or integrated journey evidence has not been supplied'}
        if check:
            row.update(status=check['status'], reason=check.get('detail', ''))
            if check['status'] == 'pass' and not episode.get('passed'):
                row.update(status='fail', reason='Native scenario or cleanup failed; see episode')
        rows.append(row)
    return {'ticket': 'ALL-352', 'accepted': all(r['status'] == 'pass' for r in rows), 'rows': rows,
            'backends': {'local': 'characterization-only; see rows',
                         'ssh': 'unavailable: no designated disposable SSH environment',
                         'podman': 'unavailable: no running authorized disposable Podman environment'}}


def sources():
    root = Path('desktop/macos')
    return {str(root / name): sha256(root / name) for name in (
        'terminal.py', 'terminal.sh', 'workspace.py', 'workspace_report.py', 'smoke.py',
        'test_terminal_report.py')}


def environment_probe(*command):
    """Read-only provenance; unavailable host tools stay explicit."""
    result = subprocess.run(command, capture_output=True, text=True)
    return {'status': 'observed' if result.returncode == 0 else 'unavailable',
            'exit_code': result.returncode, 'stdout': result.stdout.strip(),
            'stderr': result.stderr.strip()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['capture-build', 'run'])
    parser.add_argument('app', type=Path)
    parser.add_argument('output', type=Path, nargs='?')
    parser.add_argument('--scenario', choices=['terminal-output', 'terminal-renderer-failure', 'terminal-manual'])
    args = parser.parse_args()
    app = args.app.resolve()
    manifest = app / 'Contents/Resources/terminal-build.json'
    if args.mode == 'capture-build':
        if subprocess.check_output(['git', 'status', '--porcelain', '--', 'Cargo.toml', 'Cargo.lock', 'crates'], text=True).strip():
            raise RuntimeError('Engine source/assets are dirty; require an exact coherent engine build')
        # Reuse the supplier's exact source/native/engine identity validation.
        build_manifest(app)
        provenance = identity(app)
        provenance.update(runner_sources=sources(),
                          asset_files={'/assets/dist/' + str(p.relative_to(Path('crates/nac-server/assets/dist'))): sha256(p)
                                       for p in sorted(Path('crates/nac-server/assets/dist').rglob('*')) if p.is_file()},
                          source_base='fa94a859b648cb36fbdcb251bfe4bc9541de3f48',
                          original_supplier='f71515d14068592a161c17cbd53832ae1b295263',
                          compile_flags=['PREVIEW_SMOKE', 'TERMINAL_SMOKE'],
                          normal_sha256=sha256(app.parent / 'normal-preview'),
                          ordinary_smoke_sha256=sha256(app.parent / 'ordinary-smoke'),
                          xcode=environment_probe('xcodebuild', '-version'),
                          selected_input_sources=environment_probe('defaults', 'read', 'com.apple.HIToolbox', 'AppleSelectedInputSources'),
                          enabled_input_sources=environment_probe('defaults', 'read', 'com.apple.HIToolbox', 'AppleEnabledInputSources'))
        manifest.write_text(json.dumps(provenance, indent=2) + '\n')
        return
    if args.output is None:
        parser.error('run requires a fresh output directory')
    provenance = json.loads(manifest.read_text())
    provenance['execution_input_sources'] = environment_probe('defaults', 'read', 'com.apple.HIToolbox', 'AppleSelectedInputSources')
    current = identity(app)
    for key in ['source_head', 'tracked_diff_sha256', 'native_sources', 'engine_sha256', 'native_sha256', 'assets_tree']:
        if current[key] != provenance[key]:
            raise RuntimeError(f'Artifact/source changed at {key}; rebuild before running')
    if provenance['runner_sources'] != sources():
        raise RuntimeError('Terminal runner changed after build capture')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    episodes = {}
    try:
        for scenario in [args.scenario] if args.scenario else ['terminal-output', 'terminal-renderer-failure']:
            episodes[scenario] = run_case(app, output, scenario)
            episode = episodes[scenario]
            if scenario == 'terminal-manual':
                episode['interaction_method'] = ('real operator capture; no automated terminal input'
                    if episode.get('manual_stage_ready') else 'manual capture unavailable; no automated input attempted')
            assets = episode.get('embedded_assets', [])
            matched = len(assets) >= 2 and all(
                provenance['asset_files'].get(asset.get('path')) == asset.get('sha256') for asset in assets)
            episode.setdefault('checks', {})['embedded-asset-source'] = {
                'status': 'pass' if matched else 'fail',
                'detail': 'Actual WK-fetched JS/CSS bytes match the source asset manifest' if matched else
                          'Missing or mismatched actual WK JS/CSS asset digests'}
            if not matched:
                episode['passed'] = False
            (output / f'{scenario}.json').write_text(json.dumps(episode, indent=2) + '\n')
    finally:
        for path in output.glob('terminal-*.json'):
            if path.stem in ('terminal-output', 'terminal-renderer-failure', 'terminal-manual'):
                episodes[path.stem] = json.loads(path.read_text())
        report = {**matrix(episodes), 'provenance': provenance, 'episodes': episodes}
        (output / 'matrix.json').write_text(json.dumps(report, indent=2) + '\n')
        lines = ['ALL-352 — qualification remains unfinished', '',
                 'Scripted production UI and fixture-owned shell output in actual AppKit/system WKWebView.',
                 'No trusted Mac keyboard, IME, Edit-menu paste or physical selection pass is inferred.', '']
        lines += [f"{r['status']}: {r['id']} — {r['reason']}" for r in report['rows']]
        (output / 'matrix.txt').write_text('\n'.join(lines) + '\n')
        artifacts = {p.name: sha256(p) for p in sorted(output.iterdir()) if p.is_file() and p.name != 'sha256.json'}
        (output / 'sha256.json').write_text(json.dumps(artifacts, indent=2) + '\n')
    if not episodes or not all(e.get('passed') for e in episodes.values()):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
