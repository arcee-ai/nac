#!/usr/bin/env python3
"""Run the owned actual .app/system-WK + real system-browser auth fixture.

Requires the shared browser lease and the common builder's external-auth hook.
Does not synthesize OS input or change the system browser, credentials, or TCC.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

from external_auth_fixture import AuthFixture
from smoke import alive, cleanup_failed_case, session_lock_state


def digest(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def main():
    source_app, output = (Path(argument).resolve() for argument in sys.argv[1:])
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('RUNNER_OS') != 'macOS':
        raise SystemExit('Real external-browser qualification requires the coordinator-approved isolated hosted Mac contract; no launch attempted')
    console = session_lock_state()
    if not console['observed'] or console['locked'] is not False:
        raise SystemExit('Real external-browser qualification requires an unlocked isolated Mac/browser profile; no launch attempted')
    output.mkdir(parents=True, exist_ok=True)
    evidence = output / 'external-auth.json'
    assert not evidence.exists(), 'Use a fresh evidence destination'
    receipt = json.loads((source_app / 'Contents/Resources/build-receipt.json').read_text())
    metadata = {'scope': 'actual-app-system-WK-to-real-system-browser; DOM-driven; local auth doubles',
                'physical_input_qualified': False, 'real_vendor_qualified': False,
                'session': console, 'build_receipt': receipt,
                'engine_sha256': digest(source_app / 'Contents/Resources/nac-web'),
                'native_sha256': digest(source_app / 'Contents/MacOS/NACPreview')}
    (output / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    with tempfile.TemporaryDirectory(prefix='nac-external-auth-app-') as directory:
        app = Path(directory) / source_app.name
        shutil.copytree(source_app, app)
        with AuthFixture() as fixture, (output / 'launch.log').open('wb') as log:
            launch = subprocess.Popen(['/usr/bin/open', '-n', '-W', str(app), '--args',
                '--smoke-output', str(evidence), '--smoke-scenario', 'external-auth',
                '--external-auth-origin', fixture.origin], stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 180
                while launch.poll() is None and time.monotonic() < deadline:
                    time.sleep(.1)
                if launch.poll() is None:
                    raise TimeoutError('Actual external-auth app did not finish within 180 seconds')
                record = json.loads(evidence.read_text())
                if launch.returncode or record.get('passed') is not True:
                    raise AssertionError('Actual external-auth scenario failed; inspect sanitized evidence')
                assert not alive(record.get('engine_pid', 0)), 'Owned engine remains after app stop'
                profile = Path(record['profile'])
                assert not profile.exists(), 'Disposable preview profile remains after app stop'
                snapshot = fixture.snapshot()
                (output / 'browser-observations.json').write_text(json.dumps(snapshot, indent=2) + '\n')
            except BaseException:
                if evidence.exists():
                    cleanup_failed_case(evidence, app)
                raise
            finally:
                # Only our LaunchServices wait client, never the external browser.
                if launch.poll() is None:
                    launch.terminate()
                    launch.wait(timeout=5)
    print(f'Actual external auth evidence: {output}')


if __name__ == '__main__':
    main()
