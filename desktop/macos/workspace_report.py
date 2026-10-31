"""ALL-351 evidence projection. Missing required evidence always stays visible."""
import hashlib
import json
from pathlib import Path
import re
import subprocess


INVENTORY = Path(__file__).parent / 'workspace' / 'inventory.json'


def command(*args):
    return subprocess.check_output(args, text=True).strip()


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def identity(app):
    """Capture exact files, revision and dirty diff; do not infer OS support."""
    diff = subprocess.check_output(['git', 'diff', 'HEAD', '--', 'desktop/macos',
                                    'crates/nac-server', 'crates/nac-core'])
    return {
        'source_head': command('git', 'rev-parse', 'HEAD'),
        'source_status': command('git', 'status', '--porcelain'),
        'tracked_diff_sha256': hashlib.sha256(diff).hexdigest(),
        'native_sources': {str(p): sha256(p) for p in sorted(Path('desktop/macos').glob('*.swift'))},
        'assets_tree': command('git', 'rev-parse', 'HEAD:crates/nac-server/assets'),
        'engine_version': command(str(app / 'Contents/Resources/nac-web'), '--version'),
        'engine_sha256': sha256(app / 'Contents/Resources/nac-web'),
        'native_sha256': sha256(app / 'Contents/MacOS/NACPreview'),
        'os': command('sw_vers', '-productVersion'),
        'os_build': command('sw_vers', '-buildVersion'),
        'sdk': command('xcrun', '--show-sdk-version'),
        'developer_directory': command('xcode-select', '-p'),
        'compile_target': 'arm64-apple-macosx14.0',
    }


def matrix(provenance, episodes, baseline=None):
    inventory = json.loads(INVENTORY.read_text())
    rows = []
    # Every required feature appears on both OS axes, even if no scenario ran.
    current = provenance['os']
    for os_version in dict.fromkeys(['14', current]):
        for feature in inventory['features']:
            row = {**feature, 'os': os_version, 'tested': False, 'status': 'unavailable',
                   'method': feature.get('method', 'scripted-dom-in-system-wkwebview'),
                   'evidence': None, 'reason': 'No actual run on this OS'}
            if os_version == current:
                if feature.get('method'):
                    row['reason'] = 'Requires real operator evidence; scripted DOM cannot qualify this row'
                elif feature.get('scenario') == 'baseline-smoke':
                    if baseline:
                        version = re.search(r'^ProductVersion:\s*(\S+)\s*$', baseline.get('os', ''), re.MULTILINE)
                        build = re.search(r'^BuildVersion:\s*(\S+)\s*$', baseline.get('os', ''), re.MULTILINE)
                        compatible = (all(baseline.get(key) == provenance.get(key) and provenance.get(key)
                                          for key in ('engine_sha256', 'native_sha256', 'source_head'))
                                      and baseline.get('source_dirty') is False
                                      and provenance.get('source_status') == ''
                                      and version is not None and version.group(1) == current
                                      and build is not None and build.group(1) == provenance.get('os_build'))
                        cases = baseline.get('scenarios', [])
                        complete = len(cases) == 6 and {case.get('scenario') for case in cases} == {
                            'normal', 'engine-exit', 'missing', 'exit', 'close-startup', 'timeout'}
                        tested = bool(compatible and complete)
                        passed = tested and all(case.get('passed') is True for case in cases)
                        row.update(tested=tested, status=('pass' if passed else 'fail') if tested else 'unavailable',
                                   evidence=provenance.get('baseline_evidence', 'baseline-smoke/summary.json'),
                                   reason='Six owned startup/failure/active-close scenarios' if passed else
                                   'Native lifecycle scenario failed' if tested else
                                   'Baseline source/native/engine/OS identity differs or suite is incomplete')
                else:
                    episode = episodes.get(feature.get('scenario'), {})
                    check = episode.get('checks', {}).get(feature['id'])
                    if check:
                        row.update(tested=True, status=check['status'], evidence=check,
                                   reason=check.get('detail', ''))
            rows.append(row)
    return {'ticket': inventory['ticket'], 'minimum_candidate': '14',
            'minimum_selected': None, 'full_acceptance': False,
            'provenance': provenance, 'rows': rows,
            'separate_evidence': [
                {'scope': 'SSH/Podman backend execution', 'status': 'unavailable',
                 'reason': 'This isolated fixture selects Local; no SSH credentials or Podman runtime qualified'},
                {'scope': 'Real provider/MCP OAuth authentication', 'status': 'unavailable',
                 'reason': 'Dummy Responses provider and inert local MCP only; native browser-auth evidence has its own owner'},
                {'scope': 'Terminal protocol/trusted input', 'status': 'unavailable', 'owner': 'ALL-352'},
            ],
            'required_gate': 'Minimum OS and real input/VoiceOver require actual qualification'}


def write_report(output, provenance, episodes, baseline=None):
    report = matrix(provenance, episodes, baseline)
    (output / 'matrix.json').write_text(json.dumps(report, indent=2) + '\n')
    lines = ['# ALL-351 actual system WKWebView qualification', '',
             f"Source: `{provenance['source_head']}`; OS: {provenance['os']}; "
             f"engine: `{provenance['engine_version']}`.", '',
             'Minimum macOS remains unselected. Full acceptance is not established.', '',
             '| Feature | OS | Tested | Result | Method | Evidence / gate |',
             '| --- | --- | --- | --- | --- | --- |']
    for row in report['rows']:
        detail = row['reason'].replace('|', '/')
        lines.append(f"| {row['id']} | {row['os']} | {row['tested']} | {row['status']} | "
                     f"{row['method']} | {detail} |")
    lines.extend(['', 'Separate evidence: SSH/Podman execution, real provider/MCP OAuth, and',
                  'ALL-352 terminal protocol/trusted input are not qualified by this local fixture.'])
    (output / 'matrix.md').write_text('\n'.join(lines) + '\n')
