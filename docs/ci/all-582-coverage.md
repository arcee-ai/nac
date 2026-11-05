# ALL-582 event-to-coverage inventory

This is a source inventory, not a coverage-parity or timing-acceptance certificate.
It compares dev baseline `b95520ef73db6a0e17ab7b21a650001cf015ebd4` with campaign
candidate `7446e4337200cdd8d90944f6dcc594309ba56eb6`, observed November 4, 2026
Pacific time (November 5 UTC). Current-head hosted success, the required ordinary
PR cohort, human review/landing and deployed schedule qualification remain separate.
No settings, other tickets, test selections or production source were changed for
this inventory. It consumes no latency-strategy number.

[The generated JSON](evidence/all-582/coverage-inventory.json) retains exact workflow
hashes, triggers, conditions, job edges, runner matrices, commands and cache
configuration. Baseline-to-candidate hashes show source/image daily workflows,
source scanning, MCP, native portability/terminal/process, release publication,
the native selections and the Playwright configuration unchanged. All 49 `.e2e.ts`
files are byte-identical. A candidate listing collects 205 specs; a listing proves
selection only. The existing review-fixture skip and remote-profile exclusion are
not passes. One frontend cleanup unit regression was added to prove one fixture
cannot kill a concurrent fixture with a sibling marker.

## Event matrix at the candidate

“Full stable” means every unconditional lane in the contract table below, on the
immutable prepared event candidate. Ordinary PRs have no top-level path exclusion.
Managed applicability uses the complete NUL-delimited base-to-candidate diff,
with renames represented as delete/add; it does not choose a smaller stable suite.

| Event / source | Full stable and managed work | Additional independent coverage / publication |
| --- | --- | --- |
| Backend/Rust ordinary PR | Full stable. `crates/**`, manifest/lock, scripts, workflow and Makefile changes make managed work applicable. | MCP prepare/contracts always run; conformance follows its explicit paths. Core/contracts/process/credential-store and server src/tests/examples match; managed source alone does not match, but any crate manifest does. Terminal paths may add focused Mac/Linux journeys. |
| Frontend ordinary PR | Full stable, frontend unit/API/assets and complete production browser selection. `crates/**` makes managed work applicable. | Focused terminal workflow matches terminal/client transport/runtime/E2E/config/package paths. General frontend-only paths do not automatically select MCP conformance. |
| Documentation-only ordinary PR | Full stable, including Rust, browser, both archive builds, source scan and native process/credentials. Managed work skips only when no applicability path matches. | Ordinary documentation does not select MCP execution. `docs/ci/nightly-portability.md` selects portability PR verification and focused terminal jobs through their own path lists. |
| Explicitly managed-applicable ordinary PR | Full stable plus early `managed-image`, late receipt-consuming `managed-quality` and strict complete managed join. | Actual image load/smoke/inventory/live scan and live scanner negatives; managed fault feature always runs. No publication privileges. |
| `dev` or `main` push | Full stable; managed always applicable. These events alone may save the stable graph's Rust/BuildKit caches. | No MCP/terminal/portability push trigger is added. Independent schedules remain responsible for their declared coverage. |
| Valid stable tag `v*.*.*` | Preparation verifies the stable tag/source/version against current dev; then full stable and managed. Invalid release targets fail preparation. | Both exact archives must pass identity/content checks before `publish` uploads them. Source/image policy uses validated publication-mode reviewed-dev resolution. A tag-pattern match alone is not release clearance. |
| Stable workflow manual dispatch | Full stable and managed at the immutable event SHA, ordinary trusted-policy selection. | Archive publication stays disabled. This does not dispatch independent MCP/terminal/nightly jobs. |
| Standalone managed workflow manual dispatch | `managed-image.yml` resolves one source, runs full `make ci` because there is no supplied receipt, always runs private fault tests, and calls the same complete image unit. | Full `make ci` is the portable repository target, not the separate browser/native/release archive graph. There is no dispatch skip/receipt input. `managed-image-build.yml` and `managed-quality.yml` expose only reusable calls. |
| Source daily schedule / manual | `source-security-daily.yml` pins actual dev once and calls the complete source scan. Schedule: 09:23 UTC. | Fresh findings do not rewrite old PR results; stale candidates need fresh acceptance. |
| Image daily schedule / manual | `image-security-rescan.yml` checks out dev and selects retained canonical stable dev-push inventory; fresh scanner/DB/policy evaluation, not reuse of an old verdict. Schedule: 08:43 UTC. | **Unresolved producer-name gap below.** Reporting is advisory only for complete security verdicts; infrastructure/evidence failures fail. |
| MCP schedule / manual | Complete locked two-revision conformance and omitted-tool-call negative, exact event candidate. Schedule: 09:23 UTC. | Separate `MCP conformance complete` conditional aggregate; not a child of `Required PR checks`. |
| Portability schedule / manual | Actual ARM `macos-26`, full default Rust workspace plus four explicitly reviewed serialized ignored cases; schedule: 10:23 UTC. | Calls focused terminal workflow for actual Mac and Linux. Manual `seed-failure` is intentionally red. **Current ignored inventory blocks the broader suite below.** |
| Portability own-file PR | Path-limited native workspace/inventory/control qualification. | The nightly workflow does not call terminal-browser on PR events; terminal-browser's own overlapping path trigger supplies its focused pair. |
| Focused terminal manual / relevant-path PR / nightly call | Native ARM Mac Zsh/less and Linux Bash/less, real production-embedded Chromium journey, exact candidate. | Exact byte negative and actual detached shell/server cancellation cleanup; not a second complete browser suite. |
| Release preparation dispatch / merged release PR | Separate non-cancelling `release-please.yml`: dispatch validates exact current dev and prepares a non-publishing release PR. | Only the recognized same-repository merged release PR to dev selects exact merge source security and the validated release plan before repository-scoped release publication. No managed image deployment is granted. |
| CLA / reviewer metadata events | Unchanged independent `pull_request_target`/signature-comment and designated-reviewer workflows. | Metadata/signature operations do not execute PR candidate code or provide product-test evidence. Human approval and any authorized human exception remain separate from agent authority. |

