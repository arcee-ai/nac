#!/usr/bin/env python3
"""Actual relocated LOCAL_APP / system WKWebView instance and conflict journeys.

Run only under the Mac/browser lease with a matching instance-smoke bundle and
compiled InstanceObservation helper. A locked console fails before any launch.
All stores, CLI children, native controls and receipts belong to this fixture.
"""
import json
import hashlib
import os
from pathlib import Path
import plistlib
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlparse
from urllib.parse import quote
import urllib.request

from instance_contract import OwnedEngine, digest, snapshot
from instance_console import record_console, require_console

SCENARIOS = ('simultaneous', 'cli', 'symlink', 'directory-symlink', 'crash', 'shutdown', 'app-crash', 'coexist')


def verify_embedded_assets(base):
    assets = Path(__file__).resolve().parents[2] / 'crates/nac-server/assets/dist'
    verified = {}
    for source in sorted(assets.rglob('*')):
        if source.is_file():
            relative = str(source.relative_to(assets))
            with urllib.request.urlopen(base.rstrip('/') + '/assets/dist/' + quote(relative), timeout=4) as response:
                served = hashlib.sha256(response.read()).hexdigest()
            assert served == digest(source), 'Embedded asset differs from source: ' + relative
            verified[relative] = served
    assert verified, 'No production embedded assets checked'
    return verified


def wait_for(label, predicate, timeout=50):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(.05)
    raise TimeoutError(label)


def engine_settled(bundle, pid):
    if not pid:
        return True
    state = subprocess.run(['/bin/ps', '-ww', '-p', str(pid), '-o', 'stat=,command='],
                           capture_output=True, text=True, timeout=3).stdout.strip()
    return not state or state.startswith('Z') or str(bundle / 'Contents/Resources/nac-web') not in state


