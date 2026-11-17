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
# The current app writer owns the complete compiler inputs and receipt v1.
# Keep the ordinary preview intact; workspace instrumentation has its own bundle.
./desktop/macos/preview.sh smoke-build
smoke_app="$NAC_MAC_OUTPUT/NAC Development Preview Smoke.app"
python3 -B desktop/macos/workspace.py capture-build "$smoke_app"
