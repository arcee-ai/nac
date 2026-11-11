#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mode="${1:-run}"
case "$mode" in build|run|smoke|smoke-build|smoke-prepare|app-build|app-run|startup-build|startup-smoke|instance-build|instance-smoke|lifecycle-build|auth-build|attention-build) ;; *) echo 'usage: preview.sh [build|run|smoke|smoke-build|smoke-prepare|app-build|app-run|startup-build|startup-smoke|instance-build|instance-smoke|lifecycle-build|auth-build|attention-build]' >&2; exit 2 ;; esac
local_app=0
case "$mode" in app-*|startup-*|instance-*|lifecycle-*|auth-build|attention-*) local_app=1 ;; esac
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || {
    echo 'The development preview requires Apple Silicon macOS and an Apple Swift SDK.' >&2; exit 1;
}
output="${NAC_MAC_OUTPUT:-$PWD/target/macos-preview}"
mkdir -p "$output"
output="$(cd "$output" && pwd)"
app="$output/NAC Development Preview.app"
if [[ "$mode" == smoke || "$mode" == smoke-build || "$mode" == smoke-prepare ]]; then app="$output/NAC Development Preview Smoke.app"; fi
if [[ "$mode" == app-* ]]; then app="$output/NAC.app"; fi
if [[ "$mode" == startup-* ]]; then app="$output/NAC Startup Smoke.app"; fi
if [[ "$mode" == instance-* ]]; then app="$output/NAC Instance Smoke.app"; fi
if [[ "$mode" == lifecycle-* ]]; then app="$output/NAC Lifecycle Smoke.app"; fi
if [[ "$mode" == auth-build ]]; then app="$output/NAC Auth Fixture.app"; fi
if [[ "$mode" == attention-* ]]; then app="$output/NAC Attention Smoke.app"; fi
if [[ "${NAC_MAC_SKIP_ENGINE_BUILD:-0}" != 1 ]]; then
    # Scope fixture metadata to this Cargo child. Never export it to a later build.
    engine_environment=(env -u NAC_BUILD_ID -u NAC_SOURCE_REVISION
                        -u NAC_NATIVE_AUTH_FIXTURE_ROOT -u NAC_NATIVE_AUTH_FIXTURE_ORIGIN)
    if [[ "$mode" == auth-build ]]; then
        fixture_source=$(git rev-parse --verify HEAD)
        engine_environment+=(NAC_BUILD_TRACK=dev "NAC_BUILD_ID=native-auth-fixture-v1-${fixture_source}")
        "${engine_environment[@]}" cargo build --locked -p nac-server --bin nac-web --features native-auth-fixture
    else
        "${engine_environment[@]}" cargo build --locked -p nac-server --bin nac-web
    fi
fi
engine="${NAC_MAC_ENGINE:-${CARGO_TARGET_DIR:-$PWD/target}/debug/nac-web}"
[[ -x "$engine" ]] || { echo "Missing compiled engine: $engine" >&2; exit 1; }
# Inspect the actual selected executable before replacing ANY bundle artifact.
# Fixture classification retains the existing strict four-field identity.
engine_identity=$("$engine" __desktop-identity)
engine_build_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["build_id"])' <<< "$engine_identity")
engine_track=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["track"])' <<< "$engine_identity")
fixture_engine=0
case "$engine_build_id" in native-auth-fixture-v1-*) fixture_engine=1 ;; esac
if [[ "$mode" == auth-build ]]; then
    [[ "$fixture_engine" == 1 && "$engine_track" == dev ]] || { echo 'Auth mode requires its exact dev fixture engine.' >&2; exit 1; }
elif [[ "$fixture_engine" == 1 ]]; then
    echo 'Normal app modes reject the isolated auth-fixture engine.' >&2; exit 1
fi
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp desktop/macos/Info.plist "$app/Contents/Info.plist"
# Only LOCAL_APP compiles NACApplication. Preview keeps the system class.
if [[ "$local_app" == 1 ]]; then
    /usr/libexec/PlistBuddy -c 'Add :NSPrincipalClass string NACApplication' "$app/Contents/Info.plist"
else
    /usr/libexec/PlistBuddy -c 'Add :NSPrincipalClass string NSApplication' "$app/Contents/Info.plist"
fi
if [[ "$mode" == startup-* ]]; then
    /usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier ai.arcee.nac.local-development' "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c 'Set :CFBundleName NAC' "$app/Contents/Info.plist"
fi
if [[ "$mode" == auth-build ]]; then
    /usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier ai.arcee.nac.native-auth-fixture' "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c 'Set :CFBundleName NAC Auth Fixture' "$app/Contents/Info.plist"
