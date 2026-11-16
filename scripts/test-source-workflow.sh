#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/nac-source-workflow.XXXXXX")"
MAKE=${MAKE:-make}
cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
  echo "test-source-workflow: $*" >&2
  exit 1
}

help="$($MAKE -C "$ROOT" help 2>/dev/null)"
for target in setup build dev run install-dev; do
  [[ "$help" == *"  $target"* ]] || fail "help omits $target"
done
run_recipe="$($MAKE -C "$ROOT" --no-print-directory --dry-run run RUN_BIND=127.0.0.1:4321)"
[[ "$run_recipe" == *'./target/debug/nac-web --bind "127.0.0.1:4321"'* ]] || \
  fail "RUN_BIND did not reach the production-equivalent binary"
if "$MAKE" -C "$ROOT" -n demo >"$TMP/demo.out" 2>&1; then
  fail "removed demo target is still callable"
fi
if rg -n --glob '!target-review-all13/**' --glob '!scripts/test-source-workflow.sh' 'make demo|^demo:' "$ROOT" >"$TMP/demo.matches"; then
  cat "$TMP/demo.matches" >&2
  fail "maintained source still references the removed demo target"
fi

source_binary="$TMP/source binary"
printf '%s\n' '#!/bin/sh' "printf '%s\\n' source-build" >"$source_binary"
chmod +x "$source_binary"
install_dir="$TMP/install path/with spaces"
"$ROOT/scripts/install-dev.sh" "$source_binary" "$install_dir" nac-my-branch
[[ -x "$install_dir/nac-my-branch" ]] || fail "custom binary was not installed"
[[ "$("$install_dir/nac-my-branch")" == source-build ]] || fail "installed binary changed"
for unsafe in '' nac-web .hidden '../escape' 'nested/name' 'white space'; do
  if "$ROOT/scripts/install-dev.sh" "$source_binary" "$install_dir" "$unsafe" >"$TMP/install.out" 2>&1; then
    fail "unsafe DEV_BIN_NAME was accepted: '$unsafe'"
  fi
done

# Build scripts must resolve the current checkout when Cargo reuses their
# executables from a moved target cache. Compile once, remove the original
# checkout, then run those same executables with Cargo's new runtime paths.
original_checkout="$TMP/original checkout"
relocated_checkout="$TMP/relocated checkout"
for crate in nac-contracts nac-server; do
  mkdir -p "$original_checkout/crates/$crate"
  CARGO_MANIFEST_DIR="$original_checkout/crates/$crate" \
    "${RUSTC:-rustc}" --edition=2021 "$ROOT/crates/$crate/build.rs" -o "$TMP/$crate-build"
done
mv "$original_checkout" "$relocated_checkout"
for version in 1.2.3 1.2.4; do
  printf '%s\n' "$version" >"$relocated_checkout/version.txt"
  for crate in nac-contracts nac-server; do
    manifest_dir="$relocated_checkout/crates/$crate"
    build_output="$(cd "$manifest_dir" && \
      CARGO_MANIFEST_DIR="$manifest_dir" NAC_BUILD_TRACK=dev \
        "$TMP/$crate-build")"
    [[ "$build_output" == *"cargo:rustc-env=NAC_PRODUCT_VERSION=$version"* ]] || \
      fail "$crate did not read version $version from the relocated checkout"
    [[ "$build_output" == *"cargo:rerun-if-changed=$manifest_dir/../../version.txt"* ]] || \
      fail "$crate did not watch the relocated version file"
  done
done
printf '%s\n' '1.2.4-beta' >"$relocated_checkout/version.txt"
for crate in nac-contracts nac-server; do
  manifest_dir="$relocated_checkout/crates/$crate"
  if (cd "$manifest_dir" && \
      CARGO_MANIFEST_DIR="$manifest_dir" NAC_BUILD_TRACK=dev \
        "$TMP/$crate-build") >"$TMP/$crate-invalid-version.log" 2>&1; then
    fail "$crate accepted a prerelease as a stable version"
  fi
  grep -F 'version.txt must contain one stable semantic version' \
    "$TMP/$crate-invalid-version.log" >/dev/null || \
    fail "$crate failed without validating the relocated version"
done

