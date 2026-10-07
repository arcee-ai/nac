#!/bin/sh
set -eu
# Fixture-only proof; no production enrollment, provider, catalog or deployment.
runtime=${CONTAINER_RUNTIME:-docker}
image=${MANAGED_SENDER_PROBE_IMAGE:?select an explicitly built sender-prototype image}
namespace="nac-sender-probe-$$"
container=$namespace
private="$namespace-private"
public="$namespace-public"
nac="$namespace-nac"
home_volume="$namespace-home"
repositories="$namespace-repositories"
state="$namespace-state"
probe=/usr/local/libexec/nac-sender-probe
prefix=model::client::tests::sender_prototype::sender_prototype_fixture_
client_pid=
cleanup() {
    [ -z "$client_pid" ] || kill "$client_pid" 2>/dev/null || true
    "$runtime" rm -f "$container" >/dev/null 2>&1 || true
    "$runtime" volume rm "$private" "$public" "$nac" "$home_volume" "$repositories" "$state" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM
printf 'sender prototype fixture namespace=%s image=%s\n' "$namespace" "$image"
for volume in "$private" "$public" "$nac" "$home_volume" "$repositories" "$state"; do
    "$runtime" volume create "$volume" >/dev/null
done
"$runtime" run --rm --network none --user 0:0 --entrypoint /bin/sh \
    -v "$private:/proof/authority" -v "$public:/proof/public" -v "$nac:/proof/nac" \
    -v "$home_volume:/home/nac" -v "$repositories:/repositories" -v "$state:/var/lib/nac" \
    "$image" -ceu '
    chown 10002:10002 /proof/authority /proof/public
    chmod 0700 /proof/authority
    chmod 0755 /proof/public
    chown 10001:10001 /proof/nac /home/nac /repositories /var/lib/nac
    chmod 0700 /proof/nac /home/nac /repositories /var/lib/nac
    python3 - <<"PY"
import json,time,uuid,os
binding={"bootstrap_id":"4712bc5e-30d5-421a-b416-8291d9f7d8f9","managed_host_id":"21856443-8ed8-40ab-9036-72e837c99f27","host_incarnation_id":"fixture-cr-uid","pvc_uid":"fixture-pvc-uid","organization_id":"11670cb3-ea82-4f66-96ca-d5b6542f8c2a","owner_epoch":1,"key_generation":1,"local_key_id":"00d61e35-4d17-4949-888f-5f153b03a53b","key_id":"fixture-provider-key","clerk_instance_id":"fixture-instance","inference_origin":"https://api.arcee.ai"}
lifetime=str(uuid.uuid4())
proofs=[{"proof":str(uuid.uuid4()),"binding":binding,"serving_lifetime":lifetime,"native_incarnation":str(uuid.uuid4()),"expires_at":int(time.time())+1800} for _ in range(3)]
# Third token has a fresh proof but deliberately reused native incarnation.
proofs[2]["native_incarnation"]=proofs[0]["native_incarnation"]
path="/proof/authority/fixture-enrollments.json"
with open(path,"w") as f:json.dump(proofs,f)
os.chmod(path,0o600);os.chown(path,10002,10002)
keypath="/proof/authority/fixture-provider-key"
with open(keypath,"w") as f:f.write("nac-fixture-key-"+str(uuid.uuid4())+str(uuid.uuid4()))
os.chmod(keypath,0o600);os.chown(keypath,10002,10002)
PY
'
"$runtime" run -d --name "$container" --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges --user 10001:10001 --entrypoint /bin/sh \
    -e NAC_SENDER_PROBE_ROOT=/proof -e NAC_HOME=/var/lib/nac \
    -v "$private:/proof/authority" -v "$public:/proof/public" -v "$nac:/proof/nac" \
    -v "$home_volume:/home/nac" -v "$repositories:/repositories" -v "$state:/var/lib/nac" \
    --tmpfs /tmp:rw,nosuid,nodev,mode=1777 \
    "$image" -c 'while :; do sleep 1; done' >/dev/null
start_sender() {
    "$runtime" exec --user 10002:10002 "$container" sh -c 'rm -f /proof/public/ready'
    "$runtime" exec -d --user 10002:10002 "$container" sh -c \
        'exec /usr/local/libexec/nac-sender-probe --exact model::client::tests::sender_prototype::sender_prototype_fixture_daemon --ignored --nocapture >> /proof/public/daemon.log 2>&1'
    attempts=0
    until "$runtime" exec --user 10001:10001 "$container" test -f /proof/public/ready; do
        attempts=$((attempts+1)); [ "$attempts" -lt 300 ] || { printf 'sender did not start\n' >&2; exit 1; }
        sleep 0.1
    done
}
control() {
    "$runtime" exec --user 10002:10002 --env "NAC_SENDER_PROBE_CONTROL=$1" "$container" \
        "$probe" --exact "${prefix}control" --ignored --nocapture
}
wait_stage() {
    expected=$1
    attempts=0
    until [ "$("$runtime" exec --user 10001:10001 "$container" cat /proof/nac/stage 2>/dev/null || true)" = "$expected" ]; do
        attempts=$((attempts+1)); [ "$attempts" -lt 300 ] || { printf 'client did not reach %s\n' "$expected" >&2; exit 1; }
        sleep 0.1
    done
}
continue_stage() {
    "$runtime" exec --user 10001:10001 "$container" sh -c 'printf %s "$1" > /proof/nac/continue' stage "$1"
}
start_sender
control active-negative
# The generated fixture proofs travel solely through a private pipe. They are
# neither a workload-readable file nor an environment/argv value.
"$runtime" exec --user 10002:10002 "$container" cat /proof/authority/fixture-enrollments.json | \
    "$runtime" exec -i --user 10001:10001 "$container" "$probe" --exact "${prefix}client" --ignored --nocapture &
client_pid=$!
wait_stage cutoff
control revoke
continue_stage cutoff
wait_stage restore
control restore
continue_stage restore
wait_stage restart-repair
control revoke
control stop
start_sender
# Tombstones are recovered by the separate sender before an explicit repair.
control repair
control stop
start_sender
control restart-check
continue_stage restart-repair
wait "$client_pid"
client_pid=
wait_stage done
"$runtime" exec --user 10002:10002 "$container" sh -ceu '
    test "$(stat -c %u /proof/authority/managed_host_key.json)" = 10002
    test "$(stat -c %a /proof/authority/managed_host_key.json)" = 600
    test ! -e /proof/authority/bootstrap.json
    ! grep -F -f /proof/authority/fixture-provider-key /proof/public/daemon.log
    ! grep -F -f /proof/authority/fixture-provider-key /proof/authority/managed_host_key_receipt.json
    test "$(cat /proof/public/provider-count)" = 6
'
control stop
cleanup
trap - EXIT HUP INT TERM
for volume in "$private" "$public" "$nac" "$home_volume" "$repositories" "$state"; do
    if "$runtime" volume inspect "$volume" >/dev/null 2>&1; then printf 'fixture volume retained: %s\n' "$volume" >&2; exit 1; fi
done
if "$runtime" container inspect "$container" >/dev/null 2>&1; then printf 'fixture container retained\n' >&2; exit 1; fi
printf 'sender prototype: PASS; owned fixtures removed; production enrollment remains unestablished\n'
