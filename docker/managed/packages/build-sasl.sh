#!/bin/sh
set -eu
lock=/recipe/sources.lock.json
# Preserve the existing Heimdal-backed SASL plugin set, with the reviewed source correction.
apk del krb5-dev openldap-2.6-dev e2fsprogs-dev
apk add --no-cache heimdal-dev gdbm-dev libtool sqlite-dev
mkdir /work/sasl
tar -xzf /work/downloads/sasl.tar.gz -C /work/sasl --strip-components=1
cd /work/sasl
patch --batch --fuzz=0 -p1 < /work/downloads/sasl-debian.patch
./autogen.sh
CFLAGS='-Wno-error=implicit-function-declaration -std=gnu17' ./configure \
    --prefix=/usr --libdir=/usr/lib --sysconfdir=/etc --localstatedir=/var \
    --enable-shared --disable-static --with-plugindir=/usr/lib/sasl2 \
    --with-configdir=/etc/sasl2 --with-dbpath=/etc/sasl2/sasldb2 --disable-krb4 \
    --with-gss_impl=heimdal --enable-gssapi --without-rc4 --without-des \
    --with-dblib=gdbm --with-saslauthd=/run/saslauthd --without-pwcheck \
    --with-devrandom=/dev/urandom --enable-sql --without-mysql --without-pgsql \
    --without-sqlite --with-sqlite3=/usr/lib --enable-anon --enable-cram \
    --enable-digest --enable-httpform --disable-ntlm --enable-plain --enable-login \
    --enable-auth-sasldb --enable-alwaystrue --disable-otp --sbindir=/usr/bin
make -j2
make DESTDIR=/stage/sasl install
mkdir -p /packages/cyrus-sasl-heimdal-libs/usr/lib/sasl2
cp -a /stage/sasl/usr/lib/libsasl2.so.* /packages/cyrus-sasl-heimdal-libs/usr/lib/
cp -a /stage/sasl/usr/lib/sasl2/*.so* /packages/cyrus-sasl-heimdal-libs/usr/lib/sasl2/
