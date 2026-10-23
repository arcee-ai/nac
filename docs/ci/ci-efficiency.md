# CI work sharing and measurement

Stable and managed checks use the existing managed quality profile: Rust 1.98.0
and Node 24.22.1. The native ARM lane uses the same compiler. This aligns the
previous floating-stable/Node 22 stable graph with the managed graph without a
new compiler or test runner. Other independent security/release tooling retains
its supported Node 22+ contract. Cargo stays locked and npm uses `ci`.

## Before/after coverage

Every ordinary PR still runs the full stable graph, including docs-only PRs.
Managed applicability still uses the complete NUL-delimited merge diff with
renames represented as delete/add. Non-PR events conservatively run managed work.
Main/dev pushes, stable tags and manual dispatch keep the same coverage. Stable
tag publication remains a separate contents-write job after the full aggregate;
managed image work remains contents-read/build-and-smoke only.

| Contract | Before | After |
| --- | --- | --- |
| Seven crates: core, catalog-gen, server, contracts, credential-store, managed, process | Stable split tests plus managed `make ci` workspace repeat | Same stable split tests, required receipt; standalone managed retains workspace `make ci` |
| Workspace clippy; Rust/web formatting | Stable lint plus managed quality repeat | Stable lint once; receipt requires success |
| Web lint/typecheck | Stable lint, server checks/assets and managed repeat | `test-assets` lint/typecheck once; formatting remains in lint |
| Generated API document, app types, bounded nac-client types | `test-assets -> test-api-contract` plus managed repeat | Same sole writer/check chain in server; required receipt |
| Committed browser, nac-client and nac-presentation dist | Server asset build, browser rebuild, managed asset build | One server `test-assets` build and unchanged dirty-output failure check; browser consumes that build |
| Web tests and production Chromium journeys | Stable server plus managed web tests | Stable server; same browser command/config, retries and assertions |
| Source-size, source workflow/binary, durability, managed load/static image contract | Stable workspace plus managed repeat | Stable workspace; required receipt |
| Managed private fault feature tests and feature clippy | Managed quality after full `make ci` | Always managed quality, after receipt validation; never deduplicated |
| Exact native linux/amd64 image, load, smoke, inventory, advisory scan/qualification | Managed contract/quality/build-smoke/result | Same exact loaded image ID and candidate, scanner infrastructure enforced; findings advisory as accepted |
| Source security, full Cargo/web/release npm locks | Direct aggregate dependency | Unchanged direct dependency; no cache of scan verdicts or advisory DB |
| Required native ARM process/credential/terminal cases | Direct aggregate dependency | Same selection, isolation and Darwin negative control; fixed existing compiler |
| Workflow/shell lint and real invalid fixtures | Required on every PR, repeated managed quality | Required on every PR and in quality receipt |
| Release policy, installer, stable identity, Linux musl/macOS archive identity | Stable core/server/build and managed repeats | Same stable jobs, same current candidate, separate publication privilege |
| Dedicated MCP conformance (ALL-456) | Independent slice | Dedicated path applicability/schedule, locked existing release-tooling npm root; no assumption it is in shared quality |
| Broader portability (ALL-457) | Independent slice | Dedicated nightly/manual lane and narrow own-file PR trigger; no expansion of required product-path native tests |

Tests start after preparation instead of waiting for clippy; both the compatibility
`test` result and Required PR checks still wait for lint. The receipt records only
an exact, complete successful result set from preparation, lint, workflow lint,
server, core and workspace. It binds candidate SHA, repository, run ID and attempt.
The managed caller directly needs that `test` job and passes its output. The
reusable quality job validates all fields and results before reuse; invalid or
foreign evidence fails. A blank receipt runs full `make ci`, including in standalone
manual managed runs, which expose no receipt/skip dispatch input. The feature-gated
fault fixture always runs. No cross-workflow status lookup or previous green
candidate can supply quality evidence. Native/build/source-security are separately
required by the final aggregate, rather than falsely described as receipt contents.

## Cache and cancellation boundary

Cargo cache keys include an owned `nac-ci-v1` prefix and job role; the pinned
cache action also binds the host/architecture, rustc identity, relevant environment
and lock/dependency inputs. Native and managed fault compilation have separate
roles. Only main/dev push events save entries. PRs, forks, tags and manual dispatch
restore eligible trusted entries but never save through these steps. setup-node's
implicit npm post-save is disabled; locked npm installation is cheap and remains
uncached by this graph. No credentials, workspaces, test stores, scanner verdicts
or advisory databases are explicitly cached.

BuildKit uses `nac-managed-linux-amd64-v1`; only main/dev pushes export it.
Untrusted PRs can restore eligible default-branch layers but cannot export through
the workflow. Image build args retain exact revision/build ID, so a changed source
cannot reuse a different revision's NAC binary. Loaded immutable image ID, smoke,
inventory, scanning and retained candidate-named artifacts retain the existing
single-build identity boundary. Cache hits never replace smoke/security checks.
Credentialed publication does not execute untrusted cached builds or candidate code.

Ordinary `pull_request` runs share a concurrency group only with the same PR
number and cancel superseded runs. Push/tag/manual runs have unique run groups
and `cancel-in-progress=false`, so their pending slots cannot replace one another.
The separate release-preparation/publication workflow remains non-cancellable.
The reusable managed workflow retains unique run/attempt groups; a superseded PR's
parent cancellation still cancels its children. Queue qualification/`merge_group`
support remains separate (ALL-460); this change enables no queue.

## Evidence procedure

Use the same immutable source and runner classes for each before/after comparison.
Retain run/head/event/attempt, every job/step start/end, cache-hit logs, toolchain,
image/build identity and conclusions. Compute event-to-required-result time and
sum executed job durations separately; queue time, critical path and total compute
are different measures. Include startup/post-cache/artifact overhead. Do not call
an inherited partial Cargo cache or npm-cache hit a cold build. Before this change
managed quality has no Cargo cache, even on a repeated run.

For a controlled cold/warm command comparison use a new owned `CARGO_TARGET_DIR`
for the first pass, repeat the identical commands in that directory for the second
pass, and record both receipts without clearing shared caches. Hosted cold/warm
claims require observed cache miss/hit evidence; no post-landing trusted cache hit
is assumed from a green prelanding PR. A failed run is retained and cannot be
counted as a speed improvement. No percentage target or speculative nextest change
justifies removing coverage. Detailed measured receipts belong in ALL-458/its PR,
with exact run links and environment limitations.

`node --test .github/scripts/pr-ci-efficiency.test.mjs` exercises the real receipt
CLI and representative aggregate failures, wrong candidate/run/attempt/repository,
missing/skipped/cancelled quality, standalone/full-quality wiring, cache write
conditions and release noncancellation. Existing aggregate tests reject every
incomplete expected job and current-candidate mismatch. Real workflow/shell lint,
source-security fixtures and image negative controls remain separate enforcement
proofs; local controls do not claim a live production red-merge or release test.
