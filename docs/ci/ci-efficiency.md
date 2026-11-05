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
| Committed browser, nac-client and nac-presentation dist | Server asset build, browser rebuild, managed asset build | One server `test-assets` build and unchanged dirty-output failure check; browser consumes the identical committed bundles from the same candidate |
| Web tests and production Chromium journeys | Stable server plus managed web tests | Stable server tests plus separate required concurrent browser job; eight file-isolated ordinary shards plus dedicated goal proof; same selected tests, retries and assertions |
| Source-size, source workflow/binary, durability, managed load/static image contract | Stable workspace plus managed repeat | Stable workspace; required receipt |
| Managed private fault feature tests and feature clippy | Managed quality after full `make ci` | Early complete fixture plus exact-attempt late validation; standalone/retry full fallback retains all four commands |
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
server unit/assets, core and workspace. It binds candidate SHA, repository, run ID and attempt.
The `managed-quality` caller directly needs the receipt-producing `quality` job
and passes its output. The separate compatibility `test` result requires both quality and
browser success. A required producer builds the exact candidate with its checked-in bundles;
consumers validate the same-run executable bytes or build fresh source after valid
older-attempt evidence. Server `test-assets` independently proves those committed
bytes match the sole writer. The producer, browser acceptance and server drift
checks are mandatory in Required PR checks. Browser never supplies
quality evidence, and image work need not wait for an unrelated browser journey. The
reusable quality job validates all fields and results before reuse; invalid or
foreign evidence fails. A blank receipt runs full `make ci`, including in standalone
manual managed runs, which expose no receipt/skip dispatch input. The feature-gated
fault fixture always runs. Image construction/smoke starts after preparation and
its image contract, independently of ordinary quality. Fault checks also start
after preparation and produce a complete same-attempt fixture receipt. The late
controller validates ordinary and fault receipts. The terminal managed result
requires every branch; unprivileged construction is never publication authority. No cross-workflow status lookup or previous green
candidate can supply quality evidence. A failed-job rerun can retain successful upstream outputs from an earlier
attempt. A complete valid earlier receipt with the same run/repository/candidate
selects full `make ci` in the current attempt; it is never reused. Future attempts,
foreign identities, malformed or incomplete results still fail closed. Browser/native/build/source-security are separately
required by the final aggregate, rather than falsely described as receipt contents.

## Parallel server acceptance and compatible symbol profiles (ALL-582)

`test-server` retains full backend tests and stable binary identity. The separate
`test-server-web` runs the unchanged frontend unit suite and full API/assets
checks. Both begin after exact candidate preparation; both are explicitly required
by the complete quality receipt and final aggregate. Neither lane can substitute
for the other on failures, missing results, skips or reruns. Backend Node remains
pinned for runtime capabilities; only the web lane installs web npm dependencies.

Mixed dev/test and browser build jobs set both test and dev debug-symbol levels
to zero. Optimization, assertions and overflow checks retain their existing
settings; shipping features and release builds do not change. Actual local NAC
exporter-then-test compilation reused 370 artifact units instead of recompiling
all 376, reducing that single compile comparison from 142.11s to 85.96s.
This used separate cold targets with a fetched registry and compiled tests
without running them. Feature mismatches still require compilation. Splitting
server jobs changes overlap, so these savings cannot be added to the parallel
lane model. Hosted cold/warm comparisons remain required; new roles/profiles
can miss existing trusted caches. Local defaults in the Makefile stay unchanged.

