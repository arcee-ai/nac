#!/bin/sh
set -eu
lock=/recipe/sources.lock.json
# Curl retains the existing Wolfi capabilities and restores Debian's NTLM/SCP/SFTP.
# Only this build SDK switches headers; the final image keeps its OpenSSL3 SDK.
apk del openssl-dev
apk add --no-cache openssl-4.0-dev libssh2-dev brotli-dev libpsl-dev zstd-dev \
    nghttp2-dev nghttp3-dev ngtcp2-dev
mkdir -p /work/curl /packages/libcurl-openssl4/usr/lib /packages/curl/usr/bin
tar -xJf /work/downloads/curl.tar.xz -C /work/curl --strip-components=1
cd /work/curl
CFLAGS='-DOPENSSL_NO_ENGINE -D_GNU_SOURCE' ./configure \
    --prefix=/usr --libdir=/usr/lib --disable-static --enable-ipv6 \
    --enable-kerberos-auth --enable-negotiate-auth --with-gssapi \
    --enable-unix-sockets --with-openssl --without-rustls \
    --with-nghttp2 --with-nghttp3 --with-ngtcp2 --with-pic \
    --enable-ldap --enable-ntlm --with-libssh2 --with-libpsl --with-zstd
make -j2
make DESTDIR=/stage/curl install
cp -a /stage/curl/usr/lib/libcurl.so.* /packages/libcurl-openssl4/usr/lib/
install -m 0755 /stage/curl/usr/bin/curl /packages/curl/usr/bin/curl
install -m 0755 scripts/wcurl /packages/curl/usr/bin/wcurl
