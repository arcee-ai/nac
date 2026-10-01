# 0004 — Persistence ownership and local store guarantees

Status: accepted

## Context

NAC currently persists local and Managed NAC state in an embedded SQLite store
using WAL mode. Managed incident ALL-106 combined SQLite short-read errors, a
transcript append gap, high CPU, and probe starvation while four orchestrators
were active. The store later passed `quick_check`, the pod did not restart, and
the host recovered. Those observations require stronger ownership and
characterization, but they do not identify SQLite, process topology, the async
runtime, or the frontend as the root cause.

Before database or process boundaries move, every persistence implementation
needs an explicit owner, a cross-process exclusion contract, and durable
mutation identities. An in-memory mutex is insufficient because it cannot
exclude another process or establish whether a prior owner survived.

## Decision

### Engine and process identity

The current local and managed engine identity is SQLite in WAL mode. One
serving `nac-web` process owns one canonical store path for its complete
lifetime. Construction acquires a non-blocking, crash-safe operating-system
file lock before store migration, managed startup compare-and-swap, managed
model or clone initialization, or listener binding. A second opener fails
immediately with guidance to stop the existing process or select a different
`--store-path`.
Different canonical store paths have independent locks and may be served
concurrently. Normal exit, abnormal exit, and failed construction release the
lock through descriptor lifetime; the persistent lock file is not itself proof
of a live owner.

The generic canonical-path and file-lock primitive belongs to `nac-core`.
`nac-server` owns a focused application object that acquires the primitive at
construction and retains it across HTTP, MCP, recovery, and background
services. Delivery handlers and `SessionManager`'s process-local maps do not
decide store ownership.

### Session and mutation fencing

The store-owner lease does not replace finer durable invariants. A session
operation remains fenced by its canonical store and session identity. Duplicate
live owners are rejected; after owner death, a replacement must reload durable
transcript, run-recovery, configuration, and generation state before mutating.
Relationship, workspace, resource, host-admission, and maintenance leases keep
their distinct scopes.

Every durable mutation must carry the smallest identity that makes its
invariant replay-safe and rejects a stale writer:

| Mutation | Required durable identity or precondition |
| --- | --- |
| Session run and transcript append | session, run, and append revision |
| Traditional child or managed orchestrator settlement | parent, child, and generation |
| Configuration or presentation update | session and expected revision |
| Inbox, goal, steering, and recovery transitions | session plus item/run identity and current state |
| Managed maintenance or replacement | host incarnation, operation, accepted target, and generation where applicable |

An in-memory lock may reduce duplicate work inside one process, but correctness
must come from transactions, revision checks, generation checks, durable lease
state, idempotency keys, or equivalent store-enforced preconditions.

Worker subprocesses are a temporary direct-writer compatibility path, not an
independent durable ownership model. The bounded persistence coordinator will
make the host process the commit-and-ack owner; workers will return mutation
intent with session/run/generation identity. This decision does not implement
that coordinator or change worker protocol yet.

### Selected backend

Local and Managed NAC remain on SQLite WAL. Allison accepted the ALL-114
**NO-GO** decision on 2026-09-30; embedded and remote Turso are not supported
backends. Qualification evidence remains in closed, unmerged
[PR #310](https://github.com/arcee-ai/nac/pull/310) and
[ALL-114](https://linear.app/arcee/issue/ALL-114).
Any different engine requires new explicit decision and qualification work.
The NO-GO decision does not establish the cause of ALL-106 or resolve its
performance and durability symptoms.

### Conversion, backup, restore, and failure

Any future engine conversion requires a new explicit product decision. It must
be versioned, restartable, and performed while one process owns a quiesced
source store. It writes a new target, verifies
schema and application conformance, then atomically records or selects the new
engine identity. It must never infer engine identity from a partially converted
file or silently overwrite the source. Historical conversion and direct
downgrade compatibility are separate product decisions, not implied here.

A supported backup first stops new mutations, drains admitted work, checkpoints
engine journals as required, and captures a transactionally consistent store.
Restore occurs with no active store owner, preserves stable IDs and immutable
session behavior, validates schema and engine integrity, and then starts a new
owner. Lock files are coordination sidecars, not backup data and not liveness
records.

Ownership contention, an unreadable lock sidecar, an unsupported schema,
failed integrity validation, or a stale durable identity fails closed. Retries
may handle bounded engine contention only when the durable operation is
idempotent; they must not hide transcript gaps, short reads, or ownership
violations. Resource health and probe responsiveness remain separate acceptance
signals, so lighter load or disappearance of an error is not evidence that the
ALL-106 incident cause is resolved.

## Consequences

- Local and Managed NAC cannot accidentally run two serving processes against
  the same canonical store, while separate stores remain independent.
- Restart safety is based on operating-system ownership release plus durable
  state reload, not deletion or freshness of a lock file.
- Existing immutable session behavior and recovery semantics remain unchanged.
- Session/run/generation fencing stays required even under single-process store
  ownership because retries, stale in-memory services, and worker commits can
  still race logically.
- A future engine or coordinator must pass the same ownership, fencing,
  restart, backup/restore, and failure-behavior conformance contract.

## Rejected alternatives

- SQLite busy timeouts do not define process ownership and can delay an
  actionable startup failure.
- A process-local singleton or mutex cannot fence another process or survive a
  restart boundary.
- Treating the ALL-106 incident as proof of an engine defect would exceed the
  available evidence.
- Embedded Turso was rejected by the accepted ALL-114 qualification decision.
  The full persistence coordinator remains separate application-design work.
