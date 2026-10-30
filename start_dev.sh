#!/usr/bin/env bash
# Frontend development: nac-web serving the API plus the Vite dev server with
# React Fast Refresh in front of it.
#
# Vite owns the browser origin and proxies the API routes to nac-web, so the app
# is same-origin and needs no CORS handling. Open the Vite URL, not the API one.
#
#   ./start_dev.sh
#     API   http://127.0.0.1:3210
#     app   http://localhost:5173   (opens in the browser)
#
# The dev server also enables LocatorJS: hold Alt and click a rendered element to
# open its source. It is absent from the committed build that ./start.sh serves.
#
# Environment:
#   DEV_BIND      address nac-web binds to (default 127.0.0.1:3210); Vite's
#                 proxy follows it, so no matching frontend override is needed
#   DEV_STORE_PATH optional authoritative store-path override
#   VITE_HOST     Vite host (default 127.0.0.1)
#   VITE_PORT     port for the Vite dev server (default 5173)
#   NAC_PROFILE   cargo profile for nac-web: debug (default) or release
#   DEV_OPEN      1 to open the Vite URL, 0 to leave it terminal-only

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BIND="${DEV_BIND:-127.0.0.1:3210}"
VITE_PORT="${VITE_PORT:-5173}"
VITE_HOST="${VITE_HOST:-127.0.0.1}"
PROFILE="${NAC_PROFILE:-debug}"
DEV_OPEN="${DEV_OPEN:-1}"
WEB_DIR="crates/nac-server/web"

for tool in cargo npm curl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "start_dev.sh: $tool not found." >&2
    case "$tool" in
      cargo) echo "Install Rust from https://rustup.rs" >&2 ;;
      npm) echo "Install Node.js from https://nodejs.org" >&2 ;;
    esac
    exit 1
  fi
done

case "$PROFILE" in
  release) CARGO_PROFILE_ARGS=(--release) ;;
  debug) CARGO_PROFILE_ARGS=() ;;
  *)
    echo "start_dev.sh: NAC_PROFILE must be 'release' or 'debug', got '$PROFILE'" >&2
    exit 1
    ;;
esac

echo "==> building nac-web ($PROFILE)"
# The `${arr[@]+...}` guard keeps an empty array from tripping `set -u` on the
# bash 3.2 that ships with macOS.
"${CARGO:-cargo}" build --locked ${CARGO_PROFILE_ARGS[@]+"${CARGO_PROFILE_ARGS[@]}"} \
  -p nac-server --bin nac-web

BACKEND_PID=""
VITE_PID=""
cleanup_started=false

job_is_running() {
  local wanted="$1"
  local running
  for running in $(jobs -pr); do
    [[ "$running" == "$wanted" ]] && return 0
  done
  return 1
}

process_group_is_running() {
  local pid="$1"
  kill -0 "-$pid" 2>/dev/null
}

terminate_group() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  # The job leader may already have exited while one of its descendants is
  # still alive. Probe the process group itself so cleanup still reaches those
  # descendants instead of relying on Bash's now-completed job table entry.
  if process_group_is_running "$pid"; then
    kill -TERM "-$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do
      process_group_is_running "$pid" || break
      sleep 0.1
    done
    if process_group_is_running "$pid"; then
      kill -KILL "-$pid" 2>/dev/null || true
    fi
  fi
  wait "$pid" 2>/dev/null || true
}

