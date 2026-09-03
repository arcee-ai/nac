#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
container_runtime=${CONTAINER_RUNTIME:-}
if [ -z "$container_runtime" ]; then
    if command -v docker >/dev/null 2>&1; then
        container_runtime=docker
    elif command -v podman >/dev/null 2>&1; then
        container_runtime=podman
    else
        printf '%s\n' 'error: managed image smoke requires Docker or Podman' >&2
        exit 2
    fi
fi
command -v "$container_runtime" >/dev/null 2>&1 || {
    printf 'error: container runtime not found: %s\n' "$container_runtime" >&2
    exit 2
}

image=${MANAGED_IMAGE:-nac-managed:smoke}
if [ "${MANAGED_IMAGE_SKIP_BUILD:-0}" != 1 ]; then
    "$container_runtime" build \
        --platform linux/amd64 \
        --file "$repo_root/docker/managed/Dockerfile" \
        --tag "$image" \
        "$repo_root"
fi

suffix="nac-managed-smoke-$$"
container_name=$suffix
state_volume="$suffix-state"
repository_volume="$suffix-repositories"
home_volume="$suffix-home"
config_volume="$suffix-config"
bootstrap_volume="$suffix-bootstrap"
ready_file="${TMPDIR:-/tmp}/$suffix-ready.json"
log_file="${TMPDIR:-/tmp}/$suffix-logs.txt"

