#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$repo_root/target/mcp-conformance"
exec node "$repo_root/scripts/mcp-conformance/run.mjs" "$@"