fi
if [[ ! "$engine" -ef "$app/Contents/Resources/nac-web" ]]; then
    cp "$engine" "$app/Contents/Resources/nac-web"
fi
printf '%s\n' "$engine_identity" > "$app/Contents/Resources/engine-identity.json"
if [[ "$mode" == app-* || "$mode" == instance-* || "$mode" == lifecycle-* || "$mode" == attention-* ]]; then
    identity_kind=normal
    if [[ "$mode" == instance-* ]]; then identity_kind=instance-smoke; fi
    if [[ "$mode" == lifecycle-* || "$mode" == attention-* ]]; then identity_kind=instance-smoke; fi
    bundle_identity=$(bash desktop/macos/BundleIdentity.sh "$app/Contents/Resources/engine-identity.json" "$identity_kind")
    bundle_identifier="${bundle_identity%%$'\n'*}"
    bundle_name="${bundle_identity#*$'\n'}"
    /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_identifier" "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleName $bundle_name" "$app/Contents/Info.plist"
    if [[ "$mode" == lifecycle-* ]]; then
        /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_identifier.lifecycle" "$app/Contents/Info.plist"
    fi
    if [[ "$mode" == attention-* ]]; then
        /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_identifier.attention" "$app/Contents/Info.plist"
    fi
fi
sources=(desktop/macos/main.swift desktop/macos/PreviewApp.swift desktop/macos/PreviewEngine.swift
         desktop/macos/EngineProtocol.swift desktop/macos/EngineFailure.swift
         desktop/macos/NativeCommands.swift desktop/macos/NativeCommandState.swift
         desktop/macos/NativeCommandScript.swift desktop/macos/NativeCommandBridge.swift
         desktop/macos/NativeSessionTarget.swift
         desktop/macos/WorkspaceRecovery.swift desktop/macos/WorkspaceRetirement.swift
         desktop/macos/WorkspaceReadiness.swift
          desktop/macos/WorkspaceCheckpoint.swift desktop/macos/WorkspaceStorage.swift
          desktop/macos/WorkspaceNotificationState.swift
          desktop/macos/WorkspaceStorageBridge.swift desktop/macos/WorkspaceStorageScript.swift
         desktop/macos/ExternalNavigation.swift
         desktop/macos/NativeFolderSelection.swift desktop/macos/NativeFolderPanel.swift
         desktop/macos/NativePathRequest.swift desktop/macos/NativePathScript.swift desktop/macos/NativePathBridge.swift
         desktop/macos/CommandEnvironment.swift desktop/macos/DesktopStartup.swift)
flags=(-swift-version 5 -target arm64-apple-macosx14.0 -O -framework AppKit -framework WebKit)
if [[ "$local_app" == 1 ]]; then
    sources+=(desktop/macos/AppInstance.swift desktop/macos/StoreConflict.swift
              desktop/macos/AppLifecycle.swift desktop/macos/AppQuit.swift
              desktop/macos/AttentionFeedProtocol.swift desktop/macos/AttentionCompletions.swift
              desktop/macos/AttentionProjection.swift
              desktop/macos/NativeAttentionObserver.swift
              desktop/macos/NativeAttentionIndicator.swift
              desktop/macos/NativeAttentionDelivery.swift desktop/macos/NativeNotificationCenter.swift
              desktop/macos/NativeAttentionMenu.swift desktop/macos/NativeAttentionCoordinator.swift)
    flags+=(-D LOCAL_APP -framework UserNotifications)
else
    sources+=(desktop/macos/PreviewProfile.swift desktop/macos/FixtureProvider.swift desktop/macos/FixtureBootstrap.swift)
    flags+=(-framework Network)
fi
if [[ "$mode" == smoke || "$mode" == smoke-build || "$mode" == smoke-prepare ]]; then
    sources+=(desktop/macos/PreviewSmoke.swift desktop/macos/CITerminal.swift desktop/macos/NativeCommandSmoke.swift desktop/macos/NativeCommandInput.swift desktop/macos/RecoverySmoke.swift desktop/macos/ExternalNavigationSmoke.swift desktop/macos/ExternalAuthSmoke.swift desktop/macos/NativePathSmoke.swift desktop/macos/WorkspaceSmoke.swift desktop/macos/WorkspaceFixture.swift desktop/macos/WorkspaceJourneys.swift desktop/macos/WorkspaceLegacy.swift)
    sources+=(desktop/macos/OfflineProviderPolicy.swift desktop/macos/OfflineNetworkFence.swift
              desktop/macos/OfflineWebProbe.swift desktop/macos/OfflineProviderSmoke.swift desktop/macos/OfflineHTTPControlTarget.swift)
    flags+=(-D PREVIEW_SMOKE -framework IOKit)
