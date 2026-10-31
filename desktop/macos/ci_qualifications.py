"""Finite, immutable supplier qualifications; never arbitrary commands/runners."""
import argparse
import hashlib
import textwrap
import json
from pathlib import Path
import re
import subprocess

DIRECTORY = Path(__file__).resolve().parent
PROFILES = {'macos26': ('macos-26', 'ci-toolchain.json'),
            'macos14': ('macos-14', 'ci-toolchain-14.json')}


def select_target(key):
    catalog = json.loads((DIRECTORY / 'ci-qualifications.json').read_text())
    if key not in catalog:
        raise RuntimeError('Unknown/unapproved qualification target')
    target = catalog[key]
    if (not re.fullmatch('[0-9a-f]{40}', target.get('source_sha', ''))
            or target.get('profile') not in PROFILES or target.get('suite') not in ('preview', 'workspace', 'instances', 'terminal', 'startup')
            or not isinstance(target.get('scenario_count'), int) or target['scenario_count'] < 1):
        raise RuntimeError('Invalid immutable qualification contract')
    if target['suite'] == 'startup':
        from ci_startup_fixture import CASES, PRODUCT, TEST_SOURCE, TEST_FILES
        from ci_startup_protocol import FILES, REVISION
        if key != 'all-342-startup-macos26' or target != {
            'source_sha': PRODUCT, 'test_source_sha': TEST_SOURCE, 'protocol_source_sha': REVISION,
            'profile': 'macos26', 'suite': 'startup', 'scenario_count': 4, 'scenarios': list(CASES),
            'test_files': TEST_FILES, 'protocol_files': FILES}:
            raise RuntimeError('Startup P/Q/R four-case source contract differs')
    runner, envelope = PROFILES[target['profile']]
    toolchain = json.loads((DIRECTORY / envelope).read_text())
    return {**target, 'runner': runner, 'envelope': envelope,
            'developer_directory': toolchain['developer_directory']}


def require_checkout(root, expected):
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=root, text=True, timeout=15).strip()
    actual = git('rev-parse', 'HEAD')
    dirty = bool(git('status', '--porcelain'))
    if Path(git('rev-parse', '--show-toplevel')).resolve() != root.resolve():
        raise RuntimeError('Qualification source root must be the exact repository root')
    if actual != expected or dirty:
        raise RuntimeError(f'Expected clean immutable source {expected}; actual={actual}, dirty={dirty}')
    return {'source_sha': actual, 'source_dirty': dirty}


def require_full_preview(summary, target, engine_sha256):
    cases = summary.get('scenarios', [])
    if (summary.get('source_head') != target['source_sha'] or summary.get('source_dirty') is not False
            or summary.get('engine_sha256') != engine_sha256
            or not re.fullmatch('[0-9a-f]{64}', summary.get('native_sha256', ''))
            or summary.get('engine_identity', {}).get('source_revision') != target['source_sha']
            or summary.get('full_scenario_run') is not True or len(cases) != target['scenario_count']
            or len({case.get('scenario') for case in cases}) != len(cases)
            or any(case.get('passed') is not True for case in cases)):
        raise RuntimeError('Target native driver did not complete its exact full source scenario contract')
    return {'scenario_count': len(cases), 'full_scenario_run': True,
            'target_report_visible_paint_qualified': summary.get('visible_paint_qualified')}


