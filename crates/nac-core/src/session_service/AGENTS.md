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
- Orchestrator, direct, traditional-child, and managed-orchestrator paths retain
  their distinct topology invariants even when sharing lifecycle helpers.
- This layer depends inward on sessions/store/runtime contracts, not HTTP DTOs
  or React needs. Delivery-specific mapping belongs in `nac-server`.

## Starting points

- `mod.rs` — service composition and supported facade.
- `attachment.rs` — attach/create and ownership gates.
- `admission.rs` / `settlement.rs` — run generation and durable completion.
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
