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
