# Protected post-build image approval intake (unactivated prototype)

`scripts/security/image_approval_intake.py` defines the control-plane identity
contract for an exact managed image. It does not approve any production finding,
run a scan, configure a branch or App, or publish a status by itself. Its test
fixture contains only invented identities and policy bytes. The current PR
workflow still supplies the empty source policy and blocks unresolved findings.

## Frozen candidate and approval record

The proposed unprivileged build job must finish before review and retain an
immutable OCI candidate plus the complete V4 inventory bundle in an Actions
artifact named
`managed-image-candidate-<synthetic-merge-sha>-<run-id>-<attempt>`. It must
record its image ID and `GITHUB_SHA` in the bundle. The present `build-smoke` job
combines build and strict scan, and its artifact lacks the frozen OCI image;
that job does **not** satisfy this contract. A targeted rerun of it rebuilds.

A human-reviewed record would be merged to a dedicated
`security-image-approvals` branch, separate from the candidate source. Each
schema-1 record names the repository, PR number, current head/base and
synthetic merge SHAs, exact image ID, original workflow run/attempt/build job,
artifact ID/name/digest, reviewed policy byte digest, approval and expiry times,
and `active` or `revoked` state. The policy and digest-named evidence must be
retrieved from the same protected branch revision. A reviewer must examine the
actual finding evidence and explicitly approve each named disposition; a code
review approval or this record's presence is not a technical qualification.
The branch needs PR-only updates, non-author CODEOWNER review, last-push approval,
stale-review dismissal, and no bypass. These settings and records do not exist.

## Trusted replay and status

The future publisher must run **only protected branch code**. A read-only job
fetches the current approval branch ref and record at that exact SHA, and then
independently fetches the current PR, `refs/pull/N/merge`, Actions run, build
job, artifact metadata and downloaded archive from GitHub. Candidate-supplied
metadata JSON is never an authority. The validator requires the same live
head/base/merge identity, source workflow/run/attempt, successful build job,
artifact ID/digest and upload time inside that job attempt. The GitHub artifact
API's `workflow_run.head_sha` is the PR **head**, not the synthetic merge SHA;
the retained bundle's `source_revision` and current merge ref must both equal
the record's synthetic merge SHA. An artifact archive digest must be checked
while streaming the downloaded bytes. Safe extraction must reject path escape,
links and oversized members before the existing bundle validator runs.

The read-only job then invokes `image_scan.py --bundle` against that retained
bundle and the same image/source identity, passing protected-branch policy and
evidence bytes through `--reviewed-image-approval`,
`--reviewed-image-approval-sha256` and `--reviewed-image-evidence`. It uses a
fresh scanner database. A positive result requires `status=passed`, zero
blocking rows, `applicability=verified`, an exact image match and the retained
decision digest; the raw findings and source-policy result remain unchanged.
Before publication it fetches the branch pointer and live PR/merge identity
again. Any change fails closed and needs a new replay. Original V4 observations
older than 24 hours cannot be refreshed by relabeling a bundle. The exact OCI
image may be loaded and independently recollected without rebuilding; changed
evidence requires a new human-reviewed policy commitment.

Only a separate credentialed job may create `Managed image approval` on the
exact synthetic merge SHA, using a **dedicated GitHub App** installation token.
The ruleset must require this context from that App ID; an Actions-sourced
status is insufficient because a same-repository candidate workflow can request
`statuses: write` and create a status with the same context. The status publisher
checks the returned App bot identity and treats API failure or ambiguous response
as failure. A protected revocation commit posts a later `failure` status to the
same context and SHA. Publishing success must be followed by a live status
readback from the pinned App and an actual ruleset fixture before activation.

## Activation and limits

Source code cannot grant these authorities. Activation requires the protected
branch/ruleset, a dedicated installed App with narrowly scoped status write,
an App token available only to protected jobs, an artifact-producing build job,
trusted safe download/extraction and strict replay workflow, and a fixture PR
showing positive status attribution plus wrong-run/attempt/head/digest, expired
and revoked negatives. No live approval branch, credential, App source rule or
merge-time fixture has been configured here.

GitHub status publication is append-only. If a revocation workflow fails after
an earlier success, the old green status may remain until GitHub's required
status freshness window ends. An approval also expires in the verifier while
the GitHub status can remain green. Production activation therefore needs a
merge-time readback or equivalent App enforcement of the current protected
branch pointer, approval expiry and current PR merge identity; a periodic
workflow alone leaves a stale-green window. A branch push or PR merge-ref
regeneration also requires a fresh exact-image packet. In the observed #440
run, retained source `953720c...` already differs from the current merge ref
`1b3e8d3...`; that old packet cannot be approved for the live merge SHA.

The prototype's synthetic tests exercise nonempty success and mutations of
record state, policy bytes, PR head/base/merge, run attempt, artifact digest and
upload window, protected branch pointer, strict replay and status publication.
They are not a GitHub integration or real vulnerability regression test.
