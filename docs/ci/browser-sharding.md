# Production browser partition contract

Run independent browser machines with one Playwright worker per machine and zero
retries. Keep the default `fullyParallel: false` for complete discovery and the
dedicated proof lane. Ordinary CI execution and its inventory command both add
`--fully-parallel`, allowing native sharding to distribute individual tests while
keeping one worker per machine. Test-scoped harnesses retain separate workspaces,
stores, providers and browser contexts. This changes scheduling only; assertions,
real clocks, deadlines, cleanup and retry/ignore behavior stay intact.

The ordinary shards exclude `exact-goal-wait.e2e.ts` from Playwright's full-title
selection. A dedicated proof job runs that entire file, including both ALL471
cases, then validates and stages their four bounded proof/cleanup receipts.
The terminal browser result must require the exact binary producer, every
ordinary shard, the dedicated proof job and the complete selection check. Use
`fail-fast: false` for the ordinary matrix so a failed shard does not erase
other shards' evidence.

## Runnable selections

After the normal locked dependency setup, execute these commands from
`crates/nac-server/web`. All jobs must check out the same prepared candidate.
`NAC_E2E_BINARY` must name the verified same-run executable or the valid
older-attempt fresh-source fallback from [the transport contract](browser-binary.md), and
`NAC_E2E_ARTIFACTS` must be an isolated job-owned directory.

```sh
# Each ordinary matrix job: index is 1 through 8.
./node_modules/.bin/playwright test --fully-parallel --grep-invert='exact-goal-wait.e2e.ts' \
  --shard="$index/8" --list --reporter=json > ordinary-inventory.json
./node_modules/.bin/playwright test --fully-parallel --grep-invert='exact-goal-wait.e2e.ts' \
  --shard="$index/8"

# The dedicated goal-proof job: no ordinary shard filter.
./node_modules/.bin/playwright test --list --reporter=json > complete-inventory.json
./node_modules/.bin/playwright test exact-goal-wait.e2e.ts \
  --list --reporter=json > proof-inventory.json
./node_modules/.bin/playwright test exact-goal-wait.e2e.ts
```

From the repository root, stage the proof after execution with:

```sh
python3 .github/scripts/browser-proof.py \
  --root "$NAC_E2E_ARTIFACTS" --source "$CANDIDATE_SHA"
python3 .github/scripts/browser-binary.py verify-proof \
  --binary "$NAC_E2E_BINARY" --source "$CANDIDATE_SHA" \
  --proof-dir "$NAC_E2E_ARTIFACTS/all471-goal-proof-artifact"
```

Upload only `all471-goal-proof-artifact/*.json` as the bounded proof artifact.
Name it
`all471-goal-proof-${{ needs.prepare.outputs.sha }}-${{ github.run_id }}-${{ github.run_attempt }}`.
The source prefix remains searchable while each run/attempt has a distinct
immutable upload. Keep overwrite disabled: earlier proof and cleanup receipts
remain available when a job is rerun. The existing five files (two goal proofs,
two cleanup ledgers and their manifest) and their bounds are unchanged.
The collector retains the original candidate, release, goal, accounting-run,
native-call and process-exit validation; it stages nothing until both cases
validate. Collection and upload failures remain job failures even when test
execution has already failed. Failed jobs are never converted to success by
successful artifact collection.

## Complete selection check

The dedicated proof job also generates all eight ordinary selection inventories
locally, using exactly the same shard and exclusion arguments as the matrix.
The inventories are static selection metadata, not execution receipts. This
avoids cross-machine artifact aggregation and preserves GitHub's existing
failed-job retry behavior when successful sibling jobs remain from an earlier
attempt of the same run. Never look up a green run, reuse previous-candidate
artifacts or cache a browser verdict.

The proof job executes the validator with the complete inventory, the dedicated
proof inventory FIRST and then all eight ordinary inventories. The validator
requires serial mode for complete/proof and individual-test mode for every
ordinary part; applying the flag globally or putting proof into ordinary fails:

```sh
python3 .github/scripts/browser-inventory.py \
  --complete complete-inventory.json --part proof-inventory.json \
  --part ordinary-1.json --part ordinary-2.json \
  --part ordinary-3.json --part ordinary-4.json \
  --part ordinary-5.json --part ordinary-6.json \
  --part ordinary-7.json --part ordinary-8.json
```

