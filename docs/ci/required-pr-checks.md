# Required PR checks and review rollout

ALL-450 provides the foundation for `dev <- ALL-450 <- ALL-451 <- ALL-452`.
This change prepares enforcement; it does **not** activate a repository ruleset.
Source and exact-image vulnerability gates are separate downstream changes.

## Same-run coverage contract

`stable-release.yml` emits **Required PR checks** on every PR open, synchronize,
reopen, ready-for-review and base edit, without branch or path filters. It also
runs on the existing main/dev pushes, stable tags and manual dispatches. Each
run checks out its immutable `github.sha`: on PRs this is GitHub's test merge
commit, bound to that head and base. Strict up-to-date enforcement requires a
new candidate after the base advances; a prior head's green check is insufficient.

| Job | Every PR | Coverage |
| --- | --- | --- |
| prepare | yes | Exact source identity and complete merge diff applicability |
| workflow-lint | yes | Pinned actionlint/ShellCheck over every tracked workflow and shell script, plus real-tool enforcement fixtures |
| lint | yes | Workspace production clippy, web lint, Rust/web formatting |
| test-server | yes | Server and stable binary, web tests, generated OpenAPI/types, all committed browser/client assets, production Chromium journeys |
| test-core | yes | Core/catalog tests, release policy, installer, PR gate/rollout model tests |
| test-workspace | yes | Contracts, credentials, managed and process crate tests; source command/binary/size, durability, managed load and static image contracts |
| macos-native | yes | Native ARM macOS process/credential suites and 12 exact core terminal regressions; measured first/warm runs and Darwin behavioral failure control ([coverage](native-macos.md)) |
| test | yes | Compatibility result covering all test lanes and lint |
| build | yes | Existing Linux musl and macOS ARM release binary/archive validation |
| managed | explicit | Reusable contract, pinned quality/fault-fixture, exact Linux image build and credential-independent smoke |
| required-pr-checks | always | Explicit result set and candidate binding; no cross-workflow lookup races |

Managed work applies when any changed path is under `.github/`, `crates/`,
`docker/managed/` or `scripts/`, or is Cargo.toml, Cargo.lock, Makefile,
.dockerignore or version.txt. NUL-delimited Git output preserves unusual names
and renames/deletions. Non-PR runs conservatively enable managed work. The
stable-release workflow is the sole main/dev push producer; managed-image has
only reusable-call and manual
triggers. Each managed call has a unique run/attempt concurrency identity, so
three overlapping updates cannot replace a pending call. Downstream trusted
image rescans must select successful **stable-release.yml dev-push** artifacts,
never PR, manual-dispatch or standalone managed workflow artifacts.

| Change example | Core/web/release/build | Managed | Required result |
| --- | --- | --- | --- |
| Rust-only | run | run | emitted |
| Web-only | run | run | emitted |
| Workflow-only | run | run | emitted |
| Docs-only | run | skip | emitted |
| Managed image/runtime/smoke | run | run | emitted |

The preparation output `managed_applicable` must be exactly `true` or `false`.
Only a known non-applicable managed call may be `skipped`. Every expected job
must be `success`; failure, cancellation, neutral, pending, missing and unexpected
skip all fail. The reusable managed workflow independently requires all its inner
jobs, preventing an accidentally skipped build/smoke from turning the call green.
Cancellation of the aggregate itself blocks merging. Platform failure to start a
workflow cannot emit a job; the missing required context still blocks merging.

Workflow/shell lint inventory, tool verification, dialects and seeded failure evidence
are documented in [workflow-shell-lint.md](workflow-shell-lint.md).

Extension contract: a source-security reusable call must become a direct
`required-pr-checks.needs` dependency and an entry in `pr-checks.mjs`'s
`requiredJobs`, atomically with its tests. Image security extends the immutable
managed build/smoke graph and managed terminal dependency/result validation.
Do not rely on a separate workflow finishing first. Do not activate downstream
security enforcement before its fresh baseline is remediated or governed by
approved narrow exceptions. ALL-447 remains Eric's separate remediation work.

