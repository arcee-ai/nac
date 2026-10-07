# Durable store guide

This directory owns SQLite persistence and durable records for projects,
sessions, transcripts, threads/worksets, relationships, inbox/goals, grants,
workspace revisions, recovery markers, and cross-process coordination.
`../sessions/` owns session snapshot codecs and the lower session DB facade;
`../session_service/` coordinates live lifecycle over these records.

## Invariants and dependency restrictions

- Schema migrations are forward, backward-compatible within the supported
  upgrade direction, transactional, and idempotent where startup can retry.
  Never rewrite stable IDs, behavior values, relationship generations, or
  historical transcript meaning incidentally.
- Transcript and event revisions are monotonic. Recovery and delivery markers
  must make crash-window replay exactly-once or explicitly idempotent.
- Parent/child and managed-orchestrator reads bind to the correct parent and
  generation; wrong-parent lookups remain opaque/not-found.
- Leases coordinate across processes. In-memory ownership is not evidence that
  a peer is dead.
- Deletion/order operations preserve their established transactional ordering,
  including late relationship-commit exclusion and associated cleanup.
- Stored secrets are not returned through read models. Permission grants retain
  canonical resource and scope semantics.
- Store modules do not depend on Axum, provider clients, React, or process
  execution. Higher layers coordinate effects around store transactions.

## Starting points

- `schema.rs` / `schema_tests.rs` — migrations and complete schema contract.
- `transcript.rs`, `thread_events.rs`, `threads.rs`, `worksets.rs` — durable
  execution history.
- `transcript_append.rs` — identified transcript transactions, run/generation
  fencing and uncertain-commit reconciliation; `transcript_append_tests.rs`
  owns deterministic append fault and concurrency contracts.
- `traditional_children.rs`, `managed_orchestrators.rs` — distinct relationship
  topologies and completion state.
- `session_inbox.rs`, `session_goals.rs`, `steering.rs` — durable continuation.
- `run_recovery.rs`, `orchestrator_compaction.rs` — recovery markers.
- `permission_grants.rs` — remembered authorization persistence.
- `projects.rs`, `workspace_revisions.rs`, configuration modules — product
  records with stable public values.
- `../sessions/codec.rs`, `db.rs`, `operation_lease.rs`, `snapshot.rs` — session
  encoding, storage facade, lease, and projection contracts.
- `managed_runtime_admission.rs` — exact operation/digest uncertainty barrier
  and retained native session/run acknowledgments. It supplies no authentication,
  lease, transport wire or dispatch permission. Every duplicate is observational;
  lost responses and session deletion never reopen a consumed operation.
- `runtime_run_start.rs` — one transaction for a selected original's current
  configuration/behavior, topology or goal generation, run count, leased writer
  and immutable native Run acknowledgement. It reuses the separate traditional
  child and managed orchestrator algorithms. Admission callbacks run after the
  transaction wait and before commit. A retained ack supplies no live owner;
  durable start ownership is recorded before commit in `runtime_run_recovery.rs`.
- `runtime_run_recovery.rs` — retained native accepted-start ownership and its
  pending/prompted/abandoned phases. Prompt marking shares the transcript and
  recovery transaction. Reconciliation requires the actual selected session OS
  lease across the command, admission after waits/precommit, exact immutable
  Run ack, absence of conflicting prompt evidence, and captured topology/goal
  ownership. It settles only that relationship generation or goal revision,
  preserves totals/count/ack, and does not launch execution. Newer generations
  and uncertain edited claims are preserved. Version34 unanchored acks receive
  no inferred start marker or recovery authority during additive migration.
- `managed_runtime_leases.rs` — native sealed reservation/challenge capabilities,
  atomic one-use lease advancement, original deadline and serving-lifetime binding,
  terminal expiry/rollback, and retained lease identity. Authentication/current
  product assignment and live native-run evidence remain application obligations;
  a retained row cannot recreate an execution capability. This state does not
  revoke the host key or choose an execution backend. `managed_runtime_lease_schema.rs`
  owns the additive table and monotonic history constraints.
  Initial Pending observations borrow the actual delivered noncloneable capability
  and compare its exact outstanding row after queue/transaction waits. Their
  private queue view is not a consumable capability; availability supplies no
  assignment provenance, transport authentication, consume, renewal or dispatch.
  Existing original/challenge deadlines and rollback watermarks never reset.
  `PendingRuntimeChallenge::is_initial_for_channel` is a pure borrowed comparison
  for the outer retained dialog owner; it supplies no current-row or authority
  proof. This module keeps the sealed capabilities and their one-use transition
  algorithms together above 800 lines so observation cannot obscure consume/CAS
  ownership; it must not acquire transport, product policy or execution logic.

`schema.rs` is intentionally above 800 lines because it is the ordered,
transactional migration ledger for every supported database revision; splitting
the sequence would obscure upgrade order and rollback. `transcript.rs` is the
single append/revision/scan/repair owner for the durable model conversation.
`managed_maintenance.rs` is intentionally above 800 lines because it is the
single transaction owner for the host maintenance state machine: admission,
blocker snapshots, authenticated-attempt replay, accepted-target fencing, and
forward-start settlement must share exact SQLite transaction and lock ordering.
Splitting those operations would obscure the atomic no-new-work/safe-to-stop
invariant. None of these files may acquire network, process, HTTP, or unrelated
lifecycle logic.

`traditional_children.rs` and `managed_orchestrators.rs` retain each distinct
generation's admission, terminal transition, suppression and exactly-once
completion inbox algorithm together, including their characterization ledgers.
Their cohesive ownership explains their size above 800 lines. Private
transaction helpers let accepted-start recovery share those same algorithms;
they must not acquire model execution, transport policy or the other topology's
public vocabulary.

## Verification

```sh
cargo test --locked -p nac-core store
cargo test --locked -p nac-core sessions
make test-durability
make crate-check CRATE=nac-core
```

Add migration tests from the previous schema and focused concurrent/restart
tests when changing leases, recovery, relationships, or deletion ordering.

## Generated artifacts and placement mistakes

The SQLite schema is code-owned; there is no external migration generator.
Tests are the executable upgrade ledger. Do not edit user database files or add
one-off startup rewrites outside `schema.rs`.

Do not perform network/Git/process work inside store transactions. Do not expose
raw database rows as HTTP DTOs, combine distinct child topologies into one
record, or move lifecycle ordering out of the application/service owner merely
to shorten a call site.
