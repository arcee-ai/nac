# Protected post-build image approval intake (unactivated prototype)

`scripts/security/image_approval_intake.py` defines the control-plane identity
contract for an exact managed image. It does not approve any production finding,
run a scan, configure a branch or App, or publish a status by itself. Its test
fixture contains only invented identities and policy bytes. The current PR
workflow still supplies the empty source policy and blocks unresolved findings.

## Frozen candidate and approval record

The unprivileged `build-candidate` job builds, smoke-tests, inventories and
saves the same image before uploading a complete V4 bundle and OCI-compatible
saved image as `managed-image-candidate-<source-sha>-<run-id>-<attempt>`.
The upload contains exactly `image.tar`, `inventory/bundle.json`, and the
inventory files hashed by that bundle. Unhashed Syft/probe output and tool
diagnostics are retained in a separate nonauthoritative artifact. The first
hosted candidate artifact included six such extra files and failed the strict
reader's member-set check; it is historical custody and cannot be approved.
The separate `strict-scan` job downloads that artifact, loads its exact image
ID and reports a fresh strict scan. A blocked finding remains in the deferred
security report. Inventory, upload, download, load, tool and database failures
keep the terminal managed check red. A strict-scan-only rerun cannot substitute
an artifact from an older attempt; the producer must run in the new attempt.

`scripts/security/image_candidate_archive.py` is a bounded, source-only reader
for that future artifact. The artifact must be one ZIP containing exactly
`image.tar` (a single-image Docker save archive compatible with OCI) and flat
`inventory/` files, including `bundle.json` and `identity.json`. Its caller
must first authenticate the artifact ID, run, attempt and ZIP SHA-256 using
the protected approval record and GitHub API. The reader checks that digest,
rejects traversal, links, duplicates and oversized members, binds the V4
inventory to the reviewed image/source, and verifies the saved image config
digest or traverses the approved OCI index to exactly one `linux/amd64`
manifest whose config digest and size match the saved Docker manifest before
`docker load`. Unknown extra platforms and unverifiable descriptor chains fail
closed. It checks the loaded image ID and
`linux/amd64` platform afterwards. This intake belongs in a credential-free,
isolated job; its output is still untrusted until `image_scan.py --bundle`
validates every retained file hash and performs a fresh strict rescan. The
synthetic tests also exercise wrong ZIP digest, source/image, archive config,
path, link, member set and Docker identity/platform negatives. A test builds
and saves a real `linux/amd64` Docker image when a daemon is available.
Candidate retention is custody, **not** a live approval path.

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

`image_approval_readback.py` is an inactive source-only reader for a proposed
branch layout: `images/<PR>/<merge SHA>/<image hex>/record.json`, `policy.json`,
and `evidence/<SHA-256>` files. It compares the fixed repository ID, branch and
current ref, requires the branch's protection bit, pins the commit's complete
Git tree, rejects symlinks and other nonregular modes, and fetches selected
files by Git blob ID. It checks the Git blob hashes, policy digest, exact
image/source binding, and the complete digest-named evidence closure. A second
current-ref check rejects movement during the read; a later readback compares
the current revision and every byte before a future write. It does not fetch
the candidate artifact, recollect stale V4 observations, run a scan, or publish
a status. The branch does not exist yet. GitHub's `protected` bit alone does
not establish the required reviewer identity, PR-only updates, last-push
approval, no-bypass rules, or App authority; those require separate live
configuration and qualification.

`image_approval_replay.py` is the next inactive source-only caller. Given an
archive already downloaded by approved artifact ID, it reads the current
protected-branch bytes, independently fetches the live PR/merge/run/job/artifact
objects, checks the downloaded ZIP digest and provenance, extracts the bounded
candidate, and loads its exact saved image. It stages the same reviewed policy
and evidence bytes outside the candidate bundle, invokes `image_scan.py
--bundle` with a fresh database update, and validates the raw finding,
source-policy, applicability, decision and result receipts before checking the
current branch and PR/merge identities again. It returns only an in-memory
status proposal; no workflow invokes it and it never publishes a status. The
caller still must authenticate source-policy paths and download the artifact by
the approved ID in an isolated read-only job without a status-writing token.
Those job and App controls
are not present.

The preceding replay layer fails closed when the frozen V4 observation clock
is older than 24 hours or in the future. It never relabels timestamps, reuses
a prior disposition, or treats the original blocked scan as an approval.

The next source-only derivative path, `image_approval_refresh.py`, verifies
every byte and passive observation in the original V4 bundle before loading
the exact saved image. When the original clock is stale, it keeps that frozen
bundle untouched and builds a separately hashed derivative: the base
SBOM/runtime/coverage/Rust bytes stay identical, while a fresh never-started
container export and pinned source downloads recollect V4 observations from
the loaded image. Replay passes only that derivative to the strict scanner;
the current protected policy and evidence bytes remain the sole disposition
inputs. A changed observation must satisfy those same reviewed bindings and
proofs or the scan fails; new evidence requires a new human-reviewed record.
The derivative receipt records both frozen and new manifest/identity hashes.

Docker's local `Identity.Build` ref appears in the frozen build inspection but
is omitted after a clean `docker load`; RepoTags, RepoDigests and
Metadata.LastTagTime can also change. This path requires the original verified
one-entry build ref and time, the exact loaded ID, config, RootFS, platform and
every other inspect field, and allows only that specific build-identity
serialization loss plus the named tag/location changes. It does not infer a
signed origin from the loaded inspection or replace the independently checked
Actions run/job/artifact provenance. Any other inspection difference fails
closed. No live workflow or App status writer invokes this path yet.

`image_approval_artifact.py` is an inactive artifact-ID downloader for the
read-only replay caller. It requests only
`/repos/arcee-ai/nac/actions/artifacts/<approved ID>/zip` with an Actions-read
token, inspects GitHub's single 302, and makes a separate token-free request
only to the observed `productionresultssa<digits>.blob.core.windows.net`
Actions-results ZIP path with a short-lived signed read URL. It refuses any
other origin, path, second redirect, malformed signature, expired URL, output
link or oversized stream. The complete downloaded ZIP SHA-256 must equal the
protected record before the bounded extractor can use it. If GitHub changes
storage delivery, the caller fails closed until the new origin is reviewed;
this module does not grant artifact metadata or status authority by itself.

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
an App token available only to protected jobs, trusted safe download/extraction
and strict replay workflow, and a fixture PR
showing positive status attribution plus wrong-run/attempt/head/digest, expired
and revoked negatives. No live approval branch, credential, App source rule or
merge-time fixture has been configured here.

The protected replay workflow must fetch
the artifact by approved ID, use the reader above, recollect stale V4 evidence
on the same loaded image when needed, and pass independently authenticated
policy/evidence into the verifier. None of these workflow transitions is
activated by candidate custody; in particular it creates no status.

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
