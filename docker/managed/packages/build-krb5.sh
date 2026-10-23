#!/bin/sh
set -eu
lock=/recipe/sources.lock.json
mkdir -p /work/krb5 /packages/krb5-libs/usr/lib
tar -xzf /work/downloads/krb5.tar.gz -C /work/krb5 --strip-components=1
cd /work/krb5
jq -r '.krb5.patches[]' "$lock" | while IFS= read -r patch; do
    patch --batch --fuzz=0 -p1 < "/work/downloads/$patch"
done
cd src
autoreconf -vfi
CPPFLAGS='-fPIC -I/usr/include/et' ./configure \
    --prefix=/usr --libdir=/usr/lib --localstatedir=/var/lib \
    --enable-shared --disable-static --disable-nls --disable-rpath \
    --with-crypto-impl=openssl --with-tls-impl=openssl \
    --with-system-et --with-system-ss --with-system-verto --with-ldap --with-keyutils \
    --sbindir=/usr/bin || { tail -n 200 config.log; exit 1; }
make -j2
make check
make DESTDIR=/stage/krb5 install
# Match the stock library package's scope; server programs are not introduced.
while IFS= read -r filename; do
    mkdir -p "/packages/krb5-libs/$(dirname "$filename")"
    cp -a "/stage/krb5/$filename" "/packages/krb5-libs/$filename"
done < /recipe/krb5-libraries.list
