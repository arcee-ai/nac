#!/bin/sh
set -eu

managed_config=${NAC_MANAGED_CONFIG:-/etc/nac/managed.toml}

if [ "$(id -u)" -ne 10001 ] || [ "$(id -g)" -ne 10001 ]; then
    printf '%s\n' 'error: Managed NAC must run as UID/GID 10001:10001' >&2
    exit 78
fi

# CAP_SYS_PTRACE bypasses the server/worker non-dumpable boundary. Managed NAC
# fails closed if the controller grants it, including through a privileged pod.
cap_eff=$(awk '$1 == "CapEff:" { print $2 }' /proc/self/status)
if [ -z "$cap_eff" ]; then
    printf '%s\n' 'error: Managed NAC could not verify effective Linux capabilities' >&2
    exit 78
fi
ptrace_nibble=$(printf '%s' "$cap_eff" | rev | cut -c 5)
case "$ptrace_nibble" in
    [89a-fA-F])
        printf '%s\n' 'error: Managed NAC must not receive CAP_SYS_PTRACE' >&2
        exit 78
        ;;
esac

for managed_path in /var/lib/nac /repositories /home/nac /tmp /run/nac; do
    if [ ! -d "$managed_path" ] || [ "$(readlink -f "$managed_path")" != "$managed_path" ]; then
        printf 'error: required managed path is missing or non-canonical: %s\n' "$managed_path" >&2
        exit 78
    fi
    if [ ! -r "$managed_path" ] || [ ! -w "$managed_path" ] || [ ! -x "$managed_path" ]; then
        printf 'error: required managed path is not usable by 10001:10001: %s\n' "$managed_path" >&2
        exit 78
    fi
done

if [ ! -f "$managed_config" ] || [ -L "$managed_config" ] || [ ! -r "$managed_config" ]; then
    printf 'error: managed configuration is not a readable regular file: %s\n' "$managed_config" >&2
    exit 78
fi

# The entrypoint performs only cheap structural checks. The server owns the
# one-time bootstrap import; /readyz validates durable model authorization,
# tools, store, and command backend without requiring the bootstrap mount.
exec /usr/local/bin/nac-web \
    --bind 0.0.0.0:3210 \
    --allow-remote \
    --no-open \
    --store-path /var/lib/nac/nac.sqlite3 \
    --directory /repositories \
    --yes \
    --managed-config "$managed_config" \
    "$@"
