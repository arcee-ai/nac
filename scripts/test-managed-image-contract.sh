#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
dockerfile="$repo_root/docker/managed/Dockerfile"
entrypoint="$repo_root/docker/managed/entrypoint.sh"
workflow="$repo_root/.github/workflows/managed-image-build.yml"
quality_workflow="$repo_root/.github/workflows/managed-quality.yml"
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
require_literal "$dockerfile" 'curl=8.23.0-r1 libcurl-openssl4=8.23.0-r1 fd findutils git gzip jq libssh2=1.11.1-r11 openssl-dev=3.6.5-r5 make'
require_literal "$dockerfile" 'gcc=16.2.0-r1 libgcc=16.2.0-r1 libstdc++=16.2.0-r1 libstdc++-dev=16.2.0-r1'
require_literal "$dockerfile" 'krb5-libs=1.22.2-r5 cyrus-sasl-heimdal-libs=2.1.28-r58'
require_literal "$dockerfile" 'python3 check-supplier-packages.py sources.lock.json > supplier-predecessors.json'
python3 "$repo_root/docker/managed/packages/test_supplier_packages.py"
python3 "$repo_root/docker/managed/packages/test_npm_bundle.py"
require_literal "$dockerfile" 'sha256sum -c packages.sha256'
require_literal "$dockerfile" 'libbrotlicommon1=1.2.1-r2 libbrotlidec1=1.2.1-r2 libbrotlienc1=1.2.1-r2'
require_literal "$dockerfile" 'python3 /usr/share/nac/npm-runtime-build/correct-npm-bundle.py'
# Assert the literal shell/Actions template, without expanding it here.
# shellcheck disable=SC2016
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'python3 - < "$repo_root/scripts/smoke-managed-runtime.py"'
# shellcheck disable=SC2016
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'python3 - < "$repo_root/scripts/security/glibc_gettext_runtime_probe.py"'
require_literal "$dockerfile" 'useradd --uid 10001 --gid 10001'
require_literal "$dockerfile" 'USER 10001:10001'
require_literal "$dockerfile" '/usr/local/bin/nac-web guide skills discovery'
require_literal "$dockerfile" '.provenance == "first-party bundled NAC Guide"'
require_literal "$dockerfile" 'ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/nac-managed-entrypoint"]'
require_literal "$dockerfile" 'RUST_VERSION=1.98.0'
require_literal "$dockerfile" 'NODE_VERSION=24.22.1'
require_literal "$dockerfile" 'GO_VERSION=1.27.4'
require_literal "$dockerfile" 'UV_VERSION=0.13.4'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'go version | grep -F "go1.27.4"'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'uv --version | grep -F "uv 0.13.4"'
require_literal "$dockerfile" 'ARG NAC_BUILD_TRACK=dev'
require_literal "$dockerfile" 'ARG NAC_BUILD_ID'
require_literal "$dockerfile" 'ARG NAC_SOURCE_REVISION'
# Candidate identity must invalidate compilation without invalidating toolchain setup.
python3 - "$dockerfile" <<'PY_CACHE'
import pathlib
import sys

source = pathlib.Path(sys.argv[1]).read_text().splitlines()
first_stage = source[:next(i for i, line in enumerate(source) if line.endswith(" AS runtime-package-sdk"))]
copy = first_stage.index("COPY . .")
compile_line = next(i for i, line in enumerate(first_stage) if i > copy and "cargo build --release --locked -p nac-server --bin nac-web" in line)
for name in ("NAC_BUILD_TRACK", "NAC_BUILD_ID", "NAC_SOURCE_REVISION"):
    declarations = [i for i, line in enumerate(first_stage) if line.startswith(f"ARG {name}")]
    if len(declarations) != 1 or not copy < declarations[0] < compile_line:
        sys.exit(f"managed image contract: {name} must be scoped after source COPY and before compilation")
    assignment = f'{name}="${{{name}}}"'
    if not any(assignment in line for line in first_stage[declarations[0] + 1:compile_line]):
        sys.exit(f"managed image contract: compilation must consume exact {name}")
