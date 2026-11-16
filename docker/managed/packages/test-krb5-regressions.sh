#!/bin/sh
set -eu

# Compile the actual patched functions in the owned source tree.  The negative
# controls reverse only the two locked upstream patches in disposable copies.
# Nothing here is installed into the runtime package or opens a socket.
# The managed Wolfi builder uses BusyBox ash, which supports this core limit.
# shellcheck disable=SC3045
ulimit -c 0
root=/work/krb5-regressions
recipe=${NAC_REGRESSION_RECIPE:-/recipe}
mkdir -p "$root/vulnerable/src/lib/gssapi/spnego" "$root/vulnerable/src/lib/krb5/krb"
cp /work/krb5/src/lib/gssapi/spnego/negoex_util.c \
    "$root/vulnerable/src/lib/gssapi/spnego/negoex_util.c"
cp /work/krb5/src/lib/krb5/krb/rd_cred.c \
    "$root/vulnerable/src/lib/krb5/krb/rd_cred.c"
cd "$root/vulnerable"
patch --batch --fuzz=0 -R -p1 < /work/downloads/krb5-negoex.patch
patch --batch --fuzz=0 -R -p1 < /work/downloads/krb5-ticket-info.patch

cd /work/krb5/src
compile_negoex() {
    source_root=$1
    source_name=$2
    output=$3
    gcc -DHAVE_CONFIG_H -DKRB5_PRIVATE -DKRB5_DEPRECATED=1 \
        -ffunction-sections -fdata-sections \
        -I"$source_root" -I. -Iinclude -Ilib/gssapi -Ilib/gssapi/spnego \
        -Ilib/gssapi/generic -Ilib/gssapi/mechglue -Ilib/gssapi/krb5 \
        -Ilib/krb5/krb -I/usr/include/et "$recipe/$source_name" \
        -Wl,--gc-sections -Llib -lgssapi_krb5 -lkrb5 -lk5crypto -lcom_err \
        -lkrb5support -lkeyutils -lcrypto -lresolv -o "$output"
}
compile_cred() {
    source_root=$1
    output=$2
    gcc -DHAVE_CONFIG_H -DKRB5_PRIVATE -DKRB5_DEPRECATED=1 \
        -ffunction-sections -fdata-sections \
        -I"$source_root" -I. -Iinclude -Ilib/krb5/krb -I/usr/include/et \
        "$recipe/krb5-cred-list.c" -Wl,--gc-sections -Llib -lkrb5 -lk5crypto \
        -lcom_err -lkrb5support -lkeyutils -lcrypto -lresolv -o "$output"
}
expect_fixed() {
    label=$1
    binary=$2
    LD_LIBRARY_PATH=/work/krb5/src/lib "$binary"
    printf '%s fixed: rejected malformed input\n' "$label"
}
expect_vulnerable_fault() {
    label=$1
    binary=$2
    set +e
    LD_LIBRARY_PATH=/work/krb5/src/lib timeout 5s "$binary" \
        > "$root/$label.vulnerable.log" 2>&1
    status=$?
    set -e
    if [ "$status" -ne 139 ]; then
        cat "$root/$label.vulnerable.log"
        printf '%s reversed control did not fault (exit %s)\n' "$label" "$status" >&2
        exit 1
    fi
    printf '%s reversed: expected fault (exit 139)\n' "$label"
}

for case_name in krb5-negoex-vector krb5-negoex-header; do
    compile_negoex . "$case_name.c" "$root/$case_name.fixed"
    compile_negoex "$root/vulnerable/src" "$case_name.c" "$root/$case_name.vulnerable"
    expect_fixed "$case_name" "$root/$case_name.fixed"
    expect_vulnerable_fault "$case_name" "$root/$case_name.vulnerable"
done
compile_cred . "$root/krb5-cred-list.fixed"
compile_cred "$root/vulnerable/src" "$root/krb5-cred-list.vulnerable"
expect_fixed krb5-cred-list "$root/krb5-cred-list.fixed"
expect_vulnerable_fault krb5-cred-list "$root/krb5-cred-list.vulnerable"
