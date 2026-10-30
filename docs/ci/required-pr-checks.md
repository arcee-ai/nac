# Required PR checks and current dev protection

[ALL-506](https://linear.app/arcee/issue/ALL-506) prepares an additive update to
NAC's **observed** ruleset 25983949. Live activation requires separate human
authorization. No settings are changed by the tooling or this PR.

The October 30 [before snapshot](evidence/2026-10-30-required-check-before-seven-owners.json)
shows active `main` on `~DEFAULT_BRANCH` (currently `dev`), no bypass actors,
one approval, CODEOWNERS, last-push approval, resolved threads, and extra approval
for unattributed changes. Stale-review dismissal is currently false. Existing
merge methods, deletion/force-push protections, and inherited enterprise rules
remain unchanged. [The intended plan](evidence/2026-10-30-required-check-plan-seven-owners.json)
appends exactly one required-status-check rule: `Required PR checks`, GitHub
Actions integration **15368**, strict current-base checks, enforced on creation.
It updates that existing ruleset; it does not introduce a second review policy.

This snapshot records all seven designated owners' actual live permissions,
including Ada (`adalundhe`, ID `23642200`, write), and the **six-owner CODEOWNERS
actually served by dev** at capture time. The seven-owner source is inherited
from the separate [Ada roster PR #470](https://github.com/arcee-ai/nac/pull/470).
Until that roster lands on dev, production activation correctly rejects the
observed CODEOWNERS. Capturing permission to write is not proof of landed ownership.

The original [three-owner snapshot](evidence/2026-10-27-required-check-before.json)
and [plan](evidence/2026-10-27-required-check-plan.json), plus the
[six-owner snapshot](evidence/2026-10-27-required-check-before-six-owners.json)
and [plan](evidence/2026-10-27-required-check-plan-six-owners.json), remain unchanged
historical receipts. They lack Ada's verified identity and cannot qualify the
seven-owner baseline. This planner layer does not change reviewer membership.

ALL-450's earlier bypass/review proposal is historical and must not be applied
to current settings. ALL-450 remains a completed foundation milestone; ALL-506
owns this follow-up. A JSON proposal, PR merge or Done label never proves that
production enforcement is active.

## Complete aggregate and events

`stable-release.yml` emits `Required PR checks` for every eligible pull-request
update and main/dev push without top-level path exclusions. It also accepts
manual runs. Its preparation binds the immutable workflow candidate and explicit
managed applicability; the always-run aggregate requires successful prepare,
Rust server/core/workspace, lint/workflow lint, quality, browser, test, build,
source security, and native macOS results. Applicable managed work requires its
complete contract/quality/build/smoke/image-security graph. Only explicitly
non-applicable managed work may skip. Missing, failed, pending, cancelled and
unexpectedly skipped expected work fail closed. Tests live in
`.github/scripts/pr-checks.test.mjs` and adjacent workflow/security contracts.

Docs-only changes still emit the complete aggregate, with managed explicitly
non-applicable. Rust, web, API, Docker, workflow and script changes run managed
coverage. No merge queue or `merge_group` contract is introduced. Nested reusable
job names and the old `test` context are not substitutes for this exact context.

[ALL-505](https://linear.app/arcee/issue/ALL-505) owns strict image propagation
and fresh combined-image/unchanged-image qualification. Historical successful
aggregates under advisory image reporting cannot qualify activation. ALL-504
owns Rust-toolchain coverage, ALL-500–503 content/applicability, and ALL-507 the
private publisher. ALL-461 is deferred ArceeFM adoption, outside NAC enforcement.

## Read-only preparation and drift checks

The verified owner roster and immutable GitHub account IDs live in
`.github/scripts/pr-ruleset.mjs`. To add or remove an owner, verify that account's
ID and repository write access, edit that roster, then run
`make generate-codeowners`. This updates `.github/CODEOWNERS` and the embedded
reviewer list in the metadata-only workflow. `make lint-workflows` and the PR
contract tests reject stale generated ownership files with the regeneration command.
Sam (`samantha662`), Gerred (`gerred`) and Travis (`tmcarcee`) were verified with
write/admin/write access on October 27, 2026.
Ada (`adalundhe`, immutable account ID `23642200`) was verified with repository
write access on October 30, 2026.
Scott (`ScottZembsch`, immutable account ID `109129358`) was also verified with
repository write access on October 30, 2026.

Run from the intended repository with authenticated read access:

```sh
node .github/scripts/pr-ruleset.mjs snapshot arcee-ai/nac /tmp/nac-before.json
node .github/scripts/pr-ruleset.mjs plan /tmp/nac-before.json > /tmp/nac-plan.json
```

The snapshot captures repository merge methods, every repository/inherited
ruleset, effective dev rules, classic protection, owner permissions, current dev
revision, CODEOWNERS and check runs. `plan` preserves the existing writable
ruleset fields and appends only the required-check rule. Unknown existing review
parameters remain intact. An already-present status rule or changed target,
branch condition, bypass policy or missing review protection requires rebaseline.
No HTTP write command is implemented.

The checked-in snapshot/plan are evidence of intent at capture time, not reusable
activation receipts. Refresh them before qualification. A real fixture receipt
must bind both the exact proposed payload digest and full settings identity.
Never fill its fields with local model output or copy an old successful receipt.

Planner tests preserve the actual captured CODEOWNERS in the observed fixture.
Their positive activation helper explicitly derives **prospective local test
data** with canonical seven-owner CODEOWNERS and a synthetic successful check.
A negative proves that actual prelanding six-owner CODEOWNERS still cannot
activate, even with a synthetic complete receipt and passing check. These local
models do not certify that the roster, platform qualification or protections landed.

## Real safe-repository and actor matrix — unperformed

No disposable GitHub repository or ordinary-actor credentials were authorized or
supplied in this lane. **All platform cases below remain unperformed.** Local
planner/aggregate tests exercise JSON and result semantics only. They do not
prove GitHub merge rejection, actor identity, CODEOWNERS behavior or enforcement.
Do not attempt a deliberately red production merge to fill these gaps.

With separately authorized fixture access, mirror the observed review and
inherited protections plus the proposed status rule into the safe repository.
Use an ordinary non-bypass actor's authentication for attempts. Record actor ID,
PR/head/base SHAs, check-run ID/App, event, attempt time, actual API/UI rejection
or success, and durable evidence URLs. Do not grant any bypass to run the matrix.
`qualificationCases` in `pr-ruleset.mjs` is the exact machine-checked case list:

| Cases | Required platform evidence |
| --- | --- |
| Rust/web/workflow/docs/managed passes | Exact aggregate emitted and succeeds with complete expected results and explicit applicability |
| API/assets/browser/image failure; image Unknown | Expected lane fails, artifacts survive, aggregate fails, ordinary merge rejected |
| Failed/pending/cancelled/missing/unexpected skip | Actual state at attempted ordinary merge rejects it; pending attempt time precedes completion |
| Stale check/base; wrong App | Old-head/base success and same-name foreign-App success cannot authorize merge |
| ALL-505 strict baseline | Fresh complete combined native amd64 image scan and unchanged-image rescan, fresh DB, zero unresolved/unapproved blockers; link full reports, not advisory historical green |
| Each of the seven designated non-author approvals | Eligible approval works when all other protections pass |
| Self/outside-only/last-pusher approval | Cannot satisfy the preserved CODEOWNERS and last-push approval requirements |
| Unattributed changes and threads | Required extra approval remains effective; unresolved conversation blocks |
| Requests/bot PRs | Author excluded; eligible owner requests preserved |
| Two-layer gh-stack | Both immediate bases contain intended CODEOWNERS; each PR emits complete candidate-bound checks; record the intermediate-base protection gap, then qualify strict/review enforcement after retarget to dev |
| Ordinary/automation bypass and direct push | No bypass; inherited deletion/force-push/transfer restrictions remain effective |

For the two-layer fixture, use the installed extension in the safe checkout:

```sh
gh stack init --base dev codex/fixture-lower
# Commit a harmless fixture change after verifying dev CODEOWNERS.
gh stack add codex/fixture-upper
# Commit a separate harmless change; retain CODEOWNERS in the lower base.
gh stack submit --auto --open
gh stack view --json
```

Capture both live PR bases, heads, diffs, requested reviewers and check runs.
Verify the base branch's CODEOWNERS is authoritative for each PR. This exact
ruleset targets only `~DEFAULT_BRANCH`: an upper PR targeting
`codex/fixture-lower` does **not** inherit its required checks or review rules.
CODEOWNERS in that base and a green aggregate do not establish enforcement.
Record that intermediate-base limitation explicitly; do not broaden branch
protection or claim that an intermediate PR is safe to merge. After a separately
authorized lower-layer landing, retarget the upper PR to `dev`, refresh its
candidate checks/review requests, and qualify stale-base invalidation and all
preserved review requirements there. If landing/retarget access is unavailable,
leave that platform case unperformed. No production
stack or another owner's branch may be rebased for this exercise. Successful
fixture merges need their own explicit authorization; planner tests are not that
authority. If unavailable, leave the exact successful-merge cases unperformed.

The [current template](evidence/qualification-template.json) is deliberately
marked `template-not-qualification`, with every case `unperformed`. It cannot
pass the validator. Populate only real observed evidence after separate fixture
authorization and human inspection; never change result fields to bypass a gate.

The receipt schema is `schema_version: 1`, `kind: github-platform-qualification`,
`fixture_repository`, `baseline_sha256`, `payload_sha256`, `completed_at`, and
`cases`. Each exact case needs `name`, `result: passed`, `actor_id`, full
`head_sha`, and a fixture-repository `evidence_url`. It expires after seven days.
A human must inspect underlying actor/results evidence: schema checks cannot
verify that a linked claim actually occurred.

## Administrator application, readback and rollback

Only proceed after ALL-505 qualification, the real matrix, landed seven-owner CODEOWNERS,
current-head/current-base aggregate success, and separate human activation
authorization. Confirm the current aggregate actually uses strict image logic.
Generate a fresh read-only activation handoff:

```sh
node .github/scripts/pr-ruleset.mjs activation-plan /tmp/nac-before.json /tmp/fixture-qualified.json > /tmp/nac-activation-plan.json
```

This recaptures full settings and refuses drift, a snapshot older than one hour,
wrong CODEOWNERS, or absent/non-success/wrong-App/old-head checks. The newest
exact-App check-run wins; an older success cannot mask a queued/failed rerun.
Do not apply the older checked-in plan directly. Rebaseline and repeat affected
qualification on any policy drift.

An authorized administrator should arrange exclusive settings ownership for the
operation, refresh/compare immediately before writing, and use GitHub's ruleset
UI or `PUT /repos/arcee-ai/nac/rulesets/25983949` with **only** the reviewed
`proposed_ruleset` from that fresh handoff. GitHub does not offer an atomic
compare-and-swap across these settings; the read-only tool cannot eliminate a
concurrent administrator race. Abort if exclusive ownership or exact baseline
cannot be confirmed. Do not create/delete rulesets or change review/bypass policy.

After application, capture actual server state and verify it:

```sh
node .github/scripts/pr-ruleset.mjs snapshot arcee-ai/nac /tmp/nac-after.json
node .github/scripts/pr-ruleset.mjs verify-readback /tmp/nac-before.json /tmp/nac-after.json > /tmp/nac-readback.json
```

Readback requires exactly the one rule addition in both the target and effective
rules, preserving every other ruleset, branch condition, owner, merge method,
classic protection and CODEOWNERS. Server-generated update timestamps and rule ordering may change; every rule's
parameters and multiplicity must remain identical. Readback older than one hour,
future or invalid capture times are rejected before a rollback payload is returned.
Repeat representative fresh success and failed/pending/wrong-App ordinary-actor
cases, plus last-push/thread rejection and a two-layer base check. Record actual
observed after state and receipts separately from the intended plan.

Rollback also needs separate human authorization. Refresh and rerun readback
first; if anything else drifted, stop for a reviewed plan rather than overwriting
it. A matching readback returns the original `rollback_ruleset`, which removes
only this added status rule and retains the original review/no-bypass policy.
This is emergency protection rollback, not a report-only image mode or authority
to merge vulnerable candidates. Keep strict scanner/report failures in place,
preserve evidence, and repair the failed lane. Re-read/verify restored rules and
inherited/classic protection after any authorized rollback.
