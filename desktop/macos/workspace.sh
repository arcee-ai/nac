#!/bin/bash
# ALL-351 test-only bundle; caller owns the shared-host Rust admission lease.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${NAC_MAC_ENGINE:?Supply a private exact-revision nac-web copied under the Rust lease}"
export NAC_MAC_SKIP_ENGINE_BUILD=1
export NAC_MAC_OUTPUT="${NAC_MAC_OUTPUT:-$PWD/target/all-351/candidate}"
./desktop/macos/preview.sh build
app="$NAC_MAC_OUTPUT/NAC Development Preview.app"
cp "$app/Contents/MacOS/NACPreview" "$NAC_MAC_OUTPUT/normal-preview"
python3 -B - "$NAC_MAC_OUTPUT/normal-preview" <<'PY'
from pathlib import Path
import sys
data = Path(sys.argv[1]).read_bytes()
for marker in (b'WK_RICH_COMPLETE', b'workspace-legacy', b'--smoke-output'):
    if marker in data:
        raise SystemExit('Smoke instrumentation leaked into normal native executable')
PY
xcrun swiftc -swift-version 5 -target arm64-apple-macosx14.0 -O -D PREVIEW_SMOKE \
    -framework AppKit -framework WebKit -framework Network \
    desktop/macos/main.swift desktop/macos/PreviewApp.swift desktop/macos/PreviewEngine.swift \
    desktop/macos/PreviewProfile.swift desktop/macos/FixtureProvider.swift desktop/macos/FixtureBootstrap.swift \
    desktop/macos/PreviewSmoke.swift desktop/macos/WorkspaceSmoke.swift desktop/macos/WorkspaceFixture.swift \
    desktop/macos/WorkspaceJourneys.swift desktop/macos/WorkspaceLegacy.swift \
    -o "$app/Contents/MacOS/NACPreview"
python3 -B desktop/macos/workspace.py capture-build "$app"
