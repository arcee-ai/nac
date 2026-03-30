#!/bin/sh
set -eu

REPO="${NAC_REPO:-sapiosaturn/nac}"
CHANNEL="${NAC_CHANNEL:-edge}"
BASE_URL="${NAC_BASE_URL:-https://github.com/${REPO}/releases/download}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

detect_target() {
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin)
      case "$arch" in
        arm64|aarch64)
          echo "aarch64-apple-darwin"
          ;;
        x86_64)
          echo "x86_64-apple-darwin"
          ;;
        *)
          echo "unsupported macOS architecture: $arch" >&2
          exit 1
          ;;
      esac
      ;;
    Linux)
      case "$arch" in
        x86_64|amd64)
          echo "x86_64-unknown-linux-gnu"
          ;;
        *)
          echo "unsupported Linux architecture: $arch" >&2
          exit 1
          ;;
      esac
      ;;
    *)
      echo "unsupported operating system: $os" >&2
      exit 1
      ;;
  esac
}

download() {
  url="$1"
  output="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$output"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$output" "$url"
  else
    echo "need curl or wget to install nac" >&2
    exit 1
  fi
}

target="$(detect_target)"
asset="nac-${target}.tar.gz"
url="${BASE_URL}/${CHANNEL}/${asset}"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT INT TERM

archive="$tmpdir/$asset"
download "$url" "$archive"

mkdir -p "$INSTALL_DIR"
tar -xzf "$archive" -C "$tmpdir"
install -m 755 "$tmpdir/nac" "$INSTALL_DIR/nac"

echo "installed nac to $INSTALL_DIR/nac"

case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    ;;
  *)
    echo "add $INSTALL_DIR to your PATH to run nac directly"
    ;;
esac
