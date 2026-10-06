#!/bin/sh
set -eu

# Offline packaging/provenance smoke only; this grants no provider or fleet
# qualification and does not exercise a privileged inference sender.
runtime=${CONTAINER_RUNTIME:-docker}
image=${MANAGED_IMAGE:-nac-managed:smoke}
command -v "$runtime" >/dev/null 2>&1 || {
    printf 'error: container runtime not found: %s\n' "$runtime" >&2
    exit 2
}
command -v jq >/dev/null 2>&1 || {
    printf '%s\n' 'error: managed host-key image smoke requires jq' >&2
    exit 2
}

suffix="nac-host-key-smoke-$$"
container=$suffix
state="$suffix-state"
repositories="$suffix-repositories"
home_volume="$suffix-home"
config="$suffix-config"
bootstrap="$suffix-bootstrap"
canary=synthetic-v3-image-canary

cleanup() {
    "$runtime" rm -f "$container" >/dev/null 2>&1 || true
    "$runtime" volume rm "$state" "$repositories" "$home_volume" "$config" "$bootstrap" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM
fail() {
    printf 'managed host-key image smoke: %s\n' "$1" >&2
    exit 1
}

architecture=$("$runtime" image inspect --format '{{.Architecture}}' "$image")
[ "$architecture" = amd64 ] || fail 'image is not linux/amd64'
[ "$("$runtime" image inspect --format '{{.Os}}' "$image")" = linux ] || fail 'image is not Linux'
image_id=$("$runtime" image inspect --format '{{.Id}}' "$image")
for volume in "$state" "$repositories" "$home_volume" "$config" "$bootstrap"; do
    "$runtime" volume create "$volume" >/dev/null
done

"$runtime" run --rm --network none --entrypoint /bin/sh --user 0:0 \
    --volume "$config:/etc/nac" --volume "$bootstrap:/run/secrets/nac" \
    "$image" -ceu '
        umask 077
        cat > /run/secrets/nac/bootstrap.json <<EOF
{"version":3,"bootstrap_id":"4712bc5e-30d5-421a-b416-8291d9f7d8f9","managed_host_id":"21856443-8ed8-40ab-9036-72e837c99f27","host_incarnation_id":"cr-v3-smoke","pvc_uid":"pvc-v3-smoke","organization_id":"11670cb3-ea82-4f66-96ca-d5b6542f8c2a","owner_epoch":1,"key_generation":1,"local_key_id":"00d61e35-4d17-4949-888f-5f153b03a53b","key_id":"provider-v3-smoke","clerk_instance_id":"instance-smoke","inference_origin":"https://api.arcee.ai","credential_kind":"clerk_api_key","scopes":["managed:inference"],"api_key":"synthetic-v3-image-canary"}
EOF
        cat > /etc/nac/managed.toml <<EOF
version = 3
logical_host_id = "21856443-8ed8-40ab-9036-72e837c99f27"
host_incarnation_id = "cr-v3-smoke"
public_hostname = "managed-smoke.test"
repository_root = "/repositories"
state_root = "/var/lib/nac"
home_root = "/home/nac"
github_client_id = "Iv1.smoke"
model_backend = "arcee-api"
model_id = "trinity-large-thinking"
model_endpoint = "https://api.arcee.ai"
model_credential_source = "managed-host-key"
model_credential_file = "/run/secrets/nac/bootstrap.json"
managed_control_bind = "0.0.0.0:3211"
managed_control_issuer = "https://nac-api.managed-smoke.test"
managed_control_jwks_file = "/etc/nac/control-jwks.json"
[managed_host_key]
bootstrap_id = "4712bc5e-30d5-421a-b416-8291d9f7d8f9"
managed_host_id = "21856443-8ed8-40ab-9036-72e837c99f27"
host_incarnation_id = "cr-v3-smoke"
pvc_uid = "pvc-v3-smoke"
organization_id = "11670cb3-ea82-4f66-96ca-d5b6542f8c2a"
owner_epoch = 1
key_generation = 1
local_key_id = "00d61e35-4d17-4949-888f-5f153b03a53b"
key_id = "provider-v3-smoke"
clerk_instance_id = "instance-smoke"
inference_origin = "https://api.arcee.ai"
EOF
        printf "%s\n" "{\"keys\":[{\"kty\":\"OKP\",\"crv\":\"Ed25519\",\"use\":\"sig\",\"alg\":\"EdDSA\",\"kid\":\"managed-smoke\",\"x\":\"11qYAYKxCrfVS_7TyWTfbp-JhBGHx7lqCMZ73HfAUT8\"}]}" > /etc/nac/control-jwks.json
        chown 0:10001 /etc/nac/managed.toml /etc/nac/control-jwks.json /run/secrets/nac/bootstrap.json
        chmod 0440 /etc/nac/managed.toml /etc/nac/control-jwks.json /run/secrets/nac/bootstrap.json
    '

start() {
    if [ "$1" = with-bootstrap ]; then
        set -- --volume "$bootstrap:/run/secrets/nac:ro"
    else
        set --
    fi
    "$runtime" run --detach --name "$container" --network none --read-only \
        --env NAC_ALLOWED_HOSTS=managed-smoke.test \
        --volume "$state:/var/lib/nac" --volume "$repositories:/repositories" \
        --volume "$home_volume:/home/nac" --volume "$config:/etc/nac:ro" "$@" \
        --tmpfs /tmp:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=1777 \
        --tmpfs /run/nac:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=0755 \
        "$image" >/dev/null
}
assert_no_secret() {
    case "$1" in *"$canary"*|*retained-legacy-canary*) fail 'runtime output disclosed synthetic credential' ;; esac
}
wait_status() {
    expected=$1
    attempts=0
    while [ "$attempts" -lt 120 ]; do
        response=$("$runtime" exec "$container" curl -sS --max-time 2 \
            --write-out '\n%{http_code}' http://127.0.0.1:3210/readyz 2>/dev/null || true)
        assert_no_secret "$response"
        code=$(printf '%s\n' "$response" | tail -n 1)
        if [ "$code" = "$expected" ]; then return; fi
        [ "$("$runtime" inspect --format '{{.State.Running}}' "$container")" = true ] || fail 'container exited before expected readiness'
        attempts=$((attempts + 1))
        sleep 0.5
    done
    fail 'container did not reach expected readiness'
}
stop() {
    "$runtime" stop --time 25 "$container" >/dev/null
    [ "$("$runtime" inspect --format '{{.State.ExitCode}}' "$container")" = 0 ] || fail 'SIGTERM shutdown failed'
    assert_no_secret "$("$runtime" logs "$container" 2>&1)"
    "$runtime" rm "$container" >/dev/null
}
state_operation() {
    "$runtime" run --rm --network none --entrypoint /bin/sh --user 0:0 \
        --volume "$state:/var/lib/nac" "$image" -ceu "$1"
}
assert_receipt() {
    "$runtime" exec "$container" /bin/sh -ceu '
        jq -e '\''.version == 3 and .credential_kind == "clerk_api_key" and .scopes == ["managed:inference"] and .disposition == "imported" and .bootstrap_id == "4712bc5e-30d5-421a-b416-8291d9f7d8f9" and .managed_host_id == "21856443-8ed8-40ab-9036-72e837c99f27" and .host_incarnation_id == "cr-v3-smoke" and .pvc_uid == "pvc-v3-smoke" and .organization_id == "11670cb3-ea82-4f66-96ca-d5b6542f8c2a" and .owner_epoch == 1 and .key_generation == 1 and .local_key_id == "00d61e35-4d17-4949-888f-5f153b03a53b" and .key_id == "provider-v3-smoke" and .clerk_instance_id == "instance-smoke" and .inference_origin == "https://api.arcee.ai" and (keys | length) == 15'\'' /var/lib/nac/managed_host_key_receipt.json >/dev/null
        ! grep -F synthetic-v3-image-canary /var/lib/nac/managed_host_key_receipt.json >/dev/null
        test ! -e /var/lib/nac/arcee_auth.json
        test "$(stat -c %a /var/lib/nac/managed_host_key.json)" = 600
        test "$(stat -c %u:%g /var/lib/nac/managed_host_key.json)" = 10001:10001
    '
}

# A fresh host rejects a missing mount, without publishing a durable authority.
start without-bootstrap
attempts=0
while [ "$("$runtime" inspect --format '{{.State.Running}}' "$container")" = true ] && [ "$attempts" -lt 40 ]; do
    attempts=$((attempts + 1))
    sleep 0.25
done
[ "$("$runtime" inspect --format '{{.State.Running}}' "$container")" = false ] || fail 'fresh host did not reject missing bootstrap'
[ "$("$runtime" inspect --format '{{.State.ExitCode}}' "$container")" -ne 0 ] || fail 'missing bootstrap exited successfully'
assert_no_secret "$("$runtime" logs "$container" 2>&1)"
"$runtime" rm "$container" >/dev/null
state_operation 'test ! -e /var/lib/nac/managed_host_key.json'

start with-bootstrap
wait_status 200
status=$("$runtime" exec "$container" curl -fsS --max-time 5 -H 'Host: managed-smoke.test' http://127.0.0.1:3210/managed/status)
assert_no_secret "$status"
printf '%s' "$status" | jq -e '.ready == true and .build_track == "dev" and .migration_state == "current" and .maintenance_state == "serving"' >/dev/null || fail 'managed status is not serving the dev build'
revision=$(printf '%s' "$status" | jq -er '.source_revision')
if [ -n "${NAC_SMOKE_REVISION:-}" ]; then
    [ "$revision" = "$NAC_SMOKE_REVISION" ] || fail 'compiled runtime revision differs from requested source'
fi
assert_receipt
authority_hash=$("$runtime" exec "$container" sha256sum /var/lib/nac/managed_host_key.json | cut -d ' ' -f 1)
stop

# Recover a lost projection from authority with no mounted delivery.
state_operation 'rm /var/lib/nac/managed_host_key_receipt.json'
start without-bootstrap
wait_status 200
assert_receipt
[ "$("$runtime" exec "$container" sha256sum /var/lib/nac/managed_host_key.json | cut -d ' ' -f 1)" = "$authority_hash" ] || fail 'restart changed private authority'
"$runtime" exec "$container" test ! -e /run/secrets/nac/bootstrap.json
stop

# Synthetic offline revoked state: replaying the old delivery must not refill
# the consumed slot. This is fixture setup, not an authenticated revoke proof.
state_operation 'jq ".api_key = null" /var/lib/nac/managed_host_key.json > /var/lib/nac/authority.next; chown 10001:10001 /var/lib/nac/authority.next; chmod 0600 /var/lib/nac/authority.next; mv /var/lib/nac/authority.next /var/lib/nac/managed_host_key.json'
start with-bootstrap
wait_status 503
"$runtime" exec "$container" jq -e '.api_key == null and .generation_watermark == 1 and .consumed_bootstrap_ids == ["4712bc5e-30d5-421a-b416-8291d9f7d8f9"]' /var/lib/nac/managed_host_key.json >/dev/null
stop

# A retained prior credential blocks startup and is preserved byte-for-byte.
state_operation 'printf "%s\n" retained-legacy-canary > /var/lib/nac/arcee_auth.json; chown 10001:10001 /var/lib/nac/arcee_auth.json; chmod 0600 /var/lib/nac/arcee_auth.json'
start with-bootstrap
attempts=0
while [ "$("$runtime" inspect --format '{{.State.Running}}' "$container")" = true ] && [ "$attempts" -lt 40 ]; do
    attempts=$((attempts + 1))
    sleep 0.25
done
[ "$("$runtime" inspect --format '{{.State.Running}}' "$container")" = false ] || fail 'retained credential did not block startup'
[ "$("$runtime" inspect --format '{{.State.ExitCode}}' "$container")" -ne 0 ] || fail 'retained credential rejection exited successfully'
assert_no_secret "$("$runtime" logs "$container" 2>&1)"
state_operation 'test "$(cat /var/lib/nac/arcee_auth.json)" = retained-legacy-canary'
printf 'managed host-key image smoke: ok image=%s revision=%s; offline synthetic proof only\n' "$image_id" "$revision"