PY_CACHE
python3 "$repo_root/scripts/test-managed-dependency-layer.py"
python3 "$repo_root/.github/scripts/image-build-driver.test.py"
python3 - "$dockerfile" <<'PY_SOURCE_LABEL'
import pathlib
import sys

source = pathlib.Path(sys.argv[1]).read_text().splitlines()
runtime = source[next(i for i, line in enumerate(source) if line.endswith(" AS runtime")):]
arg = [i for i, line in enumerate(runtime) if line == "ARG NAC_SOURCE_REVISION"]
label = [i for i, line in enumerate(runtime) if line == 'LABEL org.opencontainers.image.revision="${NAC_SOURCE_REVISION}"']
last_build = max(i for i, line in enumerate(runtime) if line.startswith(("RUN ", "COPY ")))
user = next(i for i, line in enumerate(runtime) if line.startswith("USER "))
if len(arg) != 1 or len(label) != 1 or not last_build < arg[0] < label[0] < user:
    sys.exit("managed image contract: exact source revision label must follow all final runtime build steps")
PY_SOURCE_LABEL
require_literal "$dockerfile" 'corepack enable'
require_literal "$dockerfile" 'test -x /usr/bin/fd'
require_literal "$dockerfile" 'GIT_LFS_VERSION=3.8.0'
require_literal "$dockerfile" 'GH_VERSION=2.103.0'
require_literal "$dockerfile" 'GH_MODULE_SUM=h1:iSwyy7dCdv8AUMi+myP8XrMgo4ZalGUX47i8vBih+zg='
require_literal "$dockerfile" 'GH_SOURCE_REVISION=7948e8056e45ac3c729b829e0eafe2d0797a95c6'
# Assert the literal Dockerfile expression without expanding it in this script.
# shellcheck disable=SC2016
require_literal "$dockerfile" 'go mod download -json "github.com/cli/cli/v2@v${GH_VERSION}"'
require_literal "$dockerfile" 'go install -trimpath'
require_literal "$dockerfile" 'install -m 0755 /tmp/nac-gh-build/bin/gh /usr/local/bin/gh'
# The notice inventory must follow the installed binary's exact linked versions.
require_literal "$dockerfile" 'go version -m /usr/local/bin/gh |'
# shellcheck disable=SC2016
require_literal "$dockerfile" '$1 == "=>" { exit 1 }'
# shellcheck disable=SC2016
require_literal "$dockerfile" 'END { if (count != 161) exit 1 }'
# shellcheck disable=SC2016
require_literal "$dockerfile" 'go mod download -json "$module@$version"'
# shellcheck disable=SC2016
require_literal "$dockerfile" '.Path == $module and .Version == $version and .Sum == $sum'
require_literal "$dockerfile" 'for notice in LICENSE LICENCE LICENSE.md LICENSE.txt LICENSE-BSD LICENSE-MIT license COPYING NOTICE PATENTS AUTHORS'
# shellcheck disable=SC2016
require_literal "$dockerfile" 'mkdir -p "$notice_dir" || exit 1'
# shellcheck disable=SC2016
require_literal "$dockerfile" 'cp "$module_dir/$notice" "$notice_dir/$notice" || exit 1'
require_literal "$dockerfile" 'missing gh module notice:'
python3 - "$dockerfile" <<'PY_GH_NOTICES'
import os
import pathlib
import re
import subprocess
import sys
import tempfile

dockerfile = pathlib.Path(sys.argv[1]).read_text()
match = re.search(r"awk '(.*?)' > /tmp/nac-gh-notices", dockerfile, re.S)
if match is None:
    sys.exit("managed image contract: gh notice inventory parser is missing")
parser = re.sub(r"\\\n\s*", " ", match.group(1))
modules = "mod\tgithub.com/cli/cli/v2\tv2.103.0\th1:main\n" + "".join(
    f"dep\texample.com/mod{index}\tv1.0.0\th1:sum{index}\n"
    for index in range(160)
)