fake_bin="$TMP/fake-bin"
mkdir -p "$fake_bin"
cat >"$fake_bin/cargo" <<'EOF'
#!/bin/sh
exit "${FAKE_CARGO_STATUS:-0}"
EOF
cat >"$fake_bin/curl" <<'EOF'
#!/bin/sh
for url do :; done
# Simulate an already-running NAC, or a foreign listener that answers /health
# with an HTTP error and anything else as a non-HTTP socket (curl status 52).
case "$url" in
  "${FAKE_CURL_NAC:-unset}"*) exit 0 ;;
  "${FAKE_CURL_OTHER:-unset}"/health) exit 22 ;;
  "${FAKE_CURL_OTHER:-unset}"*) exit 52 ;;
  # A banner such as SSH's makes curl report an unsupported protocol.
  "${FAKE_CURL_BANNER:-unset}"*) exit 1 ;;
esac
# Otherwise a port is free (connection refused) until its fake process starts.
case "$url" in
  */health) [ -f "${FAKE_BACKEND_LEADER:?}" ] || exit 7 ;;
  *) [ -f "${FAKE_VITE_LEADER:?}" ] || exit 7 ;;
esac
EOF
cat >"$fake_bin/npm" <<'EOF'
#!/bin/sh
printf '%s\n' "$NAC_API_URL $*" >"${FAKE_VITE_ARGS:?}"
printf '%s\n' "$$" >"${FAKE_VITE_LEADER:?}"
if [ "${FAKE_VITE_FAIL:-0}" = 1 ]; then exit 23; fi
sh -c 'trap "exit 0" TERM INT; while :; do sleep 1; done' &
printf '%s\n' "$!" >"${FAKE_VITE_DESCENDANT:?}"
trap 'exit 0' TERM INT
while :; do sleep 1; done
EOF
cat >"$fake_bin/sleep" <<'EOF'
#!/bin/sh
if [ -n "${FAKE_SLEEP_LOG:-}" ]; then
  pgid=$(/bin/ps -o pgid= -p "$$")
  printf '%s %s %s\n' "$$" "$PPID" "$pgid" >>"$FAKE_SLEEP_LOG"
fi
exec /bin/sleep "$@"
EOF
cat >"$TMP/backend" <<'EOF'
#!/bin/sh
printf '%s\n' "$$" >"${FAKE_BACKEND_LEADER:?}"
printf '%s\n' "$*" >"${FAKE_BACKEND_ARGS:?}"
sh -c 'trap "exit 0" TERM INT; while :; do sleep 1; done' &
printf '%s\n' "$!" >"${FAKE_BACKEND_DESCENDANT:?}"
if [ "${FAKE_BACKEND_FAIL:-0}" = 1 ]; then exit 17; fi
trap 'exit 0' TERM INT
while :; do sleep 1; done
EOF
chmod +x "$fake_bin/cargo" "$fake_bin/curl" "$fake_bin/npm" "$fake_bin/sleep" "$TMP/backend"

run_supervisor() {
  local label=$1
  FAKE_BACKEND_LEADER="$TMP/$label-backend-leader" \
  FAKE_BACKEND_DESCENDANT="$TMP/$label-backend-child" \
  FAKE_BACKEND_ARGS="$TMP/$label-backend-args" \
  FAKE_VITE_LEADER="$TMP/$label-vite-leader" \
  FAKE_VITE_ARGS="$TMP/$label-vite-args" \
  FAKE_VITE_DESCENDANT="$TMP/$label-vite-child" \
  FAKE_SLEEP_LOG="$TMP/$label-sleep-groups" \
  NAC_DEV_SERVER_BIN="$TMP/backend" \
  DEV_BIND=127.0.0.1:43210 VITE_PORT=45173 DEV_OPEN=0 PATH="$fake_bin:$PATH" \
    "$ROOT/start_dev.sh" >"$TMP/$label.log" 2>&1 &
  SUPERVISOR_PID=$!
}

run_supervisor interrupt
for _ in $(seq 1 100); do
  [[ -f "$TMP/interrupt-backend-leader" && -f "$TMP/interrupt-backend-child" && \
     -f "$TMP/interrupt-vite-leader" && -f "$TMP/interrupt-vite-child" ]] && break
  kill -0 "$SUPERVISOR_PID" 2>/dev/null || fail "supervisor exited before becoming ready"
  sleep 0.05
done
[[ -f "$TMP/interrupt-backend-leader" && -f "$TMP/interrupt-backend-child" && \
   -f "$TMP/interrupt-vite-leader" && -f "$TMP/interrupt-vite-child" ]] || \
  fail "fake process trees were not started"