class AppJourney:
    def __init__(self, bundle, output, root, environment, store, observer, console_checks, conflict=False, options=None):
        self.bundle, self.output, self.root = bundle, output, root
        self.environment, self.observer = environment, observer
        self.console_checks = console_checks
        self.control = root / ('controls-' + output.parent.name)
        self.control.mkdir(mode=0o700)
        self.identity = None
        observed = self.observe()
        assert not observed['apps'], 'This fixture bundle was already running before its owned launch'
        self.prior = observed.get('frontmost')
        self.command = ['/usr/bin/open', '-a', str(bundle), '--args',
                        '--instance-scenario', 'conflict' if conflict else 'workspace',
                        '--instance-output', str(output), '--instance-control', str(self.control),
                        '--instance-store', str(store.resolve())]
        self.command += options if options is not None else ['--directory', str(root), '--store-path', str(store)]
        self.log = output.with_suffix('.log').open('w')

    def observe(self):
        return json.loads(subprocess.check_output([str(self.observer), 'state', str(self.bundle)], timeout=4))

    def launch(self):
        # Ordinary Finder/LaunchServices opening: intentionally no -n or fixed
        # port discovery. Repeated opens target this exact relocated app URL.
        self.guard_console('launch')
        opened = subprocess.Popen(self.command, env=self.environment, cwd='/', stdout=self.log, stderr=self.log)
        try:
            assert opened.wait(timeout=12) == 0, 'LaunchServices rejected fixture app'
        finally:
            if opened.poll() is None:
                opened.terminate()
                opened.wait(timeout=3)

    def read(self):
        try:
            value = json.loads(self.output.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return {}
        if value.get('stage') == 'failed':
            raise AssertionError(value)
        return value

    def stage(self, stage):
        record = wait_for('Actual app stage ' + stage, lambda: (value if (value := self.read()).get('stage') == stage else None))
        self.guard_console('observed-stage-' + stage)
        state = self.observe()
        assert len(state['apps']) == 1, state
        self.identity = state['apps'][0]
        assert self.identity['pid'] == record['app_pid'] and record['workspace_window_count'] == 1, record
        return record

    def command_file(self, name):
        self.guard_console('native-control-' + name)
        (self.control / name).touch(exist_ok=False)

    def guard_console(self, boundary):
        return require_console(self.observer, self.console_checks, boundary)

    def guard_focus(self):
        self.guard_console('focus-check')
        assert self.observe().get('frontmost') == self.identity, 'User focus changed; refusing another activation'

    def reopen(self):
        self.guard_focus()
        self.command_file('minimize')
        self.stage('miniaturized')
        self.guard_focus()
        self.launch()
        result = self.stage('reopened')
        assert result['same_window_reopened'] and result['same_engine_reopened'], result
        return result

    def restore_prior(self):
        if self.prior and self.identity:
            if not record_console(self.observer, self.console_checks, 'restore-prior')['unlocked']:
                return  # Cleanup may retire this exact app, but cannot activate another surface.
            subprocess.run([str(self.observer), 'restore', json.dumps(self.prior), json.dumps(self.identity)],
                           check=True, capture_output=True, timeout=4)

    def finish(self):
        self.restore_prior()
        self.command_file('finish')
        record = wait_for('App and engine stopped', lambda: (value if (value := self.read()).get('stopped') else None))
        assert record.get('passed'), record
        wait_for('App exited after ordinary Quit', lambda: not self.observe()['apps'], timeout=28)
        wait_for('Owned engine settled after app Quit', lambda: engine_settled(self.bundle, record.get('engine_pid')), timeout=25)
        record['engine_cleanup_observed'] = True
        self.log.close()
        return record

    def cleanup(self):
        # Quit only the exact live application incarnation from this bundle.
        # Never look up or signal a store owner from a PID or discovery record.
        self.restore_prior()
        apps = self.observe()['apps']
        for app in apps:
            if self.identity is not None and app != self.identity:
                continue  # Retirement of an older journey cannot Quit its successor.
            record_console(self.observer, self.console_checks, 'cleanup-owned-quit')
            subprocess.run([str(self.observer), 'terminate', str(self.bundle), json.dumps(app)],
                           check=True, capture_output=True, timeout=4)
        wait_for('Owned fixture app cleanup', lambda: all(app != self.identity for app in self.observe()['apps'])
                 if self.identity is not None else not self.observe()['apps'], timeout=28)
        try:
            record = json.loads(self.output.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            record = {}
        wait_for('Owned fixture engine cleanup', lambda: engine_settled(self.bundle, record.get('engine_pid')), timeout=25)
        self.log.close()


def environment(root):
    home = root / 'home with spaces'
    nac = home / 'fixture nac'
    nac.mkdir(parents=True, mode=0o700)
    return dict(HOME=str(home), NAC_HOME=str(nac), PATH='/usr/bin:/bin:/usr/sbin:/sbin',
                LANG='en_US.UTF-8', NAC_TELEMETRY='disabled', NAC_ORCHESTRATION='0', BROWSER='none',
                GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null',
                MODELS_DEV_URL='http://127.0.0.1:1/models-dev', OPENAI_API_KEY='instance-fixture-dummy-only')


def drain_barrier(owner, root):
    def post(path, body):
        request = urllib.request.Request(owner.endpoint + path, json.dumps(body).encode(), {'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=8) as response:
            return json.load(response)

    project = post('/projects', dict(name='Native instance drain fixture', cwd=str(root)))
    session = post('/sessions', dict(behavior='direct', project_id=project['project_id'], model='gpt-5.6-sol',
                                    backend='openai-responses', base_url='http://127.0.0.1:1/v1', api_key_env='OPENAI_API_KEY'))
    url = urlparse(owner.endpoint)
    address = (url.hostname, url.port)
    stream = socket.create_connection(address, timeout=3)
    try:
        stream.sendall((f"GET /sessions/{session['metadata']['session_id']}/events/stream HTTP/1.1\r\n"
                        'Host: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n').encode())
        response = b''
        while b'\r\n\r\n' not in response:
            chunk = stream.recv(4096)
            assert chunk
            response += chunk
            assert len(response) < 65536
        assert response.startswith(b'HTTP/1.1 200'), response[:100]
        owner.process.send_signal(signal.SIGTERM)

        def listener_closed():
            assert owner.process.poll() is None, 'CLI exited before acknowledged delivery drain'
            with socket.socket() as probe:
                return probe.connect_ex(address) != 0

        wait_for('CLI listener enters shutdown', listener_closed, timeout=4)
        return stream
    except BaseException:
        stream.close()
        raise


def conflict_case(scenario, app, case, root, observer, console_checks):
    env = environment(root)
    binary = app / 'Contents/Resources/nac-web'
    store = root / 'selected store.db'
    selected = store
    require_console(observer, console_checks, 'cli-owner-launch')
    owner = OwnedEngine(binary, root, store, env)
    journey, barrier = None, None
    try:
        owner.ready()
        if scenario == 'symlink':
            selected = root / 'alias store.db'
            selected.symlink_to(store)
        elif scenario == 'directory-symlink':
            alias = root / 'directory alias'
            alias.symlink_to(root, target_is_directory=True)
            selected = alias / store.name
        if scenario == 'shutdown':
            barrier = drain_barrier(owner, root)
        before = snapshot(store)
        databases = set(root.rglob('*.db'))
        journey = AppJourney(app, case / 'result.json', root, env, selected, observer, console_checks, conflict=True)
        journey.launch()
        first = journey.stage('conflict')
        assert owner.process.poll() is None, 'App launch stopped real CLI'
        assert snapshot(store) == before and set(root.rglob('*.db')) == databases
        journey.command_file('retry-live')
        journey.stage('live-retry-conflict')
        assert owner.process.poll() is None, 'Native Retry stopped real CLI'
        assert snapshot(store) == before and set(root.rglob('*.db')) == databases
        if barrier:
            barrier.close()
            barrier = None
            assert owner.process.wait(timeout=24) == 0
        else:
            owner.ready()  # The original CLI endpoint still serves its store.
            owner.stop(crash=scenario == 'crash')
        journey.command_file('retry-exited')
        ready = journey.stage('retry-ready')
        assert ready['ready_store'] == str(store.resolve())
        after = snapshot(store)
        assert all(after[key] == before[key] for key in ('schema', 'version', 'sidecars')), 'Retry changed schema or replaced retained lock sidecar'
        assets = verify_embedded_assets(ready['base_url'])
        result = journey.finish()
        result.update(real_cli_pid=owner.process.pid, real_cli_binary=str(binary),
                      cli_survived_app_and_retry=True, canonical_store=str(store.resolve()),
                      owner_exit='crash' if scenario == 'crash' else 'ordinary_shutdown',
                      schema_and_lock_unchanged=True, no_alternative_store=True,
                      live_owner_logical_records_unchanged=True,
                      initial_conflict=first['native_conflict'], scenario=scenario,
                      embedded_assets=assets)
        return result
    finally:
        if barrier:
            barrier.close()
        if journey:
            journey.cleanup()
        owner.close()


def workspace_case(app, case, root, observer, console_checks):
    env = environment(root)
    store = root / 'selected store.db'
    journey = AppJourney(app, case / 'result.json', root, env, store, observer, console_checks)
    try:
        # Two independent ordinary LaunchServices callers overlap while launch
        # is in progress, as two Finder/Dock launches can.
        opened = []
        try:
            for index in range(2):
                journey.guard_console('simultaneous-launch-' + str(index))
                opened.append(subprocess.Popen(journey.command, env=env, cwd='/', stdout=journey.log, stderr=journey.log))
            assert all(process.wait(timeout=12) == 0 for process in opened)
        finally:
            for process in opened:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=3)
        ready = journey.stage('ready')
        assets = verify_embedded_assets(ready['base_url'])
        journey.reopen()
        result = journey.finish()
        result.update(scenario='simultaneous', launch_callers=2, serving_owners=1,
                      initial_engine_pid=ready['engine_pid'], canonical_store=str(store.resolve()),
                      embedded_assets=assets)
        return result
    finally:
        journey.cleanup()


def app_crash_case(app, case, root, observer, console_checks):
    env = environment(root)
    store = root / 'selected store.db'
    journeys = []
    try:
        initial = case / 'initial'
        initial.mkdir()
        first = AppJourney(app, initial / 'result.json', root, env, store, observer, console_checks)
        journeys.append(first)
        first.launch()
        previous = first.stage('ready')
        first.guard_focus()
        requested = json.loads(subprocess.check_output([str(observer), 'crash', str(app), json.dumps(first.identity)], timeout=4))
        assert requested['termination_requested'], 'Exact owned app incarnation did not accept crash control'
        wait_for('Crashed app leaves running-app registry', lambda: not first.observe()['apps'], timeout=8)
        wait_for('Parent death settles its exact engine', lambda: engine_settled(app, previous['engine_pid']), timeout=25)
        assert first.observe().get('frontmost') == first.prior, 'Focus changed after fixture crash; refusing reactivation'
        replacement = case / 'replacement'
        replacement.mkdir()
        second = AppJourney(app, replacement / 'result.json', root, env, store, observer, console_checks)
        journeys.append(second)
        second.launch()
        ready = second.stage('ready')
        assert second.identity != first.identity and ready['launch_incarnation'] != previous['launch_incarnation']
        assert ready['ready_store'] == previous['ready_store'] == str(store.resolve())
        second.reopen()
        result = second.finish()
        result.update(scenario='app-crash', original_app=first.identity, replacement_app=second.identity,
                      original_engine_settled_after_parent_death=True, stale_discovery_ignored=True,
                      canonical_store=str(store.resolve()), ordinary_lease_after_crash=True)
        return result
    finally:
        for journey in reversed(journeys):
            journey.cleanup()


def coexist_case(app, stable_app, case, root, observer, console_checks):
    env = environment(root)
    journeys, stores, identities = [], [], []
    try:
        for index, bundle in enumerate((app, stable_app)):
            if journeys:
                journeys[-1].guard_focus()
            binary = bundle / 'Contents/Resources/nac-web'
            identities.append(json.loads(subprocess.check_output([str(binary), '__desktop-identity'], env=env)))
            selection = json.loads(subprocess.check_output([str(binary), '__desktop-configuration', '--directory', str(root)], env=env))
            stores.append(Path(selection['store']))
            assert selection['status'] == 'selected'
            output = case / ('dev' if index == 0 else 'stable')
            output.mkdir()
            journey = AppJourney(bundle, output / 'result.json', root, env, stores[-1], observer, console_checks,
                                 options=['--directory', str(root)])
            journeys.append(journey)
            journey.launch()
            journey.stage('ready')
        assert [identity['track'] for identity in identities] == ['dev', 'stable'], identities
        assert stores[0] != stores[1], 'Default track stores crossed'
        result = dict(scenario='coexist', stores=list(map(str, stores)), identities=identities, apps=[])
        # Both identified engines must still serve their own canonical stores.
        for journey, store in zip(journeys, stores):
            record = journey.read()
            with urllib.request.urlopen(record['base_url'].rstrip('/') + '/store', timeout=3) as response:
                assert json.load(response)['store_path'] == str(store.resolve())
            result.setdefault('embedded_assets', []).append(verify_embedded_assets(record['base_url']))
        # Reopen each app deliberately, without restoring another fixture's
        # focus after user intervention. Each app keeps its one window/engine.
        for journey in reversed(journeys):
            journey.reopen()
            result['apps'].append(journey.finish())
        result['passed'] = True
        return result
    finally:
        for journey in reversed(journeys):
            journey.cleanup()


def main():
    app, destination, observer = map(lambda value: Path(value).resolve(), sys.argv[1:4])
    stable = Path(sys.argv[4]).resolve() if len(sys.argv) == 5 else None
    destination.mkdir(parents=True, exist_ok=True)
    scenarios = tuple(os.environ.get('NAC_INSTANCE_SCENARIOS', ','.join(SCENARIOS)).split(','))
    assert scenarios and set(scenarios) <= set(SCENARIOS) and len(set(scenarios)) == len(scenarios)
    console_checks = []
    metadata = dict(source_head=subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
                    source_dirty=bool(subprocess.check_output(['git', 'status', '--porcelain'])),
                    fixture_sources={name: digest(Path(__file__).parent / name) for name in (
                        'instance_smoke.py', 'instance_console.py', 'instance_contract.py', 'InstanceObservation.swift')},
                    requested_scenarios=scenarios, full_scenario_run=scenarios == SCENARIOS,
                    console_observations=console_checks, instrumentation='INSTANCE_SMOKE + PREVIEW_SMOKE + LOCAL_APP',
                    actual_app_acceptance=False, cases=[])
    receipt = destination / 'summary.json'
    root = None
    try:
        metadata['session'] = require_console(observer, console_checks, 'preflight')
        assert 'coexist' not in scenarios or stable, 'The coexist case requires the exact stable instance-smoke bundle'
        metadata.update(os=subprocess.check_output(['sw_vers'], text=True).strip(),
                        sdk=subprocess.check_output(['xcrun', '--show-sdk-version'], text=True).strip(),
                        developer_directory=subprocess.check_output(['xcode-select', '-p'], text=True).strip(),
                        swift=subprocess.check_output(['xcrun', 'swiftc', '--version'], text=True).strip(),
                        observer_sha256=digest(observer),
                        bundles=[])
        xcode = subprocess.run(['xcodebuild', '-version'], capture_output=True, text=True, timeout=10)
        metadata['xcode'] = dict(code=xcode.returncode, output=(xcode.stdout + xcode.stderr).strip())
        root = Path(tempfile.mkdtemp(prefix='nac-instance-app-', dir=destination)).resolve()
        metadata['fixture'] = str(root)
        moved = []
        for index, bundle in enumerate([app] + ([stable] if stable else [])):
            target = root / ('Moved app with spaces ' + str(index)) / bundle.name
            shutil.copytree(bundle, target)
            moved.append(target)
            identity = json.loads((target / 'Contents/Resources/engine-identity.json').read_text())
            plist = plistlib.loads((target / 'Contents/Info.plist').read_bytes())
            metadata['bundles'].append(dict(path=str(target), identity=identity,
                bundle_id=plist['CFBundleIdentifier'], native_sha256=digest(target / 'Contents/MacOS/NACPreview'),
                engine_sha256=digest(target / 'Contents/Resources/nac-web'),
                version=subprocess.check_output([str(target / 'Contents/Resources/nac-web'), '--version'],
                    env={'PATH': '/usr/bin:/bin', 'HOME': str(root)}, text=True).strip()))
        if stable:
            assert metadata['bundles'][0]['bundle_id'] != metadata['bundles'][1]['bundle_id'], 'Build tracks share an app identity'
        for scenario in scenarios:
            require_console(observer, console_checks, 'scenario-' + scenario)
            case = destination / scenario
            case.mkdir(exist_ok=True)
            profile = root / scenario
            profile.mkdir(mode=0o700)
            if scenario == 'simultaneous':
                result = workspace_case(moved[0], case, profile, observer, console_checks)
            elif scenario == 'app-crash':
                result = app_crash_case(moved[0], case, profile, observer, console_checks)
            elif scenario == 'coexist':
                result = coexist_case(moved[0], moved[1], case, profile, observer, console_checks)
            else:
                result = conflict_case(scenario, moved[0], case, profile, observer, console_checks)
            metadata['cases'].append(result)
        require_console(observer, console_checks, 'completed')
        metadata.update(runtime_passed=True, visible_paint_acceptance='captured_pending_image_review')
    except BaseException as error:
        metadata.update(runtime_passed=False, failure=str(error), fixture_retained=root is not None)
        raise
    finally:
        receipt.write_text(json.dumps(metadata, indent=2) + '\n')
        if metadata.get('runtime_passed') and root:
            shutil.rmtree(root)


if __name__ == '__main__':
    main()
