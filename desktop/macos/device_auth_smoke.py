#!/usr/bin/env python3
"""Hosted-only actual fixture .app/WK/device-owner/system-browser acceptance.

Requires a root-approved isolated hosted browser/profile contract. Never
dispatches a hosted job or changes the default browser/TCC/credentials.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

from device_auth_profile import DeviceProfile, identity
from external_auth_fixture import AuthFixture
from external_auth_smoke import require_isolated_host
from smoke import alive, cleanup_failed_case


def digest(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def require_browser_handoff(result):
    assert result.get('external_browser_observed') is True, 'Device fixture has no actual browser handoff evidence'
    assert result.get('handoff_coverage_missing') is not True, 'Device expiry won before required handoff coverage'


def run_case(app, output, profile, scenario):
    output.mkdir(parents=True, exist_ok=False)
    evidence = output / 'result.json'
    arguments = ['/usr/bin/open', '-n', '-W', str(app), '--args', '--smoke-scenario', scenario,
        '--smoke-output', str(evidence), '--directory', str(profile.workspace), '--store-path', str(profile.store)]
    with (output / 'launch.log').open('wb') as log:
        process = subprocess.Popen(arguments, env=profile.environment, cwd='/', stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 180
            while process.poll() is None and time.monotonic() < deadline:
                time.sleep(.1)
            if process.poll() is None:
                raise TimeoutError('Owned device fixture app exceeded 180 seconds')
            result = json.loads(evidence.read_text())
            assert process.returncode == 0 and result.get('passed') is True and result.get('stopped') is True
            assert result.get('commands_retired') is True and not alive(result.get('engine_pid', 0))
            assert result.get('ready_build', '').startswith('native-auth-fixture-v1-')
            return result
        except BaseException:
            if evidence.exists():
                cleanup_failed_case(evidence, app)
            raise
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)


def main():
    source_app, output = (Path(value).resolve() for value in sys.argv[1:])
    console = require_isolated_host()
    build = identity(source_app / 'Contents/Resources/nac-web')
    receipt = json.loads((source_app / 'Contents/Resources/build-receipt.json').read_text())
    assert receipt['mode'] == 'auth-build' and receipt['source_dirty'] is False
    assert receipt['engine_identity'] == build
    assert receipt['bundle_identifier'] == 'ai.arcee.nac.native-auth-fixture'
    assert {'LOCAL_APP', 'PREVIEW_SMOKE', 'NATIVE_AUTH_FIXTURE'} <= set(receipt['compiler_flags'])
    assert digest(source_app / 'Contents/Resources/nac-web') == receipt['engine_sha256']
    assert digest(source_app / 'Contents/MacOS/NACPreview') == receipt['native_sha256']
    output.mkdir(parents=True, exist_ok=False)
    (output / 'metadata.json').write_text(json.dumps({'session': console, 'build_receipt': receipt,
        'scope': 'actual fixture-engine app/system-WK/browser/local-device-owner; DOM-driven',
        'physical_input_qualified': False, 'real_vendor_qualified': False,
        'browser_profile_isolation': 'provided_by_coordinator_approved_hosted_contract'}, indent=2) + '\n')
    results = []
    with tempfile.TemporaryDirectory(prefix='nac-device-app-relocation-') as temporary:
        app = Path(temporary) / source_app.name
        shutil.copytree(source_app, app)
        for mode, scenario in [('success', 'device-success'), ('denied', 'device-denied'), ('expired', 'device-expired'),
                               ('hold', 'device-cancel'), ('timeout', 'device-timeout')]:
            # The owner-only HTTP contract keeps its default three seconds.
            # This hosted app case allows cold browser startup before expiry.
            with AuthFixture(device_mode=mode, device_timeout_seconds=15 if mode == 'timeout' else 3) as fixture, DeviceProfile(build, fixture.origin) as profile:
                result = run_case(app, output / scenario, profile, scenario)
                require_browser_handoff(result)
                before = fixture.snapshot()
                if mode in ('success', 'hold'):
                    restart_scenario = 'device-restart' if mode == 'success' else 'device-canceled-restart'
                    credential = profile.root / 'nac-home/arcee_auth.json'
                    retained = digest(credential) if credential.exists() else None
                    restarted = run_case(app, output / restart_scenario, profile, restart_scenario)
                    assert restarted['launch_incarnation'] != result['launch_incarnation']
                    assert fixture.snapshot() == before, 'Restart replayed authentication or browser work'
                    assert (digest(credential) if credential.exists() else None) == retained
                    results.append({'scenario': restart_scenario, 'passed': True, 'no_authentication_replay': True})
                observations = fixture.snapshot()['events']
                assert any(event['kind'] == 'device_browser' and event['webkit_fixture'] is False for event in observations)
                assert all(event['bridge'] is False and event['webkit_fixture'] is False
                           for event in observations if event['kind'] == 'browser_observation')
                results.append({'scenario': scenario, 'passed': True, 'profile_externally_owned': True})
    (output / 'results.json').write_text(json.dumps({'results': results, 'real_vendor_qualified': False,
        'physical_input_qualified': False, 'all_owned_profiles_removed': True}, indent=2) + '\n')
    print('Actual fixture-engine WK/device-owner/system-browser local-double acceptance passed')


if __name__ == '__main__':
    main()
