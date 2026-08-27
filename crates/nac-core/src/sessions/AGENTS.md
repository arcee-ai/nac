# Session domain and snapshot guide

This directory owns the durable session snapshot contract, codecs, database
facade, summaries, and cross-process operation lease. `../store/` owns broader
product records and schema tables; `../session_service/` coordinates live runs,
recovery, cancellation, and settlement over these contracts.

## Invariants and dependencies

- Persisted behavior values and omitted-value defaults are public compatibility
  surfaces. A snapshot's behavior is immutable after creation.
- Codec changes remain backward compatible with supported stored sessions and
  preserve unknown/legacy defaults deliberately. Never rewrite IDs or history
  as a side effect of loading.
- Snapshot and summary projections are read models over canonical durable
  state; they do not invent liveness from process-local tasks.
- Operation leases coordinate across processes and retain owner/generation
  identity. Recovery must be able to distinguish an active peer from a stale
  owner.
- This layer does not depend on HTTP DTOs, React views, provider transports, or
  tool implementations.

## Starting points

- `mod.rs` — domain types and supported exports.
- `codec.rs` — persisted encoding/default compatibility.
- `db.rs` — session-specific database operations.
- `operation_lease.rs` — cross-process run authority.
- `snapshot.rs` / `summary.rs` — canonical read projections.
- `../store/schema.rs` — database migration owner.
- `../session_service/recovery.rs` — live recovery coordinator.

## Verification

```sh
cargo test --locked -p nac-core sessions
make test-durability
make crate-check CRATE=nac-core
```

Add old-format decode fixtures for persisted representation changes and peer/
restart tests for lease changes.

## Generated artifacts and placement mistakes

Session codecs and schema are hand-authored durable contracts; there is no
generated snapshot source. Never edit user databases as a generation step.

Do not add handler response shaping, provider/model resolution, process
execution, or managed-host policy here. Do not use a snapshot projection as a
second writable source of truth, and do not replace durable lease evidence with
an in-memory flag.
