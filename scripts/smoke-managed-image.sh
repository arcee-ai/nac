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
credential_volume="$suffix-model-credential"
ready_file="${TMPDIR:-/tmp}/$suffix-ready.json"

cleanup() {
    rm -f "$ready_file"
    "$container_runtime" rm -f "$container_name" >/dev/null 2>&1 || true
    "$container_runtime" volume rm \
        "$state_volume" "$repository_volume" "$home_volume" "$config_volume" \
        "$credential_volume" \
        >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

for volume in "$state_volume" "$repository_volume" "$home_volume" "$config_volume" "$credential_volume"; do
    "$container_runtime" volume create "$volume" >/dev/null
done

fixture='managed-image-smoke-model-credential'
"$container_runtime" run --rm \
    --entrypoint /bin/sh \
    --user 0:0 \
    --volume "$credential_volume:/run/secrets/model" \
    "$image" -ceu '
        umask 077
        printf "%s\n" "managed-image-smoke-model-credential" > /run/secrets/model/credential
        chown 10001:10001 /run/secrets/model/credential
        chmod 0400 /run/secrets/model/credential
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
            "logical_host_id = \"managed-image-smoke\"" \
            "owner = \"smoke@example.test\"" \
            "public_hostname = \"managed-smoke.test\"" \
            "repository_root = \"/repositories\"" \
            "state_root = \"/var/lib/nac\"" \
            "home_root = \"/home/nac\"" \
            "github_client_id = \"Iv1.smoke\"" \
            "model_backend = \"arcee-api\"" \
            "model_id = \"trinity-large-thinking\"" \
            "model_endpoint = \"https://models.example.test/v1\"" \
            "model_credential_file = \"/run/secrets/model/credential\"" \
            "model_credential_environment_names = [\"ARCEE_API_KEY\"]" \
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
    "$container_runtime" run --detach \
        --name "$container_name" \
        --read-only \
        --publish 127.0.0.1::3210 \
        --env NAC_ALLOWED_HOSTS=managed-smoke.test \
        --volume "$state_volume:/var/lib/nac" \
        --volume "$repository_volume:/repositories" \
        --volume "$home_volume:/home/nac" \
        --volume "$config_volume:/etc/nac:ro" \
        --volume "$credential_volume:/run/secrets/model:ro" \
        --tmpfs /tmp:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=1777 \
        --tmpfs /run/nac:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=0755 \
        "$image" >/dev/null
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

start_container
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
    test "$(cat /run/secrets/model/credential)" = managed-image-smoke-model-credential
    if printf "%s\n" overwritten > /run/secrets/model/credential 2>/dev/null; then
        echo "model credential mount unexpectedly accepted a write" >&2
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
if printf '%s' "$status_json" | grep -F "$fixture" >/dev/null; then
    fail 'managed status disclosed the model credential fixture'
fi

"$container_runtime" stop --time 25 "$container_name" >/dev/null
exit_code=$($container_runtime inspect --format '{{.State.ExitCode}}' "$container_name")
[ "$exit_code" -eq 0 ] || fail "SIGTERM shutdown exited with status $exit_code"
"$container_runtime" rm "$container_name" >/dev/null

start_container
port=$(wait_until_ready)
curl -fsS --noproxy '*' --connect-timeout 1 --max-time 5 \
    "http://127.0.0.1:$port/readyz" >/dev/null
"$container_runtime" exec "$container_name" test -f /var/lib/nac/restart-canary
"$container_runtime" stop --time 25 "$container_name" >/dev/null

printf '%s\n' 'managed image smoke: ok'