## Stable and managed command/feature contract

| Required lane at `7446e433` | Actual retained obligation / baseline relationship |
| --- | --- |
| `workflow-lint` | `make lint-workflows test-workflow-lint test-manual-stack-override`: pinned workflow/ShellCheck tools, all tracked workflow/shell inventory and real invalid fixtures; manual-stack-override regression target was already required at baseline. |
| `lint` | Locked workspace clippy for libraries/binaries with warnings denied; `make format-check` keeps Rust/web formatting. Frontend lint/typecheck remain in assets. |
| `test-core` | Unfiltered locked core/catalog tests; capture qualification; `pr-*.test.mjs`; release/installer policy. New browser-proof/inventory/timing controls are additive. |
| `test-workspace` | Locked contracts, credential-store, managed and process tests complete the seven crates; Guide/source-size/source workflow/source binary; all durability filters; managed 1/2/4 load; static image contract. No filter or assertion was removed. |
| `test-server` | Unfiltered `cargo test -p nac-server --locked` (library, binary, integrations and docs, existing ignored inventory retained), then `make test-stable-binary` with stable track/build ID and exact revision. Node 24.22.1 remains available. |
| `test-server-web` | The former server lane's `npm ci`, `npm test` (Vitest plus built client-package consumer checks) and `make test-assets`, moved intact. API exporter checks Rust/OpenAPI and generated app/client types; lint/typecheck and all committed browser/nac-client/nac-presentation dist outputs still build and fail on drift. Both server roles are explicit quality/final dependencies. |
| `browser-shards`, `browser-proof`, `browser` | Four isolated machines run the entire ordinary selection; one proof job runs all `exact-goal-wait.e2e.ts` cases and validates/stages the bounded proof/cleanup receipts. Complete/disjoint inventory union is checked. One worker per machine, `fullyParallel:false`, zero retries and existing assertions/timeouts/real clocks remain. Matrix `fail-fast:false` retains sibling evidence. Committed embedded assets are independently drift-checked by `test-server-web`. |
| `quality`, compatibility `test` | Exact successful complete preparation/lint/workflow/server-web/server/core/workspace result set produces a same-candidate/repository/run/attempt receipt. `test` separately requires quality and complete browser acceptance. Browser/native/build/source scan are not falsely described as quality receipt contents. |
| `build` | Release `nac-web` for Linux `x86_64-unknown-linux-musl` and native ARM `aarch64-apple-darwin`/`macos-26`; exact short/full version identity and archive contents checked, then retained. These are binary archives, not AppKit app distribution qualification. |
| `macos-native` | Actual Darwin ARM64 check; all default process/credential tests and all twelve exact core native/terminal names, first then fixed warm pass (first failure stops); safe Darwin status-classification negative, source restoration and exact restored pass; owned process/file cleanup. This is separate from the ARM release build. |
| `source-security` | Fresh pinned OSV scan of `Cargo.lock`, web lock and release-tooling lock, including locked supplemental bundled components; live safe/vulnerable fixtures and trusted base/publication policy tests. Changed/unavailable/expired/foreign policy/evidence fails. |
| `managed-image` | Reusable prepare, static contract, **mandatory** `scanner-qualification`, actual native linux/amd64 build/load, immutable ID binding, credential-independent readiness/restart/SIGTERM/runtime/terminal/Git-LFS smoke, inventory and live scan. Font/browser setup is unrelated to this container contract. |
| `managed-quality`, managed join | After exact ordinary quality, validate receipt and always run `make test-managed-fault-fixture`: both core fault tests, server generation-scoped fault and feature clippy. Missing receipt runs full `make ci`; complete earlier-attempt same-run receipt selects full current-attempt quality, never stale reuse. Final managed join requires complete image and fault quality plus exact source. |
| `required-pr-checks`, conditional `publish` | Explicit current job list and managed applicability reject absent/failed/skipped/cancelled/malformed work. Archive publishing additionally needs full result/test/build/source success and eligible stable-tag event. Privileged release steps remain separate from untrusted candidate compilation. |

