#!/bin/sh
set -eu

root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT INT TERM
mkdir -p "$root/bin" "$root/archive" "$root/stable" "$root/rc"

cat > "$root/bin/uname" <<'EOF'
#!/bin/sh
case "$1" in
  -s) echo Linux ;;
  -m) echo x86_64 ;;
  *) exit 1 ;;
esac
EOF

cat > "$root/bin/curl" <<'EOF'
#!/bin/sh
url=""
output=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      output="$2"
      shift 2
      ;;
    -*) shift ;;
    *)
      url="$1"
      shift
      ;;
  esac
done
printf '%s\n' "$url" >> "$URL_LOG"
cp "$FIXTURE_ARCHIVE" "$output"
EOF
chmod +x "$root/bin/uname" "$root/bin/curl"

cat > "$root/archive/nac-web" <<'EOF'
#!/bin/sh
echo fixture
EOF
printf 'fixture license\n' > "$root/archive/LICENSE"
chmod +x "$root/archive/nac-web"
tar -czf "$root/nac-x86_64-unknown-linux-musl.tar.gz" -C "$root/archive" nac-web LICENSE

export PATH="$root/bin:$PATH"
export FIXTURE_ARCHIVE="$root/nac-x86_64-unknown-linux-musl.tar.gz"
export URL_LOG="$root/urls"

stable_output="$(INSTALL_DIR="$root/stable" sh scripts/install.sh)"
test "$(cat "$URL_LOG")" = "https://github.com/arcee-ai/nac/releases/latest/download/nac-x86_64-unknown-linux-musl.tar.gz"
case "$stable_output" in
  *"downloaded nac-x86_64-unknown-linux-musl.tar.gz from the latest release"*) ;;
  *) echo "stable install output did not retain latest-release label" >&2; exit 1 ;;
esac
test -x "$root/stable/nac-web"

: > "$URL_LOG"
rc_output="$(
  INSTALL_DIR="$root/rc" \
  NAC_BASE_URL="https://github.example/test/repo/releases/download/v0.1.2-rc.10" \
  NAC_RELEASE_LABEL="v0.1.2-rc.10" \
  sh scripts/install.sh
)"
test "$(cat "$URL_LOG")" = "https://github.example/test/repo/releases/download/v0.1.2-rc.10/nac-x86_64-unknown-linux-musl.tar.gz"
case "$rc_output" in
  *"downloaded nac-x86_64-unknown-linux-musl.tar.gz from v0.1.2-rc.10"*) ;;
  *) echo "RC install output did not identify the exact release" >&2; exit 1 ;;
esac
test -x "$root/rc/nac-web"