## Reviewer policy and stack limits

The entire CODEOWNERS file is `* @allisoneer @Cecocho @ericlau98` on one line.
Their live access was verified on October 21, 2026: admin/write/write and user
IDs 20910163/105443339/17348362. GitHub uses CODEOWNERS from **each PR's base**;
the old owners remain effective on the foundation PR until it lands. The
metadata-only `pull_request_target` workflow requests the verified eligible set
on open/reopen/ready, excludes the author, and does not execute candidate code.
Bot authors receive the same owner requests. GitHub's native code-owner requests
apply after the CODEOWNERS change reaches the relevant base.

One eligible non-author approval is sufficient; author and outside-only approvals
are insufficient. Changes dismiss stale approvals, and conversations must be
resolved. Human approvals are never fabricated by tooling or local tests.
The new ruleset targets `dev` only. Upper stack PRs targeting a feature branch
do not inherit that dev ruleset merely because their eventual destination is dev.
Qualify their base's CODEOWNERS and check each layer before landing; do not claim
the ruleset protects arbitrary intermediate branches. Once a layer is retargeted
to dev, refresh its exact head/base checks and review state.

## Settings proposal and safeguards

`evidence/2026-10-21-before.json` captures live settings. The inherited enterprise
default-branch ruleset 2955537 blocks deletion and non-fast-forward changes,
and enterprise ruleset 2955527 restricts repository transfer. Both report
`current_user_can_bypass: never`. There was no classic dev protection (404) and
no repository-level required-check ruleset. The proposal is **additional** and
preserves the CLA/release workflows, merge methods, and all inherited settings.
The proposed after-state is in `evidence/2026-10-21-proposed.json`; it is not an
observed applied after-state.

The payload requires PRs, one approval, code-owner review, dismissal of stale
reviews, conversation resolution, and strict current-base checks. The exact
context is bound to observed GitHub Actions integration ID **15368**. Its only
added bypass actor is User **20910163**, mode **pull_request**. There are no role,
team, bot, `always` or `exempt` bypasses. It does not grant direct-push authority
or override inherited rules. A merge conflict still needs resolution.

Reproduce the read-only dry run from the repository root:

```sh
node .github/scripts/pr-ruleset.mjs snapshot arcee-ai/nac /tmp/nac-before.json
node .github/scripts/pr-ruleset.mjs plan /tmp/nac-before.json
node --test .github/scripts/pr-*.test.mjs
```

All commands in this tool are read-only against GitHub. Snapshot files are
create-only. `plan` emits the exact active payload for review without applying
it. Existing settings are captured with pagination, including inherited rules,
classic protection and owner identities. Failures other than a documented
classic-protection/CODEOWNERS 404 stop capture. No credential is saved.

## Safe fixture qualification and activation handoff

Use a separately approved disposable repository with Actions and rulesets support,
an Allison account, ordinary non-bypass maintainer/App identities, the three
eligible reviewers and an outside reviewer. That repository/access was **not
provided or created** during this implementation. Platform evidence is pending.
Do not test red merges, bypass, or direct pushes against production NAC.

Copy the candidate workflows, policy scripts and CODEOWNERS into the fixture;
create its dev base, apply the reviewed ruleset there, and preserve before/after
settings. Adapt only the target repository, with the same policy payload. Use
fixture-only commits to introduce deliberate failures; never add failure knobs
to production workflows. Record the exact head, base, actor, check URLs, review
state, attempted operation and observed API/UI result for each case in
`evidence/qualification-template.json`. A `passed` entry means the expected
outcome below was observed, not necessarily that a test check was green.