Rust/Node pins, seven crate manifests and the release/feature command selections
remain locked. `CARGO_PROFILE_DEV_DEBUG=0` aligns debug-symbol production in mixed
lanes; it does not disable debug assertions, overflow checks or test cases. Managed
image dependency placeholders are never accepted local outputs: the unchanged real
source is copied before `cargo clean --release --locked --offline --workspace` and
exact-identity compilation in the same Wolfi environment.

Features remain explicit: normal package dev-dependency feature unification and
server OpenAPI features, managed fault tests/clippy, and MCP's `test-support`
example are retained. `make test-e2e-review` (`review-fixture`) and
`make test-e2e-remote` remain manual specialized targets, not newly claimed PR
passes. The review journey's existing default-build skip is preserved. No
all-features, Windows, external-SSH, paid-provider or unprovisioned Podman matrix
is invented by this inventory.

## Fail-closed controls and trust boundaries

| Contract | Executable controls / negative cases retained |
| --- | --- |
| Main/managed/source identity and aggregation | `.github/scripts/pr-checks*.test.mjs`, `pr-ci-efficiency.test.mjs`, `pr-server-parallel.test.mjs`: explicit job sets, missing/failure/skip/cancel, invalid applicability, malformed/foreign/stale/future receipt, candidate/repository/run/attempt mismatch and valid older-attempt full fallback. New image and both server roles are mandatory. |
| Browser selection/proof/process cleanup | `pr-browser-sharding.test.mjs`, `browser-inventory.test.py`, `browser-proof.test.py`, web `harness-cleanup.test.ts`: missing/duplicate/unexpected tests, changed skip/worker/retry settings, malformed/stale/incomplete proof and cleanup receipts, concurrent sibling fixture isolation. Static selection is not execution evidence. |
| Exact image and live security | `scripts/security/test_*.py`, `image-policy.test.mjs`, `image-workflow.test.mjs`, `image-scanner-workflow.test.mjs`, `image-publication.test.mjs`: actual image/source/bundle/hash identity, complete scanner outputs, live vulnerable/fixed OS/Node/Wolfi/upstream/runtime cases, unavailable DB/unknown distro, policy trust and retained failures. `test-managed-image-contract.sh` and dependency-layer controls prevent stale local placeholder use or weakened runtime capabilities. |
| Source and publication trust | `.github/scripts/security-policy.test.mjs`, source-security/bundles/workflow/publication/source-release controls: full lock inventories, pinned actual scanner, vulnerable/safe controls, missing/expired/unauthorized policy, candidate-versus-reviewed equality and exact eligible release plan. No prior green workflow supplies clearance. |
| Native/portability/terminal | `native-regressions.test.py`, `nightly-portability.test.py`, `terminal-browser.test.py`, `terminal-browser-cancel.py`: exact selection/no zero-test pass, deliberate Darwin/Rust/HTTP-byte failures, real owned process cancellation, retained cleanup diagnostics, no raw-PID identity fallback or widened latency budget. |
| MCP | `scripts/mcp-conformance/*.test.mjs`: exact two frozen revisions, requirements/scenario/client-receipt inventories, narrow reviewed failed checks/conditional skips and actual omitted-tool-call negative; unexpected failure is not hidden by client exit 0. |

Main stable/managed/native Cargo caches and BuildKit preserve trusted dev/main
push-only export, no npm implicit save and no cached test/security verdict or
advisory database. The independent MCP/nightly workflows are byte-identical to
baseline and have separate Rust cache namespaces with the action's default save
behavior; they must not be described as newly acquiring the main graph's explicit
push-only save condition. GitHub cache scope and privileged publication remain
separate trust boundaries. Contents-write release tokens never enter candidate
build/smoke/scanner work. No new paid runner or service is selected.

## Concrete gaps and independent branch obligations

