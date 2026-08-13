#!/bin/sh
set -eu

REPO="${NAC_REPO:-arcee-ai/nac}"
BASE_URL="${NAC_BASE_URL:-https://github.com/${REPO}/releases/latest/download}"
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
        *)
          echo "unsupported macOS architecture: $arch (Apple Silicon only for now)" >&2
          exit 1
          ;;
      esac
      ;;
    Linux)
      case "$arch" in
        x86_64|amd64)
          echo "x86_64-unknown-linux-musl"
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
url="${BASE_URL}/${asset}"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT INT TERM

archive="$tmpdir/$asset"
download "$url" "$archive"

mkdir -p "$INSTALL_DIR"
tar -xzf "$archive" -C "$tmpdir"
install -m 755 "$tmpdir/nac-web" "$INSTALL_DIR/nac-web"

echo "downloaded $asset from the latest release"
echo "installed nac-web to $INSTALL_DIR/nac-web"

case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    ;;
  *)
    echo "add $INSTALL_DIR to your PATH to run nac-web directly"
    ;;
esac

cat <<'EOF'

Next steps – pick how you'll talk to models:

  nac-web arcee-auth login
      # recommended: Arcee account → open / Trinity models (no API key)

  nac-web codex-auth login
      # ChatGPT account → OpenAI / Codex models

Or skip login and set a model plus the provider's conventional API key
env var — a bare model is usually enough (base URL and key env resolve
from the embedded catalog; see the README).

Then cd into your project and run (confirms the folder, then opens the UI):

  nac-web

EOF
