# 0008 — Retained authority for independent task follow-ups

Status: accepted human decision, 2026-10-31

## Context

[ALL-470](https://linear.app/arcee/issue/ALL-470) requires human authorization
covering the target and action, while later headless coordination must remain
possible after its original coordinator turn ends. Ordinary permission policy
and human task intent are separate. Wildcard Allow and Auto-approve can admit a
prepared tool invocation without proving that task intent; peer messages and
reviewer intent are not exact delegation records.

## Decision

Use a separate service-issued retained delegation bound to the caller session,
target session and requested follow-up action (`queue`, `steer` or `auto`). The
human product service issues it through the established trusted product ingress.
No native tool, public MCP operation, model input field or origin flag can issue
that capability. Issuance uses the caller's current construction-selected
Local policy and configuration revision, preserving hard/configured Deny. It
does not enter agent Ask, change approval mode or create permission grants.

The store retains the human request identity, canonical request, session
incarnations/projects, issuing configuration version, service origin and
revocation time. These identify the product request; they do not invent a
per-person identity beyond the existing ingress authentication boundary.
Issuance is idempotent by caller and human request ID. Changed arguments
conflict; retrying a revoked request cannot resurrect it. A new explicit human
request replaces the active record for that exact tuple and retains history.

Every native send still passes ordinary prepared permission evaluation. New
inbox admission then validates the active exact delegation and canonical scope
inside the same immediate transaction as receipt/inbox insertion. Retained
intent supplies no permission bypass, backend switch, goal authority, broader
target set or public Task taxonomy.

The new receipt retains its delegation ID. Revocation serializes against that
final admission check, preventing fresh input without erasing accepted work.
Exact replay returns the original admission and present delivery disposition;
it neither consults a replacement delegation nor creates a new obligation.
Current ordinary permission checks still precede native replay.

Schema 47 adds the delegation table and a nullable receipt link after all
allocated schemas 41–46. Historical receipts keep null, and migrations never
manufacture human provenance. Audit records outlive session/inbox deletion;
session incarnation and project revalidation prevent transferring their rights.

## Consequences and verification

The human can authorize later headless sends to one exact task/action. Missing
delegation requires human action even under broad ordinary approval. Native
instructions prohibit manufacturing intent through another tool or product
loopback. Issuance cannot attach or wake an unavailable caller/target; passive
inspection and revocation do not need a live agent owner.

Owning tests cover scope/identity conflicts, concurrent and lost-ack issuance,
revocation races, current configuration/backend/Deny, migration rollback and
each historical allocation, original receipt replay and native Auto-approve
rejection. The serving journey issues through the product router, ends the
coordinator turn, restarts the owned manager, and verifies one native delivery
under retained intent without recording peer input as human review intent.