cleanup() {
    rm -f "$ready_file" "$log_file"
    "$container_runtime" rm -f "$container_name" >/dev/null 2>&1 || true
    "$container_runtime" volume rm \
        "$state_volume" "$repository_volume" "$home_volume" "$config_volume" \
        "$bootstrap_volume" \
        >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

for volume in "$state_volume" "$repository_volume" "$home_volume" "$config_volume" "$bootstrap_volume"; do
    "$container_runtime" volume create "$volume" >/dev/null
done

"$container_runtime" run --rm \
    --entrypoint /bin/sh \
    --user 0:0 \
    --volume "$bootstrap_volume:/run/secrets/nac" \
    --volume "$repo_root/docker/managed/fixtures/bootstrap.json:/fixture/bootstrap.json:ro" \
    "$image" -ceu '
        umask 077
        cp /fixture/bootstrap.json /run/secrets/nac/bootstrap.json
        chown 0:10001 /run/secrets/nac/bootstrap.json
        chmod 0440 /run/secrets/nac/bootstrap.json
    '

"$container_runtime" run --rm \
    --entrypoint /bin/sh \
    --user 10001:10001 \
    --volume "$state_volume:/var/lib/nac" \
    --volume "$repository_volume:/repositories" \
    --volume "$home_volume:/home/nac" \
    --volume "$config_volume:/etc/nac" \
    "$image" -ceu '
        umask 077
        printf "%s\n" \
            "version = 1" \
            "logical_host_id = \"21856443-8ed8-40ab-9036-72e837c99f27\"" \
            "owner = \"smoke@example.test\"" \
            "public_hostname = \"managed-smoke.test\"" \
            "repository_root = \"/repositories\"" \
            "state_root = \"/var/lib/nac\"" \
            "home_root = \"/home/nac\"" \
            "github_client_id = \"Iv1.smoke\"" \
            "model_backend = \"arcee-auth\"" \
            "model_id = \"trinity-large-thinking\"" \
            "model_endpoint = \"https://api.arcee.ai\"" \
            "model_credential_file = \"/run/secrets/nac/bootstrap.json\"" \
            "model_credential_source = \"managed-bootstrap\"" \
            > /etc/nac/managed.toml
        printf "%s\n" durable > /var/lib/nac/restart-canary
        printf "%s\n" durable > /repositories/restart-canary
        printf "%s\n" durable > /home/nac/restart-canary
    '

fail() {
    printf 'managed image smoke: %s\n' "$1" >&2
    exit 1
}

start_container() {
    bootstrap_mount=${1:-with-bootstrap}
    if [ "$bootstrap_mount" = with-bootstrap ]; then
        set -- --volume "$bootstrap_volume:/run/secrets/nac:ro"
    else
        set --
    fi
    "$container_runtime" run --detach \
        --name "$container_name" \
        --read-only \
        --publish 127.0.0.1::3210 \
        --env NAC_ALLOWED_HOSTS=managed-smoke.test \
        --volume "$state_volume:/var/lib/nac" \
        --volume "$repository_volume:/repositories" \
        --volume "$home_volume:/home/nac" \
        --volume "$config_volume:/etc/nac:ro" \
        "$@" \
        --tmpfs /tmp:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=1777 \
        --tmpfs /run/nac:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=0755 \
        "$image" >/dev/null
}

assert_bootstrap_required() {
    start_container without-bootstrap
    attempts=0
    while [ "$attempts" -lt 40 ]; do
        running=$($container_runtime inspect --format '{{.State.Running}}' "$container_name" 2>/dev/null || true)
        [ "$running" = true ] || break
        port=$($container_runtime port "$container_name" 3210/tcp 2>/dev/null | sed -n '1s/.*://p')
        if [ -n "$port" ] && curl -fsS --noproxy '*' --connect-timeout 1 --max-time 1 \
            "http://127.0.0.1:$port/readyz" >/dev/null 2>&1; then
            fail 'fresh managed host became ready without its bootstrap mount'
        fi
        attempts=$((attempts + 1))
        sleep 0.25
    done
    running=$($container_runtime inspect --format '{{.State.Running}}' "$container_name" 2>/dev/null || true)
    if [ "$running" = true ]; then
        "$container_runtime" logs "$container_name" >&2 || true
        fail 'fresh managed host did not reject startup without its bootstrap mount'
    fi
    exit_code=$($container_runtime inspect --format '{{.State.ExitCode}}' "$container_name")
    [ "$exit_code" -ne 0 ] || fail 'missing-bootstrap startup exited successfully'
    "$container_runtime" rm -f "$container_name" >/dev/null
}

wait_until_ready() {
    port=$($container_runtime port "$container_name" 3210/tcp | sed -n '1s/.*://p')
    [ -n "$port" ] || fail 'container runtime did not publish port 3210'
    attempts=0
    while [ "$attempts" -lt 120 ]; do
        if curl -fsS --noproxy '*' --connect-timeout 1 --max-time 2 \
            "http://127.0.0.1:$port/healthz" >/dev/null 2>&1 \
            && curl -fsS --noproxy '*' --connect-timeout 1 --max-time 5 \
                "http://127.0.0.1:$port/readyz" >"$ready_file" 2>/dev/null; then
            printf '%s\n' "$port"
            return
        fi
        if [ "$($container_runtime inspect --format '{{.State.Running}}' "$container_name")" != true ]; then
            "$container_runtime" logs "$container_name" >&2 || true
            fail 'container exited before readiness'
        fi
        attempts=$((attempts + 1))
        sleep 0.5
    done
    "$container_runtime" logs "$container_name" >&2 || true
    fail 'container did not become ready within 60 seconds'
}

# A fresh host must fail closed until the exact mounted generation can be
# imported into the durable credential and receipt files.
assert_bootstrap_required

start_container with-bootstrap
port=$(wait_until_ready)

"$container_runtime" exec "$container_name" /bin/sh -ceu '
    test "$(id -u):$(id -g)" = 10001:10001
    ! command -v sudo >/dev/null 2>&1
    for tool in bash git gh ssh curl jq rg fd rsync make pkg-config cmake cc python3 uv node npm corepack rustc cargo rustfmt cargo-clippy go tar gzip xz zip unzip tini; do
        command -v "$tool" >/dev/null
    done
    rustc --version | grep -F "rustc 1.98.0" >/dev/null
    node --version | grep -F "v24.20.0" >/dev/null
    go version | grep -F "go1.27.0" >/dev/null
    uv --version | grep -F "uv 0.12.1" >/dev/null
    test "$(printf "é" | wc -c)" -eq 2
    printf "%s\n" command-ok > /repositories/local-command-probe
    test "$(cat /repositories/local-command-probe)" = command-ok
    test "$(cat /var/lib/nac/restart-canary)" = durable
    test "$(cat /repositories/restart-canary)" = durable
    test "$(cat /home/nac/restart-canary)" = durable
    test -f /run/secrets/nac/bootstrap.json
    test ! -L /run/secrets/nac/bootstrap.json
    test -f /var/lib/nac/arcee_auth.json
    test -f /var/lib/nac/arcee_managed_bootstrap_receipt.json
    jq -e '.client_id == "managed-nac" and .managed_bootstrap.bootstrap_id == "4712bc5e-30d5-421a-b416-8291d9f7d8f9"' /var/lib/nac/arcee_auth.json >/dev/null
    if printf "%s\n" overwritten > /run/secrets/nac/bootstrap.json 2>/dev/null; then
        echo "bootstrap mount unexpectedly accepted a write" >&2
        exit 1
    fi
'

index_html=$(curl -fsS --noproxy '*' --connect-timeout 1 --max-time 5 \
    "http://127.0.0.1:$port/")
asset_path=$(printf '%s' "$index_html" | sed -n 's/.*src="\([^"]*\/assets\/dist\/assets\/index-[^"]*\.js\)".*/\1/p')
[ -n "$asset_path" ] || fail 'embedded application did not reference a hashed script asset'
curl -fsS --noproxy '*' --connect-timeout 1 --max-time 5 \
    "http://127.0.0.1:$port$asset_path" >/dev/null

status_json=$(curl -fsS --noproxy '*' --connect-timeout 1 --max-time 5 \
    -H 'Host: managed-smoke.test' "http://127.0.0.1:$port/managed/status")
printf '%s' "$status_json" | grep -F '"ready":true' >/dev/null || fail 'managed status is not ready'
bootstrap_access=$(jq -r '.access_token' "$repo_root/docker/managed/fixtures/bootstrap.json")
bootstrap_refresh=$(jq -r '.refresh_token' "$repo_root/docker/managed/fixtures/bootstrap.json")
case "$status_json" in
    *"$bootstrap_access"*|*"$bootstrap_refresh"*) fail 'managed status disclosed bootstrap credentials' ;;
