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
#   NAC_BIND      address nac-web binds to (default 127.0.0.1:3210)
#   VITE_PORT     port for the Vite dev server (default 5173)
#   NAC_PROFILE   cargo profile for nac-web: debug (default) or release

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BIND="${NAC_BIND:-127.0.0.1:3210}"
VITE_PORT="${VITE_PORT:-5173}"
PROFILE="${NAC_PROFILE:-debug}"
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

DEPENDENCY_STAMP_DIR="$WEB_DIR/node_modules/.nac-dependencies"
DEPENDENCIES_CURRENT=true
for file in package.json package-lock.json; do
  if [[ -f "$WEB_DIR/$file" ]]; then
    cmp -s "$WEB_DIR/$file" "$DEPENDENCY_STAMP_DIR/$file" || DEPENDENCIES_CURRENT=false
  elif [[ -f "$DEPENDENCY_STAMP_DIR/$file" ]]; then
    DEPENDENCIES_CURRENT=false
  fi
done

if [[ "$DEPENDENCIES_CURRENT" != true ]]; then
  echo "==> installing frontend dependencies"
  if [[ -f "$WEB_DIR/package-lock.json" ]]; then
    npm --prefix "$WEB_DIR" ci
  else
    npm --prefix "$WEB_DIR" install
  fi

  mkdir -p "$DEPENDENCY_STAMP_DIR"
  cp "$WEB_DIR/package.json" "$DEPENDENCY_STAMP_DIR/package.json"
  if [[ -f "$WEB_DIR/package-lock.json" ]]; then
    cp "$WEB_DIR/package-lock.json" "$DEPENDENCY_STAMP_DIR/package-lock.json"
  else
    rm -f "$DEPENDENCY_STAMP_DIR/package-lock.json"
  fi
fi

echo "==> building nac-web ($PROFILE)"
# The `${arr[@]+...}` guard keeps an empty array from tripping `set -u` on the
# bash 3.2 that ships with macOS.
cargo build ${CARGO_PROFILE_ARGS[@]+"${CARGO_PROFILE_ARGS[@]}"} \
  -p nac-server --bin nac-web

BACKEND_PID=""
VITE_PID=""
cleanup() {
  echo
  for pid in "$VITE_PID" "$BACKEND_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

echo "==> starting nac-web on http://$BIND"
# The browser should open on the Vite origin below, not the API bind.
# `-y` skips the project-folder prompt so a backgrounded API never blocks.
"target/$PROFILE/nac-web" --bind "$BIND" --no-open -y &
BACKEND_PID=$!

# Vite would otherwise start proxying to a socket that is not listening yet and
# the first requests would fail with a connection error.
for _ in $(seq 1 50); do
  if curl -sf -o /dev/null "http://$BIND/health"; then
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "start_dev.sh: nac-web exited during startup" >&2
    exit 1
  fi
  sleep 0.2
done

echo "==> vite dev server on http://localhost:$VITE_PORT"
# Vite runs in the background so that a signal reaching this script is handled
# right away instead of after the foreground child returns. `--open` opens the
# app origin (not the API) once Vite is ready — same idea as Storybook.
NAC_API_URL="http://$BIND" \
  npm --prefix "$WEB_DIR" run dev -- --port "$VITE_PORT" --open &
VITE_PID=$!
wait "$VITE_PID" || true
