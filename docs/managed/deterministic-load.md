# Deterministic managed-orchestration load

Run the bounded repository-level scenario from the repository root:

```sh
make test-managed-load
```

The command builds `nac-web`, uses that exact binary for real `__worker` child
processes, and drives the server router, session manager, managed-orchestrator
monitor, event and transcript stores, inbox delivery, and terminal settlement.
It needs no external model or credentials: a loopback scripted model returns a
fixed logical plan from the default seed `0x0a110112`. Set
`NAC_MANAGED_LOAD_SEED` to a decimal `u64` to reproduce a different plan.

The healthy lane runs one, two, and four managed orchestrators. Explicit phase
barriers prove the requested processes overlap. Each run checks contiguous
transcripts, exact worker event and episode counts, one terminal settlement and
one delivered completion per generation, no active recovery obligation, store
integrity, readiness during both controlled phases, and matching child-process
start/stop observations. Child admission is staged in plan order until each
orchestrator reaches the initial model barrier. After all worker processes are
simultaneously observed at the worker barrier, model responses and terminal
settlements are released one plan ordinal at a time, only after the preceding
parent completion reaches its model acknowledgement. The claimed overlap is
therefore the explicitly observed blocked-worker phase, not child attachment,
completion delivery, settlement, or parent-session mutation. Parent and
orchestrator services remain attached for the whole burst, making cache
lifetime an explicit control rather than a load variable.

A separately named four-way `concurrent_child_attachment_and_settlement_probe`
keeps the child attachments pinned but removes terminal-settlement ordering. It
exercises the observed non-contiguous transcript window and records either
`reproduced_non_contiguous_transcript_invariant_failure`,
`reproduced_managed_run_failure_in_concurrent_window`, or
`completed_without_reproduction`. If the concurrent window does not settle
within its bounded observation period, the fixture cancels only the
still-running managed runs and records
`reproduced_unsettled_managed_run_then_cancelled`. It does not convert any
observation into a root-cause claim. In every outcome the lane requires terminal
relationships, delivered inbox items, idle child services, terminal-consistent
recovery state (clear for completed runs, `failed` for failed runs), matching
process start/stop telemetry, and a valid store before it writes evidence.

The same invocation also exercises these deterministic failure modes:

- delayed model I/O at both phase barriers;
- a held SQLite write transaction competing with an event append;
- an injected transcript append failure;
- one injected monitor read failure followed by explicit recovery;
- cancellation while the real worker process is blocked in model I/O; and
- an abandoned managed run reconciled after manager reconstruction.

JSON evidence is rewritten on each run under `target/managed-load/`, including
one artifact per healthy concurrency level, the slow-I/O run, and a combined
fault artifact. Evidence includes the seed and logical plan, elapsed time,
probe latency, store configuration and checkpoint results, operation latency
distributions, peak active connections and persistence operations, peak
orchestrator and child-process counts, process IDs, resource samples, and
telemetry export/drop counts. Synthetic credentials are checked before any
artifact is written.

This scenario is an attribution harness, not a root-cause verdict. It keeps
browser behavior and Kubernetes/PVC behavior outside the primary fixture. Its
`LoadStoreAdapter` boundary records the current SQLite/WAL configuration and
checkpoint results. SQLite WAL remains selected after the accepted ALL-114
NO-GO; embedded and remote Turso are not supported backends. The
[persistence decision](../architecture/0004-persistence-ownership.md#selected-backend)
links the retained qualification evidence. A different backend requires new
explicit decision and qualification work. Results from experiments that change
cache lifetime, backend, or deployment shape are separate evidence and must not
be promoted into a causal claim without a focused reproducer.
