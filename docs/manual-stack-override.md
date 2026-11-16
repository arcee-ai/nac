# Manual review override for NAC stacks

`scripts/manual-stack-override.mjs` lets Allison and Ada process a reviewed
stack from bottom to top using their personal PR bypass permissions. The helper
requires green checks and resolved conversations, even when the account can
manually bypass those requirements.
Execution requires **maintainer authorization for the exact merge set**. A
maintainer may run it directly or ask an agent to execute the reviewed plan.
Authentication and a saved plan alone do not authorize a merge or CI automation.

There is no supported atomic force-whole-stack operation. GitHub permits bypass
on the **lowest unmerged member**. Each successful member lands independently;
later members can fail. GitHub's ordinary stack merge remains appropriate when
the whole stack meets its requirements.

## Preview and review

Requires Node.js, installed `gh`, and existing authentication to github.com.
No extension install, token export, local Git checkout modification or settings
change is needed. The repository is fixed to `arcee-ai/nac`, target `dev`, and
the authenticated account must be `allisoneer` (User `20910163`) or
`adalundhe` (User `23642200`). Both have repository admin access and the same
PR-only ruleset bypass as of November 16, 2026. These settings are already live;
merging the helper update makes this command available to Ada.

Choose the exact stack number and **every open member in bottom-to-top order**.
For example, this only reads stack 571 and writes a new local private plan:

```sh
node scripts/manual-stack-override.mjs --stack 571 --members 491,487 --plan /tmp/nac-stack-571.json
```

The command prints full membership (including retained merged members), the
exact open merge set, titles, immutable head/base revisions,
draft/mergeability state, check results, validation blockers, and a digest of
each layer's authored diff. Review the complete changes at those revisions and
the saved plan before choosing execution. Existing plan files are never
overwritten. A plan is a snapshot, not permission or a claim of merge readiness.

## Explicitly authorized execution

Only after Allison or Ada authorizes that exact set and reviews the plan:

```sh
node scripts/manual-stack-override.mjs --execute /tmp/nac-stack-571.json
```

Before the first request, all head/base revisions must still match the plan.
Before every request, the helper verifies identity, saved policy, the complete
remaining stack/order, refs, authored changes, checks, and conversations. It
submits only `PUT /repos/arcee-ai/nac/pulls/LOWEST/merge-async` with
`merge_method=squash`, `merge_action=default`, the verified current `sha`, and
JSON boolean `bypass_rules=true`. Default routing preserves merge queues.

It polls the actual returned UUID for at most three minutes per member, with a
30-second bound on each HTTP command. `merged` is confirmed against the PR's
merged state and returned landed SHA before continuing. A read-only GraphQL
receipt must independently match the repository, PR number, merged state,
submitted head, `dev` base and actual landed `mergeCommit.oid`. The pinned REST
API omits legacy `merge_commit_sha`; its merged/closed/head/base facts still
corroborate the receipt. The synthetic test ref is never the landed commit.
Missing/mismatched receipts or query errors stop with the active UUID and
partial progress retained, without fallback or automatic retry.
`enqueued` means **queued, not
merged**: execution stops there. An existing-request 409 is inspected for the
same SHA/options and polled without a second request for that member. A mismatch,
failure, unknown state or timeout stops the command and prints landed members,
remaining members and any active request UUID. A timed-out request may still
finish; inspect its result and actual PR state before deciding what to do next.

After a lower member lands, GitHub may automatically retarget/rebase the others.
Their authored diffs must still match, with full changed-file blob revisions
pinned as well as patch bytes. Diff-header abbreviations and hunk line offsets
are normalized; moving identical patch text to another repeated block cannot
approve different file content. The new lowest base must be the just-confirmed
merge commit. This deliberately rejects harmless changes within affected files,
some context changes and unrelated trunk advances. No author code is
automatically fixed, rebased or marked ready.

## Instructions to give an agent

After the helper update lands on `dev`, Allison or Ada can give an agent this
instruction, substituting the actual stack and complete open-member list:

> Resolve the merge conflicts, run the relevant checks, and push the fixes.
> Authenticate `gh` as my own approved GitHub account (`adalundhe` for Ada), then
> create a fresh preview with `node scripts/manual-stack-override.mjs --stack
> STACK --members BOTTOM,TOP --plan /absolute/new-plan.json`. Inspect every
> member, diff and blocker. I authorize merging exactly PRs #BOTTOM and #TOP in
> that order using `node scripts/manual-stack-override.mjs --execute
> /absolute/new-plan.json` once all helper gates pass. Stop on drift, partial
> completion, a queued result or an uncertain request; report the result before
> any retry.

Use a current `dev` checkout containing the helper update. Never use another
person's credentials. For an ordinary PR, the GitHub PR page also offers the
same manual bypass capability to both accounts; inspect the exact current head
and any overridden requirements before clicking merge. Conflicts still need
resolution. This change does not merge any existing PR.

## Safeguards and limits

- Only the Allison and Ada PR exceptions (ruleset 26484091) are
  accepted: Users `20910163` and `23642200`, both in pull-request-only mode.
  Its review and strict `Required PR checks` requirements must match the current policy and be
  effective on `dev`. The hard PR/direct-push, deletion and force-push
  protections (25983949) retain no bypass. Inherited protections remain in the
  full policy fingerprint and check inventory. Policy drift requires a new
  preview, not an automatic relaxation.
- The account's manual CI/conversation bypass is not a quality waiver for this
  helper. Pending, failed, missing or unproven current checks and unresolved
  conversations still stop automated execution. No bypass permission grants an
  agent merge authority; explicit maintainer authorization for the exact set is
  separate from identity, capability and a saved plan.
- Every remaining member must be non-draft, conflict-free, and have known
  mergeability. Unresolved conversations and pending/failed check results stop
  execution. Required status contexts, `Required PR checks` and
  `source-security / Full locked source scan`, plus the existing mandatory
  native process/credentials job, must report success. Optional
  completed neutral/skipped checks are allowed. No CI/security waiver is offered.
- Check history stays in the plan, including original failure output and an
  explicit superseding run/attempt/job map. Only the NAC Stable workflow's
  historical GitHub Actions suites can be superseded: repository, app, workflow,
  pull-request event, PR, head and current base must match. The workflow's
  referenced test merge must be the current PR merge identity, with the exact
  head as its second parent and the head's complete tree. For an upper native-stack
  member, its prepared lower merge may supply the first parent only when its
  complete tree equals the current declared base (including modes and blobs).
  The ordinary linear authored comparison remains required; arbitrary ancestry
  or partial file comparisons never establish this equivalence.
  The newest run and its latest job executions are selected regardless of their
  result; queued, running, failed or cancelled work cannot fall back to older
  green checks. Partial reruns require exact old/new job-attempt proof.
- Other apps and workflows retain their check-record veto; their latest
  applicable workflow run must also finish acceptably. Names alone never
  establish supersession. Missing/ambiguous provenance, a changing run inventory
  or a changed PR head/base/current-merge stops validation. Positively associated
  `pull_request_target` runs, including CLA, are checked even before a check row
  exists; unfamiliar associated events remain a HOLD. Required integration IDs remain
  effective, and matching commit statuses and checks must both pass. These
  bounded rules may conservatively hold an unfamiliar workflow for inspection.
- Full immutable comparisons must contain 1–299 files. Binary changes, quoted
  paths, incomplete diffs, non-linear ancestry and unexpected stack lifecycle
  changes stop for separate human handling. There is no resume/recovery engine.
- Client reads cannot atomically lock policy, membership, checks or permissions.
  GitHub remains authoritative and can reject an accepted asynchronous request.
  This helper uses no private API or legacy GraphQL merge fallback.
- On partial completion, there is no automatic rollback. Inspect current stack
  membership, actual merged PRs and any outstanding UUID; create a new plan only
  for the exact remaining open members after human review. Removing this script
  and runbook removes the utility but does not revoke either live GitHub grant.
  Revoking access or reverting a landed PR is a separate explicit action.

Tests use deterministic fake transport/`gh`, with no real mutation:

```sh
make test-manual-stack-override
```

Supported API: [async merge and result endpoints](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request-asynchronously).
Scope: [GitHub's lowest-member bypass announcement](https://github.blog/changelog/2026-10-06-stacked-pull-requests-generally-available/).
Protocol: [stack API requirements](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests-apis-and-webhooks).