def require_workspace(matrix, episodes, baseline, target):
    provenance = matrix.get('provenance', {})
    cases = baseline.get('scenarios', [])
    if (provenance.get('source_head') != target['source_sha'] or provenance.get('source_status') != ''
            or baseline.get('source_head') != target['source_sha'] or baseline.get('source_dirty') is not False
            or any(not re.fullmatch('[0-9a-f]{64}', str(provenance.get(key, '')))
                   or baseline.get(key) != provenance.get(key) for key in ('engine_sha256', 'native_sha256'))
            or len(cases) != target['baseline_scenarios']
            or {case.get('scenario') for case in cases} != {'normal', 'engine-exit', 'missing', 'exit', 'close-startup', 'timeout'}
            or any(case.get('passed') is not True for case in cases)
            or len(episodes) != target['scenario_count']
            or set(episodes) != {'workspace-direct', 'workspace-legacy'}):
        raise RuntimeError('Workspace target/baseline identity or full scenario contract differs')
    checks = {}
    for scenario, record in episodes.items():
        if (any(record.get(key) is not True for key in ('passed', 'engine_reaped', 'profile_removed'))
                or record.get('launcher_exit_code') != 0 or not record.get('checks')
                or any(check.get('status') != 'pass'
                       and not (key == 'links' and check.get('status') == 'unavailable')
                       for key, check in record['checks'].items())):
            raise RuntimeError(f'Workspace scenario incomplete or failed: {scenario}')
        checks[scenario] = {key: check['status'] for key, check in record['checks'].items()}
    return {'workspace_checks': checks, 'baseline_scenarios': len(cases),
            'target_full_acceptance': matrix.get('full_acceptance'),
            'target_minimum_selected': matrix.get('minimum_selected'),
            'qualification_scope': 'scripted system WKWebView rows only; no physical/IME/VoiceOver claim'}


def require_rich_capture(episode, provenance, png, fixture_source):
    """Only the ALL-351 owned WK_RICH capture; not a generic receipt format."""
    source = Path(fixture_source).read_text()
    matches = re.findall(r'    static let rich = #"""\n([\s\S]*?)    """#', source)
    if len(matches) != 1:
        raise RuntimeError('Exact WorkspaceFixture.rich literal unavailable')
    expected = textwrap.dedent(matches[0]).removesuffix('\n')
    digest = hashlib.sha256(expected.encode('utf-8')).hexdigest()
    capture = episode.get('paint_diagnostics', {}).get('rich-chat.png', {})
    before, after = capture.get('readiness', {}), capture.get('after_snapshot_readiness', {})
    owned = before.get('message_identity', {})
    identity = {key: provenance.get(key) for key in ('source_head', 'engine_sha256', 'native_sha256')}
    if (any(not value for value in identity.values()) or capture.get('source_identity') != identity
            or capture.get('expected_answer_sha256') != digest
            or any(capture.get('settled_answer_sha256_' + phase) != digest for phase in ('before', 'after'))
            or capture.get('png_sha256') != hashlib.sha256(Path(png).read_bytes()).hexdigest()
            or capture.get('semantic_ready') is not True or capture.get('animation_frame_observed') is not True
            or capture.get('window_visible') is not True or capture.get('window_occlusion_visible') is not True
            or capture.get('window_visible_after_snapshot') is not True
            or owned.get('visible_index') != 1 or owned.get('message_count') != 2 or not owned.get('session_id')
            or before.get('message_identity') != after.get('message_identity')):
        raise RuntimeError('Owned rich answer/source/frame/PNG binding differs')
    for observation in (before, after):
        targets = observation.get('surfaces', [])
        if (observation.get('ready') is not True or observation.get('reason') != 'ready'
                or observation.get('expected', {}).get('kind') != 'rich'
                or observation.get('expected', {}).get('id') != owned['session_id']
                or observation.get('hash') != '#/session/' + owned['session_id'] + '/insights'
                or observation.get('full_answer') != expected
                or observation.get('loadingConversation') is not False
                or observation.get('fonts_ready') is not True or observation.get('visibility') != 'visible'
                or len(targets) != 5 or any(t.get('visible') is not True or t.get('within_frame') is not True for t in targets)):
            raise RuntimeError('Current owned rich targets/fonts not visible and settled')
    return {'source_identity': identity, 'session_message': owned, 'settled_answer_sha256': digest,
            'png_sha256': capture['png_sha256'],
            'capture_record_sha256': hashlib.sha256(json.dumps(capture, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest(),
            'sentinel_observation': before.get('sentinel_observation'),
            'scope': 'fixture-local full answer and actual rich targets; OCR and visual inspection still required'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target')
    args = parser.parse_args()
    for key, value in select_target(args.target).items():
        print(f'{key}={value}')
