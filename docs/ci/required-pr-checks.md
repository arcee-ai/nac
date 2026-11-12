# Required PR checks and current dev protection

> **Live `dev` readback, November 11, 2026.** Ordinary PRs require strict
> `Required PR checks` from GitHub Actions integration **15368** and one
> code-owner approval, last-push approval and resolved review threads. Those
> requirements are now together in [ruleset **26484091**](https://github.com/arcee-ai/nac/settings/rules/26484091),
> which gives only Allison (User **20910163**) a `pull_request`-only bypass.
> [Ruleset **25983949**](https://github.com/arcee-ai/nac/settings/rules/25983949)
> still requires a PR and prohibits deletion/non-fast-forward updates, but has
> **no** required-status-check rule or bypass actor. Allison moved the status
> rule between the two rulesets on November 4 at 23:43 UTC. Her technical
> bypass includes the checks in 26484091; using it requires separate explicit
> human authorization. The real ordinary-actor/two-layer matrix and ALL-505
> strict-image qualification remain unperformed.
>
> **The ALL-506 proposal below is historical.** Its snapshots, plan, fixture
> matrix and administrator `PUT`/rollback instructions assume a different
> no-bypass ruleset placement. The planner rejects the current live state.
> Do not run or apply that handoff against today's settings. Any future policy
> change needs a newly reviewed design, live rebaseline, qualification and
> separate human authorization. See [manual stack override](../manual-stack-override.md)
> for the current PR-only bypass procedure.

## Historical ALL-506 no-bypass proposal

[ALL-506](https://linear.app/arcee/issue/ALL-506) prepared an additive update to
NAC's **then-observed** ruleset 25983949. Its proposed live activation required
separate human authorization. The tooling and PR did not change settings.

On November 3, 2026, Allison authorized a native GitHub review-approval
exception for only `allisoneer` (User **20910163**). The
[observed ruleset readback](evidence/2026-11-03-review-exemption-rulesets.json)
was independently verified at **20:33:38 UTC**:

- Universal ruleset **25983949** remains active on `~DEFAULT_BRANCH` (`dev`),
  with **no bypass actors**. It requires PRs and resolved review threads, retains
  deletion/force-push protections and merge methods, and has zero required
  approvals with CODEOWNERS, last-push and unattributed-extra approval disabled.
- Review-only ruleset **26484091** has the same branch condition and preserves
  the complete prior review policy: one approval, CODEOWNERS, last-push approval,
  extra approval for unattributed changes, resolved threads and merge methods.
  Stale-review dismissal remains false. Its sole bypass is User **20910163**, mode
  `pull_request`; no team, role or broad administrator bypass is configured.
- Inherited enterprise rules remain unchanged. No merge or direct-push probe was
  performed. Configured approval bypass does not establish that conflicts,
  drafts, requested changes or every other GitHub merge condition permit merging.

This was Allison's human approval exception at the November 3 readback. It
grants agents no merge authority, no authority to exercise bypass credentials,
and no scanner-policy trust. Review
requests and the nine-owner CODEOWNERS roster remain unchanged. All other users
required the preserved review policy. Under this proposal, universal PR/thread
requirements and future no-bypass checks would have applied to Allison as well.

**At the November 3 snapshot, required-status-check activation was unperformed.**
The historical planner validated both rulesets, then proposed one required-status-check
rule only to no-bypass **25983949**: `Required PR checks`, GitHub Actions
integration **15368**, strict current-base checks, enforced on creation. It never
changed then-review-only **26484091** or any bypass list. This source update
changed no live settings, CI/scanner policy, publisher trust or automation authority.

The October 30 [nine-owner snapshot](evidence/2026-10-30-required-check-before-nine-owners.json)
and [plan](evidence/2026-10-30-required-check-plan-nine-owners.json) describe the
previous single-ruleset review policy. They remain dated historical evidence and
cannot qualify the new split. The November receipt contains observed rulesets
only, not a fresh full planner snapshot or completed platform qualification.

The original [three-owner snapshot](evidence/2026-10-27-required-check-before.json)
and [plan](evidence/2026-10-27-required-check-plan.json), plus the
[six-owner snapshot](evidence/2026-10-27-required-check-before-six-owners.json)
and [plan](evidence/2026-10-27-required-check-plan-six-owners.json), plus the
[seven-owner snapshot](evidence/2026-10-30-required-check-before-seven-owners.json)
and [plan](evidence/2026-10-30-required-check-plan-seven-owners.json), remain unchanged
historical receipts. The [prelanding eight-permission snapshot](evidence/2026-10-30-required-check-before-eight-owners.json)
and [plan](evidence/2026-10-30-required-check-plan-eight-owners.json), and the
[landed eight-owner snapshot](evidence/2026-10-30-required-check-before-eight-owners-landed.json)
and [plan](evidence/2026-10-30-required-check-plan-eight-owners-landed.json), also
remain unchanged. The latter records the actual landing of the
[Ada/Scott roster PR #470](https://github.com/arcee-ai/nac/pull/470).
These older receipts lack Crystalcareai's verified identity and cannot qualify
the nine-owner baseline. Capture a fresh full snapshot before qualification or
activation.

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
Crystalcareai (immutable account ID `162942000`) was verified with repository
admin access on October 30, 2026.

The historical read-only commands were run from the intended repository with
authenticated read access:

```sh
node .github/scripts/pr-ruleset.mjs snapshot arcee-ai/nac /tmp/nac-before.json
node .github/scripts/pr-ruleset.mjs plan /tmp/nac-before.json > /tmp/nac-plan.json
```

The historical snapshot captured repository merge methods, every
repository/inherited ruleset, effective dev rules, classic protection, owner
permissions, current dev revision, CODEOWNERS and check runs. Under this
proposal, `plan` preserved the writable universal ruleset fields and appended
only the required-check rule. Both exact
ruleset identities, branch conditions, the sole Allison User/PR-only bypass and
complete review parameters are validated. Missing/moved rules, changed review
parameters or bypass actors/modes fail closed. An already-present status rule
requires a fresh reviewed baseline. Every other rule remains intact.
No HTTP write command is implemented.

The checked-in snapshot/plan are evidence of intent at capture time, not reusable
activation receipts. Refresh them before qualification. A real fixture receipt
must bind both the exact proposed payload digest and full settings identity.
Never fill its fields with local model output or copy an old successful receipt.

Planner tests combine the exact November ruleset receipt with older snapshot
metadata and explicitly synthetic effective rules, passing checks, CODEOWNERS
and qualification receipts. These models test guards only; they do not certify
current owner permissions, roster landing, platform behavior or activation. The
historical eight-owner and six-owner CODEOWNERS cases still cannot activate,
even with synthetic passing checks and a complete model receipt.

## Real safe-repository and actor matrix — unperformed

No disposable GitHub repository or ordinary-actor credentials were authorized or
supplied in this lane. **All platform cases below remain unperformed.** Local
planner/aggregate tests exercise JSON and result semantics only. They do not
prove GitHub merge rejection, actor identity, CODEOWNERS behavior or enforcement.
Do not attempt a deliberately red production merge to fill these gaps.

With separately authorized fixture access, mirror the observed review and
inherited protections plus the proposed status rule into the safe repository.
Use an ordinary actor other than Allison for review-rejection attempts.
Allison-specific cases require her separately authorized human participation.
Record actor ID,
PR/head/base SHAs, check-run ID/App, event, attempt time, actual API/UI rejection
or success, and durable evidence URLs. Mirror only the approved single-User
PR-only review exception; do not add fixture actors to any bypass list.
`qualificationCases` in `pr-ruleset.mjs` is the exact machine-checked case list:

| Cases | Required platform evidence |
| --- | --- |
| Rust/web/workflow/docs/managed passes | Exact aggregate emitted and succeeds with complete expected results and explicit applicability |
| API/assets/browser/image failure; image Unknown | Expected lane fails, artifacts survive, aggregate fails, ordinary merge rejected |
| Failed/pending/cancelled/missing/unexpected skip | Actual state at attempted ordinary merge rejects it; pending attempt time precedes completion |
| Stale check/base; wrong App | Old-head/base success and same-name foreign-App success cannot authorize merge |
| ALL-505 strict baseline | Fresh complete combined native amd64 image scan and unchanged-image rescan, fresh DB, zero unresolved/unapproved blockers; link full reports, not advisory historical green |
| Each of the nine designated non-author approvals | Eligible approval works when all other protections pass |
| Ordinary other-user self/outside-only/last-pusher approval | Cannot satisfy the preserved CODEOWNERS and last-push approval requirements |
| Ordinary other-user unattributed changes and threads | Required extra approval remains effective; unresolved conversation blocks |
| Requests/bot PRs | Author excluded; eligible owner requests preserved |
| Two-layer gh-stack | Both immediate bases contain intended CODEOWNERS; each PR emits complete candidate-bound checks; record the intermediate-base protection gap, then qualify strict/review enforcement after retarget to dev |
| Ordinary other-user/automation bypass and direct push | No bypass; inherited deletion/force-push/transfer restrictions remain effective |
| Allison review-approval bypass in this proposed fixture | Only User 20910163 could bypass reviewer/CODEOWNERS approval via a PR under the modeled split; record actual behavior without claiming every merge condition succeeds |
| Allison checks, unresolved threads and direct push in this proposed fixture | The modeled no-bypass checks/thread requirements and PR requirement would have remained effective; this row does not describe today's placement |

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
Verify the base branch's CODEOWNERS is authoritative for each PR. Both split
rulesets target only `~DEFAULT_BRANCH`: an upper PR targeting
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

The [October template](evidence/qualification-template.json) remains historical,
marked `template-not-qualification`, with every case `unperformed`. Its old
payload/baseline and actor case list cannot qualify the November split. Create a
new receipt bound to a fresh full snapshot and current `qualificationCases`,
using only real observed evidence after separate fixture authorization and human
inspection; never change result fields to bypass a gate.

The receipt schema is `schema_version: 1`, `kind: github-platform-qualification`,
`fixture_repository`, `baseline_sha256`, `payload_sha256`, `completed_at`, and
`cases`. Each exact case needs `name`, `result: passed`, `actor_id`, full
`head_sha`, and a fixture-repository `evidence_url`. It expires after seven days.
All `allisoneer-` cases require actor ID 20910163; `ordinary-` and automation
bypass cases reject that ID. A human must inspect underlying actor/results
evidence: schema checks cannot verify that a linked claim actually occurred.

## Historical administrator application, readback and rollback — do not execute

This procedure targeted the earlier no-bypass placement in 25983949. It is
invalid against the current live rulesets and must not be used as an activation
or rollback procedure. At the time it required ALL-505 qualification, the real
matrix, landed nine-owner CODEOWNERS, current-head/current-base aggregate
success and separate human activation authorization. The historical read-only
handoff command was:

```sh
node .github/scripts/pr-ruleset.mjs activation-plan /tmp/nac-before.json /tmp/fixture-qualified.json > /tmp/nac-activation-plan.json
```

This recaptures full settings and refuses drift, a snapshot older than one hour,
wrong CODEOWNERS, or absent/non-success/wrong-App/old-head checks. The newest
exact-App check-run wins; an older success cannot mask a queued/failed rerun.
Even under the former design, the checked-in plan was not an activation payload.
Today's ruleset placement requires a newly reviewed design; rerunning this
historical activation command cannot repair that drift.

The earlier proposal would have used GitHub's ruleset UI or
`PUT /repos/arcee-ai/nac/rulesets/25983949` with only its reviewed
`proposed_ruleset`, after exclusive settings ownership and an immediate baseline
comparison. **That payload is stale and must not be applied.** GitHub does not
offer an atomic compare-and-swap across these settings; the read-only tool
cannot eliminate a concurrent administrator race.

The proposed post-application readback would have captured server state with:

```sh
node .github/scripts/pr-ruleset.mjs snapshot arcee-ai/nac /tmp/nac-after.json
node .github/scripts/pr-ruleset.mjs verify-readback /tmp/nac-before.json /tmp/nac-after.json > /tmp/nac-readback.json
```

That historical readback required exactly the one rule addition in both the target and effective
rules, preserving every other ruleset, branch condition, owner, merge method,
classic protection and CODEOWNERS. Server-generated update timestamps and rule ordering may change; every rule's
parameters and multiplicity must remain identical. Readback older than one hour,
future or invalid capture times are rejected before a rollback payload is returned.
The proposed qualification also required representative fresh success and
failed/pending/wrong-App ordinary-actor cases, plus last-push/thread rejection
and a two-layer base check. Those cases have not been completed for the current
live placement.

The historical rollback would also have required separate human authorization
and a matching readback. Its `rollback_ruleset` targeted only the proposed
status rule in 25983949. It is not a rollback payload for the current live
policy. A new reviewed plan must account for the actual placement and preserve
strict scanner/report failures, evidence and inherited/classic protection.
