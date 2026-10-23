#!/bin/sh
set -eu
lock=/recipe/sources.lock.json
mkdir -p /work/downloads
cd /work/downloads
jq -r '.downloads | to_entries[] | [.key, .value.url, .value.sha256] | @tsv' "$lock" |
while IFS="$(printf '\t')" read -r name url sha; do
    curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error "$url" -o "$name"
    printf '%s  %s\n' "$sha" "$name" | sha256sum -c -
done