def parse(raw):
    return subprocess.run(["awk", parser], input=raw, text=True, capture_output=True)

accepted = parse(modules)
if accepted.returncode or len(accepted.stdout.splitlines()) != 161:
    sys.exit("managed image contract: gh linked-module inventory rejects valid metadata")
for invalid in (
    modules.replace("v1.0.0", "(devel)", 1),
    modules.replace("h1:sum0", "missing", 1),
    modules + "\t=>\texample.com/replacement\tv1.0.0\th1:sum\n",
    modules.splitlines(keepends=True)[1:],
):
    if isinstance(invalid, list):
        invalid = "".join(invalid)
    if parse(invalid).returncode == 0:
        sys.exit("managed image contract: gh linked-module inventory accepted invalid metadata")

# Exercise the Dockerfile's actual notice-copy shell fragment through success,
# mkdir failure, and cp failure; a later found_notice assignment must not mask I/O.
start = dockerfile.index('notice_dir="/usr/local/share/licenses/gh/modules/$module";')
end = dockerfile.index('done < /tmp/nac-gh-notices', start)
copy_fragment = re.sub(r"\\\n\s*", " ", dockerfile[start:end])
copy_fragment = copy_fragment.replace(
    '"/usr/local/share/licenses/gh/modules/$module"',
    '"$GH_NOTICE_TEST_ROOT/$module"',
)
with tempfile.TemporaryDirectory() as directory:
    temp = pathlib.Path(directory)
    source = temp / "source"
    source.mkdir()
    (source / "LICENSE").write_text("test notice\n")
    module = "example.com/module"

    def copy_to(root):
        env = dict(os.environ, module=module, module_dir=str(source), GH_NOTICE_TEST_ROOT=str(root))
        return subprocess.run(["sh", "-c", copy_fragment], env=env, capture_output=True)

    success = temp / "success"
    if copy_to(success).returncode or (success / module / "LICENSE").read_text() != "test notice\n":
        sys.exit("managed image contract: gh notice copy rejected a valid source")
    blocked = temp / "blocked"
    blocked.write_text("not a directory")
    if copy_to(blocked).returncode == 0:
        sys.exit("managed image contract: gh notice copy masked a mkdir failure")
    failed_copy = temp / "failed-copy"
    (failed_copy / module / "LICENSE" / "LICENSE").mkdir(parents=True)
    if copy_to(failed_copy).returncode == 0:
        sys.exit("managed image contract: gh notice copy masked a cp failure")
PY_GH_NOTICES
# Assert the literal smoke expressions without expanding them here.
# shellcheck disable=SC2016
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'gh_build_info=$(go version -m "$gh_binary")'
# shellcheck disable=SC2016
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'sed -n '\''1p'\'')" = "$gh_binary: go1.27.4"'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'assertion_failed "gh-go-toolchain"'
require_literal "$repo_root/scripts/smoke-managed-image.sh" 'assertion_failed "gh-source-module"'
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
# Assert the literal shell/Actions template, without expanding it here.
# shellcheck disable=SC2016
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
# Assert the literal shell/Actions template, without expanding it here.
# shellcheck disable=SC2016
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
require_literal "$quality_workflow" 'run: make ci'
require_literal "$quality_workflow" 'npm --prefix .github/scripts ci'
require_literal "$workflow" 'NAC_BUILD_TRACK=dev'
# Assert the literal shell/Actions template, without expanding it here.
# shellcheck disable=SC2016
require_literal "$workflow" 'NAC_SOURCE_REVISION=${{ needs.prepare.outputs.sha }}'
if grep -Eq '(id-token:[[:space:]]*write|aws-actions/|amazon-ecr|ECR_|push:[[:space:]]*true|environment:[[:space:]]*dev)' "$workflow" "$quality_workflow" "$repo_root/.github/workflows/managed-image.yml"; then
    fail 'public repository workflow must remain build-and-smoke only'
fi

printf '%s\n' 'managed image contract: ok'
