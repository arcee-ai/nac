# Session lifecycle guide

`session_service` coordinates live execution with durable session state. It owns
attachment/submission, admission, direct interaction, cancellation, settlement,
recovery, transcript/frontend projection, and manual compaction. The store owns
durable records; runtime/tool modules own execution internals.

## Invariants and dependencies

- Admission and settlement ordering must remain transactional and generation-
  aware. Never expose a run as accepted before its durable preconditions commit.
- Cancellation, recovery, and completion delivery are restart-safe. A terminal
  child/managed relationship settles exactly once and remains attributable to
  the correct parent/generation.
- Steering/inbox items are never silently dropped: late direct steers promote
  to successor execution under the established contract.
- Attachment and frontend projection must not mutate ownership merely to render
  a view. Projection failures must preserve canonical durable state.
- Recovery distinguishes process-local liveness from durable leases and peer
  ownership. Do not present in-memory task tracking as restart-safe.
- Required runtime-effect intent captured from trusted run construction is
  immutable for every service clone. Conventional submission, manual compaction,
  inbox input and automatic inbox/goal wakeups fail before admission or mutation;
  an old original-run lease cannot authorize a successor prompt.
  `submit_runtime_original` requires the sealed admission and matching private
  construction identity from guarded resume. It retains the same original in
  canonical private active state before publishing a run. Renewal observation
  rejects finishing/cancelling state even while a public projection remains.
  Durable start commits topology/accounting generation, count, leased writer
  and original Run acknowledgement together. Pending delivery abort denies the
  guard. The initial HTTP deadline still fences the first prompt transaction;
  an admitted active continuation uses freshly renewed leases thereafter.
  Pending MCP prompt resolution requires the same captured registry original,
  checks initial admission after connection-lock waits at the SDK boundary, and
  aborts the original on lost caller delivery before durable run admission.
  This is an opt-in core primitive, not authenticated HTTP delivery or startup
  selection. Durable start/prompt markers and guarded resume reconciliation
  now cover matching starts lost before prompt publication under the actual
  selected OS lease. Later relationship generations and edited goal revisions
  retain their ownership; unanchored predecessor history remains uncertainty.
  Successful protected completion captures Local Git while the exact active
  original and selected OS lease remain live, serializes completion ownership,
  and lets cancellation win independently. Every wait/effect/output boundary
  rechecks ownership; command denial cleans the supervised owned tree and stops
  the sequence without Git rollback/readback. Released captures retain their
  actual run and transcript prefix as terminal bookkeeping. Protected SSH stays
  closed pending exact remote receipt/cleanup composition; absent targets never
  fall back. Failed/cancelled/expired originals retain raw files and prior real
  snapshots without manufacturing a current-run revision. Capturing ordinary
  requested cancellation after quiescence still needs a separate ownership
  mechanism: the existing finishing claim immediately denies renewal/effects.
  Do not qualify that behavior, cleanup uncertainty/retry, the complete protected
  lifecycle, or listener activation from the Local capture fixtures alone.
- Orchestrator, direct, traditional-child, and managed-orchestrator paths retain
  their distinct topology invariants even when sharing lifecycle helpers.
- This layer depends inward on sessions/store/runtime contracts, not HTTP DTOs
  or React needs. Delivery-specific mapping belongs in `nac-server`.

## Starting points

- `mod.rs` — service composition and supported facade.
- `attachment.rs` — attach/create and ownership gates.
- `admission.rs` / `settlement.rs` — run generation and durable completion.
- `runtime_admission.rs` — sealed-original submission and private run observation.
- `completion_capture.rs` — exact-original Local completion capture and supervised cutoff.
- `direct_interaction.rs` — steering/queue submission.
- `cancellation.rs` — abort and cleanup ordering.
- `recovery.rs` — restart/peer/crash-window reconciliation.
- `frontend_projection.rs` / `transcript_projection.rs` — read models.
- `manual_compaction.rs` — explicit compaction lifecycle.
- `session_service_tests.rs` and local sibling test modules — behavior ledger.

`session_service.rs` is a deliberate composition-root exception above 800
lines: it owns the public lifecycle facade/types, shared active-operation state,
frontend message/thread projection helpers, and delegates attachment,
admission, cancellation, recovery, settlement, and direct interaction to the
submodules above. New use-case logic belongs in a focused submodule; do not grow
the root with another lifecycle implementation.

## Verification

```sh
cargo test --locked -p nac-core session_service
make test-durability
make crate-check CRATE=nac-core
```

Use exact crash-window filters while iterating, then run the complete durability
gate. Tests that use shared stores should prove peer/restart behavior, not only
single-process success.

## Generated artifacts and placement mistakes

This owner has no checked-in generated artifacts. Durable schema changes belong
to `../store/schema.rs`; frontend/OpenAPI projections are generated or mapped at
their delivery owners.

- Do not add Axum handlers, response DTOs, managed provider clients, or UI
  formatting here.
- Do not bypass the store with process-local flags for a durable fact.
- Do not make recovery call a delivery adapter or invent a second completion
  path.
- Do not combine topology-wide branches when construction can pass a focused
  component or capability.
