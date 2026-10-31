#!/usr/bin/env python3
"""Bundled-engine configuration contracts; separate from actual AppKit evidence."""
import json
import fcntl
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def run_contract(engine, destination):
    results = []
    identity = json.loads(subprocess.check_output([str(engine), '__desktop-identity'], text=True))
    with tempfile.TemporaryDirectory(prefix='nac-finder-config-') as temporary:
        root = Path(temporary).resolve() / 'bootstrap with spaces'
        root.mkdir()
        for profile in ('nac-absolute', 'nac-relative', 'xdg-absolute', 'xdg-relative', 'home'):
            selected = root / ('home/.config/nac' if profile == 'home' else 'selected config')
            selected.mkdir(parents=True, exist_ok=True)
            environment = {'HOME': str(root / 'home'), 'PATH': '/usr/bin:/bin', 'NAC_TELEMETRY': 'disabled'}
            if profile.startswith('nac'):
                environment['NAC_HOME'] = str(selected) if profile.endswith('absolute') else 'selected config'
                environment['XDG_CONFIG_HOME'] = str(root / 'ignored xdg')
            elif profile.startswith('xdg'):
                selected = root / 'selected xdg/nac'
                selected.mkdir(parents=True, exist_ok=True)
                environment['XDG_CONFIG_HOME'] = str(selected.parent) if profile.endswith('absolute') else 'selected xdg'
            config = selected / 'config.toml'
            config.write_text('[worker]\nthread_timeout_secs = 342\n')
            # A broken credential file must not even be read by path selection.
            (selected / 'credentials.json').write_text('credential-preflight-must-not-read')
            legacy = selected / 'store.db'
            legacy.write_bytes(b'legacy-canary')
            command = [str(engine), '__desktop-configuration', '--directory', str(root)]

            def invoke(extra=(), env=None):
                response = subprocess.run(command + list(extra), cwd=root, env=env or environment,
                                          capture_output=True, timeout=10, check=True, text=True)
                assert len(response.stdout.encode()) <= 16384
                assert 'credential-preflight-must-not-read' not in response.stdout + response.stderr
                return json.loads(response.stdout)

            for terminal in (False, True):
                env = dict(environment, PATH='/custom tools:/usr/bin:/bin') if terminal else environment
                selection = invoke(env=env)
                filename = {'dev': 'dev.db', 'beta': 'beta.db', 'stable': 'store.db'}[identity['track']]
                assert selection == {'status': 'selected', 'version': 1, 'root_cwd': str(root),
                                     'store': str(selected / filename), 'track': identity['track']}, selection
                assert invoke(['--store-path', 'override store.db'], env)['store'] == str(root / 'override store.db')
            config.write_text('[storage]\nstore_path = "configured store.db"\n')
            assert invoke()['store'] == str(root / 'configured store.db')
            config.write_text('[storage]\nstore_path = [ invalid-secret-canary\n')
            failed = invoke()
            assert failed['status'] == 'failed' and failed['code'] == 'invalid_configuration', failed
            assert 'invalid-secret-canary' not in json.dumps(failed)
            assert legacy.read_bytes() == b'legacy-canary'
            assert not (selected / 'dev.db').exists() and not (selected / 'stable.db').exists()
            assert not (root / 'override store.db').exists() and not (root / 'configured store.db').exists()
            config.unlink()
            results.append({'profile': profile, 'finder_terminal': True, 'configuration_override': True,
                            'invalid_configuration_redacted': True, 'no_store_opened': True,
                            'no_credential_read': True})
        managed = invoke(env=dict(environment, NAC_MANAGED_CONFIG='must-not-be-opened'))
        assert managed['code'] == 'managed_configuration', managed
        # A cooperating editor can hold the normal publication lock forever.
        # The private helper must bound that wait without creating a database.
        with (selected / 'config.toml.lock').open('a+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            started = time.monotonic()
            bounded = subprocess.run(command, cwd=root, env=environment, capture_output=True, timeout=13)
            elapsed = time.monotonic() - started
            assert bounded.returncode == 70 and elapsed < 13, (bounded.returncode, elapsed)
            assert not bounded.stdout and not (selected / 'dev.db').exists()
        results.append({'publication_lock_wait_bounded': True, 'helper_exit': bounded.returncode})
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps({'engine_identity': identity, 'profiles': results}, indent=2) + '\n')


if __name__ == '__main__':
    run_contract(Path(sys.argv[1]).resolve(), Path(sys.argv[2]))
