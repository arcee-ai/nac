#!/usr/bin/env python3
"""Actual .app/system-WK recording-only characterization; no browser acceptance.

Requires the shared browser lease and common builder's named recording hook.
The named PREVIEW_SMOKE scenario bypasses NSWorkspace explicitly, and records
system_browser_qualified=false. It does not synthesize OS input.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

from smoke import alive, cleanup_failed_case, session_lock_state


def main():
    source_app, output = (Path(argument).resolve() for argument in sys.argv[1:])
    output.mkdir(parents=True, exist_ok=True)
    evidence = output / 'external-navigation-recording.json'
    assert not evidence.exists(), 'Use a fresh evidence destination'
    receipt = json.loads((source_app / 'Contents/Resources/build-receipt.json').read_text())
    with (source_app / 'Contents/MacOS/NACPreview').open('rb') as file:
        native_hash = hashlib.file_digest(file, 'sha256').hexdigest()
    metadata = {'scope': 'actual-app/system-WK; recording-opener-only', 'system_browser_qualified': False,
                'physical_input_qualified': False, 'session': session_lock_state(),
                'build_receipt': receipt, 'native_sha256': native_hash}
    (output / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    with tempfile.TemporaryDirectory(prefix='nac-external-navigation-app-') as directory:
        app = Path(directory) / source_app.name
        shutil.copytree(source_app, app)
        with (output / 'launch.log').open('wb') as log:
            launch = subprocess.Popen(['/usr/bin/open', '-n', '-W', str(app), '--args',
                '--smoke-output', str(evidence), '--smoke-scenario', 'external-navigation-recording'],
                stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 120
                while launch.poll() is None and time.monotonic() < deadline:
                    time.sleep(.1)
                if launch.poll() is None:
                    raise TimeoutError('Recording-only app did not finish within 120 seconds')
                record = json.loads(evidence.read_text())
                result = record.get('external_navigation_recording', {})
                assert launch.returncode == 0 and record.get('passed') is True, 'Recording fixture failed'
                assert result.get('system_browser_qualified') is False
                assert result.get('navigation', {}).get('recording_only') is True
                assert not alive(record.get('engine_pid', 0)), 'Owned engine remains after app stop'
                assert not Path(record['profile']).exists(), 'Disposable profile remains after app stop'
            except BaseException:
                if evidence.exists():
                    cleanup_failed_case(evidence, app)
                raise
            finally:
                if launch.poll() is None:
                    launch.terminate()
                    launch.wait(timeout=5)
    print(f'Recording-only WK evidence (system browser unqualified): {output}')


if __name__ == '__main__':
    main()
