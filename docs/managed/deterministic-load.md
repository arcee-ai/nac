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

## Direct sessions with traditional children

The same command also runs a separate offline direct-session workload. It
starts one, two, and four direct parents, each launching a traditional child
that executes a native command. The ordered baseline keeps parent and child
model requests at explicit barriers; a four-parent concurrent case removes the
completion ordering and requires observed overlapping attachment and completion.
A separate loopback case drives the built `nac-web` candidate at all three
levels and verifies its reported build identity. The settlement activity gauge
records actual concurrent store operations;
timestamps alone are not used to infer overlap.

The direct cases check transcript and event ordering, generation-bound terminal
receipts, one delivered parent inbox item per child, recovery obligations,
SQLite integrity, process start/stop observations, and readiness probes while
model requests and settlement are in progress. Separate cases cancel a child
blocked in model I/O or a live native process tree, then reconstruct the manager
and check durable settlement. A separate case holds a SQLite write lock while an
event append for the active child reaches the busy callback and readiness remains
responsive. An injected child transcript append failure retains its failed run
marker and delivers one parent inbox item after reconstruction. The native case
verifies that the observed descendant is gone after cancellation. The nightly portability lane additionally
runs the 1/2/4 workload with owned persistence on current-thread and
multi-thread runtimes.

Direct evidence uses schema version 2 under `target/direct-load/` and
`target/persistence-load-direct/`. Each attempt first replaces stale evidence
with an `incomplete` receipt; a successful case writes its measured outcome.
The direct baseline bounds phase completion at 20 seconds and each health or
readiness probe at 5 seconds. These are liveness budgets for this fixture, not
latency targets or numeric comparisons with the older worker workload.
The evidence contains synthetic identifiers and timings, not prompts or
credentials. These local, scripted cases do not certify managed-host deployment
or production latency. Managed-orchestration failure cases above remain
separate coverage.

`make test-managed-fault-fixture` separately builds a feature-gated candidate
under `target/private-fault/`. Its child-read case binds a one-shot control to
the exact session, run, generation and nonce, verifies the process that reached
it, then reconstructs the server and checks one delivered completion. The
commit-ack case injects uncertainty after a real SQLite commit and checks that
replay retains exactly one prompt and receipt. Normal binaries reject private
controls; the private build is not a release artifact.

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