cleanup() {
  [[ "$cleanup_started" == false ]] || return 0
  cleanup_started=true
  terminate_group "$VITE_PID"
  terminate_group "$BACKEND_PID"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Non-interactive Bash otherwise keeps every background child in this script's
# process group. Enable monitor mode only while launching each long-lived tree
# leader. Leaving it enabled globally also makes short-lived readiness and
# watchdog commands create process groups, which can trigger Apple Bash 3.2's
# intermittent `child setpgid ... Operation not permitted` warning.

API_URL="http://$BIND"
APP_URL="http://$VITE_HOST:$VITE_PORT"

# Refuse an occupied address up front and name the override for it. Never stop,
# reuse, or silently move away from a process this script did not start.
# curl exits 0 for any HTTP answer, 52/56 for a listener that is not HTTP, and
# 28 for one that accepts but never answers. A free port refuses (7).
port_in_use() {
  local status=0
  curl -sS --noproxy '*' --connect-timeout 1 --max-time 2 -o /dev/null -- "$1" \
    >/dev/null 2>&1 || status=$?
  [[ "$status" -eq 0 || "$status" -eq 28 || "$status" -eq 52 || "$status" -eq 56 ]]
}

if curl -fsS --noproxy '*' --connect-timeout 1 --max-time 2 -- "$API_URL/health" >/dev/null 2>&1; then
  echo "start_dev.sh: NAC is already responding at $API_URL (DEV_BIND)." >&2
  echo "start_dev.sh: stop it, or choose another API address: DEV_BIND=127.0.0.1:4321 make dev" >&2
  exit 1
fi
if port_in_use "$API_URL/"; then
  echo "start_dev.sh: another process is already listening at $API_URL (DEV_BIND)." >&2
  echo "start_dev.sh: stop it, or choose another API address: DEV_BIND=127.0.0.1:4321 make dev" >&2
  exit 1
fi
if port_in_use "$APP_URL/"; then
  echo "start_dev.sh: another process is already listening at $APP_URL (VITE_PORT)." >&2
  echo "start_dev.sh: stop it, or choose another app port: VITE_PORT=5174 make dev" >&2
  exit 1
fi

echo "==> Rust API: $API_URL"
# The browser should open on the Vite origin below, not the API bind.
# `-y` skips the project-folder prompt so a backgrounded API never blocks.
SERVER_ARGS=(--bind "$BIND" --no-open -y)
if [[ -n "${DEV_STORE_PATH:-}" ]]; then
  SERVER_ARGS+=(--store-path "$DEV_STORE_PATH")
fi
set -m
"${NAC_DEV_SERVER_BIN:-target/$PROFILE/nac-web}" "${SERVER_ARGS[@]}" &
BACKEND_PID=$!
set +m

# Vite would otherwise start proxying to a socket that is not listening yet and
# the first requests would fail with a connection error.
backend_ready=false
for _ in $(seq 1 150); do
  if curl -fsS --noproxy '*' --connect-timeout 1 --max-time 2 -- "$API_URL/health" >/dev/null 2>&1; then
    backend_ready=true
    break
  fi
  if ! job_is_running "$BACKEND_PID"; then
    echo "start_dev.sh: nac-web exited during startup" >&2
    if wait "$BACKEND_PID"; then exit 1; else exit $?; fi
  fi
  sleep 0.2
done
if [[ "$backend_ready" != true ]]; then
  echo "start_dev.sh: timed out waiting for $API_URL/health" >&2
  exit 1
fi

echo "==> Vite/HMR app: $APP_URL"
# Vite runs in the background so that a signal reaching this script is handled
# right away instead of after the foreground child returns. `--open` opens the
# app origin (not the API) once Vite is ready — same idea as Storybook.
VITE_ARGS=(--host "$VITE_HOST" --port "$VITE_PORT")
if [[ "$DEV_OPEN" == 1 ]]; then
  VITE_ARGS+=(--open)
elif [[ "$DEV_OPEN" != 0 ]]; then
  echo "start_dev.sh: DEV_OPEN must be 0 or 1, got '$DEV_OPEN'" >&2
  exit 2
fi
set -m
NAC_API_URL="$API_URL" \
  npm --prefix "$WEB_DIR" run dev -- "${VITE_ARGS[@]}" &
VITE_PID=$!
set +m

frontend_ready=false
for _ in $(seq 1 150); do
  if curl -fsS --noproxy '*' --connect-timeout 1 --max-time 2 -- "$APP_URL/" >/dev/null 2>&1; then
    frontend_ready=true
    break
  fi
  if ! job_is_running "$BACKEND_PID"; then
    echo "start_dev.sh: nac-web exited while Vite was starting" >&2
    if wait "$BACKEND_PID"; then exit 1; else exit $?; fi
  fi
  if ! job_is_running "$VITE_PID"; then
    echo "start_dev.sh: Vite exited during startup" >&2
    if wait "$VITE_PID"; then exit 1; else exit $?; fi
  fi
  sleep 0.2
done
if [[ "$frontend_ready" != true ]]; then
  echo "start_dev.sh: timed out waiting for $APP_URL/" >&2
  exit 1
fi

echo "==> development stack ready; press Ctrl-C to stop both process trees"
while true; do
  if ! job_is_running "$BACKEND_PID"; then
    echo "start_dev.sh: nac-web exited; stopping Vite" >&2
    if wait "$BACKEND_PID"; then exit 1; else exit $?; fi
  fi
  if ! job_is_running "$VITE_PID"; then
    echo "start_dev.sh: Vite exited; stopping nac-web" >&2
    if wait "$VITE_PID"; then exit 1; else exit $?; fi
  fi
  sleep 0.1
done
