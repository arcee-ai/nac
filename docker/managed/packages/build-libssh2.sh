#!/bin/sh
set -eu
# Keep the existing OpenSSL4 supplier ABI and all prior supplier corrections.
apk add --no-cache bash libtool openssh-client openssh-server zlib-dev
mkdir -p /work/libssh2 /work/libssh2-debian /packages/libssh2/usr/lib
tar -xzf /work/downloads/libssh2.tar.gz -C /work/libssh2 --strip-components=1
tar -xJf /work/downloads/libssh2-debian.tar.xz -C /work/libssh2-debian
cd /work/libssh2
# The official release tarball has the release header; the same tag's Git
# snapshot still declares 1.11.1_DEV. Never manufacture a release banner.
grep -Fx '#define LIBSSH2_VERSION "1.11.1"' include/libssh2.h
for name in CVE-2026-7598 CVE-2026-55199; do
    patch -p1 --batch --fuzz=0 -i "/work/libssh2-debian/debian/patches/$name.patch"
done
patch -p1 --batch --fuzz=0 -i /work/downloads/libssh2-supplier-55200.patch
patch -p1 --batch --fuzz=0 -i /work/downloads/libssh2-supplier-sftp.patch
# Keep the four inherited supplier fixes independently visible. Exact source
# hashes below bind the completed tree; these controls also require each
# corrected guard and prove that reversing its supplier patch removes it.
# Run before the six newer fixes, which also edit some of these source files.
verify_supplier_correction() {
    case_id=$1 source_file=$2 patch_file=$3 expected_count=$4
    shift 4
    for guard in "$@"; do
        found_count=$(grep -Fc "$guard" "$source_file" || true)
        if [ "$found_count" -ne "$expected_count" ]; then
            printf '%s: expected %s corrected source guard(s), got %s: %s\n' \
                "$case_id" "$expected_count" "$found_count" "$guard" >&2
            return 1
        fi
    done
    reversed_dir=$(mktemp -d)
    mkdir -p "$reversed_dir/$(dirname "$source_file")"
    cp "$source_file" "$reversed_dir/$source_file"
    (cd "$reversed_dir" && patch -p1 --batch --fuzz=0 -R -i "$patch_file")
    for guard in "$@"; do
        reversed_count=$(grep -Fc "$guard" "$reversed_dir/$source_file" || true)
        if [ "$reversed_count" -ne "$((expected_count - 1))" ]; then
            printf '%s: reversed source has %s guard(s), expected %s: %s\n' \
                "$case_id" "$reversed_count" "$((expected_count - 1))" "$guard" >&2
            return 1
        fi
    done
    rm -r "$reversed_dir"
    printf '%s: corrected and reversed source controls passed\n' "$case_id"
}
verify_supplier_correction CVE-2026-7598 src/userauth.c \
    /work/libssh2-debian/debian/patches/CVE-2026-7598.patch 1 \
    'if(username_len > UINT32_MAX - 27) {' \
    'if(username_len > UINT32_MAX - 40) {' \
    'if(username_len <= UINT32_MAX - password_len - 44) {'
verify_supplier_correction CVE-2026-55199 src/packet.c \
    /work/libssh2-debian/debian/patches/CVE-2026-55199.patch 1 \
    'if(_libssh2_get_string(&buf, &name, &name_len))' \
    'if(_libssh2_get_string(&buf, &value, &value_len))'
verify_supplier_correction CVE-2026-55200 src/transport.c \
    /work/downloads/libssh2-supplier-55200.patch 2 \
    'else if(p->packet_length > LIBSSH2_PACKET_MAXPAYLOAD) {'
verify_supplier_correction CVE-2025-15661 src/sftp.c \
    /work/downloads/libssh2-supplier-sftp.patch 1 \
    'if(_libssh2_get_byte(&buf, &packet_type)) {' \
    'if(_libssh2_get_u32(&buf, &tmp_u32) || tmp_u32 < 1) {' \
    'if(_libssh2_get_string(&buf, &lk_target, &lk_len) == LIBSSH2_ERROR_NONE) {'
for name in CVE-2026-66032 CVE-2026-66033 CVE-2026-66034 CVE-2026-66035 CVE-2026-58050 CVE-2026-58051; do
    patch -p1 --batch --fuzz=0 -i "/work/libssh2-debian/debian/patches/$name.patch"
done
jq -r '.libssh2.downstream_fixes[] | [.sha256, ("/recipe/" + .patch)] | join("  ")' \
    /recipe/sources.lock.json | sha256sum -c -
patch -p1 --batch --fuzz=0 -i /recipe/libssh2-list-followups.patch
patch -p1 --batch --fuzz=0 -i /recipe/libssh2-pointer-followup.patch
jq -r '.libssh2.reviewed_source_files | to_entries[] | [.value, .key] | join("  ")' \
    /recipe/sources.lock.json | sha256sum -c -
# All corrections touch C sources only. Use the checksum-bound official release
# configure/Makefile inputs; regeneration needlessly imports host gettext data.
./configure --prefix=/usr --libdir=/usr/lib --with-crypto=openssl --disable-docker-tests
make -j2
# Seam-level malformed-input regressions for the six corrections applied above.
# Compiled against the patched tree and run here; never installed or shipped.
# Each case drives the corrected seam with the input shape the correction
# rejects, so a dropped or reverted patch fails the build instead of silently
# restoring the pre-patch behaviour.
gcc -DHAVE_CONFIG_H -I. -Isrc -Iinclude -Wl,--allow-multiple-definition \
    -o /tmp/libssh2-regressions /recipe/libssh2-regressions.c \
    src/publickey.c src/misc.c src/sftp.c src/.libs/libssh2.a -lcrypto -lz
/tmp/libssh2-regressions
# Ordinary upstream standalone and local OpenSSH tests. No new attack fixtures.
mkdir -p /run/sshd
# Public upstream fixture keys authenticate only the disposable build account.
# The runtime is a separate FROM and inherits none of this test configuration.
passwd -d root
USER=root LOGNAME=root make check
make DESTDIR=/stage/libssh2 install
cp -a /stage/libssh2/usr/lib/libssh2.so.* /packages/libssh2/usr/lib/
readelf -d /packages/libssh2/usr/lib/libssh2.so.1 | grep -F 'libcrypto.so.4'
sh /recipe/test-libssh2-consumers.sh