esac
"$container_runtime" logs "$container_name" >"$log_file" 2>&1
log_contents=$(cat "$log_file")
case "$log_contents" in
    *"$bootstrap_access"*|*"$bootstrap_refresh"*) fail 'managed logs disclosed bootstrap credentials' ;;
esac

"$container_runtime" stop --time 25 "$container_name" >/dev/null
exit_code=$($container_runtime inspect --format '{{.State.ExitCode}}' "$container_name")
[ "$exit_code" -eq 0 ] || fail "SIGTERM shutdown exited with status $exit_code"
"$container_runtime" rm "$container_name" >/dev/null

# Model a persisted refresh-token rotation, then reconcile the original
# bootstrap mount. Startup must preserve the rotated writable record.
"$container_runtime" run --rm \
    --entrypoint /bin/sh \
    --user 0:0 \
    --volume "$state_volume:/var/lib/nac" \
    "$image" -ceu '
        jq ".access_token += \"-rotated\" | .refresh_token += \"-rotated\"" \
            /var/lib/nac/arcee_auth.json > /var/lib/nac/arcee_auth.json.next
        chown 10001:10001 /var/lib/nac/arcee_auth.json.next
        chmod 0600 /var/lib/nac/arcee_auth.json.next
        mv /var/lib/nac/arcee_auth.json.next /var/lib/nac/arcee_auth.json
    '

start_container with-bootstrap
port=$(wait_until_ready)
curl -fsS --noproxy '*' --connect-timeout 1 --max-time 5 \
    "http://127.0.0.1:$port/readyz" >/dev/null
"$container_runtime" exec "$container_name" /bin/sh -ceu '
    test -f /var/lib/nac/restart-canary
    jq -e ".access_token | endswith(\"-rotated\")" /var/lib/nac/arcee_auth.json >/dev/null
    jq -e ".refresh_token | endswith(\"-rotated\")" /var/lib/nac/arcee_auth.json >/dev/null
'
# Model an abrupt process/container loss after the durable import. The next
# start must recover from the PVC-backed credential and receipt without
# depending on the one-time bootstrap mount.
"$container_runtime" kill --signal KILL "$container_name" >/dev/null
"$container_runtime" rm "$container_name" >/dev/null

# The receipt must make a later steady-state restart independent of the
# bootstrap volume altogether.
start_container without-bootstrap
port=$(wait_until_ready)
curl -fsS --noproxy '*' --connect-timeout 1 --max-time 5 \
    "http://127.0.0.1:$port/readyz" >/dev/null
"$container_runtime" exec "$container_name" test ! -e /run/secrets/nac/bootstrap.json
"$container_runtime" stop --time 25 "$container_name" >/dev/null

printf '%s\n' 'managed image smoke: ok'