The refreshed baseline completed in 2,516s processing, 2,519s event-to-green,
with 3s initial wait and 6,467 executed job-seconds. Portable
[job](evidence/all-582/baseline-jobs.csv) and
[step](evidence/all-582/baseline-steps.csv) timestamps accompany the
[summary](evidence/all-582/baseline-summary.json). The run-scoped usage API
reported zero billable milliseconds for this public repository's standard
Ubuntu/macOS runners. GitHub documents standard public-runner compute as free
([billing documentation](https://docs.github.com/en/actions/concepts/billing-and-usage));
this is not a storage, larger-runner, local-host or future-plan cost estimate.

## Complete production browser partition (ALL-582)

Eight ordinary machines each run one native Playwright file shard, one worker,
zero retries, and unchanged real-clock journeys. A dedicated machine runs both
ALL471 goal-proof cases and the original bounded proof/cleanup collector. It
also lists the complete current suite and all nine partitions, rejecting any
missing, duplicate, unexpected or changed-skip selection before its journeys.
Each executing shard uses the same exclusion and shard arguments as those
inventories. The final aggregate requires every shard, proof job and browser
join in addition to independent assets/API drift checks. Failure artifacts have
unique shard/attempt names; bounded proof artifacts retain their existing scope.

The required `browser-binary` producer compiles once with explicit current source,
dev build identity and dev/test debug symbols disabled. Per-ID consumers verify
repository/run/attempt/compiler/runner/profile, full archive and binary digests
before exposing an executable. A fully valid older artifact selects a fresh
current-attempt source build; invalid or missing evidence fails. Pinned Rust and
all other runtime tools stay installed, and normal consumers explicitly keep
`CARGO_INCREMENTAL=0`. Only the source fallback restores its compiler cache; all
cache writes retain the existing trusted-push condition. Actual goal proofs bind
to the selected executable's path, full source and hash. See the
[binary transport and retry contract](browser-binary.md).

Static inventory metadata never supplies execution success. The aggregate uses
actual same-run job results, preserving successful siblings across GitHub's
failed-job rerun behavior without looking up prior green runs or caching verdicts.
See [browser partition commands and controls](browser-sharding.md) and the
[observed timing collector](ci-timings.md). Setup, compilation, scheduling and
artifact overhead on all machines remains part of measured processing and
executed-job totals; parallel execution does not imply lower total compute.

## Early image branch and complete late join (ALL-582)

Ordinary applicable candidates call `managed-image-build.yml` after preparation,
while `managed-fault.yml` starts the complete feature fixture after preparation.
`managed-quality.yml` waits for both complete same-attempt receipts.
The image unit retains candidate preparation, contract, exact image build/load/smoke,
trusted policy selection, inventory, live scan/qualification and evidence upload.
The late controller retains receipt validation, full fallback on blank/earlier
receipts, and mandatory fault tests/clippy whenever either full fallback applies.
Only two complete current-attempt receipts permit avoiding already finished
work. Compiler installation/cache restoration occurs only when execution is
required; malformed evidence fails before that work. Standalone dispatch still
supplies no early fault receipt and therefore runs the full fixture. All reusable units run contents-read with no publication
permissions or PR cache writes.

The always-run `managed` join requires image, early fault and late quality
success, verifies the
image workflow's resolved SHA against preparation, and fails on missing,
failed, cancelled or skipped work. Required PR checks independently enumerates
the image, early fault, late quality branches and the join. Only explicit non-applicability permits those managed branches and the join
to skip. Standalone managed dispatch calls the same implementation units and
still runs full `make ci`; it exposes no skip/receipt dispatch inputs. Stable
publication continues to wait for the full final aggregate.

This changes scheduling, not coverage. An earlier image failure does not cancel
ordinary quality or browser/native checks; all results remain observable. The
new joins and transfers add real processing overhead that must be measured,
not subtracted using DAG arithmetic. Earlier S03 candidates have completed
ordinary runs; the subsequent early-fault refinement still needs current-head
measurement.

Live scanner qualification now has its own mandatory branch after the image
contract, overlapping construction. Candidate inventory and scanning still use
the actual loaded/smoked image and independently obtain live tools/databases.
The image result enumerates both branches; failed, skipped, cancelled or missing
qualification cannot pass the aggregate. Fixture artifacts remain separate from
exact-image evidence. This saves a serial edge at the cost of additional runner
setup and independent database downloads; a fresh local qualification took
107.844 seconds, which is not an observed pipeline saving.

The image builder also compiles the exact locked dependency graph in a layer
keyed by unchanged workspace manifests. Placeholder local targets enable that
dependency compile; after real source COPY, `cargo clean --release --locked
--offline --workspace` removes every local workspace artifact before the exact
candidate build. This cleanup is mandatory: source timestamps alone can retain
a placeholder binary. External dependency outputs remain available, while local
build scripts, product code and embedded assets are compiled from real source.
Wolfi tooling/runtime and all image smoke/security obligations are unchanged.
`scripts/test-managed-dependency-layer.py` checks manifest bytes, workspace/target
coverage and cleanup ordering. First prelanding builds can miss the new layer;
PRs still cannot export it. The completed local
[S07 full-image comparison](evidence/all-582/S07-full-image/README.md) records
four exact linux/amd64 Wolfi images under ARM-host emulation, with fixed
four-CPU/6 GiB builders and Cargo two jobs. Warm wall time decreased 60.65% and
builder CPU 62.11%; external compile events fell from 305 to zero while all six
selected local crates rebuilt. Cold wall time increased 5.72%, without an
isolated cold-cost conclusion. Two guard-aborted attempts and the before-warm
retry's cached COPY remain explicit. Every exact-image smoke/inventory passed;
every fresh strict scan exited 1 with 32 blockers, so there is no security
clearance. These local observations do not qualify hosted/current-head coverage,
an ordinary cohort or additive whole-CI savings. Hosted warm evidence still
requires cache population by a human-approved dev/main push; unprivileged PRs
retain no shared-cache export. The portable evidence delivery itself adds no
optimization or cohort sample and leaves docs-only managed applicability false.

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
number and cancel superseded runs on synchronize or base-ref edits. Title/body
edits, ready transitions and reopen events queue without cancelling active work. Push/tag/manual runs have unique run groups
and `cancel-in-progress=false`, so their pending slots cannot replace one another.
The separate release-preparation/publication workflow remains non-cancellable.
The reusable managed workflow retains unique run/attempt groups; a superseded PR's
parent cancellation still cancels its children. Queue qualification/`merge_group`
support remains separate (ALL-460); this change enables no queue.

## Evidence procedure

### Avoiding unchanged-source rebuilds (ALL-582)

The shared build identity adapter watches this worktree's HEAD and the existing
loose refs used to resolve it. A packed or unborn ref watches its nearest
existing loose-ref parent and the existing packed-refs file (or parent). This
detects ref creation, packing, unpacking and shared-worktree updates without
handing Cargo a nonexistent watched path, which would rebuild on every command.
Explicit `NAC_SOURCE_REVISION` builds instead track the supplied environment
identity. Product version, track and build ID remain fingerprint inputs.

`node --test .github/scripts/pr-build-identity.test.mjs` exercises actual Cargo
fingerprints and embedded identity using dependency-free repositories, including
detached/symbolic/nested/unborn HEAD, linked worktrees, loose/packed transitions,
and environment/version changes. These tiny probes establish the mechanism;
their timings do not establish full-CI savings.

Managed Docker candidate arguments are scoped after source COPY and immediately
before compilation. Changing the candidate still rebuilds its exact binary but
does not invalidate preceding toolchain installation layers. Existing trusted
push-only layer-cache writes, Wolfi runtime, smoke and live scanner controls are
unchanged. A local warm BuildKit mechanism probe demonstrates layer reuse; full
linux/amd64 image and end-to-end measurements remain required.

ALL-582 remains open until its repeated ordinary-PR timing and coverage gates
qualify. See [the initial strategy receipts](evidence/all-582/initial-strategies.json)
for scoped measurements and limitations.

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


The S03 early-fault refinement is documented in [its receipt contract](managed-fault.md).
It is one scheduling strategy refined after the bottleneck moved, not another
attempt manufactured from the experiment budget. First complete ordinary metric
observations at earlier candidates were 1,022s and 1,027s processing (run IDs
41941010941 and 41941048432). These are successful metric samples, not a qualified
cohort: full representative changes, controlled cold-cache and current coverage
acceptance remain pending. The [coverage inventory](all-582-coverage.md) separates
those gates and known pre-existing schedule gaps.
