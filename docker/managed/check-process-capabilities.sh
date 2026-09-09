#!/bin/sh
set -eu

status_file=${1:-/proc/self/status}

fail() {
    printf '%s\n' "error: Managed NAC could not verify Linux capability set $1" >&2
    exit 78
}

for field in CapInh CapPrm CapEff CapBnd CapAmb; do
    count=$(awk -v label="$field:" '$1 == label { count += 1 } END { print count + 0 }' "$status_file")
    [ "$count" -eq 1 ] || fail "$field"
    value=$(awk -v label="$field:" '$1 == label { print $2 }' "$status_file")
    case "$value" in
        ''|*[!0-9a-fA-F]*) fail "$field" ;;
    esac
    # CAP_SYS_PTRACE is bit 19: the high bit of the fifth hexadecimal
    # nibble from the right. A shorter valid value has an implicit zero.
    ptrace_nibble=$(printf '%s' "$value" | rev | cut -c 5)
    case "$ptrace_nibble" in
        [89a-fA-F])
            printf '%s\n' "error: Managed NAC must not receive CAP_SYS_PTRACE in $field" >&2
            exit 78
            ;;
    esac
done
