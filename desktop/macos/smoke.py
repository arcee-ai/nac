#!/usr/bin/env python3
"""Actual AppKit/WKWebView acceptance; requires an interactive Aqua session."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time

from engine_contract import run_contract
from lifecycle_fixture import CASES, LifecycleControl, alive

RECEIPT_FAILURES = ('malformed', 'truncated', 'missing-receipt', 'duplicate', 'oversized',
                    'wrong-version', 'wrong-build', 'wrong-source', 'wrong-track',
                    'wrong-store', 'wrong-incarnation', 'wrong-endpoint')


def cleanup_failed_case(evidence, relocated):
    """Only target identities recorded by this run inside this exact bundle."""
    if not evidence.exists():
        raise RuntimeError('No ownership record; inspect app launch diagnostics before cleanup')
    record = json.loads(evidence.read_text())
    helper = record.get('app_helper_pid')
    if helper and alive(helper):
        command = subprocess.check_output(['/bin/ps', '-p', str(helper), '-o', 'command='], text=True).strip()
        if command != '/bin/sleep ' + record.get('app_helper_argument', ''):
            raise RuntimeError('Refusing cleanup of an unrelated app helper')
        os.kill(helper, signal.SIGTERM)
    for key, executable in [('engine_pid', relocated / 'Contents/Resources/nac-web'),
                            ('app_pid', relocated / 'Contents/MacOS/NACPreview')]:
        pid = record.get(key, 0)
        if not pid:
            continue
        command = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'command='],
                                 capture_output=True, text=True).stdout
        if not command:
            continue
        if str(executable) not in command:
            raise RuntimeError(f'Refusing cleanup of mismatched {key} {pid}: {command}')
        if key == 'engine_pid' and os.getpgid(pid) != pid:
            raise RuntimeError(f'Refusing cleanup of unowned engine group {pid}')
        send = (lambda sig: os.killpg(pid, sig)) if key == 'engine_pid' else (lambda sig: os.kill(pid, sig))
        try:
            send(signal.SIGTERM)
            deadline = time.monotonic() + (25 if key == 'engine_pid' else 3)
            while time.monotonic() < deadline:
                state = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'stat='],
                                       capture_output=True, text=True).stdout.strip()
                if not state or state.startswith('Z'):
                    break
                time.sleep(0.05)
            send(signal.SIGKILL)
        except ProcessLookupError:
            pass
        except PermissionError:
            # Darwin can report EPERM for an already dead process group. Never
            # hide a permission failure while any group member can still run.
            rows = subprocess.check_output(['/bin/ps', '-axo', 'pid=,pgid=,stat='], text=True)
            members = [line.split() for line in rows.splitlines()]
            live = [row for row in members if len(row) == 3 and
                    int(row[1 if key == 'engine_pid' else 0]) == pid and not row[2].startswith('Z')]
            if live:
                raise
    root = Path(record.get('profile', '/missing-ownership-record'))
    if (root.name.startswith('nac-mac-preview-') and not root.is_symlink()
            and root.resolve().parent == Path(tempfile.gettempdir()).resolve()):
        if root.exists():
            shutil.rmtree(root)


def main():
    app, output = map(lambda value: Path(value).resolve(), sys.argv[1:])
    output.mkdir(parents=True, exist_ok=True)
    metadata = {
        'source_head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
        'source_dirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], text=True)),
        'os': subprocess.check_output(['sw_vers'], text=True).strip(),
        'sdk': subprocess.check_output(['xcrun', '--show-sdk-version'], text=True).strip(),
        'developer_directory': subprocess.check_output(['xcode-select', '-p'], text=True).strip(),
        'engine_version': subprocess.check_output([str(app / 'Contents/Resources/nac-web'), '--version'], text=True).strip(),
        'engine_identity': json.loads((app / 'Contents/Resources/engine-identity.json').read_text()),
    }
    for name, relative in [('engine_sha256', 'Contents/Resources/nac-web'),
                           ('native_sha256', 'Contents/MacOS/NACPreview')]:
        with (app / relative).open('rb') as binary:
            digest = hashlib.sha256()
            for chunk in iter(lambda: binary.read(1024 * 1024), b''):
                digest.update(chunk)
            metadata[name] = digest.hexdigest()
    run_contract(app / 'Contents/Resources/nac-web', output / 'engine-contract.json')
    # A local decoy proves startup never adopts the conventional default port.
    decoy = socket.socket()
    try:
        decoy.bind(('127.0.0.1', 3210))
    except OSError as error:
        raise SystemExit(f'Port 3210 must be free for the owned decoy control: {error}')
    decoy.listen()
    decoy.settimeout(0.2)
    contacted = []
    other_contacts = []
    done = threading.Event()

    def reject_decoy():
        while not done.is_set():
            try:
                client, _ = decoy.accept()
                client.settimeout(0.5)
                try:
                    request = client.recv(8192).decode('utf-8', errors='replace')
                except TimeoutError:
                    request = ''
                if 'NACPreviewSmoke/ALL-340' in request:
                    contacted.append(request)
                else:
                    other_contacts.append(request.split('\r\n')[0])
                client.close()
            except TimeoutError:
                pass

    thread = threading.Thread(target=reject_decoy, daemon=True)
    thread.start()
    results = []
    try:
        with tempfile.TemporaryDirectory(prefix='nac-mac-relocation-') as temporary:
            relocated = Path(temporary) / 'Moved folder with spaces' / app.name
            shutil.copytree(app, relocated)
            engine = relocated / 'Contents/Resources/nac-web'
            saved = engine.with_name('saved-engine')
            engine.rename(saved)
            try:
                # Each scenario launches the bundle in a different cwd and with a
                # poisoned parent environment. The engine receives a clean allowlist.
                for scenario in ('normal', 'engine-exit', 'missing', 'exit', 'close-startup', 'timeout', 'migration-failure') + RECEIPT_FAILURES + CASES:
                    if scenario in ('normal', 'engine-exit', 'migration-failure') + CASES:
                        os.link(saved, engine)
                    elif scenario == 'missing':
                        engine.unlink(missing_ok=True)
                    elif scenario in RECEIPT_FAILURES:
                        fixture = Path(__file__).with_name('protocol_fixture.py').read_text()
                        engine.write_text('#!' + sys.executable + '\n' + fixture.split('\n', 1)[1])
                        engine.with_name('fixture-scenario').write_text(scenario)
                        engine.chmod(0o755)
                    else:
                        engine.write_text('#!/bin/sh\n' + ('exit 42\n' if scenario == 'exit' else
                            "trap '' TERM\nwhile :; do /bin/sleep 1; done\n"))
                        engine.chmod(0o755)
                    evidence = output / f'{scenario}.json'
                    evidence.unlink(missing_ok=True)
                    control = LifecycleControl(scenario, evidence, relocated)
                    control.start()
                    started = time.monotonic()
                    with (output / f'{scenario}.log').open('w') as log:
                        process = subprocess.Popen(['/usr/bin/open', '-n', '-W', '-a', str(relocated),
                            '--stdout', str(output / f'{scenario}-app.log'),
                            '--stderr', str(output / f'{scenario}-app.log'),
                            '--env', 'NAC_HOME=/DO-NOT-USE-PERSONAL-NAC',
                            '--env', 'NAC_MANAGED_CONFIG=/DO-NOT-INHERIT',
                            '--env', 'OPENAI_API_KEY=must-not-reach-engine', '--args',
                            '--smoke-output', str(evidence), '--smoke-scenario', scenario],
                            cwd='/', stdout=log, stderr=log, start_new_session=True,
                            env={**os.environ, 'NAC_HOME': '/DO-NOT-USE-PERSONAL-NAC',
                                 'NAC_MANAGED_CONFIG': '/DO-NOT-INHERIT',
                                 'OPENAI_API_KEY': 'must-not-reach-engine'})
                        try:
                            code = process.wait(timeout=115)
                        except subprocess.TimeoutExpired:
                            cleanup_failed_case(evidence, relocated)
                            process.terminate()
                            process.wait(timeout=5)
                            raise RuntimeError(f'{scenario}: app exceeded bounded smoke timeout; inspect {output}')
                    control_result = control.finish()
                    result = json.loads(evidence.read_text())
                    if control_result is not None:
                        result['external_control'] = control_result if not scenario.startswith('parent-loss') else {'parent_killed': True}
                    if scenario == 'watchdog':
                        assert '20000 ms' in result.get('engine_log_after_shutdown', ''), result
                    if scenario in ('slow-drain', 'watchdog'):
                        elapsed = time.monotonic() - started
                        assert elapsed >= (5.5 if scenario == 'slow-drain' else 19.5), elapsed
                    result['elapsed_seconds'] = round(time.monotonic() - started, 3)
                    result['relocated_app'] = str(relocated)
                    evidence.write_text(json.dumps(result, indent=2) + '\n')
                    assert (code == 0 or scenario.startswith('parent-loss')) and result.get('passed'), f'{scenario} failed: {result}'
                    assert result['engine_reaped'] and result['profile_removed'], result
                    pid = result.get('engine_pid', 0)
                    if pid:
                        assert not alive(pid), f'Engine {pid} survived window close'
                    if result.get('descendant_pid'):
                        assert not alive(result['descendant_pid']), result
                    assert not Path(result['profile']).exists(), result
                    assert all(result.get('profile') != prior.get('profile') for prior in results), result
                    assert not contacted, 'Preview contacted the unrelated default-port server'
                    results.append({'scenario': scenario, 'passed': True,
                                    'profile': result['profile'],
                                    'elapsed_seconds': result['elapsed_seconds']})
                    print(json.dumps(results[-1]), flush=True)
                    if scenario != 'missing':
                        engine.unlink()
            finally:
                engine.unlink(missing_ok=True)
                saved.rename(engine)
    finally:
        done.set()
        thread.join(timeout=1)
        decoy.close()
    (output / 'summary.json').write_text(json.dumps({**metadata, 'scenarios': results,
        'preview_decoy_contacts': len(contacted),
        'unrelated_decoy_connections': len(other_contacts)}, indent=2) + '\n')


if __name__ == '__main__':
    main()
