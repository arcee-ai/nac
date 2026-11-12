#!/bin/sh
set -eu
# Run fixed and exact single-patch-reversed objects against the same reviewed
# library. Probe allocators stop before oversized input can be copied or used.
mode=${1:?usage: test-libssh2-supplier-controls.sh amd64|i386}
case "$mode" in
    amd64)
        test "$(uname -m)" = x86_64
        cases='7598 55199'
        flags='-g -fsanitize=address -fno-omit-frame-pointer'
        ;;
    i386)
        # The 55200 probe checks sizeof(size_t) after compilation; uname may
        # report the host kernel's architecture under emulation.
        cases='55200'
        flags='-g'
        ;;
    *) echo "unsupported architecture: $mode" >&2; exit 2 ;;
esac

cd /work/libssh2
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' 0
for case_id in $cases; do
    case "$case_id" in
        7598)
            source_file=userauth.c
            patch_file=/work/libssh2-debian/debian/patches/CVE-2026-7598.patch
            ;;
        55199)
            source_file=packet.c
            patch_file=/work/libssh2-debian/debian/patches/CVE-2026-55199.patch
            ;;
        55200)
            source_file=transport.c
            patch_file=/work/downloads/libssh2-supplier-55200.patch
            ;;
    esac
    mkdir -p "$scratch/$case_id/src"
    cp "src/$source_file" "$scratch/$case_id/src/$source_file"
    (cd "$scratch/$case_id" && patch -p1 --batch --fuzz=0 -R -i "$patch_file")
    for variant in fixed reversed; do
        if [ "$variant" = fixed ]; then
            source="src/$source_file"
        else
            source="$scratch/$case_id/src/$source_file"
        fi
        # The explicit source object precedes the reviewed static library.
        # The library supplies other libssh2 symbols but cannot mask this seam.
        # Shell splitting is intentional for fixed, local compiler flags.
        # shellcheck disable=SC2086
        gcc $flags -DHAVE_CONFIG_H -I. -Isrc -Iinclude \
            -Wl,--allow-multiple-definition \
            -o "$scratch/$case_id/$variant" \
            "/recipe/libssh2-supplier-$case_id.c" "$source" \
            src/.libs/libssh2.a -lcrypto -lz
        rc=0
        "$scratch/$case_id/$variant" || rc=$?
        if [ "$variant" = fixed ]; then
            expected=0
        else
            expected=1
        fi
        if [ "$rc" -ne "$expected" ]; then
            printf 'CVE-2026-%s %s: expected probe exit %s, got %s\n' \
                "$case_id" "$variant" "$expected" "$rc" >&2
            exit 1
        fi
    done
    printf 'CVE-2026-%s: fixed-pass / exact-patch-reversed bounded behavior passed (%s)\n' \
        "$case_id" "$mode"
done
