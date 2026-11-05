# Production browser partition contract

Run independent browser machines with one Playwright worker per machine and zero
retries. Keep `fullyParallel: false`: a test file stays together, and the suite's
existing fixture lifecycle, process cleanup, clipboard, native terminal and real
clock behavior remain effective. This partition changes scheduling only.

The ordinary shards exclude `exact-goal-wait.e2e.ts` from Playwright's full-title
selection. A dedicated proof job runs that entire file, including both ALL471
cases, then validates and stages their four bounded proof/cleanup receipts.
The terminal browser result must require every ordinary shard, the dedicated
proof job and the complete selection check. Use `fail-fast: false` for the
ordinary matrix so a failed shard does not erase other shards' evidence.

## Runnable selections

After the normal locked dependency setup, execute these commands from
`crates/nac-server/web`. All jobs must check out the same prepared candidate.
`NAC_E2E_BINARY` must name that candidate's production-embedded binary, and
`NAC_E2E_ARTIFACTS` must be an isolated job-owned directory.

```sh
# Each ordinary matrix job: index is 1, 2, 3 or 4.
./node_modules/.bin/playwright test --grep-invert='exact-goal-wait.e2e.ts' \
  --shard="$index/4" --list --reporter=json > ordinary-inventory.json
./node_modules/.bin/playwright test --grep-invert='exact-goal-wait.e2e.ts' \
  --shard="$index/4"

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
```

Upload only `all471-goal-proof-artifact/*.json` as the bounded proof artifact.
The collector retains the original candidate, release, goal, accounting-run,
native-call and process-exit validation; it stages nothing until both cases
validate. Collection and upload failures remain job failures even when test
execution has already failed. Failed jobs are never converted to success by
successful artifact collection.

## Complete selection check

The dedicated proof job also generates all four ordinary selection inventories
locally, using exactly the same shard and exclusion arguments as the matrix.
The inventories are static selection metadata, not execution receipts. This
avoids cross-machine artifact aggregation and preserves GitHub's existing
failed-job retry behavior when successful sibling jobs remain from an earlier
attempt of the same run. Never look up a green run, reuse previous-candidate
artifacts or cache a browser verdict.

The proof job executes the validator with the complete inventory, the dedicated
proof inventory and all four ordinary inventories:

```sh
python3 .github/scripts/browser-inventory.py \
  --complete complete-inventory.json --part proof-inventory.json \
  --part ordinary-1.json --part ordinary-2.json \
  --part ordinary-3.json --part ordinary-4.json
```

Retain these static inventories separately from the bounded proof artifact when
needed for diagnostics. Workflow controls must enforce that the matrix execution
and the inventory generation use the same filters and shard count. The final
browser aggregate requires successful ordinary matrix and proof-job results;
it does not infer execution success from these inventories.

The validator rejects collection errors, empty or duplicate inventories, missing
or unexpected tests, duplicate execution across parts, changed expected skips,
workers/parallelism changes and retries. Selection completeness is separate from
execution success: a complete list does not establish any test passed. Existing
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
artifact overhead, cache state and total executed job time. Native file sharding
and multiple workers on one host are different mechanisms. A local concurrency
comparison can qualify isolation; it does not qualify hosted processing latency.
Use observed preparation-to-final-required-result timings for ALL-582 acceptance,
and report event-to-green and initial wait separately. Keep failed/cancelled runs
and distinguish current test inventories from historical duration models.
