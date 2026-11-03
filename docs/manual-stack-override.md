# Manual review override for NAC stacks

`scripts/manual-stack-override.mjs` lets Allison explicitly process a reviewed
stack from bottom to top using her existing review-only bypass permission.
This is a **human-invoked maintenance command**, never an agent tool or CI job.
An agent authenticated as Allison is not authorized to execute it merely because
the identity check passes. Preparing this utility does not authorize any merge.

There is no supported atomic force-whole-stack operation. GitHub permits bypass
on the **lowest unmerged member**. Each successful member lands independently;
later members can fail. GitHub's ordinary stack merge remains appropriate when
the whole stack meets its requirements.

## Preview and review

Requires Node.js, installed `gh`, and existing authentication to github.com.
No extension install, token export, local Git checkout modification or settings
change is needed. The repository is fixed to `arcee-ai/nac`, target `dev`, and
the authenticated user must be `allisoneer`, numeric User ID `20910163`.

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

## Explicit human execution

Only after a human decides to merge that exact set and reviews the plan:

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
merged state and commit SHA before continuing. `enqueued` means **queued, not
merged**: execution stops there. An existing-request 409 is inspected for the
same SHA/options and polled without a second request for that member. A mismatch,
failure, unknown state or timeout stops the command and prints landed members,
remaining members and any active request UUID. A timed-out request may still
finish; inspect its result and actual PR state before deciding what to do next.

After a lower member lands, GitHub may automatically retarget/rebase the others.
Their authored diffs must still match, byte for byte except blob IDs and hunk
line offsets, and the new lowest base must be the just-confirmed merge commit.
This deliberately rejects some harmless context changes and unrelated trunk
advances. No author code is automatically fixed, rebased or marked ready.

## Safeguards and limits

- Only the existing singleton review exception (ruleset 26484091) is accepted.
  Universal protections (25983949), including conversation resolution, retain
  no bypass. Policy drift requires a new preview, not an automatic relaxation.
- Every remaining member must be non-draft, conflict-free, and have known
  mergeability. Unresolved conversations and pending/failed check results stop
  execution. Required status contexts, `Required PR checks` and
  `source-security / Full locked source scan` must report success. Optional
  completed neutral/skipped checks are allowed. No CI/security waiver is offered.
- Full immutable comparisons must contain 1–299 files. Binary changes, quoted
  paths, incomplete diffs, non-linear ancestry and unexpected stack lifecycle
  changes stop for separate human handling. There is no resume/recovery engine.
- Client reads cannot atomically lock policy, membership, checks or permissions.
  GitHub remains authoritative and can reject an accepted asynchronous request.
  This helper uses no private API or legacy GraphQL merge fallback.
- On partial completion, there is no automatic rollback. Inspect current stack
  membership, actual merged PRs and any outstanding UUID; create a new plan only
  for the exact remaining open members after human review. Removing this script
  and runbook removes the utility; no GitHub policy was changed by installing it.
  Reverting a landed PR is a separate reviewed action.

Tests use deterministic fake transport/`gh`, with no real mutation:

```sh
make test-manual-stack-override
```

Supported API: [async merge and result endpoints](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request-asynchronously).
Scope: [GitHub's lowest-member bypass announcement](https://github.blog/changelog/2026-10-06-stacked-pull-requests-generally-available/).
Protocol: [stack API requirements](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests-apis-and-webhooks).