grep -F -- '--bind 127.0.0.1:43210' "$TMP/interrupt-backend-args" >/dev/null || fail "DEV_BIND did not reach nac-web"
grep -F -- 'http://127.0.0.1:43210 --prefix crates/nac-server/web run dev -- --host 127.0.0.1 --port 45173' "$TMP/interrupt-vite-args" \
  >/dev/null || fail "DEV_BIND/VITE_PORT did not reach the Vite proxy and port"
backend_leader=$(cat "$TMP/interrupt-backend-leader")
vite_leader=$(cat "$TMP/interrupt-vite-leader")
backend_pgid=$(/bin/ps -o pgid= -p "$backend_leader")
vite_pgid=$(/bin/ps -o pgid= -p "$vite_leader")
[[ "$backend_pgid" -eq "$backend_leader" ]] || fail "backend does not lead its process group"
[[ "$vite_pgid" -eq "$vite_leader" ]] || fail "Vite does not lead its process group"
supervisor_pgid=$(/bin/ps -o pgid= -p "$SUPERVISOR_PID")
poll_pgid=""
for _ in $(seq 1 100); do
  if [[ -f "$TMP/interrupt-sleep-groups" ]]; then
    poll_pgid=$(awk -v parent="$SUPERVISOR_PID" '$2 == parent { print $3; exit }' \
      "$TMP/interrupt-sleep-groups")
    [[ -n "$poll_pgid" ]] && break
  fi
  sleep 0.05
done
[[ -n "$poll_pgid" ]] || fail "supervisor polling sleep was not observed"
[[ "$poll_pgid" -eq "$supervisor_pgid" ]] || fail "supervisor polling unexpectedly used monitor mode"
backend_child=$(cat "$TMP/interrupt-backend-child")
vite_child=$(cat "$TMP/interrupt-vite-child")
kill -TERM "$SUPERVISOR_PID"
if wait "$SUPERVISOR_PID"; then
  fail "TERM unexpectedly returned success"
else
  status=$?
fi
[[ "$status" -eq 143 ]] || fail "TERM returned $status instead of 143"
sleep 0.2
kill -0 "$backend_child" 2>/dev/null && fail "backend descendant survived cleanup"
kill -0 "$vite_child" 2>/dev/null && fail "Vite descendant survived cleanup"

FAKE_BACKEND_FAIL=1 run_supervisor backend-failure
if wait "$SUPERVISOR_PID"; then
  fail "backend startup failure unexpectedly succeeded"
else
  status=$?
fi
[[ "$status" -eq 17 ]] || fail "backend failure returned $status instead of 17"
[[ -f "$TMP/backend-failure-backend-child" ]] || fail "failing backend did not start its descendant"
backend_failure_child=$(cat "$TMP/backend-failure-backend-child")
sleep 0.2
kill -0 "$backend_failure_child" 2>/dev/null && fail "descendant of exited backend survived cleanup"

# An occupied address is refused before anything starts, naming the override.
expect_collision() {
  local label=$1 expected_owner=$2 expected_hint=$3
  if wait "$SUPERVISOR_PID"; then
    fail "$label collision unexpectedly succeeded"
  fi
  grep -F -- "$expected_owner" "$TMP/$label.log" >/dev/null || \
    fail "$label collision did not name the occupied address: $(cat "$TMP/$label.log")"
  grep -F -- "$expected_hint" "$TMP/$label.log" >/dev/null || \
    fail "$label collision did not name the supported override"
  [[ ! -f "$TMP/$label-backend-leader" && ! -f "$TMP/$label-vite-leader" ]] || \
    fail "$label collision still started a process"
}
FAKE_CURL_NAC=http://127.0.0.1:43210 run_supervisor nac-collision
expect_collision nac-collision 'NAC is already responding at http://127.0.0.1:43210 (DEV_BIND)' \
  'DEV_BIND=127.0.0.1:4321 make dev'
FAKE_CURL_OTHER=http://127.0.0.1:43210 run_supervisor api-collision
expect_collision api-collision 'another process is already listening at http://127.0.0.1:43210 (DEV_BIND)' \
  'DEV_BIND=127.0.0.1:4321 make dev'
FAKE_CURL_BANNER=http://127.0.0.1:43210 run_supervisor banner-collision
expect_collision banner-collision 'another process is already listening at http://127.0.0.1:43210 (DEV_BIND)' \
  'DEV_BIND=127.0.0.1:4321 make dev'
FAKE_CURL_OTHER=http://127.0.0.1:45173 run_supervisor app-collision
expect_collision app-collision 'another process is already listening at http://127.0.0.1:45173 (VITE_PORT)' \
  'VITE_PORT=5174 make dev'

echo "source workflow contracts passed"
