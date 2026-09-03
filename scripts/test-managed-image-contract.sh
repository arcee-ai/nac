#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
dockerfile="$repo_root/docker/managed/Dockerfile"
entrypoint="$repo_root/docker/managed/entrypoint.sh"
workflow="$repo_root/.github/workflows/managed-image.yml"

fail() {
    printf 'managed image contract: %s\n' "$1" >&2
    exit 1
}

require_literal() {
    file=$1
    literal=$2
    grep -F -- "$literal" "$file" >/dev/null || fail "missing '$literal' in ${file#"$repo_root"/}"
}

require_literal "$dockerfile" 'FROM --platform=linux/amd64 debian:bookworm-slim@sha256:'
require_literal "$dockerfile" 'useradd --uid 10001 --gid 10001'
require_literal "$dockerfile" 'USER 10001:10001'
require_literal "$dockerfile" 'ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/nac-managed-entrypoint"]'
require_literal "$dockerfile" 'RUST_VERSION=1.98.0'
require_literal "$dockerfile" 'NODE_VERSION=24.20.0'
require_literal "$dockerfile" 'GO_VERSION=1.27.0'
require_literal "$dockerfile" 'UV_VERSION=0.12.1'
require_literal "$dockerfile" 'corepack enable'
require_literal "$dockerfile" 'fd-find'
require_literal "$dockerfile" '/var/lib/nac'
require_literal "$dockerfile" '/repositories'
require_literal "$dockerfile" '/home/nac'
require_literal "$dockerfile" '/run/nac'
require_literal "$dockerfile" '/run/secrets/nac'

require_literal "$entrypoint" '--bind 0.0.0.0:3210'
require_literal "$entrypoint" '--allow-remote'
require_literal "$entrypoint" '--store-path /var/lib/nac/nac.sqlite3'
require_literal "$entrypoint" '--managed-config "$managed_config"'
require_literal "$entrypoint" 'without requiring the bootstrap mount'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'model_credential_source = \"managed-bootstrap\"'
require_literal "$repo_root/scripts/smoke-managed-image.sh" '/run/secrets/nac/bootstrap.json'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'assert_bootstrap_required'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'kill --signal KILL'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'start_container without-bootstrap'
require_literal "$repo_root/docker/managed/fixtures/bootstrap.json" '"client_id": "managed-nac"'
if grep -Eq '(^|[[:space:]])(sudo|su)([[:space:]]|$)' "$dockerfile" "$entrypoint"; then
    fail 'image or entrypoint grants an escalation command'
fi

require_literal "$workflow" 'platforms: linux/amd64'
require_literal "$workflow" 'push: false'
require_literal "$workflow" 'provenance: false'
require_literal "$workflow" 'sbom: false'
require_literal "$workflow" 'run: make ci'
if grep -Eq '(id-token:[[:space:]]*write|aws-actions/|amazon-ecr|ECR_|push:[[:space:]]*true|environment:[[:space:]]*dev)' "$workflow"; then
    fail 'public repository workflow must remain build-and-smoke only'
fi

printf '%s\n' 'managed image contract: ok'
