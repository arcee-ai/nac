#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
dockerfile="$repo_root/docker/managed/Dockerfile"
entrypoint="$repo_root/docker/managed/entrypoint.sh"
workflow="$repo_root/.github/workflows/managed-image.yml"
lfs_smoke="$repo_root/scripts/smoke-managed-git-lfs.sh"
terminal_smoke="$repo_root/scripts/smoke-managed-terminal.py"
managed_status="$repo_root/crates/nac-server/src/managed_status.rs"
capability_check="$repo_root/docker/managed/check-process-capabilities.sh"
capability_fixtures="$repo_root/docker/managed/fixtures"

fail() {
    printf 'managed image contract: %s\n' "$1" >&2
    exit 1
}

require_literal() {
    file=$1
    literal=$2
    grep -F -- "$literal" "$file" >/dev/null || fail "missing '$literal' in ${file#"$repo_root"/}"
}

require_literal "$dockerfile" 'FROM --platform=linux/amd64 cgr.dev/chainguard/wolfi-base@sha256:76811b6958657eb28da6f2ce79bbb97516e5818df442a086e94ab4c67303608b'
require_literal "$dockerfile" 'apk --no-network --repositories-file /dev/null add --no-cache --allow-untrusted ./*.apk'
require_literal "$dockerfile" 'curl=8.23.0-r1 fd findutils git gzip jq libssh2 openssl-dev=3.6.5-r5 make'
require_literal "$dockerfile" 'sha256sum -c packages.sha256'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'python3 - < "$repo_root/scripts/smoke-managed-runtime.py"'
require_literal "$dockerfile" 'useradd --uid 10001 --gid 10001'
require_literal "$dockerfile" 'USER 10001:10001'
require_literal "$dockerfile" 'ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/nac-managed-entrypoint"]'
require_literal "$dockerfile" 'RUST_VERSION=1.98.0'
require_literal "$dockerfile" 'NODE_VERSION=24.22.1'
require_literal "$dockerfile" 'GO_VERSION=1.27.3'
require_literal "$dockerfile" 'UV_VERSION=0.13.4'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'go version | grep -F "go1.27.3"'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'uv --version | grep -F "uv 0.13.4"'
require_literal "$dockerfile" 'ARG NAC_BUILD_TRACK=dev'
require_literal "$dockerfile" 'ARG NAC_BUILD_ID'
require_literal "$dockerfile" 'ARG NAC_SOURCE_REVISION'
require_literal "$dockerfile" 'corepack enable'
require_literal "$dockerfile" 'test -x /usr/bin/fd'
require_literal "$dockerfile" 'GIT_LFS_VERSION=3.8.0'
require_literal "$dockerfile" 'GH_VERSION=2.103.0'
require_literal "$dockerfile" 'NPM_VERSION=11.21.1'
require_literal "$dockerfile" 'GOTOOLCHAIN=local CGO_ENABLED=0'
require_literal "$dockerfile" 'build -mod=readonly -modfile=/tmp/nac-lfs-dependencies/go.mod'
require_literal "$dockerfile" 'GIT_LFS_MODULE_SUM=h1:D0WiUyq5J3ZOv/9bvCcPToHqHF+WIQQKF5BK8bxlc5o='
require_literal "$dockerfile" 'GIT_LFS_REVISION=aece9221f8c09221a14395d964806b956289bc07'
require_literal "$dockerfile" 'git lfs install --system --skip-repo'
require_literal "$dockerfile" 'git lfs version'
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
store_path_count=$(grep -c -- '--store-path' "$entrypoint")
[ "$store_path_count" -eq 1 ] || fail 'managed entrypoint must select exactly one PVC-backed store'
if grep -Eq '(dev|beta|stable)\.db' "$entrypoint"; then
    fail 'managed entrypoint must not select a build-track local store'
fi
require_literal "$entrypoint" '/usr/local/libexec/nac/check-process-capabilities /proc/self/status'
require_literal "$dockerfile" 'check-process-capabilities.sh /usr/local/libexec/nac/check-process-capabilities'
require_literal "$capability_check" 'CapInh CapPrm CapEff CapBnd CapAmb'
require_literal "$capability_check" 'must not receive CAP_SYS_PTRACE'
sh -n "$capability_check"
"$capability_check" "$capability_fixtures/capabilities-benign.status"
for rejected_fixture in capabilities-effective-ptrace.status capabilities-permitted-ptrace.status capabilities-missing.status capabilities-malformed.status; do
    if "$capability_check" "$capability_fixtures/$rejected_fixture" >/dev/null 2>&1; then
        fail "capability fixture must be rejected: $rejected_fixture"
    fi
done
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'model_credential_source = \"managed-bootstrap\"'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'model_auth_issuer = \"https://api.arcee.ai\"'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'version = 2'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'host_incarnation_id = \"managed-smoke-incarnation\"'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'managed_control_bind = \"0.0.0.0:3211\"'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'managed_control_jwks_file = \"/etc/nac/control-jwks.json\"'
require_literal "$repo_root/scripts/smoke-managed-image.sh" '/run/secrets/nac/bootstrap.json'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'assert_bootstrap_required'
python3 "$repo_root/scripts/test-managed-smoke-payload.py"
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'smoke-managed-git-lfs.sh'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'python3 - < "$repo_root/scripts/smoke-managed-terminal.py"'
require_literal "$terminal_smoke" 'os.getuid() == 10001 and os.getgid() == 10001'
require_literal "$terminal_smoke" '"behavior": "direct"'
require_literal "$terminal_smoke" 'summary["ssh_host"] is None and not summary["sandboxed"]'
require_literal "$terminal_smoke" 'b"CTRL-C ENTER\r"'
require_literal "$terminal_smoke" 'b"SIZE=31 91\n"'
require_literal "$terminal_smoke" 'settled(api, terminal_path)'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'kill --signal KILL'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'start_container without-bootstrap'
require_literal "$lfs_smoke" 'git lfs version'
require_literal "$lfs_smoke" 'git clone --quiet'
require_literal "$lfs_smoke" 'git lfs fsck'
sh -n "$lfs_smoke"
require_literal "$managed_status" '"git-lfs"'
require_literal "$repo_root/docker/managed/fixtures/bootstrap.json" '"client_id": "managed-nac"'
require_literal "$repo_root/docker/managed/fixtures/bootstrap.json" '"version": 2'
require_literal "$repo_root/docker/managed/fixtures/bootstrap.json" '"auth_issuer": "https://api.arcee.ai"'
require_literal "$repo_root/docker/managed/fixtures/bootstrap.json" '"repair_intent": "managed-image-repair-intent-canary-0123456789"'
if grep -Eq '(^|[[:space:]])(sudo|su)([[:space:]]|$)' "$dockerfile" "$entrypoint"; then
    fail 'image or entrypoint grants an escalation command'
fi

require_literal "$workflow" 'platforms: linux/amd64'
require_literal "$workflow" 'push: false'
require_literal "$workflow" 'provenance: false'
require_literal "$workflow" 'sbom: false'
require_literal "$workflow" 'run: make ci'
require_literal "$workflow" 'npm --prefix .github/scripts ci'
require_literal "$workflow" 'NAC_BUILD_TRACK=dev'
require_literal "$workflow" 'NAC_SOURCE_REVISION=${{ needs.prepare.outputs.sha }}'
if grep -Eq '(id-token:[[:space:]]*write|aws-actions/|amazon-ecr|ECR_|push:[[:space:]]*true|environment:[[:space:]]*dev)' "$workflow"; then
    fail 'public repository workflow must remain build-and-smoke only'
fi

printf '%s\n' 'managed image contract: ok'
