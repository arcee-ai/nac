#!/bin/bash
# ALL-352 output characterization. Never injects OS events or changes input sources.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${NAC_MAC_ENGINE:?Supply a private exact-revision nac-web copied inside the shared Rust lease}"
export NAC_MAC_SKIP_ENGINE_BUILD=1
export NAC_MAC_OUTPUT="${NAC_MAC_OUTPUT:-$PWD/target/all-352/candidate}"
./desktop/macos/preview.sh build
app="$NAC_MAC_OUTPUT/NAC Development Preview.app"
cp "$app/Contents/MacOS/NACPreview" "$NAC_MAC_OUTPUT/normal-preview"
sources=(desktop/macos/main.swift desktop/macos/PreviewApp.swift desktop/macos/PreviewEngine.swift
    desktop/macos/PreviewProfile.swift desktop/macos/FixtureProvider.swift desktop/macos/FixtureBootstrap.swift
    desktop/macos/PreviewSmoke.swift desktop/macos/WorkspaceSmoke.swift desktop/macos/WorkspaceFixture.swift
    desktop/macos/WorkspaceJourneys.swift desktop/macos/WorkspaceLegacy.swift)
flags=(-swift-version 5 -target arm64-apple-macosx14.0 -O -framework AppKit -framework WebKit -framework Network)
xcrun swiftc "${flags[@]}" -D PREVIEW_SMOKE "${sources[@]}" -o "$NAC_MAC_OUTPUT/ordinary-smoke"
python3 -B - "$NAC_MAC_OUTPUT" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1])
for name in ('normal-preview', 'ordinary-smoke'):
    data=(root/name).read_bytes()
    for marker in (b'WK-UNICODE:', b'__terminal352', b'wk-overflow.done'):
        if marker in data:
            raise SystemExit(f'Terminal fixture leaked into {name}')
if b'--smoke-output' in (root/'normal-preview').read_bytes():
    raise SystemExit('Smoke instrumentation leaked into normal preview')
PY
xcrun swiftc "${flags[@]}" -D PREVIEW_SMOKE -D TERMINAL_SMOKE "${sources[@]}" \
    desktop/macos/TerminalSmoke.swift desktop/macos/TerminalJourneys.swift desktop/macos/TerminalFixture.swift \
    -o "$app/Contents/MacOS/NACPreview"
python3 -B desktop/macos/terminal.py capture-build "$app"
printf '%s\n' "Run under the browser lease: python3 -B desktop/macos/terminal.py run '$app' FRESH_OUTPUT_DIRECTORY"
