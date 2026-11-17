#!/bin/bash
# The standalone smoke command and hosted CI share these exact Swift controls.
set -euo pipefail
cd "$(dirname "$0")/../.."
output="${1:?Expected the private smoke output directory}"
mkdir -p "$output"
xcrun swiftc -swift-version 5 -target arm64-apple-macosx14.0 -O \
    desktop/macos/EngineProtocol.swift desktop/macos/EngineFailure.swift desktop/macos/ProtocolTests.swift \
    -o "$output/EngineProtocolTests"
"$output/EngineProtocolTests"
xcrun swiftc -swift-version 5 -target arm64-apple-macosx14.0 -O \
    desktop/macos/EngineProtocol.swift desktop/macos/EngineFailure.swift \
    desktop/macos/NativeCommandState.swift desktop/macos/NativeCommandStateTests.swift \
    -o "$output/NativeCommandStateTests"
"$output/NativeCommandStateTests"