Retain these static inventories separately from the bounded proof artifact when
needed for diagnostics. Workflow controls must enforce that the matrix execution
and the inventory generation use the same filters and shard count. The final
browser aggregate requires successful producer, ordinary matrix and proof-job
results; it does not infer execution success from these inventories.

The validator rejects collection errors, empty or duplicate inventories, missing
or unexpected tests, duplicate execution across parts, changed expected skips,
additional workers, wrong lane-specific parallel mode and retries. Selection
completeness is separate from execution success: a complete list does not establish any test passed. Existing
candidate identity and fail-closed required-check aggregates remain mandatory.

Focused controls:

```sh
python3 .github/scripts/browser-proof.test.py
python3 .github/scripts/browser-inventory.test.py
cd crates/nac-server/web
./node_modules/.bin/vitest run e2e/harness-cleanup.test.ts e2e/harness-workspace.test.ts
```

## Measurement

Disclose the number of machines, workers per machine, compilation/setup and
artifact overhead, cache state and total executed job time. Native individual-test
sharding, native file sharding and multiple workers in one local runner are different execution arrangements. A local concurrency
comparison can qualify isolation; it does not qualify hosted processing latency.
Use observed preparation-to-final-required-result timings for ALL-582 acceptance,
and report event-to-green and initial wait separately. Keep failed/cancelled runs
and distinguish current test inventories from historical duration models.

## S02 individual-test refinement evidence

At `3769e2aa11d2c36de75305355f167c921b2b81e8`, both native inventory arrangements
cover exactly 205 tests with the same two proof cases. Ordinary individual-test
shards are all nonempty (26/26/26/25/25/25/25/25); all retain one worker and zero
retries. The current native suite has no `beforeAll`/`afterAll`/serial suite or
worker-scoped harness coupling; the remote suite with all-hooks remains excluded.
Future fixture lifecycle changes need isolation review. No E2E/config/assertion
source changed for this refinement. Proof execution, collection, identity and
join controls are unchanged.

The historical 132s fresh-interval premise is absent from current source and was
rejected. Actual cold PR #614 run `41980585599` instead has 44 tests on ordinary
shard 5 (43 passed, one existing review-fixture skip), with 284.3s summed test time,
versus nine tests and 30.8s on shard 6. Current `session-names.e2e.ts` contains
21 tests totaling 154.7s in that run. Applying those observed times to the actual
new native assignment models a maximum of 188.609s versus 284.3s. This is an
assignment model, not a hosted latency measurement; setup, contention and changed
worker lifetimes may differ.

One ordered Mac file-only comparison then executed all 21 current session-name
cases exactly once in each mode, with identical IDs/deadlines and zero failures,
skips or retries. Old four-way file selection is 21/0/0/0, so only one worker is
active; new individual selection is 6/5/5/5, with four independent native CLI
processes, one worker each. Elapsed time fell from 112.709s to 33.616s (70.2%) for
this file. This does not establish a gain for the full ordinary lane or eight
hosted machines. User plus system CPU rose from 102.51s to 117.81s; sampled process
RSS sums peaked at 2,070,336KiB and 5,236,512KiB respectively (shared pages can be
counted more than once). No compute/capacity saving is claimed.

Both arms used one immutable APFS-cloned executable, SHA256
`7f311f35ca780d04c7365483b82f708e087e2a01cca66ababa0532ed74713010`. Its compiled
source identity is `28ac6bead8fbb616fe424b7a720c1b72a35a3f00`; all Rust/build inputs,
lock/version and committed assets match `3769e2aa` exactly. This disclosed identity
difference means the local run is scheduling/isolation evidence, not candidate
ALL471 or current-head CI acceptance. Actual test source stayed immutable at
`9db6465ed019af0a32a1086d620a333fdb11329b` for both arms. No Rust build occurred.

Raw reports/commands, cold timing model, binary binding, process/resource evidence
and all 21 names are in the [portable S02 record](evidence/all-582/browser-test-granularity.json).
Both arms ended with no owned binary processes; harness teardown remained
mandatory while test data was retained. Added owned data was about 406MB, free
disk remained above 12GiB, and peak worker slots were four. First outcomes were
kept; no runtime failure was rerun. Full ordinary/proof hosted qualification
remains pending. This refines S02 and adds no optimization-strategy count.
