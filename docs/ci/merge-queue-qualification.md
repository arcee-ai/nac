# Merge queue qualification: defer (ALL-460)

**Decision: NO-GO for activation.** Keep queues disabled. This investigation is
complete with a defer recommendation; hosted queue/stack compatibility and
Allison's individual override remain unqualified. This is not an activation
plan or a claim that the foundation enforcement rollout is complete.

Observed October 22, 2026, 22:31 PDT (`2026-10-23T05:31:11.617Z`), against merged
`dev` **9386c906ed20ff1f751c47a875a792ae2b4fb6cd**. The investigation owns no
runtime or workflow changes. [ALL-460](https://linear.app/arcee/issue/ALL-460)
and [ALL-449](https://linear.app/arcee/issue/ALL-449), including all comments at
capture, define the scope. The [retained evidence](evidence/2026-10-22-merge-queue.json)
contains the actual rules snapshot, installed command help, repository settings
and CI timing inputs. Settings and tool behavior must be refreshed before a
future rollout.

## Installed capabilities and observed settings

| Item | Observation |
| --- | --- |
| Host Git | 2.50.1 (Apple Git-155) |
| Host gh | 2.100.0 (2026-09-03) |
| Installed extension | github/gh-stack v0.1.1; `gh stack --version` reports 0.1.1 |
| Matching upstream tag | v0.1.1 resolves to `2bd699a544a09cb5c45a013d03416e0894b0454e` |
| NAC | Public organization repository; default branch `dev` |
| Merge methods | Merge, squash and rebase enabled |
| Auto-merge / automatic branch deletion | Both false |
| Classic dev protection | Absent (documented optional 404 in snapshot tool) |
| Repository required-check/review/queue ruleset | Absent |
| Effective inherited rules | Enterprise 2955537: deletion/non-fast-forward restrictions; 2955527: repository-transfer restriction; both report current-user bypass `never` |
| CODEOWNERS | `* @allisoneer @Cecocho @ericlau98` |
| Verified access | allisoneer admin (20910163), Cecocho write (105443339), ericlau98 write (17348362) |
| Hosted merge-group runs | Stable-release API query returned `total_count: 0` |

The existing [foundation proposal and rollout](required-pr-checks.md) requires
one eligible non-author code-owner approval, dismissal of stale approvals,
resolved conversations, strict current-base **Required PR checks** from Actions
App 15368, and only Allison's User 20910163 PR-only bypass. These are proposed
platform protections, not observed applied protections. Neither CODEOWNERS nor
green CI alone proves merge enforcement. Inherited enterprise protections remain
effective. The independent secret push-protection bypass is not PR merge authority.

Installed `gh stack merge --help` advertises direct all-or-nothing stack merges,
queue submission when the base requires a queue, and **no stack bypass**. These
are tool claims; no live direct-stack atomicity was qualified here. The
[matching upstream command reference](https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/skills/gh-stack/references/commands.md#merge)
explicitly says queue submissions can land in separate groups. Therefore no
atomic queued-stack guarantee is offered. Method flags are overridden by the
queue's selected method. Numeric merge arguments prefer a stack number over a
PR number, so a future authorized operation must verify the entire target set.

## Concrete event-plumbing blockers

GitHub requires a separate `merge_group` Actions trigger for queue checks. Its
`GITHUB_SHA` and ref identify the merge group, not the individual PR.
[Official event contract](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group).
At the inspected NAC revision:

1. `.github/workflows/stable-release.yml` has push, pull_request and manual
   triggers only. A queue would not receive **Required PR checks**.
2. Its `Capture CI source identity` condition excludes merge_group. Adding only
   the trigger would still leave the prepared candidate/run outputs missing.
3. `.github/scripts/publication-policy.mjs::selectPolicyInputs` explicitly
   rejects merge_group. A local synthetic event reproduced
   `ordinary policy requires a PR base, canonical dev, or protected branch push`.
   This is local characterization, not a hosted queue test.
4. Applicability currently computes the full PR-base diff only for pull_request;
   other events conservatively select managed work. A future implementation
   must deliberately preserve complete group coverage and the exact same-run
   aggregate, rather than borrow a constituent PR's green result.

Future queue support must bind one immutable group candidate and a separately
validated trusted base policy throughout source scanning, managed image evidence,
native macOS, both builds and all seven crates' existing checks. A queued change
must never authorize its own policy. Preserve API/assets/browser/durability and
process coverage. Source vulnerability enforcement stays required; image findings
stay advisory under the accepted current policy while scanner, inventory,
database and evidence failures still fail. Queue candidates must not become
trusted dev-push image-rescan producers or publication events.

## Scenario inventory and qualification gaps

No separately approved queue fixture repository or ordinary App/reviewer actor
sessions were provided. Prior ALL-459 authorization concerned secret scanning;
it does not authorize new queue fixtures or merges. No bypass merge has human
authorization in this investigation. Consequently **all hosted cases below are
unperformed**, not passes or simulated-live results. Foundation's own hosted
ordinary/reviewer/override qualification remains a prerequisite.

| Required scenario | Evidence available / remaining hosted observation |
| --- | --- |
| Two/three layers | Required intended shape is `dev <- A <- B [<- C]`, each PR against its immediate predecessor. No new fixture PRs were opened; stack queue admission, actual bases and landed order remain unobserved. |
| Generated API/assets conflicts | No conflict was injected. In a fixture, change an owned generated input in lower/upper layers, regenerate using sole writers, observe conflict, resolve at owning layer and validate regenerated outputs after restack. |
| Lower landing, restack | Installed sync/rebase help describes cascading restack; no queue landing/restack was exercised. Verify upper-layer diffs exclude landed commits after each squash/rebase/merge method used. |
| Deletion/auto-retarget | Production auto-delete is false. Fixture must separately observe retained/deleted lower branches, actual GitHub base retarget, resulting CODEOWNERS and fresh merge-candidate checks. |
| merge_group checks | No workflow support and zero recorded stable-release merge-group runs. Require the correct Actions App/context on the exact group SHA and complete applicable coverage. |
| Failed/stale/pending checks, ejection | Local aggregate controls reject bad/missing/stale results. No hosted rejection/ejection was tested; retain failed/current/previous group SHAs, timeout/removal reason and recreated downstream group evidence. |
| Partial landing | Upstream explicitly permits separate queue groups; no live partial landing occurred here. Verify landed prefix, unmerged suffix and branch/base/review recovery without undoing already-landed work. |
| Per-layer approvals | No separate reviewer actors were exercised. Demonstrate each eligible non-author, reject author/outside-only approvals, invalidate stale approval and enforce conversations on every included layer. A dev-only rule does not cover arbitrary intermediate bases. |
| Stack bypass | Installed help exposes no bypass flag and says unsupported. No bypass attempted; do not offer red-stack merging. |
| Allison individual escape | Installed `gh pr merge` exposes admin/head-match options. Actual own-PR failed/pending override, audited PR-only bypass, ordinary-App denial and inherited restriction preservation remain unperformed. |

GitHub documents removal for failing group checks or conflicts, and downstream
group reconstruction after removal. Timeout and manual removal are also possible.
These are documented expectations for the fixture, not NAC observations.
[Queue management](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue),
[queue operations](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request-with-a-merge-queue).

## Recovery and Allison's individual route

Before a future authorized landing, save exact PR URLs, head/base SHAs, ancestry,
stack membership, checks and review state. Keep each affected worktree owner idle
while changing history. Inspect installed help rather than treating sync as a
status read: it fetches, rebases, pushes and updates PR/stack state. Check its
actual result and live state even after exit zero. Do not prune during recovery.

- For a conflict, use `gh stack rebase`, resolve/stage the owning files, then
  `gh stack rebase --continue`, or `--abort` to restore the operation. A conflicted
  sync is documented to restore branch state; verify tips before proceeding.
- After partial landing or branch deletion, identify the landed prefix and
  remaining commit ranges first. Restack the unmerged suffix, verify every
  immediate base and diff, regenerate only through the existing writers, and
  refresh affected checks/reviews before resubmission. Do not assume retargeting
  or queue removal updates local state.
- On ejection/stale checks, preserve the failed group and reason. Repair the
  owning layer, refresh downstream bases and candidate evidence, and requeue
  only under new explicit landing authority. Do not rerun an obsolete group's
  checks as proof of a replacement group.

Allison's route stays **one PR/current head at a time, bottom first**. The human
must explicitly authorize that exact merge and reason, inspect conflicts and
outstanding checks/reviews, then use the individual PR UI's bypass acknowledgment
or a fixture-qualified individual CLI route with `--admin` and
`--match-head-commit`. Retain the actual audited result and refresh every
remaining layer. Never disable a whole ruleset, add broad bypass actors, or
interpret authenticated Allison credentials as agent permission. Inherited rules
can still reject the operation; actual merge conflicts require resolution.

The [official CLI manual](https://cli.github.com/manual/gh_pr_merge) and installed
help say ordinary `gh pr merge` can enable auto-merge when queue requirements are
not yet met. It is therefore not a harmless readiness probe. No merge, queue
submission, auto-merge or override command was executed here. Individual bypass
is a future separately authorized and qualified human operation, not a tested
escape procedure or a way to clear publication security scans.

## Cost and latency comparison

Read-only API timestamps from three successful recent PR runs provide a bounded
sample, not a steady-state workload forecast. Runs overlap, demonstrating actual
concurrent PR CI; sustained arrival rate and hosted queue latency are unknown.
These runs predate the inspected merged dev and do not certify its checks.

| Successful run | PR head | Creation to Required PR checks completion | Sum of non-skipped job durations |
| --- | --- | --- | --- |
| [39895390955](https://github.com/arcee-ai/nac/actions/runs/39895390955) | d7f7e493aaaa4a9310f0753467b7420528247250 | 36m14s | 82m07s |
| [39895553128](https://github.com/arcee-ai/nac/actions/runs/39895553128) | 78411f063cb67021cae73e76355f3fcf6550ca43 | 39m03s | 96m12s |
| [39898328402](https://github.com/arcee-ai/nac/actions/runs/39898328402) | 87018d2d676e6bffed88bc4d4b91f520d0ab71a0 | 41m49s | 91m39s |

The job sum is elapsed occupied job time across parallel Linux/macOS jobs, not
billed minutes, runner pricing or a dollar estimate. Wall time includes scheduling
and dependencies. Median observed wall time is **39m03s**; median job sum is
**91m39s**. No production queue was enabled to obtain a comparison.

For an illustrative three-*independent*-PR burst, assume unchanged timings,
all three initially validated against one base, no failures, and equal coverage:

- Strict current-base without queue: initially three runs; refresh the next two
  only when ready to land gives five total. Refreshing every remaining PR after
  each landing gives six. Serial landing after the initial parallel wave takes
  roughly three 39-minute waves, excluding human review and branch-update time.
- Queue with one speculative validation per PR: three initial PR runs plus three
  group runs gives six total. With sufficient group/runner concurrency, two
  39-minute waves are an optimistic model; with one group slot, approximately
  four waves. Ejection/reconstruction adds work. This is not a stacked-PR forecast.

At the sample median, five versus six full runs is approximately 458 versus
550 occupied job-minutes. A quiet single PR can pay an extra full group run;
busy independent traffic may save author updates/waiting. Queue merge limits
do not combine builds; build concurrency controls speculative dispatch.
[Documented configuration](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue).
No queue savings, pricing or stack throughput is measured. At NAC's observed
small concurrent wave, this evidence does not justify activation before correctness
and override qualification. Strict-current-base is the foundation's proposed
alternative, also awaiting its separate platform rollout.

## Bounded follow-up before reconsidering enablement

1. Complete foundation fixture qualification and capture actual applied ordinary
   check/reviewer/Allison-only override settings; do not silently activate them
   through this report.
2. Obtain a specifically approved disposable queue repository, Actions capability,
   ordinary non-bypass App and required reviewer sessions. Obtain human approval
   for each own-PR failed/pending override merge at its exact head.
3. In a separate reviewed implementation, add merge-group candidate/event/policy
   plumbing with fail-closed group/base identity tests and unchanged coverage.
   Preserve dev-push rescan and release-publication trust boundaries.
4. Exercise every hosted scenario above, retaining actors, exact group/head/base
   identities, settings, check/review URLs, attempted actions, audit results and
   recovery receipts. Compare strict-current-base and queue runs at matched
   concurrency with no blanket retries or disabled rules.
5. Only after evidence supports enablement, propose concrete queue method,
   build concurrency, check timeout and group settings, with separate explicit
   production activation approval. Start conservatively; preserve per-PR
   successful checks rather than accept a red constituent solely on group success.

No queue values are selected/applied here. No tool upgrade, live fixture mutation,
merge, deployment, ALL-461 publisher adoption or image-enforcement change is part
of this result. `make setup` passed. Focused existing aggregate/ruleset/dependency/
publication tests passed **29**, with **one optional real-scanner test skipped**
because no pinned OSV_SCANNER was supplied; that skip is not scanner acceptance.
The local synthetic event rejected the unsupported event as described above.
Current documentation-PR CI and bounded review evidence belong in its live PR;
this report does not predeclare them successful.
