# Workflow and shell lint

Run from the repository root after `make setup`:

```sh
make lint-workflows
make test-workflow-lint
```

`make ci` includes both targets. The five-minute `workflow-lint` job in
`stable-release.yml` runs both against the preparation job's immutable candidate
on every PR, including docs-only PRs. It is a direct dependency of **Required PR
checks**, whose exact expected-result contract rejects missing, failed, cancelled,
pending and skipped lint work. Builds and existing acceptance lanes retain their
coverage. Repository ruleset activation and actual human approval remain separate
rollout gates described in [required-pr-checks.md](required-pr-checks.md).

## Tools and reproducibility

[workflow-lint-tools.json](../../.github/scripts/workflow-lint-tools.json) pins
[actionlint 1.7.12](https://github.com/rhysd/actionlint/releases/tag/v1.7.12) and
[ShellCheck 0.11.0](https://github.com/koalaman/shellcheck/releases/tag/v0.11.0).
The SHA-256 values were checked against the upstream GitHub release-asset digests
on October 22, 2026. Linux and macOS x64/ARM64 archives are supported. Updates must
review both the version and each upstream asset digest, then rerun the real-tool
fixtures; ambient system installations never select the versions.

The installer downloads over HTTPS without credentials and verifies the whole
archive before extraction/execution. Only archives are cached under
`~/.cache/nac/workflow-lint`; cache hits are reverified and the named executable is
extracted into a fresh private temporary directory each time. A corrupt cache is
an error; remove the named archive and rerun to redownload. Unsupported platforms,
download/checksum failures and missing tools fail the gate. Node 22+, Git, curl
and tar are prerequisites; the YAML reader is already in the locked release-policy
npm graph installed by `make setup`. No new dependency or lockfile is introduced.

On the initial macOS ARM64 measurement the cold lint run (downloads included)
took 2.62 seconds and found the baseline warnings. The repaired warm lint run took
1.48 seconds, followed by 1.45 seconds for all nine enforcement tests. CI's own
runtime remains visible on the job; these local measurements do not certify Linux
CI. The five-minute bound includes download failures/retries and dependency setup.

## Complete input inventory

`git ls-files -z` is the inventory authority, with no path exclusions. Every run
prints each workflow, each standalone script and its detected dialect, and each
embedded block's workflow/job/step/dialect. New tracked inputs are discovered
automatically, including extensionless shell scripts and names containing spaces
or newlines. Untracked files must be staged to enter the gate. Stage deletions as well: missing
indexed paths and non-readable/non-file inputs fail closed rather than silently
skipping tracked coverage. This target expects a complete working tree, not a
sparse checkout.

At the starting revision `c8d3b26b11903f76a725a03cbc542ebe2ad35b66`, the inventory
contains eight workflows, 23 standalone shell scripts, and 61 embedded Bash
blocks. The new lint job adds two embedded blocks. The ticket's original count of
17 scripts predates the current tree. There are **no excluded workflow or shell
files**.

| Workflows (all checked by actionlint) | Embedded dialect |
| --- | --- |
| `.github/workflows/cla.yml` | No run blocks; Actions metadata still checked |
| `.github/workflows/pr-reviewers.yml` | No run blocks; github-script JavaScript remains Actions input |
| `.github/workflows/image-security-rescan.yml` | Bash |
| `.github/workflows/managed-image.yml` | Bash |
| `.github/workflows/release-please.yml` | Bash |
| `.github/workflows/source-security-daily.yml` | Bash |
| `.github/workflows/source-security.yml` | Bash |
| `.github/workflows/stable-release.yml` | Bash (Linux/macOS default) |

| Standalone scripts (all checked by ShellCheck) | Dialect |
| --- | --- |
| `.github/scripts/install-osv-scanner.sh` | POSIX sh |
| `.github/scripts/install.test.sh` | POSIX sh |
| `.github/scripts/stable-release-preparation.sh` | Bash |
| `.github/scripts/stable-release-rollout.sh` | POSIX sh |
| `docker/managed/check-process-capabilities.sh` | POSIX sh |
| `docker/managed/entrypoint.sh` | POSIX sh |
| `docker/managed/packages/build-curl.sh` | POSIX sh |
| `docker/managed/packages/build-gcc-headers.sh` | POSIX sh |
| `docker/managed/packages/build-krb5.sh` | POSIX sh |
| `docker/managed/packages/build-sasl.sh` | POSIX sh |
| `docker/managed/packages/fetch-sources.sh` | POSIX sh |
| `scripts/check-source-size.sh` | Bash |
| `scripts/install-dev.sh` | POSIX sh |
| `scripts/install-skill.sh` | POSIX sh |
| `scripts/install.sh` | POSIX sh |
| `scripts/smoke-managed-git-lfs.sh` | POSIX sh |
| `scripts/smoke-managed-image.sh` | POSIX sh |
| `scripts/test-managed-image-contract.sh` | POSIX sh |
| `scripts/test-mcp-conformance.sh` | POSIX sh |
| `scripts/test-source-workflow.sh` | Bash |
| `scripts/uninstall.sh` | POSIX sh |
| `start.sh` | Bash |
| `start_dev.sh` | Bash |

Standalone dialects come from shebangs, with explicit ShellCheck shell selection
(`dash` uses POSIX `sh`; `ksh` is supported). A shell extension without a supported
shebang, or a discovered unsupported shell, fails inventory. Extensionless scripts
using alternate `env` paths, supported launcher options or environment assignments
are also discovered. Unrecognized shell-like interpreters (including ash/mksh) and
ambiguous/unsupported `env` launcher syntax fail visibly. Embedded shell
selection honors step, job and workflow defaults; current runners default to
Bash. Unsupported embedded shells fail inventory and require explicit coverage
work before adoption. actionlint checks expressions/workflow structure and sends
Bash/sh blocks to the pinned ShellCheck, applying its upstream GitHub-aware rule
selection. Standalone scripts use the full default ShellCheck rule set. User
ShellCheck configuration/options are disabled; Python lint is outside this lane.
This gate does not execute scripts or claim to analyze JavaScript inputs or
nested shell strings inside other languages.

## Findings and proof

Baseline corrections remove three unused package-builder assignments and spell
three intentionally empty `CDPATH` assignments explicitly. Four line-local
`SC2016` suppressions explain literal shell/Actions-template assertions in the
managed contract; a line-local `SC2043` suppression preserves the uninstall
script's explicit binary list. No global rule suppression is added.

The test target runs the actual pinned binaries against disposable Git-indexed
fixtures. It proves failure for invalid Actions context/expression, unsafe
embedded and standalone quoting, incomplete embedded and extensionless script
syntax, and POSIX scripts/blocks containing Bash arrays. Positive controls cover
Bash arrays, POSIX sh, step overrides, defaults, extensionless scripts and unusual
filenames and alternate `env` launchers. Unknown dialects, empty inventories, unavailable tools and poisoned
archive caches fail closed. The lane wiring and aggregate-result tests preserve
the exact-candidate, exact-set contract independently of future required lanes.
