# Managed-image approval follows the immutable image

Status: chosen for ALL-503 on 2026-11-11; external activation is pending.

## Context

The managed image embeds its source revision and build ID. Its applicability
profile covers the complete final filesystem, including the application binary.
Committing a reviewed rule that names the current image changes the next source
revision and image. A checked-in rule cannot approve a future PR or dev-push
image while preserving exact image/source/profile binding.

## Decision

Keep the candidate and separately checked-out trusted-base applicability files
byte-identical and empty. Build and scan the candidate, freeze its immutable OCI
image ID and retained inventory bundle, then obtain independent human review of
an exact-image approval in a trust plane outside the candidate source. A later
scan consumes that approval and its digest-named evidence against the same
retained bundle. The approval bytes must match an independently pinned digest;
the verifier rejects a source-embedded nonempty rule, missing or mismatched pin,
stale evidence, or changed image/source/package/advisory/patch/payload/profile.

The source-owned PR workflow does not supply an approval. Raw findings and
source-policy results remain unchanged, and the effective decision keeps its
existing schema. A newer image requires its own review. A frozen image can be
re-inventoried without rebuilding when fresh independently collected evidence
is needed, but old evidence timestamps cannot be relabeled; changed evidence
requires a new review and approval digest.
Legacy schema-1 applicability receipts remain readable only when they admitted
zero findings; they cannot prove an external approval retroactively.

## Trust and activation boundary

The caller-supplied digest pin validates bytes, not reviewer authority.
Production admission needs a protected approval store with current/revocation
state, independent actor controls, digest pinning, retained OCI/bundle custody,
and a trusted post-build job that rechecks the scanner database and publishes a
required status for the exact candidate head and image. Those external controls
are not provisioned in this repository today. Until they are, the original
strict image gate remains blocked and no candidate-authored approval can turn
it green. The beta publisher needs the same frozen-byte handoff and fresh
post-approval re-evaluation before promotion.

This decision preserves individual evidence review and does not approve any
finding, exception, image publication, deployment, or merge.
