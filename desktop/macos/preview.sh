#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mode="${1:-run}"
case "$mode" in build|run|smoke) ;; *) echo 'usage: preview.sh [build|run|smoke]' >&2; exit 2 ;; esac
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || {
    echo 'The development preview requires Apple Silicon macOS and an Apple Swift SDK.' >&2; exit 1;
}
output="${NAC_MAC_OUTPUT:-$PWD/target/macos-preview}"
mkdir -p "$output"
output="$(cd "$output" && pwd)"
app="$output/NAC Development Preview.app"
if [[ "$mode" == smoke ]]; then app="$output/NAC Development Preview Smoke.app"; fi
if [[ "${NAC_MAC_SKIP_ENGINE_BUILD:-0}" != 1 ]]; then
    cargo build --locked -p nac-server --bin nac-web
fi
engine="${NAC_MAC_ENGINE:-${CARGO_TARGET_DIR:-$PWD/target}/debug/nac-web}"
[[ -x "$engine" ]] || { echo "Missing compiled engine: $engine" >&2; exit 1; }
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp desktop/macos/Info.plist "$app/Contents/Info.plist"
if [[ ! "$engine" -ef "$app/Contents/Resources/nac-web" ]]; then
    cp "$engine" "$app/Contents/Resources/nac-web"
fi
"$app/Contents/Resources/nac-web" __desktop-identity > "$app/Contents/Resources/engine-identity.json"
sources=(desktop/macos/main.swift desktop/macos/PreviewApp.swift desktop/macos/PreviewEngine.swift
         desktop/macos/EngineProtocol.swift
         desktop/macos/PreviewProfile.swift desktop/macos/FixtureProvider.swift desktop/macos/FixtureBootstrap.swift)
flags=(-swift-version 5 -target arm64-apple-macosx14.0 -O)
if [[ "$mode" == smoke ]]; then
    sources+=(desktop/macos/PreviewSmoke.swift)
    flags+=(-D PREVIEW_SMOKE)
fi
xcrun swiftc "${flags[@]}" -framework AppKit -framework WebKit -framework Network \
    "${sources[@]}" -o "$app/Contents/MacOS/NACPreview"
printf '%s\n' "$app"
case "$mode" in
    run) exec /usr/bin/open -n -W "$app" ;;
    smoke)
        xcrun swiftc -swift-version 5 -target arm64-apple-macosx14.0 -O \
            desktop/macos/EngineProtocol.swift desktop/macos/PreviewProfile.swift desktop/macos/ProtocolTests.swift \
            -o "$output/EngineProtocolTests"
        "$output/EngineProtocolTests"
        python3 -B -m unittest discover -s desktop/macos -p 'test_*.py'
        exec python3 desktop/macos/smoke.py "$app" "$output/evidence"
        ;;
esac
