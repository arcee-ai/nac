"""Compose the immutable supplier's builders and eight instance journeys."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import runpy
import shutil
import signal
import sys

from ci_qualifications import require_checkout
from ci_support import MAX_FILE

CASES = ('simultaneous', 'cli', 'symlink', 'directory-symlink', 'crash', 'shutdown', 'app-crash', 'coexist')
APP_IDS = {'dev': 'ai.arcee.nac.dev', 'stable': 'ai.arcee.nac'}


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def retain_receipt(destination):
    """Keep complete semantic observations even when the raw summary is capped."""
    source = destination / 'summary.json'
    if not source.exists():
        return None
    if source.is_symlink():
        raise RuntimeError('Unexpected symlink in instance source receipt')
    summary = json.loads(source.read_text())
    output = destination.parent / 'instance-receipts'
    output.mkdir(exist_ok=True)
    index = {'raw_summary_sha256': digest(source),
             'metadata': {key: value for key, value in summary.items() if key not in ('cases', 'console_observations')}}
    for key in ('cases', 'console_observations'):
        index[key] = []
        for number, value in enumerate(summary.get(key, [])):
            name = f'{key}-{number}.json'
            data = (json.dumps(value, indent=2) + '\n').encode()
            if len(data) > MAX_FILE:
                raise RuntimeError('A complete instance observation exceeds the evidence file limit')
            (output / name).write_bytes(data)
            index[key].append(name)
    data = (json.dumps(index, indent=2) + '\n').encode()
    if len(data) > MAX_FILE:
        raise RuntimeError('Instance receipt index exceeds evidence limit')
    (output / 'index.json').write_bytes(data)
    return str((output / 'index.json').relative_to(destination.parent))


def console_validator(source):
    spec = importlib.util.spec_from_file_location('qualified_instance_console', source / 'desktop/macos/instance_console.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.console_refusals


def require_owner_console(state, refusals):
    if state.get('unlocked') is not True or state.get('refusals') != [] or refusals(state):
        raise RuntimeError('Target instance console prerequisite unavailable; raw critical observations missing/unsafe; no override')


def require_build(receipt, target, track, instrumented):
    identity = receipt.get('engine_identity', {})
    if (receipt.get('source_head') != target['source_sha'] or receipt.get('source_dirty') is not False
            or identity.get('source_revision') != target['source_sha'] or identity.get('track') != track
            or receipt.get('normal_startup') is not True or receipt.get('preview_definitions_excluded') is not True
            or receipt.get('smoke_instrumentation') is not instrumented
            or receipt.get('instance_smoke_instrumentation') is not instrumented
            or receipt.get('mode') != ('instance-build' if instrumented else 'app-build')
            or receipt.get('bundle_identifier') != APP_IDS[track] + ('.instance-smoke' if instrumented else '')):
        raise RuntimeError('Instance native build mode/source/track identity differs')
    return receipt


def require_cases(summary, target, builds, source_hashes, assets, refusals):
    cases = summary.get('cases', [])
    bundles = summary.get('bundles', [])
    if (summary.get('source_head') != target['source_sha'] or summary.get('source_dirty') is not False
            or summary.get('runtime_passed') is not True or summary.get('full_scenario_run') is not True
            or summary.get('instrumentation') != 'INSTANCE_SMOKE + PREVIEW_SMOKE + LOCAL_APP'
            or summary.get('actual_app_acceptance') is not False
            or tuple(summary.get('requested_scenarios', [])) != CASES
            or len(cases) != target['scenario_count'] or tuple(case.get('scenario') for case in cases) != CASES
            or len(bundles) != 2 or summary.get('fixture_sources') != source_hashes):
        raise RuntimeError('Instance target did not complete all eight exact-source cases')
    require_owner_console(summary.get('session', {}), refusals)
    observations = summary.get('console_observations', [])
    if (not observations or observations[0].get('boundary') != 'preflight'
            or observations[-1].get('boundary') != 'completed'
            or [row.get('boundary') for row in observations if row.get('boundary', '').startswith('scenario-')]
               != ['scenario-' + name for name in CASES]):
        raise RuntimeError('Instance console boundary evidence incomplete')
    for observation in observations:
        require_owner_console(observation.get('state', {}), refusals)
    for bundle, track in zip(bundles, ('dev', 'stable')):
        expected = builds[track]['instance']
        if (bundle.get('identity') != expected['engine_identity']
                or bundle.get('bundle_id') != expected['bundle_identifier']
                or any(bundle.get(key) != expected[key] for key in ('engine_sha256', 'native_sha256'))):
            raise RuntimeError('Instance runtime bundle differs from its exact build receipt')
    for case in cases:
        episodes = case.get('apps', []) if case['scenario'] == 'coexist' else [case]
        if (case.get('passed') is not True
                or (case['scenario'] == 'coexist' and len(episodes) != 2)
                or any(episode.get('stopped') is not True or episode.get('passed') is not True
                       or episode.get('engine_cleanup_observed') is not True
                       or episode.get('workspace_activated') is not True
                       or episode.get('workspace_window_count') != 1 for episode in episodes)):
            raise RuntimeError('Instance case or target-owned cleanup incomplete: ' + case['scenario'])
        name = case['scenario']
        flags = (('same_window_reopened', 'same_engine_reopened') if name == 'simultaneous' else
                 ('original_engine_settled_after_parent_death', 'stale_discovery_ignored', 'ordinary_lease_after_crash',
                  'same_window_reopened', 'same_engine_reopened') if name == 'app-crash' else
                 () if name == 'coexist' else
                 ('cli_survived_app_and_retry', 'schema_and_lock_unchanged', 'no_alternative_store',
                  'live_owner_logical_records_unchanged', 'workspace_not_activated_during_conflict',
                  'live_owner_retry_remained_conflict', 'retry_loaded_same_store'))
        if any(case.get(flag) is not True for flag in flags):
            raise RuntimeError('Required instance ownership/recovery assertion missing: ' + name)
        if name == 'simultaneous' and (case.get('launch_callers') != 2 or case.get('serving_owners') != 1):
            raise RuntimeError('Simultaneous launches did not retain one serving owner')
        if name == 'app-crash' and (not case.get('original_app') or not case.get('replacement_app')
                                   or case['original_app'] == case['replacement_app']):
            raise RuntimeError('App crash did not establish a new app incarnation')
        if name in CASES[1:6] and (type(case.get('real_cli_pid')) is not int or case['real_cli_pid'] <= 0):
            raise RuntimeError('Real fixture CLI ownership receipt missing')
        if name == 'coexist':
            identities = case.get('identities', [])
            stores = case.get('stores', [])
            if identities != [builds[track]['instance']['engine_identity'] for track in ('dev', 'stable')] or (
                    len(stores) != 2 or stores[0] == stores[1]):
                raise RuntimeError('Dev/stable identities or selected stores crossed')
            expected_stores = dict(zip(('dev', 'stable'), stores))
            if {episode.get('engine_identity', {}).get('track') for episode in episodes} != {'dev', 'stable'}:
                raise RuntimeError('Dev/stable episode identity missing')
        else:
            expected_stores = {'dev': case.get('canonical_store')}
        for episode in episodes:
            track = episode.get('engine_identity', {}).get('track')
            if (track not in expected_stores or episode.get('engine_identity') != builds[track]['instance']['engine_identity']
                    or not expected_stores[track] or episode.get('ready_store') != expected_stores[track]
                    or episode.get('expected_store') != expected_stores[track]):
                raise RuntimeError('Runtime engine or canonical store binding differs: ' + name)
            if name == 'coexist' and any(episode.get(flag) is not True for flag in ('same_window_reopened', 'same_engine_reopened')):
                raise RuntimeError('Coexisting app replaced its window/engine on reopen')
        # The target deliberately does not repeat asset requests in app-crash;
        # its same dev bundle is verified in the other seven cases.
        if name != 'app-crash':
            manifests = case.get('embedded_assets') if name == 'coexist' else [case.get('embedded_assets')]
            if not isinstance(manifests, list) or any(manifest != assets for manifest in manifests) or (
                    name == 'coexist' and len(manifests) != 2):
                raise RuntimeError('Served production assets differ from exact source: ' + name)
    return {'scenario_count': len(cases), 'full_scenario_run': True,
            'target_visible_paint_acceptance': summary.get('visible_paint_acceptance'),
            'scope': 'Instrumented LOCAL_APP instance journeys; ordinary builds checked separately; images require review'}


def audit_cleanup(destination, observer, command):
    """Observe target-owned cleanup; never signal a PID learned from evidence."""
    summary_path = destination / 'summary.json'
    summary = json.loads(summary_path.read_text()) if summary_path.exists() else {}
    roots = list(destination.glob('nac-instance-app-*')) if destination.exists() else []
    if summary.get('fixture'):
        root = Path(summary['fixture'])
        if (root.parent != destination.resolve() or not root.name.startswith('nac-instance-app-')
                or root.is_symlink() or root.resolve() != root):
            raise RuntimeError('Instance fixture ownership path differs; no cleanup action attempted')
        if root not in roots:
            roots.append(root)
    executables = []
    for root in roots:
        if root.is_symlink() or root.parent != destination.resolve() or root.resolve() != root:
            raise RuntimeError('Instance fixture path is not canonical and owned')
        for index in (0, 1):
            bundle = root / f'Moved app with spaces {index}/NAC Instance Smoke.app'
            state = json.loads(command([str(observer), 'state', str(bundle)]))
            if state.get('apps'):
                raise RuntimeError('Recorded instance fixture application survived target cleanup')
            executables.extend(str(bundle / member) for member in ('Contents/MacOS/NACPreview', 'Contents/Resources/nac-web'))
    # Read internally, retain only matching private fixture identities. Never
    # export the system process list or use it as signal authority.
    live = []
    if executables:
        for row in command(['/bin/ps', '-ww', '-axo', 'pid=,stat=,command=']).splitlines():
            fields = row.strip().split(None, 2)
            if len(fields) == 3 and not fields[1].startswith('Z') and any(
                    fields[2] == exe or fields[2].startswith(exe + ' ') for exe in executables):
                live.append(int(fields[0]))
    if live:
        raise RuntimeError('Private instance fixture app/engine/CLI survived target cleanup: ' + str(live))
    retained = any(root.exists() for root in roots)
    if summary.get('runtime_passed') is True and retained:
        raise RuntimeError('Instance fixture profiles survived a passing driver')
    return {'fixture_processes_remaining': [], 'profile_removed': not retained,
            'failure_fixture_retained_per_target_policy': retained, 'fallback_signals': False}


def qualify(raw, source, target, run, command, native_report):
    refusals = console_validator(source)
    source_hashes = {name: digest(source / 'desktop/macos' / name) for name in
                     ('instance_smoke.py', 'instance_console.py', 'instance_contract.py', 'InstanceObservation.swift')}
    assets_root = source / 'crates/nac-server/assets/dist'
    assets = {str(file.relative_to(assets_root)): digest(file) for file in assets_root.rglob('*') if file.is_file()}
    cargo_target = Path(os.environ.get('CARGO_TARGET_DIR', source / 'target'))
    if not cargo_target.is_absolute():
        cargo_target = source / cargo_target
    builds = {}
    for track in ('dev', 'stable'):
        folder = raw / ('instance-' + track)
        folder.mkdir()
        os.environ.update(NAC_BUILD_TRACK=track, NAC_BUILD_ID=track + '-ci-instance-' + target['source_sha'],
                          NAC_SOURCE_REVISION=target['source_sha'])
        run(['cargo', 'build', '--locked', '-p', 'nac-server', '--bin', 'nac-web'], folder / 'engine-build.log', 900, cwd=source)
        private = folder / 'engine/nac-web'
        private.parent.mkdir()
        shutil.copy2(cargo_target / 'debug/nac-web', private)
        os.environ.update(NAC_MAC_ENGINE=str(private), NAC_MAC_SKIP_ENGINE_BUILD='1', NAC_MAC_OUTPUT=str(folder))
        builds[track] = {}
        for name, mode, app_name in [('ordinary', 'app-build', 'NAC.app'),
                                     ('instance', 'instance-build', 'NAC Instance Smoke.app')]:
            run(['bash', 'desktop/macos/preview.sh', mode], folder / (mode + '.log'), 120, cwd=source)
            app = folder / app_name
            receipt = json.loads((app / 'Contents/Resources/build-receipt.json').read_text())
            require_build(receipt, target, track, name == 'instance')
            for key, file in [('native_sha256', app / 'Contents/MacOS/NACPreview'),
                              ('engine_sha256', app / 'Contents/Resources/nac-web'),
                              ('info_plist_sha256', app / 'Contents/Info.plist')]:
                if receipt.get(key) != digest(file):
                    raise RuntimeError('Instance build artifact digest differs: ' + key)
            if name == 'ordinary':
                symbols = command(['/usr/bin/nm', str(app / 'Contents/MacOS/NACPreview')])
                if any(marker in symbols for marker in ('PreviewSmoke', 'StartupSmoke', 'InstanceSmoke', 'CITerminal')):
                    raise RuntimeError('Ordinary instance-track app contains test instrumentation')
            builds[track][name] = receipt
    (raw / 'instance-builds.json').write_text(json.dumps(builds, indent=2) + '\n')
    os.environ.pop('NAC_INSTANCE_SCENARIOS', None)
    dev = raw / 'instance-dev'
    stable = raw / 'instance-stable'
    observer = dev / 'InstanceObservation'
    destination = raw / 'instances'
    state = json.loads(command([sys.executable, '-B', str(Path(__file__).resolve()), 'console', str(source),
                                target['source_sha'], str(observer)], cwd=source))
    (raw / 'instance-console-preflight.json').write_text(json.dumps(state, indent=2) + '\n')
    require_owner_console(state, refusals)
    run([sys.executable, '-B', str(Path(__file__).resolve()), 'driver', str(source), target['source_sha'],
         str(dev / 'NAC Instance Smoke.app'), str(destination), str(observer),
         str(stable / 'NAC Instance Smoke.app')], raw / 'instance-journeys.log', 700,
        cwd=source, cleanup_grace=150)
    summary = json.loads((destination / 'summary.json').read_text())
    result = require_cases(summary, target, builds, source_hashes, assets, refusals)
    if summary.get('observer_sha256') != digest(observer):
        raise RuntimeError('Runtime observer does not match the target-built helper')
    helper = raw / 'native-image-reader'
    run(['xcrun', 'swiftc', '-swift-version', '5', 'desktop/macos/CIEvidence.swift', '-o', str(helper)],
        raw / 'instance-image-reader-build.log', 90)
    images = []
    for image in sorted(destination.rglob('*.png')):
        if image.is_symlink() or not image.resolve().is_relative_to(destination.resolve()):
            raise RuntimeError('Instance image escaped the owned evidence directory')
        kind = ('--instance-conflict' if image.name == 'conflict.png' else
                '--instance-drain' if image.parent.name == 'shutdown' else '--instance-empty')
        observed = native_report([str(helper), kind, str(image)], raw / ('image-' + '-'.join(image.relative_to(destination).parts) + '.log'))
        images.append({'path': str(image.relative_to(raw)), 'sha256': digest(image), 'observation': observed})
    expected_images = {f'{name}/{frame}.png' for name in CASES[1:6] for frame in ('conflict', 'retry-workspace')}
    expected_images.update('simultaneous/' + frame + '.png' for frame in ('workspace', 'reopened'))
    expected_images.update(('app-crash/initial/workspace.png', 'app-crash/replacement/workspace.png',
                            'app-crash/replacement/reopened.png'))
    expected_images.update(f'coexist/{track}/{frame}.png' for track in ('dev', 'stable') for frame in ('workspace', 'reopened'))
    if {str(image.relative_to(destination)) for image in destination.rglob('*.png')} != expected_images:
        raise RuntimeError('Instance driver did not retain its full nineteen-frame image contract')
    return {'target_suite': result, 'instance_builds': builds, 'instance_images': images}


def main():
    action, root, expected, *arguments = sys.argv[1:]
    source = Path(root).resolve()
    require_checkout(source, expected)
    sys.path.insert(0, str(source / 'desktop/macos'))
    if action == 'console':
        from instance_console import console_state
        print(json.dumps(console_state(Path(arguments[0]))))
    elif action == 'driver':
        # Give the unchanged target's own finally blocks their normal cleanup
        # authority when the external supervisor times out or is interrupted.
        def interrupted(_signal, _frame):
            raise KeyboardInterrupt('External native CI interrupted')
        signal.signal(signal.SIGTERM, interrupted)
        script = source / 'desktop/macos/instance_smoke.py'
        sys.argv = [str(script), *arguments]
        runpy.run_path(str(script), run_name='__main__')
    else:
        raise RuntimeError('Unknown internal instance harness phase')


if __name__ == '__main__':
    main()
