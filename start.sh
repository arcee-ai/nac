#!/usr/bin/env bash
# Run nac-web serving the frontend build committed in the repository.
#
# Needs only a Rust toolchain: the bundle under crates/nac-server/assets/dist is
# committed and embedded into the binary, so no Node install is involved.
#
#   ./start.sh                      # http://127.0.0.1:3210 (opens the browser)
#   ./start.sh --bind 0.0.0.0:8080  # extra args go straight to nac-web
#   ./start.sh --no-open            # keep the terminal-only workflow
#
# Environment:
#   NAC_BIND      address to bind when --bind is not passed (default 127.0.0.1:3210)
#   NAC_PROFILE   cargo profile: release (default) or debug
#   BROWSER=none  same as passing --no-open to nac-web

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BIND="${NAC_BIND:-127.0.0.1:3210}"
PROFILE="${NAC_PROFILE:-release}"
DIST="crates/nac-server/assets/dist"

if ! command -v cargo >/dev/null 2>&1; then
  echo "start.sh: cargo not found. Install Rust from https://rustup.rs" >&2
  exit 1
fi

if [[ ! -f "$DIST/index.html" ]]; then
  echo "start.sh: missing $DIST/index.html" >&2
  echo "The committed frontend build is absent. Rebuild it with:" >&2
  echo "  npm --prefix crates/nac-server/web ci" >&2
  echo "  npm --prefix crates/nac-server/web run build" >&2
  exit 1
fi

case "$PROFILE" in
  release) CARGO_PROFILE_ARGS=(--release) ;;
  debug) CARGO_PROFILE_ARGS=() ;;
  *)
    echo "start.sh: NAC_PROFILE must be 'release' or 'debug', got '$PROFILE'" >&2
    exit 1
    ;;
esac

echo "==> building nac-web ($PROFILE)"
# The `${arr[@]+...}` guard keeps an empty array from tripping `set -u` on the
# bash 3.2 that ships with macOS.
cargo build ${CARGO_PROFILE_ARGS[@]+"${CARGO_PROFILE_ARGS[@]}"} \
  -p nac-server --bin nac-web

# An explicit --bind in the caller's arguments wins over NAC_BIND.
BIND_ARGS=(--bind "$BIND")
prev=""
for arg in "$@"; do
  if [[ "$prev" == "--bind" ]]; then
    BIND="$arg"
  elif [[ "$arg" == --bind=* ]]; then
    BIND="${arg#--bind=}"
  fi
  if [[ "$arg" == "--bind" || "$arg" == --bind=* ]]; then
    BIND_ARGS=()
  fi
  prev="$arg"
done

echo "==> nac-web on http://$BIND"
# Accept cwd (this repo after `cd` above) unless the caller already passed -C/-y.
YES_ARGS=(-y)
prev=""
for arg in "$@"; do
  if [[ "$arg" == "-y" || "$arg" == "--yes" || "$arg" == "-C" || "$arg" == --directory=* ]]; then
    YES_ARGS=()
    break
  fi
  if [[ "$prev" == "-C" || "$prev" == "--directory" ]]; then
    YES_ARGS=()
    break
  fi
  prev="$arg"
done
exec "target/$PROFILE/nac-web" \
  ${BIND_ARGS[@]+"${BIND_ARGS[@]}"} ${YES_ARGS[@]+"${YES_ARGS[@]}"} ${1+"$@"}
