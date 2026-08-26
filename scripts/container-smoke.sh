#!/bin/sh
set -eu

image="${1:-nac:smoke}"
expected_revision="${2:-}"
suffix="$(date +%s)-$$"
container="nac-container-smoke-${suffix}"
home_volume="nac-container-home-${suffix}"
repositories_volume="nac-container-repositories-${suffix}"
allowed_host="managed-nac-smoke.example"

cleanup() {
    status=$?
    trap - EXIT INT TERM
    if [ "$status" -ne 0 ] && docker container inspect "$container" >/dev/null 2>&1; then
        docker logs "$container" >&2 || true
    fi
    docker rm --force "$container" >/dev/null 2>&1 || true
    docker volume rm "$home_volume" "$repositories_volume" >/dev/null 2>&1 || true
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker volume create "$home_volume" >/dev/null
docker volume create "$repositories_volume" >/dev/null

docker run --detach \
    --name "$container" \
    --env "NAC_ALLOWED_HOSTS=${allowed_host}" \
    --publish 127.0.0.1::3210 \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --tmpfs /tmp:rw,nosuid,nodev,size=64m \
    --mount "type=volume,source=${home_volume},destination=/nac-home" \
    --mount "type=volume,source=${repositories_volume},destination=/repositories" \
    "$image" >/dev/null

wait_for_health() {
    attempt=1
    health=""
    while [ "$attempt" -le 60 ]; do
        if health="$(
            docker exec "$container" \
                curl --fail --silent --show-error --noproxy '*' \
                --connect-timeout 1 --max-time 2 \
                http://127.0.0.1:3210/health 2>/dev/null
        )"; then
            health_status="$(docker inspect --format '{{.State.Health.Status}}' "$container")"
            if [ "$health_status" = "healthy" ]; then
                return 0
            fi
        fi
        if [ "$(docker inspect --format '{{.State.Running}}' "$container")" != "true" ]; then
            echo "container-smoke: nac-web exited before becoming ready" >&2
            return 1
        fi
        attempt=$((attempt + 1))
        sleep 1
    done

    echo "container-smoke: nac-web did not become healthy in time" >&2
    return 1
}

wait_for_health

if [ "$health" != '{"status":"ok"}' ]; then
    echo "container-smoke: expected /health to return {\"status\":\"ok\"}, got: ${health:-<no response>}" >&2
    exit 1
fi

runtime_uid="$(docker exec "$container" id -u)"
if [ "$runtime_uid" != "10001" ]; then
    echo "container-smoke: expected runtime UID 10001, got $runtime_uid" >&2
    exit 1
fi

runtime_home="$(docker exec "$container" sh -c 'printf %s "$HOME"')"
if [ "$runtime_home" != "/nac-home" ]; then
    echo "container-smoke: expected runtime HOME /nac-home, got $runtime_home" >&2
    exit 1
fi

docker exec "$container" test -w /nac-home
docker exec "$container" test -w /repositories

published_endpoint="$(docker port "$container" 3210/tcp)"
published_port="${published_endpoint##*:}"
external_health="$(
    curl --fail --silent --show-error --noproxy '*' \
        --connect-timeout 1 --max-time 2 \
        --header "Host: ${allowed_host}" \
        "http://127.0.0.1:${published_port}/health"
)"
if [ "$external_health" != '{"status":"ok"}' ]; then
    echo "container-smoke: externally published /health returned: $external_health" >&2
    exit 1
fi

rejected_status="$(
    curl --silent --show-error --noproxy '*' \
        --connect-timeout 1 --max-time 2 \
        --output /dev/null --write-out '%{http_code}' \
        --header 'Host: untrusted.example' \
        "http://127.0.0.1:${published_port}/health"
)"
if [ "$rejected_status" != "403" ]; then
    echo "container-smoke: expected an untrusted Host to return 403, got $rejected_status" >&2
    exit 1
fi

health_status="$(docker inspect --format '{{.State.Health.Status}}' "$container")"
if [ "$health_status" != "healthy" ]; then
    echo "container-smoke: Docker health status is $health_status" >&2
    exit 1
fi

version="$(docker exec "$container" nac-web --version)"
case "$version" in
    'nac-web '*) ;;
    *)
        echo "container-smoke: unexpected version output: $version" >&2
        exit 1
        ;;
esac

image_revision="$(
    docker image inspect \
        --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
        "$image"
)"
if [ -n "$expected_revision" ]; then
    if [ "$image_revision" != "$expected_revision" ]; then
        echo "container-smoke: expected image revision $expected_revision, got $image_revision" >&2
        exit 1
    fi
    case "$version" in
        *"($expected_revision)"*) ;;
        *)
            echo "container-smoke: version output does not contain revision $expected_revision: $version" >&2
            exit 1
            ;;
    esac
fi

docker exec "$container" sh -c 'printf persisted-home > /nac-home/container-smoke'
docker exec "$container" sh -c 'printf persisted-repository > /repositories/container-smoke'
docker stop --time 10 "$container" >/dev/null
docker start "$container" >/dev/null
wait_for_health
docker exec "$container" grep -qx persisted-home /nac-home/container-smoke
docker exec "$container" grep -qx persisted-repository /repositories/container-smoke

printf 'container-smoke: ready as uid %s, revision %s (%s)\n' \
    "$runtime_uid" "$image_revision" "$version"
