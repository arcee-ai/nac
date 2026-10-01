#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
runner='@modelcontextprotocol/conformance@0.2.0-alpha.11'
baseline="$repo_root/scripts/mcp-conformance/expected-failures.yml"
client="cargo run --quiet --manifest-path $repo_root/Cargo.toml -p nac-core --features test-support --example mcp_conformance_client --"

for revision in 2025-11-25 2026-07-28; do
  printf '%s\n' "Running official MCP client conformance for $revision"
  npx --yes "$runner" client \
    --command "$client" \
    --requirements "$revision" \
    --expected-failures "$baseline"
done
