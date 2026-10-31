#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mode="${1:-run}"
case "$mode" in build|run|smoke|app-build|app-run|startup-build|startup-smoke) ;; *) echo 'usage: preview.sh [build|run|smoke|app-build|app-run|startup-build|startup-smoke]' >&2; exit 2 ;; esac
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || {
    echo 'The development preview requires Apple Silicon macOS and an Apple Swift SDK.' >&2; exit 1;
}
output="${NAC_MAC_OUTPUT:-$PWD/target/macos-preview}"
mkdir -p "$output"
output="$(cd "$output" && pwd)"
app="$output/NAC Development Preview.app"
if [[ "$mode" == smoke ]]; then app="$output/NAC Development Preview Smoke.app"; fi
if [[ "$mode" == app-* ]]; then app="$output/NAC.app"; fi
if [[ "$mode" == startup-* ]]; then app="$output/NAC Startup Smoke.app"; fi
if [[ "${NAC_MAC_SKIP_ENGINE_BUILD:-0}" != 1 ]]; then
    cargo build --locked -p nac-server --bin nac-web
fi
engine="${NAC_MAC_ENGINE:-${CARGO_TARGET_DIR:-$PWD/target}/debug/nac-web}"
[[ -x "$engine" ]] || { echo "Missing compiled engine: $engine" >&2; exit 1; }
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp desktop/macos/Info.plist "$app/Contents/Info.plist"
if [[ "$mode" == app-* || "$mode" == startup-* ]]; then
    /usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier ai.arcee.nac.local-development' "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c 'Set :CFBundleName NAC' "$app/Contents/Info.plist"
fi
if [[ ! "$engine" -ef "$app/Contents/Resources/nac-web" ]]; then
    cp "$engine" "$app/Contents/Resources/nac-web"
fi
engine_identity=$("$app/Contents/Resources/nac-web" __desktop-identity)
printf '%s\n' "$engine_identity" > "$app/Contents/Resources/engine-identity.json"
sources=(desktop/macos/main.swift desktop/macos/PreviewApp.swift desktop/macos/PreviewEngine.swift
         desktop/macos/EngineProtocol.swift
         desktop/macos/CommandEnvironment.swift desktop/macos/DesktopStartup.swift
         desktop/macos/PreviewProfile.swift desktop/macos/FixtureProvider.swift desktop/macos/FixtureBootstrap.swift)
flags=(-swift-version 5 -target arm64-apple-macosx14.0 -O)
if [[ "$mode" == smoke ]]; then
    sources+=(desktop/macos/PreviewSmoke.swift)
    flags+=(-D PREVIEW_SMOKE)
fi
if [[ "$mode" == app-* || "$mode" == startup-* ]]; then flags+=(-D LOCAL_APP); fi
if [[ "$mode" == startup-* ]]; then
    sources+=(desktop/macos/StartupSmoke.swift)
    flags+=(-D PREVIEW_SMOKE)
fi
receipt_inputs="$output/build-inputs-$mode.json"
python3 -B desktop/macos/build_receipt.py capture "$receipt_inputs" "$app" "$mode" "${flags[@]}" -- "${sources[@]}"
xcrun swiftc "${flags[@]}" -framework AppKit -framework WebKit -framework Network \
    "${sources[@]}" -o "$app/Contents/MacOS/NACPreview"
python3 -B desktop/macos/build_receipt.py finish "$receipt_inputs" "$app"
printf '%s\n' "$app"
case "$mode" in
    run) exec /usr/bin/open -n -W "$app" ;;
    app-run) exec /usr/bin/open -n -W "$app" ;;
    startup-smoke) exec python3 -B desktop/macos/startup_smoke.py "$app" "$output/startup-evidence" ;;
    smoke)
        xcrun swiftc -swift-version 5 -target arm64-apple-macosx14.0 -O \
            desktop/macos/EngineProtocol.swift desktop/macos/PreviewProfile.swift desktop/macos/ProtocolTests.swift \
            -o "$output/EngineProtocolTests"
        "$output/EngineProtocolTests"
        python3 -B -m unittest discover -s desktop/macos -p 'test_*.py'
        exec python3 -B desktop/macos/smoke.py "$app" "$output/evidence"
        ;;
esac
