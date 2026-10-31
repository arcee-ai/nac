#!/bin/bash
# Read-only metadata helper for the existing builder, never a bundle writer.
# The caller supplies the engine-identity.json emitted by its exact bundled
# executable. Ambient NAC_BUILD_TRACK is not a runtime or bundle selection.
nac_bundle_identity() {
    local identity_file="$1" kind="$2" track identifier name bytes
    case "$kind" in normal|instance-smoke) ;; *)
        echo 'Unsupported NAC bundle identity mode.' >&2; return 64 ;;
    esac
    if [[ ! -f "$identity_file" ]]; then
        echo 'The bundled engine identity is unavailable.' >&2; return 65
    fi
    bytes=$(/usr/bin/wc -c < "$identity_file")
    if [[ "$bytes" -gt 16384 ]]; then
        echo 'The bundled engine identity is invalid.' >&2; return 65
    fi
    if ! track=$(/usr/bin/plutil -extract track raw -o - "$identity_file" 2>/dev/null); then
        echo 'The bundled engine identity is invalid.' >&2; return 65
    fi
    case "$track" in
        stable) identifier=ai.arcee.nac; name='NAC' ;;
        beta) identifier=ai.arcee.nac.beta; name='NAC Beta' ;;
        dev) identifier=ai.arcee.nac.dev; name='NAC Development' ;;
        *) echo 'The bundled engine identity has an unsupported track.' >&2; return 65 ;;
    esac
    if [[ "$kind" == instance-smoke ]]; then
        identifier="$identifier.instance-smoke"
        name="$name Instance Smoke"
    fi
    printf '%s\n%s\n' "$identifier" "$name"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    if [[ "$#" != 2 ]]; then
        echo 'usage: BundleIdentity.sh engine-identity.json normal|instance-smoke' >&2
        exit 64
    fi
    nac_bundle_identity "$1" "$2"
fi
