# Private metadata provider capability screen

This manual-only diagnostic tests provider primitives. It changes no production
workflow, quality gate, source admission, permission or cohort classification.
The only publication target is `codex/all-582-metadata-capability-registered`; root owns
publication and dispatch after ONE bounded independent source review. No PR is
created. Base: `914782659a6183b89070a3516e2e44776b1eeb06`.

## Registration-only revision / original stop preserved

Original private candidate `6a546046ca916d3cbea358f5298f4545beabe27c` and
`codex/all-582-metadata-capability` remain unchanged. Root's original workflow
GET returned404 because its new path was unregistered on default. No dispatch
POST, run or compute occurred: the actual run budget remains ZERO used. This
revision supersedes ONLY that registration/path prerequisite, not the graph or
production admission protocol. An unpushed APT-path draft was WITHDRAWN because
that registered pilot was push-only; it was never committed or dispatched.

Use `.github/workflows/nightly-portability.yml` ONLY on this NEW private branch,
Root verified actual current default branch `dev`, active workflow ID393682517,
and default blob754b8ec099c4cd9602b433da02600361c062c430 with real
workflow_dispatch (seed-failure input). The bounded authoritative reads and
original source are retained under `metadata-capability-runtime/eligible-*`
and `repository-for-registration.json`. This proves preflight eligibility only;
exact-private-ref dispatch remains unobserved. Preserve original default source
in the evidence packet. This is a branch-only DIAG override, MUST NEVER LAND, and
must never alter default/scheduled/native nightly behavior. No original default,
036 APT ref, other owner branch, settings, permissions or trigger is mutated.
The DIAG parent bytes are identical to6a546; the reusable DIAG child is unchanged.

Root must independently review only the changed capability/guards, then preflight
the registered nightly workflow with the exact new ref. Registered status alone
is insufficient. If manual eligibility or exact-ref support is unavailable,
STOP with no further path/trigger workaround. A404 preflight is not a run or
successful capability observation. At mostTWO actual dispatches remain allowed;
all accounting, failure-preservation and DIAG constraints below remain unchanged.
No source coalescing or optimization credit.

## Two-run graph and expected observations

Every workflow, job, reusable caller/child and step name begins DIAG (dynamic
job names resolve to DIAG). No protected source context is used, even as a
skipped job. Both workflows have only contents:read; public reads omit auth.

Run 1 (`phase=admit`, empty prior_run):

1. `DIAG admission v1 <digest>` validates exact source/manual/private branch,
   succeeds and deliberately emits NO mode output.
2. `DIAG intentionally failed or missing selector` deliberately fails with no
   output. That failure must remain failure; the whole run is expected failure.
3. `DIAG FULL aggregate default` uses the successful missing output; always runs.
4. `DIAG FULL caller default / DIAG child leaf` uses the failed missing output;
   always calls one tiny reusable child. Caller proxy versus actual child Jobs
   accounting is a provider observation; unexpected >4 records is inconclusive.

Run 2 (`phase=observe`, exact first run ID, same committed source/digest):

1. Admission selector reads first-run metadata, exact attempt-1 Jobs and that
   run's Checks suite, anonymously, at most three requests/512KiB each/25s total.
   It binds source/workflow/branch/repository/run/attempt/started marker and
   GitHub Actions app identity; quality conclusions are NOT admission inputs.
   It then emits the exact string pure. This is DIAG-only, not the production
   head/base/TREE/policy/cold admission protocol.
2. Sentinel succeeds but again omits output.
3. `DIAG PURE aggregate` records the successful no-output default expression.
4. `DIAG PURE caller omitted` is skipped; its child must not execute. Actual
   Jobs AND Checks must show no `DIAG FULL caller default / DIAG child leaf`
   or other full variant from this run. If renamed skipped callers register
   original/full aliases, the primitive fails. A skipped DIAG caller success
   is merely evidence of naming, never a source success.

The aggregate and caller deliberately use different default probes in run 1.
This fits both actual successful-missing and failed-selector-output name cases
without a fifth node. A selector failure in run 2 must produce FULL-safe names;
that would be a failed/inconclusive screen, not permission to retry.

## Root-only publication and runtime contract

Commit and independently review the original candidate plus this narrow
registration/path correction first. NEVER merge/cherry-pick this branch-only
nightly override into default or any ordinary source candidate. Root may
push the private branch and dispatch this manual workflow at that exact commit.
The already registered path still requires actual exact-private-ref capability;
if unavailable, STOP unsupported without adding triggers or landing solely to test.
Compute tuple_digest locally with the committed script's digest(full commit SHA):
import its `digest` function through Python importlib; no API call is needed. Fixed payload
is `["DIAG-only-v1","arcee-ai/nac",full_sha,".github/workflows/nightly-portability.yml"]`
serialized as compact JSON and SHA256. It is not a production tuple.

At most TWO dispatches, attempt1 only, no reruns/retries. Run2 requires terminal
run1, its actual assigned duration <=120 seconds, and sufficient remaining budget.
Root controller admits at most one diagnostic run at a time. Within a run max
two simultaneously assigned jobs (select+sentinel, then aggregate+one child);
no matrix or extra jobs. Each actual job has timeout-minutes:1, tiny commands,
no sleep/build/npm/cache/source tests/artifact transfer. There is no hard absolute
provider quota: root actively sums assigned job intervals (including child) and
cancels ONLY these owned runs at a conservative 240 assigned-second soft stop,
reserving up to120 seconds for cancellation/API/runner cleanup. If accounting
is unavailable, do not admit run2; if final total >=360 seconds, fail/inconclusive.
Each job stays below3min; final actual total must be <6 assigned runner-minutes.
No automatic retry if provider fails or fields/check associations differ.

Retain initial failures/cancellations, run/attempt/source/workflow, Jobs AND Checks
names/IDs/owners, request endpoint/byte/hash/no-auth receipts, prepare/step logs,
and actual job start/end sums. At most5MiB text across both runs. No large payload
or credential output. Verify final second-run names against its own Jobs/Checks,
not by commit-level latest selection; suite and run/attempt are mandatory.
Root performs this bounded final observation after terminal; the workflow does
not poll or grant Actions/Checks permissions. Preserve API errors as errors.

Local affected controls:

- `python3 .github/scripts/metadata-capability-diag.test.py`
- `node --test .github/scripts/metadata-capability-workflow.test.mjs`
- `make lint-workflows test-workflow-lint test-source-size`

## Still unresolved even if the screen passes

M1: unsupported squash/base/prepared identity, including914 squash, always FULL.
M2: trusted-base/program authority and complete canonical admission tuple.
M3: latest FULL check-consumer/naming/source freshness and PR required-check
semantics. Manual naming does not prove branch-protection or PR concurrency.
M4: complete intervening history; every unknown/missing/conflicting input FULL.

No cross-run quality verdict/receipt reuse. No production coalescing, source
queue proof, performance gain, new strategy or ordinary cohort credit. Goal
remains14 measured mechanisms/0 accepted cohort runs.
