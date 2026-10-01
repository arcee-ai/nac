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

### Bounded durable command coordinator

The serving store owner is a `StoreCoordinator` in `nac-core::store`, composed
by `nac-server::application::persistence`. It retains the canonical store lease
on one dedicated persistence thread until accepted work drains. One store has
one executor; a second serving opener is still rejected by the operating-system
lease. Dropping the application handle cannot release ownership ahead of work
already accepted by that executor.

Store owners define closed, typed commands beside their existing transactions.
A command owns its arguments, mutation identity, and correlation metadata.
The executor receives neither arbitrary SQL nor application callbacks; it
never acquires agent, event publication, or server cache locks. Commands use the
admitted canonical path, even if a caller's path alias changes before execution.
The compatibility bridge routes existing path-based APIs through these same
commands. Owned raw connection checkout outside the executor fails closed.
Standalone CLI and offline inspection APIs retain their existing behavior.

Admission is immediate and bounded. The serving queue holds at most 128 waiting
commands, plus one executing command. Excess work returns a distinct overload
error before executing. Accepted commands follow global FIFO order, which also
preserves order within each session; session/run/generation checks remain in
the original transactions. No permission, engine, or execution-backend decision
changes at this boundary.

Legacy synchronous application operations have a separate bounded caller
adapter with 128 process-wide slots. Its tasks wait for typed commands on the
blocking pool; they do not acquire executor authority. A dropped caller future
retains its slot until its detached task returns. Excess caller work is rejected
before spawning a task. Async serving callers await typed ports or this adapter;
a synchronous command wait on a current-thread runtime is explicitly rejected.
The multithread runtime's synchronous compatibility bridge yields its worker
through `block_in_place` while the dedicated executor performs SQLite work.

SQLite retains its finite five-second busy wait and the identified transcript
append's existing selective retry delays. The coordinator adds no blanket
retry of a failed transaction. Maintenance/control lease acquisition on the
executor is non-blocking: the executor must not wait for a holder whose release
requires another persistence command.

Dropping an async acknowledgement before execution cancels queued work without
running its transaction. Dropping it after execution begins cannot undo a
commit. Exact append/dispatch receipts, revision checks, and generation fencing
remain the basis for replay after uncertain acknowledgement. Queue execution
success, transaction commit, and acknowledgement delivery are distinct facts.
An executor panic closes admission and fails queued commands without executing
them. The executing command has an uncertain acknowledgement and must be
reconciled from durable state; the coordinator never retries it automatically.

Event publication serializes sequence allocation, persistence, and publication
through a publication gate. It releases the replay-cache lock while SQLite is
waiting. Projection reads share the publication gate at their snapshot boundary,
but execute their typed store query without taking event-cache or agent locks
on the executor. Read-only run projections use the last published local
operation snapshot; an admission holding its mutable state remains conservatively
busy so the service cannot be evicted before its durable preconditions settle.
These local snapshots do not replace durable ownership or run recovery.
Publication rejected at caller admission retains an explicit sequence gap so a
replay cannot silently skip an event whose durable outcome was never accepted.

Shutdown stops local run admission, cancels active runs, drains delivery, and
waits for already-finishing settlements before closing the persistence queue.
Queued inbox items and goals remain durable for restart. Closing admission then
drains accepted commands before releasing the lease. The server's independent
outer watchdog bounds complete shutdown; a forced process exit relies on the
existing crash/restart reconciliation contract rather than inventing a rollback.

Bounded diagnostics distinguish caller/queue admission, queue wait, execution,
SQLite transaction/commit profiling, acknowledgement, retry, cancellation, and
shutdown. Queue depth/capacity and executor/caller activity are separate gauges.
Diagnostics export bounded correlation IDs and SQLite error identity, never SQL,
row contents, credentials, or arbitrary error text. SQL profiling observes phase
duration; durable receipts and transaction results establish commit success.

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

### Worker episode commits

The host owns durable worker episode completion. Before spawning a worker it
admits a dispatch with session, thread, dispatch UUID, current session run, and
monotonic thread generation. The worker sends a versioned structured completion
on stdout. Only the admitted identity can append; the host supplies the action
from its durable admission rather than accepting database commands from a
frame. Episode and terminal dispatch receipt commit in one transaction.

An exact replay returns the original episode identity. Conflicting content,
unknown identities, newer thread generations, and replaced or terminal session
runs reject an uncommitted result. Session/thread deletion removes receipts so
a late completion cannot recreate the deleted history. Session recovery under
its operation lease terminalizes pending dispatches once as interrupted errors;
it retains committed episodes even when the acknowledgement or worker exit was
lost. Committed results are durable facts, while delivery of the ack remains a
pipe observation.

The host acknowledges only after commit. The worker waits for that exact ack
before exit success or its terminal `RunFinished` event. The host returns the
canonical committed answer; worker stdout carries only structured completions. Existing
model/tool events and usage stream during execution. Cancellation and timeout
fence pending commits and clean the process tree; a commit that won the fence
remains retained. Malformed, mismatched, oversized, closed-pipe, and commit
failure paths fail explicitly and clean up without a success ack. Completion
frames are limited to 4 MiB and control frames to 16 KiB; native credentials
retain their separate private socket and exact-value redaction.

Workers retain existing store-backed context/steering behavior, but do not
append completed episodes or initialize schema. This is the narrow ALL-113
protocol. The serving persistence coordinator now executes the host's typed
admission and completion transactions without changing that protocol or moving
top-level transcript ownership to workers.

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

## Required worker history and lifecycle cleanup

For an owned serving store, worker admission records the previous thread-event
boundary. The acknowledged `ThreadStarted` must be newer than that boundary and
is bound to the exact dispatch, session run, and thread generation before the
worker starts. Required stderr events report persistence failures to host
supervision. An internal stderr barrier precedes the existing completion frame,
so the host waits for prefix acknowledgements before committing or acknowledging
a successful episode. The episode transaction independently checks that the
bound start, run start, and assistant history exist in order for this generation.
It rejects an incomplete prefix after restart as well as during live execution.
A failed publication produces a failed episode, or leaves a pending dispatch for
existing recovery when the failure receipt itself cannot be acknowledged. It
never synthesizes missing events after successful completion. Schema 32 adds
these history boundaries while retaining existing schema-31 episode receipts.

Mandatory local dispatch removal and cancellation notification run before
fallible durable steering expiry. Rejection leaves unresolved steering rows
available to existing recovery and emits a diagnostic; it cannot leave an exited
process in the running registry. Async cancellation, settlement, and compaction
coordinate potentially contended local mutation gates through bounded callers.
Accepted lifecycle cleanup retains one obligation per admitted operation and
may await caller capacity off-loop after a definite pre-execution rejection.
This does not retry SQL or admit new user work after overload. Compaction Drop
cleanup retains its operation lease until terminal publication and local
operation cleanup complete. Once compaction selects its terminal result,
publication and manual completion delivery own independent cleanup obligations.
Cancelling their waiter cannot replace that selected result with Cancelled or
emit a second terminal event; cancellation before selection keeps its existing
Cancelled outcome. Permission grant waiters retain their distinct
synchronous final liveness fence.

## Consequences

- Local and Managed NAC cannot accidentally run two serving processes against
  the same canonical store, while separate stores remain independent.
- Restart safety is based on operating-system ownership release plus durable
  state reload, not deletion or freshness of a lock file.
- Existing immutable session behavior and recovery semantics remain unchanged.
- Session/run/generation fencing stays required even under single-process store
  ownership because retries, stale in-memory services, and worker commits can
  still race logically.
- A future engine must pass the same ownership, fencing,
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
