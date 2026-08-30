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
- `session_assignments.rs` — unified spawn assignment rows.
- `traditional_children.rs`, `managed_orchestrators.rs` — Agent and NAC
  assignment projections and completion state.
- `session_inbox.rs`, `session_goals.rs`, `steering.rs` — durable continuation.
- `run_recovery.rs`, `orchestrator_compaction.rs` — recovery markers.
- `permission_grants.rs` — remembered authorization persistence.
- `projects.rs`, `workspace_revisions.rs`, configuration modules — product
  records with stable public values.
- `../sessions/codec.rs`, `db.rs`, `operation_lease.rs`, `snapshot.rs` — session
  encoding, storage facade, lease, and projection contracts.

`schema.rs` is intentionally above 800 lines because it is the ordered,
transactional migration ledger for every supported database revision; splitting
the sequence would obscure upgrade order and rollback. `transcript.rs` is the
single append/revision/scan/repair owner for the durable model conversation.
Neither file may acquire network, process, HTTP, or unrelated lifecycle logic.

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
