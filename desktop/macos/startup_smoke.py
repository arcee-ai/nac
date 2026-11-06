#!/usr/bin/env python3
"""Real relocated LOCAL_APP / system WKWebView startup qualification."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from smoke import cleanup_failed_case


def sha256(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def console_locked():
    root = plistlib.loads(subprocess.check_output(['/usr/sbin/ioreg', '-n', 'Root', '-d', '1', '-a', '-l']))
    if isinstance(root, list):
        root = root[0]
    return any(session.get('CGSSessionScreenIsLocked') for session in root.get('IOConsoleUsers', []))


class Catalog(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(304)
        self.end_headers()

    def log_message(self, *arguments):
        pass


def _retention_notice(diagnostic, failure):
    if failure is not None:
        failure.add_note(diagnostic)
    try:
        print(diagnostic, file=sys.stderr)
    except BaseException as error:
        if failure is None:
            raise
        failure.add_note(f'Retention notice could not be written: {error}')


@contextmanager
def startup_profile(evidence, relocated, retained):
    """Keep private roots in custody until existing exact-owner cleanup settles."""
    root = Path(tempfile.mkdtemp(prefix='nac-finder-profile-')).resolve()
    failure = None
    try:
        yield root
    except BaseException as error:
        failure = error
        raise
    finally:
        try:
            record = json.loads(evidence.read_text())
            if (not isinstance(record, dict)
                    or type(record.get('app_pid')) is not int or record['app_pid'] <= 0
                    or type(record.get('engine_pid')) is not int or record['engine_pid'] < 0):
                raise RuntimeError('Incomplete startup ownership record; cleanup is unproven')
            cleanup_failed_case(evidence, relocated)
            shutil.rmtree(root)
        except BaseException as error:
            retained.append(root)
            diagnostic = f'Startup cleanup unproven; retained profile {root} and app {relocated}: {error}'
            _retention_notice(diagnostic, failure if failure is not None else error)
            if failure is None:
                raise


def main():
    app, destination = (Path(value).resolve() for value in sys.argv[1:])
    destination.mkdir(parents=True, exist_ok=True)
    locked = console_locked()
    vendor = os.environ.get('NAC_STARTUP_SCENARIOS') == 'startup-real-arcee'
    if vendor and os.environ.get('NAC_STARTUP_REAL_VENDOR') != '1':
        raise RuntimeError('The real-vendor case requires explicit NAC_STARTUP_REAL_VENDOR=1')
    if vendor and 'ARCEE_API_KEY' not in os.environ:
        raise RuntimeError('The authorized existing ARCEE_API_KEY environment reference is unavailable')
    if 'startup-real-arcee' in os.environ.get('NAC_STARTUP_SCENARIOS', '') and not vendor:
        raise RuntimeError('Run the single bounded real-vendor case separately from dummy fixtures')
    scenarios = os.environ.get('NAC_STARTUP_SCENARIOS',
        'startup-fresh,startup-home,startup-nac-relative,startup-xdg-relative,startup-store-override,'
        'startup-invalid-config,startup-future-store,startup-bad-directory,startup-missing-git').split(',')
    # Reserve every scenario before replacing evidence or starting any actor.
    # An existing directory may hold receipts from an earlier, unproven run.
    for scenario in scenarios:
        (destination / scenario).mkdir()
    identity = json.loads((app / 'Contents/Resources/engine-identity.json').read_text())
    metadata = {
        'source_head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
        'source_dirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], text=True)),
        'engine_identity': identity,
        'engine_sha256': sha256(app / 'Contents/Resources/nac-web'),
        'native_sha256': sha256(app / 'Contents/MacOS/NACPreview'),
        'os': subprocess.check_output(['sw_vers'], text=True).strip(),
        'sdk': subprocess.check_output(['xcrun', '--show-sdk-version'], text=True).strip(),
        'screen_locked': locked,
        'visible_paint_acceptance': 'pending_locked_session' if locked else 'requires_image_review',
        'vendor_authentication': 'arcee_api_environment_reference_requested' if vendor else 'not_exercised_dummy_provider',
    }
    (destination / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    catalog = ThreadingHTTPServer(('127.0.0.1', 0), Catalog)
    threading.Thread(target=catalog.serve_forever, daemon=True).start()
    provider_log = (destination / 'provider.log').open('w')
    provider = subprocess.Popen(['node', str(Path(__file__).with_name('startup_provider.mjs'))],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=provider_log, text=True)
    provider_url = json.loads(provider.stdout.readline())['base_url']
    results = []
    try:
        relocation = Path(tempfile.mkdtemp(prefix='nac-finder-relocation-')).resolve()
        retained_profiles = []
        try:
            relocated = Path(relocation).resolve() / 'Moved app folder with spaces' / app.name
            shutil.copytree(app, relocated)
            for scenario in scenarios:
                case = destination / scenario
                with startup_profile(case / 'result.json', relocated, retained_profiles) as root:
                    home, workspace = root / 'home with spaces', root / 'workspace with spaces'
                    home.mkdir(mode=0o700)
                    workspace.mkdir(mode=0o700)
                    environment = {'HOME': str(home), 'PATH': '/usr/bin:/bin:/usr/sbin:/sbin',
                        'LANG': 'en_US.UTF-8', 'NAC_TELEMETRY': 'disabled', 'NAC_ORCHESTRATION': '0',
                        'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null', 'BROWSER': 'none',
                        'MODELS_DEV_URL': f'http://127.0.0.1:{catalog.server_port}/models-dev'}
                    if vendor:
                        # Existing child-environment inheritance only: never use
                        # command arguments, fixtures, preferences or key files.
                        environment['ARCEE_API_KEY'] = os.environ['ARCEE_API_KEY']
                    nac = home / '.config/nac'
                    if scenario == 'startup-nac-relative':
                        environment.update(NAC_HOME='selected nac', XDG_CONFIG_HOME='ignored xdg')
                        nac = home / 'selected nac'
                    elif scenario == 'startup-xdg-relative':
                        environment['XDG_CONFIG_HOME'] = 'selected xdg'
                        nac = home / 'selected xdg/nac'
                    elif scenario not in ('startup-fresh', 'startup-home'):
                        nac = root / 'selected nac'
                        environment['NAC_HOME'] = str(nac)
                    nac.mkdir(parents=True, mode=0o700, exist_ok=True)
                    store = nac / {'dev': 'dev.db', 'beta': 'beta.db', 'stable': 'stable.db'}[identity['track']]
                    launch_options = []
                    if scenario == 'startup-store-override':
                        (nac / 'config.toml').write_text('[storage]\nstore_path="ignored-config.db"\n')
                        store = home / 'nested stores/selected.db'
                        launch_options += ['--store-path', 'nested stores/selected.db']
                        environment.update(PATH='/custom commands:/usr/bin:/bin', NAC_BUILD_TRACK='stable')
                    if scenario == 'startup-invalid-config':
                        (nac / 'config.toml').write_text('[storage]\nstore_path = [ private-invalid-canary\n')
                    if scenario == 'startup-bad-directory':
                        blocker = root / 'blocking file'
                        blocker.write_text('preserve fixture blocker')
                        launch_options += ['--store-path', str(blocker / 'store.db')]
                    if scenario == 'startup-future-store':
                        with sqlite3.connect(store) as database:
                            database.execute('PRAGMA user_version=999')
                        original_store = sha256(store)
                    if scenario == 'startup-missing-git':
                        missing = root / 'empty commands'
                        missing.mkdir()
                        environment['PATH'] = str(missing)
                    elif scenario in ('startup-missing-ssh', 'startup-missing-podman', 'startup-missing-mcp', 'startup-custom-mcp'):
                        commands = root / 'custom commands with spaces'
                        commands.mkdir()
                        (commands / 'git').symlink_to('/usr/bin/git')
                        if scenario == 'startup-custom-mcp':
                            fixture = Path(__file__).with_name('startup_mcp_fixture.py').read_text().split('\n', 1)[1]
                            executable = commands / 'finder-mcp'
                            executable.write_text(f'#!{sys.executable}\n' + fixture)
                            executable.chmod(0o700)
                            launch_options += ['--command-path', str(commands)]
                        else:
                            environment['PATH'] = str(commands)
                    subprocess.run(['/usr/bin/git', '-C', str(workspace), 'init', '--quiet', '--initial-branch=main'],
                                   env=environment, check=True)
                    subprocess.run(['/usr/bin/git', '-C', str(workspace), '-c', 'user.name=Finder fixture',
                        '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false',
                        'commit', '--quiet', '--allow-empty', '-m', 'fixture baseline'], env=environment, check=True)
                    configured = scenario in ('startup-home', 'startup-nac-relative', 'startup-xdg-relative', 'startup-store-override')
                    if configured:
                        provider.stdin.write(json.dumps({'kind': 'queue', 'scenario': scenario}) + '\n')
                        provider.stdin.flush()
                        assert json.loads(provider.stdout.readline())['queued'] == scenario
                    evidence = case / 'result.json'
                    command = ['/usr/bin/open', '-n', '-W', '-a', str(relocated), '--args',
                        '--smoke-scenario', scenario, '--smoke-output', str(evidence),
                        '--smoke-workspace', str(workspace), '--smoke-expected-store', str(store),
                        '--smoke-provider', provider_url, '--smoke-paint', '0' if locked else '1'] + launch_options
                    if vendor and os.environ.get('NAC_STARTUP_VENDOR_SELECTION_ONLY') == '1':
                        command += ['--smoke-selection-only', '1']
                    with (case / 'launch.log').open('w') as log:
                        opened = subprocess.Popen(command, cwd='/', env=environment, stdout=log, stderr=log)
                        try:
                            opened.wait(timeout=180)
                            assert opened.returncode == 0, 'LaunchServices failed'
                            record = json.loads(evidence.read_text())
                            assert record.get('passed') and record.get('stopped'), record
                            if record.get('engine_pid'):
                                assert not subprocess.run(['/bin/ps', '-p', str(record['engine_pid']), '-o', 'pid='],
                                                          capture_output=True, text=True).stdout.strip(), 'Engine survived app close'
                            if scenario == 'startup-future-store':
                                assert sha256(store) == original_store, 'Unsupported store was mutated'
                                assert not Path(str(store) + '-wal').exists() and not Path(str(store) + '-shm').exists()
                            if scenario in ('startup-invalid-config', 'startup-bad-directory', 'startup-missing-git'):
                                assert not store.exists(), 'Startup failure substituted a fresh store'
                            record['profile_cleaned_by_runner'] = True
                            record['screen_locked'] = locked
                            results.append(record)
                        except BaseException as failure:
                            try:
                                if opened.poll() is None:
                                    opened.terminate()
                                    opened.wait(timeout=5)
                            except BaseException as error:
                                failure.add_note(f'LaunchServices wrapper cleanup failed: {error}')
                            raise
        finally:
            failure = sys.exception()
            if retained_profiles:
                _retention_notice(
                    f'Retained relocated bundle root {relocation}; profiles: {retained_profiles}', failure)
            else:
                try:
                    shutil.rmtree(relocation)
                except BaseException as error:
                    diagnostic = f'Relocation cleanup failed; retained root {relocation}: {error}'
                    _retention_notice(diagnostic, failure if failure is not None else error)
                    if failure is None:
                        raise
        provider.stdin.write('{"kind":"finish"}\n')
        provider.stdin.flush()
        report = json.loads(provider.stdout.readline())
        assert report['passed'] and all(request['dummy_authorization'] for request in report['requests'])
        (destination / 'provider-result.json').write_text(json.dumps(report, indent=2) + '\n')
        provider.wait(timeout=10)
        assert provider.returncode == 0
        (destination / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    finally:
        failure = sys.exception()
        errors = []
        for name, operation in [('Catalog shutdown', catalog.shutdown), ('Catalog close', catalog.server_close)]:
            try:
                operation()
            except BaseException as error:
                errors.append((name, error))
        if provider.poll() is None:
            try:
                provider.stdin.close()
            except BaseException as error:
                errors.append(('Provider stdin close', error))
            try:
                try:
                    provider.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    provider.terminate()
                    provider.wait(timeout=5)
            except BaseException as error:
                errors.append(('Provider teardown', error))
        try:
            provider_log.close()
        except BaseException as error:
            errors.append(('Provider log close', error))
        primary = failure
        for name, error in errors:
            if primary is None:
                primary = error
            else:
                primary.add_note(f'{name} failed: {error}')
        if failure is None and primary is not None:
            raise primary


if __name__ == '__main__':
    main()
