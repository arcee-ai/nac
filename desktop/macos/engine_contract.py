#!/usr/bin/env python3
"""Private channel/binary fixtures using the same bundled engine as the app."""
import json
import os
from pathlib import Path
import select
import signal
import socket
import subprocess
import tempfile
import time
import uuid
import urllib.request

LIMIT = 16384


def record(channel, timeout=12):
    end = time.monotonic() + timeout
    data = b''
    while time.monotonic() < end:
        if not select.select([channel], [], [], max(0, end - time.monotonic()))[0]:
            break
        chunk = channel.recv(1)
        if not chunk:
            raise EOFError('engine closed before receipt')
        data += chunk
        assert len(data) <= LIMIT
        if data.endswith(b'\n'):
            return json.loads(data)
    raise TimeoutError('engine receipt timeout')


def run_contract(binary, destination):
    binary = Path(binary).resolve()
    identity = json.loads(subprocess.check_output([str(binary), '__desktop-identity']))
    results = []
    with tempfile.TemporaryDirectory(prefix='nac-desktop-contract-') as temporary:
        root = Path(temporary).resolve()
        for scenario in ('ready-stop', 'channel-loss', 'wrong-stop', 'duplicate-hello',
                         'wrong-build', 'wrong-store', 'wrong-version', 'truncated',
                         'oversized', 'bind-conflict', 'migration-failure', 'startup-loss', 'cli'):
            profile = root / scenario
            profile.mkdir()
            store = profile / 'store.db'
            parent, child = socket.socketpair()
            incarnation = str(uuid.uuid4())
            hello = dict(kind='hello', version=1, incarnation=incarnation, identity=dict(identity), store=str(store))
            environment = {key: value for key, value in os.environ.items() if key in ('PATH', 'LANG', 'TMPDIR')}
            environment.update(HOME=str(profile), NAC_HOME=str(profile / 'nac'), BROWSER='none', NAC_TELEMETRY='disabled')
            arguments = [str(binary), '--bind', '127.0.0.1:0', '--directory', str(profile), '--store-path', str(store), '--no-open']
            if scenario != 'cli':
                environment['NAC_DESKTOP_CHANNEL_FD'] = str(child.fileno())
            if scenario == 'migration-failure':
                store.write_text('invalid SQLite')
            if scenario == 'wrong-build':
                hello['identity']['build_id'] += '-wrong'
            if scenario == 'wrong-version':
                hello['version'] = 2
            if scenario == 'wrong-store':
                hello['store'] += '-wrong'
            # Explicit desktop mode rejects nonzero bind before publication.
            if scenario == 'bind-conflict':
                arguments[2] = '127.0.0.1:3210'
            started = time.monotonic()
            with (profile / 'diagnostics').open('wb') as diagnostics:
                process = subprocess.Popen(arguments, env=environment, pass_fds=(child.fileno(),),
                                           stdin=subprocess.DEVNULL, stdout=diagnostics, stderr=diagnostics)
                child.close()
                try:
                    payload = json.dumps(hello).encode() + b'\n'
                    if scenario == 'oversized':
                        payload = b'x' * (LIMIT + 1)
                    if scenario == 'truncated':
                        payload = payload[:-2]
                    if scenario != 'cli':
                        parent.sendall(payload)
                    if scenario in ('truncated', 'startup-loss'):
                        parent.close()
                    elif scenario == 'cli':
                        parent.close()
                        # No inherited channel: stdin EOF does not stop ordinary CLI.
                        end = time.monotonic() + 12
                        while 'listening on' not in (profile / 'diagnostics').read_text() and time.monotonic() < end:
                            assert process.poll() is None
                            time.sleep(.025)
                        assert 'listening on' in (profile / 'diagnostics').read_text()
                        assert process.poll() is None
                        process.send_signal(signal.SIGTERM)
                    elif scenario in ('wrong-build', 'wrong-store', 'wrong-version', 'oversized', 'bind-conflict', 'migration-failure'):
                        try:
                            failure = record(parent)
                        except (EOFError, ConnectionResetError):
                            failure = None
                        assert failure is None or failure['kind'] == 'failed', failure
                    else:
                        receipt = record(parent)
                        assert receipt['kind'] == 'ready' and receipt['identity'] == identity
                        assert receipt['version'] == 1 and receipt['incarnation'] == incarnation
                        assert receipt['store'] == str(store) and receipt['schema'] > 0
                        assert receipt['endpoint'].startswith('http://127.0.0.1:')
                        with urllib.request.urlopen(receipt['endpoint'] + '/store', timeout=3) as response:
                            actual = json.load(response)
                        assert actual['store_path'] == str(store)
                        assert Path(actual['worker_executable']).resolve() == binary
                        if scenario == 'channel-loss':
                            parent.close()
                        elif scenario == 'duplicate-hello':
                            parent.sendall(payload)
                        else:
                            stop = dict(kind='stop', version=1, incarnation=incarnation if scenario == 'ready-stop' else str(uuid.uuid4()))
                            parent.sendall(json.dumps(stop).encode() + b'\n')
                    code = process.wait(timeout=23)
                    assert time.monotonic() - started < 25
                    if scenario in ('ready-stop', 'channel-loss', 'wrong-stop', 'duplicate-hello', 'startup-loss', 'cli'):
                        assert code == 0, (scenario, code, (profile / 'diagnostics').read_text())
                    results.append(dict(scenario=scenario, code=code, elapsed=round(time.monotonic()-started, 3)))
                finally:
                    parent.close()
                    if process.poll() is None:
                        process.kill()
                        process.wait()
    Path(destination).write_text(json.dumps(dict(identity=identity, cases=results), indent=2) + '\n')
    return results


if __name__ == '__main__':
    import sys
    print(json.dumps(run_contract(*sys.argv[1:]), indent=2))