1. **Daily image producer selection needs repair before schedule parity can be
   claimed.** At this candidate `scripts/security/image_rescan.py` still selects
   exact job name `managed / build-smoke`; extraction emits
   `managed-image / build-smoke`. The unchanged selector can skip a new complete
   inventory and choose an older recognized run. Update the canonical/compatibility
   job contract and negative tests without weakening exact dev-push repository,
   source/run/attempt, newest complete inventory, artifact or no-fallback rules.
   This inventory does not claim a deployed candidate rescan pass.
2. **ALL-457's broad native schedule currently fails closed before its default
   suite.** Latest actual schedule, [41814252560 / 126520880813](https://github.com/arcee-ai/nac/actions/runs/41814252560/job/126520880813),
   used `481ee248f755461c6bee9c274963cb30ccd6b0aa` and rejected seven unclassified
   ignored names: four JEV live calibration/corpus/smokes, reviewer-policy replay,
   exact catalog/repository skill discovery and task-wait maximum timeout. Full
   names and artifact digest are in the JSON. Both focused terminal platform jobs
   passed. The 13-entry inventory is unchanged here; retaining its guard is not a
   passing portability receipt. ALL-457 remains Done for its historical landed
   delivery; no status/assignment change was made. Its two unprovisioned Podman
   exclusions, paid/live providers, external SSH and manual quiet-host cases
   remain explicit non-passes.
3. **Strict image findings and complete shipped Rust-toolchain advisory coverage
   are unmerged work, not current dev guarantees.** Live open
   [439](https://github.com/arcee-ai/nac/pull/439),
   [442](https://github.com/arcee-ai/nac/pull/442),
   [441](https://github.com/arcee-ai/nac/pull/441) and
   [440](https://github.com/arcee-ai/nac/pull/440) carry content corrections,
   installed Rust coverage (ALL-504) and strict propagation (ALL-505). Current
   `image_ci_report.py` accepts only complete truthful verdicts but deliberately
   reports blocked findings as advisory; scanner/inventory/DB/control errors fail.
   The strict scanner/prepublication helper remains strict. Future stack
   integration must preserve those stronger verdicts, complete official feeds and
   fresh combined-image/rescan qualification; do not restore advisory wording or
   old coverage bundles over them. ALL-507's private beta publisher/recovery
   qualification concerns its own immutable artifact, not NAC dev-image green.
4. **Native AppKit/WKWebView and Mac packaging are additional unmerged branch
   contracts.** [499](https://github.com/arcee-ai/nac/pull/499) adds actual native
   GUI/preview and explicit exact-supplier qualification (including approved
   macOS 14/26 targets); [501](https://github.com/arcee-ai/nac/pull/501) adds
   path-limited PR/manual ARM package preparation, signature/provenance checks and
   archive relocation with one engine receipt. These workflows are absent at both
   comparison revisions. Neither the existing Rust macOS lane nor a Linux browser
   pass supplies their evidence. Preserve them and their native/process cleanup
   gates when reconciling those stacks; ad-hoc package preparation is not signed,
   notarized distribution or deployment approval.
5. **Actions' fail-closed result and platform enforcement are different evidence.**
   Read-only live repository ruleset `25983949` has no required-status-check rule
   at this observation; source documentation also leaves activation separate.
   No setting or bypass was changed. This does not waive any human review or
   future strict current-base `Required PR checks` activation obligation.
6. **Existing real test instability is separate from speed acceptance.** ALL-495
   remains In Progress with Eric and open PR
   [594](https://github.com/arcee-ai/nac/pull/594); terminal rendered-output latency,
   native process census and cancellation-noise evidence are not excuses for
   retries, thresholds, transport-only proof or skipped current-candidate work.

## Verification and integration follow-up

`make setup` passed in the fresh owned evidence worktree. Fifty-five cheap
aggregate/receipt/image/MCP contract tests passed with zero skips. The browser
listing, workflow/source hash comparison and live nightly/PR/ruleset reads are
read-only evidence. No broad Cargo, browser journey, native suite, image build,
rescan or publication was executed for this matrix. Required parity remains open.

Before applying this inventory to the next candidate, refresh its exact SHA and
machine inventory. S03b's earlier fault lane must remain mandatory in explicit
job sets and preserve standalone full quality/current-attempt receipt handling.
S09's shared browser executable must bind producer/consumer source, repository,
run/attempt, checksum, target/profile/features and product identity, while keeping
independent API/assets drift and all shard/proof/cleanup coverage. Update those
job names and fix the daily producer selector, then attach actual current-head
positive/negative and deployed-schedule evidence. Ordinary pending CI, one green
run or this inventory alone does not satisfy ALL-582's timing cohort or coverage
acceptance.