fi
if [[ "$mode" == startup-* ]]; then
    sources+=(desktop/macos/StartupSmoke.swift)
    flags+=(-D PREVIEW_SMOKE)
fi
if [[ "$mode" == auth-build ]]; then
    sources+=(desktop/macos/DeviceAuthSmoke.swift)
    flags+=(-D PREVIEW_SMOKE -D NATIVE_AUTH_FIXTURE)
fi
if [[ "$mode" == instance-* ]]; then
    sources+=(desktop/macos/InstanceSmoke.swift)
    flags+=(-D PREVIEW_SMOKE -D INSTANCE_SMOKE)
fi
if [[ "$mode" == lifecycle-* ]]; then
    sources+=(desktop/macos/LifecycleSmoke.swift desktop/macos/RecoverySmoke.swift)
    flags+=(-D PREVIEW_SMOKE -D LIFECYCLE_SMOKE)
fi
if [[ "$mode" == attention-* ]]; then
    sources+=(desktop/macos/AttentionSmoke.swift desktop/macos/AttentionFixtureGuard.swift)
    flags+=(-D PREVIEW_SMOKE -D ATTENTION_SMOKE -framework IOKit)
fi
receipt_inputs="$output/build-inputs-$mode.json"
python3 -B desktop/macos/build_receipt.py capture "$receipt_inputs" "$app" "$mode" "${flags[@]}" -- "${sources[@]}"
xcrun swiftc "${flags[@]}" \
    "${sources[@]}" -o "$app/Contents/MacOS/NACPreview"
python3 -B desktop/macos/build_receipt.py finish "$receipt_inputs" "$app"
printf '%s\n' "$app"
case "$mode" in
    run) exec /usr/bin/open -n -W "$app" ;;
    app-run) exec /usr/bin/open -W "$app" ;;
    instance-build|instance-smoke|lifecycle-build|attention-build)
        xcrun swiftc -parse-as-library -swift-version 5 -target arm64-apple-macosx14.0 -O \
            -framework AppKit desktop/macos/InstanceObservation.swift -o "$output/InstanceObservation"
        if [[ "$mode" == attention-build ]]; then
            xcrun swiftc -parse-as-library -swift-version 5 -target arm64-apple-macosx14.0 -O \
                -framework WebKit desktop/macos/EngineProtocol.swift desktop/macos/EngineFailure.swift \
                desktop/macos/CommandEnvironment.swift desktop/macos/DesktopStartup.swift \
                desktop/macos/WorkspaceCheckpoint.swift desktop/macos/WorkspaceStorage.swift \
                desktop/macos/WorkspaceNotificationState.swift desktop/macos/AttentionFixtureRoot.swift \
                desktop/macos/AttentionFixtureCleanup.swift \
                -o "$output/AttentionFixtureCleanup"
        fi
        if [[ "$mode" == instance-smoke ]]; then
            instance_arguments=("$app" "$output/instance-evidence" "$output/InstanceObservation")
            if [[ -n "${NAC_MAC_STABLE_APP:-}" ]]; then instance_arguments+=("$NAC_MAC_STABLE_APP"); fi
            exec python3 -B desktop/macos/instance_smoke.py "${instance_arguments[@]}"
        fi
        ;;
    startup-smoke) exec python3 -B desktop/macos/startup_smoke.py "$app" "$output/startup-evidence" ;;
    smoke|smoke-prepare)
        xcrun swiftc -swift-version 5 -target arm64-apple-macosx14.0 -O \
            desktop/macos/EngineProtocol.swift desktop/macos/EngineFailure.swift desktop/macos/ProtocolTests.swift \
            -o "$output/EngineProtocolTests"
        "$output/EngineProtocolTests"
        xcrun swiftc -swift-version 5 -target arm64-apple-macosx14.0 -O \
            desktop/macos/EngineProtocol.swift desktop/macos/EngineFailure.swift \
            desktop/macos/NativeCommandState.swift desktop/macos/NativeCommandStateTests.swift \
            -o "$output/NativeCommandStateTests"
        "$output/NativeCommandStateTests"
        python3 -B -m unittest discover -s desktop/macos -p 'test_*.py'
        if [[ "$mode" == smoke ]]; then
            exec python3 -B desktop/macos/smoke.py "$app" "$output/evidence"
        fi
        ;;
esac
