#!/usr/bin/env python3
"""Unsigned compiler-output provenance for the outer packaging owner."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def head():
    return subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()


def main():
    action, snapshot = sys.argv[1], Path(sys.argv[2])
    if action == 'capture':
        app, mode = Path(sys.argv[3]), sys.argv[4]
        separator = sys.argv.index('--', 5)
        flags, sources = sys.argv[5:separator], sys.argv[separator + 1:]
        identity = json.loads((app / 'Contents/Resources/engine-identity.json').read_text())
        source_head = head()
        if identity['source_revision'] != source_head:
            raise SystemExit('Bundled engine source differs from the native checkout; rebuild from this exact source.')
        receipt = {
            'version': 1, 'phase': 'unsigned-build', 'mode': mode,
            'normal_startup': 'LOCAL_APP' in flags, 'smoke_instrumentation': 'PREVIEW_SMOKE' in flags,
            'source_head': source_head,
            'source_dirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], text=True)),
            'compiler_flags': flags,
            'native_source_files': {path: digest(path) for path in sources},
            'engine_identity': identity,
            'engine_sha256': digest(app / 'Contents/Resources/nac-web'),
            'info_plist_sha256': digest(app / 'Contents/Info.plist'),
            'sdk_version': subprocess.check_output(['xcrun', '--show-sdk-version'], text=True).strip(),
            'os_qualification': 'not_established_by_compilation',
        }
        snapshot.write_text(json.dumps(receipt, indent=2) + '\n')
    elif action == 'finish':
        receipt = json.loads(snapshot.read_text())
        app = Path(sys.argv[3])
        if head() != receipt['source_head'] or any(digest(path) != expected for path, expected in receipt['native_source_files'].items()):
            raise SystemExit('Native source changed while building; discard this artifact and rebuild.')
        if digest(app / 'Contents/Resources/nac-web') != receipt['engine_sha256']:
            raise SystemExit('Bundled engine changed while compiling the native owner.')
        receipt['native_sha256'] = digest(app / 'Contents/MacOS/NACPreview')
        (app / 'Contents/Resources/build-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    else:
        raise SystemExit('usage: build_receipt.py capture|finish snapshot app ...')


if __name__ == '__main__':
    main()
