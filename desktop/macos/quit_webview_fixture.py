#!/usr/bin/env python3
"""Bounded system WK document/SSE lifetime probe, not normal-app acceptance.

Compile QuitWebViewFixture.swift separately and execute only in the coordinated
Mac/browser lease. No activation, input events, screenshot or CI framework.
"""
import json
from pathlib import Path
import plistlib
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from urllib.parse import urlparse

from instance_contract import OwnedEngine, digest
from quit_fixture import QuitWorkspaceFixture, TRANSCRIPT, request, until
from smoke import session_lock_state


def run_contract(binary, probe, destination):
    binary, probe, destination = map(lambda path: Path(path).resolve(), (binary, probe, destination))
    destination.parent.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix='nac-quit-wk-lifetime-', dir=destination.parent)).resolve()
    sources = ['QuitWebViewFixture.swift', 'quit_webview_fixture.py', 'quit_fixture.py']
    source_root = Path(__file__).resolve().parent
    evidence = dict(engine_sha256=digest(binary), native_probe_sha256=digest(probe),
                    source_files={name: digest(source_root / name) for name in sources},
                    source_head=subprocess.check_output(['git', '-C', str(source_root), 'rev-parse', 'HEAD'], text=True).strip(),
                    console_lock=session_lock_state(),
                    os=subprocess.check_output(['/usr/bin/sw_vers', '-productVersion'], text=True).strip(),
                    actual_system_wk_document_probe=True, normal_app_acceptance=False,
                    visible_paint_acceptance=False, trusted_input_acceptance=False, cases=[])
    with Path('/System/Library/Frameworks/WebKit.framework/Resources/Info.plist').open('rb') as stream:
        evidence['system_webkit_version'] = plistlib.load(stream)['CFBundleVersion']
    try:
        for scenario in ('release-before-stop', 'hide-through-stop', 'stop-loading-through-stop'):
            profile = root / scenario
            profile.mkdir(mode=0o700)
            controls = profile / 'controls'
            controls.mkdir(mode=0o700)
            observation = profile / 'native.json'
            fixture = QuitWorkspaceFixture(profile)
            environment = dict(HOME=str(profile), NAC_HOME=str(profile / 'nac-home'),
                               PATH='/usr/bin:/bin:/usr/sbin:/sbin', BROWSER='none', NAC_TELEMETRY='disabled',
                               MODELS_DEV_URL=fixture.provider.endpoint + '/models-dev',
                               OPENAI_API_KEY='quit-fixture-dummy-only', GIT_CONFIG_NOSYSTEM='1',
                               GIT_CONFIG_GLOBAL='/dev/null')
            store = profile / 'selected store.db'
            children, native, stop_thread = [], None, None
            stop_error = []
            try:
                subprocess.run(['/usr/bin/git', 'init', '--quiet', '--initial-branch=main', str(profile)],
                               env=environment, check=True, timeout=5)
                owner = OwnedEngine(binary, profile, store, environment, desktop=True)
                children.append(owner)
                owner.ready()
                evidence['engine_identity'] = owner.identity
                prepared = fixture.prepare(owner.endpoint)
                with (profile / 'native.log').open('wb') as output:
                    native = subprocess.Popen([str(probe), owner.endpoint, fixture.approval_session,
                                               str(controls), str(observation)], env=environment,
                                              stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                                              start_new_session=True)

                def stage(expected):
                    def read():
                        assert native.poll() is None, 'Native lifetime probe exited'
                        try:
                            value = json.loads(observation.read_text())
                        except (FileNotFoundError, json.JSONDecodeError):
                            return None
                        assert value['stage'] != 'failed', value
                        return value if value['stage'] == expected else None
                    return until('Native lifetime stage ' + expected, read)

                opened = stage('observer-open')
                assert opened['observer_opened'] and opened['view_retained']
                # Leave the real WK observer as the only interactive fixture
                # client. It must close through document lifetime, not Python.
                fixture.retire_streams()
                fixture.assert_unapproved()
                held_seconds = None
                started = time.monotonic()
                if scenario != 'release-before-stop':
                    if scenario == 'stop-loading-through-stop':
                        (controls / 'stop-loading').touch()
                    (controls / 'retain').touch()
                    assert stage('retained')['view_retained']

                    def stop():
                        try:
                            owner.stop()
                        except BaseException as error:
                            stop_error.append(error)
                    stop_thread = threading.Thread(target=stop, daemon=True)
                    stop_thread.start()
                    address = urlparse(owner.endpoint)

                    def admission_closed():
                        assert owner.process.poll() is None, 'Server did not retain real WK stream during drain'
                        with socket.socket() as connection:
                            return connection.connect_ex((address.hostname, address.port)) != 0
                    until('Real listener entered graceful shutdown', admission_closed)
                    held = time.monotonic()
                    time.sleep(4.5)
                    exited_while_retained = owner.process.poll() is not None
                    if scenario == 'hide-through-stop':
                        assert not exited_while_retained, 'Hidden WK observer drained before release'
                    held_seconds = round(time.monotonic() - held, 3)
                    (controls / 'release').touch()
                    released = stage('released')
                    stop_thread.join(timeout=24)
                    assert not stop_thread.is_alive(), 'Engine stop did not settle after WK release'
                    if stop_error:
                        raise stop_error[0]
                else:
                    (controls / 'release').touch()
                    released = stage('released')
                    owner.stop()
                assert not released['view_retained']
                assert 'forcing runtime exit' not in owner.diagnostics.read_text()
                result = dict(scenario=scenario, **prepared, **fixture.verify_store(store),
                              retained_stream_hold_seconds=held_seconds,
                              shutdown_seconds=round(time.monotonic() - started, 3),
                              released_weak_view_retained=released['retired_view_retained'],
                              real_wk_observer_opened=True, engine_clean_exit=True)
                if scenario != 'release-before-stop':
                    result['engine_exited_with_view_retained'] = exited_while_retained
                replacement = OwnedEngine(binary, profile, store, environment, desktop=True)
                children.append(replacement)
                replacement.ready()
                messages = request(replacement.endpoint, '/sessions/' + fixture.session + '/messages?include_system=true&limit=200')
                assert TRANSCRIPT in json.dumps(messages)
                fixture.verify_store(store)
                replacement.stop()
                result.update(store_reacquired=True, durable_transcript_preserved=True)
                (controls / 'finish').touch()
                assert native.wait(timeout=5) == 0
                evidence['cases'].append(result)
            finally:
                fixture.retire_streams()
                if native and native.poll() is None:
                    native.terminate()
                    try:
                        native.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        native.kill()
                        native.wait(timeout=3)
                if stop_thread and stop_thread.is_alive():
                    stop_thread.join(timeout=24)
                for child in reversed(children):
                    child.close()
                fixture.close()
        evidence['passed'] = True
    except BaseException as error:
        evidence.update(passed=False, failure=str(error), fixture_retained=str(root))
        raise
    finally:
        destination.write_text(json.dumps(evidence, indent=2) + '\n')
        if evidence.get('passed'):
            shutil.rmtree(root)
    return evidence


if __name__ == '__main__':
    import sys
    print(json.dumps(run_contract(*sys.argv[1:]), indent=2))