| Fixture group | Required observation |
| --- | --- |
| Rust, web, workflow, docs, managed positive PRs | All applicable work and stable aggregate finish; no stuck required context |
| API and committed asset drift | Real drift check fails and ordinary merge is blocked |
| Browser/image failure | Real failing journey/smoke fails aggregate and ordinary merge is blocked |
| Failed, pending, cancelled, missing, stale, unexpected skip | Each expected-work condition blocks ordinary merge; stale green cannot satisfy new head/base |
| Each eligible non-author | Each can independently satisfy the one-approval rule |
| Author/outside reviewer | Self or outside-only approval cannot satisfy ownership |
| Open, ready, bot authors | Exact eligible non-author default requests are visible |
| New commit/unresolved conversation | Required approval becomes stale; unresolved thread blocks |
| Two-layer stack | Each base CODEOWNERS drives requests; explicitly demonstrate intermediate-base limitation and retarget-to-dev checks |
| Allison's own failed and pending PRs | With separate explicit human authorization for each fixture merge, the audited PR-only route works |
| Ordinary user/App override | Same route cannot bypass; routine automation has no bypass actor |
| Direct push/inherited restrictions | PR-only bypass cannot push directly or defeat inherited deletion/force-push restrictions |

For blocked merge tests use each actor's own authentication and preserve the
rejection. A bypass-eligible Allison token is not an ordinary-actor test. Pending
checks must actually be pending at attempted merge time; record both timestamps.
For successful override capture resulting merge SHA and audit/ruleset evidence,
including Allison's authorship and the failed/pending current-head result.

After fixture qualification, merge the implementation through ordinary review.
Wait for the new context to succeed on the actual current dev revision. Refresh
settings and generate a guarded activation handoff:

```sh
node .github/scripts/pr-ruleset.mjs activation-plan /tmp/nac-before.json /tmp/fixture-qualified.json > /tmp/nac-activation-plan.json
```

This refuses missing/expired fixture evidence, changed policy payload, stale or
drifted settings, absent landed CODEOWNERS, and missing/wrong-App/wrong-revision
or non-success current-dev context. It checks receipt structure; a human must
inspect the linked evidence and identities. JSON claims alone do not prove GitHub
enforcement. No settings mutation is implemented in the tool. After separate
human authorization, an administrator may extract `proposed_ruleset` and create
the additional repository ruleset with the GitHub ruleset UI or REST API. Capture
an observed after snapshot, compare every inherited/classic protection and bypass
actor, and repeat representative ordinary/override qualification. Do not update
or delete existing rulesets to fit this payload. Rebaseline on any settings drift.

## Ordinary merge and deliberate override

For ordinary merges inspect `gh pr view <PR> --json headRefOid,baseRefOid,reviewDecision,mergeStateStatus`,
`gh pr checks <PR>`, and current review conversations. Fetch the base and verify
the candidate has no conflicts. Use `gh pr merge <PR> --squash --match-head-commit <exact-head-SHA>`
with a non-bypass automation App identity. Keep human review and current-base
requirements effective. With Allison's credentials, pause for human handling if
the normal route would require or silently exercise bypass.

For a deliberate override, Allison must explicitly authorize **that PR and
current head** and record why. After matching the head again and inspecting its
base/conflicts and outstanding checks/reviews, use GitHub's individual-PR merge
UI with the explicit bypass acknowledgment, or the fixture-qualified individual
route `gh pr merge <PR> --squash --admin --match-head-commit <exact-head-SHA>`.
This is documentation of a future human operation, not authorization for an
agent to run it. Preserve GitHub's audited bypass event; do not disable rules or
switch to `exempt`. Reconfirm after any new commit. Inherited rules can still
block the merge.

gh-stack **v0.1.1 has no stack bypass**. An explicitly authorized override must
handle one PR at a time, bottom first, refresh remaining bases/heads/reviews/checks
and resolve actual conflicts. Do not promise atomic red-stack merging. GitHub
cannot distinguish Allison from an agent holding her credentials. Agent policy
requires explicit human per-merge intent; routine automation should use an App
not present in the bypass list.

The [ALL-460 queue qualification report](merge-queue-qualification.md) records
the installed tooling, current settings, unperformed fixture cases, recovery and
measured CI cost. Its recommendation is to defer queues; it activates no rules.

References: [CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners),
[user bypass](https://github.blog/changelog/2026-05-07-repository-rulesets-user-bypass-and-branch-renaming/),
[ruleset rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).
