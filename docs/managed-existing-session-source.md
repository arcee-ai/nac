# Passive existing project-session source

This source-only addition uses the SAME enrolled Native mTLS observation client
and `/internal/v1/managed-session-observation` receiver as existing private
reads. It introduces no CREATE grant, key issuer, attach, resume, inbox wake,
source reservation, runtime constructor, or cleanup acknowledgement. Omitted
operator enrollment leaves the existing private listener unavailable.

## Wire and actual producer

The strict outer schema and purpose remain `managed-session-observation.v1`.
The target retains the original logical host/incarnation, request ID and
unextended deadline. The new `project_existing_session_source` observation is
host-scoped: outer `session_id` is forbidden. Its body includes `project_id`,
full nine-field `expected_binding`, `selection` (`behavior` and `same_behavior`),
and `check` tagged as `observe` or `match`. Match additionally supplies the
previous actual `session_id`, positive integer `project_revision`, stored
`behavior`, and nonnegative `config_version`. Unknown or expanded shapes refuse.

The response schema is `native-existing-session-source.v1`, with `outcome`
`observed` or `matched`, actual full host binding, session/project IDs, actual
positive i64 Project source revision, behavior and configuration version.
Request bodies are bounded to 4096 bytes and replies to 8192 bytes; the initialized
store candidate scan refuses above 4096 persisted sessions. Refusals disclose no
raw store or provider content. Original no-store/correlation, shutdown, deadline
and private worker-guard retention remain in force.

Revision is Native's durable Project counter from `native_source_revisions`,
maintained by the existing schema 38 project/session/association triggers. It is
not a hash of caller JSON and must never be cast into or substituted for the
legacy `managed-create-source.v1` 32-byte target revision. The private Session
counter also participates in before/after equality without becoming wire input.

## Exact first-chat policy and passive ownership

The ordinary first-chat selector and passive source use the same pure selector:
actual persisted summary input order, exact project, optional same requested
behavior, stable descending created_at, then first session without traditional
child or managed-orchestrator lineage. Ties preserve existing input order.

Only that canonical selected session may resolve in the existing cached
SessionObservation. Cold, missing, changed config, changed behavior, wrong
project/binding, changed canonical selection or unavailable source counters
refuse; no alternate cached session is chosen. Initialized readonly store
snapshots, same cached Arc/config, selection and full binding are checked around
the bounded read. All selection, cached resolve, store work and serialization
run inside the original retained projection worker, including after waiter
cancellation. Ordinary first-chat retains its original subsequent snapshot/
creation behavior; this passive path never invokes it.

## Receiving boundary

This candidate preserves current nac/dev frontend/EffectCS/assets wholesale and
receives only protected enrollment/passive reads plus schema 37/38 and the exact
source/journal compatibility seams. Core 5716 CREATE admission/factory custody,
Native terminal-v2/ACK-v2 and production source composition remain separate
unaccepted work. A source observation cannot reconstruct those authorities.

The inspected AFM client posts the strict host-scoped observation directly to
its enrolled Native origin, with the same pinned mTLS client/task bank, JSON,
correlation and narrowed original expiry. It forwards neither M2M/browser
credentials nor a beneficiary. The separate D POST managed-hosts/{id}/
create-source route requires opaque M2M and a beneficiary and speaks the
unchanged legacy CREATE-source protocol. No D v2 conversion is required or
implemented for this direct observation path. Actual deployed origin/enrollment
compatibility still requires genuine runtime qualification; this source does
not claim a deployed AFM→D→Native journey.
