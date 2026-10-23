#!/bin/sh
# Immutable upstream v2.7.0 release assets, verified against GitHub release digests.
set -eu
destination=${1:?usage: install-osv-scanner.sh DESTINATION}
case "$(uname -s)/$(uname -m)" in
  Linux/x86_64) asset=linux_amd64; sha=160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b ;;
  Linux/aarch64|Linux/arm64) asset=linux_arm64; sha=4061ef4c021ed3c47f203b818f337e351336cc5cd67c0274fc36bd1dfc728dd7 ;;
  Darwin/arm64) asset=darwin_arm64; sha=d4926ef8da134332543be276dff157e4c170f99ad91fc48e89448a8816bdf70b ;;
  Darwin/x86_64) asset=darwin_amd64; sha=e82c5df7ab0a42dff29a1cd0660711447b56b4c0483ff66ad8634df10fd81a45 ;;
  *) echo 'unsupported OSV scanner platform' >&2; exit 1 ;;
esac
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
curl --fail --location --retry 2 --connect-timeout 20 --max-time 180 \
  "https://github.com/google/osv-scanner/releases/download/v2.7.0/osv-scanner_$asset" \
  --output "$temporary/osv-scanner"
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$temporary/osv-scanner" | cut -d ' ' -f 1)
else
  actual=$(shasum -a 256 "$temporary/osv-scanner" | cut -d ' ' -f 1)
fi
test "$actual" = "$sha" || { echo 'OSV scanner checksum mismatch' >&2; exit 1; }
chmod 755 "$temporary/osv-scanner"
mkdir -p "$(dirname "$destination")"
mv "$temporary/osv-scanner" "$destination"
