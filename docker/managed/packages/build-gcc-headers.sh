#!/bin/sh
set -eu
lock=/recipe/sources.lock.json
# The GCC defect is in an installed template header. Repackage the exact checksum-pinned
# supplier development payload, changing only that header and owned metadata.
# fetch-sources.sh already verifies the exact reviewed supplier archive SHA256.
mkdir -p /packages/libstdc++-dev /work/gcc_headers/libstdc++-v3/include/ext/pb_ds/detail/binary_heap_
tar --ignore-zeros -xzf /work/downloads/libstdc++-dev-16.2.0-r1.apk \
    -C /packages/libstdc++-dev --exclude='.PKGINFO' --exclude='.SIGN.*' \
    --exclude='.melange.yaml' --exclude='var/lib/db/sbom/*'
header=usr/include/c++/16/ext/pb_ds/detail/binary_heap_/erase_fn_imps.hpp
test "$(sha256sum /packages/libstdc++-dev/$header | cut -d ' ' -f 1)" = \
    c74c69330dc5bbfa87d45da25094ba11b8ecc5bf3a845bd4afb693a57b7b54b5
cp /packages/libstdc++-dev/$header /work/gcc_headers/libstdc++-v3/include/ext/pb_ds/detail/binary_heap_/
cd /work/gcc_headers
git apply --include=libstdc++-v3/include/ext/pb_ds/detail/binary_heap_/erase_fn_imps.hpp \
    /work/downloads/gcc-uaf.patch
cp libstdc++-v3/include/ext/pb_ds/detail/binary_heap_/erase_fn_imps.hpp /packages/libstdc++-dev/$header
